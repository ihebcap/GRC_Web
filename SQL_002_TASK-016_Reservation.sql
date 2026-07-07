ALTER TABLE dbo.RAPP_ReleveBancaire_Ligne ADD
    ReservePar_UserId INT NULL,
    DateReservation   DATETIME NULL;
GO

-- Garde-fou base : un règlement GRC réservé au plus une fois
CREATE UNIQUE INDEX UX_RAPP_Ligne_MVID
    ON dbo.RAPP_ReleveBancaire_Ligne(MV_ID) WHERE MV_ID IS NOT NULL;
GO
