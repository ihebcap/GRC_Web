using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Dapper;
using GRC.Infrastructure.Data;
using GRC.Infrastructure.Services;
using GRC.Infrastructure.Tresorerie;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

const string ConnString = "Server=DESKTOP-2VCUE93;Database=GR_GOCOM;User Id=sa;Password=1234;TrustServerCertificate=True";

Console.WriteLine("================================================================================");
Console.WriteLine("   HARNESS VALIDATION TASK-086 — BASE DE DONNÉES RÉELLE SQL SERVER & DLL GRC");
Console.WriteLine("================================================================================\n");

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
        Console.WriteLine($"[FAIL] {testName} {(details != null ? "- " + details : "")}");
        failed++;
    }
}

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
Console.WriteLine("[INFO] Kernel Trésorerie initialisé et authentifié (société 1).\n");

var service = new ReglementService(dbFactory, kernel, logger);

using var sqlConn = new System.Data.SqlClient.SqlConnection(ConnString);
await sqlConn.OpenAsync();

const int EligibleReglementId = 48419;

// ---------------------------------------------------------------------------------------------
// TEST 1 : Garde commune — Règlement déjà comptabilisé
// ---------------------------------------------------------------------------------------------
Console.WriteLine("--- TEST 1 : Garde commune sur règlement comptabilisé (MV_Id=3) ---");
try
{
    service.ModifierReglement(3, new ReglementModificationDto { Montant = 999m }, 1, true);
    Assert(false, "Règlement comptabilisé doit être rejeté", "Aucune exception levée");
}
catch (InvalidOperationException ex)
{
    bool ok = ex.Message.Contains("comptabilisé");
    Assert(ok, "Règlement comptabilisé rejeté avec message explicite", ex.Message);
}
catch (Exception ex)
{
    Assert(false, "Exception attendue: InvalidOperationException", ex.GetType().Name + ": " + ex.Message);
}

// ---------------------------------------------------------------------------------------------
// TEST 2 : Garde commune — Règlement déjà affecté
// ---------------------------------------------------------------------------------------------
Console.WriteLine("\n--- TEST 2 : Garde commune sur règlement affecté (MV_Id=353) ---");
try
{
    service.ModifierReglement(353, new ReglementModificationDto { Montant = 999m }, 1, true);
    Assert(false, "Règlement affecté doit être rejeté", "Aucune exception levée");
}
catch (InvalidOperationException ex)
{
    bool ok = ex.Message.Contains("affecté");
    Assert(ok, "Règlement affecté rejeté avec message explicite", ex.Message);
}
catch (Exception ex)
{
    Assert(false, "Exception attendue: InvalidOperationException", ex.GetType().Name + ": " + ex.Message);
}

// ---------------------------------------------------------------------------------------------
// TEST 3 : Garde commune — Règlement déjà annulé
// ---------------------------------------------------------------------------------------------
Console.WriteLine("\n--- TEST 3 : Garde commune sur règlement annulé (MV_Id=9682) ---");
try
{
    service.ModifierReglement(9682, new ReglementModificationDto { Montant = 999m }, 1, true);
    Assert(false, "Règlement annulé doit être rejeté", "Aucune exception levée");
}
catch (InvalidOperationException ex)
{
    bool ok = ex.Message.Contains("annulé");
    Assert(ok, "Règlement annulé rejeté avec message explicite", ex.Message);
}
catch (Exception ex)
{
    Assert(false, "Exception attendue: InvalidOperationException", ex.GetType().Name + ": " + ex.Message);
}

// ---------------------------------------------------------------------------------------------
// TEST 4 : Modification sans changement — aucune écriture ni historique
// ---------------------------------------------------------------------------------------------
Console.WriteLine($"\n--- TEST 4 : Soumission sans modification sur règlement éligible (MV_Id={EligibleReglementId}) ---");
var regEligible = await sqlConn.QueryFirstOrDefaultAsync<dynamic>(
    "SELECT MV_Id, MV_Date, MV_Montant, MV_Reference, BN_Id, CT_No, CT_Code, CT_Intitule FROM RT_MOUVEMENT WHERE MV_Id = @Id",
    new { Id = EligibleReglementId });

