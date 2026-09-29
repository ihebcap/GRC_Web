-- =============================================================================
-- SQL_007 — vMetaRecouvrementBL : recouvrement par BL correct + perf Metabase
-- Base : GR_GOCOM
-- Contexte : demande PO 2026-07-16 (lenteur Metabase + recouvrement faux). Voir
-- TASKS/TASK-056.md pour l'analyse complète (2 bugs confirmés + 2 causes de lenteur ;
-- une 3e hypothèse de bug a été testée en base et invalidée, cf. section 0(c) retirée).
--
-- MODE D'EMPLOI — à jouer dans l'ordre, section par section :
--   0. Diagnostic (lecture seule)   -> lire les compteurs avant de toucher à la vue.
--   1. Index (idempotents)          -> à valider avec l'admin GOCOM (tables ERP partagées).
--   2. ALTER VIEW
--
-- Corrections apportées (détail dans TASK-056.md) :
--   1. Répartition d'un versement multi-BL ('#') : FIFO par date de BL (le plus ancien
--      soldé en premier), au lieu d'un GROUP BY MV_Reference qui ne matchait jamais un
--      BL individuel (TotalReglement = 0 sur tout versement groupé).
--   2. BL éclaté sur plusieurs clients : restitué en UNE ligne par BL (décision PO :
--      "visibilité par BL"), NbClients exposé à titre indicatif. Avant : une ligne par
--      fragment client, règlement total dupliqué sur chaque fragment (triple comptage).
--   3. (retiré) Une hypothèse de bug sur FA_BL (DO_Piece vs DL_PieceBL) a été testée en
--      base et INVALIDÉE : la version d'origine (DO_Piece vs DO_Piece) exclut 3012 BL,
--      la variante proposée 0 -> FA_BL est laissée STRICTEMENT INCHANGÉE.
--   4. FG_DOCENTETE_SAUV scannée sans aucun filtre (tout l'historique, tous dépôts) ->
--      même filtre EXISTS(account) que les deux autres branches du UNION ALL.
--   5. Dédoublonnage explicite des 3 sources de "Documents" par DO_Piece (ROW_NUMBER,
--      même pattern que DocParPiece dans SQL_005/vw_ReglementsAComptabiliser) : une
--      pièce archivée en SAUV et reconstruite depuis F_DOCLIGNE ne compte plus 2 fois.
--   6. RT_ECHEANCE : LEFT JOIN 1-N remplacé par OUTER APPLY SUM(EC_Solde) -> plus de
--      duplication de lignes (fan-out) si une pièce a plusieurs échéances.
--
-- MODIFIÉ 2026-07-16 (v2, incident perf ~3-4 min en base, cf. TASK-056.md) :
--   7. CTE account/dep (et toutes ses jointures/EXISTS) SUPPRIMÉES à la demande PO.
--      /!\ RISQUE SIGNALÉ AU PO ET CONFIRMÉ MALGRÉ TOUT : si le sandbox Metabase sur
--      cette vue filtre sur la colonne A_EMAIL (mécanisme standard de sandboxing
--      Metabase), cette colonne n'existe plus en sortie -> le sandbox n'a plus rien
--      sur quoi filtrer, plus aucune restriction par dépôt nulle part. Décision PO
--      assumée explicitement (deux fois demandé, deux fois confirmé "retirer tout").
--   Cette suppression NE RÉSOUT PAS le temps d'exécution (~3-4 min mesuré par le PO,
--   66M lectures logiques F_DOCLIGNE / 7M RT_ECHEANCE) : la cause dominante est que
--   `Documents` est référencée 2 fois (SELECT final + JOIN dans ReglementAlloc) et
--   qu'une CTE n'est jamais matérialisée -> le plan recalcule tout le sous-arbre
--   (donc F_DOCLIGNE) une fois par ligne consommée en aval. Fix durable cadré à part :
--   voir TASK-058 (table persistée des affectations BL/règlement, pas encore livrée).
--
-- MODIFIÉ 2026-07-16 (v3) : OUTER APPLY corrélé sur RT_ECHEANCE remplacé par un
--   LEFT JOIN sur sous-requête pré-agrégée (GROUP BY DO_Numero) -> RT_ECHEANCE scannée
--   1 seule fois au total au lieu d'une fois par ligne de Documents (19521 scans / 30M
--   lectures mesurés après retrait account/dep -> corrigé, cf. TASK-056.md).
--
-- MODIFIÉ 2026-07-16 (v4) : 8. Filtre DepotsFacturation (décision PO) : n'affiche que
--   les BL/factures des dépôts présents dans GOCOM.dbo.FG_DEPOTFACTURATION, rapprochés
--   de F_DEPOT via F_DEPOT.cbMarq = FG_DEPOTFACTURATION.DP_Id (mapping confirmé par le
--   PO, non déductible du schéma seul -- cbMarq est normalement une colonne technique
--   Sage). 30 dépôts sur 213 aujourd'hui ; 704 lignes F_DOCLIGNE/27 359 (2,6%) hors
--   périmètre mesurées en base avant application.
--
-- MODIFIÉ 2026-07-16 (v5) : 9. NOUVEAU BUG confirmé en base et corrigé (signalé par le
--   PO) : une facture F_DOCENTETE issue de l'éclatement d'un BL (F_DOCENTETE.DO_Coord03
--   = numéro du BL d'origine, ex. FAG2619796.DO_Coord03 = 'BLG2601262') n'était PAS
--   exclue quand ce BL d'origine existe déjà dans FG_DOCENTETE_SAUV -> le même BL était
--   compté deux fois (une fois via FG_DOCENTETE_SAUV pour le total du BL, une fois par
--   facture éclatée pour la part de chaque client). Mesuré : 22293/22294 factures
--   F_DOCENTETE avec DO_Coord03 renseigné pointent vers un BL déjà en SAUV ; 51 factures
--   concernées dans le périmètre des 30 dépôts facturants actuellement affichées en
--   double (exemple vérifié : BLG2601262 = 940 021,25 -> 47 factures de 19 879,88
--   chacune, soit ~940K comptés une 2e fois). Fix : NOT EXISTS sur FG_DOCENTETE_SAUV
--   dans la branche F_DOCENTETE de DocumentsRaw. Pas de nouvel index nécessaire :
--   FG_DOCENTETE_SAUV ne fait que 1328 lignes -> hash anti-join, pas de scan répété
--   (contrairement au CTE account/RT_ECHEANCE, ici le côté "build" est minuscule).
--
-- MODIFIÉ 2026-07-16 (v6) : 10. Filtre DepotsFacturation RETIRÉ de la branche
--   FG_DOCENTETE_SAUV (décision PO) : toutes les lignes de cette table doivent sortir
--   sans exception, DE_No reste une colonne de sortie pour permettre un filtrage côté
--   reporting (Metabase) plutôt qu'un filtrage figé dans la vue. Vérifié en base : 1328
--   lignes SAUV, DE_No jamais NULL, 18 dépôts distincts, tous déjà dans les 30 dépôts
--   facturants (0 impact de volume aujourd'hui, changement par principe/robustesse
--   future).
--
-- MODIFIÉ 2026-07-16 (v7) : 11. SUPERSEDE v4/v6 -- décision PO étendue : le filtre
--   DepotsFacturation est retiré des 3 branches (FG_DOCENTETE_SAUV, F_DOCENTETE, BL/
--   F_DOCLIGNE), pas seulement FG_DOCENTETE_SAUV. Plus aucun filtre dépôt en SQL dans
--   la vue -- DE_No exposé sur toutes les lignes, filtrage dépôt entièrement délégué au
--   reporting (Metabase). CTE DepotsFacturation devenue inutile, SUPPRIMÉE. Vérifié en
--   base : F_DOCENTETE type 6/7 = 37365 lignes, DE_No jamais NULL, 172 dépôts distincts
--   (contrairement à SAUV, ici le filtre avait un impact réel -- volume repasse de
--   23697 à 37365 lignes dans DocumentsRaw pour cette branche). BL/F_DOCLIGNE : impact
--   déjà mesuré en v4 (704/27359 lignes, 2,6%), désormais réintégré.
--
-- MODIFIÉ 2026-09-29 (v8) : 12. Bug 3 (DO_Coord03) révisé -- signalé par le PO : le fix
--   v5 (NOT EXISTS FG_DOCENTETE_SAUV sur DO_Coord03) ne couvrait que le cas où le BL
--   d'origine est déjà archivé en SAUV. Si le BL d'origine est encore dans F_DOCENTETE/BL
--   reconstruit (pas encore archivé), la facture éclatée n'était PAS exclue -> double
--   comptage résiduel non couvert par les 51 factures mesurées en v5. Règle métier
--   clarifiée : TOUTE facture avec DO_Coord03 renseigné est une facture intermédiaire
--   d'éclatement, à exclure systématiquement, quel que soit l'état d'archivage de son BL
--   d'origine. Condition simplifiée `ISNULL(f.DO_Coord03,'') = ''` remplace le NOT EXISTS
--   v5 (cf. TASK-056.md § Correctif v8 pour le détail et le point de vérification restant
--   à faire en base avant application : confirmer qu'aucun BL d'origine ne disparaît
--   totalement du recouvrement, cf. section 0(f) ci-dessous).
--
-- MODIFIÉ 2026-09-29 (v9) : 13. Bug 4 -- signalé par le PO après application de v8 en base
--   (BLG2603983 encore visible) : F_DOCLIGNE.DL_PieceBL n'est PAS fiable comme numéro de
--   BL pour une ligne issue d'une facture déjà éclatée -- confirmé en base, un même vrai
--   BL éclaté en plusieurs factures produit un DL_PieceBL DIFFÉRENT par facture (pseudo-
--   numéro généré à la volée, jamais retrouvé comme document réel dans FG_DOCENTETE_SAUV/
--   F_DOCENTETE/FG_BlFacture). Décision PO explicite : la CTE BL ne doit capter QUE les
--   vrais BL pas encore facturés -- filtre changé de "DL_PieceBL déjà une facture connue"
--   à "la facture PORTEUSE de la ligne (DO_Piece) déjà connue de FG_BlFacture". Vérifié en
--   base : 0 collision (aucun vrai BL non-facturé n'est jamais un DO_NumFC), filtre sûr.
--   Effet : 12531 -> 1443 "BL" reconstruits (-88,5%), 359M -> 145M TTC, cf. TASK-056.md
--   § Bug 4 pour le détail complet et les mesures.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Diagnostic AVANT application — lecture seule, à exécuter et LIRE en premier
-- ---------------------------------------------------------------------------

-- (a) Règlements référençant plusieurs BL via '#' (mesure l'impact du bug 1)
SELECT COUNT(*) AS NbReglementsMultiBL
FROM zvMeta_ReglementBL
WHERE CHARINDEX('#', MV_Reference) > 0;

-- (b) BL éclatés sur plusieurs clients (mesure l'impact du bug 2 — double comptage actuel)
SELECT COUNT(*) AS NbBLMultiClient
FROM (
    SELECT DL_PieceBL
    FROM GOCOM.dbo.F_DOCLIGNE
    WHERE DO_Type IN (6,7) AND DL_PieceBL <> ''
    GROUP BY DL_PieceBL
    HAVING COUNT(DISTINCT CT_Num) > 1
) x;

-- (c) RETIRÉ — hypothèse de bug testée en base et INVALIDÉE (3012 exclusions sur la
--     version d'origine, 0 sur la variante proposée). FA_BL reste inchangée ci-dessous.

-- (d) MV_Numero est-il bien unique par ligne de règlement (prérequis de la répartition FIFO) ?
SELECT COUNT(*) AS NbLignes, COUNT(DISTINCT MV_Numero) AS NbMVNumeroDistincts
FROM zvMeta_ReglementBL;

-- (e) Types réels des colonnes refusées comme clé d'index (Msg 1919 constaté en base) —
--     détermine si un contournement (colonne calculée persistée + index dessus) est possible :
--     text/ntext = impossible même en INCLUDE ; varchar(max)/nvarchar(max) = INCLUDE possible,
--     clé toujours impossible sans colonne calculée.
SELECT c.name AS Colonne, t.name AS Type, c.max_length
FROM sys.columns c
JOIN sys.types t ON t.user_type_id = c.user_type_id
WHERE (c.object_id = OBJECT_ID('RT_MOUVEMENT') AND c.name = 'MV_Reference')
   OR (c.object_id = OBJECT_ID('RT_ECHEANCE')  AND c.name = 'DO_Numero');
GO

-- (f) v8 (2026-09-29) — MESURE D'INFORMATION, PAS UN BLOCAGE (précision PO 2026-09-29,
--     cf. TASK-056.md « Précision PO 2026-09-29 ») : un résultat non vide est ATTENDU, il
--     correspond à l'ancien traitement (BL éclaté générant ses factures directement, sans
--     jamais créer de document BL propre) — décision PO actée : ces factures restent
--     exclues du recouvrement par v8 malgré l'absence de BL de substitution. Cette requête
--     sert uniquement à mesurer le volume/montant qui sort du périmètre du recouvrement
--     avant d'appliquer v8, pas à décider si on applique ou non.
SELECT
    COUNT(*)               AS NbFacturesSansBLSubstitution,
    SUM(f.DO_TotalTTC)      AS MontantTotalTTC
FROM GOCOM.dbo.F_DOCENTETE f
WHERE f.DO_Type IN (6,7)
  AND ISNULL(f.DO_Coord03,'') <> ''
  AND NOT EXISTS (SELECT 1 FROM GOCOM.dbo.FG_DOCENTETE_SAUV s WHERE s.DO_Piece = f.DO_Coord03)
  AND NOT EXISTS (
        SELECT 1 FROM GOCOM.dbo.F_DOCLIGNE l
        WHERE l.DO_Type IN (6,7) AND l.DL_PieceBL = f.DO_Coord03
      );
GO


-- ---------------------------------------------------------------------------
-- 1. Index non-clustered idempotents — à valider avec l'admin GOCOM avant
--    application (tables ERP partagées, alimentées en continu par la saisie
--    commerciale : mesurer l'impact sur les écritures avant un déploiement en
--    heures pleines).
-- ---------------------------------------------------------------------------

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_F_DOCLIGNE_DLPieceBL_Perf'
      AND object_id = OBJECT_ID('GOCOM.dbo.F_DOCLIGNE')
)
CREATE NONCLUSTERED INDEX IX_F_DOCLIGNE_DLPieceBL_Perf
    ON GOCOM.dbo.F_DOCLIGNE (DL_PieceBL)
    INCLUDE (DO_Type, DE_No, CT_Num, DL_DateBL, DL_MontantTTC, DO_Piece)
    WHERE DL_PieceBL <> '';
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_F_DOCENTETE_Type_DENo_Perf'
      AND object_id = OBJECT_ID('GOCOM.dbo.F_DOCENTETE')
)
CREATE NONCLUSTERED INDEX IX_F_DOCENTETE_Type_DENo_Perf
    ON GOCOM.dbo.F_DOCENTETE (DO_Type, DE_No)
    INCLUDE (DO_Piece, DO_Date, DO_Tiers, DO_TotalTTC);
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_FGDOCENTETESAUV_DENo_Perf'
      AND object_id = OBJECT_ID('GOCOM.dbo.FG_DOCENTETE_SAUV')
)
CREATE NONCLUSTERED INDEX IX_FGDOCENTETESAUV_DENo_Perf
    ON GOCOM.dbo.FG_DOCENTETE_SAUV (DE_No)
    INCLUDE (DO_Piece, DO_Date, DO_Tiers, DO_TotalTTC);
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_FGBlFacture_DONumFC_Perf'
      AND object_id = OBJECT_ID('GOCOM.dbo.FG_BlFacture')
)
CREATE NONCLUSTERED INDEX IX_FGBlFacture_DONumFC_Perf
    ON GOCOM.dbo.FG_BlFacture (DO_NumFC);
