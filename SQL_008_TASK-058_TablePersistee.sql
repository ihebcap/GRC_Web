-- =============================================================================
-- SQL_008 — TASK-058 : table persistée pour le recouvrement par BL + job
-- Base : GR_GOCOM
-- Contexte : vMetaRecouvrementBL (SQL_007, TASK-056) recalcule tout l'historique
-- à chaque clic Metabase (~3-4 min, CTE non matérialisée référencée 2x, cf.
-- TASK-058.md). Décision PO 2026-07-16 : job planifié SQL Agent, tolérance de
-- fraîcheur 15-30 min (bouton Metabase écarté — aucun mécanisme natif pour
-- déclencher un recalcul SQL Server depuis Metabase).
--
-- PROPOSITION (à valider par le PO avant application — résout les points 1/3/5
-- encore ouverts du cadrage TASK-058.md) :
--   - Portée du recalcul (point 3) : FULL REBUILD à chaque run. Le calcul complet
--     prend ~3-4 min (mesuré), largement dans le budget de 15 min entre deux runs
--     -> pas besoin de la complexité d'un recalcul incrémental (détection des
--     lignes changées) pour tenir la tolérance retenue.
--   - Anti-lecture-partielle : 2 tables physiques jumelles (_A / _B, "blue-green")
--     + 1 SYNONYM qui pointe sur la table à jour. Le job remplit toujours la
--     table INACTIVE puis bascule le synonym en une transaction courte (DDL
--     quasi instantané) -> Metabase ne voit jamais une table à moitié remplie,
--     contrairement à un simple TRUNCATE+INSERT sur une table unique (risque
--     réel si une connexion lit en NOLOCK/READ UNCOMMITTED, courant en reporting).
--   - Migration de la vue (point 5) : vMetaRecouvrementBL garde le même nom
--     (aucune reconfiguration Metabase) mais devient une lecture simple du
--     synonym -> la requête Metabase existante n'a rien à changer.
--   - Sécurité/périmètre dépôt (point 6) : inchangé, DE_No toujours exposé,
--     filtrage toujours délégué au reporting Metabase (aucune régression).
--
-- MODE D'EMPLOI — section par section :
--   1. Tables physiques _A / _B + index
--   2. Synonym "vue active" (init sur _A)
--   3. Procédure de rafraîchissement (usp_RefreshFG_MetaRecouvrementBL)
--   4. ALTER VIEW vMetaRecouvrementBL -> lecture du synonym
--   5. Job SQL Agent (planifié toutes les 15 min)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tables physiques jumelles + index (mêmes colonnes/types que la sortie
--    actuelle de vMetaRecouvrementBL, vérifiés en base sur F_DOCENTETE/F_COMPTET)
-- ---------------------------------------------------------------------------

IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID('dbo.FG_MetaRecouvrementBL_A') AND type = 'U')
BEGIN
    CREATE TABLE dbo.FG_MetaRecouvrementBL_A (
        DO_Piece        varchar(13)     NOT NULL,
        DO_Date         datetime        NULL,
        DO_Tiers        varchar(17)     NULL,
        CT_Intitule     varchar(69)     NULL,
        NbClients       int             NOT NULL,
        DE_No           int             NULL,
        DO_TotalTTC     numeric(24,6)   NOT NULL,
        TotalReglement  numeric(24,6)   NOT NULL,
        Solde           numeric(24,6)   NOT NULL,
        Controle        varchar(10)     NOT NULL,
        CONSTRAINT PK_FG_MetaRecouvrementBL_A PRIMARY KEY CLUSTERED (DO_Piece)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FG_MetaRecouvrementBL_A_DENo' AND object_id = OBJECT_ID('dbo.FG_MetaRecouvrementBL_A'))
    CREATE NONCLUSTERED INDEX IX_FG_MetaRecouvrementBL_A_DENo ON dbo.FG_MetaRecouvrementBL_A (DE_No);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FG_MetaRecouvrementBL_A_Solde' AND object_id = OBJECT_ID('dbo.FG_MetaRecouvrementBL_A'))
    CREATE NONCLUSTERED INDEX IX_FG_MetaRecouvrementBL_A_Solde ON dbo.FG_MetaRecouvrementBL_A (Solde);
GO

IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID('dbo.FG_MetaRecouvrementBL_B') AND type = 'U')
BEGIN
    CREATE TABLE dbo.FG_MetaRecouvrementBL_B (
        DO_Piece        varchar(13)     NOT NULL,
        DO_Date         datetime        NULL,
        DO_Tiers        varchar(17)     NULL,
        CT_Intitule     varchar(69)     NULL,
        NbClients       int             NOT NULL,
        DE_No           int             NULL,
        DO_TotalTTC     numeric(24,6)   NOT NULL,
        TotalReglement  numeric(24,6)   NOT NULL,
        Solde           numeric(24,6)   NOT NULL,
        Controle        varchar(10)     NOT NULL,
        CONSTRAINT PK_FG_MetaRecouvrementBL_B PRIMARY KEY CLUSTERED (DO_Piece)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FG_MetaRecouvrementBL_B_DENo' AND object_id = OBJECT_ID('dbo.FG_MetaRecouvrementBL_B'))
    CREATE NONCLUSTERED INDEX IX_FG_MetaRecouvrementBL_B_DENo ON dbo.FG_MetaRecouvrementBL_B (DE_No);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FG_MetaRecouvrementBL_B_Solde' AND object_id = OBJECT_ID('dbo.FG_MetaRecouvrementBL_B'))
    CREATE NONCLUSTERED INDEX IX_FG_MetaRecouvrementBL_B_Solde ON dbo.FG_MetaRecouvrementBL_B (Solde);
GO

-- ---------------------------------------------------------------------------
-- 2. Synonym "vue active" — init sur _A (vide au départ, rempli au 1er run du job)
-- ---------------------------------------------------------------------------

IF EXISTS (SELECT 1 FROM sys.synonyms WHERE name = 'FG_MetaRecouvrementBL_Live')
    DROP SYNONYM dbo.FG_MetaRecouvrementBL_Live;
CREATE SYNONYM dbo.FG_MetaRecouvrementBL_Live FOR dbo.FG_MetaRecouvrementBL_A;
GO

-- ---------------------------------------------------------------------------
-- 3. Procédure de rafraîchissement
--    NB : la requête de calcul (CTE BL/FA_BL/DocumentsRaw/Documents/
--    ReglementSplit/ReglementAlloc/r + SELECT final) est identique à
--    vMetaRecouvrementBL v7 (SQL_007) et DUPLIQUÉE ici une fois par branche
--    (_A / _B) plutôt qu'en SQL dynamique : évite tout risque d'échappement de
--    guillemets sur une requête de cette taille, au prix d'une duplication —
--    si l'algorithme métier change (nouvelle TASK sur TASK-056), les DEUX
--    branches doivent être mises à jour à l'identique.
-- ---------------------------------------------------------------------------

CREATE OR ALTER PROCEDURE dbo.usp_RefreshFG_MetaRecouvrementBL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @Actif varchar(50);
    SELECT @Actif = base_object_name FROM sys.synonyms WHERE name = 'FG_MetaRecouvrementBL_Live';

    IF @Actif LIKE '%FG_MetaRecouvrementBL_A'
    BEGIN
        -----------------------------------------------------------------
        -- _A est active -> on recalcule dans _B, puis bascule vers _B
        -----------------------------------------------------------------
        TRUNCATE TABLE dbo.FG_MetaRecouvrementBL_B;

        ;WITH BL AS (
            SELECT
                l.DL_PieceBL,
                SUM(l.dl_montantttc)    AS DO_TotalTTC,
                l.DE_No,
                MIN(l.DL_DateBL)        AS DO_Date,
                COUNT(DISTINCT l.CT_Num) AS NbClients,
                MIN(l.CT_Num)           AS DO_Tiers
            FROM GOCOM.dbo.F_DOCLIGNE l
            WHERE l.DO_Type IN (6,7)
              AND l.DL_PieceBL <> ''
            GROUP BY l.DL_PieceBL, l.DE_No
        )
        , FA_BL AS (
            SELECT DISTINCT l.DO_Piece
            FROM GOCOM.dbo.F_DOCLIGNE l
            WHERE ISNULL(l.DL_PieceBL,'') <> ''
        )
        , DocumentsRaw AS (
            SELECT f.DO_Piece, f.DO_Date, f.DO_Tiers, f.DE_No, f.DO_TotalTTC, 1 AS NbClients, 1 AS Prio
            FROM GOCOM.dbo.FG_DOCENTETE_SAUV f

            UNION ALL

            SELECT f.DO_Piece, f.DO_Date, f.DO_Tiers, f.DE_No, f.DO_TotalTTC, 1 AS NbClients, 2 AS Prio
            FROM GOCOM.dbo.F_DOCENTETE f
            WHERE f.DO_Type IN (6,7)
              AND NOT EXISTS (SELECT 1 FROM GOCOM.dbo.FG_BlFacture bf WHERE bf.DO_NumFC = f.DO_Piece)
              AND NOT EXISTS (SELECT 1 FROM FA_BL WHERE FA_BL.DO_Piece = f.DO_Piece)
              AND NOT EXISTS (SELECT 1 FROM GOCOM.dbo.FG_DOCENTETE_SAUV s WHERE s.DO_Piece = f.DO_Coord03)

            UNION ALL

            SELECT b.DL_PieceBL AS DO_Piece, b.DO_Date, b.DO_Tiers, b.DE_No, b.DO_TotalTTC, b.NbClients, 3 AS Prio
            FROM BL b
            WHERE NOT EXISTS (SELECT 1 FROM GOCOM.dbo.FG_BlFacture bf WHERE bf.DO_NumFC = b.DL_PieceBL)
        )
        , Documents AS (
            SELECT DO_Piece, DO_Date, DO_Tiers, DE_No, DO_TotalTTC, NbClients
            FROM (
                SELECT DO_Piece, DO_Date, DO_Tiers, DE_No, DO_TotalTTC, NbClients,
                       ROW_NUMBER() OVER (PARTITION BY DO_Piece ORDER BY Prio) AS rn
                FROM DocumentsRaw
            ) x
            WHERE rn = 1
        )
        , ReglementSplit AS (
            SELECT r.MV_Numero, r.MV_Montant, LTRIM(RTRIM(s.value)) AS NumeroBL
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
                SUM(CASE
                        WHEN MontantDisponible <= 0          THEN 0
                        WHEN MontantDisponible >= DO_TotalTTC THEN DO_TotalTTC
                        ELSE MontantDisponible
                    END) AS TotalReglement
            FROM ReglementAlloc
            GROUP BY NumeroBL
        )
        INSERT INTO dbo.FG_MetaRecouvrementBL_B
            (DO_Piece, DO_Date, DO_Tiers, CT_Intitule, NbClients, DE_No, DO_TotalTTC, TotalReglement, Solde, Controle)
        SELECT
            d.DO_Piece, d.DO_Date, d.DO_Tiers, c.CT_Intitule, d.NbClients, d.DE_No, d.DO_TotalTTC,
            ISNULL(r.TotalReglement,0) AS TotalReglement,
            CASE WHEN d.DO_TotalTTC < 0 THEN ISNULL(e.EC_Solde,0)
                 ELSE d.DO_TotalTTC - ISNULL(r.TotalReglement,0) END AS Solde,
            CASE WHEN ISNULL(r.TotalReglement,0) > d.DO_TotalTTC THEN 'ANOMALIE' ELSE 'OK' END AS Controle
        FROM Documents d
        LEFT JOIN r ON d.DO_Piece = r.NumeroBL
        INNER JOIN GOCOM.dbo.F_COMPTET c ON c.CT_Num = d.DO_Tiers
        INNER JOIN GOCOM.dbo.F_DEPOT depSage ON depSage.DE_No = d.DE_No
        LEFT JOIN (
            SELECT DO_Numero, SUM(EC_Solde) AS EC_Solde
            FROM RT_ECHEANCE
            GROUP BY DO_Numero
        ) e ON e.DO_Numero = d.DO_Piece;

        BEGIN TRAN;
            DROP SYNONYM dbo.FG_MetaRecouvrementBL_Live;
            CREATE SYNONYM dbo.FG_MetaRecouvrementBL_Live FOR dbo.FG_MetaRecouvrementBL_B;
        COMMIT;
    END
    ELSE
    BEGIN
        -----------------------------------------------------------------
        -- _B est active (ou synonym absent au tout 1er run) -> on recalcule
        -- dans _A, puis bascule vers _A
        -----------------------------------------------------------------
        TRUNCATE TABLE dbo.FG_MetaRecouvrementBL_A;

        ;WITH BL AS (
            SELECT
                l.DL_PieceBL,
                SUM(l.dl_montantttc)    AS DO_TotalTTC,
                l.DE_No,
                MIN(l.DL_DateBL)        AS DO_Date,
                COUNT(DISTINCT l.CT_Num) AS NbClients,
                MIN(l.CT_Num)           AS DO_Tiers
            FROM GOCOM.dbo.F_DOCLIGNE l
            WHERE l.DO_Type IN (6,7)
              AND l.DL_PieceBL <> ''
            GROUP BY l.DL_PieceBL, l.DE_No
        )
        , FA_BL AS (
            SELECT DISTINCT l.DO_Piece
            FROM GOCOM.dbo.F_DOCLIGNE l
            WHERE ISNULL(l.DL_PieceBL,'') <> ''
        )
        , DocumentsRaw AS (
            SELECT f.DO_Piece, f.DO_Date, f.DO_Tiers, f.DE_No, f.DO_TotalTTC, 1 AS NbClients, 1 AS Prio
            FROM GOCOM.dbo.FG_DOCENTETE_SAUV f

            UNION ALL

            SELECT f.DO_Piece, f.DO_Date, f.DO_Tiers, f.DE_No, f.DO_TotalTTC, 1 AS NbClients, 2 AS Prio
            FROM GOCOM.dbo.F_DOCENTETE f
            WHERE f.DO_Type IN (6,7)
              AND NOT EXISTS (SELECT 1 FROM GOCOM.dbo.FG_BlFacture bf WHERE bf.DO_NumFC = f.DO_Piece)
              AND NOT EXISTS (SELECT 1 FROM FA_BL WHERE FA_BL.DO_Piece = f.DO_Piece)
              AND NOT EXISTS (SELECT 1 FROM GOCOM.dbo.FG_DOCENTETE_SAUV s WHERE s.DO_Piece = f.DO_Coord03)

            UNION ALL

            SELECT b.DL_PieceBL AS DO_Piece, b.DO_Date, b.DO_Tiers, b.DE_No, b.DO_TotalTTC, b.NbClients, 3 AS Prio
            FROM BL b
            WHERE NOT EXISTS (SELECT 1 FROM GOCOM.dbo.FG_BlFacture bf WHERE bf.DO_NumFC = b.DL_PieceBL)
        )
        , Documents AS (
            SELECT DO_Piece, DO_Date, DO_Tiers, DE_No, DO_TotalTTC, NbClients
            FROM (
                SELECT DO_Piece, DO_Date, DO_Tiers, DE_No, DO_TotalTTC, NbClients,
                       ROW_NUMBER() OVER (PARTITION BY DO_Piece ORDER BY Prio) AS rn
                FROM DocumentsRaw
            ) x
            WHERE rn = 1
        )
        , ReglementSplit AS (
            SELECT r.MV_Numero, r.MV_Montant, LTRIM(RTRIM(s.value)) AS NumeroBL
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
                SUM(CASE
                        WHEN MontantDisponible <= 0          THEN 0
                        WHEN MontantDisponible >= DO_TotalTTC THEN DO_TotalTTC
                        ELSE MontantDisponible
                    END) AS TotalReglement
            FROM ReglementAlloc
            GROUP BY NumeroBL
        )
        INSERT INTO dbo.FG_MetaRecouvrementBL_A
            (DO_Piece, DO_Date, DO_Tiers, CT_Intitule, NbClients, DE_No, DO_TotalTTC, TotalReglement, Solde, Controle)
        SELECT
            d.DO_Piece, d.DO_Date, d.DO_Tiers, c.CT_Intitule, d.NbClients, d.DE_No, d.DO_TotalTTC,
            ISNULL(r.TotalReglement,0) AS TotalReglement,
            CASE WHEN d.DO_TotalTTC < 0 THEN ISNULL(e.EC_Solde,0)
                 ELSE d.DO_TotalTTC - ISNULL(r.TotalReglement,0) END AS Solde,
            CASE WHEN ISNULL(r.TotalReglement,0) > d.DO_TotalTTC THEN 'ANOMALIE' ELSE 'OK' END AS Controle
        FROM Documents d
        LEFT JOIN r ON d.DO_Piece = r.NumeroBL
        INNER JOIN GOCOM.dbo.F_COMPTET c ON c.CT_Num = d.DO_Tiers
        INNER JOIN GOCOM.dbo.F_DEPOT depSage ON depSage.DE_No = d.DE_No
        LEFT JOIN (
            SELECT DO_Numero, SUM(EC_Solde) AS EC_Solde
            FROM RT_ECHEANCE
            GROUP BY DO_Numero
        ) e ON e.DO_Numero = d.DO_Piece;

        BEGIN TRAN;
            IF EXISTS (SELECT 1 FROM sys.synonyms WHERE name = 'FG_MetaRecouvrementBL_Live')
                DROP SYNONYM dbo.FG_MetaRecouvrementBL_Live;
            CREATE SYNONYM dbo.FG_MetaRecouvrementBL_Live FOR dbo.FG_MetaRecouvrementBL_A;
        COMMIT;
    END
END
GO

-- ---------------------------------------------------------------------------
-- 4. vMetaRecouvrementBL devient une lecture simple du synonym actif
--    (même nom, même colonnes -> aucun changement côté requête Metabase)
-- ---------------------------------------------------------------------------

CREATE OR ALTER VIEW dbo.vMetaRecouvrementBL
AS
SELECT DO_Piece, DO_Date, DO_Tiers, CT_Intitule, NbClients, DE_No, DO_TotalTTC, TotalReglement, Solde, Controle
FROM dbo.FG_MetaRecouvrementBL_Live;
GO

-- ---------------------------------------------------------------------------
-- 5. Job SQL Agent — exécute le rafraîchissement toutes les 15 min
--    (borne basse de la tolérance 15-30 min retenue par le PO — marge de
--    sécurité si le calcul dépasse ponctuellement les ~3-4 min mesurés)
-- ---------------------------------------------------------------------------

USE msdb;
GO

IF EXISTS (SELECT 1 FROM msdb.dbo.sysjobs WHERE name = N'GR_GOCOM - Refresh MetaRecouvrementBL')
    EXEC msdb.dbo.sp_delete_job @job_name = N'GR_GOCOM - Refresh MetaRecouvrementBL';
GO

EXEC msdb.dbo.sp_add_job
    @job_name = N'GR_GOCOM - Refresh MetaRecouvrementBL',
    @enabled = 1,
    @description = N'TASK-058 : recalcul complet du recouvrement par BL (blue-green) toutes les 15 min';

EXEC msdb.dbo.sp_add_jobstep
    @job_name = N'GR_GOCOM - Refresh MetaRecouvrementBL',
    @step_name = N'Refresh',
    @subsystem = N'TSQL',
    @database_name = N'GR_GOCOM',
    @command = N'EXEC dbo.usp_RefreshFG_MetaRecouvrementBL;',
    @on_success_action = 1,   -- terminer le job en réussite
    @on_fail_action = 2;      -- terminer le job en échec (visible dans l'historique job SQL Agent)

EXEC msdb.dbo.sp_add_schedule
    @schedule_name = N'Toutes les 15 min',
    @freq_type = 4,           -- quotidien
    @freq_interval = 1,
    @freq_subday_type = 4,    -- minutes
    @freq_subday_interval = 15,
    @active_start_time = 0;

EXEC msdb.dbo.sp_attach_schedule
    @job_name = N'GR_GOCOM - Refresh MetaRecouvrementBL',
    @schedule_name = N'Toutes les 15 min';

EXEC msdb.dbo.sp_add_jobserver
    @job_name = N'GR_GOCOM - Refresh MetaRecouvrementBL',
    @server_name = N'(local)';
GO
