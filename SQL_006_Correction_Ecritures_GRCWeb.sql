/* =============================================================================================
   SQL_006 — Correction des écritures comptables produites par GRC Web depuis le 01/07/2026
   ---------------------------------------------------------------------------------------------
   OBJET
     Les règlements comptabilisés AVANT la livraison des correctifs (libellé / pièce / référence)
     portent des valeurs obsolètes dans Sage. Ce script les réaligne sur la vue
     vw_ReglementsAComptabiliser, qui est la source de vérité (même valeurs que celles que la
     comptabilisation écrirait aujourd'hui).

   MODE D'EMPLOI
     1. Jouer TEL QUEL (@Appliquer = 0) : AUCUNE écriture, uniquement le rapport avant/après.
     2. Lire le rapport, vérifier les volumes et l'échantillon.
     3. Repasser avec @Appliquer = 1 pour appliquer, sous transaction.

   PÉRIMÈTRE — volontairement étroit
     Uniquement les règlements dont la DATE (MV_Date) est >= @DateDebut : on reste sur la période
     comptable ouverte. L'historique antérieur vient de l'ancienne application WinForm : ses
     conventions ne sont PAS celles de la vue. L'aligner ne corrigerait rien, il réécrirait des
     années de comptabilité.

     LIMITE CONNUE ET ASSUMÉE (décision PO du 15/07/2026, mesurée sur la prod) :
       borner sur MV_Date laisse hors périmètre 232 règlements (464 écritures) datés de mai-juin
       mais COMPTABILISÉS en juillet par GRC Web — ils conservent donc un libellé erroné.
       Exemple : MV 38673, réglé le 26/05, écriture créée le 03/07, libellé
       « Règ. FA [FAG2629595]-BL[BLG2601833] » au lieu de « ESP FAG2629595 ».
       Le périmètre alternatif (e.cbCreation >= @DateDebut) les couvre et englobe entièrement
       celui-ci (3 932 écritures / 1 966 règlements contre 3 468 / 1 734 ; aucun cas capturé par
       MV_Date ne l'est pas par cbCreation). À rouvrir si ces 232 règlements doivent être corrigés.

   GARDES (chacune répond à un risque constaté en base, pas théorique)
     - Lien corroboré (montant + journal) : sur l'ensemble de l'historique, 87 correspondances
       HC_No = cbMarq sont INCOHÉRENTES. Sans cette garde, l'UPDATE toucherait des écritures
       étrangères au règlement.
     - EC_Cloture = 0        : on ne touche pas une écriture d'une période clôturée.
     - cbHash vide           : on ne touche pas une écriture scellée (inaltérabilité).
     - Jamais de valeur vide : on ne remplace jamais une valeur renseignée par du vide.
     - Longueurs Sage        : contrôle préalable, le script s'arrête si un dépassement apparaît.

   HORS PÉRIMÈTRE — assumé
     - DocNumero1/2 : leur calcul vit dans le C# (CalculerDocNumeros), pas dans la vue. Le
       réimplémenter en T-SQL dupliquerait la règle métier et la ferait diverger. À traiter à part.
     - RT_HISTCOMPTA : table GRC pilotée par la DLL. On ne la réécrit pas en SQL brut. Elle reste
       la trace de ce qui a été envoyé à l'époque ; Sage porte la valeur corrigée.

   NB DATE : les littéraux sont en 'YYYYMMDD' (style 112). En session française (DATEFORMAT dmy),
   '2026-07-01' est lu « 7 janvier 2026 » — piège vérifié sur ce serveur.
   ============================================================================================= */

/* Options de session EXIGÉES par F_ECRITUREC : la table porte des index sur colonnes calculées.
   Sans elles, l'UPDATE échoue (« Échec de UPDATE car les options SET suivantes comportent des
   paramètres incorrects : QUOTED_IDENTIFIER ») — constaté au test sous sqlcmd, qui ne les pose pas
   par défaut. SSMS les pose, mais on ne dépend pas de l'outil utilisé.
   Le GO est nécessaire : QUOTED_IDENTIFIER agit à l'analyse du lot, pas à son exécution. */
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET ARITHABORT ON;
SET NUMERIC_ROUNDABORT OFF;
GO

SET NOCOUNT ON;

