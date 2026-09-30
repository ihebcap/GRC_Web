-- =============================================================================
-- SQL_009 — TASK-086 : Table d'historique des modifications de règlement
-- Base : GR_GOCOM
-- Contexte : Traçabilité des modifications sur Date, Client, Montant, Banque, Référence
-- Granularité : 1 ligne par modification globale (avant / après / utilisateur / date)
-- Conservation illimitée, aucune purge prévue (table d'audit).
-- =============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID('dbo.GRC_ReglementModificationHistorique') AND type = 'U')
BEGIN
    CREATE TABLE dbo.GRC_ReglementModificationHistorique (
        Id                      INT IDENTITY(1,1)   NOT NULL,
        ReglementNo             INT                 NOT NULL,
        UserId                  INT                 NOT NULL,
        UserName                NVARCHAR(100)       NULL,
        DateModification        DATETIME            NOT NULL CONSTRAINT DF_GRC_ReglementModificationHistorique_Date DEFAULT GETDATE(),
        ChampsModifies          NVARCHAR(255)       NOT NULL,

        -- Date
        AncienneDate            DATETIME            NULL,
        NouvelleDate            DATETIME            NULL,

        -- Client
        AncienClientNo          INT                 NULL,
        NouveauClientNo         INT                 NULL,
        AncienClientCode        NVARCHAR(50)        NULL,
        NouveauClientCode       NVARCHAR(50)        NULL,
        AncienClientIntitule    NVARCHAR(200)       NULL,
        NouveauClientIntitule   NVARCHAR(200)       NULL,

        -- Montant
        AncienMontant           NUMERIC(24,6)       NULL,
        NouveauMontant          NUMERIC(24,6)       NULL,

        -- Banque
        AncienneBanqueNo        INT                 NULL,
        NouvelleBanqueNo        INT                 NULL,

        -- Référence
        AncienneReference       NVARCHAR(100)       NULL,
        NouvelleReference       NVARCHAR(100)       NULL,

        -- JSON complet pour audit et affichage UI structuré
        ModificationsJson       NVARCHAR(MAX)       NULL,

        CONSTRAINT PK_GRC_ReglementModificationHistorique PRIMARY KEY CLUSTERED (Id)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_GRC_ReglementModificationHistorique_ReglementNo' AND object_id = OBJECT_ID('dbo.GRC_ReglementModificationHistorique'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_GRC_ReglementModificationHistorique_ReglementNo
        ON dbo.GRC_ReglementModificationHistorique (ReglementNo, DateModification DESC);
END
GO