int countHistoAvant = await sqlConn.ExecuteScalarAsync<int>(
    "SELECT COUNT(*) FROM dbo.GRC_ReglementModificationHistorique WHERE ReglementNo = @Id",
    new { Id = EligibleReglementId });

var resNoChange = service.ModifierReglement(EligibleReglementId, new ReglementModificationDto
{
    Date = (DateTime)regEligible.MV_Date,
    Montant = (decimal)regEligible.MV_Montant,
    BanqueNo = (int?)regEligible.BN_Id,
    Reference = (string)regEligible.MV_Reference,
    ClientNo = (int?)regEligible.CT_No,
    ClientCode = (string)regEligible.CT_Code,
    ClientIntitule = (string)regEligible.CT_Intitule
}, 1, true);

int countHistoApres = await sqlConn.ExecuteScalarAsync<int>(
    "SELECT COUNT(*) FROM dbo.GRC_ReglementModificationHistorique WHERE ReglementNo = @Id",
    new { Id = EligibleReglementId });

Assert(resNoChange.Modified == false, "Détection 'Aucune modification' retourne modified=false");
Assert(countHistoAvant == countHistoApres, "Aucune ligne d'historique créée lors d'une soumission sans changement");

// ---------------------------------------------------------------------------------------------
// TEST 5 : Modification Date, Montant, Banque, Référence via DLL ReglementUpdate
// ---------------------------------------------------------------------------------------------
Console.WriteLine($"\n--- TEST 5 : Modification DLL Date/Montant/Banque/Référence (MV_Id={EligibleReglementId}) ---");
DateTime targetDate = new DateTime(2026, 7, 15);
decimal targetMontant = 850.00m;
int targetBanque = 2;
string targetRef = "REF-TEST-086";

var resDll = service.ModifierReglement(EligibleReglementId, new ReglementModificationDto
{
    Date = targetDate,
    Montant = targetMontant,
    BanqueNo = targetBanque,
    Reference = targetRef
}, 1, true, "AdminTest");

Assert(resDll.Success == true && resDll.Modified == true, "Modification DLL retourne success=true");

var regApresDll = await sqlConn.QueryFirstOrDefaultAsync<dynamic>(
    "SELECT MV_Date, MV_Montant, MV_Solde, MV_SoldeReplace, MV_MtDevise, MV_SoldeDevise, MV_Etat, BN_Id, MV_Reference FROM RT_MOUVEMENT WHERE MV_Id = @Id",
    new { Id = EligibleReglementId });

Assert(((DateTime)regApresDll.MV_Date).Date == targetDate.Date, "MV_Date mis à jour en base", regApresDll.MV_Date.ToString());
Assert((decimal)regApresDll.MV_Montant == targetMontant, "MV_Montant mis à jour en base", regApresDll.MV_Montant.ToString());
Assert((decimal)regApresDll.MV_Solde == targetMontant, "MV_Solde synchronisé", regApresDll.MV_Solde.ToString());
Assert((decimal)regApresDll.MV_SoldeReplace == targetMontant, "MV_SoldeReplace synchronisé", regApresDll.MV_SoldeReplace.ToString());
Assert((decimal)regApresDll.MV_MtDevise == targetMontant, "MV_MtDevise synchronisé", regApresDll.MV_MtDevise.ToString());
Assert((decimal)regApresDll.MV_SoldeDevise == targetMontant, "MV_SoldeDevise synchronisé", regApresDll.MV_SoldeDevise.ToString());
Assert((int)regApresDll.MV_Etat == 0, "MV_Etat conforme à 0 (Non affecté)", regApresDll.MV_Etat.ToString());
Assert((int)regApresDll.BN_Id == targetBanque, "BN_Id mis à jour en base", regApresDll.BN_Id.ToString());
Assert(((string)regApresDll.MV_Reference).Trim() == targetRef, "MV_Reference mis à jour en base", regApresDll.MV_Reference.ToString());

