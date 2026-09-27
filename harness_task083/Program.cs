using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading.Tasks;
using Dapper;
using GRC.Infrastructure.Data;
using GRC.Infrastructure.Services;
using GRC.Infrastructure.Tresorerie;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

const string ConnString = "Server=localhost;Database=GR_GOCOM;Integrated Security=True;TrustServerCertificate=True";

Console.WriteLine("================================================================================");
Console.WriteLine("   HARNESS BENCHMARK TASK-083 — MESURE RÉELLE BASE DE DONNÉES SQL SERVER");
Console.WriteLine("================================================================================");

var dbFactory = new DbConnectionFactory(ConnString);

using var loggerFactory = LoggerFactory.Create(builder =>
{
    builder.AddConsole().SetMinimumLevel(LogLevel.Warning);
});
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
    Console.WriteLine($"[Info] Kernel init non requis pour GetReglements: {ex.Message}");
}

var service = new ReglementService(dbFactory, kernel!, logger);

// Identifier societeId et caisses existantes
using var sqlConn = new System.Data.SqlClient.SqlConnection(ConnString);
await sqlConn.OpenAsync();

var societe = await sqlConn.QueryFirstOrDefaultAsync<dynamic>("SELECT TOP 1 SO_Id, SO_RaisonSocial FROM P_SOCIETE");
if (societe == null)
{
    Console.WriteLine("[ERREUR] Aucune société trouvée dans RT_SOCIETE");
    return;
}

int societeId = (int)societe.SO_Id;
string societeNom = (string)societe.SO_RaisonSocial;
Console.WriteLine($"\nSociété testée : ID={societeId}, Nom={societeNom}");

var caisses = (await sqlConn.QueryAsync<int>("SELECT CA_Id FROM RT_CAISSE WHERE SO_Id = @SocieteId", new { SocieteId = societeId })).ToArray();
Console.WriteLine($"Caisses rattachées : {caisses.Length} caisse(s) trouvée(s) : [{string.Join(", ", caisses)}]");

int totalMouvements = await sqlConn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM RT_MOUVEMENT WHERE SO_Id = @SocieteId", new { SocieteId = societeId });
Console.WriteLine($"Total mouvements en base pour cette société : {totalMouvements}");

// ------------------------------------------------------------------------------------------------
// 1. MESURE AVANT CORRECTIF (Fenêtre 2000-2030)
// ------------------------------------------------------------------------------------------------
Console.WriteLine("\n--- TEST 1 : Fenêtre historique large (2000-01-01 -> 2030-01-01) [AVANT] ---");
var swBefore = Stopwatch.StartNew();
var reglementsAvant = service.GetReglements(
    societeId, caisses,
    dateDebut: new DateTime(2000, 1, 1),
    dateFin: new DateTime(2030, 1, 1),
    clientFilter: null, numeroFilter: null, pieceFilter: null, refFilter: null,
    libelleFilter: null, montantFilter: null, extraitFilter: null, isPointe: null,
    isComptabilise: null, isRemis: null, isImpaye: null, isAnnule: null,
    caisseNosFilter: null, isAdmin: true
).ToList();
swBefore.Stop();
Console.WriteLine($"Nombre d'éléments ramenés : {reglementsAvant.Count}");
Console.WriteLine($"Temps d'exécution AVANT   : {swBefore.ElapsedMilliseconds} ms ({swBefore.Elapsed.TotalSeconds:F2} s)");

// ------------------------------------------------------------------------------------------------
// 2. MESURE APRÈS CORRECTIF (Fenêtre par défaut 30 jours glissants)
// ------------------------------------------------------------------------------------------------
Console.WriteLine("\n--- TEST 2 : Fenêtre par défaut (dateDebut=null, dateFin=null -> 30 jours glissants) [APRÈS] ---");
var swAfter = Stopwatch.StartNew();
var reglementsApres = service.GetReglements(
    societeId, caisses,
    dateDebut: null,
    dateFin: null,
    clientFilter: null, numeroFilter: null, pieceFilter: null, refFilter: null,
    libelleFilter: null, montantFilter: null, extraitFilter: null, isPointe: null,
    isComptabilise: null, isRemis: null, isImpaye: null, isAnnule: null,
    caisseNosFilter: null, isAdmin: true
).ToList();
swAfter.Stop();
Console.WriteLine($"Nombre d'éléments ramenés : {reglementsApres.Count}");
Console.WriteLine($"Temps d'exécution APRÈS   : {swAfter.ElapsedMilliseconds} ms ({swAfter.Elapsed.TotalSeconds:F2} s)");

// ------------------------------------------------------------------------------------------------
// 3. VÉRIFICATION FILTRE DATE EXPLICITE ÉLARGI
// ------------------------------------------------------------------------------------------------
Console.WriteLine("\n--- TEST 3 : Filtre utilisateur explicite élargi (ex. 90 jours) ---");
var swCustom = Stopwatch.StartNew();
var reglementsCustom = service.GetReglements(
    societeId, caisses,
    dateDebut: DateTime.Now.Date.AddDays(-90),
    dateFin: DateTime.Now.Date.AddDays(1).AddSeconds(-1),
    clientFilter: null, numeroFilter: null, pieceFilter: null, refFilter: null,
    libelleFilter: null, montantFilter: null, extraitFilter: null, isPointe: null,
    isComptabilise: null, isRemis: null, isImpaye: null, isAnnule: null,
    caisseNosFilter: null, isAdmin: true
).ToList();
swCustom.Stop();
Console.WriteLine($"Nombre d'éléments ramenés (90j) : {reglementsCustom.Count}");
Console.WriteLine($"Temps d'exécution               : {swCustom.ElapsedMilliseconds} ms ({swCustom.Elapsed.TotalSeconds:F2} s)");

// ------------------------------------------------------------------------------------------------
// SYNTHÈSE
// ------------------------------------------------------------------------------------------------
Console.WriteLine("\n================================================================================");
Console.WriteLine("   SYNTHÈSE COMPARATIVE AVANT / APRÈS");
Console.WriteLine("================================================================================");
Console.WriteLine($"Fenêtre 2000-2030 (AVANT) : {reglementsAvant.Count} lignes en {swBefore.ElapsedMilliseconds} ms");
Console.WriteLine($"Fenêtre 30 jours (APRÈS)  : {reglementsApres.Count} lignes en {swAfter.ElapsedMilliseconds} ms");
if (reglementsAvant.Count > 0)
{
    double volumeReduction = (1.0 - (double)reglementsApres.Count / reglementsAvant.Count) * 100.0;
    Console.WriteLine($"Réduction volume données  : -{volumeReduction:F1} %");
}
Console.WriteLine("================================================================================");
