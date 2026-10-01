/*
  INTÉGRATION en SQL des factures clientes Sage -> échéances GRC (RT_ECHEANCE), à la place de l'écran d'import (trop lent).
  Équivalent SQL de la DLL GRC : ErpDocumentService.Integrer -> SocieteManager.EcheanceCreate (Tresorerie.*.dll),
  lecture Sage : SageService.GetAllEcheances / DocumentRepository (liste = lignes F_DOCREGL de cbFlag = 0), puis
  SageService.ValiderDocument -> DocumentRepository.Flagger (cbFlag = 1).

  PÉRIMÈTRE (demande PO) : uniquement les factures dont le dépôt est dans GOCOM.dbo.FG_DEPOTFACTURATION :
      F_DOCENTETE.DE_No = F_DEPOT.DE_No  puis  F_DEPOT.cbMarq = FG_DEPOTFACTURATION.DP_Id   (paramètre @FiltrerDepotsFacturation)
  + période sur la date de la facture (@DateDu / @DateAu) + types 6 (facture) et 7 (facture comptabilisée, si
  P_SOCIETE.SO_ImportComptabiliseeClt = 1).

  Ce que fait la DLL, repris ici ligne par ligne (une échéance par ligne F_DOCREGL à cbFlag = 0 et montant <> 0) :
   - EC_No = DR_No ; pièce, type, date = F_DOCENTETE ; échéance = DR_Date ;
   - MONTANT = montant TTC de la facture (ligne d'équilibre) = SOMME(F_DOCLIGNE.DL_MontantTTC) des lignes valorisées
     (DL_Valorise = 1, comme la DLL), arrondi aux décimales de la devise Sage ; EC_Solde = EC_Montant.
     Vérifié : identique au montant stocké sur 30 000 échéances existantes (dont 10 000 factures de plus d'une ligne) ;
   - mode de règlement = P_SOCIETEMODEREGLEMENT (SM_No = F_DOCREGL.N_Reglement -> MR_Id, premier SM_Id) — vérifié sur
     36 000 échéances ; devise = P_SOCIETEDEVISE ;
   - client = F_COMPTET (CT_No = cbMarq, code, intitulé) ; le PAYEUR est le client (la DLL passe le client comme payeur) ;
   - souche = DO_Souche, collaborateur = CO_No, référence = DO_Ref, affaire = CA_Num ;
   - infos : info 1 = intitulé du DÉPÔT, infos 2 à 4 = DO_Coord02 à 04 (voir « JOB » ci-dessous) ;
   - valeurs initiales de l'échéance : non réglée, EC_DMP = 0, non comptabilisée, report = date d'échéance ;
   - puis cbFlag = 1 sur la ligne F_DOCREGL (même UPDATE que Flagger).

  JOB SQL AGENT « GR Job Reglement Inwi » (+ « Planification Instantanée », toutes les 10 s de 8 h à 18 h) — il écrit AUSSI :
   - il force EC_Info1 = F_DEPOT.DE_Intitule sur toutes les échéances (d'où info 1 = dépôt ici) ;
   - il insère les échéances des factures issues des commandes Beweb (hors dépôts Samsung) : aucune des factures du
     périmètre n'est dans ces commandes, mais le script se protège quand même (voir PROTECTION) ;
   - il passe cbFlag = 1 et DO_Valide = 1 pour tout document qui a une échéance.
  PROTECTION (application) : verrou exclusif de RT_ECHEANCE pendant tout l'ajout (le job attend), puis revérification SOUS
  verrou (échéance déjà créée pour la pièce, ligne déjà flaguée) avant d'insérer : aucun doublon possible avec le job ;
  priorité de deadlock haute (en cas d'interblocage, c'est le job qui est relancé 10 s plus tard).

  Cas ignorés (comptés, jamais insérés) : hors dépôts de facturation, montant TTC nul (comme la DLL), échéance déjà présente
  pour la pièce dans la GRC (comme le job ; la DLL lèverait « échéance existe »).
  Cas BLOQUÉS (à traiter dans l'écran GRC) : facture à plusieurs échéances ou échéance à pourcentage, escompte / frais /
  écart / taxes d'en-tête, devise étrangère, mode non mappé ou en sommeil, client introuvable, facture non validée
  (DO_Valide = 0 : le job la validerait d'office dès qu'elle a une échéance ; @ExclureNonValidees).

  Limites : ne notifie pas les écrans GRC ouverts ; ne teste pas les droits utilisateur / souche (la DLL le fait) ;
  ne fonctionne qu'avec SO_UseObjetMetier = 0 (sinon la DLL recalcule via les objets métiers : le script s'arrête) ;
  ne touche ni F_DOCENTETE ni F_DOCREGL.DR_Regle (la DLL non plus) ; ne pas lancer l'import de l'écran GRC en même temps.
  Bases : GR_GOCOM = GRC (RT_*, P_*) ; GOCOM = gestion commerciale Sage (F_DOCREGL, F_DOCENTETE, F_DOCLIGNE, F_COMPTET,
          F_DEPOT, FG_DEPOTFACTURATION) = P_SOCIETE.SO_ErpDb. Autre environnement : rechercher/remplacer ces deux noms
          (GR_GOCOM d'abord, puis GOCOM).
  Transaction unique (même instance : pas de MSDTC) ; contrôle des nombres de lignes ; plafond @MaxEcheances ; journal
  d'annulation BAK_IM_<lot> (base GRC). Sauvegarde de GR_GOCOM ET GOCOM OBLIGATOIRE avant @Apply = 1.
  Usage : 1) renseigner @SocieteNo, @UserNo et la période ; 2) @Apply = 0 et lire les résultats ; 3) premier essai sur UNE
          facture avec @DoNumero ; 4) puis @Apply = 1 sans @DoNumero.
  Annulation : bloc UNDO en fin de fichier.
*/
-- Nettoyage des tables temporaires d'une exécution précédente dans la même fenêtre SSMS (lot séparé).
IF OBJECT_ID('tempdb..#src')   IS NOT NULL DROP TABLE #src;
IF OBJECT_ID('tempdb..#ttc')   IS NOT NULL DROP TABLE #ttc;
IF OBJECT_ID('tempdb..#grc')   IS NOT NULL DROP TABLE #grc;
IF OBJECT_ID('tempdb..#cand')  IS NOT NULL DROP TABLE #cand;
IF OBJECT_ID('tempdb..#ins')   IS NOT NULL DROP TABLE #ins;
GO
SET NOCOUNT ON;
SET XACT_ABORT ON;