// Vérification historique
var lastHisto = await sqlConn.QueryFirstOrDefaultAsync<dynamic>(
    "SELECT TOP 1 * FROM dbo.GRC_ReglementModificationHistorique WHERE ReglementNo = @Id ORDER BY Id DESC",
    new { Id = EligibleReglementId });
Assert(lastHisto != null, "Ligne d'historique créée");
Assert(((string)lastHisto.ChampsModifies).Contains("Date") && ((string)lastHisto.ChampsModifies).Contains("Montant") && ((string)lastHisto.ChampsModifies).Contains("Banque") && ((string)lastHisto.ChampsModifies).Contains("Référence"),
    "ChampsModifies contient Date, Montant, Banque, Référence", (string)lastHisto?.ChampsModifies);
Assert((decimal)lastHisto.AncienMontant == (decimal)regEligible.MV_Montant && (decimal)lastHisto.NouveauMontant == targetMontant,
    "AncienMontant / NouveauMontant corrects dans l'historique");


// ---------------------------------------------------------------------------------------------
// TEST 6 : Modification du Client via dérogation réflexion PO
// ---------------------------------------------------------------------------------------------
Console.WriteLine($"\n--- TEST 6 : Modification Client via dérogation réflexion PO (MV_Id={EligibleReglementId}) ---");
int targetClientNo = 5667;
string targetClientCode = "PAYX02";
string targetClientIntitule = "PAYX AI _NADOR BENTACHFINE INWI";

var resClient = service.ModifierReglement(EligibleReglementId, new ReglementModificationDto
{
    ClientNo = targetClientNo,
    ClientCode = targetClientCode,
    ClientIntitule = targetClientIntitule
}, 1, true, "AdminTest");

Assert(resClient.Success == true && resClient.Modified == true, "Modification Client retourne success=true");

var regApresClient = await sqlConn.QueryFirstOrDefaultAsync<dynamic>(
    "SELECT CT_No, CT_Code, CT_Intitule FROM RT_MOUVEMENT WHERE MV_Id = @Id",
    new { Id = EligibleReglementId });
Assert((int)regApresClient.CT_No == targetClientNo, "CT_No mis à jour en base via réflexion", regApresClient.CT_No.ToString());
Assert(((string)regApresClient.CT_Code).Trim() == targetClientCode, "CT_Code mis à jour en base", regApresClient.CT_Code.ToString());
Assert(((string)regApresClient.CT_Intitule).Trim() == targetClientIntitule, "CT_Intitule mis à jour en base", regApresClient.CT_Intitule.ToString());

var lastHistoClient = await sqlConn.QueryFirstOrDefaultAsync<dynamic>(
    "SELECT TOP 1 * FROM dbo.GRC_ReglementModificationHistorique WHERE ReglementNo = @Id ORDER BY Id DESC",
    new { Id = EligibleReglementId });
Assert((int)lastHistoClient.NouveauClientNo == targetClientNo, "NouveauClientNo dans historique correct", lastHistoClient.NouveauClientNo.ToString());

// ---------------------------------------------------------------------------------------------
// TEST 7 : Modification simultanée (Client + Montant)
// ---------------------------------------------------------------------------------------------
Console.WriteLine($"\n--- TEST 7 : Modification simultanée Client + Montant en un seul appel (MV_Id={EligibleReglementId}) ---");
decimal targetMontantSimul = 900.00m;
int targetClientNoSimul = 5500;
string targetClientCodeSimul = "IMONEY06";
string targetClientIntituleSimul = "IMONEY AI_MEKNES KESSARIYA INWI";

var resSimul = service.ModifierReglement(EligibleReglementId, new ReglementModificationDto
{
    Montant = targetMontantSimul,
    ClientNo = targetClientNoSimul,
    ClientCode = targetClientCodeSimul,
    ClientIntitule = targetClientIntituleSimul
}, 1, true, "AdminTest");