GO

-- RETIRÉ (Msg 1919) : MV_Reference n'est pas d'un type autorisé comme colonne clé
-- (typiquement text/ntext hérité du schéma Sage) -> impossible de l'indexer telle quelle.
-- Repli sur MV_Domaine seul : réduit déjà le scan avant l'application du filtre
-- CHARINDEX/LIKE en mémoire sur MV_Reference (non "sargable" quel que soit l'index).
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_RTMOUVEMENT_Domaine_Perf'
      AND object_id = OBJECT_ID('RT_MOUVEMENT')
)
CREATE NONCLUSTERED INDEX IX_RTMOUVEMENT_Domaine_Perf
    ON RT_MOUVEMENT (MV_Domaine)
    INCLUDE (MV_Date, MV_Montant, MV_Numero, MV_ID);
-- BanqueCode retirée (Msg 1911) : cette colonne n'existe pas sur RT_MOUVEMENT, elle vient
-- en réalité de vReglementsClients (jointe sans préfixe dans zvMeta_ReglementBL) -- pas
-- indexable depuis cette table.
-- MV_Reference/MV_Libelle/MV_ExtraitNum volontairement absentes de l'INCLUDE : à re-tester
-- une fois le type réel connu (cf. diagnostic (e) plus bas) -- si "text"/"ntext" strict,
-- même l'INCLUDE est refusé, pas seulement la clé.
-- NB : ne couvre pas le JOIN vers vReglementsClients (définition non disponible depuis
-- ce poste) — si zvMeta_ReglementBL reste lente après ce lot, fournir la définition de
-- vReglementsClients pour un index complémentaire.
GO

