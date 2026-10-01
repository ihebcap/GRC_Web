/*
  Suppression des ÉCHÉANCES de factures clientes NON RÉGLÉES (RT_ECHEANCE), puis remise à 0 du flag Sage F_DOCREGL.cbFlag
  des lignes qui n'ont plus d'échéance dans la GRC.
  Équivalent SQL de la DLL GRC : SocieteManager.EcheanceDelete (Tresorerie.Core.dll) pour la partie GRC, et de
  DocumentRepository.Flagger (Sage.v16.Dapper.dll) pour la partie Sage (UPDATE F_DOCREGL SET cbFlag = ...).

  Contexte : à l'intégration d'une facture (ErpDocumentService.Integrer), la GRC crée une échéance RT_ECHEANCE par ligne
  F_DOCREGL dont cbFlag = 0 (et montant <> 0), puis pose cbFlag = 1. Pour qu'une facture soit de nouveau proposée à
  l'intégration, il faut REMETTRE cbFlag = 0 côté Sage. Les documents Sage ont changé (facture type 6 -> 7, nouveau DR_No) :
  on ne peut donc pas partir de l'échéance supprimée pour retrouver la ligne Sage ; on procède en DEUX ÉTAPES indépendantes.

  ÉTAPE 1 (GRC) : supprimer de RT_ECHEANCE les échéances where EC_Type = 0 (facture Erp), DO_Domaine = 0 (vente), société
                  @SocieteNo, EC_Solde = EC_Montant (aucun règlement affecté), filtre optionnel sur DO_Date.
  ÉTAPE 2 (Sage) : toute ligne GOCOM.dbo.F_DOCREGL (DO_Domaine = 0, DO_Type IN (6, 7), cbFlag = 1) qui n'a PLUS d'échéance
                  dans RT_ECHEANCE — comparaison sur la clé EXACTE DO_Piece = DO_Numero ET DR_No = EC_No — passe à cbFlag = 0.
                  (Une facture réglée dont le DR_No Sage a changé garderait son échéance mais ne correspondrait plus à la clé :
                  le script l'aurait remise à 0 -> doublon à la réintégration. Mesuré sur la prod : 0 cas, mais le script
                  BLOQUE l'étape 2 par sécurité si cela arrive, voir 'PIECE_GARDEE_DRNO_DIFFERENT'.)

  Refus repris de la DLL pour l'étape 1 (échéance BLOQUÉE, jamais supprimée) : affectée, règlement d'avoir associé
  (REGAVR_NO), remboursement R/S (MV_RemboursementAVFNo), échéance spéciale (EC_SPE), réservée dossier fournisseur (EC_Lock),
  réservée pour un crédit (CR_Id). Ajoutés ici : tables filles (RT_ECHEANCELIGNE, RT_ECHEANCETVA, RT_LIGNERAPPEL,
  RT_DECLARATIONDELAISPAIEMENTLG, RT_DOSSIERIMP, RT_CREDIT, RT_MOUVEMENT.EC_IdRetenue), notes et historique workflow (la DLL
  les supprime : ici bloqués, aucun cas actuellement).

  Garde-fous : contrôle P_SOCIETE.SO_ErpDb = base Sage, SAUVEGARDE COMPLÈTE des échéances supprimées (BAK_EC_<lot>) et de
  l'ancien flag Sage (BAK_DR_<lot>) dans la base GRC, transaction unique (GR_GOCOM et GOCOM sont sur la même instance : pas de
  MSDTC), contrôle du nombre de lignes, plafonds @MaxEcheances / @MaxLignesSage.

  Limites : ne touche NI F_DOCREGL.DR_Regle, NI F_DOCENTETE ; ne notifie pas les écrans GRC ouverts ; ne teste pas les droits
  utilisateur / souche (la DLL le fait). F_DOCREGL n'a pas de société : l'étape 2 vise toute la base Sage de la société.
  Bases : GR_GOCOM = GRC (RT_*, P_SOCIETE) ; GOCOM = gestion commerciale Sage (F_DOCREGL, F_DOCENTETE) = P_SOCIETE.SO_ErpDb.
          Autre environnement : rechercher/remplacer ces deux noms (GR_GOCOM d'abord, puis GOCOM).
  Suppression DÉFINITIVE + UPDATE Sage : sauvegarde de GR_GOCOM ET GOCOM OBLIGATOIRE avant @Apply = 1.
  Usage : 1) renseigner @SocieteNo (+ période si besoin) ; 2) @Apply = 0 et lire les résultats ; 3) puis @Apply = 1.
  Annulation : bloc UNDO en fin de fichier (réinsère les échéances et remet l'ancien cbFlag, depuis les tables BAK_*).
*/
-- Nettoyage des tables temporaires d'une exécution précédente dans la même fenêtre SSMS (lot séparé).
IF OBJECT_ID('tempdb..#ech')  IS NOT NULL DROP TABLE #ech;
IF OBJECT_ID('tempdb..#reg')  IS NOT NULL DROP TABLE #reg;
IF OBJECT_ID('tempdb..#flag') IS NOT NULL DROP TABLE #flag;
IF OBJECT_ID('tempdb..#rest') IS NOT NULL DROP TABLE #rest;
GO
SET NOCOUNT ON;
SET XACT_ABORT ON;

