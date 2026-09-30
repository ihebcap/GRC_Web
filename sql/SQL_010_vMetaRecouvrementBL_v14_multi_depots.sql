-- =============================================================================
-- SQL_010 - vMetaRecouvrementBL v14 : BL multi-depots (une ligne par piece+depot)
-- Base : GR_GOCOM. Deja applique en PROD chez le client le 2026-09-30 (a rejouer
-- si la vue est recreee). Remplace la definition de SQL_007 (v13) - a ne pas
-- rejouer SQL_007 apres ce script, sinon retour a l'ancien comportement.
--
-- Bug corrige : BL BLG2601604 facture sur 2 depots (1 et 174) -> 1 seule ligne
-- ressortait (ROW_NUMBER par DO_Piece), 2 722 987,80 perdus.
-- Verifie en base (SELECT seul) : +1 ligne sur 4175 (ce BL), total TTC +2 722 987,80,
-- total reglements identique au centime. Perf : 3,2 s -> 3,6 s ; lectures logiques
-- F_DOCLIGNE 0,72 M -> 2,58 M (a surveiller, cf. incident perf v10-v13).
--
-- Differences vs v13 :
--   - Documents : DENSE_RANK au lieu de ROW_NUMBER (garde toutes les lignes de la
--     source gagnante SAUV > F_DOCENTETE > BL reconstruit).
--   - Reglements alloues au niveau PIECE (DocumentsPiece) puis repartis au prorata
--     du TTC de chaque ligne-depot. Piece mono-depot : ratio = 1, inchange.
--   - Branche F_DOCENTETE : DO_Type IN (6,7) ; filtre DO_Coord03 = NOT EXISTS
--     (FG_DOCENTETE_SAUV) (logique v5, decision PO 2026-09-30, remplace v8).
--   - CTE BL : filtre FG_BlFacture (v9) retire, remplace par le NOT EXISTS SAUV ci-dessus.
--   - Avoirs (TTC < 0) : EC_Solde est au niveau piece, repete sur chaque depot (cas rare).
-- =============================================================================
USE [GR_GOCOM]
GO
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER OFF
GO

ALTER VIEW [dbo].[vMetaRecouvrementBL]
AS

WITH DepotsFacturation AS (
    SELECT d.DE_No
    FROM GOCOM.dbo.F_DEPOT d
    INNER JOIN GOCOM.dbo.FG_DEPOTFACTURATION df ON df.DP_Id = d.cbMarq
)

/* BL reconstruit depuis les lignes de facture, grain (BL, depot) */
, BL AS (
    SELECT
        l.DL_PieceBL,
        SUM(l.dl_montantttc)     AS DO_TotalTTC,
        l.DE_No,
        MIN(l.DL_DateBL)         AS DO_Date,
        COUNT(DISTINCT l.CT_Num) AS NbClients,
        MIN(l.CT_Num)            AS DO_Tiers
    FROM GOCOM.dbo.F_DOCLIGNE l
    INNER JOIN DepotsFacturation dep ON dep.DE_No = l.DE_No
    INNER JOIN GOCOM.dbo.F_DOCENTETE e ON e.do_piece = l.do_piece AND e.do_type = l.DO_Type
    WHERE l.DO_Type IN (6,7)
      AND l.DL_PieceBL <> ''
      AND NOT EXISTS (SELECT 1 FROM GOCOM.dbo.FG_DOCENTETE_SAUV bf WHERE bf.DO_Piece = e.DO_Coord03)
    GROUP BY l.DL_PieceBL, l.DE_No
)

/* Factures portant des lignes de BL (perf : filtre depots facturants, cf. v13) */
, FA_BL AS (
    SELECT DISTINCT l.DO_Piece
    FROM GOCOM.dbo.F_DOCLIGNE l
    INNER JOIN DepotsFacturation dep ON dep.DE_No = l.DE_No
    WHERE ISNULL(l.DL_PieceBL,'') <> ''
)

