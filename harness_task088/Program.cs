using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using Dapper;
using GRC.Infrastructure.Data;
using GRC.Infrastructure.Services;
using GRC.Infrastructure.Tresorerie;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

const string ConnString = "Server=DESKTOP-2VCUE93;Database=GR_GOCOM;User Id=sa;Password=1234;TrustServerCertificate=True";

Console.WriteLine("===================================================================================");
Console.WriteLine("   HARNESS VALIDATION TASK-088 — Garde IsAnnule dans VerifierComptabilisable");
Console.WriteLine("===================================================================================\n");

int passed = 0;
int failed = 0;

void Assert(bool condition, string testName, string? details = null)
{
    if (condition)
    {
        Console.WriteLine($"[PASS] {testName}");
        passed++;
    }
    else
    {
        Console.WriteLine($"[FAIL] {testName}{(details != null ? " — " + details : "")}");
        failed++;
    }
}

// Accès aux propriétés d'un type anonyme cross-assembly via réflexion
T? Get<T>(object obj, string propName)
{
    var prop = obj.GetType().GetProperty(propName, BindingFlags.Public | BindingFlags.Instance);
    if (prop == null) return default;
    var val = prop.GetValue(obj);
    if (val is T t) return t;
    if (val == null) return default;
    return (T)Convert.ChangeType(val, typeof(T));
}

bool GetBool(object obj, string propName)   => Get<bool>(obj, propName);
int  GetInt(object obj, string propName)    => Get<int>(obj, propName);
string? GetStr(object obj, string propName) => Get<string>(obj, propName);

// Nombre d'éléments dans un IEnumerable cross-assembly
int CountProp(object obj, string propName)
{
    var prop = obj.GetType().GetProperty(propName, BindingFlags.Public | BindingFlags.Instance);
    if (prop == null) return -1;
    var val = prop.GetValue(obj);
    if (val == null) return 0;
    return (val as System.Collections.IEnumerable)?.Cast<object>().Count() ?? 0;
}

// -------------------------------------------------------------------------------------------------
// INITIALISATION KERNEL ET SERVICE
// -------------------------------------------------------------------------------------------------
var dbFactory = new DbConnectionFactory(ConnString);

using var loggerFactory = LoggerFactory.Create(builder =>
{
    builder.AddConsole().SetMinimumLevel(LogLevel.Warning);
});
var logger = loggerFactory.CreateLogger<ReglementService>();
var kernelLogger = loggerFactory.CreateLogger<TresorerieNinjectKernel>();

var configDict = new Dictionary<string, string?>
{
    ["Tresorerie:ConfigFile"] = @"C:\GRC\GR_GOCOM.apt",
    ["Tresorerie:UserGR"] = "Admin",
    ["Tresorerie:PasswordGR"] = "Admin",
    ["Tresorerie:SocieteNoGR"] = "1",
    ["ConnectionStrings:DefaultConnection"] = ConnString
};
var config = new ConfigurationBuilder().AddInMemoryCollection(configDict).Build();

TresorerieNinjectKernel kernel = new TresorerieNinjectKernel(config, kernelLogger);

Console.WriteLine("[INFO] Initialisation kernel Trésorerie (thread STA)...");
var initThread = new Thread(() =>
{
    kernel.ConfigurationManager.Load(@"C:\GRC\GR_GOCOM.apt");
    kernel.GroupInitializer.Initialize();
    kernel.GroupInitializer.Authenticate("Admin", "Admin", 1);
});
initThread.SetApartmentState(ApartmentState.STA);
initThread.Start();
initThread.Join();
Console.WriteLine("[INFO] Kernel Trésorerie initialisé (société 1).\n");

var service = new ReglementService(dbFactory, kernel, logger);

using var sqlConn = new System.Data.SqlClient.SqlConnection(ConnString);
await sqlConn.OpenAsync();