------------------------------------------------------------------------------------------ PARAMÈTRES
DECLARE @SocieteNo     INT  = 1;            -- RT_ECHEANCE.SO_Id — OBLIGATOIRE
DECLARE @Apply         BIT  = 0;            -- 0 = aperçu, 1 = SUPPRIME + remet cbFlag = 0
DECLARE @DateDu        DATE = '20250101';   -- filtre optionnel sur la date de la FACTURE (inclus) ; NULL = pas de borne
DECLARE @DateAu        DATE = '20260731';   -- filtre optionnel sur la date de la FACTURE (inclus) ; NULL = pas de borne
DECLARE @DoNumero      NVARCHAR(30) = NULL; -- optionnel : une seule facture (pour un premier test)
DECLARE @MaxEcheances  INT  = 40000;        -- garde-fou étape 1
DECLARE @MaxLignesSage INT  = 40000;        -- garde-fou étape 2

DECLARE @Batch UNIQUEIDENTIFIER = NEWID();
IF @SocieteNo <= 0 BEGIN RAISERROR('Renseigner @SocieteNo.', 16, 1); RETURN; END

------------------------------------------------------------------------------------------ 0. COHÉRENCE SOCIÉTÉ <-> BASE SAGE
DECLARE @ErpDb NVARCHAR(256), @ErpServer NVARCHAR(256), @ComptaDb SYSNAME;
SELECT @ErpDb = SO_ErpDb, @ErpServer = SO_ErpServer FROM GR_GOCOM.dbo.P_SOCIETE WHERE SO_Id = @SocieteNo;
IF @ErpDb IS NULL BEGIN RAISERROR('Société %d introuvable dans P_SOCIETE.', 16, 1, @SocieteNo); RETURN; END
EXEC GOCOM.sys.sp_executesql N'SELECT @n = DB_NAME()', N'@n SYSNAME OUTPUT', @n = @ComptaDb OUTPUT;
IF @ErpDb <> @ComptaDb BEGIN RAISERROR('SO_ErpDb de la société %d = [%s] mais le script cible la base [%s].', 16, 1, @SocieteNo, @ErpDb, @ComptaDb); RETURN; END
PRINT CONCAT('Société ', @SocieteNo, ' -> Sage ', @ErpServer, ' / ', @ErpDb, ' ; script exécuté sur ', @@SERVERNAME, ' (vérifier que c''est le même serveur).');

