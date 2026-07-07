using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using GRC.Application.Interfaces;
using GRC.Infrastructure.Tresorerie;
using global::Tresorerie.Core.Models;

namespace GRC.Infrastructure.Services
{
    public class ReglementService
    {
        private readonly IDbConnectionFactory _dbFactory;
        private readonly TresorerieNinjectKernel _kernel;

        public ReglementService(IDbConnectionFactory dbFactory, TresorerieNinjectKernel kernel)
        {
            _dbFactory = dbFactory;
            _kernel = kernel;
        }

        public IEnumerable<object> GetReglements(int societeId, int[] caissesList, DateTime? dateDebut, DateTime? dateFin, string? clientFilter, string? numeroFilter, string? pieceFilter, string? refFilter, string? libelleFilter, string? montantFilter, string? extraitFilter, string? isPointe, string? isComptabilise, string? isRemis, string? isImpaye, string? isAnnule, string? caisseNosFilter, string? banqueNosFilter = null, string? modeNosFilter = null, string? banqueClientFilter = null, string? soldeFilter = null, string? info1Filter = null, string? info2Filter = null, string? info3Filter = null, string? info4Filter = null, string? montantMin = null, string? montantMax = null, string? soldeMin = null, string? soldeMax = null)
        {
            var connProvider = new global::Tresorerie.Dapper.ConnectionProvider();
            connProvider.ConnectionString = _dbFactory.GetConnectionString();

            var repo = new global::Tresorerie.Dapper.Repositories.ReglementClientRepository(connProvider);

            var debut = dateDebut ?? new DateTime(2000, 1, 1);
            var fin = dateFin ?? new DateTime(2030, 1, 1);

            IEnumerable<ReglementClient> allReglements = new List<ReglementClient>();
            if (caissesList.Length > 20)
            {
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
                allReglements = repo.GetAll(societeId, debut, fin, caissesList) ?? new List<ReglementClient>();
            }

            // Filtrer les règlements éligibles au rapprochement bancaire
            allReglements = allReglements.Where(r => GRC.Application.Services.ReglementEligibilityHelper.EstEligibleRappBancaire((int)r.Type, (int)r.IsRemis)).ToList();

            // Application des filtres dynamiques
            if (!string.IsNullOrEmpty(clientFilter)) {
                var values = clientFilter.Split("|||", StringSplitOptions.RemoveEmptyEntries);
                allReglements = allReglements.Where(r => r.ClientIntitule != null && values.Contains(r.ClientIntitule));
            }

            if (!string.IsNullOrEmpty(numeroFilter)) {
                var values = numeroFilter.Split("|||", StringSplitOptions.RemoveEmptyEntries);
                allReglements = allReglements.Where(r => r.Numero != null && values.Contains(r.Numero));
            }

            if (!string.IsNullOrEmpty(pieceFilter)) {
                var values = pieceFilter.Split("|||", StringSplitOptions.RemoveEmptyEntries);
                allReglements = allReglements.Where(r => r.PieceNumero != null && values.Contains(r.PieceNumero));
            }

            if (!string.IsNullOrEmpty(refFilter)) {
                var values = refFilter.Split("|||", StringSplitOptions.RemoveEmptyEntries);
                allReglements = allReglements.Where(r => r.Reference != null && values.Contains(r.Reference));
            }

            if (!string.IsNullOrEmpty(libelleFilter)) {
                var values = libelleFilter.Split("|||", StringSplitOptions.RemoveEmptyEntries);
                allReglements = allReglements.Where(r => r.Libelle != null && values.Contains(r.Libelle));
            }

            if (!string.IsNullOrEmpty(montantFilter))
                allReglements = allReglements.Where(r => r.MontantDeviseSociete.ToString().Contains(montantFilter));

            if (!string.IsNullOrEmpty(extraitFilter)) {
                var values = extraitFilter.Split("|||", StringSplitOptions.RemoveEmptyEntries);
                allReglements = allReglements.Where(r => r.ExtraitNum != null && values.Contains(r.ExtraitNum));
            }

            if (!string.IsNullOrEmpty(isPointe)) {
                bool pointeVal = bool.Parse(isPointe);
                allReglements = allReglements.Where(r => r.IsPointe == pointeVal);
            }
            
            if (!string.IsNullOrEmpty(isComptabilise)) {
                bool comptaVal = bool.Parse(isComptabilise);
                allReglements = allReglements.Where(r => comptaVal ? r.IsComptabilise > 0 : r.IsComptabilise == 0);
            }

            if (!string.IsNullOrEmpty(isRemis)) {
                bool remisVal = bool.Parse(isRemis);
                allReglements = allReglements.Where(r => remisVal ? r.IsRemis > 0 : r.IsRemis == 0);
            }

            if (!string.IsNullOrEmpty(isImpaye)) {
                bool impayeVal = bool.Parse(isImpaye);
                allReglements = allReglements.Where(r => impayeVal ? r.IsImpaye > 0 : r.IsImpaye == 0);
            }

            if (!string.IsNullOrEmpty(isAnnule)) {
                bool annuleVal = bool.Parse(isAnnule);
                allReglements = allReglements.Where(r => r.IsAnnule == annuleVal);
            }

            if (!string.IsNullOrEmpty(caisseNosFilter)) {
                var ids = caisseNosFilter.Split(',').Select(int.Parse).ToArray();
                allReglements = allReglements.Where(r => ids.Contains(r.CaisseNo));
            }

            if (!string.IsNullOrEmpty(banqueNosFilter)) {
                var ids = banqueNosFilter.Split(',', StringSplitOptions.RemoveEmptyEntries).Select(int.Parse).ToArray();
                allReglements = allReglements.Where(r => r.BanqueNo != null && ids.Contains(r.BanqueNo.Value));
            }

            if (!string.IsNullOrEmpty(modeNosFilter)) {
                var ids = modeNosFilter.Split(',', StringSplitOptions.RemoveEmptyEntries).Select(int.Parse).ToArray();
                allReglements = allReglements.Where(r => ids.Contains(r.ModeReglementNo));
            }

            if (!string.IsNullOrEmpty(banqueClientFilter)) {
                var values = banqueClientFilter.Split("|||", StringSplitOptions.RemoveEmptyEntries);
                allReglements = allReglements.Where(r => r.BanqueTier != null && values.Contains(r.BanqueTier));
            }

            if (!string.IsNullOrEmpty(soldeFilter))
                allReglements = allReglements.Where(r => r.SoldeDeviseSociete.ToString().Contains(soldeFilter));

            if (!string.IsNullOrEmpty(info1Filter)) {
                var values = info1Filter.Split("|||", StringSplitOptions.RemoveEmptyEntries);
                allReglements = allReglements.Where(r => r.Info1 != null && values.Contains(r.Info1));
            }

            if (!string.IsNullOrEmpty(info2Filter)) {
                var values = info2Filter.Split("|||", StringSplitOptions.RemoveEmptyEntries);
                allReglements = allReglements.Where(r => r.Info2 != null && values.Contains(r.Info2));
            }

            if (!string.IsNullOrEmpty(info3Filter)) {
                var values = info3Filter.Split("|||", StringSplitOptions.RemoveEmptyEntries);
                allReglements = allReglements.Where(r => r.Info3 != null && values.Contains(r.Info3));
            }

            if (!string.IsNullOrEmpty(info4Filter)) {
                var values = info4Filter.Split("|||", StringSplitOptions.RemoveEmptyEntries);
                allReglements = allReglements.Where(r => r.Info4 != null && values.Contains(r.Info4));
            }

            var inv = System.Globalization.CultureInfo.InvariantCulture;
            var anyStyle = System.Globalization.NumberStyles.Any;

            if (!string.IsNullOrEmpty(montantMin) && decimal.TryParse(montantMin, anyStyle, inv, out var mMin))
                allReglements = allReglements.Where(r => r.MontantDeviseSociete >= mMin);
            if (!string.IsNullOrEmpty(montantMax) && decimal.TryParse(montantMax, anyStyle, inv, out var mMax))
                allReglements = allReglements.Where(r => r.MontantDeviseSociete <= mMax);

            if (!string.IsNullOrEmpty(soldeMin) && decimal.TryParse(soldeMin, anyStyle, inv, out var sMin))
                allReglements = allReglements.Where(r => r.SoldeDeviseSociete >= sMin);
            if (!string.IsNullOrEmpty(soldeMax) && decimal.TryParse(soldeMax, anyStyle, inv, out var sMax))
                allReglements = allReglements.Where(r => r.SoldeDeviseSociete <= sMax);

            var reglementIds = allReglements.Select(r => r.No).ToList();
            var reservations = new Dictionary<int, (string? Lettrage, int? UserId, string? UserName, DateTime? Date)>();
            
            if (reglementIds.Any())
            {
                using (var connection = new System.Data.SqlClient.SqlConnection(_dbFactory.GetConnectionString()))
                {
                    connection.Open();
                    
                    // 1. Charger les réservations pour les règlements
                    string sqlRes = "SELECT MV_ID, Lettrage, ReservePar_UserId, DateReservation FROM dbo.RAPP_ReleveBancaire_Ligne WHERE MV_ID IN @Ids";
                    var userIds = new HashSet<int>();
                    
                    foreach (var chunk in reglementIds.Chunk(2000))
                    {
                        var resList = Dapper.SqlMapper.Query(connection, sqlRes, new { Ids = chunk });
                        foreach (var row in resList)
                        {
                            if (row.MV_ID != null)
                            {
                                reservations[(int)row.MV_ID] = ((string?)row.Lettrage, (int?)row.ReservePar_UserId, null, (DateTime?)row.DateReservation);
                                if (row.ReservePar_UserId != null)
                                {
                                    userIds.Add((int)row.ReservePar_UserId);
                                }
                            }
                        }
                    }
                    
                    // 2. Résoudre les noms d'utilisateurs
                    var userNames = new Dictionary<int, string>();
                    if (userIds.Any())
                    {
                        string sqlUsers = "SELECT UT_Id, COALESCE(NULLIF(LTRIM(RTRIM(ISNULL(UT_Nom, '') + ' ' + ISNULL(UT_Prenom, ''))), ''), UT_Login) AS UserName FROM dbo.P_UTILISATEUR WHERE UT_Id IN @Ids";
                        var usersList = Dapper.SqlMapper.Query(connection, sqlUsers, new { Ids = userIds.ToArray() });
                        foreach (var u in usersList)
                        {
                            userNames[(int)u.UT_Id] = (string)u.UserName;
                        }
                    }
                    
                    // 3. Mettre à jour les réservations avec les noms
                    foreach (var key in reservations.Keys.ToList())
                    {
                        var res = reservations[key];
                        if (res.UserId.HasValue && userNames.TryGetValue(res.UserId.Value, out var name))
                        {
                            reservations[key] = (res.Lettrage, res.UserId, name, res.Date);
                        }
                    }
                }
            }

            return allReglements.Select(r => {
                var hasRes = reservations.TryGetValue(r.No, out var res);
                return ReglementMapper.Map(r, hasRes ? res.Lettrage : null, hasRes ? res.UserId : null, hasRes ? res.UserName : null, hasRes ? res.Date : null);
            }).ToList();
        }