, DocumentsRaw AS (
    SELECT f.DO_Piece, f.DO_Date, f.DO_Tiers, f.DE_No, f.DO_TotalTTC, 1 AS NbClients, 1 AS Prio
    FROM GOCOM.dbo.FG_DOCENTETE_SAUV f
    INNER JOIN DepotsFacturation dep ON dep.DE_No = f.DE_No

    UNION ALL

    SELECT f.DO_Piece, f.DO_Date, f.DO_Tiers, f.DE_No, f.DO_TotalTTC, 1 AS NbClients, 2 AS Prio
    FROM GOCOM.dbo.F_DOCENTETE f
    INNER JOIN DepotsFacturation dep ON dep.DE_No = f.DE_No
    WHERE f.DO_Type IN (6,7)
      AND NOT EXISTS (SELECT 1 FROM GOCOM.dbo.FG_DOCENTETE_SAUV bf WHERE bf.DO_Piece = f.DO_Coord03)
      AND NOT EXISTS (SELECT 1 FROM FA_BL WHERE FA_BL.DO_Piece = f.DO_Piece)

    UNION ALL

    SELECT b.DL_PieceBL AS DO_Piece, b.DO_Date, b.DO_Tiers, b.DE_No, b.DO_TotalTTC, b.NbClients, 3 AS Prio
    FROM BL b
    WHERE NOT EXISTS (SELECT 1 FROM GOCOM.dbo.FG_BlFacture bf WHERE bf.DO_NumFC = b.DL_PieceBL)
)

, Documents AS (
    SELECT DO_Piece, DO_Date, DO_Tiers, DE_No, DO_TotalTTC, NbClients
    FROM (
        SELECT
            DO_Piece, DO_Date, DO_Tiers, DE_No, DO_TotalTTC, NbClients,
            DENSE_RANK() OVER (PARTITION BY DO_Piece ORDER BY Prio) AS rn
        FROM DocumentsRaw
    ) x
    WHERE rn = 1
)

/* Une ligne par piece (somme des depots) : base de l'allocation des reglements */
, DocumentsPiece AS (
    SELECT DO_Piece, MIN(DO_Date) AS DO_Date, SUM(DO_TotalTTC) AS DO_TotalTTC
    FROM Documents
    GROUP BY DO_Piece
)

/* Reglements : repartition FIFO par date de BL sur les references multi-'#' */
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
    INNER JOIN DocumentsPiece d ON d.DO_Piece = rs.NumeroBL
)
, r AS (
    SELECT
        NumeroBL,
        SUM(
            CASE
                WHEN MontantDisponible <= 0           THEN 0
                WHEN MontantDisponible >= DO_TotalTTC THEN DO_TotalTTC
                ELSE MontantDisponible
            END
        ) AS TotalReglement
    FROM ReglementAlloc
    GROUP BY NumeroBL
)

SELECT
    d.DO_Piece,
    d.DO_Date,
    d.DO_Tiers,
    c.CT_Intitule,
    d.NbClients,
    d.DE_No,
    d.DO_TotalTTC,

    /* Reglement de la piece reparti au prorata du TTC de la ligne-depot */
    ISNULL(r.TotalReglement,0)
      * CASE WHEN p.DO_TotalTTC = 0 THEN 1 ELSE d.DO_TotalTTC / p.DO_TotalTTC END AS TotalReglement,

    CASE
        WHEN d.DO_TotalTTC < 0
            THEN ISNULL(e.EC_Solde,0)
        ELSE
            d.DO_TotalTTC - ISNULL(r.TotalReglement,0)
              * CASE WHEN p.DO_TotalTTC = 0 THEN 1 ELSE d.DO_TotalTTC / p.DO_TotalTTC END
    END AS Solde,

    CASE
        WHEN ISNULL(r.TotalReglement,0)
               * CASE WHEN p.DO_TotalTTC = 0 THEN 1 ELSE d.DO_TotalTTC / p.DO_TotalTTC END
             > d.DO_TotalTTC
            THEN 'ANOMALIE'
        ELSE 'OK'
    END AS Controle

FROM Documents d
LEFT JOIN r  ON d.DO_Piece = r.NumeroBL
LEFT JOIN DocumentsPiece p ON p.DO_Piece = d.DO_Piece
INNER JOIN GOCOM.dbo.F_COMPTET c ON c.CT_Num = d.DO_Tiers
INNER JOIN GOCOM.dbo.F_DEPOT depSage ON depSage.DE_No = d.DE_No

/* Pre-agregation unique de RT_ECHEANCE (cf. v3 : pas de OUTER APPLY correle) */
LEFT JOIN (
    SELECT DO_Numero, SUM(EC_Solde) AS EC_Solde
    FROM RT_ECHEANCE
    GROUP BY DO_Numero
) e ON e.DO_Numero = d.DO_Piece

GO