Assert(resSimul.Success == true && resSimul.Modified == true, "Modification simultanée retourne success=true");

var regApresSimul = await sqlConn.QueryFirstOrDefaultAsync<dynamic>(
    "SELECT MV_Montant, CT_No, CT_Code FROM RT_MOUVEMENT WHERE MV_Id = @Id",
    new { Id = EligibleReglementId });
Assert((decimal)regApresSimul.MV_Montant == targetMontantSimul, "Montant mis à jour après appel simultané", regApresSimul.MV_Montant.ToString());
Assert((int)regApresSimul.CT_No == targetClientNoSimul, "Client mis à jour après appel simultané", regApresSimul.CT_No.ToString());

var lastHistoSimul = await sqlConn.QueryFirstOrDefaultAsync<dynamic>(
    "SELECT TOP 1 * FROM dbo.GRC_ReglementModificationHistorique WHERE ReglementNo = @Id ORDER BY Id DESC",
    new { Id = EligibleReglementId });
Assert(((string)lastHistoSimul.ChampsModifies).Contains("Montant") && ((string)lastHistoSimul.ChampsModifies).Contains("Client"),
    "Historique combiné contient 'Montant, Client' sur une seule ligne", (string)lastHistoSimul.ChampsModifies);

// ---------------------------------------------------------------------------------------------
// TEST 8 : Consultation de l'historique
// ---------------------------------------------------------------------------------------------
Console.WriteLine($"\n--- TEST 8 : Consultation de l'historique (GetHistoriqueModifications) ---");
var historiqueList = service.GetHistoriqueModifications(EligibleReglementId, 1, true);
Assert(historiqueList != null && historiqueList.Count >= 3, "GetHistoriqueModifications renvoie la liste complète des modifications", $"Count={historiqueList?.Count}");
Assert(historiqueList?[0].UserName != null, "UserName résolu et présent", historiqueList?[0].UserName);
Assert(historiqueList?[0].DateModification >= historiqueList?[1].DateModification, "Historique trié par date décroissante");

// ---------------------------------------------------------------------------------------------
// TEST 9 : Remise en état des données initiales (Teardown propre)
// ---------------------------------------------------------------------------------------------
Console.WriteLine($"\n--- TEST 9 : Remise en état des valeurs initiales pour MV_Id={EligibleReglementId} ---");
service.ModifierReglement(EligibleReglementId, new ReglementModificationDto
{
    Date = (DateTime)regEligible.MV_Date,
    Montant = (decimal)regEligible.MV_Montant,
    BanqueNo = (int?)regEligible.BN_Id,
    Reference = (string)regEligible.MV_Reference,
    ClientNo = (int?)regEligible.CT_No,
    ClientCode = (string)regEligible.CT_Code,
    ClientIntitule = (string)regEligible.CT_Intitule
}, 1, true, "Teardown");

var regRestored = await sqlConn.QueryFirstOrDefaultAsync<dynamic>(
    "SELECT MV_Date, MV_Montant, BN_Id, MV_Reference, CT_No, CT_Code FROM RT_MOUVEMENT WHERE MV_Id = @Id",
    new { Id = EligibleReglementId });
Assert((decimal)regRestored.MV_Montant == (decimal)regEligible.MV_Montant, "Montant initial restauré", regRestored.MV_Montant.ToString());
Assert((int)regRestored.CT_No == (int)regEligible.CT_No, "Client initial restauré", regRestored.CT_No.ToString());
Assert((int)regRestored.BN_Id == (int)regEligible.BN_Id, "Banque initiale restaurée", regRestored.BN_Id.ToString());

Console.WriteLine("\n================================================================================");
Console.WriteLine($"   RÉSULTAT HARNESS TASK-086 : {passed} PASSED / {failed} FAILED");
Console.WriteLine("================================================================================");

if (failed > 0) Environment.Exit(1);
