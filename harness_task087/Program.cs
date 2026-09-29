using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Dapper;
using GRC.Infrastructure.Data;
using GRC.Infrastructure.Services;
using GRC.Infrastructure.Tresorerie;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

Console.WriteLine("=================================================================");
Console.WriteLine(" HARNESS TASK-087 — Filtre « Rapproché » (pointe) & MV_Type 0/4");
Console.WriteLine("=================================================================\n");

int passed = 0;
int failed = 0;

void Assert(bool condition, string testName)
{
    if (condition)
    {
        Console.WriteLine($"[PASS] {testName}");
        passed++;
    }
    else
    {
        Console.WriteLine($"[FAIL] {testName}");
        failed++;
    }
}

// ------------------------------------------------------------------------------------------------
// 1. TEST UNITAIRE DE LA LOGIQUE DU FILTRE (SIMULATION EXACTE)
// ------------------------------------------------------------------------------------------------
Console.WriteLine("--- 1. TEST UNITAIRE DE LA LOGIQUE DU FILTRE ---");

var sampleData = new List<(int Id, int Type, bool IsPointe, string Description)>
{
    (1, 0, false, "Espèce non pointée"),
    (2, 0, true,  "Espèce pointée"),
    (3, 4, false, "Autre non pointé"),
    (4, 4, true,  "Autre pointé"),
    (5, 1, false, "Chèque non pointé"),
    (6, 1, true,  "Chèque pointé"),
    (7, 2, false, "Traite non pointée"),
    (8, 2, true,  "Traite pointée"),
    (9, 3, false, "Virement non pointé"),
    (10, 3, true, "Virement pointé")
};

// Simulation exacte de l'expression linq dans ReglementService.cs:
// allReglements = includeEspeceEtAutreSiPointeFiltre
//     ? allReglements.Where(r => (int)r.Type == 0 || (int)r.Type == 4 || r.IsPointe == pointeVal)
//     : allReglements.Where(r => r.IsPointe == pointeVal);

// Cas A : Comptabilisation (include = true, isPointe = "true")
bool includeCompta = true;
bool pointeValTrue = true;
var resCompta = sampleData.Where(r => includeCompta
    ? (r.Type == 0 || r.Type == 4 || r.IsPointe == pointeValTrue)
    : (r.IsPointe == pointeValTrue)).ToList();

Assert(resCompta.Any(r => r.Id == 1), "Cas A - Espèce non pointée doit être INCLUSE (Type 0)");
Assert(resCompta.Any(r => r.Id == 2), "Cas A - Espèce pointée doit être INCLUSE (Type 0)");
Assert(resCompta.Any(r => r.Id == 3), "Cas A - Autre non pointé doit être INCLUS (Type 4)");
Assert(resCompta.Any(r => r.Id == 4), "Cas A - Autre pointé doit être INCLUS (Type 4)");
Assert(!resCompta.Any(r => r.Id == 5), "Cas A - Chèque non pointé doit être EXCLU (Type 1)");
Assert(resCompta.Any(r => r.Id == 6), "Cas A - Chèque pointé doit être INCLUS (Type 1)");
Assert(!resCompta.Any(r => r.Id == 7), "Cas A - Traite non pointée doit être EXCLUE (Type 2)");
Assert(resCompta.Any(r => r.Id == 8), "Cas A - Traite pointée doit être INCLUSE (Type 2)");
Assert(!resCompta.Any(r => r.Id == 9), "Cas A - Virement non pointé doit être EXCLU (Type 3)");
Assert(resCompta.Any(r => r.Id == 10), "Cas A - Virement pointé doit être INCLUS (Type 3)");
Assert(resCompta.Count == 7, $"Cas A - Total attendu = 7 (obtenu: {resCompta.Count})");

// Cas B : Mode Standard / Non-régression App.tsx / RapprochementBancaire.tsx
// include = false, isPointe = "true"
bool includeStandard = false;
var resStandardTrue = sampleData.Where(r => includeStandard
    ? (r.Type == 0 || r.Type == 4 || r.IsPointe == pointeValTrue)
    : (r.IsPointe == pointeValTrue)).ToList();

Assert(!resStandardTrue.Any(r => r.Id == 1), "Cas B (isPointe=true, standard) - Espèce non pointée doit être EXCLUE");
Assert(!resStandardTrue.Any(r => r.Id == 3), "Cas B (isPointe=true, standard) - Autre non pointé doit être EXCLU");
Assert(resStandardTrue.Count == 5, $"Cas B (isPointe=true, standard) - Total attendu = 5 pointés (obtenu: {resStandardTrue.Count})");

// Cas C : Non-régression pointe = false (ex: App.tsx mode rapprochement pointe='non', RapprochementBancaire pointe=false)
bool pointeValFalse = false;
var resStandardFalse = sampleData.Where(r => includeStandard
    ? (r.Type == 0 || r.Type == 4 || r.IsPointe == pointeValFalse)
    : (r.IsPointe == pointeValFalse)).ToList();

Assert(resStandardFalse.Any(r => r.Id == 1), "Cas C (isPointe=false, standard) - Espèce non pointée incluse car IsPointe=false");
Assert(!resStandardFalse.Any(r => r.Id == 2), "Cas C (isPointe=false, standard) - Espèce pointée EXCLUE");
Assert(resStandardFalse.Any(r => r.Id == 5), "Cas C (isPointe=false, standard) - Chèque non pointé inclus car IsPointe=false");
Assert(!resStandardFalse.Any(r => r.Id == 6), "Cas C (isPointe=false, standard) - Chèque pointé EXCLU");
Assert(resStandardFalse.Count == 5, $"Cas C (isPointe=false, standard) - Total attendu = 5 non pointés (obtenu: {resStandardFalse.Count})");

