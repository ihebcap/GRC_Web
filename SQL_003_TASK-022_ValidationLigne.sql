ALTER TABLE dbo.RAPP_ReleveBancaire_Ligne
ADD DateValidation DATETIME NULL;
GO

-- Backfill des lignes déjà pushées
UPDATE l SET l.DateValidation = GETDATE()
FROM dbo.RAPP_ReleveBancaire_Ligne l
JOIN dbo.RT_MOUVEMENT m ON m.MV_Id = l.MV_ID
WHERE l.MV_ID IS NOT NULL AND l.DateValidation IS NULL AND m.MV_Point = 1;
GO
