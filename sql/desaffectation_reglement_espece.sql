/*
  Suppression des AFFECTATIONS (imputations) des règlements clients ESPÈCE, avec remise à jour des soldes.
  Équivalent SQL de la DLL GRC : CaisseManager.AffectationDelete -> AffectationDeleteInternal (Tresorerie.Core.dll).

  Point de départ : RT_MOUVEMENT where MV_Type = 0 (espèce) and MV_Domaine = 0 (règlement client)
                    and CT_Type = 0 (tiers client) and MV_Compta = 0 (règlement NON comptabilisé, donc déjà décomptabilisé).
  Affectation = RT_AFFECTATION (MV_Id = règlement, EC_Id = échéance = facture).

  Ce que fait la DLL (repris ici), pour chaque affectation :
   - DELETE de la ligne RT_AFFECTATION ;
   - règlement : MV_Solde += AF_Montant, MV_SoldeDevise += AF_MtDevise ;
   - échéance (facture) : EC_Solde += AF_Montant, EC_SoldeDevise += AF_MtDevise, puis EC_DMP (délai moyen de paiement) recalculé ;
   - refus si : règlement annulé, affectation synchronisée avec l'ERP (AF_IsSynchro), incluse dans une déclaration TVA
     encaissement (DT_Id), échéance « droit de timbre », impayé / commission / intérêt, règlement ou échéance ajustés (écarts).

  Différences volontaires avec la DLL (garde-fous SQL) :
   - les SOLDES SONT RECALCULÉS, pas incrémentés : solde = montant − somme des affectations restantes (invariant vérifié à 100 %
     sur GR_GOCOM). Un solde déjà incohérent avant traitement bloque le règlement au lieu d'être aggravé ;
   - un règlement est traité en bloc : si UNE de ses affectations est bloquée, aucune n'est supprimée (pas d'état à moitié fait) ;
   - les cas d'écarts / ajustements / devise étrangère ne sont pas reproduits : ils sont signalés et laissés à la DLL / l'écran ;
   - refus si le règlement a encore des écritures dans RT_HISTCOMPTA (encore comptabilisé) ;
   - journal d'annulation dbo.LOG_DESAFFECTATION_SQL (lignes supprimées + anciens soldes), transaction unique, plafond @MaxAffectations.

  Limites : ne notifie pas les écrans ouverts (la DLL le fait via NotifyService) ; ne touche pas à Sage (une affectation
  synchronisée est refusée). Base : GR_GOCOM seulement.
  Usage : 1) renseigner @SocieteNo et la période ; 2) exécuter en @Apply = 0 et lire les résultats ; 3) puis @Apply = 1.
  Sauvegarde de GR_GOCOM OBLIGATOIRE avant @Apply = 1. Annulation : bloc UNDO en fin de fichier.
*/
-- Nettoyage des tables temporaires d'une exécution précédente dans la même fenêtre SSMS (lot séparé : sinon
-- « Nom de colonne non valide » car l'ancienne structure est encore là au moment de la compilation).
IF OBJECT_ID('tempdb..#mv')  IS NOT NULL DROP TABLE #mv;
IF OBJECT_ID('tempdb..#aff') IS NOT NULL DROP TABLE #aff;
IF OBJECT_ID('tempdb..#reg') IS NOT NULL DROP TABLE #reg;
IF OBJECT_ID('tempdb..#ech') IS NOT NULL DROP TABLE #ech;
GO
SET NOCOUNT ON;
SET XACT_ABORT ON;

------------------------------------------------------------------------------------------ PARAMÈTRES
DECLARE @SocieteNo        INT  = 1;            -- RT_MOUVEMENT.SO_Id — OBLIGATOIRE
DECLARE @Apply            BIT  = 0;            -- 0 = aperçu, 1 = applique
DECLARE @DateDu           DATE = '20260101';   -- filtre optionnel sur MV_Date (inclus) ; NULL = pas de borne
DECLARE @DateAu           DATE = '20260731';   -- filtre optionnel sur MV_Date (inclus, jour entier) ; NULL = pas de borne
DECLARE @MvId             INT  = NULL;         -- optionnel : un seul règlement (pour un premier test)
DECLARE @MaxAffectations  INT  = 10000;        -- garde-fou : refuse d'appliquer au-delà