-- RETIRÉ (Msg 1919) : DO_Numero n'est pas d'un type autorisé comme colonne clé
-- (même famille de problème que MV_Reference ci-dessus). Aucun index possible tel quel
-- sur RT_ECHEANCE.DO_Numero -> la vue (section 2 plus bas) restreint désormais le OUTER
-- APPLY correspondant aux seuls documents TTC négatif (avoirs), pour limiter le nombre
-- d'exécutions de ce lookup non indexable au strict nécessaire.


-- ---------------------------------------------------------------------------
-- 2. Vue corrigée
-- ---------------------------------------------------------------------------

ALTER VIEW [dbo].[vMetaRecouvrementBL]
AS

/* ===========================
   0️⃣ Dépôts facturants — RÉINTRODUIT (v10, 2026-09-29, décision PO explicite).
   Ce filtre avait été ajouté (v4, 2026-07-16) puis retiré (v7, même jour) sur demande PO,
   au motif que le filtrage par dépôt devait se faire côté reporting Metabase plutôt que
   figé dans la vue. Retour en arrière assumé par le PO le 2026-09-29 : seuls les documents
   des dépôts présents dans FG_DEPOTFACTURATION doivent être affichés, filtré directement en
   SQL. Jointure non triviale, confirmée par le PO (pas déductible du schéma seul) :
   FG_DEPOTFACTURATION.DP_Id se rapproche de F_DEPOT via F_DEPOT.cbMarq (colonne
   normalement technique/réplication chez Sage, ici réutilisée comme clé de rapprochement).
   Revérifié en base le 2026-09-29 : toujours 30 dépôts sur 213 matchés (stable depuis v4).
   Jointure (pas EXISTS corrélé) pour rester sargable, cf. incident perf CTE account (TASK-056).
=========================== */
WITH DepotsFacturation AS (
    SELECT d.DE_No
    FROM GOCOM.dbo.F_DEPOT d
    INNER JOIN GOCOM.dbo.FG_DEPOTFACTURATION df ON df.DP_Id = d.cbMarq
)