DECLARE @DateDebut    datetime = CONVERT(datetime, '20260701', 112);  -- mise en service GRC Web
DECLARE @Appliquer    bit = 0;   -- 0 = dry-run (lecture seule) | 1 = applique les UPDATE
DECLARE @FixLibelle   bit = 1;   -- EC_Intitule
DECLARE @FixPiece     bit = 1;   -- EC_Piece    (identifiant comptable fort — accord PO du 15/07/2026)
DECLARE @FixReference bit = 1;   -- EC_Reference
DECLARE @NbEchantillon int = 0;  -- lignes affichées dans l'échantillon du rapport. 0 = TOUTES.

-- ---------------------------------------------------------------------------------------------
-- 1. Périmètre
-- ---------------------------------------------------------------------------------------------
IF OBJECT_ID('tempdb..#Cible') IS NOT NULL DROP TABLE #Cible;

SELECT
    h.MV_Id,
    e.cbMarq,
    e.EC_Intitule                                        AS LibelleActuel,
    e.EC_Piece                                           AS PieceActuelle,
    e.EC_Reference                                       AS RefActuelle,
    LTRIM(RTRIM(ISNULL(v.LibelleEcriture, '')))          AS LibelleCible,
    LTRIM(RTRIM(ISNULL(v.MV_Piece, '')))                 AS PieceCible,
    LTRIM(RTRIM(ISNULL(v.ReferenceCompta, '')))          AS RefCible
INTO #Cible
FROM       RT_HISTCOMPTA h
INNER JOIN GOCOM.dbo.F_ECRITUREC e ON e.cbMarq = h.HC_No
INNER JOIN vw_ReglementsAComptabiliser v ON v.MV_ID = h.MV_Id
WHERE  v.MV_Date >= @DateDebut                                 -- période comptable ouverte (cf. LIMITE en tête)
  AND  h.HC_Montant = e.EC_Montant                             -- lien corroboré (montant)
  AND  LTRIM(RTRIM(h.HC_Journal)) = LTRIM(RTRIM(e.JO_Num))     -- lien corroboré (journal)
  AND  e.EC_Cloture = 0                                        -- pas de période clôturée
  AND  (e.cbHash IS NULL OR LTRIM(RTRIM(e.cbHash)) = '');      -- pas d'écriture scellée

-- ---------------------------------------------------------------------------------------------
-- 2. Contrôle préalable bloquant : longueurs Sage (EC_Intitule 69 / EC_Piece 13 / EC_Reference 17)
-- ---------------------------------------------------------------------------------------------
IF EXISTS (SELECT 1 FROM #Cible
           WHERE LEN(LibelleCible) > 69 OR LEN(PieceCible) > 13 OR LEN(RefCible) > 17)
BEGIN
    SELECT 'ARRET — dépassement de longueur, la vue doit tronquer' AS Erreur, MV_Id, cbMarq,
           LEN(LibelleCible) AS LgLibelle, LEN(PieceCible) AS LgPiece, LEN(RefCible) AS LgRef
    FROM   #Cible
    WHERE  LEN(LibelleCible) > 69 OR LEN(PieceCible) > 13 OR LEN(RefCible) > 17;
    RETURN;
END

-- ---------------------------------------------------------------------------------------------
-- 3. Rapport
-- ---------------------------------------------------------------------------------------------
SELECT 'Périmètre' AS Rapport, COUNT(*) AS Ecritures, COUNT(DISTINCT MV_Id) AS Reglements FROM #Cible;

SELECT 'Libellé à corriger'   AS Rapport, COUNT(*) AS Nb FROM #Cible
WHERE  LTRIM(RTRIM(ISNULL(LibelleActuel,''))) <> LibelleCible AND LibelleCible <> '';

SELECT 'Pièce à corriger'     AS Rapport, COUNT(*) AS Nb FROM #Cible
WHERE  LTRIM(RTRIM(ISNULL(PieceActuelle,''))) <> PieceCible AND PieceCible <> '';

SELECT 'Référence à corriger' AS Rapport, COUNT(*) AS Nb FROM #Cible
WHERE  LTRIM(RTRIM(ISNULL(RefActuelle,''))) <> RefCible AND RefCible <> '';