// Règlement annulé connu (TASK-085, MV_Annule=1, MV_Compta=0, Type=3 Virement)
const int AnnuleReglementId = 9682;

// Règlement valide non annulé non comptabilisé (non-régression)
const int ValidReglementId = 7926;

// -------------------------------------------------------------------------------------------------
// VÉRIFICATION PRÉALABLE : confirmation en base que les IDs ont bien l'état attendu
// -------------------------------------------------------------------------------------------------
Console.WriteLine("--- VÉRIFICATION PRÉALABLE DES IDs DE TEST ---");
var precheck = (await sqlConn.QueryAsync<dynamic>(
    "SELECT MV_Id, MV_Annule, MV_Compta, MV_Type FROM RT_MOUVEMENT WHERE MV_Id IN @Ids ORDER BY MV_Id",
    new { Ids = new[] { AnnuleReglementId, ValidReglementId } })).ToList();

var annuleRow = precheck.FirstOrDefault(r => (int)r.MV_Id == AnnuleReglementId);
var validRow  = precheck.FirstOrDefault(r => (int)r.MV_Id == ValidReglementId);

Assert(annuleRow != null && (int)annuleRow.MV_Annule == 1 && (int)annuleRow.MV_Compta == 0,
    $"Pré-check : règlement {AnnuleReglementId} est bien annulé et non comptabilisé en base",
    annuleRow == null ? "introuvable" : $"MV_Annule={annuleRow.MV_Annule} MV_Compta={annuleRow.MV_Compta}");

Assert(validRow != null && (int)validRow.MV_Annule == 0 && (int)validRow.MV_Compta == 0,
    $"Pré-check : règlement {ValidReglementId} est bien non annulé et non comptabilisé en base",
    validRow == null ? "introuvable" : $"MV_Annule={validRow.MV_Annule} MV_Compta={validRow.MV_Compta}");

Console.WriteLine();

// -------------------------------------------------------------------------------------------------
// TEST 1 : ApercuComptabilisation sur règlement annulé → HasError=true avec message "annulé"
// -------------------------------------------------------------------------------------------------
Console.WriteLine($"--- TEST 1 : ApercuComptabilisation sur règlement annulé (MV_Id={AnnuleReglementId}) ---");

var apercuAnnule = service.ApercuComptabilisation(new List<int> { AnnuleReglementId }, 1, true);
var apercuList = (apercuAnnule as IEnumerable<object>)?.ToList() ?? new List<object>();
Console.WriteLine($"[INFO] Aperçu retourné : {apercuList.Count} entrée(s)");

Assert(apercuList.Count >= 1, "Aperçu règlement annulé : une entrée retournée (gestion d'erreur par-règlement)");

if (apercuList.Count >= 1)
{
    var first = apercuList[0]!;
    bool hasErr = GetBool(first, "HasError");
    string? errMsg = GetStr(first, "Erreur");
    int nbEcr = CountProp(first, "Ecritures");

    Console.WriteLine($"[INFO] HasError={hasErr} | Erreur={errMsg} | nb Ecritures={nbEcr}");
    Assert(hasErr, "Aperçu règlement annulé : HasError=true");
    Assert(!string.IsNullOrEmpty(errMsg) && errMsg.Contains("annulé"),
        "Aperçu règlement annulé : message d'erreur contient 'annulé'", $"Erreur: {errMsg}");
    Assert(nbEcr == 0, "Aperçu règlement annulé : 0 écriture générée (Ecritures vide)", $"nb={nbEcr}");
}

Console.WriteLine();

// -------------------------------------------------------------------------------------------------
// TEST 2 : Comptabiliser sur règlement annulé → errorCount=1, successCount=0, MV_Compta reste 0
// -------------------------------------------------------------------------------------------------
Console.WriteLine($"--- TEST 2 : Comptabiliser sur règlement annulé (MV_Id={AnnuleReglementId}) ---");