/* ===========================
   1️⃣ BL reconstruit depuis les lignes de facture (DL_PieceBL)
   CORRECTIF bug 2 : agrégé au grain BL (CT_Num retiré de la clé de regroupement).
   NbClients/DO_Tiers = information indicative sur le multi-client, pas une clé.
   CORRECTIF v10 (2026-09-29) : filtre DepotsFacturation RÉINTRODUIT (cf. § 0 ci-dessus) —
   décision PO assumée de revenir sur le retrait v7.
   CORRECTIF v9 (Bug 4, 2026-09-29) : DL_PieceBL n'est PAS fiable comme numéro de BL
   pour une ligne issue d'une facture déjà éclatée — confirmé en base : un même vrai BL
   éclaté en plusieurs factures produit un DL_PieceBL DIFFÉRENT par facture (pseudo-numéro
   généré à la volée, jamais retrouvé comme document réel). Cette CTE ne doit capter que
   les vrais BL PAS ENCORE facturés (décision PO explicite) : filtre ajouté sur l.DO_Piece
   (la facture porteuse de la ligne), pas sur DL_PieceBL — si cette facture est déjà connue
   de FG_BlFacture comme DO_NumFC, son montant est déjà compté via le vrai BL d'origine
   (source FG_DOCENTETE_SAUV) et la ligne est exclue ici. Vérifié en base : aucun vrai BL
   non-facturé n'est jamais un DO_NumFC de FG_BlFacture (0 collision mesurée) — filtre sûr.
   Effet mesuré : 12531 -> 1443 "BL" reconstruits (-88,5%), 359M -> 145M TTC.
=========================== */
, BL AS (
    SELECT
        l.DL_PieceBL,
        SUM(l.dl_montantttc)    AS DO_TotalTTC,
        l.DE_No,
        MIN(l.DL_DateBL)        AS DO_Date,
        COUNT(DISTINCT l.CT_Num) AS NbClients,
        MIN(l.CT_Num)           AS DO_Tiers
    FROM GOCOM.dbo.F_DOCLIGNE l
    INNER JOIN DepotsFacturation dep ON dep.DE_No = l.DE_No
    WHERE l.DO_Type IN (6,7)
      AND l.DL_PieceBL <> ''
      AND NOT EXISTS (SELECT 1 FROM GOCOM.dbo.FG_BlFacture bf WHERE bf.DO_NumFC = l.DO_Piece)
    GROUP BY l.DL_PieceBL, l.DE_No
)

