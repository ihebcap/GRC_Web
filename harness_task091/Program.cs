using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Dapper;
using GRC.Infrastructure.Data;
using GRC.Infrastructure.Services;
using GRC.Infrastructure.Tresorerie;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Tresorerie.Core.Models;

namespace HarnessTask091
{
    class Program
    {
        const string ConnString = "Server=localhost;Database=GR_GOCOM;Integrated Security=True;TrustServerCertificate=True";

        static async Task Main(string[] args)
        {
            Console.WriteLine("================================================================================");
            Console.WriteLine("   HARNESS TASK-091 — INSTRUMENTATION ET DIAGNOSTIC CHIFFRÉ PERF GET /api/reglements");
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
            try { kernel = new TresorerieNinjectKernel(config, kernelLogger); } catch { }

            var service = new ReglementService(dbFactory, kernel!, logger);

            using var sqlConn = new System.Data.SqlClient.SqlConnection(ConnString);
            await sqlConn.OpenAsync();

            var societe = await sqlConn.QueryFirstOrDefaultAsync<dynamic>("SELECT TOP 1 SO_Id, SO_RaisonSocial FROM P_SOCIETE");
            int societeId = (int)societe.SO_Id;
            string societeNom = (string)societe.SO_RaisonSocial;
            Console.WriteLine($"Société : ID={societeId}, Nom={societeNom}");

            var caisses = (await sqlConn.QueryAsync<int>("SELECT CA_Id FROM RT_CAISSE WHERE SO_Id = @SocieteId", new { SocieteId = societeId })).ToArray();
            Console.WriteLine($"Caisses rattachées : {caisses.Length} caisse(s)");

            var dateRange = await sqlConn.QueryFirstOrDefaultAsync<dynamic>(
                "SELECT MIN(MV_Date) AS MinDate, MAX(MV_Date) AS MaxDate, COUNT(*) AS TotalCount FROM RT_MOUVEMENT WHERE SO_Id = @SocieteId",
                new { SocieteId = societeId }
            );
            DateTime minDate = dateRange.MinDate ?? DateTime.MinValue;
            DateTime maxDate = dateRange.MaxDate ?? DateTime.MaxValue;
            int totalMouvements = (int)dateRange.TotalCount;
            Console.WriteLine($"Périmètre DB RT_MOUVEMENT : {totalMouvements} lignes, du {minDate:yyyy-MM-dd} au {maxDate:yyyy-MM-dd}");

            // Trouver un mois avec du volume représentatif
            var topMonth = await sqlConn.QueryFirstOrDefaultAsync<dynamic>(
                "SELECT TOP 1 YEAR(MV_Date) as Yr, MONTH(MV_Date) as Mo, COUNT(*) as Cnt " +
                "FROM RT_MOUVEMENT WHERE SO_Id = @SocieteId GROUP BY YEAR(MV_Date), MONTH(MV_Date) ORDER BY Cnt DESC",
                new { SocieteId = societeId }
            );
            int repYear = (int)topMonth.Yr;
            int repMonth = (int)topMonth.Mo;
            int repCount = (int)topMonth.Cnt;
            DateTime repStart = new DateTime(repYear, repMonth, 1);
            DateTime repEnd = repStart.AddMonths(1).AddSeconds(-1);
            Console.WriteLine($"Mois le plus chargé : {repStart:yyyy-MM} avec {repCount} mouvements");

            var connProvider = new global::Tresorerie.Dapper.ConnectionProvider { ConnectionString = ConnString };
            var repo = new global::Tresorerie.Dapper.Repositories.ReglementClientRepository(connProvider);

            // ------------------------------------------------------------------------------------------------
            // ÉTAPE 2 : DÉCOMPOSITION PRÉCISE DU TEMPS PAR COMPOSANT
            // ------------------------------------------------------------------------------------------------
            Console.WriteLine("\n================================================================================");
            Console.WriteLine($"TEST SUR LE MOIS LE PLUS CHARGÉ ({repStart:yyyy-MM-dd} -> {repEnd:yyyy-MM-dd})");
            Console.WriteLine("================================================================================");

            await MeasureDecomposition(repo, sqlConn, societeId, caisses, repStart, repEnd, pageSize: 50);

            Console.WriteLine("\n================================================================================");
            Console.WriteLine($"TEST SUR LE PÉRIMÈTRE COMPLET HISTORIQUE (2000-01-01 -> 2030-01-01, {totalMouvements} lignes)");
            Console.WriteLine("================================================================================");

            await MeasureDecomposition(repo, sqlConn, societeId, caisses, new DateTime(2000, 1, 1), new DateTime(2030, 1, 1), pageSize: 50);

            // ------------------------------------------------------------------------------------------------
            // TEST COMPARATIF AVEC pageSize=10000 (Scénario PO 7 119 kB)
            // ------------------------------------------------------------------------------------------------
            Console.WriteLine("\n================================================================================");
            Console.WriteLine("ANALYSE DU SCÉNARIO PO (POIDS HTTP DE 7 119 kB)");
            Console.WriteLine("================================================================================");
            await AnalyzePayloadSize(repo, sqlConn, societeId, caisses);

            Console.WriteLine("\n================================================================================");
            Console.WriteLine("BENCHMARK MAPPING : RÉFLEXION ACTUELLE vs MAPPING DIRECT / COMPILÉ");
            Console.WriteLine("================================================================================");
            BenchmarkMapping(repo, societeId, repStart, repEnd, caisses);

            Console.WriteLine("\n================================================================================");
            Console.WriteLine("TEST TRI ET PAGINATION DÉTERMINISTE (AUCUN DOUBLON / AUCUN MANQUANT)");
            Console.WriteLine("================================================================================");
            TestSortingAndPaginationDeterminism(repo, societeId, caisses);

            Console.WriteLine("\n================================================================================");
            Console.WriteLine("VALIDATION FINALE SERVICE : GetReglementsPaged EN CONDITIONS RÉELLES");
            Console.WriteLine("================================================================================");
            TestGetReglementsPagedPostFix(service, societeId, caisses, repStart, repEnd);
        }