------------------------------------------------------------------------------------------ ÉTAPE 1 — ÉCHÉANCES GRC NON RÉGLÉES
SELECT e.EC_Id, e.EC_No, e.DO_Numero, e.DO_Type, e.DO_Date, e.EC_Montant, e.EC_Solde
INTO #ech
FROM GR_GOCOM.dbo.RT_ECHEANCE e
WHERE e.SO_Id = @SocieteNo
  AND e.EC_Type = 0             -- facture Erp (créée à l'intégration)
  AND e.DO_Domaine = 0          -- vente
  AND e.EC_Solde = e.EC_Montant -- aucun règlement affecté
  AND (@DoNumero IS NULL OR e.DO_Numero = @DoNumero)
  AND (@DateDu   IS NULL OR e.DO_Date >= @DateDu)
  AND (@DateAu   IS NULL OR e.DO_Date <  DATEADD(DAY, 1, @DateAu));

SELECT x.*,
       CASE WHEN EXISTS (SELECT 1 FROM GR_GOCOM.dbo.RT_AFFECTATION a WHERE a.EC_Id = x.EC_Id OR a.AF_EcId = x.EC_Id) THEN 'AFFECTEE'
            WHEN x.REGAVR_NO IS NOT NULL AND x.REGAVR_NO <> 0                                                    THEN 'REGLEMENT_AVOIR'
            WHEN x.MV_RemboursementAVFNo IS NOT NULL                                                             THEN 'REMBOURSEMENT_RS'
            WHEN ISNULL(x.EC_SPE, 0) <> 0                                                                        THEN 'ECHEANCE_SPECIALE'
            WHEN ISNULL(x.EC_Lock, 0) <> 0                                                                       THEN 'RESERVEE_DOSSIER_FRS'
            WHEN x.CR_Id IS NOT NULL                                                                             THEN 'CREDIT'
            WHEN EXISTS (SELECT 1 FROM GR_GOCOM.dbo.RT_CREDIT c WHERE c.EC_Id = x.EC_Id)                         THEN 'CREDIT'
            WHEN EXISTS (SELECT 1 FROM GR_GOCOM.dbo.RT_ECHEANCELIGNE l WHERE l.EC_Id = x.EC_Id)                  THEN 'LIGNES_ECHEANCE'
            WHEN EXISTS (SELECT 1 FROM GR_GOCOM.dbo.RT_ECHEANCETVA t WHERE t.EC_Id = x.EC_Id)                    THEN 'TVA_ECHEANCE'
            WHEN EXISTS (SELECT 1 FROM GR_GOCOM.dbo.RT_LIGNERAPPEL r WHERE r.EC_Id = x.EC_Id)                    THEN 'RAPPEL'
            WHEN EXISTS (SELECT 1 FROM GR_GOCOM.dbo.RT_DECLARATIONDELAISPAIEMENTLG d WHERE d.EC_Id = x.EC_Id)    THEN 'DECLARATION_DELAIS_PAIEMENT'
            WHEN EXISTS (SELECT 1 FROM GR_GOCOM.dbo.RT_DOSSIERIMP i WHERE i.EC_CommId = x.EC_Id OR i.EC_InteretId = x.EC_Id) THEN 'DOSSIER_IMPAYE'
            WHEN EXISTS (SELECT 1 FROM GR_GOCOM.dbo.RT_MOUVEMENT m WHERE m.EC_IdRetenue = x.EC_Id)               THEN 'RETENUE'
            WHEN EXISTS (SELECT 1 FROM GR_GOCOM.dbo.RT_NOTE n WHERE n.NO_EntiteId = x.EC_Id AND n.NO_EntiteType = 2) THEN 'NOTES'              -- 2 = TypeEntity.Echeance
            WHEN EXISTS (SELECT 1 FROM GR_GOCOM.dbo.RT_WORKFLOWHISTORY w WHERE w.WH_EntityNo = x.EC_Id AND w.WH_EntityType = 2) THEN 'WORKFLOW'
            ELSE NULL END AS Blocage
INTO #reg
FROM (
    SELECT e.EC_Id, e.EC_No, e.DO_Numero, e.DO_Type, e.DO_Date, e.EC_Montant,
           ec.REGAVR_NO, ec.MV_RemboursementAVFNo, ec.EC_SPE, ec.EC_Lock, ec.CR_Id
    FROM #ech e
    JOIN GR_GOCOM.dbo.RT_ECHEANCE ec ON ec.EC_Id = e.EC_Id
) x;

DECLARE @NbEch INT = (SELECT COUNT(*) FROM #reg WHERE Blocage IS NULL);

------------------------------------------------------------------------------------------ ÉTAPE 2 — LIGNES SAGE SANS ÉCHÉANCE GRC (état APRÈS l'étape 1)
-- Clé de comparaison : DO_Piece = DO_Numero ET DR_No = EC_No. Une échéance qui reste après l'étape 1 = non supprimée
-- (réglée, ou bloquée, ou hors période) : sa ligne Sage garde cbFlag = 1.
-- Échéances qui RESTENT après l'étape 1 (table temporaire indexée : évite des produits croisés sur F_DOCREGL).
SELECT p.EC_Id, p.EC_No, CAST(p.DO_Numero AS NVARCHAR(50)) COLLATE DATABASE_DEFAULT AS Piece
INTO #rest
FROM GR_GOCOM.dbo.RT_ECHEANCE p
LEFT JOIN #reg r ON r.EC_Id = p.EC_Id AND r.Blocage IS NULL
WHERE p.SO_Id = @SocieteNo AND p.EC_Type = 0 AND p.DO_Domaine = 0 AND r.EC_Id IS NULL;
CREATE CLUSTERED INDEX IX_rest ON #rest (Piece, EC_No);

SELECT d.cbMarq AS DR_cbMarq, d.DR_No, d.DO_Piece, d.DO_Type, d.DR_Date, d.DR_Montant, d.DR_Regle, d.cbFlag AS DR_FlagAvant, h.DO_Date,
       CASE WHEN EXISTS (SELECT 1 FROM #rest q WHERE q.Piece = d.DO_Piece COLLATE DATABASE_DEFAULT)
            THEN 'PIECE_GARDEE_DRNO_DIFFERENT' ELSE NULL END AS Blocage
INTO #flag
FROM GOCOM.dbo.F_DOCREGL d
LEFT JOIN GOCOM.dbo.F_DOCENTETE h ON h.DO_Piece = d.DO_Piece AND h.DO_Domaine = d.DO_Domaine AND h.DO_Type = d.DO_Type
LEFT JOIN #rest p ON p.Piece = d.DO_Piece COLLATE DATABASE_DEFAULT AND p.EC_No = d.DR_No
WHERE d.DO_Domaine = 0
  AND d.DO_Type IN (6, 7)       -- facture / facture comptabilisée
  AND d.cbFlag = 1
  AND p.EC_Id IS NULL           -- aucune échéance restante avec la même clé (pièce + DR_No)
  AND (@DoNumero IS NULL OR d.DO_Piece = @DoNumero)
  AND (@DateDu   IS NULL OR h.DO_Date >= @DateDu)
  AND (@DateAu   IS NULL OR h.DO_Date <  DATEADD(DAY, 1, @DateAu));

DECLARE @NbFlag    INT = (SELECT COUNT(*) FROM #flag WHERE Blocage IS NULL);
DECLARE @NbFlagBlq INT = (SELECT COUNT(*) FROM #flag WHERE Blocage IS NOT NULL);

------------------------------------------------------------------------------------------ RÉSULTATS (aperçu)
SELECT 'RESUME' AS Section,
       (SELECT COUNT(*) FROM #ech)                              AS EcheancesNonReglees,
       @NbEch                                                   AS EcheancesASupprimer,
       (SELECT COUNT(*) FROM #reg WHERE Blocage IS NOT NULL)    AS EcheancesBloquees,
       (SELECT ISNULL(SUM(EC_Montant), 0) FROM #reg WHERE Blocage IS NULL) AS MontantTotal,
       (SELECT MIN(DO_Date) FROM #reg WHERE Blocage IS NULL)    AS DateMin,
       (SELECT MAX(DO_Date) FROM #reg WHERE Blocage IS NULL)    AS DateMax,
       @NbFlag                                                  AS LignesSageFlagA0,
       @NbFlagBlq                                               AS LignesSageBloquees;

SELECT 'BLOQUE_ECHEANCE_PAR_MOTIF' AS Section, Blocage, COUNT(*) AS Echeances, SUM(EC_Montant) AS Montant
FROM #reg WHERE Blocage IS NOT NULL GROUP BY Blocage ORDER BY COUNT(*) DESC;

SELECT TOP 200 'BLOQUE_ECHEANCE' AS Section, r.Blocage, r.EC_Id, r.DO_Numero, r.DO_Date, r.EC_Montant
FROM #reg r WHERE r.Blocage IS NOT NULL ORDER BY r.Blocage, r.EC_Id;

SELECT TOP 200 'BLOQUE_LIGNE_SAGE' AS Section, f.Blocage, f.DR_No, f.DO_Piece, f.DO_Type, f.DR_Regle
FROM #flag f WHERE f.Blocage IS NOT NULL ORDER BY f.DO_Piece;

SELECT 'PAR_MOIS' AS Section, FORMAT(DO_Date, 'yyyy-MM') AS Mois, COUNT(*) AS Echeances, SUM(EC_Montant) AS Montant
FROM #reg WHERE Blocage IS NULL GROUP BY FORMAT(DO_Date, 'yyyy-MM') ORDER BY 2;

-- Information (non bloquant) : lignes Sage remises à 0 dont l'échéance supprimée à l'étape 1 avait un AUTRE DR_No (document Sage modifié),
-- ou dont l'échéance n'existait déjà plus.
SELECT 'INFO_LIGNES_SAGE_DRNO_CHANGE_OU_SANS_ECHEANCE' AS Section, COUNT(*) AS Lignes
FROM #flag f WHERE f.Blocage IS NULL
  AND NOT EXISTS (SELECT 1 FROM #reg r WHERE r.Blocage IS NULL AND r.DO_Numero = f.DO_Piece AND r.EC_No = f.DR_No);
-- Information (non bloquant) : Sage dit « réglé » (DR_Regle = 1) alors que la GRC n'a aucune affectation.
SELECT 'INFO_SAGE_DEJA_REGLE' AS Section, COUNT(*) AS Lignes FROM #flag WHERE Blocage IS NULL AND DR_Regle = 1;

SELECT TOP 20 'EXEMPLES_SAGE' AS Section, DR_cbMarq, DR_No, DO_Piece, DO_Type, DO_Date, DR_Montant, DR_FlagAvant FROM #flag WHERE Blocage IS NULL ORDER BY DR_No;

------------------------------------------------------------------------------------------ APPLICATION
IF @Apply <> 1 BEGIN PRINT 'Aperçu uniquement (@Apply = 0). Rien n''a été modifié.'; RETURN; END
IF @NbEch = 0 AND @NbFlag = 0 BEGIN PRINT 'Rien à faire.'; RETURN; END
IF @NbEch  > @MaxEcheances  BEGIN RAISERROR('Abandon : %d échéances > @MaxEcheances (%d).', 16, 1, @NbEch, @MaxEcheances); RETURN; END
IF @NbFlag > @MaxLignesSage BEGIN RAISERROR('Abandon : %d lignes Sage > @MaxLignesSage (%d).', 16, 1, @NbFlag, @MaxLignesSage); RETURN; END
IF @NbFlagBlq > 0 BEGIN RAISERROR('Abandon : %d ligne(s) Sage bloquée(s) (PIECE_GARDEE_DRNO_DIFFERENT) : voir la section BLOQUE_LIGNE_SAGE.', 16, 1, @NbFlagBlq); RETURN; END

DECLARE @Suffixe VARCHAR(12) = LEFT(REPLACE(CONVERT(VARCHAR(36), @Batch), '-', ''), 12);
DECLARE @BakEc SYSNAME = 'BAK_EC_' + @Suffixe, @BakDr SYSNAME = 'BAK_DR_' + @Suffixe, @sql NVARCHAR(MAX), @n INT;

BEGIN TRY
    BEGIN TRAN;

    -- 1. sauvegarde : échéances GRC complètes + ancien flag Sage (une ligne par F_DOCREGL touchée)
    SET @sql = N'SELECT e.* INTO GR_GOCOM.dbo.' + QUOTENAME(@BakEc) + N' FROM GR_GOCOM.dbo.RT_ECHEANCE e JOIN #reg r ON r.EC_Id = e.EC_Id AND r.Blocage IS NULL;';
    EXEC (@sql);
    SET @sql = N'SELECT f.DR_cbMarq, f.DR_No, f.DO_Piece, f.DR_FlagAvant AS cbFlag_avant INTO GR_GOCOM.dbo.' + QUOTENAME(@BakDr) + N' FROM #flag f WHERE f.Blocage IS NULL;';
    EXEC (@sql);

    -- 2. ÉTAPE 1 : suppression des échéances GRC
    DELETE e FROM GR_GOCOM.dbo.RT_ECHEANCE e JOIN #reg r ON r.EC_Id = e.EC_Id AND r.Blocage IS NULL;
    SET @n = @@ROWCOUNT;
    IF @n <> @NbEch THROW 50001, 'Nombre d''échéances supprimées différent du nombre attendu : annulation.', 1;

    -- 3. ÉTAPE 2 : cbFlag = 0 sur les lignes Sage sans échéance (ciblées par cbMarq)
    UPDATE d SET cbFlag = 0
    FROM GOCOM.dbo.F_DOCREGL d
    JOIN #flag f ON f.DR_cbMarq = d.cbMarq AND f.Blocage IS NULL
    WHERE d.cbFlag <> 0;
    SET @n = @@ROWCOUNT;
    IF @n <> @NbFlag THROW 50002, 'Nombre de lignes F_DOCREGL remises à cbFlag = 0 différent du nombre attendu : annulation.', 1;

    -- 4. contrôle final : plus d'échéance supprimée, plus aucune ligne remise à 0 qui aurait encore une échéance de même clé
    IF EXISTS (SELECT 1 FROM GR_GOCOM.dbo.RT_ECHEANCE e JOIN #reg r ON r.EC_Id = e.EC_Id AND r.Blocage IS NULL)
       OR EXISTS (SELECT 1 FROM #flag f JOIN #rest p ON p.Piece = f.DO_Piece COLLATE DATABASE_DEFAULT AND p.EC_No = f.DR_No
                  WHERE f.Blocage IS NULL)
        THROW 50003, 'Contrôle final en échec : annulation.', 1;

    COMMIT;
    PRINT CONCAT(@NbEch, ' échéance(s) supprimée(s), ', @NbFlag, ' ligne(s) F_DOCREGL remise(s) à cbFlag = 0. BatchId = ', CONVERT(VARCHAR(36), @Batch), ' ; sauvegardes : ', @BakEc, ' et ', @BakDr);
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
END CATCH

/*
  UNDO — réinsère les échéances supprimées et remet l'ancien cbFlag Sage, à partir des tables BAK_* affichées à l'application.
  Remplacer les deux noms ci-dessous. Les EC_Id d'origine sont conservés (IDENTITY_INSERT). Ne réinsère pas une échéance dont
  l'EC_Id existe déjà. Attention : si les factures ont été RÉINTÉGRÉES entre-temps (cbFlag repassé à 1, nouvelles échéances), ne pas
  lancer l'annulation sans avoir supprimé les nouvelles échéances (sinon doublons).

  DECLARE @BakEc SYSNAME = 'BAK_EC_xxxxxxxxxxxx', @BakDr SYSNAME = 'BAK_DR_xxxxxxxxxxxx', @cols NVARCHAR(MAX), @sql NVARCHAR(MAX);
  BEGIN TRAN;
  SET @cols = STUFF((SELECT ',' + QUOTENAME(c.name) FROM GR_GOCOM.sys.columns c
                      WHERE c.object_id = OBJECT_ID('GR_GOCOM.dbo.RT_ECHEANCE') AND c.system_type_id <> 189 AND c.is_computed = 0
                      ORDER BY c.column_id FOR XML PATH('')), 1, 1, '');
  SET @sql = N'SET IDENTITY_INSERT GR_GOCOM.dbo.RT_ECHEANCE ON; INSERT GR_GOCOM.dbo.RT_ECHEANCE (' + @cols + N') SELECT ' + @cols
           + N' FROM GR_GOCOM.dbo.' + QUOTENAME(@BakEc) + N' b WHERE NOT EXISTS (SELECT 1 FROM GR_GOCOM.dbo.RT_ECHEANCE x WHERE x.EC_Id = b.EC_Id); SELECT @@ROWCOUNT AS EcheancesRestaurees; SET IDENTITY_INSERT GR_GOCOM.dbo.RT_ECHEANCE OFF;';
  EXEC (@sql);
  SET @sql = N'UPDATE d SET cbFlag = b.cbFlag_avant FROM GOCOM.dbo.F_DOCREGL d JOIN GR_GOCOM.dbo.' + QUOTENAME(@BakDr) + N' b ON b.DR_cbMarq = d.cbMarq WHERE d.cbFlag <> b.cbFlag_avant; SELECT @@ROWCOUNT AS FlagsRestaures;';
  EXEC (@sql);
  COMMIT;   -- ou ROLLBACK
*/