/* ===========================
   2️⃣ BL déjà facturés (INCHANGÉ — hypothèse de bug testée en base et invalidée,
   cf. diagnostic (c) : la comparaison DO_Piece vs DO_Piece exclut bien 3012 BL)
=========================== */
, FA_BL AS (
    SELECT DISTINCT l.DO_Piece
    FROM GOCOM.dbo.F_DOCLIGNE l
    WHERE ISNULL(l.DL_PieceBL,'') <> ''
)

/* ===========================
   3️⃣ Documents unifiés
   CORRECTIF bug 5 (double comptage inter-branches) : dédoublonnage explicite par
   DO_Piece, priorité SAUV > F_DOCENTETE brut > BL reconstruit — même pattern que
   DocParPiece (SQL_005 / vw_ReglementsAComptabiliser).
   account/EXISTS RETIRÉ sur les 3 branches (décision PO 2026-07-16) : FG_DOCENTETE_SAUV
   redevient un scan intégral (tout dépôt/société confondus), périmètre délégué au
   sandbox Metabase — cf. TASK-056.md pour le risque signalé.
   CORRECTIF v8 (bug DO_Coord03, révisé 2026-09-29) : toute facture F_DOCENTETE portant un
   DO_Coord03 renseigné est une facture intermédiaire issue d'un éclatement de BL — exclue
   systématiquement, quel que soit l'état d'archivage (SAUV ou non) de son BL d'origine.
   Remplace le NOT EXISTS(FG_DOCENTETE_SAUV) de v5, qui ne couvrait que le cas où le BL
   d'origine était déjà archivé (51 factures) et laissait passer le cas où il ne l'était
   pas encore (double comptage résiduel non détecté par la mesure v5).
   CORRECTIF v6/v7 : plus aucune branche n'est filtrée par dépôt (décision PO) — toutes
   les lignes sortent, DE_No exposé sur les 3 sources pour filtrage côté reporting.
   CORRECTIF v10 (2026-09-29) : filtre DepotsFacturation RÉINTRODUIT sur les 3 branches
   (cf. § 0 ci-dessus) — décision PO assumée de revenir sur le retrait v6/v7.
=========================== */
, DocumentsRaw AS (
    SELECT f.DO_Piece, f.DO_Date, f.DO_Tiers, f.DE_No, f.DO_TotalTTC, 1 AS NbClients, 1 AS Prio
    FROM GOCOM.dbo.FG_DOCENTETE_SAUV f
    INNER JOIN DepotsFacturation dep ON dep.DE_No = f.DE_No

    UNION ALL

    SELECT f.DO_Piece, f.DO_Date, f.DO_Tiers, f.DE_No, f.DO_TotalTTC, 1 AS NbClients, 2 AS Prio
    FROM GOCOM.dbo.F_DOCENTETE f
    INNER JOIN DepotsFacturation dep ON dep.DE_No = f.DE_No
    WHERE f.DO_Type IN (6,7)
      AND NOT EXISTS (SELECT 1 FROM GOCOM.dbo.FG_BlFacture bf WHERE bf.DO_NumFC = f.DO_Piece)
      AND NOT EXISTS (SELECT 1 FROM FA_BL WHERE FA_BL.DO_Piece = f.DO_Piece)
      AND ISNULL(f.DO_Coord03,'') = ''

    UNION ALL

    -- Filtre historique (DL_PieceBL lui-même déjà une facture connue) conservé en complément
    -- du nouveau filtre v9 posé dans la CTE BL (sur l.DO_Piece, la facture porteuse de la ligne)
    -- — les deux couvrent des cas différents, aucun n'est redondant avec l'autre.
    SELECT b.DL_PieceBL AS DO_Piece, b.DO_Date, b.DO_Tiers, b.DE_No, b.DO_TotalTTC, b.NbClients, 3 AS Prio
    FROM BL b
    WHERE NOT EXISTS (SELECT 1 FROM GOCOM.dbo.FG_BlFacture bf WHERE bf.DO_NumFC = b.DL_PieceBL)
)
, Documents AS (
    SELECT DO_Piece, DO_Date, DO_Tiers, DE_No, DO_TotalTTC, NbClients
    FROM (
        SELECT
            DO_Piece, DO_Date, DO_Tiers, DE_No, DO_TotalTTC, NbClients,
            ROW_NUMBER() OVER (PARTITION BY DO_Piece ORDER BY Prio) AS rn
        FROM DocumentsRaw
    ) x
    WHERE rn = 1
)

