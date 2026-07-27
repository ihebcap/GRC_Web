-- =============================================================================
-- SQL_005 — vw_ReglementsAComptabiliser : libellé écriture comptable
-- Base : GR_GOCOM (DESKTOP-2VCUE93)
-- Contexte : spec PO 2026-07-15 (écriture compta, espèce / hors espèce)
--
-- Corrections apportées :
--   1. LibelleEcritre était CASSÉE : 'ESP ' + MV_Reference, or MV_Reference est
--      vide sur l'espèce (le BL est dans MV_Info3) => valait "ESP " sur 21 868
--      des 22 421 règlements espèce, sans jamais le n° de facture.
--   2. Le n° de facture vient de RT_AFFECTATION -> RT_ECHEANCE.DO_Numero
--      (décision PO), filtré sur DO_Type = 6 (facture).
--   3. Le hors espèce est désormais couvert (la colonne renvoyait NULL).
--   4. Renommée LibelleEcritre -> LibelleEcriture (faute de frappe ; colonne
--      neuve, non encore consommée par GRC => renommage sans impact).
--   5. Troncature aux longueurs Sage (décision PO 2026-07-15), sinon l'INSERT
--      F_ECRITUREC échoue ou tronque hors de notre contrôle :
--        MV_Piece        -> EC_Piece      varchar(13)  (1 189 lignes, max 30)
--        ReferenceCompta -> EC_Reference  varchar(17)  (23 lignes, max 139)
--        LibelleEcriture -> EC_Intitule   varchar(69)  (536 lignes, max 87)
--      La troncature est SILENCIEUSE et destructive : une pièce ou une
--      référence tronquée peut devenir ambiguë en compta. Assumé par le PO.
--   6. ReferenceCompta espèce : repli sur MV_Reference quand MV_Info3 est vide
--      (décision PO 2026-07-15). Détail et volumétrie sur la colonne elle-même.
--
-- Contrat préservé : 1 ligne par MV_ID (OUTER APPLY TOP 1, pas de jointure 1-N
-- qui dupliquerait les lignes).
-- =============================================================================
ALTER view [dbo].[vw_ReglementsAComptabiliser]
 as
