/*
  Délettrage compta des règlements clients ESPÈCE comptabilisés
  Équivalent SQL de la DLL GRC : LettrageReglementClient.IsLettre / DeLettrerAsync -> DeLettrageCompte,
  EcritureComptableRepository.QueryDeLettrageCompteCompteTiersLettre (SageCompta.v16.Dapper).

  Point de départ : RT_MOUVEMENT where MV_Type = 0 (espèce) and MV_Domaine = 0 (règlement client)
                    and CT_Type = 0 (tiers de type client) and MV_Compta = 1.
  Les écritures d'un règlement = RT_HISTCOMPTA (MV_Domaine = 0, MV_Id) ; HC_No = cbMarq de F_ECRITUREC.

  Ce que fait la DLL (repris ici) :
   - règlement lettré  <=> au moins une de ses écritures a EC_Lettre = 1 ;
   - délettrage : pour chaque lettre trouvée, TOUTES les écritures du même compte / tiers / lettre,
     dans l'exercice NON clôturé, passent à EC_Lettre=0, EC_Lettrage='', EC_LettreQ=0, EC_LettrageQ='' ;
   - contrôle « journal utilisé » (CB_IsRecordLock sur F_JMOUV) avant d'écrire.

  Ce que le script ajoute par rapport à la DLL (garde-fous SQL) :
   - filtre société (SO_Id) + contrôle que P_SOCIETE.SO_ErpDb = la base compta visée ;
   - exercices lus dans P_DOSSIER (pas forcément l'année civile), exercices clôturés exclus ;
   - lettres MIXTES (partagées avec un autre règlement GRC : chèque, traite...) repérées et, par défaut, ignorées ;
   - remise à zéro du miroir GRC RT_HISTCOMPTA.HC_Lettre / HC_Lettrage (la DLL le tient à jour au lettrage) ;
   - journal d'annulation (dbo.LOG_DELETTRAGE_SQL, base GRC) : anciennes valeurs de chaque ligne modifiée ;
   - transaction unique, contrôle du nombre de lignes, plafond @MaxEcritures.

  Bases : GR_GOCOM = base GRC (RT_*, P_SOCIETE) ; GOCOM = base compta Sage (F_ECRITUREC, P_DOSSIER, F_JMOUV),
          c'est-à-dire P_SOCIETE.SO_ErpDb de la société 1. Autre environnement : rechercher/remplacer ces deux
          noms de base (GR_GOCOM d'abord, puis GOCOM) — il n'y a rien d'autre à changer.
  Usage : 1) renseigner @SocieteNo et la période ; 2) exécuter en @Apply = 0 et lire les résultats ; 3) puis @Apply = 1.
  Sauvegarde de la base compta OBLIGATOIRE avant @Apply = 1 (UPDATE de F_ECRITUREC hors Sage).
  Annulation : voir le bloc UNDO en fin de fichier (nécessite le BatchId affiché à l'application).
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;

------------------------------------------------------------------------------------------ PARAMÈTRES
DECLARE @SocieteNo            INT  = 1;     -- RT_MOUVEMENT.SO_Id — OBLIGATOIRE
DECLARE @Apply                BIT  = 0;     -- 0 = aperçu, 1 = applique
DECLARE @DateDu               DATE = '20260101';  -- filtre optionnel sur MV_Date (inclus) ; NULL = pas de borne
DECLARE @DateAu               DATE = '20260731';  -- filtre optionnel sur MV_Date (inclus, jour entier) ; NULL = pas de borne
                                                  -- dates en YYYYMMDD : indépendant de la langue de la session (dmy / mdy)
DECLARE @MvId                 INT  = NULL;  -- optionnel : un seul règlement (pour un premier test)
DECLARE @InclureAnnules       BIT  = 0;     -- 0 = ignore les règlements MV_Annule = 1
DECLARE @ExclureLettresMixtes BIT  = 1;     -- 1 = ne délettre pas une lettre partagée avec un autre règlement GRC
DECLARE @ResetMiroirGrc       BIT  = 1;     -- 1 = remet HC_Lettre/HC_Lettrage à zéro dans RT_HISTCOMPTA
DECLARE @MaxEcritures         INT  = 1000;  -- garde-fou : refuse d'appliquer au-delà

DECLARE @Bloque BIT = 0, @Batch UNIQUEIDENTIFIER = NEWID();

IF @SocieteNo <= 0 BEGIN RAISERROR('Renseigner @SocieteNo.', 16, 1); RETURN; END

-- La base compta visée est-elle bien celle de la société ? (RT_MOUVEMENT / RT_HISTCOMPTA sont multi-sociétés,
-- HC_No n'a de sens que dans la compta de SA société : un mauvais couple viserait des écritures au hasard.)
DECLARE @ErpDb NVARCHAR(256), @ErpServer NVARCHAR(256), @ComptaDb SYSNAME;
SELECT @ErpDb = SO_ErpDb, @ErpServer = SO_ErpServer FROM GR_GOCOM.dbo.P_SOCIETE WHERE SO_Id = @SocieteNo;
IF @ErpDb IS NULL BEGIN RAISERROR('Société %d introuvable dans P_SOCIETE.', 16, 1, @SocieteNo); RETURN; END
-- Nom RÉEL de la base compta visée par le script, lu depuis cette base elle-même (aucun nom à répéter ici).
EXEC GOCOM.sys.sp_executesql N'SELECT @n = DB_NAME()', N'@n SYSNAME OUTPUT', @n = @ComptaDb OUTPUT;
IF @ErpDb <> @ComptaDb BEGIN RAISERROR('SO_ErpDb de la société %d = [%s] mais le script cible la base compta [%s].', 16, 1, @SocieteNo, @ErpDb, @ComptaDb); RETURN; END
PRINT CONCAT('Société ', @SocieteNo, ' -> compta ', @ErpServer, ' / ', @ErpDb, ' ; script exécuté sur ', @@SERVERNAME, ' (vérifier que c''est le même serveur).');

------------------------------------------------------------------------------------------ EXERCICES (P_DOSSIER)
IF OBJECT_ID('tempdb..#exo') IS NOT NULL DROP TABLE #exo;
SELECT Debut, Fin, Cloture INTO #exo FROM (
    SELECT D_DebutExo01 AS Debut, D_FinExo01 AS Fin, CAST(D_Archivage01 AS INT) AS Cloture FROM GOCOM.dbo.P_DOSSIER WHERE YEAR(D_DebutExo01) > 1900
    UNION ALL SELECT D_DebutExo02, D_FinExo02, CAST(D_Archivage02 AS INT) FROM GOCOM.dbo.P_DOSSIER WHERE YEAR(D_DebutExo02) > 1900
    UNION ALL SELECT D_DebutExo03, D_FinExo03, CAST(D_Archivage03 AS INT) FROM GOCOM.dbo.P_DOSSIER WHERE YEAR(D_DebutExo03) > 1900
    UNION ALL SELECT D_DebutExo04, D_FinExo04, CAST(D_Archivage04 AS INT) FROM GOCOM.dbo.P_DOSSIER WHERE YEAR(D_DebutExo04) > 1900
    UNION ALL SELECT D_DebutExo05, D_FinExo05, CAST(D_Archivage05 AS INT) FROM GOCOM.dbo.P_DOSSIER WHERE YEAR(D_DebutExo05) > 1900
) x;

------------------------------------------------------------------------------------------ 1. RÈGLEMENTS ESPÈCE COMPTABILISÉS
IF OBJECT_ID('tempdb..#mv') IS NOT NULL DROP TABLE #mv;
SELECT m.MV_Id, m.MV_Numero, m.MV_Date, m.MV_Etat, ISNULL(m.MV_Annule, 0) AS MV_Annule
INTO #mv
FROM GR_GOCOM.dbo.RT_MOUVEMENT m
WHERE m.SO_Id = @SocieteNo
  AND m.MV_Domaine = 0          -- règlement client
  AND m.CT_Type = 0             -- tiers de type client (enum TiersType : 0 client / 1 fournisseur / 2 salarié / 3 autre)
  AND m.MV_Type = 0             -- espèce (0 espèce / 1 chèque / 2 traite / 3 virement-versement)
  AND m.MV_Compta = 1
  AND (@InclureAnnules = 1 OR ISNULL(m.MV_Annule, 0) = 0)
  AND (@MvId  IS NULL OR m.MV_Id = @MvId)
  AND (@DateDu IS NULL OR m.MV_Date >= @DateDu)
  AND (@DateAu IS NULL OR m.MV_Date <  DATEADD(DAY, 1, @DateAu));   -- MV_Date porte une heure : jour entier

------------------------------------------------------------------------------------------ 2. LEURS ÉCRITURES (GRC -> COMPTA)
IF OBJECT_ID('tempdb..#ecm') IS NOT NULL DROP TABLE #ecm;
SELECT h.HC_Id, h.MV_Id, h.HC_No, h.HC_CompteGeneral,
       e.cbMarq AS EcCbMarq, e.JO_Num, e.CG_Num, e.CT_Num, e.EC_Lettre, e.EC_Lettrage, e.EC_LettreQ, e.JM_Date,
       CASE WHEN e.cbMarq IS NULL THEN 'ORPHELINE'   -- HC_No ne pointe sur aucune écriture compta
            WHEN e.CG_Num COLLATE DATABASE_DEFAULT <> h.HC_CompteGeneral COLLATE DATABASE_DEFAULT THEN 'COMPTE_DIFFERENT'
            ELSE 'OK' END AS Statut
INTO #ecm
FROM #mv m
JOIN GR_GOCOM.dbo.RT_HISTCOMPTA h ON h.MV_Id = m.MV_Id AND h.MV_Domaine = 0 AND h.SO_Id = @SocieteNo
LEFT JOIN GOCOM.dbo.F_ECRITUREC e ON e.cbMarq = h.HC_No;

------------------------------------------------------------------------------------------ 3. LETTRES À DÉLETTRER (par compte / tiers / exercice ouvert)
IF OBJECT_ID('tempdb..#lettres') IS NOT NULL DROP TABLE #lettres;
SELECT DISTINCT x.CG_Num, ISNULL(x.CT_Num, '') AS CT_Num, x.EC_Lettrage AS Lettre, ex.Debut, ex.Fin
INTO #lettres
FROM #ecm x
JOIN #exo ex ON x.JM_Date >= ex.Debut AND x.JM_Date <= ex.Fin AND ex.Cloture = 0
WHERE x.Statut = 'OK' AND x.EC_Lettre = 1 AND ISNULL(x.EC_Lettrage, '') <> '';

------------------------------------------------------------------------------------------ 4. TOUTES LES ÉCRITURES PORTANT CES LETTRES (comportement DLL)
IF OBJECT_ID('tempdb..#cibles') IS NOT NULL DROP TABLE #cibles;
SELECT e.cbMarq, e.JO_Num, e.EC_Piece, e.EC_RefPiece, e.CG_Num, ISNULL(e.CT_Num, '') AS CT_Num,
       e.EC_Lettrage, e.EC_LettrageQ, e.EC_Sens, e.EC_Montant, e.JM_Date, l.Debut AS ExoDebut,
       CASE WHEN EXISTS (SELECT 1 FROM #ecm z WHERE z.HC_No = e.cbMarq) THEN 1 ELSE 0 END AS EstReglementCible,
       CASE WHEN EXISTS (SELECT 1 FROM GR_GOCOM.dbo.RT_HISTCOMPTA h2
                         WHERE h2.HC_No = e.cbMarq AND h2.SO_Id = @SocieteNo
                           AND NOT (h2.MV_Domaine = 0 AND h2.MV_Id IN (SELECT MV_Id FROM #mv))) THEN 1 ELSE 0 END AS EstGrcAutre,
       CAST(1 AS BIT) AS Retenue
INTO #cibles
FROM #lettres l
JOIN GOCOM.dbo.F_ECRITUREC e
  ON e.CG_Num = l.CG_Num AND ISNULL(e.CT_Num, '') = l.CT_Num AND e.EC_Lettrage = l.Lettre
 AND e.EC_Lettre = 1 AND e.JM_Date >= l.Debut AND e.JM_Date <= l.Fin;

-- Lettre mixte = lettre qui contient une écriture d'un AUTRE mouvement GRC (chèque, traite, impayé, bordereau, espèce hors filtre...)
IF OBJECT_ID('tempdb..#mixtes') IS NOT NULL DROP TABLE #mixtes;
SELECT CG_Num, CT_Num, EC_Lettrage, ExoDebut
INTO #mixtes
FROM #cibles GROUP BY CG_Num, CT_Num, EC_Lettrage, ExoDebut HAVING MAX(EstGrcAutre) = 1;

IF @ExclureLettresMixtes = 1
    UPDATE c SET Retenue = 0
    FROM #cibles c
    JOIN #mixtes m ON m.CG_Num = c.CG_Num AND m.CT_Num = c.CT_Num AND m.EC_Lettrage = c.EC_Lettrage AND m.ExoDebut = c.ExoDebut;

------------------------------------------------------------------------------------------ 5. CONTRÔLE « JOURNAL UTILISÉ » (comme ThrowIfJournalIsUsed : CB_IsRecordLock sur F_JMOUV)
IF OBJECT_ID('tempdb..#jm') IS NOT NULL DROP TABLE #jm;
SELECT DISTINCT j.cbMarq AS JMNo, j.JO_Num, j.JM_Date
INTO #jm
FROM #ecm x
JOIN GOCOM.dbo.F_JMOUV j ON j.JO_Num = x.JO_Num AND j.JM_Date = x.JM_Date
WHERE x.Statut = 'OK' AND x.EC_Lettre = 1;

DECLARE @jmNo INT, @res INT;
DECLARE cur CURSOR LOCAL FAST_FORWARD FOR SELECT JMNo FROM #jm;
OPEN cur; FETCH NEXT FROM cur INTO @jmNo;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @res = 0;
    BEGIN TRY
        EXEC GOCOM.dbo.CB_IsRecordLock @cbFile = N'F_JMOUV', @cbMarq = @jmNo, @lRes = @res OUTPUT;
    END TRY
    BEGIN CATCH
        PRINT CONCAT('CB_IsRecordLock en erreur (F_JMOUV ', @jmNo, ') : ', ERROR_MESSAGE());
        SET @res = -1;
    END CATCH
    IF @res <> 0
    BEGIN
        SET @Bloque = 1;
        PRINT CONCAT('BLOQUANT : journal/période F_JMOUV.cbMarq=', @jmNo, ' utilisé par un poste Sage (ou contrôle impossible).');
    END
    FETCH NEXT FROM cur INTO @jmNo;
END
CLOSE cur; DEALLOCATE cur;

------------------------------------------------------------------------------------------ RÉSULTATS (aperçu)
SELECT 'RESUME' AS Section,
       (SELECT COUNT(*)                                   FROM #mv)                                   AS ReglementsEspeceCompta,
       (SELECT COUNT(*) FROM GR_GOCOM.dbo.RT_MOUVEMENT z                                              -- exclus par le filtre « tiers client »
         WHERE z.SO_Id = @SocieteNo AND z.MV_Domaine = 0 AND z.MV_Type = 0 AND z.MV_Compta = 1 AND z.CT_Type <> 0
           AND (@InclureAnnules = 1 OR ISNULL(z.MV_Annule, 0) = 0)
           AND (@MvId  IS NULL OR z.MV_Id = @MvId)
           AND (@DateDu IS NULL OR z.MV_Date >= @DateDu)
           AND (@DateAu IS NULL OR z.MV_Date <  DATEADD(DAY, 1, @DateAu)))                            AS EspeceComptaTiersNonClient,
       (SELECT COUNT(DISTINCT MV_Id)                      FROM #ecm)                                  AS AvecEcrituresGrc,
       (SELECT COUNT(DISTINCT MV_Id)                      FROM #ecm WHERE Statut='OK' AND EC_Lettre=1) AS ReglementsLettres,
       (SELECT COUNT(*)                                   FROM #lettres)                              AS LettresDistinctes,
       (SELECT COUNT(*)                                   FROM #cibles WHERE Retenue = 1)             AS EcrituresADelettrer,
       (SELECT COUNT(*)                                   FROM #mixtes)                               AS LettresMixtes,
       (SELECT COUNT(*)                                   FROM #cibles WHERE Retenue = 0)             AS EcrituresIgnorees,
       @Bloque                                                                                        AS JournalBloque;

-- Anomalies qui échappent au traitement (à regarder avant @Apply = 1)
SELECT 'ANOMALIE' AS Section, a.Type, a.MV_Id, a.HC_No, a.Detail FROM (
    SELECT 'HC_ORPHELINE' AS Type, MV_Id, HC_No, 'RT_HISTCOMPTA pointe une écriture absente de F_ECRITUREC' AS Detail FROM #ecm WHERE Statut = 'ORPHELINE'
    UNION ALL SELECT 'COMPTE_DIFFERENT', MV_Id, HC_No, CONCAT('HC=', HC_CompteGeneral, ' / compta=', CG_Num) FROM #ecm WHERE Statut = 'COMPTE_DIFFERENT'
    UNION ALL SELECT 'LETTRE_SANS_CODE', MV_Id, HC_No, 'EC_Lettre=1 mais EC_Lettrage vide : non traitée' FROM #ecm WHERE Statut = 'OK' AND EC_Lettre = 1 AND ISNULL(EC_Lettrage,'') = ''
    UNION ALL SELECT 'EXERCICE_CLOTURE', x.MV_Id, x.HC_No, CONCAT('lettre ', x.EC_Lettrage, ' du ', CONVERT(CHAR(8), x.JM_Date, 112), ' : exercice clôturé, ignorée (comme la DLL)')
              FROM #ecm x WHERE x.Statut = 'OK' AND x.EC_Lettre = 1 AND ISNULL(x.EC_Lettrage,'') <> ''
                AND NOT EXISTS (SELECT 1 FROM #exo ex WHERE x.JM_Date >= ex.Debut AND x.JM_Date <= ex.Fin AND ex.Cloture = 0)
    UNION ALL SELECT 'LETTRAGE_DEVISE_SEUL', MV_Id, HC_No, 'EC_LettreQ=1 sans EC_Lettre : la DLL ne le voit pas, non traité' FROM #ecm WHERE Statut = 'OK' AND EC_Lettre = 0 AND EC_LettreQ = 1
) a ORDER BY a.Type, a.MV_Id;

-- Lettres mixtes : quels autres mouvements GRC partagent la lettre
SELECT 'LETTRE_MIXTE' AS Section, c.CG_Num, c.CT_Num, c.EC_Lettrage, c.cbMarq, h2.MV_Domaine AS AutreDomaine, h2.MV_Id AS AutreMvId,
       m2.MV_Numero AS AutreNumero, m2.MV_Type AS AutreType, m2.CT_Type AS AutreTiersType, CASE WHEN @ExclureLettresMixtes = 1 THEN 'IGNOREE' ELSE 'SERA DELETTREE' END AS Decision
FROM #cibles c
JOIN GR_GOCOM.dbo.RT_HISTCOMPTA h2 ON h2.HC_No = c.cbMarq AND h2.SO_Id = @SocieteNo
LEFT JOIN GR_GOCOM.dbo.RT_MOUVEMENT m2 ON m2.MV_Id = h2.MV_Id AND h2.MV_Domaine = 0
WHERE c.EstGrcAutre = 1 AND NOT (h2.MV_Domaine = 0 AND h2.MV_Id IN (SELECT MV_Id FROM #mv))
ORDER BY c.CG_Num, c.CT_Num, c.EC_Lettrage;

-- Détail : toutes les écritures concernées et leur rôle
SELECT 'APERCU' AS Section, c.cbMarq, c.JO_Num, c.EC_Piece, c.EC_RefPiece, c.CG_Num, c.CT_Num, c.EC_Lettrage, c.EC_Sens, c.EC_Montant, c.JM_Date,
       CASE WHEN c.EstReglementCible = 1 THEN 'REGLEMENT_ESPECE'
            WHEN c.EstGrcAutre = 1       THEN 'AUTRE_MOUVEMENT_GRC'
            ELSE 'HORS_GRC (facture...)' END AS Role,
       CASE WHEN c.Retenue = 1 THEN 'A DELETTRER' ELSE 'IGNOREE (lettre mixte)' END AS Decision
FROM #cibles c
ORDER BY c.CG_Num, c.CT_Num, c.EC_Lettrage, c.cbMarq;

------------------------------------------------------------------------------------------ APPLICATION
IF @Apply <> 1 BEGIN PRINT 'Aperçu uniquement (@Apply = 0). Rien n''a été modifié.'; RETURN; END

DECLARE @NbCibles INT = (SELECT COUNT(*) FROM #cibles WHERE Retenue = 1), @n INT;
IF @Bloque = 1 BEGIN RAISERROR('Abandon : journal utilisé (ou contrôle de verrou impossible).', 16, 1); RETURN; END
IF @NbCibles = 0 BEGIN PRINT 'Rien à délettrer.'; RETURN; END
IF @NbCibles > @MaxEcritures BEGIN RAISERROR('Abandon : %d écritures > @MaxEcritures (%d).', 16, 1, @NbCibles, @MaxEcritures); RETURN; END

IF OBJECT_ID(N'GR_GOCOM.dbo.LOG_DELETTRAGE_SQL') IS NULL
    CREATE TABLE GR_GOCOM.dbo.LOG_DELETTRAGE_SQL (
        Id              INT IDENTITY(1,1) PRIMARY KEY,
        BatchId         UNIQUEIDENTIFIER NOT NULL,
        RunAt           DATETIME2(0)     NOT NULL DEFAULT SYSDATETIME(),
        RunBy           SYSNAME          NOT NULL DEFAULT SUSER_SNAME(),
        SocieteNo       INT              NOT NULL,
        Cible           VARCHAR(20)      NOT NULL,   -- 'F_ECRITUREC' (CleId = cbMarq) | 'RT_HISTCOMPTA' (CleId = HC_Id)
        CleId           INT              NOT NULL,
        AncienLettre    INT              NULL,
        AncienLettrage  NVARCHAR(20)     NULL,
        AncienLettreQ   INT              NULL,
        AncienLettrageQ NVARCHAR(20)     NULL
    );

BEGIN TRY
    BEGIN TRAN;

    UPDATE e
       SET EC_Lettre = 0, EC_Lettrage = '', EC_LettreQ = 0, EC_LettrageQ = ''
    OUTPUT @Batch, @SocieteNo, 'F_ECRITUREC', deleted.cbMarq, deleted.EC_Lettre, deleted.EC_Lettrage, deleted.EC_LettreQ, deleted.EC_LettrageQ
      INTO GR_GOCOM.dbo.LOG_DELETTRAGE_SQL (BatchId, SocieteNo, Cible, CleId, AncienLettre, AncienLettrage, AncienLettreQ, AncienLettrageQ)
    FROM GOCOM.dbo.F_ECRITUREC e
    JOIN #cibles c ON c.cbMarq = e.cbMarq AND c.Retenue = 1
    WHERE e.EC_Lettre = 1;
    SET @n = @@ROWCOUNT;
    IF @n <> @NbCibles THROW 50001, 'Nombre de lignes modifiées différent du nombre attendu : annulation.', 1;

    IF @ResetMiroirGrc = 1
        UPDATE h
           SET HC_Lettre = 0, HC_Lettrage = ''
        OUTPUT @Batch, @SocieteNo, 'RT_HISTCOMPTA', deleted.HC_Id, deleted.HC_Lettre, deleted.HC_Lettrage, NULL, NULL
          INTO GR_GOCOM.dbo.LOG_DELETTRAGE_SQL (BatchId, SocieteNo, Cible, CleId, AncienLettre, AncienLettrage, AncienLettreQ, AncienLettrageQ)
        FROM GR_GOCOM.dbo.RT_HISTCOMPTA h
        JOIN #cibles c ON c.cbMarq = h.HC_No AND c.Retenue = 1
        WHERE h.SO_Id = @SocieteNo AND (h.HC_Lettre <> 0 OR ISNULL(h.HC_Lettrage, '') <> '');

    COMMIT;
    PRINT CONCAT(@n, ' écriture(s) délettrée(s). BatchId = ', CONVERT(VARCHAR(36), @Batch));
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
END CATCH

/*
  UNDO — à lancer à la main, avec le BatchId affiché à l'application (ou lu dans LOG_DELETTRAGE_SQL).
  Ne restaure QUE les lignes encore délettrées : une écriture relettrée depuis n'est pas écrasée.
  Limite : si, depuis, une des lettres libérées a été réattribuée à d'autres écritures (même compte / tiers /
  exercice), la restauration créerait deux groupes de même lettre. À faire vite, avant tout nouveau lettrage.

  BEGIN TRAN;
  UPDATE e SET EC_Lettre = l.AncienLettre, EC_Lettrage = l.AncienLettrage, EC_LettreQ = l.AncienLettreQ, EC_LettrageQ = l.AncienLettrageQ
  FROM GOCOM.dbo.F_ECRITUREC e
  JOIN GR_GOCOM.dbo.LOG_DELETTRAGE_SQL l ON l.Cible = 'F_ECRITUREC' AND l.CleId = e.cbMarq
  WHERE l.BatchId = '<BatchId>' AND e.EC_Lettre = 0 AND ISNULL(e.EC_Lettrage, '') = '';
  SELECT @@ROWCOUNT AS EcrituresRestaurees;   -- attendu : le nombre affiché à l'application ; sinon ROLLBACK et comprendre pourquoi

  UPDATE h SET HC_Lettre = l.AncienLettre, HC_Lettrage = l.AncienLettrage
  FROM GR_GOCOM.dbo.RT_HISTCOMPTA h
  JOIN GR_GOCOM.dbo.LOG_DELETTRAGE_SQL l ON l.Cible = 'RT_HISTCOMPTA' AND l.CleId = h.HC_Id
  WHERE l.BatchId = '<BatchId>' AND h.HC_Lettre = 0 AND ISNULL(h.HC_Lettrage, '') = '';
  SELECT @@ROWCOUNT AS LignesMiroirRestaurees;
  COMMIT;   -- ou ROLLBACK
*/