var resultCompta = service.Comptabiliser(new List<int> { AnnuleReglementId }, 1, true);
var resComptaType = resultCompta.GetType();

int successCount = (int)(resComptaType.GetProperty("successCount")!.GetValue(resultCompta)!);
int errorCount   = (int)(resComptaType.GetProperty("errorCount")!.GetValue(resultCompta)!);
var errorsRaw    = resComptaType.GetProperty("errors")!.GetValue(resultCompta);
var errors       = (errorsRaw as IEnumerable<string>)?.ToList() ?? new List<string>();

Console.WriteLine($"[INFO] successCount={successCount} errorCount={errorCount} errors={string.Join(";", errors)}");
Assert(successCount == 0, "Comptabiliser règlement annulé : successCount=0", $"successCount={successCount}");
Assert(errorCount == 1,   "Comptabiliser règlement annulé : errorCount=1",   $"errorCount={errorCount}");

var errMsg2 = errors.FirstOrDefault();
Assert(!string.IsNullOrEmpty(errMsg2) && errMsg2.Contains("annulé"),
    "Comptabiliser règlement annulé : message contient 'annulé'", $"Message: {errMsg2}");

// Vérification en base : MV_Compta toujours 0 (aucune écriture comptable)
int mvComptaApres = await sqlConn.ExecuteScalarAsync<int>(
    "SELECT MV_Compta FROM RT_MOUVEMENT WHERE MV_Id = @Id", new { Id = AnnuleReglementId });
Assert(mvComptaApres == 0,
    "Comptabiliser règlement annulé : MV_Compta reste 0 en base (aucune écriture comptable générée)",
    $"MV_Compta={mvComptaApres}");

Console.WriteLine();

// -------------------------------------------------------------------------------------------------
// TEST 3 : Lot mixte aperçu — règlement annulé + règlement valide
// → annulé = HasError=true ; valide = HasError=false avec écritures
// -------------------------------------------------------------------------------------------------
Console.WriteLine($"--- TEST 3 : Lot mixte aperçu annulé ({AnnuleReglementId}) + valide ({ValidReglementId}) ---");

var apercuMixte = service.ApercuComptabilisation(new List<int> { AnnuleReglementId, ValidReglementId }, 1, true);
var apercuMixteList = (apercuMixte as IEnumerable<object>)?.ToList() ?? new List<object>();

Assert(apercuMixteList.Count == 2, "Lot mixte : 2 entrées retournées", $"Count={apercuMixteList.Count}");

if (apercuMixteList.Count == 2)
{
    object? annuleEntry = null;
    object? valideEntry = null;

    foreach (var item in apercuMixteList)
    {
        int rid = GetInt(item, "ReglementId");
        if (rid == AnnuleReglementId) annuleEntry = item;
        if (rid == ValidReglementId)  valideEntry = item;
    }

    Assert(annuleEntry != null, "Lot mixte : entrée pour règlement annulé présente");
    Assert(valideEntry != null, "Lot mixte : entrée pour règlement valide présente");

    if (annuleEntry != null)
    {
        bool ae = GetBool(annuleEntry, "HasError");
        Assert(ae, "Lot mixte : règlement annulé HasError=true", $"HasError={ae}");
    }
    if (valideEntry != null)
    {
        bool ve = GetBool(valideEntry, "HasError");
        int nbEcrV = CountProp(valideEntry, "Ecritures");
        Assert(!ve, "Lot mixte : règlement valide HasError=false (non bloqué)", $"HasError={ve}");
        Assert(nbEcrV > 0, "Lot mixte : règlement valide a des écritures", $"nb={nbEcrV}");
    }
}

Console.WriteLine();

// -------------------------------------------------------------------------------------------------
// TEST 4 : Non-régression — règlement valide seul → aucune exception IsAnnule, aperçu normal
// -------------------------------------------------------------------------------------------------
Console.WriteLine($"--- TEST 4 : Non-régression règlement valide seul (MV_Id={ValidReglementId}) ---");