------------------------------------------------------------------------------------------ PARAMÈTRES
DECLARE @SocieteNo     INT  = 1;            -- RT_ECHEANCE.SO_Id — OBLIGATOIRE
DECLARE @Apply         BIT  = 0;            -- 0 = aperçu, 1 = INSÈRE les échéances + cbFlag = 1
DECLARE @UserNo        INT  = 1;            -- RT_ECHEANCE.UT_Id : utilisateur GRC qui « fait » l'import (1 = majorité des échéances existantes)
DECLARE @DateDu        DATE = '20250101';   -- date de la FACTURE (inclus) ; NULL = pas de borne
DECLARE @DateAu        DATE = '20260731';   -- date de la FACTURE (inclus) ; NULL = pas de borne
DECLARE @FiltrerDepotsFacturation BIT = 1;  -- 1 = seulement les dépôts de FG_DEPOTFACTURATION ; 0 = tous les dépôts
DECLARE @ExclureNonValidees BIT = 1;        -- 1 = bloque les factures DO_Valide = 0
DECLARE @DoNumero      VARCHAR(13) = NULL;  -- optionnel : une seule facture (pour un premier essai)
DECLARE @MaxEcheances  INT  = 40000;        -- garde-fou : refuse d'appliquer au-delà

DECLARE @Batch UNIQUEIDENTIFIER = NEWID();
IF @SocieteNo <= 0 BEGIN RAISERROR('Renseigner @SocieteNo.', 16, 1); RETURN; END

------------------------------------------------------------------------------------------ 0. COHÉRENCE SOCIÉTÉ <-> BASE SAGE, DEVISE
DECLARE @ErpDb NVARCHAR(256), @ErpServer NVARCHAR(256), @ComptaDb SYSNAME, @UseOm BIT, @DeviseErpNo INT, @ImportCompta BIT;
SELECT @ErpDb = SO_ErpDb, @ErpServer = SO_ErpServer, @UseOm = SO_UseObjetMetier, @DeviseErpNo = SO_DeviseErpNo, @ImportCompta = ISNULL(SO_ImportComptabiliseeClt, 0)
FROM GR_GOCOM.dbo.P_SOCIETE WHERE SO_Id = @SocieteNo;
IF @ErpDb IS NULL BEGIN RAISERROR('Société %d introuvable dans P_SOCIETE.', 16, 1, @SocieteNo); RETURN; END
EXEC GOCOM.sys.sp_executesql N'SELECT @n = DB_NAME()', N'@n SYSNAME OUTPUT', @n = @ComptaDb OUTPUT;
IF @ErpDb <> @ComptaDb BEGIN RAISERROR('SO_ErpDb de la société %d = [%s] mais le script cible la base [%s].', 16, 1, @SocieteNo, @ErpDb, @ComptaDb); RETURN; END
IF @UseOm = 1 BEGIN RAISERROR('SO_UseObjetMetier = 1 : la DLL recalcule les montants via les objets métiers, ce script ne les reproduit pas. Utiliser l''écran GRC.', 16, 1); RETURN; END