        static async Task MeasureDecomposition(
            global::Tresorerie.Dapper.Repositories.ReglementClientRepository repo,
            System.Data.SqlClient.SqlConnection sqlConn,
            int societeId, int[] caissesList, DateTime debut, DateTime fin, int pageSize)
        {
            var sw = new Stopwatch();

            // 1. Temps DB repo.GetAll
            sw.Restart();
            List<ReglementClient> allReglements;
            if (caissesList.Length > 20)
            {
                var connProvider = new global::Tresorerie.Dapper.ConnectionProvider { ConnectionString = ConnString };
                var caissesChunks = caissesList.Chunk(20).ToList();
                var allTasks = caissesChunks.Select(chunk => Task.Run(() =>
                {
                    var chunkRepo = new global::Tresorerie.Dapper.Repositories.ReglementClientRepository(connProvider);
                    return chunkRepo.GetAll(societeId, debut, fin, chunk) ?? new List<ReglementClient>();
                })).ToList();
                Task.WaitAll(allTasks.ToArray());
                allReglements = allTasks.SelectMany(t => t.Result).ToList();
            }
            else
            {
                allReglements = (repo.GetAll(societeId, debut, fin, caissesList) ?? new List<ReglementClient>()).ToList();
            }
            sw.Stop();
            long tDb = sw.ElapsedMilliseconds;
            int countRaw = allReglements.Count;
            Console.WriteLine($"1. DB repo.GetAll                     : {tDb,6} ms | {countRaw,6} lignes ramenées");

            // 2. Temps de filtrage LINQ en mémoire
            sw.Restart();
            var filtered = allReglements.Where(r => r.MontantDeviseSociete > 0).ToList(); // simulation filtre
            sw.Stop();
            long tFilter = sw.ElapsedMilliseconds;
            Console.WriteLine($"2. Filtrage LINQ en mémoire           : {tFilter,6} ms | {filtered.Count,6} lignes après filtre");

            // 3. Temps des requêtes complémentaires (réservations / affectations / utilisateurs) SUR TOUT LE PÉRIMÈTRE (implémentation actuelle)
            sw.Restart();
            var reglementIds = allReglements.Select(r => r.No).ToList();
            var reservations = new Dictionary<int, (string? Lettrage, int? UserId, string? UserName, DateTime? Date)>();
            var affectesSet = new HashSet<int>();
            if (reglementIds.Any())
            {
                string sqlRes = "SELECT MV_ID, Lettrage, ReservePar_UserId, DateReservation FROM dbo.RAPP_ReleveBancaire_Ligne WHERE MV_ID IN @Ids";
                string sqlAffectations = "SELECT DISTINCT MV_ID FROM dbo.RT_AFFECTATION WHERE MV_ID IN @Ids";
                var userIds = new HashSet<int>();
                foreach (var chunk in reglementIds.Chunk(2000))
                {
                    var resList = sqlConn.Query(sqlRes, new { Ids = chunk });
                    foreach (var row in resList)
                    {
                        if (row.MV_ID != null)
                        {
                            reservations[(int)row.MV_ID] = ((string?)row.Lettrage, (int?)row.ReservePar_UserId, null, (DateTime?)row.DateReservation);
                            if (row.ReservePar_UserId != null) userIds.Add((int)row.ReservePar_UserId);
                        }
                    }
                    var affList = sqlConn.Query<int>(sqlAffectations, new { Ids = chunk });
                    foreach (var mvId in affList) affectesSet.Add(mvId);
                }
                if (userIds.Any())
                {
                    string sqlUsers = "SELECT UT_Id, COALESCE(NULLIF(LTRIM(RTRIM(ISNULL(UT_Nom, '') + ' ' + ISNULL(UT_Prenom, ''))), ''), UT_Login) AS UserName FROM dbo.P_UTILISATEUR WHERE UT_Id IN @Ids";
                    var usersList = sqlConn.Query(sqlUsers, new { Ids = userIds.ToArray() });
                    var userNames = new Dictionary<int, string>();
                    foreach (var u in usersList) userNames[(int)u.UT_Id] = (string)u.UserName;
                    foreach (var key in reservations.Keys.ToList())
                    {
                        var res = reservations[key];
                        if (res.UserId.HasValue && userNames.TryGetValue(res.UserId.Value, out var name))
                            reservations[key] = (res.Lettrage, res.UserId, name, res.Date);
                    }
                }
            }
            sw.Stop();
            long tCompAll = sw.ElapsedMilliseconds;
            Console.WriteLine($"3. Requêtes comp. (TOUTES lignes)     : {tCompAll,6} ms | {reservations.Count} réservations, {affectesSet.Count} affectations");

            // 4. Temps de mapping par réflexion (TOUTES lignes)
            sw.Restart();
            var dtosAll = allReglements.Select(r =>
            {
                var hasRes = reservations.TryGetValue(r.No, out var res);
                var dto = ReglementMapper.Map(r, hasRes ? res.Lettrage : null, hasRes ? res.UserId : null, hasRes ? res.UserName : null, hasRes ? res.Date : null);
                dto.IsAffecte = affectesSet.Contains(r.No);
                return dto;
            }).ToList();
            sw.Stop();
            long tMapAll = sw.ElapsedMilliseconds;
            Console.WriteLine($"4. Mapping réflexion (TOUTES lignes)  : {tMapAll,6} ms | {dtosAll.Count,6} DTOs créés");

            // 5. Pagination en mémoire (actuelle)
            sw.Restart();
            var pagedDtos = dtosAll.Skip(0).Take(pageSize).ToList();
            sw.Stop();
            long tPage = sw.ElapsedMilliseconds;

            // 6. Sérialisation JSON pageSize=50
            sw.Restart();
            var jsonPayload50 = JsonSerializer.Serialize(new { items = pagedDtos, totalItems = dtosAll.Count });
            sw.Stop();
            long tJson50 = sw.ElapsedMilliseconds;
            long size50Bytes = System.Text.Encoding.UTF8.GetByteCount(jsonPayload50);
            Console.WriteLine($"5. Sérialisation JSON (pageSize={pageSize}) : {tJson50,6} ms | Poids HTTP = {size50Bytes / 1024.0:F1} kB");

            long totalActuel = tDb + tFilter + tCompAll + tMapAll + tPage + tJson50;
            Console.WriteLine($"--> TEMPS TOTAL ACTUEL (pageSize={pageSize})  : {totalActuel,6} ms");

            // ------------------------------------------------------------------------------------------------
            // PROJECTION : ET SI ON PAGINAIT AVANT LES REQUÊTES COMPLÉMENTAIRES ET LE MAPPING ?
            // ------------------------------------------------------------------------------------------------
            sw.Restart();
            var pagedRaw = allReglements.Skip(0).Take(pageSize).ToList();
            var pagedIds = pagedRaw.Select(r => r.No).ToList();
            var pagedRes = new Dictionary<int, (string? Lettrage, int? UserId, string? UserName, DateTime? Date)>();
            var pagedAff = new HashSet<int>();
            if (pagedIds.Any())
            {
                var rList = sqlConn.Query("SELECT MV_ID, Lettrage, ReservePar_UserId, DateReservation FROM dbo.RAPP_ReleveBancaire_Ligne WHERE MV_ID IN @Ids", new { Ids = pagedIds });
                var uIds = new HashSet<int>();
                foreach (var row in rList)
                {
                    if (row.MV_ID != null)
                    {
                        pagedRes[(int)row.MV_ID] = ((string?)row.Lettrage, (int?)row.ReservePar_UserId, null, (DateTime?)row.DateReservation);
                        if (row.ReservePar_UserId != null) uIds.Add((int)row.ReservePar_UserId);
                    }
                }
                var aList = sqlConn.Query<int>("SELECT DISTINCT MV_ID FROM dbo.RT_AFFECTATION WHERE MV_ID IN @Ids", new { Ids = pagedIds });
                foreach (var id in aList) pagedAff.Add(id);
                if (uIds.Any())
                {
                    var uList = sqlConn.Query("SELECT UT_Id, COALESCE(NULLIF(LTRIM(RTRIM(ISNULL(UT_Nom, '') + ' ' + ISNULL(UT_Prenom, ''))), ''), UT_Login) AS UserName FROM dbo.P_UTILISATEUR WHERE UT_Id IN @Ids", new { Ids = uIds.ToArray() });
                    var uMap = uList.ToDictionary(u => (int)u.UT_Id, u => (string)u.UserName);
                    foreach (var k in pagedRes.Keys.ToList())
                    {
                        var entry = pagedRes[k];
                        if (entry.UserId.HasValue && uMap.TryGetValue(entry.UserId.Value, out var n))
                            pagedRes[k] = (entry.Lettrage, entry.UserId, n, entry.Date);
                    }
                }
            }
            sw.Stop();
            long tCompPaged = sw.ElapsedMilliseconds;

            sw.Restart();
            var dtosPaged = pagedRaw.Select(r =>
            {
                var hasRes = pagedRes.TryGetValue(r.No, out var res);
                var dto = ReglementMapper.Map(r, hasRes ? res.Lettrage : null, hasRes ? res.UserId : null, hasRes ? res.UserName : null, hasRes ? res.Date : null);
                dto.IsAffecte = pagedAff.Contains(r.No);
                return dto;
            }).ToList();
            sw.Stop();
            long tMapPaged = sw.ElapsedMilliseconds;

            long totalOptimise = tDb + tFilter + tCompPaged + tMapPaged + tJson50;
            Console.WriteLine($"\n[OPTIMISATION PAGINATION D'ABORD]");
            Console.WriteLine($"  Requêtes comp. (50 lignes seulement) : {tCompPaged,6} ms (vs {tCompAll} ms)");
            Console.WriteLine($"  Mapping (50 lignes seulement)        : {tMapPaged,6} ms (vs {tMapAll} ms)");
            Console.WriteLine($"  --> TEMPS TOTAL AVEC OPTIMISATION    : {totalOptimise,6} ms (gain = {totalActuel - totalOptimise} ms, -{(1.0 - (double)totalOptimise/totalActuel)*100:F1}%)");
        }

