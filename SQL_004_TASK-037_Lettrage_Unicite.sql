-- =====================================================================
-- TASK-037 : Unicite de la lettre de rapprochement
--   Ordre IMPERATIF : 1) remediation des doublons  2) index unique filtre
--   (creer l'index avant la remediation ferait echouer la migration).
--   Aucune colonne compteur / sequence / identite n'est ajoutee (decision PO).
--   Operations sur RAPP_ReleveBancaire_* uniquement (aucun acces GRC).
--   A lancer HORS SESSION (la lettre sert de cle de matching cote front).
-- =====================================================================
SET NOCOUNT ON;
GO

PRINT '=== TASK-037 : ETAPE 1 - Remediation des doublons (ReleveBancaireEnteteId, Lettrage) ===';

-- 1. Reconstituer l'index base 26 (A=1, B=2, ... Z=26, AA=27, ...) de chaque lettre presente.
--    Meme algorithme que GRC.Application.Services.LettrageGenerator.GetIndexFromLettrage.
IF OBJECT_ID('tempdb..#Lettres') IS NOT NULL DROP TABLE #Lettres;
CREATE TABLE #Lettres (
    Id       INT PRIMARY KEY,
    EnteteId INT,
    Lettrage NVARCHAR(50),
    Idx      INT
);

DECLARE @Id INT, @EnteteId INT, @Lettrage NVARCHAR(50);
DECLARE cur_parse CURSOR LOCAL FAST_FORWARD FOR
    SELECT Id, ReleveBancaireEnteteId, Lettrage
    FROM dbo.RAPP_ReleveBancaire_Ligne
    WHERE Lettrage IS NOT NULL;
OPEN cur_parse;
FETCH NEXT FROM cur_parse INTO @Id, @EnteteId, @Lettrage;
WHILE @@FETCH_STATUS = 0
BEGIN
    DECLARE @i INT = 1, @idx INT = 0, @ch INT;
    WHILE @i <= LEN(@Lettrage)
    BEGIN
        SET @ch = ASCII(UPPER(SUBSTRING(@Lettrage, @i, 1))) - 64; -- 'A' -> 1
        IF @ch BETWEEN 1 AND 26
            SET @idx = @idx * 26 + @ch;
        SET @i = @i + 1;
    END
    INSERT INTO #Lettres (Id, EnteteId, Lettrage, Idx) VALUES (@Id, @EnteteId, @Lettrage, @idx);
    FETCH NEXT FROM cur_parse INTO @Id, @EnteteId, @Lettrage;
END
CLOSE cur_parse; DEALLOCATE cur_parse;

-- 2. Groupes en doublon (EnteteId, Lettrage) avec COUNT(*) > 1 : garder 1 ligne (min Id),
--    renumeroter les autres. La paire est portee par la ligne (Id releve + MV_ID GRC) :
--    changer sa lettre ne casse pas l'appariement stocke.
IF OBJECT_ID('tempdb..#ToRenum') IS NOT NULL DROP TABLE #ToRenum;
SELECT l.Id, l.EnteteId, l.Lettrage AS OldLettrage,
       ROW_NUMBER() OVER (PARTITION BY l.EnteteId, l.Lettrage ORDER BY l.Id) AS rn
INTO #ToRenum
FROM #Lettres l
WHERE EXISTS (
    SELECT 1 FROM #Lettres d
    WHERE d.EnteteId = l.EnteteId AND d.Lettrage = l.Lettrage
    GROUP BY d.EnteteId, d.Lettrage HAVING COUNT(*) > 1
);
DELETE FROM #ToRenum WHERE rn = 1; -- on conserve la premiere ligne de chaque groupe

-- 3. Nouvel index par entete : au-dela de la lettre max existante de l'entete,
--    incremente par rang (ordonne par Id). Les lettres conservees sont <= MaxIdx,
--    les nouvelles > MaxIdx => aucune collision.
IF OBJECT_ID('tempdb..#MaxIdx') IS NOT NULL DROP TABLE #MaxIdx;
SELECT EnteteId, MAX(Idx) AS MaxIdx
INTO #MaxIdx
FROM #Lettres
GROUP BY EnteteId;

IF OBJECT_ID('tempdb..#Assign') IS NOT NULL DROP TABLE #Assign;
SELECT t.Id, t.EnteteId, t.OldLettrage,
       m.MaxIdx + ROW_NUMBER() OVER (PARTITION BY t.EnteteId ORDER BY t.Id) AS NewIdx,
       CAST(NULL AS NVARCHAR(50)) AS NewLettrage
INTO #Assign
FROM #ToRenum t
JOIN #MaxIdx m ON m.EnteteId = t.EnteteId;

-- 4. Conversion index -> lettre base 26 (meme algo que LettrageGenerator.GetLettrage).
DECLARE @aId INT, @aIdx INT;
DECLARE cur_gen CURSOR LOCAL FAST_FORWARD FOR SELECT Id, NewIdx FROM #Assign;
OPEN cur_gen;
FETCH NEXT FROM cur_gen INTO @aId, @aIdx;
WHILE @@FETCH_STATUS = 0
BEGIN
    DECLARE @n INT = @aIdx, @res NVARCHAR(50) = N'', @mod INT;
    WHILE @n > 0
    BEGIN
        SET @mod = (@n - 1) % 26;
        SET @res = CHAR(65 + @mod) + @res; -- 65 = 'A'
        SET @n = (@n - @mod) / 26;
    END
    UPDATE #Assign SET NewLettrage = @res WHERE Id = @aId;
    FETCH NEXT FROM cur_gen INTO @aId, @aIdx;
END
CLOSE cur_gen; DEALLOCATE cur_gen;

-- 5. Journalisation des renumérotations (Id, entete, ancienne -> nouvelle lettre).
SELECT Id, EnteteId, OldLettrage AS AncienneLettre, NewLettrage AS NouvelleLettre
FROM #Assign
ORDER BY EnteteId, Id;

DECLARE @nbRenum INT = (SELECT COUNT(*) FROM #Assign);
PRINT CAST(@nbRenum AS VARCHAR(10)) + ' ligne(s) renumerotee(s).';

-- 6. Application des nouvelles lettres.
UPDATE l SET l.Lettrage = a.NewLettrage
FROM dbo.RAPP_ReleveBancaire_Ligne l
JOIN #Assign a ON a.Id = l.Id;

DROP TABLE #Lettres; DROP TABLE #ToRenum; DROP TABLE #MaxIdx; DROP TABLE #Assign;
GO

PRINT '=== TASK-037 : ETAPE 2 - Garde-fou base (index unique filtre) ===';

-- Dernier rempart uniquement : n'attribue aucune lettre. L'allocation reste calculee serveur.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_RAPP_Ligne_Entete_Lettrage')
BEGIN
    CREATE UNIQUE INDEX UX_RAPP_Ligne_Entete_Lettrage
        ON dbo.RAPP_ReleveBancaire_Ligne (ReleveBancaireEnteteId, Lettrage)
        WHERE Lettrage IS NOT NULL;
    PRINT 'Index UX_RAPP_Ligne_Entete_Lettrage cree.';
END
ELSE
    PRINT 'Index UX_RAPP_Ligne_Entete_Lettrage deja present (skip).';
GO