DECLARE @DeviseDossier INT = (SELECT N_DeviseCompte FROM GOCOM.dbo.P_DOSSIER WHERE cbMarq = 1);   -- devise de tenue de la gestion commerciale
IF @DeviseDossier IS NULL OR @DeviseDossier <> @DeviseErpNo
   BEGIN RAISERROR('Devise du dossier Sage (%d) <> P_SOCIETE.SO_DeviseErpNo (%d) : script non prévu pour ce cas.', 16, 1, @DeviseDossier, @DeviseErpNo); RETURN; END
IF NOT EXISTS (SELECT 1 FROM GR_GOCOM.dbo.P_SOCIETEDEVISE WHERE SO_Id = @SocieteNo AND SD_No = @DeviseErpNo)
   BEGIN RAISERROR('Devise Sage %d non mappée dans P_SOCIETEDEVISE pour la société %d.', 16, 1, @DeviseErpNo, @SocieteNo); RETURN; END
DECLARE @DeId INT = (SELECT TOP 1 DV_Id FROM GR_GOCOM.dbo.P_SOCIETEDEVISE WHERE SO_Id = @SocieteNo AND SD_No = @DeviseErpNo ORDER BY SD_Id);   -- DE_Id des échéances
-- Décimales de la devise = celles du format Sage (ex. '# ##0,00' -> 2), comme la DLL (GetNombreDecimales).
DECLARE @Format VARCHAR(60) = (SELECT TOP 1 RTRIM(D_Format) FROM GOCOM.dbo.P_DEVISE WHERE cbIndice = @DeviseDossier);
DECLARE @Dec INT = CASE WHEN CHARINDEX(',', @Format) > 0 THEN LEN(@Format) - CHARINDEX(',', @Format)
                        WHEN CHARINDEX('.', @Format) > 0 THEN LEN(@Format) - CHARINDEX('.', @Format) ELSE 0 END;
IF @Format IS NULL OR @Dec NOT BETWEEN 0 AND 4 BEGIN RAISERROR('Format de la devise Sage %d illisible ([%s]).', 16, 1, @DeviseDossier, @Format); RETURN; END
PRINT CONCAT('Société ', @SocieteNo, ' -> Sage ', @ErpServer, ' / ', @ErpDb, ' ; script exécuté sur ', @@SERVERNAME, ' (vérifier que c''est le même serveur) ; devise ', @DeviseDossier, ', ', @Dec, ' décimales.');

------------------------------------------------------------------------------------------ 1. LIGNES SAGE À INTÉGRER (F_DOCREGL cbFlag = 0)
-- Types : 6 = facture, 7 = facture comptabilisée (importée seulement si SO_ImportComptabiliseeClt = 1).
-- La DLL liste les documents (F_DOCENTETE) : jointure interne, une ligne sans en-tête n'existe pas pour elle.
SELECT d.cbMarq AS DR_cbMarq, d.DR_No, d.DO_Piece, d.DO_Type, d.DR_Date, d.DR_Pourcent, d.DR_Equil, d.N_Reglement, d.DR_Regle,
       h.DO_Date, h.DO_Tiers, h.DO_Devise, h.DO_Souche, h.CO_No, h.CA_Num, h.DO_Ref,
       h.DE_No, h.DO_Coord02, h.DO_Coord03, h.DO_Coord04, h.DO_Valide, h.DO_TotalTTC,
       h.DO_TxEscompte, h.DO_ValFrais, h.DO_Ecart, h.DO_Taxe1, h.DO_Taxe2, h.DO_Taxe3,
       CASE WHEN EXISTS (SELECT 1 FROM GOCOM.dbo.F_DEPOT dp
                          JOIN GOCOM.dbo.FG_DEPOTFACTURATION fg ON fg.DP_Id = dp.cbMarq
                         WHERE dp.DE_No = h.DE_No) THEN 1 ELSE 0 END AS DansDepots,
       (SELECT COUNT(*) FROM GOCOM.dbo.F_DOCREGL x WHERE x.DO_Piece = d.DO_Piece AND x.DO_Domaine = 0 AND x.DO_Type IN (6, 7)) AS NbLignes
INTO #src
FROM GOCOM.dbo.F_DOCREGL d
JOIN GOCOM.dbo.F_DOCENTETE h ON h.DO_Domaine = d.DO_Domaine AND h.DO_Type = d.DO_Type AND h.DO_Piece = d.DO_Piece
WHERE d.DO_Domaine = 0
  AND (d.DO_Type = 6 OR (d.DO_Type = 7 AND @ImportCompta = 1))
  AND d.cbFlag = 0
  AND (@DoNumero IS NULL OR d.DO_Piece = @DoNumero)
  AND (@DateDu   IS NULL OR h.DO_Date >= @DateDu)
  AND (@DateAu   IS NULL OR h.DO_Date <  DATEADD(DAY, 1, @DateAu));
