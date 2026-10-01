/*
  Suppression des RÈGLEMENTS clients ESPÈCE (RT_MOUVEMENT + RT_HISTOMVT), non comptabilisés et sans affectation.
  Équivalent SQL de la DLL GRC : CaisseManager.ReglementClientDelete -> ReglementClientDeleteInterne (Tresorerie.Core.dll).

  Point de départ : RT_MOUVEMENT where MV_Type = 0 (espèce) and MV_Domaine = 0 (règlement client)
                    and CT_Type = 0 (tiers client) and MV_Compta = 0, non annulé.

  Ce que fait la DLL (repris ici) : supprime la ligne d'historique RT_HISTOMVT (exactement 1 par règlement), puis le
  règlement RT_MOUVEMENT. Elle REFUSE si le règlement est : annulé, comptabilisé, remis en banque, impayé, rapproché (pointé),
  affecté à une échéance (hors droit de timbre), remplacé / remplaçant, associé à une caution, lié à un remboursement fournisseur,
  transféré (historique <> 1 ligne), ou si la caisse est en sommeil.

  Garde-fous ajoutés ici :
   - mêmes refus que la DLL (avoir et affectation, y compris droit de timbre, simplement BLOQUÉS ici au lieu d'être traités), plus :
     écritures encore présentes dans RT_HISTCOMPTA, notes (RT_NOTE), dossier de règlement (RT_LIGNEDOSSIER), rapprochement
     bancaire web (RAPP_ReleveBancaire_Ligne.MV_ID) ;
   - SAUVEGARDE COMPLÈTE des lignes supprimées dans deux tables BAK_MV_<lot> / BAK_HM_<lot> (base GRC), créées à l'application ;
   - transaction unique, contrôle du nombre de lignes, plafond @MaxReglements.

  Limites : ne notifie pas les écrans ouverts (la DLL le fait) ; ne teste pas « caisse en sommeil » ni les droits utilisateur.
  Base : GR_GOCOM seulement. Suppression DÉFINITIVE : sauvegarde de GR_GOCOM OBLIGATOIRE avant @Apply = 1.
  Usage : 1) renseigner @SocieteNo et la période ; 2) exécuter en @Apply = 0 et lire les résultats ; 3) puis @Apply = 1.
  Annulation : bloc UNDO en fin de fichier (réinsère depuis les tables BAK_*).
*/
-- Nettoyage des tables temporaires d'une exécution précédente dans la même fenêtre SSMS (lot séparé).
IF OBJECT_ID('tempdb..#mv')  IS NOT NULL DROP TABLE #mv;
IF OBJECT_ID('tempdb..#reg') IS NOT NULL DROP TABLE #reg;
GO
SET NOCOUNT ON;
SET XACT_ABORT ON;

------------------------------------------------------------------------------------------ PARAMÈTRES
DECLARE @SocieteNo     INT  = 1;            -- RT_MOUVEMENT.SO_Id — OBLIGATOIRE
DECLARE @Apply         BIT  = 0;            -- 0 = aperçu, 1 = SUPPRIME
DECLARE @DateDu        DATE = '20260101';   -- filtre optionnel sur MV_Date (inclus) ; NULL = pas de borne
DECLARE @DateAu        DATE = '20260731';   -- filtre optionnel sur MV_Date (inclus, jour entier) ; NULL = pas de borne
DECLARE @MvId          INT  = NULL;         -- optionnel : un seul règlement (pour un premier test)
DECLARE @MaxReglements INT  = 30000;        -- garde-fou : refuse d'appliquer au-delà

DECLARE @Batch UNIQUEIDENTIFIER = NEWID();
IF @SocieteNo <= 0 BEGIN RAISERROR('Renseigner @SocieteNo.', 16, 1); RETURN; END