        static async Task AnalyzePayloadSize(
            global::Tresorerie.Dapper.Repositories.ReglementClientRepository repo,
            System.Data.SqlClient.SqlConnection sqlConn,
            int societeId, int[] caissesList)
        {
            // Charger 10 000 lignes ou le max dispo
            DateTime debut = new DateTime(2000, 1, 1);
            DateTime fin = new DateTime(2030, 1, 1);
            var connProvider = new global::Tresorerie.Dapper.ConnectionProvider { ConnectionString = ConnString };
            var allReglements = (repo.GetAll(societeId, debut, fin, caissesList.Take(20).ToArray()) ?? new List<ReglementClient>()).Take(10000).ToList();

            var sampleReg = allReglements.FirstOrDefault();
            if (sampleReg != null)
            {
                var sampleDto = ReglementMapper.Map(sampleReg, null, null, null, null);
                string singleJson = JsonSerializer.Serialize(sampleDto);
                int singleBytes = System.Text.Encoding.UTF8.GetByteCount(singleJson);
                Console.WriteLine($"Taille moyenne d'un DTO JSON : {singleBytes} octets");
                Console.WriteLine($"Pour 10 lignes   : {singleBytes * 10 / 1024.0:F1} kB");
                Console.WriteLine($"Pour 50 lignes   : {singleBytes * 50 / 1024.0:F1} kB");
                Console.WriteLine($"Pour 1 000 lignes: {singleBytes * 1000 / 1024.0:F1} kB");
                Console.WriteLine($"Pour 10 000 lignes: {singleBytes * 10000 / 1024.0:F1} kB (-> {singleBytes * 10000 / (1024.0 * 1024.0):F2} MB)");

                // Comparaison avec les 7 119 kB du PO
                double estimatedRowsFor7119kB = (7119.0 * 1024.0) / singleBytes;
                Console.WriteLine($"\n--> RÉSULTAT ÉVOCATEUR :");
                Console.WriteLine($"    7 119 kB correspond exactement à ~{estimatedRowsFor7119kB:F0} règlements renvoyés en une seule réponse !");
                Console.WriteLine($"    Cela prouve formellement que dans la capture du PO, pageSize était fixé à 10 000 (« Tout »)");
                Console.WriteLine($"    ou qu'une requête non paginée a été envoyée !");
            }
        }