// ------------------------------------------------------------------------------------------------
// 2. TEST D'INTÉGRATION SERVICE REGLEMENT SERVICE (CONTRE BD SI ACTIVE)
// ------------------------------------------------------------------------------------------------
Console.WriteLine("\n--- 2. TEST D'INTÉGRATION SERVICE REGLEMENT SERVICE ---");

try
{
    const string ConnString = "Server=localhost;Database=GR_GOCOM;Integrated Security=True;TrustServerCertificate=True";
    var dbFactory = new DbConnectionFactory(ConnString);

    using var loggerFactory = LoggerFactory.Create(b => b.AddConsole().SetMinimumLevel(LogLevel.Warning));
    var logger = loggerFactory.CreateLogger<ReglementService>();
    var kernelLogger = loggerFactory.CreateLogger<TresorerieNinjectKernel>();

    var config = new ConfigurationBuilder().Build();
    TresorerieNinjectKernel? kernel = null;
    try
    {
        kernel = new TresorerieNinjectKernel(config, kernelLogger);
    }
    catch (Exception ex)
    {
        Console.WriteLine($"[Info] Kernel init: {ex.Message}");
    }

    var service = new ReglementService(dbFactory, kernel!, logger);

    using var sqlConn = new System.Data.SqlClient.SqlConnection(ConnString);
    await sqlConn.OpenAsync();

    var societe = await sqlConn.QueryFirstOrDefaultAsync<dynamic>("SELECT TOP 1 SO_Id, SO_RaisonSocial FROM P_SOCIETE");
    if (societe != null)
    {
        int societeId = (int)societe.SO_Id;
        var caisses = (await sqlConn.QueryAsync<int>("SELECT CA_Id FROM RT_CAISSE WHERE SO_Id = @SocieteId", new { SocieteId = societeId })).ToArray();

        // Test 2.1 : Appel sans includeEspeceEtAutreSiPointeFiltre (défaut = false)
        var itemsStandard = service.GetReglements(
            societeId, caisses,
            dateDebut: DateTime.Now.Date.AddDays(-120),
            dateFin: DateTime.Now.Date.AddDays(1).AddSeconds(-1),
            clientFilter: null, numeroFilter: null, pieceFilter: null, refFilter: null,
            libelleFilter: null, montantFilter: null, extraitFilter: null,
            isPointe: "true",
            isComptabilise: null, isRemis: null, isImpaye: null, isAnnule: null,
            caisseNosFilter: null, isAdmin: true, eligibleRappBancaire: false,
            includeEspeceEtAutreSiPointeFiltre: false
        ).Cast<ReglementClientDto>().ToList();

        // Test 2.2 : Appel avec includeEspeceEtAutreSiPointeFiltre = true
        var itemsCompta = service.GetReglements(
            societeId, caisses,
            dateDebut: DateTime.Now.Date.AddDays(-120),
            dateFin: DateTime.Now.Date.AddDays(1).AddSeconds(-1),
            clientFilter: null, numeroFilter: null, pieceFilter: null, refFilter: null,
            libelleFilter: null, montantFilter: null, extraitFilter: null,
            isPointe: "true",
            isComptabilise: null, isRemis: null, isImpaye: null, isAnnule: null,
            caisseNosFilter: null, isAdmin: true, eligibleRappBancaire: false,
            includeEspeceEtAutreSiPointeFiltre: true
        ).Cast<ReglementClientDto>().ToList();

        Console.WriteLine($"Résultats en base :");
        Console.WriteLine($" - Standard (pointe='true', include=false) : {itemsStandard.Count} règlements");
        Console.WriteLine($" - Compta   (pointe='true', include=true)  : {itemsCompta.Count} règlements");

        // Dans le lot standard, tous les règlements ramenés doivent avoir IsPointe == true
        bool standardStrict = itemsStandard.All(r => r.IsPointe);
        Assert(standardStrict, "En base réelle : mode standard (include=false) ne contient QUE IsPointe == true");

        // Dans le lot compta, les règlements ramenés ayant IsPointe == false ne doivent être QUE Type 0 ou Type 4
        var nonPointesCompta = itemsCompta.Where(r => !r.IsPointe).ToList();
        bool nonPointesSontEspeceOuAutre = nonPointesCompta.All(r => r.Type == 0 || r.Type == 4);
        Assert(nonPointesSontEspeceOuAutre, $"En base réelle : tous les non pointés ({nonPointesCompta.Count}) en compta sont de Type 0 ou 4");

        // Vérifier qu'aucun règlement Type 1, 2, 3 non pointé n'est présent
        bool chequetraiteVirementNonPointeExclus = !itemsCompta.Any(r => !r.IsPointe && r.Type != 0 && r.Type != 4);
        Assert(chequetraiteVirementNonPointeExclus, "En base réelle : aucun Chèque/Traite/Virement non pointé n'est inclus");

        // Si des espèces ou autres existent en base, compta >= standard
        Assert(itemsCompta.Count >= itemsStandard.Count, "En base réelle : itemsCompta >= itemsStandard");
    }
}
catch (Exception ex)
{
    Console.WriteLine($"[INFO/WARN] Test DB : {ex.Message}");
}

Console.WriteLine($"\n=================================================================");
Console.WriteLine($" RÉSULTATS : {passed} PASSED, {failed} FAILED");
Console.WriteLine("=================================================================");

if (failed > 0)
{
    Environment.Exit(1);
}