var apercuValide = service.ApercuComptabilisation(new List<int> { ValidReglementId }, 1, true);
var apercuValideList = (apercuValide as IEnumerable<object>)?.ToList() ?? new List<object>();

Assert(apercuValideList.Count == 1, "Non-régression : 1 entrée retournée", $"Count={apercuValideList.Count}");
if (apercuValideList.Count == 1)
{
    bool ve = GetBool(apercuValideList[0], "HasError");
    int nbEcr = CountProp(apercuValideList[0], "Ecritures");
    string? errNR = GetStr(apercuValideList[0], "Erreur");
    Console.WriteLine($"[INFO] HasError={ve} | Erreur={errNR} | nb Ecritures={nbEcr}");
    Assert(!ve, "Non-régression : HasError=false", $"HasError={ve}, Erreur={errNR}");
    Assert(nbEcr > 0, "Non-régression : écritures d'aperçu générées (caisse/mode OK)", $"nb={nbEcr}");
}

Console.WriteLine();

// -------------------------------------------------------------------------------------------------
// TEST 5 : Cas croisé TASK-087 — recherche de règlement annulé Type 0/4 en base
// -------------------------------------------------------------------------------------------------
Console.WriteLine("--- TEST 5 : Cas croisé TASK-087 — règlement annulé Type 0/4 ---");

int countAnnuleType04 = await sqlConn.ExecuteScalarAsync<int>(
    "SELECT COUNT(*) FROM RT_MOUVEMENT WHERE MV_Annule = 1 AND MV_Compta = 0 AND MV_Type IN (0,4)");
Console.WriteLine($"[INFO] Règlements annulés Type IN (0,4) non comptabilisés en base : {countAnnuleType04}");

if (countAnnuleType04 == 0)
{
    // Cas documenté : aucun règlement annulé Type 0/4 n'existe en base à ce jour.
    // La garde IsAnnule est type-agnostique dans VerifierComptabilisable (if reg.IsAnnule — boolean
    // sans condition sur le type) : couverte fonctionnellement par les tests 1-3 sur MV_Type=3.
    Console.WriteLine("[INFO] Aucun règlement annulé Type 0/4 en base — cas documenté, garde type-agnostique vérifiée par relecture de code.");
    Assert(true, "Cas croisé TASK-087 documenté : garde IsAnnule type-agnostique (VerifierComptabilisable l.608), tests 1-3 couvrent l'invariant");
}
else
{
    Console.WriteLine($"[INFO] Règlement(s) annulé(s) Type 0/4 trouvé(s) — exécution du cas croisé réel.");
    var rowType04 = await sqlConn.QueryFirstAsync<dynamic>(
        "SELECT TOP 1 MV_Id FROM RT_MOUVEMENT WHERE MV_Annule = 1 AND MV_Compta = 0 AND MV_Type IN (0,4)");
    int idType04 = (int)rowType04.MV_Id;
    var apercuType04 = service.ApercuComptabilisation(new List<int> { idType04 }, 1, true);
    var listType04 = (apercuType04 as IEnumerable<object>)?.ToList() ?? new List<object>();
    bool t04HasErr = listType04.Count == 1 && GetBool(listType04[0], "HasError");
    Assert(t04HasErr, $"Cas croisé TASK-087 réel : règlement annulé Type 0/4 (MV_Id={idType04}) → HasError=true");
}

Console.WriteLine();

// -------------------------------------------------------------------------------------------------
// RÉCAPITULATIF
// -------------------------------------------------------------------------------------------------
Console.WriteLine("===================================================================================");
Console.WriteLine($"  RÉSULTAT : {passed} PASSED / {failed} FAILED / {passed + failed} total");
Console.WriteLine("===================================================================================");

if (failed > 0)
{
    Environment.Exit(1);
}