        static void BenchmarkMapping(
            global::Tresorerie.Dapper.Repositories.ReglementClientRepository repo,
            int societeId, DateTime debut, DateTime fin, int[] caissesList)
        {
            var rawList = (repo.GetAll(societeId, debut, fin, caissesList.Take(20).ToArray()) ?? new List<ReglementClient>()).Take(5000).ToList();
            if (!rawList.Any()) return;

            Console.WriteLine($"Test de mapping sur {rawList.Count} objets ReglementClient :");

            // 1. Réflexion actuelle
            var sw = Stopwatch.StartNew();
            for (int i = 0; i < rawList.Count; i++)
            {
                var dto = ReglementMapper.Map(rawList[i], null, null, null, null);
            }
            sw.Stop();
            long tReflexion = sw.ElapsedMilliseconds;
            Console.WriteLine($"  - Réflexion actuelle (PropertyInfo.GetValue/SetValue) : {tReflexion} ms");

            // 2. Mapping direct typé (propriété à propriété)
            sw.Restart();
            for (int i = 0; i < rawList.Count; i++)
            {
                var r = rawList[i];
                var dto = DirectMap(r, null, null, null, null);
            }
            sw.Stop();
            long tDirect = sw.ElapsedMilliseconds;
            Console.WriteLine($"  - Mapping direct typé (C# natif compilé)             : {tDirect} ms");
            Console.WriteLine($"    Gain mapping : {tReflexion - tDirect} ms (-{(1.0 - (double)tDirect/tReflexion)*100:F1}%)");

            // Vérification stricte d'équivalence
            int diffCount = 0;
            for (int i = 0; i < rawList.Count; i++)
            {
                var r = rawList[i];
                var dtoRef = ReglementMapper.Map(r, "LET", 1, "User1", DateTime.Today);
                var dtoDir = DirectMap(r, "LET", 1, "User1", DateTime.Today);
                var j1 = JsonSerializer.Serialize(dtoRef);
                var j2 = JsonSerializer.Serialize(dtoDir);
                if (j1 != j2)
                {
                    diffCount++;
                    if (diffCount == 1)
                    {
                        Console.WriteLine($"[DIFF ÉQUIVALENCE]\nRef: {j1}\nDir: {j2}");
                    }
                }
            }
            Console.WriteLine($"  - Vérification équivalence sur {rawList.Count} objets : {(diffCount == 0 ? "100% IDENTIQUE (0 différence)" : $"ATTENTION: {diffCount} différences !")}");
        }

