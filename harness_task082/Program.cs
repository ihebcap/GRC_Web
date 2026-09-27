using System;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using Dapper;
using GRC.Infrastructure.Data;
using GRC.Infrastructure.Repositories;
using Microsoft.Extensions.Logging;

const string ConnString = "Server=localhost;Database=GR_GOCOM;Integrated Security=True;TrustServerCertificate=True";

Console.WriteLine("================================================================================");
Console.WriteLine("   HARNESS VALIDATION TASK-082 — TEST RÉEL BASE DE DONNÉES SQL SERVER");
Console.WriteLine("================================================================================");

int totalTests = 0;
int passedTests = 0;

void AssertTrue(string description, bool condition, string detail = "")
{
    totalTests++;
    if (condition)
    {
        Console.WriteLine($"  [PASS] {description}");
        passedTests++;
    }
    else
    {
        Console.WriteLine($"  [FAIL] {description} : {detail}");
    }
}

using var loggerFactory = LoggerFactory.Create(builder =>
{
    builder.AddConsole().SetMinimumLevel(LogLevel.Information);
});
var logger = loggerFactory.CreateLogger<ReleveBancaireRepository>();

// ------------------------------------------------------------------------------------------------
// 0. VÉRIFICATION DÉSIÉRIALISATION JSON DU PAYLOAD FRONT
// ------------------------------------------------------------------------------------------------
Console.WriteLine("\n--- ÉTAPE 0 : Désérialisation JSON du payload front vers ValidationPairDto ---");

