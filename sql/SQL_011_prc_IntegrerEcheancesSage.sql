/*
  SQL_011 — Procédure d'intégration RÉCURRENTE des factures clientes Sage -> échéances GRC (RT_ECHEANCE).

  Remplace les trois procédures du job « GR Job Reglement Inwi » (prc_InsertEcheance de Go-Com-D_BHUB, prc_InsertEcheance_Sage,
  prc_InsertEcheance de GOCOM_BHUB). Dérivée de sql/integration_echeance_facture_sage.sql (script ponctuel corrigé) :
  mêmes formules que la DLL GRC (ErpDocumentService.Integrer -> SocieteManager.EcheanceCreate), voir ce script pour le détail.

  DÉCISIONS PO (2026-10-01) : la SOURCE est la base Sage — toutes les lignes F_DOCREGL à cbFlag = 0 (plus de limite aux dépôts
  de facturation, plus de lien obligatoire avec une commande BHUB). Le script ponctuel limitait aux dépôts de FG_DEPOTFACTURATION.

  CE QUI CHANGE PAR RAPPORT AU SCRIPT PONCTUEL
   - procédure paramétrée (CREATE OR ALTER), pas de DECLARE en tête ;
   - fenêtre de dates glissante (@JoursEnArriere, défaut 90 j) bornée par @DateDu (défaut 2025-01-01, début du projet) :
     évite de réévaluer toute l'histoire toutes les 5 min. Rattrapage de l'ancien : @JoursEnArriere = NULL ;
   - plafond par exécution @MaxEcheances (défaut 500) = COUPE-CIRCUIT : au-delà, RIEN n'est inséré et l'étape échoue (erreur 50004).
     Utile quand un script remet des milliers de cbFlag à 0 (suppression d'échéances) : décider du rattrapage à la main ;
   - une ligne Sage à cbFlag = 0 dont la pièce a DÉJÀ toutes ses échéances en GRC est simplement passée à cbFlag = 1 (c'est ce que
     faisait l'étape 4 du job, par pièce, à cause du changement de DR_No au passage facture 6 -> 7) ; si la pièce n'est que
     partiellement en GRC -> rejet PIECE_PARTIELLE_EN_GRC (rien n'est modifié) ;
   - pas de table BAK_IM_* par exécution : 3 tables de journal permanentes (voir ci-dessous) ;
   - verrou exclusif de RT_ECHEANCE seulement s'il y a quelque chose à faire, attente max 10 s, priorité de deadlock BASSE :
     si le verrou n'est pas obtenu ou en cas d'interblocage, le cycle est sauté (statut VERROU_NON_OBTENU) et repris 5 min plus tard ;
   - ne valide plus les documents Sage : une facture non validée (DO_Valide = 0) est REJETÉE (FACTURE_NON_VALIDEE), alors que le
     job la validait d'office dès qu'elle avait une échéance (étape 4 du job, à traiter séparément : décision D-06).

  JOURNAUX (créés ci-dessous, base GRC) :
   - LOG_INTEGRATION_ECHEANCE         une ligne par exécution (statut, compteurs, durée, message) ;
   - LOG_INTEGRATION_ECHEANCE_LIGNE   chaque échéance créée (CREE) ou ligne passée à cbFlag = 1 (FLAGUE) — sert à l'annulation ;
   - LOG_INTEGRATION_ECHEANCE_REJET   état COURANT des lignes bloquées (motif, première/dernière vue) = ce qu'il faut traiter dans l'écran GRC.
  Supervision : SELECT * FROM LOG_INTEGRATION_ECHEANCE_REJET ORDER BY Premiere ; et les statuts <> 'OK'/'RIEN' du journal.

  MISE EN SERVICE (rien n'est appliqué par ce fichier hors création des tables et de la procédure)
   1. Sauvegarde de GR_GOCOM et GOCOM. Exécuter ce fichier dans GR_GOCOM.
   2. Aperçu du rattrapage :  EXEC dbo.prc_IntegrerEcheancesSage @Apply = 0, @JoursEnArriere = NULL;   (lire les sections)
   3. Rattrapage unique :     EXEC dbo.prc_IntegrerEcheancesSage @Apply = 1, @JoursEnArriere = NULL, @MaxEcheances = 40000;
      (d'abord un essai sur UNE facture avec @DoNumero.)
   4. Job SQL Agent : désactiver les étapes 2, 3 et 10, ajouter une étape (base GR_GOCOM) :  EXEC dbo.prc_IntegrerEcheancesSage;
      Les étapes 4 (cbFlag/DO_Valide) et l'étape 2 du job « Planification Instantané » (Info1) peuvent rester : elles ne gênent pas.
   Ne pas lancer l'import de l'écran GRC en même temps (la procédure revérifie sous verrou, l'écran non).

  Limites (comme le script ponctuel) : ne notifie pas les écrans GRC ouverts ; ne teste pas les droits utilisateur / souche ;
  SO_UseObjetMetier doit valoir 0 (sinon la procédure s'arrête) ; ne touche ni F_DOCENTETE ni F_DOCREGL.DR_Regle.
  Bases : GR_GOCOM = GRC ; GOCOM = Sage (= P_SOCIETE.SO_ErpDb, même instance : pas de MSDTC). Autre environnement : remplacer ces deux noms.

  ANNULATION d'un lot : bloc UNDO en fin de fichier.
*/
USE GR_GOCOM;
GO