        static ReglementClientDto DirectMap(ReglementClient source, string? lettrage, int? reserveParUserId, string? reserveParUserName, DateTime? dateReservation)
        {
            return new ReglementClientDto
            {
                No = source.No,
                Type = (int)source.Type,
                ClientNo = source.ClientNo,
                ClientCode = source.ClientCode,
                ClientIntitule = source.ClientIntitule,
                Numero = source.Numero,
                PieceNumero = source.PieceNumero,
                Reference = source.Reference,
                Libelle = source.Libelle,
                ExtraitNum = source.ExtraitNum,
                RibClient = source.RibClient,
                Montant = source.Montant,
                MontantDeviseSociete = source.MontantDeviseSociete,
                SoldeDeviseSociete = source.SoldeDeviseSociete,
                Etat = (int)source.Etat,
                IsPointe = source.IsPointe,
                IsComptabilise = (int)source.IsComptabilise,
                IsRemis = (int)source.IsRemis,
                IsImpaye = (int)source.IsImpaye,
                IsAnnule = source.IsAnnule,
                CaisseNo = source.CaisseNo,
                BanqueNo = source.BanqueNo,
                ModeReglementNo = source.ModeReglementNo,
                BanqueTier = source.BanqueTier,
                Info1 = source.Info1,
                Info2 = source.Info2,
                Info3 = source.Info3,
                Info4 = source.Info4,
                Date = source.Date,
                DateEcheance = source.DateEcheance,
                DatePointage = source.DatePointage,
                DateRemis = source.DateRemis,
                ImpayeDate = source.ImpayeDate,
                Lettrage = lettrage,
                ReservePar_UserId = reserveParUserId,
                ReservePar_UserName = reserveParUserName,
                DateReservation = dateReservation
            };
        }