string jsonFront = """
[
  { "releveLigneId": 10, "grcReglementId": 20, "lettrage": "A", "codeExcel": "VIR01", "libelle": "VIR TEST FRONT", "dateValeur": "2026-09-20" },
  { "releveLigneId": 11, "grcReglementId": 21, "lettrage": "B", "codeExcel": "VIR02", "libelle": null, "dateValeur": null }
]
""";
var jsonPairs = JsonSerializer.Deserialize<List<ValidationPairDto>>(jsonFront, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
AssertTrue("Désérialisation JSON front : 2 paires reçues", jsonPairs != null && jsonPairs.Count == 2);
AssertTrue("Paire 1: Libelle renseigné correctement désérialisé", jsonPairs?[0].Libelle == "VIR TEST FRONT");
AssertTrue("Paire 2: Libelle null correctement désérialisé", jsonPairs?[1].Libelle == null);

using var conn = new SqlConnection(ConnString);
await conn.OpenAsync();

// ------------------------------------------------------------------------------------------------
// 1. VÉRIFICATION ENVIRONNEMENT SQL SERVER RÉEL
// ------------------------------------------------------------------------------------------------
Console.WriteLine("\n--- ÉTAPE 1 : Vérification de la base réelle et de la vue vw_ReglementsAComptabiliser ---");

var countMv = await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM RT_MOUVEMENT");
AssertTrue($"Base GR_GOCOM accessible, RT_MOUVEMENT contient {countMv} lignes", countMv > 0);

var countView = await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM vw_ReglementsAComptabiliser");
AssertTrue($"Vue SQL vw_ReglementsAComptabiliser accessible et exécutable ({countView} lignes)", countView > 0);

// ------------------------------------------------------------------------------------------------
// 2. SÉLECTION ET PRÉPARATION DE 2 RÈGLEMENTS VERSEMENT RÉELS (MV_Type = 3)
// ------------------------------------------------------------------------------------------------
Console.WriteLine("\n--- ÉTAPE 2 : Sélection et préparation de 2 règlements versement réels ---");

// Trouver 2 règlements versement (MV_Type = 3)
var reglements = (await conn.QueryAsync<dynamic>(@"
    SELECT TOP 2 MV_ID, MV_Numero, MV_Type, MV_Montant, MV_Piece, MV_Reference, MV_Libelle, MV_Point
    FROM RT_MOUVEMENT
    WHERE MV_Type = 3 AND MV_Domaine = 0
    ORDER BY MV_ID DESC
")).AsList();

AssertTrue("2 règlements de type versement (MV_Type = 3) trouvés", reglements.Count == 2);

int mvId1 = (int)reglements[0].MV_ID;
int mvId2 = (int)reglements[1].MV_ID;
string originalPiece1 = (string)reglements[0].MV_Piece ?? "";
string originalLibelle1 = (string)reglements[0].MV_Libelle ?? "";
string originalPiece2 = (string)reglements[1].MV_Piece ?? "";
string originalLibelle2 = (string)reglements[1].MV_Libelle ?? "";

Console.WriteLine($"  Règlement 1 cible : MV_ID={mvId1}, MV_Numero={reglements[0].MV_Numero}, MV_Piece={originalPiece1}, MV_Libelle='{originalLibelle1}'");
Console.WriteLine($"  Règlement 2 cible : MV_ID={mvId2}, MV_Numero={reglements[1].MV_Numero}, MV_Piece={originalPiece2}, MV_Libelle='{originalLibelle2}'");

// Nettoyer préalablement toute donnée de test résiduelle
await conn.ExecuteAsync(@"
    DELETE l FROM RAPP_ReleveBancaire_Ligne l 
    JOIN RAPP_ReleveBancaire_Entete e ON e.Id = l.ReleveBancaireEnteteId 
    WHERE e.Titre LIKE 'RELEVE TEST TASK-082%' OR l.MV_ID IN (@MvId1, @MvId2);
    DELETE FROM RAPP_ReleveBancaire_Entete WHERE Titre LIKE 'RELEVE TEST TASK-082%';
", new { MvId1 = mvId1, MvId2 = mvId2 });

// Réinitialiser l'état initial des règlements pour le test
await conn.ExecuteAsync(@"
    UPDATE RT_MOUVEMENT 
    SET MV_Point = 0, MV_Piece = @Piece1, MV_Libelle = '', MV_ExtraitNum = NULL, MV_Info1 = NULL 
    WHERE MV_ID = @MvId1;
    UPDATE RT_MOUVEMENT 
    SET MV_Point = 0, MV_Piece = @Piece2, MV_Libelle = '', MV_ExtraitNum = NULL, MV_Info1 = NULL 
    WHERE MV_ID = @MvId2;
", new { MvId1 = mvId1, Piece1 = "INIT_P1", MvId2 = mvId2, Piece2 = "INIT_P2" });

// Vérifier l'état initial dans la vue SQL réelle
var viewInitial1 = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
    SELECT MV_ID, MV_Piece, LibelleEcriture, MV_Libelle 
    FROM vw_ReglementsAComptabiliser 
    WHERE MV_ID = @MvId", new { MvId = mvId1 });

AssertTrue("Vue SQL initiale pour Règlement 1 : LibelleEcriture == 'Versement' (repli actif)",
    viewInitial1 != null && (string)viewInitial1.LibelleEcriture == "Versement");

// ------------------------------------------------------------------------------------------------
// 3. CRÉATION DU RELEVÉ ET DES LIGNES BANCAIRES DANS RAPP_ReleveBancaire_*
// ------------------------------------------------------------------------------------------------
Console.WriteLine("\n--- ÉTAPE 3 : Création d'un relevé bancaire et réservation réelle des lignes ---");

int enteteId = await conn.ExecuteScalarAsync<int>(@"
    INSERT INTO RAPP_ReleveBancaire_Entete (Titre, DateImport, ImportePar_UserId)
    OUTPUT INSERTED.Id
    VALUES ('RELEVE TEST TASK-082', GETDATE(), '1')
");

string bankLibelleTest = "VIR SEPA CLIENT SARL TEST TASK082";
string bankCodeTest1 = "CODE_BNK_082";
string bankCodeTest2 = "CODE_BNK_NULL";

var testDate = new DateTime(2026, 9, 20);

int ligneId1 = await conn.ExecuteScalarAsync<int>(@"
    INSERT INTO RAPP_ReleveBancaire_Ligne 
        (ReleveBancaireEnteteId, DateOperation, DateValeur, Libelle, Code, Credit, Lettrage, MV_ID, ReservePar_UserId, DateReservation)
    OUTPUT INSERTED.Id
    VALUES 
        (@EnteteId, @DateOp, @DateVal, @Libelle, @Code, 100.00, 'Z1', @MvId, 1, GETDATE())
", new { EnteteId = enteteId, DateOp = testDate, DateVal = testDate, Libelle = bankLibelleTest, Code = bankCodeTest1, MvId = mvId1 });

int ligneId2 = await conn.ExecuteScalarAsync<int>(@"
    INSERT INTO RAPP_ReleveBancaire_Ligne 
        (ReleveBancaireEnteteId, DateOperation, DateValeur, Libelle, Code, Credit, Lettrage, MV_ID, ReservePar_UserId, DateReservation)
    OUTPUT INSERTED.Id
    VALUES 
        (@EnteteId, @DateOp, @DateVal, NULL, @Code, 200.00, 'Z2', @MvId, 1, GETDATE())
", new { EnteteId = enteteId, DateOp = testDate, DateVal = testDate, Code = bankCodeTest2, MvId = mvId2 });

Console.WriteLine($"  Entête relevé créé : Id={enteteId}");
Console.WriteLine($"  Ligne 1 créée : Id={ligneId1}, Libelle='{bankLibelleTest}', Code='{bankCodeTest1}', MV_ID={mvId1}");
Console.WriteLine($"  Ligne 2 créée : Id={ligneId2}, Libelle=NULL, Code='{bankCodeTest2}', MV_ID={mvId2}");

// ------------------------------------------------------------------------------------------------
// 4. EXÉCUTION DU VRAI SauvegarderValidationAsync VIA LE VRAI REPOSITORY
// ------------------------------------------------------------------------------------------------
Console.WriteLine("\n--- ÉTAPE 4 : Exécution réelle de ReleveBancaireRepository.SauvegarderValidationAsync ---");

var dbFactory = new DbConnectionFactory(ConnString);
var releveRepo = new ReleveBancaireRepository(dbFactory, null!, logger);

var validationPairs = new List<ValidationPairDto>
{
    new ValidationPairDto
    {
        ReleveLigneId = ligneId1,
        GrcReglementId = mvId1,
        Lettrage = "Z1",
        CodeExcel = bankCodeTest1,
        Libelle = bankLibelleTest,
        DateValeur = new DateTime(2026, 9, 20)
    },
    new ValidationPairDto
    {
        ReleveLigneId = ligneId2,
        GrcReglementId = mvId2,
        Lettrage = "Z2",
        CodeExcel = bankCodeTest2,
        Libelle = null, // Cas libellé NULL
        DateValeur = new DateTime(2026, 9, 20)
    }
};

var valResult = await releveRepo.SauvegarderValidationAsync(validationPairs, userId: 1, isAdmin: true);

AssertTrue("SauvegarderValidationAsync a réussi", valResult.Success);
AssertTrue("2 lignes validées avec succès", valResult.SuccessCount == 2);
AssertTrue("0 erreur rencontrée", valResult.ErrorCount == 0);

// ------------------------------------------------------------------------------------------------
// 5. VÉRIFICATION DE LA PERSISTANCE RÉELLE EN BASE (TABLE RT_MOUVEMENT)
// ------------------------------------------------------------------------------------------------
Console.WriteLine("\n--- ÉTAPE 5 : Relecture réelle en base dans la table RT_MOUVEMENT ---");

var rowMv1 = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
    SELECT MV_ID, MV_Point, MV_Piece, MV_Libelle, MV_ExtraitNum, MV_Info1 
    FROM RT_MOUVEMENT 
    WHERE MV_ID = @MvId", new { MvId = mvId1 });

AssertTrue("Règlement 1 en base : MV_Point == 1 (pointé)", (int)rowMv1.MV_Point == 1);
AssertTrue($"Règlement 1 en base : MV_Piece == '{bankCodeTest1}'", (string)rowMv1.MV_Piece == bankCodeTest1);
AssertTrue($"Règlement 1 en base : MV_Libelle == '{bankLibelleTest}' (PERSISTÉ EN BASE !)", (string)rowMv1.MV_Libelle == bankLibelleTest);

var rowMv2 = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
    SELECT MV_ID, MV_Point, MV_Piece, MV_Libelle, MV_ExtraitNum, MV_Info1 
    FROM RT_MOUVEMENT 
    WHERE MV_ID = @MvId", new { MvId = mvId2 });

AssertTrue("Règlement 2 en base : MV_Point == 1 (pointé)", (int)rowMv2.MV_Point == 1);
AssertTrue($"Règlement 2 en base : MV_Piece == '{bankCodeTest2}'", (string)rowMv2.MV_Piece == bankCodeTest2);
AssertTrue("Règlement 2 en base : MV_Libelle non écrasé par chaîne vide (NULL/vide conservé)",
    string.IsNullOrEmpty((string)rowMv2.MV_Libelle));

// ------------------------------------------------------------------------------------------------
// 6. EXÉCUTION RÉELLE DE LA VUE SQL vw_ReglementsAComptabiliser
// ------------------------------------------------------------------------------------------------
Console.WriteLine("\n--- ÉTAPE 6 : Exécution réelle de la vue vw_ReglementsAComptabiliser par SQL Server ---");

var viewResult1 = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
    SELECT MV_ID, MV_Numero, MV_Piece, ReferenceCompta, MV_Libelle, LibelleEcriture 
    FROM vw_ReglementsAComptabiliser 
    WHERE MV_ID = @MvId", new { MvId = mvId1 });

Console.WriteLine($"  Vue SQL Règlement 1 : MV_Piece='{viewResult1.MV_Piece}', MV_Libelle='{viewResult1.MV_Libelle}', LibelleEcriture='{viewResult1.LibelleEcriture}'");
AssertTrue($"Vue SQL réelle Règlement 1 : LibelleEcriture renvoie '{bankLibelleTest}' (conforme demande PO)",
    (string)viewResult1.LibelleEcriture == bankLibelleTest);

var viewResult2 = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
    SELECT MV_ID, MV_Numero, MV_Piece, ReferenceCompta, MV_Libelle, LibelleEcriture 
    FROM vw_ReglementsAComptabiliser 
    WHERE MV_ID = @MvId", new { MvId = mvId2 });

Console.WriteLine($"  Vue SQL Règlement 2 : MV_Piece='{viewResult2.MV_Piece}', MV_Libelle='{viewResult2.MV_Libelle}', LibelleEcriture='{viewResult2.LibelleEcriture}'");
AssertTrue("Vue SQL réelle Règlement 2 : LibelleEcriture renvoie 'Versement' (repli actif)",
    (string)viewResult2.LibelleEcriture == "Versement");

// ------------------------------------------------------------------------------------------------
// 7. TEST RÉEL DE TRONCATURE SAGE (69 CARACTÈRES) PAR LA VUE SQL
// ------------------------------------------------------------------------------------------------
Console.WriteLine("\n--- ÉTAPE 7 : Test réel de la troncature à 69 car. par SQL Server sur libellé bancaire long ---");

string longBankLabel = "VIR SEPA RECU DE SARL SOCIETE GENERALE DISTRIBUTION DU SUD POUR FACTURE F2026-987456123 ET BORDEREAU B987";
AssertTrue($"Libellé bancaire long mesure {longBankLabel.Length} caractères (> 69)", longBankLabel.Length > 69);

// Mettre à jour MV_Libelle dans RT_MOUVEMENT avec ce libellé long
await conn.ExecuteAsync("UPDATE RT_MOUVEMENT SET MV_Libelle = @Libelle WHERE MV_ID = @MvId",
    new { Libelle = longBankLabel, MvId = mvId1 });

var viewResultLong = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
    SELECT MV_ID, MV_Piece, MV_Libelle, LibelleEcriture 
    FROM vw_ReglementsAComptabiliser 
    WHERE MV_ID = @MvId", new { MvId = mvId1 });

string libelleTronque = (string)viewResultLong.LibelleEcriture;
Console.WriteLine($"  Vue SQL LibelleEcriture tronqué : '{libelleTronque}' ({libelleTronque.Length} caractères)");

AssertTrue("SQL Server tronque LibelleEcriture à exactement 69 caractères", libelleTronque.Length == 69);
AssertTrue("Le libellé tronqué correspond au préfixe exact",
    libelleTronque == longBankLabel.Substring(0, 69));

// ------------------------------------------------------------------------------------------------
// 8. TEST CAS CHAÎNE VIDE / ESPACES RÉEL
// ------------------------------------------------------------------------------------------------
Console.WriteLine("\n--- ÉTAPE 8 : Test réel si pair.Libelle est chaîne vide ou espaces seuls ---");

// Libérer la réservation sur mvId2 de la ligne 2 pour respecter la contrainte d'unicité UX_RAPP_Ligne_MVID
await conn.ExecuteAsync("UPDATE RAPP_ReleveBancaire_Ligne SET MV_ID = NULL WHERE Id = @Id", new { Id = ligneId2 });

// Créer une 3ème ligne avec espaces seuls
int ligneId3 = await conn.ExecuteScalarAsync<int>(@"
    INSERT INTO RAPP_ReleveBancaire_Ligne 
        (ReleveBancaireEnteteId, DateOperation, DateValeur, Libelle, Code, Credit, Lettrage, MV_ID, ReservePar_UserId, DateReservation)
    OUTPUT INSERTED.Id
    VALUES 
        (@EnteteId, @DateOp, @DateVal, '   ', 'CODE_SPACES', 300.00, 'Z3', @MvId, 1, GETDATE())
", new { EnteteId = enteteId, DateOp = testDate, DateVal = testDate, MvId = mvId2 });

// Dé-pointer temporairement mvId2
await conn.ExecuteAsync("UPDATE RT_MOUVEMENT SET MV_Point = 0, MV_Libelle = 'LIBELLE_EXISTANT' WHERE MV_ID = @MvId",
    new { MvId = mvId2 });

var pairSpaces = new List<ValidationPairDto>
{
    new ValidationPairDto
    {
        ReleveLigneId = ligneId3,
        GrcReglementId = mvId2,
        Lettrage = "Z3",
        CodeExcel = "CODE_SPACES",
        Libelle = "   ", // Espaces
        DateValeur = new DateTime(2026, 9, 20)
    }
};

await releveRepo.SauvegarderValidationAsync(pairSpaces, userId: 1, isAdmin: true);

var rowSpaces = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
    SELECT MV_Libelle FROM RT_MOUVEMENT WHERE MV_ID = @MvId", new { MvId = mvId2 });

AssertTrue("Espaces seuls reçus : MV_Libelle existant ('LIBELLE_EXISTANT') n'a PAS été écrasé",
    (string)rowSpaces.MV_Libelle == "LIBELLE_EXISTANT");

// ------------------------------------------------------------------------------------------------
// 9. NETTOYAGE DES DONNÉES DE TEST
// ------------------------------------------------------------------------------------------------
Console.WriteLine("\n--- ÉTAPE 9 : Nettoyage des données de test ---");

// Supprimer les lignes et l'entête de test
await conn.ExecuteAsync("DELETE FROM RAPP_ReleveBancaire_Ligne WHERE ReleveBancaireEnteteId = @Id", new { Id = enteteId });
await conn.ExecuteAsync("DELETE FROM RAPP_ReleveBancaire_Entete WHERE Id = @Id", new { Id = enteteId });

// Rétablir les règlements cibles dans leur état d'origine
await conn.ExecuteAsync(@"
    UPDATE RT_MOUVEMENT 
    SET MV_Point = 0, MV_Piece = @Piece1, MV_Libelle = @Lib1, MV_ExtraitNum = NULL, MV_Info1 = NULL 
    WHERE MV_ID = @MvId1;
    UPDATE RT_MOUVEMENT 
    SET MV_Point = 0, MV_Piece = @Piece2, MV_Libelle = @Lib2, MV_ExtraitNum = NULL, MV_Info1 = NULL 
    WHERE MV_ID = @MvId2;
", new { MvId1 = mvId1, Piece1 = originalPiece1, Lib1 = originalLibelle1,
         MvId2 = mvId2, Piece2 = originalPiece2, Lib2 = originalLibelle2 });

Console.WriteLine("  Données de test nettoyées et règlements rétablis dans leur état d'origine.");

// ------------------------------------------------------------------------------------------------
// BILAN DU HARNAIS
// ------------------------------------------------------------------------------------------------
Console.WriteLine("\n================================================================================");
Console.WriteLine($"RÉSULTATS HARNESS TASK-082 (BASE RÉELLE) : {passedTests}/{totalTests} tests réussis.");
if (passedTests == totalTests)
{
    Console.WriteLine("🎉 TOUS LES TESTS SUR BASE DE DONNÉES RÉELLE SONT AU VERT !");
    Console.WriteLine("================================================================================");
    return 0;
}
else
{
    Console.WriteLine("❌ CERTAINS TESTS ONT ÉCHOUÉ !");
    Console.WriteLine("================================================================================");
    return 1;
}