CREATE CLUSTERED INDEX IX_src ON #src (DO_Type, DO_Piece);

-- Montant TTC de chaque facture du périmètre = somme des lignes valorisées (une seule passe sur F_DOCLIGNE).
SELECT l.DO_Type, l.DO_Piece, SUM(l.DL_MontantTTC) AS SumTTC
INTO #ttc
FROM GOCOM.dbo.F_DOCLIGNE l
JOIN (SELECT DISTINCT DO_Type, DO_Piece FROM #src WHERE @FiltrerDepotsFacturation = 0 OR DansDepots = 1) s
  ON s.DO_Type = l.DO_Type AND s.DO_Piece = l.DO_Piece
WHERE l.DO_Domaine = 0 AND l.DL_Valorise = 1
GROUP BY l.DO_Type, l.DO_Piece;
CREATE CLUSTERED INDEX IX_ttc ON #ttc (DO_Type, DO_Piece);

-- Pièces déjà présentes dans la GRC (toute échéance, quel que soit le DR_No : même règle que le job).
SELECT CAST(e.DO_Numero AS VARCHAR(30)) COLLATE DATABASE_DEFAULT AS DO_Numero, e.EC_No
INTO #grc
FROM GR_GOCOM.dbo.RT_ECHEANCE e
WHERE e.SO_Id = @SocieteNo AND e.DO_Domaine = 0;
CREATE CLUSTERED INDEX IX_grc ON #grc (DO_Numero, EC_No);

------------------------------------------------------------------------------------------ 2. VALEURS CALCULÉES + MOTIF D'IGNORANCE / DE BLOCAGE
SELECT s.*, ROUND(ISNULL(t.SumTTC, 0), @Dec) AS Montant,
       c.cbMarq AS Ct_No, c.CT_Num AS Ct_Code, c.CT_Intitule AS Ct_Intitule,
       mr.MR_Id AS Mode_Id, mr.MR_Sommeil, ISNULL(dp.DE_Intitule, '') AS Depot_Intitule
INTO #cand
FROM #src s
LEFT JOIN #ttc t ON t.DO_Type = s.DO_Type AND t.DO_Piece = s.DO_Piece
LEFT JOIN GOCOM.dbo.F_COMPTET c ON c.CT_Num = s.DO_Tiers AND c.CT_Type = 0          -- la DLL ne charge que les tiers de type client
LEFT JOIN GOCOM.dbo.F_DEPOT dp ON dp.DE_No = s.DE_No
OUTER APPLY (SELECT TOP 1 m.MR_Id, mm.MR_Sommeil FROM GR_GOCOM.dbo.P_SOCIETEMODEREGLEMENT m
               JOIN GR_GOCOM.dbo.P_MODEREGLEMENT mm ON mm.MR_Id = m.MR_Id
              WHERE m.SO_Id = @SocieteNo AND m.SM_No = s.N_Reglement ORDER BY m.SM_Id) mr;
CREATE UNIQUE CLUSTERED INDEX IX_cand ON #cand (DR_cbMarq);

ALTER TABLE #cand ADD Blocage VARCHAR(40) NULL, Ignore_ VARCHAR(40) NULL;
-- ignorées (aucune erreur côté GRC) :
UPDATE #cand SET Ignore_ = 'HORS_DEPOTS_FACTURATION' WHERE @FiltrerDepotsFacturation = 1 AND DansDepots = 0;
UPDATE #cand SET Ignore_ = 'MONTANT_NUL' WHERE Ignore_ IS NULL AND Montant = 0;                -- la DLL ne retient que Montant <> 0
UPDATE c SET Ignore_ = 'DEJA_EN_GRC' FROM #cand c WHERE Ignore_ IS NULL AND EXISTS (SELECT 1 FROM #grc g WHERE g.DO_Numero = c.DO_Piece COLLATE DATABASE_DEFAULT AND g.EC_No = c.DR_No);
UPDATE c SET Ignore_ = 'DEJA_EN_GRC_AUTRE_DR_NO' FROM #cand c WHERE Ignore_ IS NULL AND EXISTS (SELECT 1 FROM #grc g WHERE g.DO_Numero = c.DO_Piece COLLATE DATABASE_DEFAULT);
-- bloquées : la DLL ferait autrement ou lèverait une erreur
UPDATE #cand SET Blocage =
       CASE WHEN NbLignes <> 1 OR DR_Equil <> 1 OR DR_Pourcent <> 0                      THEN 'ECHEANCES_MULTIPLES_OU_POURCENT'
            WHEN DO_TxEscompte <> 0 OR DO_ValFrais <> 0 OR DO_Ecart <> 0 OR DO_Taxe1 <> 0 OR DO_Taxe2 <> 0 OR DO_Taxe3 <> 0 THEN 'MONTANT_COMPLEXE'
            WHEN DO_Devise NOT IN (0, @DeviseDossier)                                    THEN 'DEVISE_ETRANGERE'
            WHEN Ct_No IS NULL                                                           THEN 'CLIENT_INTROUVABLE'
            WHEN Mode_Id IS NULL                                                         THEN 'MODE_NON_MAPPE'
            WHEN ISNULL(MR_Sommeil, 0) <> 0                                              THEN 'MODE_EN_SOMMEIL'
            WHEN @ExclureNonValidees = 1 AND ISNULL(DO_Valide, 0) = 0                    THEN 'FACTURE_NON_VALIDEE'
            ELSE NULL END
WHERE Ignore_ IS NULL;

DECLARE @NbIns INT = (SELECT COUNT(*) FROM #cand WHERE Ignore_ IS NULL AND Blocage IS NULL);
DECLARE @NbInsApercu INT = @NbIns;

------------------------------------------------------------------------------------------ RÉSULTATS (aperçu)
SELECT 'RESUME' AS Section,
       (SELECT COUNT(*) FROM #cand)                                             AS LignesSageFlag0,
       @NbIns                                                                   AS EcheancesACreer,
       (SELECT ISNULL(SUM(Montant), 0) FROM #cand WHERE Ignore_ IS NULL AND Blocage IS NULL) AS MontantTotal,
       (SELECT COUNT(*) FROM #cand WHERE Ignore_ IS NOT NULL)                   AS Ignorees,
       (SELECT COUNT(*) FROM #cand WHERE Blocage IS NOT NULL)                   AS Bloquees,
       (SELECT MIN(DO_Date) FROM #cand WHERE Ignore_ IS NULL AND Blocage IS NULL) AS DateMin,
       (SELECT MAX(DO_Date) FROM #cand WHERE Ignore_ IS NULL AND Blocage IS NULL) AS DateMax;

SELECT 'IGNOREE_PAR_MOTIF' AS Section, Ignore_ AS Motif, COUNT(*) AS Lignes FROM #cand WHERE Ignore_ IS NOT NULL GROUP BY Ignore_ ORDER BY COUNT(*) DESC;
SELECT 'BLOQUE_PAR_MOTIF' AS Section, Blocage, COUNT(*) AS Lignes, SUM(Montant) AS Montant FROM #cand WHERE Blocage IS NOT NULL GROUP BY Blocage ORDER BY COUNT(*) DESC;
SELECT TOP 200 'BLOQUE' AS Section, Blocage, DR_No, DO_Piece, DO_Type, DO_Date, Montant FROM #cand WHERE Blocage IS NOT NULL ORDER BY Blocage, DR_No;
SELECT TOP 200 'DEJA_EN_GRC' AS Section, Ignore_ AS Motif, DR_No, DO_Piece, DO_Type, DO_Date, Montant FROM #cand WHERE Ignore_ IN ('DEJA_EN_GRC', 'DEJA_EN_GRC_AUTRE_DR_NO') ORDER BY Ignore_, DR_No;
SELECT 'PAR_MOIS' AS Section, FORMAT(DO_Date, 'yyyy-MM') AS Mois, COUNT(*) AS Echeances, SUM(Montant) AS Montant
FROM #cand WHERE Ignore_ IS NULL AND Blocage IS NULL GROUP BY FORMAT(DO_Date, 'yyyy-MM') ORDER BY 2;
SELECT 'PAR_DEPOT' AS Section, Depot_Intitule AS Depot, COUNT(*) AS Echeances, SUM(Montant) AS Montant
FROM #cand WHERE Ignore_ IS NULL AND Blocage IS NULL GROUP BY Depot_Intitule ORDER BY COUNT(*) DESC;
-- Informations (non bloquantes)
SELECT 'INFO_SAGE_DEJA_REGLE' AS Section, COUNT(*) AS Lignes FROM #cand WHERE Ignore_ IS NULL AND Blocage IS NULL AND DR_Regle = 1;
SELECT 'INFO_MONTANT_NEGATIF' AS Section, DR_No, DO_Piece, DO_Type, DO_Date, Montant FROM #cand WHERE Ignore_ IS NULL AND Blocage IS NULL AND Montant < 0 ORDER BY DO_Piece;
-- le montant retenu est celui des LIGNES (comme la DLL) ; l'en-tête F_DOCENTETE.DO_TotalTTC (utilisé par le job SQL) peut différer
SELECT 'INFO_ECART_ENTETE_LIGNES' AS Section, DR_No, DO_Piece, DO_Type, Montant AS MontantLignes, DO_TotalTTC AS MontantEntete
FROM #cand WHERE Ignore_ IS NULL AND Blocage IS NULL AND (ISNULL(DO_TotalTTC, 0) = 0 OR ABS(DO_TotalTTC - Montant) > 0.011) ORDER BY DO_Piece;
SELECT TOP 20 'EXEMPLES' AS Section, DR_No, DO_Piece, DO_Type, DO_Date, DR_Date, Montant, Ct_Code, Mode_Id, Depot_Intitule FROM #cand WHERE Ignore_ IS NULL AND Blocage IS NULL ORDER BY DR_No;

------------------------------------------------------------------------------------------ APPLICATION
IF @Apply <> 1 BEGIN PRINT 'Aperçu uniquement (@Apply = 0). Rien n''a été modifié.'; RETURN; END
IF @NbIns = 0 BEGIN PRINT 'Rien à intégrer.'; RETURN; END
IF @NbIns > @MaxEcheances BEGIN RAISERROR('Abandon : %d échéances > @MaxEcheances (%d).', 16, 1, @NbIns, @MaxEcheances); RETURN; END
IF NOT EXISTS (SELECT 1 FROM GR_GOCOM.dbo.P_UTILISATEUR WHERE UT_Id = @UserNo) BEGIN RAISERROR('@UserNo = %d : utilisateur GRC inconnu.', 16, 1, @UserNo); RETURN; END

DECLARE @Suffixe VARCHAR(12) = LEFT(REPLACE(CONVERT(VARCHAR(36), @Batch), '-', ''), 12);
DECLARE @BakIm SYSNAME = 'BAK_IM_' + @Suffixe, @sql NVARCHAR(MAX), @n INT, @Verrou INT, @Now DATETIME = GETDATE();
DECLARE @OkMontants INT, @OkFlags INT, @Doublons INT;

CREATE TABLE #ins (EC_Id INT, EC_No INT, DO_Numero VARCHAR(13));
CREATE CLUSTERED INDEX IX_ins ON #ins (EC_No, DO_Numero);

SET LOCK_TIMEOUT 60000;            -- n'attend pas plus d'une minute un verrou (le job SQL Agent est rapide : 0 à 2 s)
SET DEADLOCK_PRIORITY HIGH;        -- en cas d'interblocage avec le job, c'est le job qui est relancé, pas ce script

BEGIN TRY
    BEGIN TRAN;

    -- 0. verrou exclusif de RT_ECHEANCE jusqu'au COMMIT : le job SQL Agent y écrit aussi (insertion + info 1)
    SELECT @Verrou = COUNT(*) FROM GR_GOCOM.dbo.RT_ECHEANCE WITH (TABLOCKX, HOLDLOCK);

    -- 1. revérification SOUS verrou (le job ou l'écran GRC ont pu travailler depuis l'aperçu)
    TRUNCATE TABLE #grc;
    INSERT #grc (DO_Numero, EC_No)
    SELECT CAST(e.DO_Numero AS VARCHAR(30)) COLLATE DATABASE_DEFAULT, e.EC_No FROM GR_GOCOM.dbo.RT_ECHEANCE e WHERE e.SO_Id = @SocieteNo AND e.DO_Domaine = 0;
    UPDATE c SET Ignore_ = 'DEJA_EN_GRC' FROM #cand c
     WHERE c.Ignore_ IS NULL AND c.Blocage IS NULL AND EXISTS (SELECT 1 FROM #grc g WHERE g.DO_Numero = c.DO_Piece COLLATE DATABASE_DEFAULT);
    UPDATE c SET Ignore_ = 'DEJA_FLAGUEE_SAGE' FROM #cand c JOIN GOCOM.dbo.F_DOCREGL d ON d.cbMarq = c.DR_cbMarq
     WHERE c.Ignore_ IS NULL AND c.Blocage IS NULL AND d.cbFlag <> 0;
    SET @NbIns = (SELECT COUNT(*) FROM #cand WHERE Ignore_ IS NULL AND Blocage IS NULL);
    PRINT CONCAT('Échéances à créer : ', @NbInsApercu, ' à l''aperçu, ', @NbIns, ' sous verrou.');
    IF @NbIns = 0 BEGIN ROLLBACK; SET LOCK_TIMEOUT -1; SET DEADLOCK_PRIORITY NORMAL; PRINT 'Rien à intégrer (tout a été traité entre-temps).'; RETURN; END
    IF @NbIns > @MaxEcheances THROW 50004, 'Plus d''échéances que @MaxEcheances : annulation.', 1;

    -- 2. création des échéances (valeurs initiales identiques à celles de EcheanceCreate)
    INSERT GR_GOCOM.dbo.RT_ECHEANCE
          (EC_No, DO_Numero, DO_Type, DO_Domaine, DO_Date, EC_Commentaire, EC_Etat, EC_Montant, EC_Solde, EC_Echeance, EC_Type, MR_Id, CT_No, EC_Cours, DE_Id,
           CT_PayeurNo, EC_Souche, DO_Collaborateur, SO_Id, UT_Id, EC_MtDevise, EC_SoldeDevise, EC_ComptaEcart, EC_Ajuste, EC_EcartId, DO_CodeAffaire, DO_Reference,
           VM_VirementNo, EC_VirementNumero, EC_BanqueNo, EC_BanqueClient, EC_RibClient, EC_ComptaVirMasse, MV_RemboursementNo, EC_RemboursementNumero,
           EC_ComptaRemboursement, CQ_Id, EC_Point, EC_DatePoint, CA_Id, EC_Info1, EC_Info2, EC_Info3, EC_Info4, CT_Code, CT_Intitule, CT_PayeurCode, CT_PayeurIntitule,
           PT_Previsionnelle, EC_SPE, EC_Lock, EC_IsTimbre, EC_Timbre, EC_Comptabilise, REGAVR_NO, REGAVR_NUM, MV_RemboursementAVFNo, EC_DateCreation, EC_ExtraitNum,
           EC_EcheanceReporte, EC_DMP, EC_DdId, CR_Id, CR_Numero, EC_FileName, EC_File, EC_StautWorkflowFrs)
    OUTPUT INSERTED.EC_Id, INSERTED.EC_No, INSERTED.DO_Numero INTO #ins (EC_Id, EC_No, DO_Numero)
    SELECT c.DR_No AS EC_No, c.DO_Piece AS DO_Numero, c.DO_Type AS DO_Type, 0 AS DO_Domaine, c.DO_Date AS DO_Date, N'' AS EC_Commentaire, 0 AS EC_Etat,
           c.Montant AS EC_Montant, c.Montant AS EC_Solde, c.DR_Date AS EC_Echeance, 0 AS EC_Type, c.Mode_Id AS MR_Id, c.Ct_No AS CT_No, 1 AS EC_Cours, @DeId AS DE_Id,
           c.Ct_No AS CT_PayeurNo, c.DO_Souche AS EC_Souche, c.CO_No AS DO_Collaborateur, @SocieteNo AS SO_Id, @UserNo AS UT_Id, c.Montant AS EC_MtDevise, c.Montant AS EC_SoldeDevise,
           0 AS EC_ComptaEcart, 0 AS EC_Ajuste, NULL AS EC_EcartId, c.CA_Num AS DO_CodeAffaire, c.DO_Ref AS DO_Reference,
           NULL AS VM_VirementNo, NULL AS EC_VirementNumero, NULL AS EC_BanqueNo, NULL AS EC_BanqueClient, NULL AS EC_RibClient, 0 AS EC_ComptaVirMasse, NULL AS MV_RemboursementNo, NULL AS EC_RemboursementNumero,
           0 AS EC_ComptaRemboursement, NULL AS CQ_Id, 0 AS EC_Point, '17530101' AS EC_DatePoint, NULL AS CA_Id, c.Depot_Intitule AS EC_Info1, c.DO_Coord02 AS EC_Info2, c.DO_Coord03 AS EC_Info3, c.DO_Coord04 AS EC_Info4,
           c.Ct_Code AS CT_Code, c.Ct_Intitule AS CT_Intitule, c.Ct_Code AS CT_PayeurCode, c.Ct_Intitule AS CT_PayeurIntitule,
           0 AS PT_Previsionnelle, 0 AS EC_SPE, 0 AS EC_Lock, 0 AS EC_IsTimbre, 0 AS EC_Timbre, 0 AS EC_Comptabilise, 0 AS REGAVR_NO, NULL AS REGAVR_NUM, NULL AS MV_RemboursementAVFNo, @Now AS EC_DateCreation, N'' AS EC_ExtraitNum,
           c.DR_Date AS EC_EcheanceReporte, 0 AS EC_DMP, NULL AS EC_DdId, NULL AS CR_Id, NULL AS CR_Numero, NULL AS EC_FileName, 0x AS EC_File, 0 AS EC_StautWorkflowFrs
    FROM #cand c
    WHERE c.Ignore_ IS NULL AND c.Blocage IS NULL
    ORDER BY c.DR_No;
    SET @n = @@ROWCOUNT;
    IF @n <> @NbIns THROW 50001, 'Nombre d''échéances créées différent du nombre attendu : annulation.', 1;

    -- 3. journal d'annulation : EC_Id créés + ligne Sage correspondante
    SET @sql = N'SELECT i.EC_Id, c.DR_cbMarq, c.DR_No, c.DO_Piece, c.DO_Type, c.Montant INTO GR_GOCOM.dbo.' + QUOTENAME(@BakIm)
             + N' FROM #ins i JOIN #cand c ON c.DR_No = i.EC_No AND c.DO_Piece = i.DO_Numero WHERE c.Ignore_ IS NULL AND c.Blocage IS NULL;';
    EXEC (@sql);

    -- 4. côté Sage : cbFlag = 1 (même UPDATE que DocumentRepository.Flagger, ciblé par cbMarq)
    UPDATE d SET cbFlag = 1
    FROM GOCOM.dbo.F_DOCREGL d
    JOIN #cand c ON c.DR_cbMarq = d.cbMarq AND c.Ignore_ IS NULL AND c.Blocage IS NULL
    WHERE d.cbFlag = 0;
    SET @n = @@ROWCOUNT;
    IF @n <> @NbIns THROW 50002, 'Nombre de lignes F_DOCREGL passées à cbFlag = 1 différent du nombre attendu : annulation.', 1;

    -- 5. contrôle final (requêtes ensemblistes) : une échéance par ligne, montants identiques, toutes les lignes flaguées,
    --    aucun doublon de pièce parmi les échéances qui viennent d'être créées
    SELECT @OkMontants = COUNT(*)
      FROM #cand c
      JOIN #ins i ON i.EC_No = c.DR_No AND i.DO_Numero = c.DO_Piece
      JOIN GR_GOCOM.dbo.RT_ECHEANCE e ON e.EC_Id = i.EC_Id
     WHERE c.Ignore_ IS NULL AND c.Blocage IS NULL AND e.EC_Montant = c.Montant AND e.EC_Solde = c.Montant;
    SELECT @OkFlags = COUNT(*)
      FROM GOCOM.dbo.F_DOCREGL d JOIN #cand c ON c.DR_cbMarq = d.cbMarq
     WHERE c.Ignore_ IS NULL AND c.Blocage IS NULL AND d.cbFlag = 1;
    SELECT @Doublons = COUNT(*)
      FROM (SELECT CAST(e.DO_Numero AS VARCHAR(30)) AS Piece FROM GR_GOCOM.dbo.RT_ECHEANCE e
             WHERE e.SO_Id = @SocieteNo AND e.DO_Domaine = 0
             GROUP BY CAST(e.DO_Numero AS VARCHAR(30)) HAVING COUNT(*) > 1 AND MAX(e.EC_DateCreation) = @Now) x;
    IF (SELECT COUNT(*) FROM #ins) <> @NbIns OR @OkMontants <> @NbIns OR @OkFlags <> @NbIns OR @Doublons <> 0
        THROW 50003, 'Contrôle final en échec : annulation.', 1;

    COMMIT;
    SET LOCK_TIMEOUT -1; SET DEADLOCK_PRIORITY NORMAL;      -- rend la session SSMS à son état normal
    PRINT CONCAT(@NbIns, ' échéance(s) créée(s) et ligne(s) F_DOCREGL passée(s) à cbFlag = 1. BatchId = ', CONVERT(VARCHAR(36), @Batch), ' ; journal d''annulation : ', @BakIm);
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    SET LOCK_TIMEOUT -1; SET DEADLOCK_PRIORITY NORMAL;
    THROW;
END CATCH

/*
  UNDO — supprime les échéances créées par ce lot et remet cbFlag = 0, à partir du journal BAK_IM_* affiché à l'application.
  Remplacer le nom ci-dessous. Ne supprime QUE les échéances encore intactes (non réglées, aucune affectation) :
  voir le résultat « EcheancesSupprimees » ; une échéance déjà utilisée est laissée en place et son cbFlag reste à 1.
  (Le job SQL Agent remet de lui-même cbFlag = 1 sur toute pièce qui a encore une échéance.)

  DECLARE @BakIm SYSNAME = 'BAK_IM_xxxxxxxxxxxx', @sql NVARCHAR(MAX);
  BEGIN TRAN;
  SET @sql = N'DELETE e FROM GR_GOCOM.dbo.RT_ECHEANCE e WITH (TABLOCKX) JOIN GR_GOCOM.dbo.' + QUOTENAME(@BakIm) + N' b ON b.EC_Id = e.EC_Id
               WHERE e.EC_Solde = e.EC_Montant AND e.EC_Type = 0
                 AND NOT EXISTS (SELECT 1 FROM GR_GOCOM.dbo.RT_AFFECTATION a WHERE a.EC_Id = e.EC_Id OR a.AF_EcId = e.EC_Id);
               SELECT @@ROWCOUNT AS EcheancesSupprimees;
               UPDATE d SET cbFlag = 0 FROM GOCOM.dbo.F_DOCREGL d JOIN GR_GOCOM.dbo.' + QUOTENAME(@BakIm) + N' b ON b.DR_cbMarq = d.cbMarq
               WHERE NOT EXISTS (SELECT 1 FROM GR_GOCOM.dbo.RT_ECHEANCE x WHERE x.EC_Id = b.EC_Id);
               SELECT @@ROWCOUNT AS FlagsRemisA0;';
  EXEC (@sql);
  COMMIT;   -- ou ROLLBACK
*/