        public object GetDistinctReglements(int societeId, int[] caissesList, DateTime? dateDebut, DateTime? dateFin)
        {
            var connProvider = new global::Tresorerie.Dapper.ConnectionProvider();
            connProvider.ConnectionString = _dbFactory.GetConnectionString();

            var repo = new global::Tresorerie.Dapper.Repositories.ReglementClientRepository(connProvider);

            var debut = dateDebut ?? new DateTime(2000, 1, 1);
            var fin = dateFin ?? new DateTime(2030, 1, 1);
            
            IEnumerable<ReglementClient> allReglements = new List<ReglementClient>();
            if (caissesList.Length > 20)
            {
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
                allReglements = repo.GetAll(societeId, debut, fin, caissesList) ?? new List<ReglementClient>();
            }

            // Filtrer les règlements éligibles au rapprochement bancaire
            allReglements = allReglements.Where(r => GRC.Application.Services.ReglementEligibilityHelper.EstEligibleRappBancaire((int)r.Type, (int)r.IsRemis)).ToList();

            var clients = allReglements.Where(r => !string.IsNullOrEmpty(r.ClientIntitule)).Select(r => r.ClientIntitule).Distinct().OrderBy(x => x).ToList();
            var numeros = allReglements.Where(r => !string.IsNullOrEmpty(r.Numero)).Select(r => r.Numero).Distinct().OrderBy(x => x).ToList();
            var pieces = allReglements.Where(r => !string.IsNullOrEmpty(r.PieceNumero)).Select(r => r.PieceNumero).Distinct().OrderBy(x => x).ToList();
            var references = allReglements.Where(r => !string.IsNullOrEmpty(r.Reference)).Select(r => r.Reference).Distinct().OrderBy(x => x).ToList();
            var libelles = allReglements.Where(r => !string.IsNullOrEmpty(r.Libelle)).Select(r => r.Libelle).Distinct().OrderBy(x => x).ToList();
            var extraits = allReglements.Where(r => !string.IsNullOrEmpty(r.ExtraitNum)).Select(r => r.ExtraitNum).Distinct().OrderBy(x => x).ToList();
            var banqueClients = allReglements.Where(r => !string.IsNullOrEmpty(r.BanqueTier)).Select(r => r.BanqueTier).Distinct().OrderBy(x => x).ToList();
            var info1s = allReglements.Where(r => !string.IsNullOrEmpty(r.Info1)).Select(r => r.Info1).Distinct().OrderBy(x => x).ToList();
            var info2s = allReglements.Where(r => !string.IsNullOrEmpty(r.Info2)).Select(r => r.Info2).Distinct().OrderBy(x => x).ToList();
            var info3s = allReglements.Where(r => !string.IsNullOrEmpty(r.Info3)).Select(r => r.Info3).Distinct().OrderBy(x => x).ToList();
            var info4s = allReglements.Where(r => !string.IsNullOrEmpty(r.Info4)).Select(r => r.Info4).Distinct().OrderBy(x => x).ToList();