DECLARE @Batch UNIQUEIDENTIFIER = NEWID();
IF @SocieteNo <= 0 BEGIN RAISERROR('Renseigner @SocieteNo.', 16, 1); RETURN; END

------------------------------------------------------------------------------------------ 1. RÈGLEMENTS ESPÈCE NON COMPTABILISÉS
IF OBJECT_ID('tempdb..#mv') IS NOT NULL DROP TABLE #mv;
SELECT m.MV_Id, m.MV_Numero, m.MV_Date, m.MV_Montant, m.MV_MtDevise, m.MV_Solde, m.MV_SoldeDevise, ISNULL(m.MV_Ajuste, 0) AS MV_Ajuste
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

------------------------------------------------------------------------------------------ 2. LEURS AFFECTATIONS + MOTIF DE BLOCAGE ÉVENTUEL (mêmes refus que la DLL)
IF OBJECT_ID('tempdb..#aff') IS NOT NULL DROP TABLE #aff;
SELECT a.AF_Id, a.MV_Id, a.EC_Id, a.AF_Montant, a.AF_MtDevise, e.DO_Numero, e.EC_Type,
       CASE WHEN e.EC_Id IS NULL                                             THEN 'ECHEANCE_INTROUVABLE'
            WHEN ISNULL(a.AF_IsSynchro, 0) <> 0                              THEN 'SYNCHRONISEE'
            WHEN a.DT_Id IS NOT NULL                                         THEN 'DECLARATION_TVA'
            WHEN e.EC_Type = 112                                             THEN 'DROIT_TIMBRE'
            WHEN e.EC_Type IN (1, 109, 110)                                  THEN 'ECHEANCE_IMPAYE'
            WHEN a.AF_EcId IS NOT NULL OR ISNULL(e.EC_Ajuste, 0) <> 0
                 OR m.MV_Ajuste <> 0 OR e.EC_Type IN (90, 91, 100, 101)      THEN 'ECART_OU_AJUSTEMENT'
            WHEN m.MV_MtDevise <> m.MV_Montant                               THEN 'DEVISE_ETRANGERE'
            WHEN EXISTS (SELECT 1 FROM GR_GOCOM.dbo.RT_REMPLACEMENT rp WHERE rp.AF_Id = a.AF_Id)  THEN 'REMPLACEMENT'
            WHEN EXISTS (SELECT 1 FROM GR_GOCOM.dbo.RT_DECLARATIONDELAISPAIEMENTLG dl WHERE dl.AF_Id = a.AF_Id) THEN 'DECLARATION_DELAIS_PAIEMENT'
            ELSE NULL END AS Blocage
INTO #aff
FROM #mv m
JOIN GR_GOCOM.dbo.RT_AFFECTATION a ON a.MV_Id = m.MV_Id
LEFT JOIN GR_GOCOM.dbo.RT_ECHEANCE e ON e.EC_Id = a.EC_Id;

