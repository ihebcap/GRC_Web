using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Dapper;
using GRC.Infrastructure.Data;
using GRC.Infrastructure.Repositories;
using GRC.Infrastructure.Services;
using GRC.Infrastructure.Tresorerie;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

const string ConnString = "Server=DESKTOP-2VCUE93;Database=GR_GOCOM;User Id=sa;Password=1234;TrustServerCertificate=True";

Console.WriteLine("================================================================================");
Console.WriteLine("   HARNESS VALIDATION TASK-090 — CORRECTION MONTANT + RAPPROCHEMENT AUTOMATIQUE");
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
var repoLogger = loggerFactory.CreateLogger<ReleveBancaireRepository>();
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

var reglementService = new ReglementService(dbFactory, kernel, logger);
var releveRepo = new ReleveBancaireRepository(dbFactory, kernel, repoLogger);

using var sqlConn = new System.Data.SqlClient.SqlConnection(ConnString);
await sqlConn.OpenAsync();

const int EligibleReglementId = 48419;

// Capture des données initiales de 48419
var rowInitial = await sqlConn.QuerySingleAsync<dynamic>(@"
    SELECT MV_Date, MV_Montant, MV_Solde, MV_SoldeReplace, MV_MtDevise, MV_SoldeDevise,
           BN_Id, MV_Reference, CT_No, CT_Code, CT_Intitule, MV_Etat
    FROM RT_MOUVEMENT
    WHERE MV_Id = @Id", new { Id = EligibleReglementId });

decimal montantInitial = (decimal)rowInitial.MV_Montant;
string refInitiale = (string)(rowInitial.MV_Reference ?? "REF_EXISTANTE_INIT");

// Assurer qu'une référence existe pour vérifier qu'elle n'est pas écrasée
if (string.IsNullOrEmpty(rowInitial.MV_Reference))
{
    await sqlConn.ExecuteAsync("UPDATE RT_MOUVEMENT SET MV_Reference = @Ref WHERE MV_Id = @Id",
        new { Ref = "REF_TEST_090", Id = EligibleReglementId });
    refInitiale = "REF_TEST_090";
}

Console.WriteLine($"[INFO] Règlement {EligibleReglementId} prêt : Montant={montantInitial}, Référence='{refInitiale}'\n");

// ---------------------------------------------------------------------------------------------
// TEST 1 : Modification avec SEUL le montant dans le DTO (omission complète des autres clés)
// ---------------------------------------------------------------------------------------------
Console.WriteLine("--- TEST 1 : Payload avec 'Montant' uniquement (autres champs null) ---");
decimal testMontant = montantInitial == 1750.50m ? 1850.75m : 1750.50m;
var dtoSeulMontant = new ReglementModificationDto
{
    Montant = testMontant
    // Date, BanqueNo, Reference, ClientNo, etc. sont TOUS null
};

var modifResult = reglementService.ModifierReglement(EligibleReglementId, dtoSeulMontant, 1, true, "Admin");
Assert(modifResult.Success, "Modification avec payload 'Montant' seul réussie");
Assert(modifResult.Modified, "Modification détectée comme effective");
Assert(modifResult.ChampsModifies.Count == 1 && modifResult.ChampsModifies[0] == "Montant",
    "ChampsModifies contient strictement 'Montant'",
    $"reçu: {string.Join(",", modifResult.ChampsModifies)}");

// Vérification en base SQL Server
var rowApres = await sqlConn.QuerySingleAsync<dynamic>(@"
    SELECT MV_Date, MV_Montant, MV_Solde, MV_SoldeReplace, MV_MtDevise, MV_SoldeDevise,
           BN_Id, MV_Reference, CT_No, CT_Code, CT_Intitule, MV_Etat
    FROM RT_MOUVEMENT
    WHERE MV_Id = @Id", new { Id = EligibleReglementId });

Assert((decimal)rowApres.MV_Montant == testMontant, $"MV_Montant mis à jour ({testMontant})");
Assert((decimal)rowApres.MV_Solde == testMontant, "MV_Solde synchronisé");
Assert((string)rowApres.MV_Reference == refInitiale,
    "MV_Reference STRICTEMENT INCHANGÉE (non écrasée par une chaîne vide ou null)",
    $"actuel: '{rowApres.MV_Reference}', attendu: '{refInitiale}'");
Assert((DateTime)rowApres.MV_Date == (DateTime)rowInitial.MV_Date, "MV_Date inchangée");
Assert((int)rowApres.BN_Id == (int)rowInitial.BN_Id, "BN_Id inchangé");
Assert((int)rowApres.CT_No == (int)rowInitial.CT_No, "CT_No inchangé");

// Vérifier l'historique
var histo = await sqlConn.QueryFirstOrDefaultAsync<dynamic>(@"
    SELECT TOP 1 ChampsModifies, AncienMontant, NouveauMontant, AncienneReference, NouvelleReference
    FROM dbo.GRC_ReglementModificationHistorique
    WHERE ReglementNo = @Id
    ORDER BY Id DESC", new { Id = EligibleReglementId });

Assert(histo != null, "Ligne d'historique créée");
Assert((string)histo?.ChampsModifies == "Montant", "Historique enregistre uniquement 'Montant'");
Assert((decimal)histo?.AncienMontant == montantInitial, "AncienMontant correct dans l'historique");
Assert((decimal)histo?.NouveauMontant == testMontant, "NouveauMontant correct dans l'historique");
Assert(histo?.AncienneReference == null && histo?.NouvelleReference == null, "Historique Référence non touché");

// ---------------------------------------------------------------------------------------------
// TEST 2 : Enchaînement avec la réservation / le lettrage (executeManualLettrage)
// ---------------------------------------------------------------------------------------------
Console.WriteLine("\n--- TEST 2 : Enchaînement réservation / rapprochement ---");
// Trouver une ligne de relevé libre ou créer/adapter une ligne de test
var ligneReleve = await sqlConn.QueryFirstOrDefaultAsync<dynamic>(@"
    SELECT TOP 1 Id, Credit, Lettrage, ReservePar_UserId
    FROM RAPP_ReleveBancaire_Ligne
    WHERE (Lettrage IS NULL OR Lettrage = '') AND (ReservePar_UserId IS NULL OR ReservePar_UserId = 0)
    ORDER BY Id DESC");

if (ligneReleve != null)
{
    int ligneId = (int)ligneReleve.Id;
    Console.WriteLine($"[INFO] Ligne de relevé libre trouvée : Id={ligneId}");

    var reserveResult = await releveRepo.ReserverLigneAsync(ligneId, EligibleReglementId, 1, true);
    Assert(reserveResult != null, "ReserverLigneAsync réussit après correction du montant");
    Assert(!string.IsNullOrEmpty(reserveResult?.Lettrage), $"Lettre attribuée par le serveur: {reserveResult?.Lettrage}");

    // Vérification en base sur RAPP_ReleveBancaire_Ligne
    var ligneApres = await sqlConn.QuerySingleAsync<dynamic>(@"
        SELECT MV_ID, Lettrage, ReservePar_UserId
        FROM RAPP_ReleveBancaire_Ligne
        WHERE Id = @Id", new { Id = ligneId });

    Assert((int)ligneApres.MV_ID == EligibleReglementId, "Ligne de relevé liée au règlement");
    Assert((int)ligneApres.ReservePar_UserId == 1, "ReservePar_UserId mis à jour");
    Assert((string)ligneApres.Lettrage == reserveResult?.Lettrage, "Lettrage enregistré en base");

    // Libérer la réservation pour le nettoyage
    await sqlConn.ExecuteAsync(@"
        UPDATE RAPP_ReleveBancaire_Ligne
        SET MV_ID = NULL, Lettrage = NULL, ReservePar_UserId = NULL, DateReservation = NULL
        WHERE Id = @Id", new { Id = ligneId });
    Console.WriteLine("[INFO] Nettoyage réservation relevé OK.");
}
else
{
    Console.WriteLine("[WARN] Aucune ligne de relevé libre pour le test de réservation direct.");
}

// ---------------------------------------------------------------------------------------------
// TEST 3 : Échec de mise à jour (règlement comptabilisé / affecté / annulé)
// ---------------------------------------------------------------------------------------------
Console.WriteLine("\n--- TEST 3 : Échec de la modification -> pas de rapprochement ---");
bool comptabiliseRejete = false;
try
{
    reglementService.ModifierReglement(3, new ReglementModificationDto { Montant = 999m }, 1, true, "Admin");
}
catch (InvalidOperationException ex)
{
    comptabiliseRejete = true;
    Console.WriteLine($"[INFO] Message métier reçu: {ex.Message}");
    Assert(ex.Message.Contains("comptabilisé"), "Message métier explicite sur comptabilisé");
}
Assert(comptabiliseRejete, "Règlement comptabilisé rejeté avant tout rapprochement");

bool affecteRejete = false;
try
{
    reglementService.ModifierReglement(353, new ReglementModificationDto { Montant = 999m }, 1, true, "Admin");
}
catch (InvalidOperationException ex)
{
    affecteRejete = true;
    Console.WriteLine($"[INFO] Message métier reçu: {ex.Message}");
    Assert(ex.Message.Contains("affecté"), "Message métier explicite sur affecté");
}
Assert(affecteRejete, "Règlement affecté rejeté avant tout rapprochement");

// ---------------------------------------------------------------------------------------------
// NETTOYAGE : Remise en état de MV_Id 48419
// ---------------------------------------------------------------------------------------------
Console.WriteLine("\n--- NETTOYAGE : Restauration des valeurs initiales ---");
reglementService.ModifierReglement(EligibleReglementId, new ReglementModificationDto { Montant = montantInitial }, 1, true, "Admin");
var rowFinal = await sqlConn.QuerySingleAsync<dynamic>("SELECT MV_Montant FROM RT_MOUVEMENT WHERE MV_Id = @Id", new { Id = EligibleReglementId });
Assert((decimal)rowFinal.MV_Montant == montantInitial, "Montant initial restauré avec succès");

Console.WriteLine("\n================================================================================");
Console.WriteLine($"   RÉSULTAT HARNESS TASK-090 : {passed} PASSED / {failed} FAILED");
Console.WriteLine("================================================================================");