            return new { clients, numeros, pieces, references, libelles, extraits, banqueClients, info1s, info2s, info3s, info4s };
        }

        public object Comptabiliser(List<int> reglementIds)
        {
            var connProvider = new global::Tresorerie.Dapper.ConnectionProvider();
            connProvider.ConnectionString = _dbFactory.GetConnectionString();
            
            var comptabilizer = _kernel.Resolve<global::Tresorerie.ApplicationServices.Comptabilite.Interfaces.IComptabilizer<global::Tresorerie.Core.Models.ReglementClient>>();
            var generator = _kernel.Resolve<global::Tresorerie.ApplicationServices.Comptabilite.Interfaces.IEcritureComptableGenerator<global::Tresorerie.Core.Models.ReglementClient>>();

            var options = new ParallelOptions { MaxDegreeOfParallelism = 10 };
            int successCount = 0;
            int errorCount = 0;
            var errors = new System.Collections.Concurrent.ConcurrentBag<string>();

            Parallel.ForEach(reglementIds, options, id =>
            {
                try
                {
                    var connProvThread = new global::Tresorerie.Dapper.ConnectionProvider();
                    connProvThread.ConnectionString = _dbFactory.GetConnectionString();
                    var repoThread = new global::Tresorerie.Dapper.Repositories.ReglementClientRepository(connProvThread);
                    
                    var reg = repoThread.Get(id);
                    if (reg != null && reg.IsComptabilise == 0)
                    {
                        var ecritures = generator.Generate(reg, null, null);
                        comptabilizer.Comptabiliser(reg, ecritures);
                        System.Threading.Interlocked.Increment(ref successCount);
                    }
                }
                catch (Exception ex)
                {
                    System.Threading.Interlocked.Increment(ref errorCount);
                    errors.Add($"Erreur sur le règlement {id}: {ex.Message}");
                }
            });