-- Un règlement est retenu seulement si : il a des affectations, aucune n'est bloquée, il n'est plus comptabilisé,
-- et ses soldes actuels sont cohérents (montant − somme des affectations).
IF OBJECT_ID('tempdb..#reg') IS NOT NULL DROP TABLE #reg;
SELECT m.MV_Id, m.MV_Numero, m.MV_Date, m.MV_Montant, m.MV_MtDevise, m.MV_Solde, m.MV_SoldeDevise,
       COUNT(a.AF_Id) AS NbAff, SUM(a.AF_Montant) AS SommeAff, SUM(a.AF_MtDevise) AS SommeAffDevise,
       CASE WHEN COUNT(a.AF_Id) = 0                                                                      THEN 'AUCUNE_AFFECTATION'
            WHEN MAX(a.Blocage) IS NOT NULL                                                              THEN MAX(a.Blocage)
            WHEN EXISTS (SELECT 1 FROM GR_GOCOM.dbo.RT_HISTCOMPTA h
                         WHERE h.MV_Id = m.MV_Id AND h.MV_Domaine = 0 AND h.SO_Id = @SocieteNo)          THEN 'ENCORE_COMPTABILISE'
            WHEN ABS(m.MV_Solde - (m.MV_Montant - SUM(a.AF_Montant))) >= 0.005                           THEN 'SOLDE_REGLEMENT_INCOHERENT'
            ELSE NULL END AS Blocage,
       -- solde en devise faux mais devise = devise société (MV_MtDevise = MV_Montant, sinon DEVISE_ETRANGERE) : non bloquant,
       -- car après désaffectation MV_SoldeDevise = MV_MtDevise de toute façon (constaté sur 189 règlements en prod)
       CASE WHEN ABS(m.MV_SoldeDevise - (m.MV_MtDevise - SUM(a.AF_MtDevise))) >= 0.005 THEN 1 ELSE 0 END AS SoldeDeviseIncoherent
INTO #reg
FROM #mv m
LEFT JOIN #aff a ON a.MV_Id = m.MV_Id
GROUP BY m.MV_Id, m.MV_Numero, m.MV_Date, m.MV_Montant, m.MV_MtDevise, m.MV_Solde, m.MV_SoldeDevise;

------------------------------------------------------------------------------------------ 3. ÉCHÉANCES (FACTURES) CONCERNÉES : soldes actuels et soldes après suppression
IF OBJECT_ID('tempdb..#ech') IS NOT NULL DROP TABLE #ech;
SELECT e.EC_Id, e.DO_Numero, e.DO_Date, e.EC_Type, e.EC_Montant, e.EC_MtDevise, e.EC_Solde, e.EC_SoldeDevise, e.EC_DMP,
       tot.SommeAff, tot.SommeAffDevise,                                 -- toutes affectations actuelles de l'échéance
       ISNULL(sup.SommeSup, 0) AS SommeSup, ISNULL(sup.SommeSupDevise, 0) AS SommeSupDevise,   -- celles qui vont être supprimées
       CAST(NULL AS INT) AS NouveauDMP