------------------------------------------------------------------------------------------ JOURNAUX
IF OBJECT_ID('dbo.LOG_INTEGRATION_ECHEANCE', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.LOG_INTEGRATION_ECHEANCE (
        LI_Id       INT IDENTITY(1,1) CONSTRAINT PK_LOG_INTEGRATION_ECHEANCE PRIMARY KEY,
        LI_Batch    UNIQUEIDENTIFIER NOT NULL,
        LI_Debut    DATETIME NOT NULL CONSTRAINT DF_LOG_INTEGRATION_ECHEANCE_Debut DEFAULT (GETDATE()),
        LI_DureeMs  INT NULL,
        LI_Mode     VARCHAR(10) NOT NULL,                -- APPLY
        LI_Statut   VARCHAR(30) NOT NULL,                -- EN_COURS / OK / RIEN / VERROU_NON_OBTENU / PLAFOND_DEPASSE / ERREUR
        LI_Lignes   INT NULL,                            -- lignes Sage à cbFlag = 0 examinées
        LI_Creees   INT NULL,
        LI_Montant  DECIMAL(24,6) NULL,
        LI_Flaguees INT NULL,
        LI_Ignorees INT NULL,
        LI_Bloquees INT NULL,
        LI_Message  NVARCHAR(2000) NULL);
    CREATE INDEX IX_LOG_INTEGRATION_ECHEANCE_Debut ON dbo.LOG_INTEGRATION_ECHEANCE (LI_Debut);
END
GO
IF OBJECT_ID('dbo.LOG_INTEGRATION_ECHEANCE_LIGNE', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.LOG_INTEGRATION_ECHEANCE_LIGNE (
        LL_Id     INT IDENTITY(1,1) CONSTRAINT PK_LOG_INTEGRATION_ECHEANCE_LIGNE PRIMARY KEY,
        LI_Batch  UNIQUEIDENTIFIER NOT NULL,
        LL_Action VARCHAR(6) NOT NULL,                   -- CREE / FLAGUE
        EC_Id     INT NULL,                              -- échéance créée (NULL si FLAGUE)
        DR_cbMarq INT NOT NULL,                          -- ligne Sage F_DOCREGL
        DR_No     INT NOT NULL,
        DO_Piece  VARCHAR(13) NOT NULL,
        DO_Type   SMALLINT NOT NULL,
        Montant   DECIMAL(24,6) NULL,
        LL_Date   DATETIME NOT NULL CONSTRAINT DF_LOG_INTEGRATION_ECHEANCE_LIGNE_Date DEFAULT (GETDATE()));
    CREATE INDEX IX_LOG_INTEGRATION_ECHEANCE_LIGNE_Batch ON dbo.LOG_INTEGRATION_ECHEANCE_LIGNE (LI_Batch);
END
GO
IF OBJECT_ID('dbo.LOG_INTEGRATION_ECHEANCE_REJET', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.LOG_INTEGRATION_ECHEANCE_REJET (
        DR_cbMarq INT NOT NULL CONSTRAINT PK_LOG_INTEGRATION_ECHEANCE_REJET PRIMARY KEY,   -- ligne Sage F_DOCREGL
        DR_No     INT NOT NULL,
        DO_Piece  VARCHAR(13) NOT NULL,
        DO_Type   SMALLINT NOT NULL,
        DO_Date   DATETIME NULL,
        Montant   DECIMAL(24,6) NULL,
        Motif     VARCHAR(40) NOT NULL,
        Premiere  DATETIME NOT NULL CONSTRAINT DF_LOG_INTEGRATION_ECHEANCE_REJET_Premiere DEFAULT (GETDATE()),
        Derniere  DATETIME NOT NULL,
        NbVues    INT NOT NULL CONSTRAINT DF_LOG_INTEGRATION_ECHEANCE_REJET_NbVues DEFAULT (1));
END
GO

------------------------------------------------------------------------------------------ PROCÉDURE
CREATE OR ALTER PROCEDURE dbo.prc_IntegrerEcheancesSage
    @SocieteNo          INT         = 1,            -- RT_ECHEANCE.SO_Id
    @UserNo             INT         = 1,            -- RT_ECHEANCE.UT_Id (1 = majorité des échéances existantes)
    @Apply              BIT         = 1,            -- 0 = aperçu (rien n'est écrit, résultats détaillés) ; 1 = intègre
    @DateDu             DATE        = '20250101',   -- plancher absolu sur la date de la FACTURE ; NULL = pas de plancher
    @JoursEnArriere     INT         = 90,           -- fenêtre glissante ; NULL = pas de fenêtre (rattrapage)
    @DoNumero           VARCHAR(13) = NULL,         -- optionnel : une seule facture (essai) ; pas de maintenance des rejets
    @ExclureNonValidees BIT         = 1,            -- 1 = rejette les factures DO_Valide = 0
    @MaxEcheances       INT         = 500           -- coupe-circuit par exécution
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @Batch UNIQUEIDENTIFIER = NEWID(), @T0 DATETIME2 = SYSDATETIME(), @LiId INT = NULL;

    -------------------------------------------------------------------------------------- 0. COHÉRENCE SOCIÉTÉ <-> BASE SAGE, DEVISE
    DECLARE @ErpDb NVARCHAR(256), @ErpServer NVARCHAR(256), @ComptaDb SYSNAME, @UseOm BIT, @DeviseErpNo INT, @ImportCompta BIT;
    SELECT @ErpDb = SO_ErpDb, @ErpServer = SO_ErpServer, @UseOm = SO_UseObjetMetier, @DeviseErpNo = SO_DeviseErpNo,
           @ImportCompta = ISNULL(SO_ImportComptabiliseeClt, 0)
    FROM GR_GOCOM.dbo.P_SOCIETE WHERE SO_Id = @SocieteNo;
    IF @ErpDb IS NULL BEGIN RAISERROR('Société %d introuvable dans P_SOCIETE.', 16, 1, @SocieteNo); RETURN; END
    EXEC GOCOM.sys.sp_executesql N'SELECT @n = DB_NAME()', N'@n SYSNAME OUTPUT', @n = @ComptaDb OUTPUT;
    IF @ErpDb <> @ComptaDb BEGIN RAISERROR('SO_ErpDb de la société %d = [%s] mais la procédure cible la base [%s].', 16, 1, @SocieteNo, @ErpDb, @ComptaDb); RETURN; END
    IF @UseOm = 1 BEGIN RAISERROR('SO_UseObjetMetier = 1 : la DLL recalcule les montants via les objets métiers, cette procédure ne les reproduit pas. Utiliser l''écran GRC.', 16, 1); RETURN; END

    DECLARE @DeviseDossier INT = (SELECT N_DeviseCompte FROM GOCOM.dbo.P_DOSSIER WHERE cbMarq = 1);
    IF @DeviseDossier IS NULL OR @DeviseDossier <> @DeviseErpNo
       BEGIN RAISERROR('Devise du dossier Sage (%d) <> P_SOCIETE.SO_DeviseErpNo (%d) : cas non prévu.', 16, 1, @DeviseDossier, @DeviseErpNo); RETURN; END
    IF NOT EXISTS (SELECT 1 FROM GR_GOCOM.dbo.P_SOCIETEDEVISE WHERE SO_Id = @SocieteNo AND SD_No = @DeviseErpNo)
       BEGIN RAISERROR('Devise Sage %d non mappée dans P_SOCIETEDEVISE pour la société %d.', 16, 1, @DeviseErpNo, @SocieteNo); RETURN; END
    DECLARE @DeId INT = (SELECT TOP 1 DV_Id FROM GR_GOCOM.dbo.P_SOCIETEDEVISE WHERE SO_Id = @SocieteNo AND SD_No = @DeviseErpNo ORDER BY SD_Id);
    DECLARE @Format VARCHAR(60) = (SELECT TOP 1 RTRIM(D_Format) FROM GOCOM.dbo.P_DEVISE WHERE cbIndice = @DeviseDossier);
    DECLARE @Dec INT = CASE WHEN CHARINDEX(',', @Format) > 0 THEN LEN(@Format) - CHARINDEX(',', @Format)
                            WHEN CHARINDEX('.', @Format) > 0 THEN LEN(@Format) - CHARINDEX('.', @Format) ELSE 0 END;
    IF @Format IS NULL OR @Dec NOT BETWEEN 0 AND 4 BEGIN RAISERROR('Format de la devise Sage %d illisible ([%s]).', 16, 1, @DeviseDossier, @Format); RETURN; END
    IF @Apply = 1 AND NOT EXISTS (SELECT 1 FROM GR_GOCOM.dbo.P_UTILISATEUR WHERE UT_Id = @UserNo)
       BEGIN RAISERROR('@UserNo = %d : utilisateur GRC inconnu.', 16, 1, @UserNo); RETURN; END

    -- plancher de dates effectif : le plus récent entre @DateDu et (aujourd'hui - @JoursEnArriere)
    DECLARE @Du DATE = @DateDu;
    IF @JoursEnArriere IS NOT NULL
    BEGIN
        DECLARE @Fenetre DATE = DATEADD(DAY, -@JoursEnArriere, CAST(GETDATE() AS DATE));
        IF @Du IS NULL OR @Fenetre > @Du SET @Du = @Fenetre;
    END

    IF @Apply = 1
    BEGIN
        INSERT dbo.LOG_INTEGRATION_ECHEANCE (LI_Batch, LI_Mode, LI_Statut) VALUES (@Batch, 'APPLY', 'EN_COURS');
        SET @LiId = SCOPE_IDENTITY();
    END

    -- bornes d'attente posées dès le début : même la lecture de RT_ECHEANCE (avant le verrou exclusif) ne doit pas attendre indéfiniment
    SET LOCK_TIMEOUT 10000;            -- n'attend pas plus de 10 s (le cycle suivant reprendra)
    SET DEADLOCK_PRIORITY LOW;         -- en cas d'interblocage, c'est cette procédure qui cède, pas l'application GRC

    DECLARE @NbSrc INT = 0, @NbIns INT = 0, @NbFlag INT = 0, @NbIgn INT = 0, @NbBlo INT = 0, @MontantIns DECIMAL(24,6) = 0;
    DECLARE @Now DATETIME = GETDATE(), @n INT, @Verrou INT, @OkMontants INT, @OkFlags INT, @Doublons INT;

    BEGIN TRY
        ---------------------------------------------------------------------------------- 1. LIGNES SAGE À INTÉGRER (F_DOCREGL cbFlag = 0)
        -- Types : 6 = facture, 7 = facture comptabilisée (seulement si SO_ImportComptabiliseeClt = 1).
        SELECT d.cbMarq AS DR_cbMarq, d.DR_No, d.DO_Piece, d.DO_Type, d.DR_Date, d.DR_Pourcent, d.DR_Equil, d.N_Reglement, d.DR_Regle,
               h.DO_Date, h.DO_Tiers, h.DO_Devise, h.DO_Souche, h.CO_No, h.CA_Num, h.DO_Ref,
               h.DE_No, h.DO_Coord02, h.DO_Coord03, h.DO_Coord04, h.DO_Valide, h.DO_TotalTTC,
               h.DO_TxEscompte, h.DO_ValFrais, h.DO_Ecart, h.DO_Taxe1, h.DO_Taxe2, h.DO_Taxe3,
               (SELECT COUNT(*) FROM GOCOM.dbo.F_DOCREGL x WHERE x.DO_Piece = d.DO_Piece AND x.DO_Domaine = 0 AND x.DO_Type IN (6, 7)) AS NbLignes,
               CAST(NULL AS INT) AS NbGrc
        INTO #src
        FROM GOCOM.dbo.F_DOCREGL d
        JOIN GOCOM.dbo.F_DOCENTETE h ON h.DO_Domaine = d.DO_Domaine AND h.DO_Type = d.DO_Type AND h.DO_Piece = d.DO_Piece
        WHERE d.DO_Domaine = 0
          AND (d.DO_Type = 6 OR (d.DO_Type = 7 AND @ImportCompta = 1))
          AND d.cbFlag = 0
          AND (@DoNumero IS NULL OR d.DO_Piece = @DoNumero)
          AND (@Du IS NULL OR h.DO_Date >= @Du);
        SET @NbSrc = @@ROWCOUNT;
        CREATE CLUSTERED INDEX IX_src ON #src (DO_Type, DO_Piece);

        -- Échéances déjà en GRC pour ces pièces (par pièce, quel que soit le DR_No : il change au passage 6 -> 7).
        SELECT CAST(e.DO_Numero AS VARCHAR(30)) COLLATE DATABASE_DEFAULT AS DO_Numero, COUNT(*) AS Nb
        INTO #grc
        FROM GR_GOCOM.dbo.RT_ECHEANCE e
        WHERE e.SO_Id = @SocieteNo AND e.DO_Domaine = 0
          AND EXISTS (SELECT 1 FROM #src s WHERE s.DO_Piece COLLATE DATABASE_DEFAULT = CAST(e.DO_Numero AS VARCHAR(30)) COLLATE DATABASE_DEFAULT)
        GROUP BY CAST(e.DO_Numero AS VARCHAR(30)) COLLATE DATABASE_DEFAULT;
        CREATE CLUSTERED INDEX IX_grc ON #grc (DO_Numero);
        UPDATE s SET NbGrc = g.Nb FROM #src s JOIN #grc g ON g.DO_Numero = s.DO_Piece COLLATE DATABASE_DEFAULT;

        -- Montant TTC = somme des lignes valorisées, seulement pour les pièces pas déjà complètes en GRC (une seule passe sur F_DOCLIGNE).
        SELECT l.DO_Type, l.DO_Piece, SUM(l.DL_MontantTTC) AS SumTTC
        INTO #ttc
        FROM GOCOM.dbo.F_DOCLIGNE l
        JOIN (SELECT DISTINCT DO_Type, DO_Piece FROM #src WHERE ISNULL(NbGrc, 0) < NbLignes) s
          ON s.DO_Type = l.DO_Type AND s.DO_Piece = l.DO_Piece
        WHERE l.DO_Domaine = 0 AND l.DL_Valorise = 1
        GROUP BY l.DO_Type, l.DO_Piece;
        CREATE CLUSTERED INDEX IX_ttc ON #ttc (DO_Type, DO_Piece);

        ---------------------------------------------------------------------------------- 2. VALEURS CALCULÉES + ACTION / MOTIF D'IGNORANCE / DE BLOCAGE
        SELECT s.*, ROUND(ISNULL(t.SumTTC, 0), @Dec) AS Montant,
               c.cbMarq AS Ct_No, c.CT_Num AS Ct_Code, c.CT_Intitule AS Ct_Intitule,
               mr.MR_Id AS Mode_Id, mr.MR_Sommeil, ISNULL(dp.DE_Intitule, '') AS Depot_Intitule,
               CAST(NULL AS VARCHAR(10)) AS Action_, CAST(NULL AS VARCHAR(40)) AS Ignore_, CAST(NULL AS VARCHAR(40)) AS Blocage
        INTO #cand
        FROM #src s
        LEFT JOIN #ttc t ON t.DO_Type = s.DO_Type AND t.DO_Piece = s.DO_Piece
        LEFT JOIN GOCOM.dbo.F_COMPTET c ON c.CT_Num = s.DO_Tiers AND c.CT_Type = 0     -- la DLL ne charge que les tiers de type client
        LEFT JOIN GOCOM.dbo.F_DEPOT dp ON dp.DE_No = s.DE_No
        OUTER APPLY (SELECT TOP 1 m.MR_Id, mm.MR_Sommeil FROM GR_GOCOM.dbo.P_SOCIETEMODEREGLEMENT m
                       JOIN GR_GOCOM.dbo.P_MODEREGLEMENT mm ON mm.MR_Id = m.MR_Id
                      WHERE m.SO_Id = @SocieteNo AND m.SM_No = s.N_Reglement ORDER BY m.SM_Id) mr;
        CREATE UNIQUE CLUSTERED INDEX IX_cand ON #cand (DR_cbMarq);

        -- a) pièce déjà complète en GRC : on se contente de flaguer la ligne Sage (comme l'étape 4 du job)
        UPDATE #cand SET Action_ = 'FLAGUER' WHERE ISNULL(NbGrc, 0) >= NbLignes AND NbGrc IS NOT NULL;
        -- b) pièce partiellement en GRC : rien n'est modifié, à traiter dans l'écran GRC
        UPDATE #cand SET Blocage = 'PIECE_PARTIELLE_EN_GRC' WHERE Action_ IS NULL AND NbGrc IS NOT NULL;
        -- c) ignorée (aucune erreur côté GRC)
        UPDATE #cand SET Ignore_ = 'MONTANT_NUL' WHERE Action_ IS NULL AND Blocage IS NULL AND Montant = 0;     -- la DLL ne retient que Montant <> 0
        -- d) bloquées : la DLL ferait autrement ou lèverait une erreur
        UPDATE #cand SET Blocage =
               CASE WHEN NbLignes <> 1 OR DR_Equil <> 1 OR DR_Pourcent <> 0                      THEN 'ECHEANCES_MULTIPLES_OU_POURCENT'
                    WHEN DO_TxEscompte <> 0 OR DO_ValFrais <> 0 OR DO_Ecart <> 0 OR DO_Taxe1 <> 0 OR DO_Taxe2 <> 0 OR DO_Taxe3 <> 0 THEN 'MONTANT_COMPLEXE'
                    WHEN DO_Devise NOT IN (0, @DeviseDossier)                                    THEN 'DEVISE_ETRANGERE'
                    WHEN Ct_No IS NULL                                                           THEN 'CLIENT_INTROUVABLE'
                    WHEN Mode_Id IS NULL                                                         THEN 'MODE_NON_MAPPE'
                    WHEN ISNULL(MR_Sommeil, 0) <> 0                                              THEN 'MODE_EN_SOMMEIL'
                    WHEN @ExclureNonValidees = 1 AND ISNULL(DO_Valide, 0) = 0                    THEN 'FACTURE_NON_VALIDEE'
                    ELSE NULL END
        WHERE Action_ IS NULL AND Blocage IS NULL AND Ignore_ IS NULL;
        -- e) le reste est à créer
        UPDATE #cand SET Action_ = 'CREER' WHERE Action_ IS NULL AND Blocage IS NULL AND Ignore_ IS NULL;

        SELECT @NbIns  = COUNT(*), @MontantIns = ISNULL(SUM(Montant), 0) FROM #cand WHERE Action_ = 'CREER';
        SELECT @NbFlag = COUNT(*) FROM #cand WHERE Action_ = 'FLAGUER';
        SELECT @NbIgn  = COUNT(*) FROM #cand WHERE Ignore_ IS NOT NULL;
        SELECT @NbBlo  = COUNT(*) FROM #cand WHERE Blocage IS NOT NULL;

        ---------------------------------------------------------------------------------- 3. APERÇU
        IF @Apply <> 1
        BEGIN
            SELECT 'RESUME' AS Section, @NbSrc AS LignesSageFlag0, @NbIns AS EcheancesACreer, @MontantIns AS MontantTotal,
                   @NbFlag AS LignesAFlaguer, @NbIgn AS Ignorees, @NbBlo AS Bloquees, @Du AS PlancherDate,
                   (SELECT MIN(DO_Date) FROM #cand WHERE Action_ = 'CREER') AS DateMin,
                   (SELECT MAX(DO_Date) FROM #cand WHERE Action_ = 'CREER') AS DateMax;
            SELECT 'IGNOREE_PAR_MOTIF' AS Section, Ignore_ AS Motif, COUNT(*) AS Lignes FROM #cand WHERE Ignore_ IS NOT NULL GROUP BY Ignore_ ORDER BY COUNT(*) DESC;
            SELECT 'BLOQUE_PAR_MOTIF' AS Section, Blocage, COUNT(*) AS Lignes, SUM(Montant) AS Montant FROM #cand WHERE Blocage IS NOT NULL GROUP BY Blocage ORDER BY COUNT(*) DESC;
            SELECT TOP 200 'BLOQUE' AS Section, Blocage, DR_No, DO_Piece, DO_Type, DO_Date, Montant FROM #cand WHERE Blocage IS NOT NULL ORDER BY Blocage, DR_No;
            SELECT 'PAR_MOIS' AS Section, FORMAT(DO_Date, 'yyyy-MM') AS Mois, COUNT(*) AS Echeances, SUM(Montant) AS Montant
              FROM #cand WHERE Action_ = 'CREER' GROUP BY FORMAT(DO_Date, 'yyyy-MM') ORDER BY 2;
            SELECT 'PAR_DEPOT' AS Section, Depot_Intitule AS Depot, COUNT(*) AS Echeances, SUM(Montant) AS Montant
              FROM #cand WHERE Action_ = 'CREER' GROUP BY Depot_Intitule ORDER BY COUNT(*) DESC;
            SELECT 'INFO_SAGE_DEJA_REGLE' AS Section, COUNT(*) AS Lignes FROM #cand WHERE Action_ = 'CREER' AND DR_Regle = 1;
            SELECT 'INFO_MONTANT_NEGATIF' AS Section, DR_No, DO_Piece, DO_Type, DO_Date, Montant FROM #cand WHERE Action_ = 'CREER' AND Montant < 0 ORDER BY DO_Piece;
            SELECT 'INFO_ECART_ENTETE_LIGNES' AS Section, DR_No, DO_Piece, DO_Type, Montant AS MontantLignes, DO_TotalTTC AS MontantEntete
              FROM #cand WHERE Action_ = 'CREER' AND (ISNULL(DO_TotalTTC, 0) = 0 OR ABS(DO_TotalTTC - Montant) > 0.011) ORDER BY DO_Piece;
            SELECT TOP 20 'EXEMPLES' AS Section, DR_No, DO_Piece, DO_Type, DO_Date, DR_Date, Montant, Ct_Code, Mode_Id, Depot_Intitule
              FROM #cand WHERE Action_ = 'CREER' ORDER BY DR_No;
            PRINT 'Aperçu uniquement (@Apply = 0). Rien n''a été modifié.';
            SET LOCK_TIMEOUT -1; SET DEADLOCK_PRIORITY NORMAL;
            RETURN;
        END

        ---------------------------------------------------------------------------------- 4. REJETS COURANTS (état des lignes bloquées, hors essai sur une facture)
        IF @DoNumero IS NULL
        BEGIN
            UPDATE r SET Motif = c.Blocage, Montant = c.Montant, DO_Date = c.DO_Date, Derniere = GETDATE(), NbVues = r.NbVues + 1
              FROM dbo.LOG_INTEGRATION_ECHEANCE_REJET r JOIN #cand c ON c.DR_cbMarq = r.DR_cbMarq WHERE c.Blocage IS NOT NULL;
            INSERT dbo.LOG_INTEGRATION_ECHEANCE_REJET (DR_cbMarq, DR_No, DO_Piece, DO_Type, DO_Date, Montant, Motif, Derniere)
            SELECT c.DR_cbMarq, c.DR_No, c.DO_Piece, c.DO_Type, c.DO_Date, c.Montant, c.Blocage, GETDATE()
              FROM #cand c WHERE c.Blocage IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM dbo.LOG_INTEGRATION_ECHEANCE_REJET r WHERE r.DR_cbMarq = c.DR_cbMarq);
            -- rejets résolus : ligne devenue flaguée, ou ligne de la fenêtre qui n'est plus bloquée
            DELETE r FROM dbo.LOG_INTEGRATION_ECHEANCE_REJET r
             WHERE NOT EXISTS (SELECT 1 FROM #cand c WHERE c.DR_cbMarq = r.DR_cbMarq AND c.Blocage IS NOT NULL)
               AND (r.DO_Date >= ISNULL(@Du, '17530101')
                    OR NOT EXISTS (SELECT 1 FROM GOCOM.dbo.F_DOCREGL d WHERE d.cbMarq = r.DR_cbMarq AND d.cbFlag = 0));
        END

        IF @NbIns + @NbFlag = 0
        BEGIN
            UPDATE dbo.LOG_INTEGRATION_ECHEANCE SET LI_Statut = 'RIEN', LI_Lignes = @NbSrc, LI_Creees = 0, LI_Flaguees = 0, LI_Ignorees = @NbIgn,
                   LI_Bloquees = @NbBlo, LI_DureeMs = DATEDIFF(MILLISECOND, @T0, SYSDATETIME()) WHERE LI_Id = @LiId;
            SET LOCK_TIMEOUT -1; SET DEADLOCK_PRIORITY NORMAL;
            SELECT 'RESUME' AS Section, 'RIEN' AS Statut, @NbSrc AS Lignes, 0 AS Creees, 0 AS Flaguees, @NbIgn AS Ignorees, @NbBlo AS Bloquees;
            RETURN;
        END
        IF @NbIns > @MaxEcheances
        BEGIN
            DECLARE @MsgMax NVARCHAR(400) = CONCAT(@NbIns, ' échéances à créer > @MaxEcheances (', @MaxEcheances, ') : rien n''est inséré. ',
                                                   'Vérifier (aperçu @Apply = 0) puis relancer avec un plafond plus haut.');
            THROW 50004, @MsgMax, 1;
        END

        ---------------------------------------------------------------------------------- 5. APPLICATION
        CREATE TABLE #ins (EC_Id INT, EC_No INT, DO_Numero VARCHAR(13));
        CREATE CLUSTERED INDEX IX_ins ON #ins (EC_No, DO_Numero);

        BEGIN TRAN;

        -- verrou exclusif de RT_ECHEANCE jusqu'au COMMIT (l'écran GRC et le job y écrivent aussi)
        SELECT @Verrou = COUNT(*) FROM GR_GOCOM.dbo.RT_ECHEANCE WITH (TABLOCKX, HOLDLOCK);

        -- revérification SOUS verrou (l'écran GRC ou une suppression ont pu travailler depuis le calcul)
        TRUNCATE TABLE #grc;
        INSERT #grc (DO_Numero, Nb)
        SELECT CAST(e.DO_Numero AS VARCHAR(30)) COLLATE DATABASE_DEFAULT, COUNT(*)
          FROM GR_GOCOM.dbo.RT_ECHEANCE e
         WHERE e.SO_Id = @SocieteNo AND e.DO_Domaine = 0
           AND EXISTS (SELECT 1 FROM #cand c WHERE c.Action_ IS NOT NULL AND c.DO_Piece COLLATE DATABASE_DEFAULT = CAST(e.DO_Numero AS VARCHAR(30)) COLLATE DATABASE_DEFAULT)
         GROUP BY CAST(e.DO_Numero AS VARCHAR(30)) COLLATE DATABASE_DEFAULT;
        UPDATE c SET Ignore_ = 'DEJA_EN_GRC_ENTRETEMPS', Action_ = NULL
          FROM #cand c JOIN #grc g ON g.DO_Numero = c.DO_Piece COLLATE DATABASE_DEFAULT
         WHERE c.Action_ = 'CREER';
        UPDATE c SET Ignore_ = 'ECHEANCE_DISPARUE', Action_ = NULL
          FROM #cand c LEFT JOIN #grc g ON g.DO_Numero = c.DO_Piece COLLATE DATABASE_DEFAULT
         WHERE c.Action_ = 'FLAGUER' AND ISNULL(g.Nb, 0) < c.NbLignes;
        UPDATE c SET Ignore_ = 'DEJA_FLAGUEE_SAGE', Action_ = NULL
          FROM #cand c JOIN GOCOM.dbo.F_DOCREGL d ON d.cbMarq = c.DR_cbMarq
         WHERE c.Action_ IS NOT NULL AND d.cbFlag <> 0;
        SELECT @NbIns = COUNT(*), @MontantIns = ISNULL(SUM(Montant), 0) FROM #cand WHERE Action_ = 'CREER';
        SELECT @NbFlag = COUNT(*) FROM #cand WHERE Action_ = 'FLAGUER';
        IF @NbIns + @NbFlag = 0
        BEGIN
            ROLLBACK;
            SET LOCK_TIMEOUT -1; SET DEADLOCK_PRIORITY NORMAL;
            UPDATE dbo.LOG_INTEGRATION_ECHEANCE SET LI_Statut = 'RIEN', LI_Lignes = @NbSrc, LI_Creees = 0, LI_Flaguees = 0, LI_Bloquees = @NbBlo,
                   LI_Message = N'Tout a été traité entre-temps.', LI_DureeMs = DATEDIFF(MILLISECOND, @T0, SYSDATETIME()) WHERE LI_Id = @LiId;
            RETURN;
        END
        IF @NbIns > @MaxEcheances THROW 50004, 'Plus d''échéances que @MaxEcheances sous verrou : annulation.', 1;

        -- création des échéances (valeurs initiales identiques à celles de EcheanceCreate)
        INSERT GR_GOCOM.dbo.RT_ECHEANCE
              (EC_No, DO_Numero, DO_Type, DO_Domaine, DO_Date, EC_Commentaire, EC_Etat, EC_Montant, EC_Solde, EC_Echeance, EC_Type, MR_Id, CT_No, EC_Cours, DE_Id,
               CT_PayeurNo, EC_Souche, DO_Collaborateur, SO_Id, UT_Id, EC_MtDevise, EC_SoldeDevise, EC_ComptaEcart, EC_Ajuste, EC_EcartId, DO_CodeAffaire, DO_Reference,
               VM_VirementNo, EC_VirementNumero, EC_BanqueNo, EC_BanqueClient, EC_RibClient, EC_ComptaVirMasse, MV_RemboursementNo, EC_RemboursementNumero,
               EC_ComptaRemboursement, CQ_Id, EC_Point, EC_DatePoint, CA_Id, EC_Info1, EC_Info2, EC_Info3, EC_Info4, CT_Code, CT_Intitule, CT_PayeurCode, CT_PayeurIntitule,
               PT_Previsionnelle, EC_SPE, EC_Lock, EC_IsTimbre, EC_Timbre, EC_Comptabilise, REGAVR_NO, REGAVR_NUM, MV_RemboursementAVFNo, EC_DateCreation, EC_ExtraitNum,
               EC_EcheanceReporte, EC_DMP, EC_DdId, CR_Id, CR_Numero, EC_FileName, EC_File, EC_StautWorkflowFrs)
        OUTPUT INSERTED.EC_Id, INSERTED.EC_No, INSERTED.DO_Numero INTO #ins (EC_Id, EC_No, DO_Numero)
        SELECT c.DR_No, c.DO_Piece, c.DO_Type, 0, c.DO_Date, N'', 0,
               c.Montant, c.Montant, c.DR_Date, 0, c.Mode_Id, c.Ct_No, 1, @DeId,
               c.Ct_No, c.DO_Souche, c.CO_No, @SocieteNo, @UserNo, c.Montant, c.Montant,
               0, 0, NULL, c.CA_Num, c.DO_Ref,
               NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL,
               0, NULL, 0, '17530101', NULL, c.Depot_Intitule, c.DO_Coord02, c.DO_Coord03, c.DO_Coord04,
               c.Ct_Code, c.Ct_Intitule, c.Ct_Code, c.Ct_Intitule,
               0, 0, 0, 0, 0, 0, 0, NULL, NULL, @Now, N'',
               c.DR_Date, 0, NULL, NULL, NULL, NULL, 0x, 0
          FROM #cand c
         WHERE c.Action_ = 'CREER'
         ORDER BY c.DR_No;
        SET @n = @@ROWCOUNT;
        IF @n <> @NbIns THROW 50001, 'Nombre d''échéances créées différent du nombre attendu : annulation.', 1;

        -- journal (annulation) : échéances créées + lignes flaguées
        INSERT dbo.LOG_INTEGRATION_ECHEANCE_LIGNE (LI_Batch, LL_Action, EC_Id, DR_cbMarq, DR_No, DO_Piece, DO_Type, Montant)
        SELECT @Batch, 'CREE', i.EC_Id, c.DR_cbMarq, c.DR_No, c.DO_Piece, c.DO_Type, c.Montant
          FROM #ins i JOIN #cand c ON c.DR_No = i.EC_No AND c.DO_Piece = i.DO_Numero AND c.Action_ = 'CREER';
        INSERT dbo.LOG_INTEGRATION_ECHEANCE_LIGNE (LI_Batch, LL_Action, EC_Id, DR_cbMarq, DR_No, DO_Piece, DO_Type, Montant)
        SELECT @Batch, 'FLAGUE', NULL, c.DR_cbMarq, c.DR_No, c.DO_Piece, c.DO_Type, NULL
          FROM #cand c WHERE c.Action_ = 'FLAGUER';

        -- côté Sage : cbFlag = 1 (même UPDATE que DocumentRepository.Flagger, ciblé par cbMarq)
        UPDATE d SET cbFlag = 1
          FROM GOCOM.dbo.F_DOCREGL d
          JOIN #cand c ON c.DR_cbMarq = d.cbMarq AND c.Action_ IS NOT NULL
         WHERE d.cbFlag = 0;
        SET @n = @@ROWCOUNT;
        IF @n <> @NbIns + @NbFlag THROW 50002, 'Nombre de lignes F_DOCREGL passées à cbFlag = 1 différent du nombre attendu : annulation.', 1;

        -- contrôle final : montants identiques, toutes les lignes flaguées, aucun doublon de pièce parmi les échéances créées
        SELECT @OkMontants = COUNT(*)
          FROM #cand c JOIN #ins i ON i.EC_No = c.DR_No AND i.DO_Numero = c.DO_Piece
          JOIN GR_GOCOM.dbo.RT_ECHEANCE e ON e.EC_Id = i.EC_Id
         WHERE c.Action_ = 'CREER' AND e.EC_Montant = c.Montant AND e.EC_Solde = c.Montant;
        SELECT @OkFlags = COUNT(*)
          FROM GOCOM.dbo.F_DOCREGL d JOIN #cand c ON c.DR_cbMarq = d.cbMarq
         WHERE c.Action_ IS NOT NULL AND d.cbFlag = 1;
        SELECT @Doublons = COUNT(*)
          FROM (SELECT CAST(e.DO_Numero AS VARCHAR(30)) AS Piece FROM GR_GOCOM.dbo.RT_ECHEANCE e
                 WHERE e.SO_Id = @SocieteNo AND e.DO_Domaine = 0
                   AND EXISTS (SELECT 1 FROM #ins i WHERE i.DO_Numero = e.DO_Numero)
                 GROUP BY CAST(e.DO_Numero AS VARCHAR(30)) HAVING COUNT(*) > 1) x;
        IF (SELECT COUNT(*) FROM #ins) <> @NbIns OR @OkMontants <> @NbIns OR @OkFlags <> @NbIns + @NbFlag OR @Doublons <> 0
            THROW 50003, 'Contrôle final en échec : annulation.', 1;

        COMMIT;
        SET LOCK_TIMEOUT -1; SET DEADLOCK_PRIORITY NORMAL;

        UPDATE dbo.LOG_INTEGRATION_ECHEANCE SET LI_Statut = 'OK', LI_Lignes = @NbSrc, LI_Creees = @NbIns, LI_Montant = @MontantIns,
               LI_Flaguees = @NbFlag, LI_Ignorees = @NbIgn, LI_Bloquees = @NbBlo, LI_DureeMs = DATEDIFF(MILLISECOND, @T0, SYSDATETIME())
         WHERE LI_Id = @LiId;
        -- purge des journaux : exécutions sans effet > 30 jours, le reste > 365 jours
        DELETE TOP (1000) FROM dbo.LOG_INTEGRATION_ECHEANCE WHERE (LI_Statut = 'RIEN' AND LI_Debut < DATEADD(DAY, -30, GETDATE())) OR LI_Debut < DATEADD(DAY, -365, GETDATE());
        DELETE TOP (1000) FROM dbo.LOG_INTEGRATION_ECHEANCE_LIGNE WHERE LL_Date < DATEADD(DAY, -365, GETDATE());

        SELECT 'RESUME' AS Section, 'OK' AS Statut, @NbSrc AS Lignes, @NbIns AS Creees, @MontantIns AS Montant, @NbFlag AS Flaguees, @NbIgn AS Ignorees, @NbBlo AS Bloquees,
               CONVERT(VARCHAR(36), @Batch) AS BatchId;
    END TRY
    BEGIN CATCH
        DECLARE @Err INT = ERROR_NUMBER(), @Msg NVARCHAR(2000) = LEFT(ERROR_MESSAGE(), 2000);
        IF @@TRANCOUNT > 0 ROLLBACK;
        SET LOCK_TIMEOUT -1; SET DEADLOCK_PRIORITY NORMAL;
        IF @LiId IS NOT NULL
            UPDATE dbo.LOG_INTEGRATION_ECHEANCE
               SET LI_Statut = CASE WHEN @Err IN (1222, 1205) THEN 'VERROU_NON_OBTENU' WHEN @Err = 50004 THEN 'PLAFOND_DEPASSE' ELSE 'ERREUR' END,
                   LI_Lignes = @NbSrc, LI_Message = @Msg, LI_DureeMs = DATEDIFF(MILLISECOND, @T0, SYSDATETIME())
             WHERE LI_Id = @LiId;
        IF @Err IN (1222, 1205)
        BEGIN
            PRINT CONCAT('Verrou non obtenu (erreur ', @Err, ') : cycle sauté, repris au prochain passage.');
            RETURN;
        END;
        THROW;
    END CATCH
END
GO

/*
  UNDO d'un lot — remplacer @Batch par le LI_Batch du journal (SELECT LI_Batch, LI_Debut, LI_Creees FROM dbo.LOG_INTEGRATION_ECHEANCE ORDER BY LI_Id DESC).
  Supprime QUE les échéances encore intactes (non réglées, aucune affectation) et remet cbFlag = 0 sur les lignes dont l'échéance a disparu
  (et sur les lignes simplement flaguées par ce lot). Une échéance déjà utilisée est laissée en place, son cbFlag reste à 1.

  DECLARE @Batch UNIQUEIDENTIFIER = '00000000-0000-0000-0000-000000000000';
  BEGIN TRAN;
  DELETE e FROM GR_GOCOM.dbo.RT_ECHEANCE e WITH (TABLOCKX)
    JOIN GR_GOCOM.dbo.LOG_INTEGRATION_ECHEANCE_LIGNE b ON b.EC_Id = e.EC_Id AND b.LI_Batch = @Batch AND b.LL_Action = 'CREE'
   WHERE e.EC_Solde = e.EC_Montant AND e.EC_Type = 0
     AND NOT EXISTS (SELECT 1 FROM GR_GOCOM.dbo.RT_AFFECTATION a WHERE a.EC_Id = e.EC_Id OR a.AF_EcId = e.EC_Id);
  SELECT @@ROWCOUNT AS EcheancesSupprimees;
  UPDATE d SET cbFlag = 0
    FROM GOCOM.dbo.F_DOCREGL d JOIN GR_GOCOM.dbo.LOG_INTEGRATION_ECHEANCE_LIGNE b ON b.DR_cbMarq = d.cbMarq AND b.LI_Batch = @Batch
   WHERE b.LL_Action = 'FLAGUE' OR NOT EXISTS (SELECT 1 FROM GR_GOCOM.dbo.RT_ECHEANCE x WHERE x.EC_Id = b.EC_Id);
  SELECT @@ROWCOUNT AS FlagsRemisA0;
  COMMIT;   -- ou ROLLBACK
*/