/* ===========================
   4️⃣ Règlements : répartition FIFO par date de BL sur les références multi-'#'
   CORRECTIF bug 1. MV_Numero suppose une ligne par règlement (diagnostic (d)).
=========================== */
, ReglementSplit AS (
    SELECT
        r.MV_Numero,
        r.MV_Montant,
        LTRIM(RTRIM(s.value)) AS NumeroBL
    FROM zvMeta_ReglementBL r
    CROSS APPLY STRING_SPLIT(r.MV_Reference, '#') s
    WHERE LTRIM(RTRIM(s.value)) <> ''
)
, ReglementAlloc AS (
    SELECT
        rs.NumeroBL,
        d.DO_TotalTTC,
        rs.MV_Montant
          - ISNULL(SUM(d.DO_TotalTTC) OVER (
                PARTITION BY rs.MV_Numero
                ORDER BY d.DO_Date, rs.NumeroBL
                ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
            ), 0) AS MontantDisponible
    FROM ReglementSplit rs
    INNER JOIN Documents d ON d.DO_Piece = rs.NumeroBL
)
, r AS (
    SELECT
        NumeroBL,
        SUM(
            CASE
                WHEN MontantDisponible <= 0          THEN 0
                WHEN MontantDisponible >= DO_TotalTTC THEN DO_TotalTTC
                ELSE MontantDisponible
            END
        ) AS TotalReglement
    FROM ReglementAlloc
    GROUP BY NumeroBL
)

