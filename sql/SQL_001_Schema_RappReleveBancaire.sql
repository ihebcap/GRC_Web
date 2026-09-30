-- =========================================
-- 1. Création de la table ENTÊTE
-- =========================================
CREATE TABLE [dbo].[RAPP_ReleveBancaire_Entete] (
    [Id] INT IDENTITY(1,1) NOT NULL,
    [BanqueId] INT NULL, 
    [Titre] NVARCHAR(255) NOT NULL,
    [DateImport] DATETIME NOT NULL DEFAULT GETDATE(),
    [ImportePar_UserId] NVARCHAR(100) NULL, 
    
    CONSTRAINT [PK_RAPP_ReleveBancaire_Entete] PRIMARY KEY CLUSTERED ([Id] ASC)
);
GO

-- =========================================
-- 2. Création de la table LIGNES
-- =========================================
CREATE TABLE [dbo].[RAPP_ReleveBancaire_Ligne] (
    [Id] INT IDENTITY(1,1) NOT NULL,
    [ReleveBancaireEnteteId] INT NOT NULL,
    
    [DateOperation] DATETIME NULL,
    [DateValeur] DATETIME NULL,
    [Libelle] NVARCHAR(MAX) NULL,
    [Reference] NVARCHAR(255) NULL, 
    [Code] NVARCHAR(100) NULL,      
    
    [Debit] DECIMAL(18, 2) NULL,
    [Credit] DECIMAL(18, 2) NULL,
    [MontantReel] DECIMAL(18, 2) NULL, 
    
    [Lettrage] NVARCHAR(50) NULL,
    [MV_ID] INT NULL, -- Identifiant du règlement GRC avec lequel la ligne est rapprochée
    [ReservePar_UserId] [int] NULL,     -- Réservation (TASK-016)
	[DateReservation] [datetime] NULL,  -- Réservation (TASK-016)
    [DateValidation] [datetime] NULL,   -- NULL = en cours, renseignée = pushée/pointée en GRC (TASK-022)
    CONSTRAINT [PK_RAPP_ReleveBancaire_Ligne] PRIMARY KEY CLUSTERED ([Id] ASC),
    -- Sans le "ON DELETE CASCADE", SQL Server bloquera toute tentative 
    -- de suppression d'un relevé si des lignes y sont encore attachées !
    CONSTRAINT [FK_RAPP_Ligne_Entete] FOREIGN KEY ([ReleveBancaireEnteteId]) 
        REFERENCES [dbo].[RAPP_ReleveBancaire_Entete] ([Id])
);
GO

-- =========================================
-- 3. Ajout d'Index (Pour la performance)
-- =========================================
CREATE NONCLUSTERED INDEX [IX_RAPP_Ligne_MontantReel] ON [dbo].[RAPP_ReleveBancaire_Ligne] ([MontantReel]);
CREATE NONCLUSTERED INDEX [IX_RAPP_Ligne_Lettrage] ON [dbo].[RAPP_ReleveBancaire_Ligne] ([Lettrage]);
CREATE NONCLUSTERED INDEX [IX_RAPP_Ligne_Credit] ON [dbo].[RAPP_ReleveBancaire_Ligne] ([Credit]);
CREATE NONCLUSTERED INDEX [IX_RAPP_Ligne_MV_ID] ON [dbo].[RAPP_ReleveBancaire_Ligne] ([MV_ID]);
GO

-- Garde-fou : un règlement GRC réservé au plus une fois (TASK-016)
CREATE UNIQUE INDEX [UX_RAPP_Ligne_MVID]
    ON [dbo].[RAPP_ReleveBancaire_Ligne] ([MV_ID]) WHERE [MV_ID] IS NOT NULL;
GO