            return new { success = true, successCount, errorCount, errors = errors.ToList() };
        }

        public object RapprocherManuel(List<RapprochementManuelDto> items)
        {
            var connProvider = new global::Tresorerie.Dapper.ConnectionProvider();
            connProvider.ConnectionString = _dbFactory.GetConnectionString();
            var repo = new global::Tresorerie.Dapper.Repositories.ReglementClientRepository(connProvider);

            int successCount = 0;
            int errorCount = 0;
            var errors = new List<string>();

            foreach (var item in items)
            {
                try
                {
                    var reg = repo.Get(item.ReglementId);
                    if (reg == null)
                        throw new Exception($"Le règlement {item.ReglementId} n'existe pas.");

                    // Contrainte 1-à-1 : un règlement déjà pointé ne peut pas être rapproché à nouveau
                    if (reg.IsPointe)
                        throw new InvalidOperationException($"Le règlement {reg.No} est déjà pointé.");

                    reg.IsPointe = true;
                    if (!string.IsNullOrEmpty(item.ExtraitNum))
                    {
                        reg.ExtraitNum = item.ExtraitNum;
                        reg.Info1 = item.ExtraitNum;
                    }
                    if (item.DateValeur.HasValue)
                        reg.DatePointage = item.DateValeur.Value;

                    repo.Update(reg);
                    successCount++;
                }
                catch (Exception ex)
                {
                    errorCount++;
                    errors.Add($"Règlement {item.ReglementId}: {ex.Message}");
                }
            }

            return new { success = errorCount == 0, successCount, errorCount, errors };
        }