-- Lignes IGNORÉES parce que la cible est vide : on ne détruit jamais une information existante.
SELECT 'IGNORÉ — cible vide, valeur actuelle conservée' AS Rapport, COUNT(*) AS Nb FROM #Cible
WHERE  (LibelleCible = '' AND LTRIM(RTRIM(ISNULL(LibelleActuel,''))) <> '')
   OR  (PieceCible   = '' AND LTRIM(RTRIM(ISNULL(PieceActuelle,''))) <> '')
   OR  (RefCible     = '' AND LTRIM(RTRIM(ISNULL(RefActuelle,''))) <> '');

-- Échantillon : TOUTE ligne dont au moins un des champs réellement corrigés changerait.
-- Les colonnes ...Change disent, ligne par ligne, ce que l'UPDATE touchera — c'est la liste à relire.
SELECT TOP (CASE WHEN @NbEchantillon = 0 THEN 2147483647 ELSE @NbEchantillon END)
       'Échantillon avant -> après' AS Rapport, MV_Id, cbMarq,
       CASE WHEN @FixLibelle   = 1 AND LibelleCible <> '' AND LTRIM(RTRIM(ISNULL(LibelleActuel,''))) <> LibelleCible THEN 'OUI' ELSE '' END AS LibelleChange,
       LibelleActuel, LibelleCible,
       CASE WHEN @FixPiece     = 1 AND PieceCible   <> '' AND LTRIM(RTRIM(ISNULL(PieceActuelle,''))) <> PieceCible   THEN 'OUI' ELSE '' END AS PieceChange,
       PieceActuelle, PieceCible,
       CASE WHEN @FixReference = 1 AND RefCible     <> '' AND LTRIM(RTRIM(ISNULL(RefActuelle,'')))   <> RefCible     THEN 'OUI' ELSE '' END AS RefChange,
       RefActuelle, RefCible
FROM   #Cible
WHERE  (@FixLibelle   = 1 AND LibelleCible <> '' AND LTRIM(RTRIM(ISNULL(LibelleActuel,''))) <> LibelleCible)
   OR  (@FixPiece     = 1 AND PieceCible   <> '' AND LTRIM(RTRIM(ISNULL(PieceActuelle,''))) <> PieceCible)
   OR  (@FixReference = 1 AND RefCible     <> '' AND LTRIM(RTRIM(ISNULL(RefActuelle,'')))   <> RefCible)
ORDER BY MV_Id;

-- ---------------------------------------------------------------------------------------------
-- 4. Application
-- ---------------------------------------------------------------------------------------------
IF @Appliquer = 0
BEGIN
    SELECT 'DRY-RUN — aucune écriture modifiée. Passer @Appliquer = 1 pour appliquer.' AS Etat;
    DROP TABLE #Cible;
    RETURN;
END

BEGIN TRY
    BEGIN TRANSACTION;

    IF @FixLibelle = 1
        UPDATE e SET e.EC_Intitule = c.LibelleCible
        FROM   GOCOM.dbo.F_ECRITUREC e
        INNER JOIN #Cible c ON c.cbMarq = e.cbMarq
        WHERE  c.LibelleCible <> ''
          AND  LTRIM(RTRIM(ISNULL(e.EC_Intitule,''))) <> c.LibelleCible;
    SELECT 'Libellés corrigés' AS Etat, @@ROWCOUNT AS Nb;

    IF @FixPiece = 1
        UPDATE e SET e.EC_Piece = c.PieceCible
        FROM   GOCOM.dbo.F_ECRITUREC e
        INNER JOIN #Cible c ON c.cbMarq = e.cbMarq
        WHERE  c.PieceCible <> ''
          AND  LTRIM(RTRIM(ISNULL(e.EC_Piece,''))) <> c.PieceCible;
    SELECT 'Pièces corrigées' AS Etat, @@ROWCOUNT AS Nb;

    IF @FixReference = 1
        UPDATE e SET e.EC_Reference = c.RefCible
        FROM   GOCOM.dbo.F_ECRITUREC e
        INNER JOIN #Cible c ON c.cbMarq = e.cbMarq
        WHERE  c.RefCible <> ''
          AND  LTRIM(RTRIM(ISNULL(e.EC_Reference,''))) <> c.RefCible;
    SELECT 'Références corrigées' AS Etat, @@ROWCOUNT AS Nb;

    COMMIT TRANSACTION;
    SELECT 'OK — modifications validées' AS Etat;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    SELECT 'ECHEC — tout a été annulé' AS Etat, ERROR_NUMBER() AS NumErreur, ERROR_MESSAGE() AS Message;
END CATCH

DROP TABLE #Cible;