/* ===========================
   5️⃣ Select final
   account/dep RETIRÉS (décision PO 2026-07-16) : plus de A_EMAIL/ID_UserBhub/DE_Intitule
   en sortie. Si le sandbox Metabase sur cette vue filtrait sur A_EMAIL, il n'a plus
   rien sur quoi s'appuyer — risque signalé au PO, confirmé malgré tout (TASK-056.md).
=========================== */

SELECT
    d.DO_Piece,
    d.DO_Date,
    d.DO_Tiers,
    c.CT_Intitule,
    d.NbClients,
    d.DE_No,
    d.DO_TotalTTC,

    ISNULL(r.TotalReglement,0) AS TotalReglement,

    /* Calcul solde centralisé */
    CASE
        WHEN d.DO_TotalTTC < 0
            THEN ISNULL(e.EC_Solde,0)
        ELSE
            d.DO_TotalTTC - ISNULL(r.TotalReglement,0)
    END AS Solde,

    /* Controle anomalie */
    CASE
        WHEN ISNULL(r.TotalReglement,0) > d.DO_TotalTTC
            THEN 'ANOMALIE'
        ELSE 'OK'
    END AS Controle

FROM Documents d
LEFT JOIN r
    ON d.DO_Piece = r.NumeroBL

INNER JOIN GOCOM.dbo.F_COMPTET c
    ON c.CT_Num = d.DO_Tiers

INNER JOIN GOCOM.dbo.F_DEPOT depSage
    ON depSage.DE_No = d.DE_No

/* CORRECTIF v3 (incident perf 2026-07-16, 2e mesure) : le OUTER APPLY corrélé exécutait
   un scan complet de RT_ECHEANCE (non indexable, Msg 1919) UNE FOIS PAR LIGNE de Documents
   -> 19521 scans / 30 062 340 lectures mesurés après retrait d'account/dep (qui a fait
   remonter beaucoup plus de lignes TTC<0, cf. TASK-056.md). Remplacé par une pré-agrégation
   unique (GROUP BY) jointe en LEFT JOIN classique : RT_ECHEANCE n'est plus scannée qu'UNE
   fois au total, quel que soit le nombre de lignes de Documents. Le filtre TTC<0 reste dans
   le CASE de calcul du Solde (inchangé) ; e.EC_Solde peut matcher des DO_Piece non-avoir,
   sans conséquence puisqu'il n'est utilisé que dans la branche TTC<0. */
LEFT JOIN (
    SELECT DO_Numero, SUM(EC_Solde) AS EC_Solde
    FROM RT_ECHEANCE
    GROUP BY DO_Numero
) e ON e.DO_Numero = d.DO_Piece
GO