WITH Documents AS (
    -- priorité 1 : documents sauvegardés
    SELECT DO_Piece, DO_Tiers, 1 AS Prio FROM GOCOM.dbo.FG_DOCENTETE_SAUV
    UNION ALL
    -- priorité 2 : documents Sage courants (BL ou FAG, peu importe)
    SELECT DO_Piece, DO_Tiers, 2 AS Prio FROM GOCOM.dbo.F_DOCENTETE
    WHERE do_type in (3,6,7)
    uNION ALL
     SELECT DO_Piece, CT_Num, 3 AS Prio FROM GOCOM.dbo.F_DOCLIGNE
    WHERE do_type in (3,6,7)
),
DocParPiece AS (
    -- 1 seule ligne par DO_Piece, en gardant la source prioritaire (SAUV avant F_DOCENTETE)
    SELECT DO_Piece, DO_Tiers,
           ROW_NUMBER() OVER (PARTITION BY DO_Piece ORDER BY Prio) AS rn
    FROM Documents
)
SELECT  r.MV_ID,
        r.MV_Numero,
        -- Pièce (EC_Piece varchar(13)) :
        --   espèce      -> n° de règlement sans 'RC' (8 car., toujours OK)
        --   hors espèce -> code banque (MV_Piece), TRONQUÉ à 13 (décision PO 2026-07-15)
        -- La troncature coupe l'horodatage des MV_Piece longs (« B0022588-2026052208410... »),
        -- ce qui rend 211 lignes ambiguës entre elles — MAIS ces 211 lignes sont TOUTES
        -- non rapprochées (MV_Point = 0) et ne seront donc jamais comptabilisées : les types
        -- 1/2/3 non rapprochés sont exclus de la compta (règle métier, contrôle utilisateur).
        -- Vérifié en base : zéro collision entre lignes rapprochées. Troncature sans risque.
        -- Repli sur le n° de règlement UNIQUEMENT si MV_Piece est vide (1 ligne, type 4) —
        -- garde-fou pour ne jamais écrire une pièce comptable vide.
        -- MV_Type = 4 est traité EXACTEMENT comme 3 (décision PO) : le test passe donc de
        -- « MV_Type <> 3 » à « MV_Type = 0 ». Seuls 0, 3 et 4 existent (vérifié en base).
        case
            when MV_Type = 0 then replace(MV_Numero,'RC','')
            when ISNULL(r.MV_Piece,'') = '' then replace(MV_Numero,'RC','')
            else LEFT(r.MV_Piece, 13)
        end as MV_Piece,
        -- Référence de l'écriture (EC_Reference varchar(17)) :
        --   espèce      -> MV_Info3 (le BL) ; si MV_Info3 est VIDE ou NULL, repli sur
        --                  MV_Reference (décision PO 2026-07-15).
        --   hors espèce -> MV_Reference
        -- Le NULLIF n'est pas décoratif : un ISNULL(MV_Info3, ...) seul ne couvre que le NULL.
        -- Or MV_Info3 est renseignée à « vide » de deux façons distinctes (mesuré en prod) :
        --   234 règlements espèce ont MV_Info3 à NULL       -> ISNULL suffisait ;
        --    15 ont une CHAÎNE VIDE                          -> seul le NULLIF les rattrape.
        -- Soit 249 règlements espèce sans MV_Info3 exploitable :
        --   -> 246 gagnent une référence grâce au repli, dont 239 portent bien un n° de
        --      document (FAG…/BL…) ;
        --   -> 7 portent une référence BANCAIRE et non un BL (« B0096258-2026010809354897 »,
        --      « BAHIJ », « TAZDAYET ») : elles atterriront telles quelles en EC_Reference ;
        --   -> 3 restent sans référence (MV_Info3 ET MV_Reference vides tous les deux).
        LEFT(ISNULL(CASE WHEN r.MV_Type = 0
                         THEN ISNULL(NULLIF(LTRIM(RTRIM(r.MV_Info3)), ''), r.MV_Reference)
                         ELSE r.MV_Reference END, ''), 17) as ReferenceCompta,
        mv_info3,
        r.MR_ID,
        r.MV_Type,
        r.MV_Reference,
        r.MV_Montant,
        r.MV_Point,
        r.MV_Date,
        COALESCE(cpt.CT_Intitule, r.CT_Intitule) AS ClientIntitule
        ,MV_Libelle
        -- n° de facture affectée (NULL si aucune affectation) — exposé pour le
        -- champ « N° Facture » de l'écriture et pour le diagnostic
        ,fact.FactureNumero
        -- Libellé de l'écriture comptable, les deux modes :
        --   espèce      : 'ESP <facture>' ; 'ESP' seul si aucune facture affectée
        --   hors espèce : libellé saisi ; 'Versement' si vide/NULL
        -- tronqué à EC_Intitule varchar(69)
        ,LEFT(CASE
            WHEN r.MV_Type = 0
                THEN LTRIM(RTRIM('ESP ' + ISNULL(fact.FactureNumero, '')))
            ELSE
                CASE
                    WHEN LTRIM(RTRIM(ISNULL(r.MV_Libelle, ''))) = '' THEN 'Versement'
                    ELSE LTRIM(RTRIM(r.MV_Libelle))
                END
         END, 69) as LibelleEcriture
FROM    RT_MOUVEMENT r
-- premier document de la référence multi-valuée (avant le 1er '#')
CROSS APPLY (
    SELECT SUBSTRING(r.MV_Reference, 1,
                     CHARINDEX('#', r.MV_Reference + '#') - 1) AS FirstDoc
) d
-- Facture affectée au règlement. OUTER APPLY TOP 1 : préserve le contrat
-- « 1 ligne par MV_ID » malgré le 1-N de RT_AFFECTATION (5 règlements espèce
-- ont 2 à 6 factures affectées).
-- /!\ RÈGLE MULTI-FACTURES À VALIDER PAR LE PO : on retient la PREMIÈRE
--     affectation (AF_Id croissant). Alternatives non retenues : concaténer
--     toutes les factures, ou traiter comme « non identifiée » (=> 'ESP').
OUTER APPLY (
    SELECT TOP 1 ec.DO_Numero AS FactureNumero
    FROM   RT_AFFECTATION af
    JOIN   RT_ECHEANCE   ec ON ec.EC_Id = af.EC_Id
    WHERE  af.MV_Id = r.MV_ID
      AND  ec.DO_Type = 6          -- 6 = facture
    ORDER BY af.AF_Id
) fact
LEFT JOIN DocParPiece doc ON doc.DO_Piece = d.FirstDoc AND doc.rn = 1
LEFT JOIN GOCOM.dbo.F_COMPTET     cpt ON cpt.CT_Num = doc.DO_Tiers
WHERE   r.MV_Domaine = 0
  -- AND   r.MV_Compta  = 0
-- and MV_Type = 0