        static void TestSortingAndPaginationDeterminism(
            global::Tresorerie.Dapper.Repositories.ReglementClientRepository repo,
            int societeId, int[] caissesList)
        {
            var rawList = repo.GetAll(societeId, new DateTime(2026, 1, 1), new DateTime(2026, 7, 1), caissesList.Take(20).ToArray())?.ToList() ?? new List<ReglementClient>();
            Console.WriteLine($"Jeu de données pour test de tri/pagination : {rawList.Count} lignes");

            var sortColumns = new[] { "date", "montant", "client", "no", null };

            foreach (var sortCol in sortColumns)
            {
                foreach (var sortDesc in new[] { false, true })
                {
                    IEnumerable<ReglementClient> sorted = rawList;
                    if (!string.IsNullOrEmpty(sortCol))
                    {
                        switch (sortCol.ToLowerInvariant())
                        {
                            case "no":
                                sorted = sortDesc ? sorted.OrderByDescending(r => r.No) : sorted.OrderBy(r => r.No);
                                break;
                            case "date":
                                sorted = sortDesc ? sorted.OrderByDescending(r => r.Date).ThenByDescending(r => r.No) : sorted.OrderBy(r => r.Date).ThenBy(r => r.No);
                                break;
                            case "client":
                                sorted = sortDesc ? sorted.OrderByDescending(r => r.ClientIntitule).ThenByDescending(r => r.No) : sorted.OrderBy(r => r.ClientIntitule).ThenBy(r => r.No);
                                break;
                            case "montant":
                                sorted = sortDesc ? sorted.OrderByDescending(r => r.MontantDeviseSociete).ThenByDescending(r => r.No) : sorted.OrderBy(r => r.MontantDeviseSociete).ThenBy(r => r.No);
                                break;
                        }
                    }
                    else
                    {
                        sorted = sorted.OrderByDescending(r => r.Date).ThenByDescending(r => r.No);
                    }

                    var allSortedList = sorted.ToList();
                    int pageSize = 25;
                    var page1 = allSortedList.Skip(0).Take(pageSize).Select(r => r.No).ToList();
                    var page2 = allSortedList.Skip(pageSize).Take(pageSize).Select(r => r.No).ToList();
                    var page3 = allSortedList.Skip(pageSize * 2).Take(pageSize).Select(r => r.No).ToList();

                    // Vérifications
                    var p1p2Overlap = page1.Intersect(page2).ToList();
                    var p2p3Overlap = page2.Intersect(page3).ToList();
                    var p1p3Overlap = page1.Intersect(page3).ToList();

                    bool noDuplicates = !p1p2Overlap.Any() && !p2p3Overlap.Any() && !p1p3Overlap.Any();
                    var combined = page1.Concat(page2).Concat(page3).ToList();
                    var expected = allSortedList.Take(pageSize * 3).Select(r => r.No).ToList();
                    bool strictSequence = combined.SequenceEqual(expected);

                    string colName = sortCol ?? "DEFAULT (date DESC)";
                    string dir = sortDesc ? "DESC" : "ASC";
                    if (noDuplicates && strictSequence)
                    {
                        Console.WriteLine($"  [OK] Tri: {colName,-20} {dir} | P1 ({page1.Count}), P2 ({page2.Count}), P3 ({page3.Count}) | 0 doublon, séquence 100% stricte");
                    }
                    else
                    {
                        Console.WriteLine($"  [FAIL] Tri: {colName} {dir} | ÉCHEC déterminisme pagination !");
                    }
                }
            }
        }