INTO #ech
FROM GR_GOCOM.dbo.RT_ECHEANCE e
JOIN (SELECT EC_Id, SUM(AF_Montant) AS SommeAff, SUM(AF_MtDevise) AS SommeAffDevise
        FROM GR_GOCOM.dbo.RT_AFFECTATION WHERE EC_Id IN (SELECT EC_Id FROM #aff) GROUP BY EC_Id) tot ON tot.EC_Id = e.EC_Id
LEFT JOIN (SELECT a.EC_Id, SUM(a.AF_Montant) AS SommeSup, SUM(a.AF_MtDevise) AS SommeSupDevise
             FROM #aff a JOIN #reg r ON r.MV_Id = a.MV_Id AND r.Blocage IS NULL GROUP BY a.EC_Id) sup ON sup.EC_Id = e.EC_Id;

-- Une échéance dont le solde actuel est incohérent bloque les règlements qui y touchent (on n'aggrave pas un solde faux).
UPDATE r SET Blocage = 'SOLDE_FACTURE_INCOHERENT'
FROM #reg r
WHERE r.Blocage IS NULL
  AND EXISTS (SELECT 1 FROM #aff a JOIN #ech e ON e.EC_Id = a.EC_Id
              WHERE a.MV_Id = r.MV_Id
                AND (ABS(e.EC_Solde       - (e.EC_Montant  - e.SommeAff))       >= 0.005
                  OR ABS(e.EC_SoldeDevise - (e.EC_MtDevise - e.SommeAffDevise)) >= 0.005));

-- Après ce blocage, on recalcule les sommes « à supprimer » sur les règlements encore retenus
UPDATE e SET SommeSup = ISNULL(s.SommeSup, 0), SommeSupDevise = ISNULL(s.SommeSupDevise, 0)
FROM #ech e
LEFT JOIN (SELECT a.EC_Id, SUM(a.AF_Montant) AS SommeSup, SUM(a.AF_MtDevise) AS SommeSupDevise
             FROM #aff a JOIN #reg r ON r.MV_Id = a.MV_Id AND r.Blocage IS NULL GROUP BY a.EC_Id) s ON s.EC_Id = e.EC_Id;

-- Nouveau délai moyen de paiement : même formule que la DLL, sur les affectations RESTANTES de l'échéance
UPDATE e SET NouveauDMP =
    CASE WHEN e.EC_Type IN (0, 1, 4, 111) AND e.EC_MtDevise <> 0
         THEN CAST(ROUND(ISNULL(s.Somme, 0) / e.EC_MtDevise, 0) AS INT)
         ELSE 0 END
FROM #ech e
LEFT JOIN (SELECT x.EC_Id, SUM(x.AF_Montant * DATEDIFF(DAY, CAST(ee.DO_Date AS DATE), CAST(mv.MV_Echeance AS DATE))) AS Somme
             FROM GR_GOCOM.dbo.RT_AFFECTATION x
             JOIN GR_GOCOM.dbo.RT_MOUVEMENT mv ON mv.MV_Id = x.MV_Id
             JOIN #ech ee ON ee.EC_Id = x.EC_Id
            WHERE NOT EXISTS (SELECT 1 FROM #aff a JOIN #reg r ON r.MV_Id = a.MV_Id AND r.Blocage IS NULL WHERE a.AF_Id = x.AF_Id)
            GROUP BY x.EC_Id) s ON s.EC_Id = e.EC_Id;

DECLARE @NbAff INT = (SELECT COUNT(*) FROM #aff a JOIN #reg r ON r.MV_Id = a.MV_Id AND r.Blocage IS NULL);

------------------------------------------------------------------------------------------ RÉSULTATS (aperçu)
SELECT 'RESUME' AS Section,
       (SELECT COUNT(*) FROM #mv)                                            AS ReglementsEspeceNonCompta,
       (SELECT COUNT(*) FROM #reg WHERE Blocage IS NULL)                     AS ReglementsRetenus,
       (SELECT COUNT(*) FROM #reg WHERE Blocage = 'AUCUNE_AFFECTATION')      AS SansAffectation,
       (SELECT COUNT(*) FROM #reg WHERE Blocage IS NOT NULL AND Blocage <> 'AUCUNE_AFFECTATION') AS ReglementsBloques,
       @NbAff                                                                AS AffectationsASupprimer,
       (SELECT COUNT(DISTINCT a.EC_Id) FROM #aff a JOIN #reg r ON r.MV_Id = a.MV_Id AND r.Blocage IS NULL) AS FacturesImpactees,
       (SELECT ISNULL(SUM(a.AF_Montant), 0) FROM #aff a JOIN #reg r ON r.MV_Id = a.MV_Id AND r.Blocage IS NULL) AS MontantTotalDesaffecte,
       (SELECT COUNT(*) FROM #reg WHERE Blocage IS NULL AND SoldeDeviseIncoherent = 1) AS DontSoldeDeviseCorrige;

-- Décompte des blocages par motif
SELECT 'BLOQUE_PAR_MOTIF' AS Section, r.Blocage, COUNT(*) AS Reglements, SUM(r.NbAff) AS Affectations
FROM #reg r WHERE r.Blocage IS NOT NULL AND r.Blocage <> 'AUCUNE_AFFECTATION' GROUP BY r.Blocage ORDER BY COUNT(*) DESC;

-- Règlements bloqués (rien n'est supprimé pour eux) : à traiter par l'écran GRC / la DLL
SELECT 'BLOQUE' AS Section, r.Blocage, r.MV_Id, r.MV_Numero, r.MV_Date, r.NbAff, r.MV_Montant, r.MV_Solde
FROM #reg r WHERE r.Blocage IS NOT NULL AND r.Blocage <> 'AUCUNE_AFFECTATION' ORDER BY r.Blocage, r.MV_Id;

-- Détail des affectations retenues : soldes avant / après (règlement et facture)
SELECT 'APERCU' AS Section, r.MV_Id, r.MV_Numero, a.AF_Id, a.DO_Numero AS Facture, a.AF_Montant,
       r.MV_Solde AS SoldeReglementAvant, r.MV_Montant AS SoldeReglementApres,
       e.EC_Solde AS SoldeFactureAvant, e.EC_Solde + e.SommeSup AS SoldeFactureApres, e.EC_Montant AS MontantFacture,
       e.EC_DMP AS DMPAvant, e.NouveauDMP AS DMPApres
FROM #aff a
JOIN #reg r ON r.MV_Id = a.MV_Id AND r.Blocage IS NULL
JOIN #ech e ON e.EC_Id = a.EC_Id
ORDER BY r.MV_Id, a.AF_Id;

------------------------------------------------------------------------------------------ APPLICATION
IF @Apply <> 1 BEGIN PRINT 'Aperçu uniquement (@Apply = 0). Rien n''a été modifié.'; RETURN; END
IF @NbAff = 0 BEGIN PRINT 'Rien à supprimer.'; RETURN; END
IF @NbAff > @MaxAffectations BEGIN RAISERROR('Abandon : %d affectations > @MaxAffectations (%d).', 16, 1, @NbAff, @MaxAffectations); RETURN; END

IF OBJECT_ID(N'GR_GOCOM.dbo.LOG_DESAFFECTATION_SQL') IS NULL
    CREATE TABLE GR_GOCOM.dbo.LOG_DESAFFECTATION_SQL (
        Id                INT IDENTITY(1,1) PRIMARY KEY,
        BatchId           UNIQUEIDENTIFIER NOT NULL,
        RunAt             DATETIME2(0)     NOT NULL DEFAULT SYSDATETIME(),
        RunBy             SYSNAME          NOT NULL DEFAULT SUSER_SNAME(),
        SocieteNo         INT              NOT NULL,
        Cible             VARCHAR(20)      NOT NULL,   -- 'RT_AFFECTATION' | 'RT_MOUVEMENT' | 'RT_ECHEANCE'
        CleId             INT              NOT NULL,   -- AF_Id | MV_Id | EC_Id
        AF_No             INT NULL, AF_Date DATETIME NULL, AF_Montant DECIMAL(38,10) NULL, AF_MvId INT NULL, AF_EcheanceId INT NULL,
        AF_MtDevise       DECIMAL(38,10) NULL, AF_EcId INT NULL, AF_NbrJourReg INT NULL, AF_DelaiMoyen DECIMAL(38,10) NULL,
        DT_Id             INT NULL, AF_IsSynchro INT NULL, AF_IsImporterFromErp BIT NULL,
        AncienSolde       DECIMAL(38,10) NULL, AncienSoldeDevise DECIMAL(38,10) NULL, AncienDMP INT NULL, AncienDateModif DATETIME NULL
    );

DECLARE @n INT;
BEGIN TRY
    BEGIN TRAN;

    -- règlements : solde = montant (plus aucune affectation)
    UPDATE m SET MV_Solde = m.MV_Montant, MV_SoldeDevise = m.MV_MtDevise, MV_DateModif = GETDATE()
    OUTPUT @Batch, @SocieteNo, 'RT_MOUVEMENT', deleted.MV_Id, deleted.MV_Solde, deleted.MV_SoldeDevise, deleted.MV_DateModif
      INTO GR_GOCOM.dbo.LOG_DESAFFECTATION_SQL (BatchId, SocieteNo, Cible, CleId, AncienSolde, AncienSoldeDevise, AncienDateModif)
    FROM GR_GOCOM.dbo.RT_MOUVEMENT m JOIN #reg r ON r.MV_Id = m.MV_Id AND r.Blocage IS NULL;
    SET @n = @@ROWCOUNT;
    IF @n <> (SELECT COUNT(*) FROM #reg WHERE Blocage IS NULL) THROW 50001, 'Nombre de règlements modifiés inattendu : annulation.', 1;

    -- affectations : suppression
    DELETE a
    OUTPUT @Batch, @SocieteNo, 'RT_AFFECTATION', deleted.AF_Id, deleted.AF_No, deleted.AF_Date, deleted.AF_Montant, deleted.MV_Id, deleted.EC_Id,
           deleted.AF_MtDevise, deleted.AF_EcId, deleted.AF_NbrJourReg, deleted.AF_DelaiMoyen, deleted.DT_Id, deleted.AF_IsSynchro, deleted.AF_IsImporterFromErp
      INTO GR_GOCOM.dbo.LOG_DESAFFECTATION_SQL (BatchId, SocieteNo, Cible, CleId, AF_No, AF_Date, AF_Montant, AF_MvId, AF_EcheanceId,
           AF_MtDevise, AF_EcId, AF_NbrJourReg, AF_DelaiMoyen, DT_Id, AF_IsSynchro, AF_IsImporterFromErp)
    FROM GR_GOCOM.dbo.RT_AFFECTATION a
    JOIN #aff x ON x.AF_Id = a.AF_Id
    JOIN #reg r ON r.MV_Id = x.MV_Id AND r.Blocage IS NULL;
    SET @n = @@ROWCOUNT;
    IF @n <> @NbAff THROW 50002, 'Nombre d''affectations supprimées différent du nombre attendu : annulation.', 1;

    -- factures : solde + montants désaffectés, DMP recalculé
    UPDATE e SET EC_Solde = e.EC_Solde + t.SommeSup, EC_SoldeDevise = e.EC_SoldeDevise + t.SommeSupDevise, EC_DMP = t.NouveauDMP
    OUTPUT @Batch, @SocieteNo, 'RT_ECHEANCE', deleted.EC_Id, deleted.EC_Solde, deleted.EC_SoldeDevise, deleted.EC_DMP
      INTO GR_GOCOM.dbo.LOG_DESAFFECTATION_SQL (BatchId, SocieteNo, Cible, CleId, AncienSolde, AncienSoldeDevise, AncienDMP)
    FROM GR_GOCOM.dbo.RT_ECHEANCE e JOIN #ech t ON t.EC_Id = e.EC_Id
    WHERE EXISTS (SELECT 1 FROM #aff a JOIN #reg r ON r.MV_Id = a.MV_Id AND r.Blocage IS NULL WHERE a.EC_Id = e.EC_Id);

    -- contrôle final : plus aucun écart solde / affectations sur les règlements et factures touchés
    IF EXISTS (SELECT 1 FROM GR_GOCOM.dbo.RT_MOUVEMENT m JOIN #reg r ON r.MV_Id = m.MV_Id AND r.Blocage IS NULL
                WHERE ABS(m.MV_Solde - (m.MV_Montant - ISNULL((SELECT SUM(AF_Montant) FROM GR_GOCOM.dbo.RT_AFFECTATION WHERE MV_Id = m.MV_Id), 0))) >= 0.005)
       OR EXISTS (SELECT 1 FROM GR_GOCOM.dbo.RT_ECHEANCE e JOIN #ech t ON t.EC_Id = e.EC_Id
                WHERE EXISTS (SELECT 1 FROM #aff a JOIN #reg r ON r.MV_Id = a.MV_Id AND r.Blocage IS NULL WHERE a.EC_Id = e.EC_Id)   -- seulement les factures modifiées
                  AND (ABS(e.EC_Solde - (e.EC_Montant - ISNULL((SELECT SUM(AF_Montant) FROM GR_GOCOM.dbo.RT_AFFECTATION WHERE EC_Id = e.EC_Id), 0))) >= 0.005
                    OR ABS(e.EC_SoldeDevise - (e.EC_MtDevise - ISNULL((SELECT SUM(AF_MtDevise) FROM GR_GOCOM.dbo.RT_AFFECTATION WHERE EC_Id = e.EC_Id), 0))) >= 0.005))
        THROW 50003, 'Contrôle final des soldes en échec : annulation.', 1;

    COMMIT;
    PRINT CONCAT(@NbAff, ' affectation(s) supprimée(s). BatchId = ', CONVERT(VARCHAR(36), @Batch));
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
END CATCH

/*
  UNDO — à lancer à la main avec le BatchId affiché à l'application.
  Réinsère les affectations supprimées (mêmes AF_Id), puis recalcule les soldes depuis les affectations en base
  (donc correct même si d'autres affectations ont été faites entre-temps) ; le DMP est restauré depuis le journal.

  BEGIN TRAN;
  SET IDENTITY_INSERT GR_GOCOM.dbo.RT_AFFECTATION ON;
  INSERT GR_GOCOM.dbo.RT_AFFECTATION (AF_Id, AF_No, AF_Date, AF_Montant, MV_Id, EC_Id, AF_MtDevise, AF_EcId, AF_NbrJourReg, AF_DelaiMoyen, DT_Id, AF_IsSynchro, AF_IsImporterFromErp)
  SELECT l.CleId, l.AF_No, l.AF_Date, l.AF_Montant, l.AF_MvId, l.AF_EcheanceId, l.AF_MtDevise, l.AF_EcId, l.AF_NbrJourReg, l.AF_DelaiMoyen, l.DT_Id, l.AF_IsSynchro, l.AF_IsImporterFromErp
  FROM GR_GOCOM.dbo.LOG_DESAFFECTATION_SQL l
  WHERE l.BatchId = '<BatchId>' AND l.Cible = 'RT_AFFECTATION'
    AND NOT EXISTS (SELECT 1 FROM GR_GOCOM.dbo.RT_AFFECTATION x WHERE x.AF_Id = l.CleId);
  SELECT @@ROWCOUNT AS AffectationsRestaurees;      -- attendu : le nombre affiché à l'application
  SET IDENTITY_INSERT GR_GOCOM.dbo.RT_AFFECTATION OFF;

  UPDATE m SET MV_Solde       = m.MV_Montant  - ISNULL((SELECT SUM(AF_Montant)  FROM GR_GOCOM.dbo.RT_AFFECTATION WHERE MV_Id = m.MV_Id), 0),
               MV_SoldeDevise = m.MV_MtDevise - ISNULL((SELECT SUM(AF_MtDevise) FROM GR_GOCOM.dbo.RT_AFFECTATION WHERE MV_Id = m.MV_Id), 0)
  FROM GR_GOCOM.dbo.RT_MOUVEMENT m
  WHERE m.MV_Id IN (SELECT CleId FROM GR_GOCOM.dbo.LOG_DESAFFECTATION_SQL WHERE BatchId = '<BatchId>' AND Cible = 'RT_MOUVEMENT');

  UPDATE e SET EC_Solde       = e.EC_Montant  - ISNULL((SELECT SUM(AF_Montant)  FROM GR_GOCOM.dbo.RT_AFFECTATION WHERE EC_Id = e.EC_Id), 0),
               EC_SoldeDevise = e.EC_MtDevise - ISNULL((SELECT SUM(AF_MtDevise) FROM GR_GOCOM.dbo.RT_AFFECTATION WHERE EC_Id = e.EC_Id), 0),
               EC_DMP         = l.AncienDMP
  FROM GR_GOCOM.dbo.RT_ECHEANCE e
  JOIN GR_GOCOM.dbo.LOG_DESAFFECTATION_SQL l ON l.Cible = 'RT_ECHEANCE' AND l.CleId = e.EC_Id AND l.BatchId = '<BatchId>';
  COMMIT;   -- ou ROLLBACK
*/