------------------------------------------------------------------------------------------ 1. RÈGLEMENTS ESPÈCE NON COMPTABILISÉS
SELECT m.MV_Id, m.MV_Numero, m.MV_Date, m.MV_Montant, m.MV_Remis, m.MV_Impaye, m.MV_Point, ISNULL(m.MV_AVR, 0) AS MV_AVR
INTO #mv
FROM GR_GOCOM.dbo.RT_MOUVEMENT m
WHERE m.SO_Id = @SocieteNo
  AND m.MV_Domaine = 0          -- règlement client
  AND m.CT_Type = 0             -- tiers de type client
  AND m.MV_Type = 0             -- espèce
  AND m.MV_Compta = 0           -- non comptabilisé
  AND ISNULL(m.MV_Annule, 0) = 0
  AND (@MvId   IS NULL OR m.MV_Id = @MvId)
  AND (@DateDu IS NULL OR m.MV_Date >= @DateDu)
  AND (@DateAu IS NULL OR m.MV_Date <  DATEADD(DAY, 1, @DateAu));   -- MV_Date porte une heure : jour entier

------------------------------------------------------------------------------------------ 2. MOTIF DE BLOCAGE ÉVENTUEL (premier motif rencontré)
SELECT m.MV_Id, m.MV_Numero, m.MV_Date, m.MV_Montant,
       CASE WHEN m.MV_Remis <> 0                                                                         THEN 'REMIS_EN_BANQUE'
            WHEN m.MV_Impaye <> 0                                                                        THEN 'IMPAYE'
            WHEN m.MV_Point <> 0                                                                         THEN 'RAPPROCHE'
            WHEN m.MV_AVR <> 0                                                                           THEN 'REGLEMENT_AVOIR'
            WHEN EXISTS (SELECT 1 FROM GR_GOCOM.dbo.RT_HISTCOMPTA h WHERE h.MV_Id = m.MV_Id AND h.MV_Domaine = 0 AND h.SO_Id = @SocieteNo) THEN 'ENCORE_COMPTABILISE'
            WHEN EXISTS (SELECT 1 FROM GR_GOCOM.dbo.RT_AFFECTATION a WHERE a.MV_Id = m.MV_Id)           THEN 'AFFECTE'
            WHEN EXISTS (SELECT 1 FROM GR_GOCOM.dbo.RT_REMPLACEMENT p WHERE p.MV_Id = m.MV_Id OR p.MV_Remp = m.MV_Id) THEN 'REMPLACEMENT'
            WHEN EXISTS (SELECT 1 FROM GR_GOCOM.dbo.RT_CAUTION c WHERE c.MV_Id = m.MV_Id)               THEN 'CAUTION'
            WHEN EXISTS (SELECT 1 FROM GR_GOCOM.dbo.RT_ECHEANCE e WHERE e.EC_Type = 107 AND e.MV_RemboursementNo = m.MV_Id) THEN 'REMBOURSEMENT_FOURNISSEUR'
            WHEN EXISTS (SELECT 1 FROM GR_GOCOM.dbo.RT_LIGNEDOSSIER d WHERE d.MV_Id = m.MV_Id)          THEN 'DOSSIER_REGLEMENT'
            WHEN EXISTS (SELECT 1 FROM GR_GOCOM.dbo.RAPP_ReleveBancaire_Ligne r WHERE r.MV_ID = m.MV_Id) THEN 'RAPPROCHEMENT_BANCAIRE'
            WHEN EXISTS (SELECT 1 FROM GR_GOCOM.dbo.RT_NOTE n WHERE n.NO_EntiteId = m.MV_Id AND n.NO_EntiteType = 1) THEN 'NOTES'
            WHEN (SELECT COUNT(*) FROM GR_GOCOM.dbo.RT_HISTOMVT h WHERE h.MV_Id = m.MV_Id AND h.MV_Domaine = 0) <> 1 THEN 'HISTORIQUE_INATTENDU'
            ELSE NULL END AS Blocage
INTO #reg
FROM #mv m;