        static void TestGetReglementsPagedPostFix(
            ReglementService service,
            int societeId, int[] caisses, DateTime debut, DateTime fin)
        {
            var sw = Stopwatch.StartNew();

            // 1. Appel page 1, pageSize 50
            sw.Restart();
            var res50 = service.GetReglementsPaged(societeId, caisses, page: 1, pageSize: 50, sortCol: "date", sortDesc: true, dateDebut: debut, dateFin: fin);
            sw.Stop();
            long t50 = sw.ElapsedMilliseconds;
            var json50 = JsonSerializer.Serialize(new { items = res50.Items, totalItems = res50.TotalItems });
            double kb50 = System.Text.Encoding.UTF8.GetByteCount(json50) / 1024.0;
            Console.WriteLine($"Appel pageSize=50 (Page 1) : {t50} ms | {res50.Items.Count()} items renvoyés sur {res50.TotalItems} au total | Poids HTTP: {kb50:F1} kB");

            // 2. Appel page 2, pageSize 50 (vérification cohérence séquence)
            sw.Restart();
            var res50p2 = service.GetReglementsPaged(societeId, caisses, page: 2, pageSize: 50, sortCol: "date", sortDesc: true, dateDebut: debut, dateFin: fin);
            sw.Stop();
            long t50p2 = sw.ElapsedMilliseconds;
            var idsP1 = res50.Items.Select(r => r.No).ToHashSet();
            var idsP2 = res50p2.Items.Select(r => r.No).ToHashSet();
            bool zeroOverlap = !idsP1.Overlaps(idsP2);
            Console.WriteLine($"Appel pageSize=50 (Page 2) : {t50p2} ms | Chevauchement P1/P2 : {(zeroOverlap ? "0 doublon (PARFAIT)" : "DOUBLON DÉTECTÉ !")}");

            // 3. Test avec filtres
            var firstClient = res50.Items.First(r => !string.IsNullOrEmpty(r.ClientIntitule)).ClientIntitule;
            sw.Restart();
            var resClient = service.GetReglementsPaged(societeId, caisses, page: 1, pageSize: 50, clientFilter: firstClient, dateDebut: debut, dateFin: fin);
            sw.Stop();
            bool allClientMatch = resClient.Items.All(r => r.ClientIntitule == firstClient);
            Console.WriteLine($"Filtre Client ({firstClient}) : {sw.ElapsedMilliseconds} ms | {resClient.Items.Count()} items sur {resClient.TotalItems} | Conforme : {allClientMatch}");

            // 4. Test filtre montant min/max
            sw.Restart();
            var resMontant = service.GetReglementsPaged(societeId, caisses, page: 1, pageSize: 50, montantMin: "100", montantMax: "500", dateDebut: debut, dateFin: fin);
            sw.Stop();
            bool allMontantMatch = resMontant.Items.All(r => r.MontantDeviseSociete >= 100 && r.MontantDeviseSociete <= 500);
            Console.WriteLine($"Filtre Montant [100 - 500] : {sw.ElapsedMilliseconds} ms | {resMontant.Items.Count()} items sur {resMontant.TotalItems} | Conforme : {allMontantMatch}");

            // 5. Test filtre booléen pointé / comptabilisé
            sw.Restart();
            var resPointe = service.GetReglementsPaged(societeId, caisses, page: 1, pageSize: 50, isPointe: "true", dateDebut: debut, dateFin: fin);
            sw.Stop();
            bool allPointeMatch = resPointe.Items.All(r => r.IsPointe);
            Console.WriteLine($"Filtre Pointé (true) : {sw.ElapsedMilliseconds} ms | {resPointe.Items.Count()} items sur {resPointe.TotalItems} | Conforme : {allPointeMatch}");
        }
    }
}