        public object ApercuComptabilisation(List<int> reglementIds)
        {
            var connProvider = new global::Tresorerie.Dapper.ConnectionProvider();
            connProvider.ConnectionString = _dbFactory.GetConnectionString();
            var repo = new global::Tresorerie.Dapper.Repositories.ReglementClientRepository(connProvider);
            var generator = _kernel.Resolve<global::Tresorerie.ApplicationServices.Comptabilite.Interfaces.IEcritureComptableGenerator<global::Tresorerie.Core.Models.ReglementClient>>();

            var apercus = new List<object>();

            foreach (var id in reglementIds)
            {
                var reg = repo.Get(id);
                if (reg != null && reg.IsComptabilise == 0)
                {
                    try
                    {
                        var ecritures = generator.Generate(reg, null, null);
                        apercus.Add(new { 
                            ReglementId = id, 
                            ReglementNumero = reg.Numero, 
                            Client = reg.ClientIntitule,
                            Montant = reg.MontantDeviseSociete,
                            Ecritures = ecritures 
                        });
                    }
                    catch (Exception ex)
                    {
                        apercus.Add(new { 
                            ReglementId = id, 
                            ReglementNumero = reg.Numero, 
                            Client = reg.ClientIntitule,
                            Erreur = ex.Message 
                        });
                    }
                }
            }
            return apercus;
        }
    }

    // Rapprochement manuel : payload envoyé par le front (/api/rapprochement)
    public class RapprochementManuelDto
    {
        public int ReglementId { get; set; }
        public string? ExtraitNum { get; set; }
        public DateTime? DateValeur { get; set; }
    }

    public class ReglementClientDto
    {
        public int No { get; set; }
        public int Type { get; set; }
        public string? ClientIntitule { get; set; }
        public string? Numero { get; set; }
        public string? PieceNumero { get; set; }
        public string? Reference { get; set; }
        public string? Libelle { get; set; }
        public string? ExtraitNum { get; set; }
        public string? RibClient { get; set; }
        
        public decimal Montant { get; set; }
        public decimal MontantDeviseSociete { get; set; }
        public decimal SoldeDeviseSociete { get; set; }
        
        public int Etat { get; set; }
        public bool IsPointe { get; set; }
        public int IsComptabilise { get; set; }
        public int IsRemis { get; set; }
        public int IsImpaye { get; set; }
        public bool IsAnnule { get; set; }
        
        public int CaisseNo { get; set; }
        public int? BanqueNo { get; set; }
        public int ModeReglementNo { get; set; }
        public string? BanqueTier { get; set; }
        
        public string? Info1 { get; set; }
        public string? Info2 { get; set; }
        public string? Info3 { get; set; }
        public string? Info4 { get; set; }
        
        public DateTime? Date { get; set; }
        public DateTime? DateSaisie { get; set; }
        public DateTime? DateEcheance { get; set; }
        public DateTime? DatePiece { get; set; }
        public DateTime? DatePointage { get; set; }
        public DateTime? DateRemis { get; set; }
        public DateTime? ImpayeDate { get; set; }
        
        public int? ReservePar_UserId { get; set; }
        public string? ReservePar_UserName { get; set; }
        public DateTime? DateReservation { get; set; }
        public string? Lettrage { get; set; }
    }

    public static class ReglementMapper
    {
        private static readonly System.Collections.Generic.List<(System.Reflection.PropertyInfo Source, System.Reflection.PropertyInfo Target)> _matchedProps = new System.Collections.Generic.List<(System.Reflection.PropertyInfo, System.Reflection.PropertyInfo)>();

        static ReglementMapper()
        {
            var sourceProps = typeof(global::Tresorerie.Core.Models.ReglementClient).GetProperties(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance).Where(p => p.CanRead);
            var targetProps = typeof(ReglementClientDto).GetProperties(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance).Where(p => p.CanWrite);

            foreach (var tProp in targetProps)
            {
                var sProp = sourceProps.FirstOrDefault(p => p.Name == tProp.Name);
                if (sProp != null)
                {
                    _matchedProps.Add((sProp, tProp));
                }
            }
        }

        public static ReglementClientDto Map(global::Tresorerie.Core.Models.ReglementClient source, string? lettrage, int? reserveParUserId, string? reserveParUserName, DateTime? dateReservation)
        {
            var target = new ReglementClientDto();
            foreach (var pair in _matchedProps)
            {
                var val = pair.Source.GetValue(source);
                if (val != null)
                {
                    try { pair.Target.SetValue(target, val); } catch { }
                }
            }
            target.Lettrage = lettrage;
            target.ReservePar_UserId = reserveParUserId;
            target.ReservePar_UserName = reserveParUserName;
            target.DateReservation = dateReservation;
            return target;
        }
    }
}