DECLARE @NbReg INT = (SELECT COUNT(*) FROM #reg WHERE Blocage IS NULL);

------------------------------------------------------------------------------------------ RÉSULTATS (aperçu)
SELECT 'RESUME' AS Section,
       (SELECT COUNT(*) FROM #mv)                         AS ReglementsEspeceNonCompta,
       @NbReg                                             AS ReglementsASupprimer,
       (SELECT COUNT(*) FROM #reg WHERE Blocage IS NOT NULL) AS ReglementsBloques,
       (SELECT ISNULL(SUM(MV_Montant), 0) FROM #reg WHERE Blocage IS NULL) AS MontantTotal,
       (SELECT MIN(MV_Date) FROM #reg WHERE Blocage IS NULL) AS DateMin,
       (SELECT MAX(MV_Date) FROM #reg WHERE Blocage IS NULL) AS DateMax;

SELECT 'BLOQUE_PAR_MOTIF' AS Section, Blocage, COUNT(*) AS Reglements
FROM #reg WHERE Blocage IS NOT NULL GROUP BY Blocage ORDER BY COUNT(*) DESC;

SELECT 'BLOQUE' AS Section, r.Blocage, r.MV_Id, r.MV_Numero, r.MV_Date, r.MV_Montant
FROM #reg r WHERE r.Blocage IS NOT NULL ORDER BY r.Blocage, r.MV_Id;

SELECT 'PAR_MOIS' AS Section, FORMAT(MV_Date, 'yyyy-MM') AS Mois, COUNT(*) AS Reglements, SUM(MV_Montant) AS Montant
FROM #reg WHERE Blocage IS NULL GROUP BY FORMAT(MV_Date, 'yyyy-MM') ORDER BY 2;

SELECT TOP 20 'EXEMPLES' AS Section, MV_Id, MV_Numero, MV_Date, MV_Montant FROM #reg WHERE Blocage IS NULL ORDER BY MV_Id;

------------------------------------------------------------------------------------------ APPLICATION
IF @Apply <> 1 BEGIN PRINT 'Aperçu uniquement (@Apply = 0). Rien n''a été modifié.'; RETURN; END
IF @NbReg = 0 BEGIN PRINT 'Rien à supprimer.'; RETURN; END
IF @NbReg > @MaxReglements BEGIN RAISERROR('Abandon : %d règlements > @MaxReglements (%d).', 16, 1, @NbReg, @MaxReglements); RETURN; END

DECLARE @Suffixe VARCHAR(12) = LEFT(REPLACE(CONVERT(VARCHAR(36), @Batch), '-', ''), 12);
DECLARE @BakMv SYSNAME = 'BAK_MV_' + @Suffixe, @BakHm SYSNAME = 'BAK_HM_' + @Suffixe, @sql NVARCHAR(MAX), @n INT;

BEGIN TRY
    BEGIN TRAN;

    -- 1. sauvegarde complète des lignes qui vont disparaître
    SET @sql = N'SELECT m.* INTO GR_GOCOM.dbo.' + QUOTENAME(@BakMv) + N' FROM GR_GOCOM.dbo.RT_MOUVEMENT m JOIN #reg r ON r.MV_Id = m.MV_Id AND r.Blocage IS NULL;';
    EXEC (@sql);
    SET @sql = N'SELECT h.* INTO GR_GOCOM.dbo.' + QUOTENAME(@BakHm) + N' FROM GR_GOCOM.dbo.RT_HISTOMVT h JOIN #reg r ON r.MV_Id = h.MV_Id AND r.Blocage IS NULL WHERE h.MV_Domaine = 0;';
    EXEC (@sql);

    -- 2. historique puis règlement (même ordre que la DLL)
    DELETE h FROM GR_GOCOM.dbo.RT_HISTOMVT h JOIN #reg r ON r.MV_Id = h.MV_Id AND r.Blocage IS NULL WHERE h.MV_Domaine = 0;
    SET @n = @@ROWCOUNT;
    IF @n <> @NbReg THROW 50001, 'Nombre de lignes RT_HISTOMVT supprimées différent du nombre attendu : annulation.', 1;

    DELETE m FROM GR_GOCOM.dbo.RT_MOUVEMENT m JOIN #reg r ON r.MV_Id = m.MV_Id AND r.Blocage IS NULL;
    SET @n = @@ROWCOUNT;
    IF @n <> @NbReg THROW 50002, 'Nombre de règlements supprimés différent du nombre attendu : annulation.', 1;

    -- 3. contrôle final : plus rien de ces règlements
    IF EXISTS (SELECT 1 FROM GR_GOCOM.dbo.RT_MOUVEMENT m JOIN #reg r ON r.MV_Id = m.MV_Id AND r.Blocage IS NULL)
       OR EXISTS (SELECT 1 FROM GR_GOCOM.dbo.RT_HISTOMVT h JOIN #reg r ON r.MV_Id = h.MV_Id AND r.Blocage IS NULL WHERE h.MV_Domaine = 0)
        THROW 50003, 'Contrôle final en échec : annulation.', 1;

    COMMIT;
    PRINT CONCAT(@NbReg, ' règlement(s) supprimé(s). BatchId = ', CONVERT(VARCHAR(36), @Batch), ' ; sauvegardes : ', @BakMv, ' et ', @BakHm);
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
END CATCH

/*
  UNDO — remet en place règlements et historiques supprimés, à partir des tables BAK_* affichées à l'application.
  Remplacer les deux noms ci-dessous. Les MV_Id / HM_Id d'origine sont conservés (IDENTITY_INSERT). Ne réinsère pas une ligne
  dont l'identifiant existe déjà.

  DECLARE @BakMv SYSNAME = 'BAK_MV_xxxxxxxxxxxx', @BakHm SYSNAME = 'BAK_HM_xxxxxxxxxxxx', @cols NVARCHAR(MAX), @sql NVARCHAR(MAX);
  BEGIN TRAN;
  SET @cols = STUFF((SELECT ',' + QUOTENAME(c.name) FROM GR_GOCOM.sys.columns c
                      WHERE c.object_id = OBJECT_ID('GR_GOCOM.dbo.RT_MOUVEMENT') AND c.system_type_id <> 189 AND c.is_computed = 0
                      ORDER BY c.column_id FOR XML PATH('')), 1, 1, '');
  SET @sql = N'SET IDENTITY_INSERT GR_GOCOM.dbo.RT_MOUVEMENT ON; INSERT GR_GOCOM.dbo.RT_MOUVEMENT (' + @cols + N') SELECT ' + @cols
           + N' FROM GR_GOCOM.dbo.' + QUOTENAME(@BakMv) + N' b WHERE NOT EXISTS (SELECT 1 FROM GR_GOCOM.dbo.RT_MOUVEMENT x WHERE x.MV_Id = b.MV_Id); SELECT @@ROWCOUNT AS ReglementsRestaures; SET IDENTITY_INSERT GR_GOCOM.dbo.RT_MOUVEMENT OFF;';
  EXEC (@sql);
  SET @cols = STUFF((SELECT ',' + QUOTENAME(c.name) FROM GR_GOCOM.sys.columns c
                      WHERE c.object_id = OBJECT_ID('GR_GOCOM.dbo.RT_HISTOMVT') AND c.system_type_id <> 189 AND c.is_computed = 0
                      ORDER BY c.column_id FOR XML PATH('')), 1, 1, '');
  SET @sql = N'SET IDENTITY_INSERT GR_GOCOM.dbo.RT_HISTOMVT ON; INSERT GR_GOCOM.dbo.RT_HISTOMVT (' + @cols + N') SELECT ' + @cols
           + N' FROM GR_GOCOM.dbo.' + QUOTENAME(@BakHm) + N' b WHERE NOT EXISTS (SELECT 1 FROM GR_GOCOM.dbo.RT_HISTOMVT x WHERE x.HM_Id = b.HM_Id); SELECT @@ROWCOUNT AS HistoriquesRestaures; SET IDENTITY_INSERT GR_GOCOM.dbo.RT_HISTOMVT OFF;';
  EXEC (@sql);
  COMMIT;   -- ou ROLLBACK
*/
