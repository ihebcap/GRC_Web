using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Threading.Tasks;
using GRC.Application.Interfaces;
using GRC.Application.Services;
using GRC.Infrastructure.Repositories;
using GRC.Infrastructure.Tresorerie;
using global::Tresorerie.Core.Models;
using Microsoft.Extensions.Logging;

namespace GRC.Infrastructure.Services
{
    public class ReglementService
    {
        private readonly IDbConnectionFactory _dbFactory;
        private readonly TresorerieNinjectKernel _kernel;
        private readonly ILogger<ReglementService> _logger;

        public ReglementService(IDbConnectionFactory dbFactory, TresorerieNinjectKernel kernel, ILogger<ReglementService> logger)
        {
            _dbFactory = dbFactory;
            _kernel = kernel;
            _logger = logger;
        }

        public IEnumerable<object> GetReglements(int societeId, int[] caissesList, DateTime? dateDebut = null, DateTime? dateFin = null, string? clientFilter = null, string? numeroFilter = null, string? pieceFilter = null, string? refFilter = null, string? libelleFilter = null, string? montantFilter = null, string? extraitFilter = null, string? isPointe = null, string? isComptabilise = null, string? isRemis = null, string? isImpaye = null, string? isAnnule = null, string? caisseNosFilter = null, string? banqueNosFilter = null, string? modeNosFilter = null, string? banqueClientFilter = null, string? soldeFilter = null, string? info1Filter = null, string? info2Filter = null, string? info3Filter = null, string? info4Filter = null, string? montantMin = null, string? montantMax = null, string? soldeMin = null, string? soldeMax = null, bool isAdmin = false, bool eligibleRappBancaire = false, bool includeEspeceEtAutreSiPointeFiltre = false)
        {
            if (isAdmin)
            {
                using var sqlConn = new System.Data.SqlClient.SqlConnection(_dbFactory.GetConnectionString());
                caissesList = Dapper.SqlMapper.Query<int>(sqlConn, "SELECT CA_Id FROM RT_CAISSE WHERE SO_Id = @SocieteId", new { SocieteId = societeId }).ToArray();
            }

            var connProvider = new global::Tresorerie.Dapper.ConnectionProvider();
            connProvider.ConnectionString = _dbFactory.GetConnectionString();

            var repo = new global::Tresorerie.Dapper.Repositories.ReglementClientRepository(connProvider);

            // TASK-083 — Plage par défaut de 30 jours glissants (au lieu de 2000-2030) pour éviter
            // d'interroger 30 ans d'historique au chargement initial sans filtre date explicite.
            var debut = dateDebut ?? DateTime.Now.Date.AddDays(-30);
            var fin = dateFin ?? DateTime.Now.Date.AddDays(1).AddSeconds(-1);

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

            // Filtrer les règlements éligibles au rapprochement bancaire (uniquement si demandé)
            if (eligibleRappBancaire)
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

            // TASK-087 — Filtre « Rapproché » (pointe) de l'écran comptabilisation : si includeEspeceEtAutreSiPointeFiltre
            // est activé (opt-in exclusif d'ApercuComptabilisation.tsx), les règlements MV_Type IN (0,4) (Espèce, Autre)
            // sont toujours inclus quel que soit IsPointe car ils n'ont pas de notion de rapprochement bancaire.
            // Pour tous les autres appelants (App.tsx, RapprochementBancaire.tsx), le filtre IsPointe strict reste inchangé.
            if (!string.IsNullOrEmpty(isPointe)) {
                bool pointeVal = bool.Parse(isPointe);
                allReglements = includeEspeceEtAutreSiPointeFiltre
                    ? allReglements.Where(r => (int)r.Type == 0 || (int)r.Type == 4 || r.IsPointe == pointeVal)
                    : allReglements.Where(r => r.IsPointe == pointeVal);
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
            var affectesSet = new HashSet<int>();
            
            if (reglementIds.Any())
            {
                using (var connection = new System.Data.SqlClient.SqlConnection(_dbFactory.GetConnectionString()))
                {
                    connection.Open();
                    
                    // 1. Charger les réservations pour les règlements
                    string sqlRes = "SELECT MV_ID, Lettrage, ReservePar_UserId, DateReservation FROM dbo.RAPP_ReleveBancaire_Ligne WHERE MV_ID IN @Ids";
                    string sqlAffectations = "SELECT DISTINCT MV_ID FROM dbo.RT_AFFECTATION WHERE MV_ID IN @Ids";
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

                        // TASK-085 — Détection batch des affectations (100% conforme à r.GetAffectations().Any(), évite le N+1 sur toute la grille)
                        var affList = Dapper.SqlMapper.Query<int>(connection, sqlAffectations, new { Ids = chunk });
                        foreach (var mvId in affList)
                        {
                            affectesSet.Add(mvId);
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
                var dto = ReglementMapper.Map(r, hasRes ? res.Lettrage : null, hasRes ? res.UserId : null, hasRes ? res.UserName : null, hasRes ? res.Date : null);
                dto.IsAffecte = affectesSet.Contains(r.No);
                return dto;
            }).ToList();
        }

        public object GetDistinctReglements(int societeId, int[] caissesList, DateTime? dateDebut, DateTime? dateFin, bool isAdmin = false, bool eligibleRappBancaire = false)
        {
            if (isAdmin)
            {
                using var sqlConn = new System.Data.SqlClient.SqlConnection(_dbFactory.GetConnectionString());
                caissesList = Dapper.SqlMapper.Query<int>(sqlConn, "SELECT CA_Id FROM RT_CAISSE WHERE SO_Id = @SocieteId", new { SocieteId = societeId }).ToArray();
            }

            var connProvider = new global::Tresorerie.Dapper.ConnectionProvider();
            connProvider.ConnectionString = _dbFactory.GetConnectionString();

            var repo = new global::Tresorerie.Dapper.Repositories.ReglementClientRepository(connProvider);

            // TASK-015 — Pas de bornage transmis par le front à l'ouverture du dashboard (fetchReferences
            // n'envoie ni dateDebut ni dateFin) : à défaut de période explicite, on se limite aux 12 derniers
            // mois glissants (fenêtre validée PO 2026-09-17) plutôt que de recharger tout l'historique 2000→2030.
            var debut = dateDebut ?? DateTime.Now.AddMonths(-12);
            var fin = dateFin ?? DateTime.Now;

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

            // Filtrer les règlements éligibles au rapprochement bancaire (uniquement si demandé)
            if (eligibleRappBancaire)
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

        public object Comptabiliser(List<int> reglementIds, int jwtUserId, bool isAdmin)
        {
            if (reglementIds == null || reglementIds.Count == 0)
                return new { success = true, successCount = 0, errorCount = 0, errors = new List<string>(), docNumeroWarnings = new List<string>(), lettrageWarnings = new List<string>() };

            // TASK-069 — Pré-contrôle d'autorisation caisse (HasEntityActionRestriction sur l'utilisateur JWT réel).
            // Si un règlement demandé n'appartient pas aux caisses autorisées pour jwtUserId, refus immédiat.
            if (!isAdmin)
            {
                var actionGuid = new global::Tresorerie.Authorization.Core.Actions.ReglementComptabiliser().Guid;
                var cacheCaisses = new Dictionary<int, bool>();
                var connProvAuth = new global::Tresorerie.Dapper.ConnectionProvider { ConnectionString = _dbFactory.GetConnectionString() };
                var repoAuth = new global::Tresorerie.Dapper.Repositories.ReglementClientRepository(connProvAuth);

                foreach (var id in reglementIds)
                {
                    var reg = repoAuth.Get(id);
                    if (reg == null) continue;
                    VerifierAutorisationCaisse(jwtUserId, reg.CaisseOrigine, actionGuid, cacheCaisses);
                }
            }

            var connProvider = new global::Tresorerie.Dapper.ConnectionProvider();
            connProvider.ConnectionString = _dbFactory.GetConnectionString();

            var comptabilizer = _kernel.Resolve<global::Tresorerie.ApplicationServices.Comptabilite.Interfaces.IComptabilizer<global::Tresorerie.Core.Models.ReglementClient>>();
            var generator = _kernel.Resolve<global::Tresorerie.ApplicationServices.Comptabilite.Interfaces.IEcritureComptableGenerator<global::Tresorerie.Core.Models.ReglementClient>>();
            // TASK-050 — Lettrage natif post-compta : ne lettre que si le règlement est totalement
            // affecté (groupe d'écritures équilibré) ; filtre géré par la DLL, pas recodé ici.
            var lettrage = _kernel.Resolve<global::Tresorerie.ApplicationServices.Comptabilite.Interfaces.ILettrageReglementClient>();

            // TASK-036/053 : valeurs métier (pièce, référence, libellé, DocNumero) depuis la vue GRC.
            var viewRows = new ReglementComptaViewRepository(_dbFactory).GetByMvIds(reglementIds);

            // TASK-047 — Société chargée UNE fois (lecture seule, même instance/config que celle que la DLL
            // déréférence dans Generate) : sert à la garde de comptabilisabilité VerifierComptabilisable.
            var societe = _kernel.GroupeService.SocieteManager.Societe;

            // TASK-048 — La DLL Sage alloue elle-même IEC_ECNO (lecture du prochain n° puis INSERT) SANS verrou :
            // elle n'est pas thread-safe. En parallèle, plusieurs threads lisaient le même « prochain n° » et
            // collisionnaient sur la contrainte UNIQUE IEC_ECNO (SqlException 2627 → règlements perdus).
            // Comptabilisation SÉQUENTIELLE (foreach) : un seul thread appelle jamais l'allocation → collision
            // impossible par construction. Le curseur projet est la justesse comptable, pas le débit ; un lot de
            // règlements ne justifie pas du parallélisme. Réduit aussi la pression MSDTC (compta cross-DB).
            int successCount = 0;
            int errorCount = 0;
            var errors = new List<string>();
            // Règlements comptabilisés mais dont les DocNumero1/2 n'ont pas pu être écrits :
            // anomalie NON bloquante (la compta est committée), remontée explicitement (pas de silence).
            var docNumeroWarnings = new List<string>();
            // TASK-050 — Échecs/non-applications du lettrage natif (règlement partiel = cas normal,
            // exercice clôturé = cas d'erreur) : jamais bloquant, jamais compté dans errorCount.
            var lettrageWarnings = new List<string>();

            foreach (var id in reglementIds)
            {
                try
                {
                    var connProvThread = new global::Tresorerie.Dapper.ConnectionProvider();
                    connProvThread.ConnectionString = _dbFactory.GetConnectionString();
                    var repoThread = new global::Tresorerie.Dapper.Repositories.ReglementClientRepository(connProvThread);

                    var reg = repoThread.Get(id);
                    if (reg == null || reg.IsComptabilise != 0)
                    {
                        _logger.LogInformation(
                            "COMPTABILISATION : règlement {ReglementId} ignoré (introuvable={Introuvable} ou déjà comptabilisé IsComptabilise={Etat})",
                            id, reg == null, reg?.IsComptabilise);
                        continue;
                    }

                    // TASK-047 — Garde AVANT Generate : convertit le NRE opaque de la DLL en message métier clair.
                    VerifierComptabilisable(societe, reg);

                    viewRows.TryGetValue(reg.No, out var viewRow);

                    // Pièce forcée = MV_Piece pour tous les types/modes présents dans la vue (TASK-038) ;
                    // compteur Sage par défaut SEULEMENT si le règlement est absent de la vue.
                    ComptaPieceContext.ForcedPiece = PieceAForcer(reg, viewRow);
                    var pieceForcee = ComptaPieceContext.ForcedPiece;
                    var (docNum1, docNum2) = viewRow != null
                        ? CalculerDocNumeros(viewRow)
                        : (string.Empty, string.Empty);
                    _logger.LogInformation(
                        "COMPTABILISATION écriture : reglementId={ReglementId}, pièceForcée={PieceForcee}, docNumero1={Doc1}, docNumero2={Doc2}, date={Date:yyyy-MM-dd}, montant={Montant}, mode={ModeNo}",
                        id, pieceForcee, docNum1, docNum2, reg.Date, reg.MontantDeviseSociete, reg.ModeReglementNo);

                    List<global::Tresorerie.Core.Models.EcritureComptable> ecritures;
                    try
                    {
                        // Date = MV_Date (reg.Date) pour tous les types, via le paramètre date de Generate.
                        ecritures = generator.Generate(reg, reg.Date, null).ToList();

                        if (viewRow != null)
                            AppliquerChampsVue(ecritures, viewRow);

                        comptabilizer.Comptabiliser(reg, ecritures);
                    }
                    finally
                    {
                        ComptaPieceContext.ForcedPiece = null;
                    }

                    // La compta est committée (IsComptabilise=1) et le re-run est impossible (garde IsComptabilise!=0).
                    // On la compte donc en SUCCÈS ici, AVANT l'écriture des DocNumero : un échec sur ces colonnes
                    // custom ne doit ni annuler la compta ni la faire basculer en erreur (statut trompeur).
                    successCount++;
                    _logger.LogInformation(
                        "COMPTABILISATION OK : reglementId={ReglementId}, ErpNo affecté={ErpNos}, NumeroPiece={NumeroPieces}",
                        id,
                        string.Join(",", ecritures.Select(e => e.ErpNo).Distinct()),
                        string.Join(",", ecritures.Select(e => e.NumeroPiece).Distinct()));

                    // TASK-050 — Tentative de lettrage natif, jamais bloquante : un règlement partiellement
                    // affecté (déséquilibre du groupe d'écritures) ou un exercice clôturé fait échouer/no-op
                    // le lettrage en interne, sans que ce soit une erreur de compta.
                    try
                    {
                        bool lettre = lettrage.LettrerAsync(reg).GetAwaiter().GetResult();
                        _logger.LogInformation(
                            "COMPTABILISATION lettrage : reglementId={ReglementId}, lettré={Lettre}", id, lettre);
                        if (!lettre)
                            lettrageWarnings.Add($"Règlement {id} comptabilisé, non lettré (affectation partielle ou exercice clôturé).");
                    }
                    catch (Exception exLettrage)
                    {
                        _logger.LogWarning(exLettrage,
                            "COMPTABILISATION : règlement {ReglementId} comptabilisé mais lettrage échoué", id);
                        lettrageWarnings.Add($"Règlement {id} comptabilisé, mais lettrage échoué : {exLettrage.Message}");
                    }

                    // DocNumero1/DocNumero2 : colonnes non mappées par la DLL → UPDATE post-compta, ISOLÉ.
                    if (viewRow != null)
                    {
                        try
                        {
                            EcrireDocNumeros(ecritures, viewRow, id);
                        }
                        catch (Exception exDoc)
                        {
                            _logger.LogWarning(exDoc,
                                "COMPTABILISATION : règlement {ReglementId} comptabilisé mais DocNumero1/2 non écrits", id);
                            docNumeroWarnings.Add(
                                $"Règlement {id} comptabilisé, mais DocNumero1/2 non écrits : {exDoc.Message}");
                        }
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex,
                        "COMPTABILISATION ÉCHEC : reglementId={ReglementId} — erreur DLL Sage : {Message}", id, ex.Message);
                    errorCount++;
                    errors.Add($"Erreur sur le règlement {id}: {ex.Message}");
                }
            }

            return new
            {
                success = true,
                successCount,
                errorCount,
                errors = errors.ToList(),
                docNumeroWarnings = docNumeroWarnings.ToList(),
                lettrageWarnings = lettrageWarnings.ToList()
            };
        }

        // TASK-051 — Lettrage manuel sur une période libre (dateMin/dateMax), indépendant de toute
        // comptabilisation : résout les clients distincts ayant des règlements dans la période (même
        // périmètre caisses/société que GetReglements) puis appelle le moteur natif Lettrer(clientNo,
        // dateMin, dateMax) pour chacun. Aucune sélection de lignes côté appelant.
        public object LettrerParPeriode(int societeId, int[] caissesList, DateTime dateMin, DateTime dateMax, bool isAdmin = false)
        {
            if (isAdmin)
            {
                using var sqlConn = new System.Data.SqlClient.SqlConnection(_dbFactory.GetConnectionString());
                caissesList = Dapper.SqlMapper.Query<int>(sqlConn, "SELECT CA_Id FROM RT_CAISSE WHERE SO_Id = @SocieteId", new { SocieteId = societeId }).ToArray();
            }

            var connProvider = new global::Tresorerie.Dapper.ConnectionProvider();
            connProvider.ConnectionString = _dbFactory.GetConnectionString();
            var repo = new global::Tresorerie.Dapper.Repositories.ReglementClientRepository(connProvider);

            // Même pattern de chunking que GetReglements/GetDistinctReglements (IN clause caisses).
            IEnumerable<ReglementClient> allReglements;
            if (caissesList.Length > 20)
            {
                var caissesChunks = caissesList.Chunk(20).ToList();
                var allTasks = caissesChunks.Select(chunk => Task.Run(() =>
                {
                    var chunkRepo = new global::Tresorerie.Dapper.Repositories.ReglementClientRepository(connProvider);
                    return chunkRepo.GetAll(societeId, dateMin, dateMax, chunk) ?? new List<ReglementClient>();
                })).ToList();

                Task.WaitAll(allTasks.ToArray());
                allReglements = allTasks.SelectMany(t => t.Result).ToList();
            }
            else
            {
                allReglements = repo.GetAll(societeId, dateMin, dateMax, caissesList) ?? new List<ReglementClient>();
            }

            var clientsNo = allReglements.Select(r => r.ClientNo).Distinct().ToList();

            var lettrage = _kernel.Resolve<global::Tresorerie.ApplicationServices.Comptabilite.Interfaces.ILettrageReglementClient>();

            // TASK-051 étape 5bis — diagnostic résidu VERIFY rejeté (clientsAvecLettrage=0 inexpliqué) :
            // GetAllExercice() est l'interface publique déjà injectée dans le moteur natif (confirmé par
            // IL, Lettrer(clientNo,dateMin,dateMax) l'appelle telle quelle) — on la réutilise en LECTURE
            // SEULE pour lister, par exercice chevauchant, les bornes intersectées avant l'appel à
            // Lettrer(). On ne recode PAS la règle de lettrage (GetNextLettre / équilibre Σdébit=Σcrédit) :
            // seule l'arithmétique triviale d'intersection (déjà documentée dans TASK-051.md) est
            // dupliquée, exclusivement à des fins de log — le résultat de cette intersection n'influence
            // jamais l'appel à Lettrer(clientNo, dateMin, dateMax), qui reste inchangé.
            var erpCompta = _kernel.Resolve<global::Tresorerie.Erp.ICore.IErpComptaService>();
            var exercicesChevauchants = erpCompta.GetAllExercice()
                .Where(e => e.Debut <= dateMax && e.Fin >= dateMin)
                .ToList();

            int clientsTraites = 0;
            int clientsAvecLettrage = 0;
            var errors = new List<string>();

            // Boucle SÉQUENTIELLE : chaque Lettrer() ouvre son propre TransactionScope(Serializable)
            // potentiellement multi-exercices — paralléliser cumulerait le risque de contention déjà
            // écarté en TASK-048 (allocation IEC_ECNO non thread-safe côté DLL), en pire (transactions
            // plus longues, multi-exercices par client).
            foreach (var clientNo in clientsNo)
            {
                clientsTraites++;
                try
                {
                    foreach (var exercice in exercicesChevauchants)
                    {
                        var dateMinReg = exercice.Debut > dateMin ? exercice.Debut : dateMin;
                        var dateMaxReg = exercice.Fin < dateMax ? exercice.Fin : dateMax;
                        _logger.LogInformation(
                            "LETTRAGE PÉRIODE DIAGNOSTIC : clientNo={ClientNo}, exercice={ExerciceNo} [{ExerciceDebut:yyyy-MM-dd}..{ExerciceFin:yyyy-MM-dd}], intersection=[{DateMinReg:yyyy-MM-dd}..{DateMaxReg:yyyy-MM-dd}]",
                            clientNo, exercice.No, exercice.Debut, exercice.Fin, dateMinReg, dateMaxReg);
                    }

                    bool lettre = lettrage.Lettrer(clientNo, dateMin, dateMax);
                    _logger.LogInformation(
                        "LETTRAGE PÉRIODE : clientNo={ClientNo}, dateMin={DateMin:yyyy-MM-dd}, dateMax={DateMax:yyyy-MM-dd}, lettré={Lettre}",
                        clientNo, dateMin, dateMax, lettre);
                    if (lettre)
                        clientsAvecLettrage++;
                }
                catch (Exception ex)
                {
                    // GetClient introuvable (client supprimé/fusionné entre-temps) ou exercice clôturé :
                    // ne doit jamais interrompre le traitement des autres clients (TASK-051, étape 4).
                    _logger.LogError(ex,
                        "LETTRAGE PÉRIODE ÉCHEC : clientNo={ClientNo} — {Message}", clientNo, ex.Message);
                    errors.Add($"Client {clientNo}: {ex.Message}");
                }
            }

            return new
            {
                success = true,
                clientsTraites,
                clientsAvecLettrage,
                errors
            };
        }

        // TASK-053 — ChargerIntitulesModes supprimée : son seul usage était le repli du libellé
        // (« mode de règlement + intitulé client »), désormais porté par la vue (mot « Versement »).

        // TASK-038 — Pièce à forcer : MV_Piece pour TOUS les types/modes présents dans la vue
        // (l'exception espèce de TASK-036 est retirée, la vue fournit désormais des pièces Sage-valides
        // partout). Repli compteur Sage (null) uniquement si le règlement est absent de la vue.
        private static string? PieceAForcer(global::Tresorerie.Core.Models.ReglementClient reg, ReglementComptaViewRow? viewRow)
            => viewRow?.MV_Piece;

        // TASK-047 — Garde de comptabilisabilité, EN AMONT de generator.Generate (point de vérité
        // UNIQUE partagé par la compta réelle `Comptabiliser` ET l'aperçu `ApercuComptabilisation`).
        // La DLL Sage déréférence sans null-check, dès l'entrée de Generate :
        //     Societe.GetCaisse(reg.CaisseOrigine).GetMode(reg.ModeReglementNo).Type
        // Or GetMode s'appuie sur SingleOrDefault : si le mode de règlement n'est PAS paramétré pour la
        // caisse (couple caisse/mode absent de P_CAISSEMODREG), GetMode renvoie null → NullReferenceException
        // opaque (cause du ticket sur le règlement 43168 : caisse 121 sans mode 18 « RELAIS »).
        // On DÉTECTE ici la cause et on lève un message métier CLAIR ; on ne FABRIQUE aucune écriture et
        // on ne contourne pas Generate. L'exception est captée par la gestion d'erreur PAR RÈGLEMENT
        // (TASK-046) : le règlement KO est remonté avec ce message, sans arrêter le lot.
        private void VerifierComptabilisable(
            global::Tresorerie.Core.Models.Societe societe,
            global::Tresorerie.Core.Models.ReglementClient reg)
        {
            var caisse = societe.GetCaisse(reg.CaisseOrigine);
            if (caisse == null)
                throw new InvalidOperationException(
                    $"Règlement non comptabilisable : la caisse n°{reg.CaisseOrigine} est introuvable ou non paramétrée.");

            var mode = caisse.GetMode(reg.ModeReglementNo);
            if (mode == null)
                throw new InvalidOperationException(
                    $"Règlement non comptabilisable : le mode de règlement n°{reg.ModeReglementNo}{DecrireModeReglement(reg.ModeReglementNo)} n'est pas paramétré pour la caisse n°{reg.CaisseOrigine} (paramétrage comptable absent).");
        }

        // TASK-067 — Enrichit le message de VerifierComptabilisable avec l'intitulé du mode de règlement
        // (ex. " (RELAIS)"), résolu via IModeReglementRepository (bindé dans TresorerieCoreDapperReplacementModule)
        // indépendamment du couple caisse/mode qui vient justement de faire défaut ci-dessus. Ne doit jamais
        // lever : cette garde protège l'appel DLL suivant d'une NullReferenceException, un échec du lookup
        // d'intitulé ne doit pas devenir une nouvelle exception non gérée — numéro seul en repli.
        private string DecrireModeReglement(int modeReglementNo)
        {
            try
            {
                var repo = _kernel.Resolve<global::Tresorerie.Core.Interfaces.IModeReglementRepository>();
                var intitule = repo.Get(modeReglementNo)?.Intitule;
                return string.IsNullOrWhiteSpace(intitule) ? string.Empty : $" ({intitule})";
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "TASK-067 : résolution de l'intitulé du mode {ModeReglementNo} échouée, numéro seul affiché.", modeReglementNo);
                return string.Empty;
            }
        }

        // TASK-036/053 — Surcharge des champs non réécrits par le comptabilizer, à partir de la vue.
        // TASK-053 : passe-plat pur. Tout le métier (espèce/hors espèce, repli « Versement »,
        // extraction du 1er document, troncature aux longueurs Sage) est porté par la vue.
        private static void AppliquerChampsVue(
            List<global::Tresorerie.Core.Models.EcritureComptable> ecritures,
            ReglementComptaViewRow viewRow)
        {
            var reference = (viewRow.ReferenceCompta ?? string.Empty).Trim();
            var libelle = (viewRow.LibelleEcriture ?? string.Empty).Trim();

            foreach (var e in ecritures)
            {
                e.Reference = reference;
                e.Libelle = libelle;
            }
        }

        // TASK-053 — DocNumero1/2 selon le mode :
        //   espèce avec facture : DocNumero1 = n° de facture, DocNumero2 = MV_Reference telle quelle.
        //     NB : en espèce, MV_Reference n'est PAS un BL (le BL est dans mv_info3, exposé par
        //     ReferenceCompta) mais une référence bancaire — ex. « B0021729-2026010909541589 ».
        //     On la relègue en zone 2 au lieu de l'écraser : aucune perte d'information.
        //     Sans risque de débordement : ces règlements n'ont qu'UN seul document, 25 car. max
        //     (vérifié en base) — la zone 2 suffit largement.
        //   sinon (espèce sans facture, et tout le hors espèce) : découpage '#' inchangé
        //     (TASK-036/039), pour ne pas écraser les BL du hors espèce.
        private static (string DocNumero1, string DocNumero2) CalculerDocNumeros(ReglementComptaViewRow viewRow)
        {
            const int MaxLen = 69;   // largeur de DocNumero1/2 dans F_ECRITUREC

            if (viewRow.MV_Type == 0)
            {
                var facture = (viewRow.FactureNumero ?? string.Empty).Trim();
                if (facture.Length > 0)
                {
                    var bl = (viewRow.MV_Reference ?? string.Empty).Trim();
                    return (Tronquer(facture, MaxLen), Tronquer(bl, MaxLen));
                }
            }

            return MvReferenceHelper.SplitDocNumeros(viewRow.MV_Reference, MaxLen);

            static string Tronquer(string s, int max) => s.Length <= max ? s : s.Substring(0, max);
        }

        // TASK-036 — DocNumero1/DocNumero2 (colonnes Sage non gérées par la DLL) : UPDATE post-compta,
        // keyé sur EcNo (= EcritureComptable.ErpNo affecté par le comptabilizer).
        private void EcrireDocNumeros(
            List<global::Tresorerie.Core.Models.EcritureComptable> ecritures,
            ReglementComptaViewRow viewRow,
            int reglementId)
        {
            var (docNumero1, docNumero2) = CalculerDocNumeros(viewRow);
            if (docNumero1.Length == 0 && docNumero2.Length == 0) return; // rien à écrire (ni facture ni référence)

            // cbMarq (PK physique de F_ECRITUREC, unique par ligne) = ErpNo affecté aux écritures par le
            // comptabilizer. NB : ErpNo n'est PAS EC_No (n° d'écriture) — vérifié en prod (ErpNo 308261/308262
            // = cbMarq ; EC_No correspondant = 292424/292425).
            var cbMarqs = ecritures.Select(e => e.ErpNo).Where(n => n > 0).Distinct().ToArray();
            if (cbMarqs.Length == 0)
                throw new InvalidOperationException(
                    $"aucun cbMarq (ErpNo) affecté aux écritures du règlement {reglementId} — DocNumero non écrits.");

            const string sql = "UPDATE GOCOM.dbo.F_ECRITUREC SET DocNumero1 = @docNumero1, DocNumero2 = @docNumero2 WHERE cbMarq IN @nos";
            using var conn = new System.Data.SqlClient.SqlConnection(_dbFactory.GetConnectionString());
            conn.Open();
            var affected = Dapper.SqlMapper.Execute(conn, sql, new { docNumero1, docNumero2, nos = cbMarqs });
            if (affected == 0)
                throw new InvalidOperationException(
                    $"UPDATE F_ECRITUREC n'a touché aucune ligne (cbMarq IN {string.Join(",", cbMarqs)}) " +
                    $"— DocNumero non écrits pour le règlement {reglementId}.");
        }

        // TASK-069 — Pré-contrôle d'autorisation caisse réutilisant HasEntityActionRestriction avec jwtUserId réel.
        private void VerifierAutorisationCaisse(
            int jwtUserId,
            int caisseNo,
            Guid actionGuid,
            Dictionary<int, bool>? cache = null)
        {
            if (cache != null && cache.TryGetValue(caisseNo, out bool isAuth))
            {
                if (!isAuth)
                {
                    _logger.LogWarning(
                        "AUTORISATION CAISSE refusée (cache) : userId={UserId} non autorisé sur la caisse n°{CaisseNo}.",
                        jwtUserId, caisseNo);
                    throw new UnauthorizedAccessException(
                        $"Vous n'êtes pas autorisé à agir sur la caisse n°{caisseNo}.");
                }
                return;
            }

            var societe = _kernel.GroupeService.SocieteManager.Societe;
            var caisse = societe?.GetCaisse(caisseNo);
            if (caisse == null)
            {
                if (cache != null) cache[caisseNo] = false;
                _logger.LogWarning(
                    "AUTORISATION CAISSE refusée : caisse n°{CaisseNo} introuvable pour userId={UserId}.",
                    caisseNo, jwtUserId);
                throw new UnauthorizedAccessException(
                    $"Caisse n°{caisseNo} introuvable ou non paramétrée.");
            }

            var authRepo = _kernel.Resolve<global::Tresorerie.Authorization.Core.Repositories.IAuthorizationRepository>();
            bool restreint = authRepo.HasEntityActionRestriction(
                jwtUserId,
                global::Tresorerie.Core.Enum.AuthorizationEntity.Reglement,
                actionGuid,
                new List<global::Tresorerie.Core.Models.Caisse> { caisse },
                global::Tresorerie.Core.Enum.ProfilType.Grc);

            if (cache != null) cache[caisseNo] = !restreint;

            if (restreint)
            {
                _logger.LogWarning(
                    "AUTORISATION CAISSE refusée : userId={UserId} non autorisé sur la caisse n°{CaisseNo} (action {ActionGuid}).",
                    jwtUserId, caisseNo, actionGuid);
                throw new UnauthorizedAccessException(
                    $"Vous n'êtes pas autorisé à agir sur la caisse n°{caisseNo}.");
            }
        }

        // TASK-085/086 (Étape 1) — Garde commune non-comptabilisé / non-affecté / non-annulé.
        // Partagée entre l'annulation (TASK-085) et la modification (TASK-086).
        private void ValiderGardeCommune(global::Tresorerie.Core.Models.ReglementClient reg, string operation)
        {
            if (reg.IsAnnule)
            {
                _logger.LogWarning("GARDE COMMUNE refusée (déjà annulé) : reglementNo={ReglementNo}", reg.No);
                throw new InvalidOperationException($"Le règlement [{reg.Numero}] est déjà annulé et ne peut pas être {operation}.");
            }

            if (reg.IsComptabilise != 0)
            {
                _logger.LogWarning("GARDE COMMUNE refusée (comptabilisé) : reglementNo={ReglementNo}, isComptabilise={IsComptabilise}", reg.No, reg.IsComptabilise);
                throw new InvalidOperationException($"Le règlement [{reg.Numero}] est déjà comptabilisé et ne peut pas être {operation}.");
            }

            if (reg.GetAffectations().Any())
            {
                _logger.LogWarning("GARDE COMMUNE refusée (affecté) : reglementNo={ReglementNo}", reg.No);
                throw new InvalidOperationException($"Le règlement [{reg.Numero}] est affecté et ne peut pas être {operation}.");
            }
        }

        // TASK-085 — Annulation de règlement via l'appel natif CaisseManager.ReglementClientAnnuler.
        // Pré-contrôles : autorisation caisse (ReglementAnnuler) + garde commune applicative.
        // Aucun bypass DLL ni UPDATE SQL direct.
        public void AnnulerReglement(int reglementNo, int jwtUserId, bool isAdmin)
        {
            var connProvider = new global::Tresorerie.Dapper.ConnectionProvider();
            connProvider.ConnectionString = _dbFactory.GetConnectionString();
            var repo = new global::Tresorerie.Dapper.Repositories.ReglementClientRepository(connProvider);

            var reg = repo.Get(reglementNo);
            if (reg == null)
            {
                _logger.LogWarning("ANNULATION RÈGLEMENT introuvable : reglementNo={ReglementNo}", reglementNo);
                throw new ApplicationException($"Impossible de charger le règlement [{reglementNo}].");
            }

            // TASK-085 (Étape 2) — Pré-contrôle d'autorisation caisse sur l'action ReglementAnnuler
            if (!isAdmin)
            {
                var actionGuid = new global::Tresorerie.Authorization.Core.Actions.ReglementAnnuler().Guid;
                VerifierAutorisationCaisse(jwtUserId, reg.CaisseOrigine, actionGuid);
            }

            // TASK-085 (Étape 1) — Garde commune non-comptabilisé / non-affecté / non-annulé
            ValiderGardeCommune(reg, "annulé");

            // TASK-085 (Étape 3) — Résolution et appel natif DLL de CaisseManager.ReglementClientAnnuler
            var caisseManager = _kernel.Resolve<global::Tresorerie.Core.Services.CaisseManager>();
            caisseManager.SocieteManager = _kernel.GroupeService.SocieteManager;
            caisseManager.ReglementClientAnnuler(reglementNo);

            _logger.LogInformation("ANNULATION RÈGLEMENT succès DLL : reglementNo={ReglementNo}, userId={UserId}", reglementNo, jwtUserId);
        }

        // TASK-086 — Modification de règlement (Date, Client, Montant, Banque, Référence) + historique.
        // Garde commune non-comptabilisé/non-affecté/non-annulé, voie DLL native ReglementUpdate pour Date/Montant/Banque/Référence,
        // dérogation réflexion actée par le PO pour le champ Client, historisation systématique 1 ligne/modification.
        public ReglementModificationResult ModifierReglement(int reglementNo, ReglementModificationDto dto, int jwtUserId, bool isAdmin, string? jwtUserName = null)
        {
            if (dto == null) throw new ArgumentNullException(nameof(dto));

            var connProvider = new global::Tresorerie.Dapper.ConnectionProvider();
            connProvider.ConnectionString = _dbFactory.GetConnectionString();
            var repo = new global::Tresorerie.Dapper.Repositories.ReglementClientRepository(connProvider);

            var reg = repo.Get(reglementNo);
            if (reg == null)
            {
                _logger.LogWarning("MODIFICATION RÈGLEMENT introuvable : reglementNo={ReglementNo}", reglementNo);
                throw new ApplicationException($"Impossible de charger le règlement [{reglementNo}].");
            }

            // TASK-086 (Étape 7) — Contrôle d'autorisation caisse sur l'action ReglementModifier
            if (!isAdmin)
            {
                var actionGuid = new global::Tresorerie.Authorization.Core.Actions.ReglementModifier().Guid;
                VerifierAutorisationCaisse(jwtUserId, reg.CaisseOrigine, actionGuid);
            }

            // TASK-086 (Étape 1) — Garde commune non-comptabilisé / non-affecté / non-annulé
            ValiderGardeCommune(reg, "modifié");

            // TASK-086 (Étape 2) — Comparaison des 5 champs pour détecter les modifications réelles
            bool dateChanged = dto.Date.HasValue && dto.Date.Value.Date != reg.Date.Date;
            bool montantChanged = dto.Montant.HasValue && dto.Montant.Value != reg.Montant;
            bool banqueChanged = dto.BanqueNo.HasValue && dto.BanqueNo.Value != (reg.BanqueNo ?? 0);
            bool referenceChanged = dto.Reference != null && dto.Reference.Trim() != (reg.Reference ?? string.Empty).Trim();
            bool clientChanged = (dto.ClientNo.HasValue && dto.ClientNo.Value != reg.ClientNo)
                              || (!string.IsNullOrEmpty(dto.ClientCode) && dto.ClientCode.Trim() != (reg.ClientCode ?? string.Empty).Trim());

            if (!dateChanged && !montantChanged && !banqueChanged && !referenceChanged && !clientChanged)
            {
                _logger.LogInformation("MODIFICATION RÈGLEMENT sans changement : reglementNo={ReglementNo}", reglementNo);
                return new ReglementModificationResult { Success = true, Modified = false, Message = "Aucune modification détectée." };
            }

            // Capture des valeurs AVANT modification
            var ancienDate = reg.Date;
            var ancienMontant = reg.Montant;
            var ancienBanqueNo = reg.BanqueNo;
            var ancienReference = reg.Reference;
            var ancienClientNo = reg.ClientNo;
            var ancienClientCode = reg.ClientCode;
            var ancienClientIntitule = reg.ClientIntitule;

            var champsModifies = new List<string>();
            if (dateChanged) champsModifies.Add("Date");
            if (montantChanged) champsModifies.Add("Montant");
            if (banqueChanged) champsModifies.Add("Banque");
            if (referenceChanged) champsModifies.Add("Référence");
            if (clientChanged) champsModifies.Add("Client");

            // TASK-086 (Étape 3 & 4bis) : Ordre d'exécution — ReglementUpdate DLL d'abord pour Date/Montant/Banque/Référence
            bool dllFieldsChanged = dateChanged || montantChanged || banqueChanged || referenceChanged;
            if (dllFieldsChanged)
            {
                var caisseManager = _kernel.Resolve<global::Tresorerie.Core.Services.CaisseManager>();
                caisseManager.SocieteManager = _kernel.GroupeService.SocieteManager;

                DateTime targetDate = dateChanged ? dto.Date!.Value.Date : reg.Date;
                decimal targetMontant = montantChanged ? dto.Montant!.Value : reg.Montant;
                int? targetBanqueNo = banqueChanged ? dto.BanqueNo : reg.BanqueNo;
                string targetReference = referenceChanged ? dto.Reference!.Trim() : (reg.Reference ?? string.Empty);

                // Appel unitaire à CaisseManager.ReglementUpdate (23 paramètres, tous les paramètres hors périmètre PO
                // préservés tels quels depuis l'entité chargée pour éviter tout écrasement accidentel).
                caisseManager.ReglementUpdate(
                    reglementNo: reg.No,
                    date: targetDate,
                    montantDevise: targetMontant,
                    libelle: reg.Libelle ?? string.Empty,
                    piece: reg.PieceNumero ?? string.Empty,
                    banqueClient: reg.BanqueTier ?? string.Empty,
                    echeance: reg.DateEcheance,
                    tire: reg.Tire ?? string.Empty,
                    banqueNo: targetBanqueNo,
                    deviseNo: reg.DeviseNo,
                    coursDevise: reg.DeviseCours,
                    affaireNumero: reg.AffaireNumero ?? string.Empty,
                    ribClient: reg.RibClient ?? string.Empty,
                    infoLibre1: reg.Info1 ?? string.Empty,
                    infoLibre2: reg.Info2 ?? string.Empty,
                    infoLibre3: reg.Info3 ?? string.Empty,
                    infoLibre4: reg.Info4 ?? string.Empty,
                    reference: targetReference,
                    collaborateurNo: reg.CollaborateurNo,
                    isCertifier: reg.IsCertifier,
                    dateValidite: reg.DateValiditer,
                    montantPlafond: reg.MontantPlafond,
                    reglementNature: reg.ReglementNature
                );

                _logger.LogInformation(
                    "MODIFICATION RÈGLEMENT succès DLL (ReglementUpdate) : reglementNo={ReglementNo}, champs={Champs}",
                    reglementNo, string.Join(",", champsModifies.Where(c => c != "Client")));
            }

            // TASK-086 (Étape 3 & 4bis) : Champ Client via dérogation réflexion PO (après ReglementUpdate)
            if (clientChanged)
            {
                // Rechargement obligatoire d'une nouvelle instance fraîche depuis le repository pour garantir
                // que GetAffectations() (Lazy) est réinterrogé en base réelle et ne renvoie pas la valeur en cache
                var regFresh = repo.Get(reglementNo);
                if (regFresh == null)
                {
                    throw new ApplicationException($"Impossible de recharger le règlement [{reglementNo}] après modification DLL.");
                }

                // Revalidation stricte de la garde commune juste avant l'écriture réflexion
                ValiderGardeCommune(regFresh, "modifié");

                // Application de la dérogation réflexion sur les 3 setters privés
                ForcerClientReglement(
                    repo,
                    regFresh,
                    dto.ClientNo!.Value,
                    dto.ClientCode ?? string.Empty,
                    dto.ClientIntitule ?? string.Empty
                );
            }

            // TASK-086 (Étape 2 & 4) : Historisation immédiate (1 ligne pour la modification globale)
            var modifsDict = new Dictionary<string, object?>();
            if (dateChanged) modifsDict["Date"] = new { Avant = ancienDate.ToString("yyyy-MM-dd"), Apres = dto.Date!.Value.ToString("yyyy-MM-dd") };
            if (montantChanged) modifsDict["Montant"] = new { Avant = ancienMontant, Apres = dto.Montant!.Value };
            if (banqueChanged) modifsDict["BanqueNo"] = new { Avant = ancienBanqueNo, Apres = dto.BanqueNo };
            if (referenceChanged) modifsDict["Reference"] = new { Avant = ancienReference, Apres = dto.Reference };
            if (clientChanged) modifsDict["Client"] = new {
                Avant = new { No = ancienClientNo, Code = ancienClientCode, Intitule = ancienClientIntitule },
                Apres = new { No = dto.ClientNo, Code = dto.ClientCode, Intitule = dto.ClientIntitule }
            };

            string jsonModifs = System.Text.Json.JsonSerializer.Serialize(modifsDict);

            InsererHistoriqueModification(
                reglementNo: reg.No,
                userId: jwtUserId,
                userName: jwtUserName,
                champsModifies: string.Join(", ", champsModifies),
                ancienneDate: dateChanged ? ancienDate : null,
                nouvelleDate: dateChanged ? dto.Date!.Value.Date : null,
                ancienClientNo: clientChanged ? ancienClientNo : null,
                nouveauClientNo: clientChanged ? dto.ClientNo : null,
                ancienClientCode: clientChanged ? ancienClientCode : null,
                nouveauClientCode: clientChanged ? dto.ClientCode : null,
                ancienClientIntitule: clientChanged ? ancienClientIntitule : null,
                nouveauClientIntitule: clientChanged ? dto.ClientIntitule : null,
                ancienMontant: montantChanged ? ancienMontant : null,
                nouveauMontant: montantChanged ? dto.Montant : null,
                ancienneBanqueNo: banqueChanged ? ancienBanqueNo : null,
                nouvelleBanqueNo: banqueChanged ? dto.BanqueNo : null,
                ancienneReference: referenceChanged ? ancienReference : null,
                nouvelleReference: referenceChanged ? dto.Reference : null,
                modificationsJson: jsonModifs
            );

            return new ReglementModificationResult {
                Success = true,
                Modified = true,
                ChampsModifies = champsModifies,
                Message = $"Règlement {reg.Numero ?? reglementNo.ToString()} modifié avec succès ({string.Join(", ", champsModifies)})."
            };
        }

        /// <summary>
        /// TASK-086 : Dérogation DLL actée par le PO (réunion 2026-09-28).
        /// Met à jour le client du règlement par réflexion sur les 3 setters privés (ClientNo, ClientCode, ClientIntitule).
        /// Condition stricte : le règlement doit être non comptabilisé, non affecté, non annulé (validé immédiatement avant).
        /// </summary>
        private void ForcerClientReglement(
            global::Tresorerie.Dapper.Repositories.ReglementClientRepository repo,
            global::Tresorerie.Core.Models.ReglementClient reg,
            int clientNo,
            string clientCode,
            string clientIntitule)
        {
            var type = typeof(global::Tresorerie.Core.Models.ReglementClient);
            type.GetProperty("ClientNo", BindingFlags.Public | BindingFlags.Instance)?.SetValue(reg, clientNo);
            type.GetProperty("ClientCode", BindingFlags.Public | BindingFlags.Instance)?.SetValue(reg, clientCode);
            type.GetProperty("ClientIntitule", BindingFlags.Public | BindingFlags.Instance)?.SetValue(reg, clientIntitule);
            repo.Update(reg);
            _logger.LogInformation(
                "MODIFICATION CLIENT (dérogation réflexion PO) : reglementNo={ReglementNo}, clientNo={ClientNo}, code={ClientCode}",
                reg.No, clientNo, clientCode);
        }

        private void InsererHistoriqueModification(
            int reglementNo,
            int userId,
            string? userName,
            string champsModifies,
            DateTime? ancienneDate,
            DateTime? nouvelleDate,
            int? ancienClientNo,
            int? nouveauClientNo,
            string? ancienClientCode,
            string? nouveauClientCode,
            string? ancienClientIntitule,
            string? nouveauClientIntitule,
            decimal? ancienMontant,
            decimal? nouveauMontant,
            int? ancienneBanqueNo,
            int? nouvelleBanqueNo,
            string? ancienneReference,
            string? nouvelleReference,
            string? modificationsJson)
        {
            try
            {
                using var conn = new System.Data.SqlClient.SqlConnection(_dbFactory.GetConnectionString());
                conn.Open();

                if (string.IsNullOrWhiteSpace(userName))
                {
                    userName = Dapper.SqlMapper.QueryFirstOrDefault<string>(
                        conn,
                        "SELECT COALESCE(NULLIF(LTRIM(RTRIM(ISNULL(UT_Nom, '') + ' ' + ISNULL(UT_Prenom, ''))), ''), UT_Login) FROM dbo.P_UTILISATEUR WHERE UT_Id = @UserId",
                        new { UserId = userId }
                    ) ?? $"User #{userId}";
                }

                const string sql = @"
                    INSERT INTO dbo.GRC_ReglementModificationHistorique (
                        ReglementNo, UserId, UserName, DateModification, ChampsModifies,
                        AncienneDate, NouvelleDate,
                        AncienClientNo, NouveauClientNo, AncienClientCode, NouveauClientCode, AncienClientIntitule, NouveauClientIntitule,
                        AncienMontant, NouveauMontant,
                        AncienneBanqueNo, NouvelleBanqueNo,
                        AncienneReference, NouvelleReference,
                        ModificationsJson
                    ) VALUES (
                        @ReglementNo, @UserId, @UserName, GETDATE(), @ChampsModifies,
                        @AncienneDate, @NouvelleDate,
                        @AncienClientNo, @NouveauClientNo, @AncienClientCode, @NouveauClientCode, @AncienClientIntitule, @NouveauClientIntitule,
                        @AncienMontant, @NouveauMontant,
                        @AncienneBanqueNo, @NouvelleBanqueNo,
                        @AncienneReference, @NouvelleReference,
                        @ModificationsJson
                    );";

                Dapper.SqlMapper.Execute(conn, sql, new {
                    ReglementNo = reglementNo,
                    UserId = userId,
                    UserName = userName,
                    ChampsModifies = champsModifies,
                    AncienneDate = ancienneDate,
                    NouvelleDate = nouvelleDate,
                    AncienClientNo = ancienClientNo,
                    NouveauClientNo = nouveauClientNo,
                    AncienClientCode = ancienClientCode,
                    NouveauClientCode = nouveauClientCode,
                    AncienClientIntitule = ancienClientIntitule,
                    NouveauClientIntitule = nouveauClientIntitule,
                    AncienMontant = ancienMontant,
                    NouveauMontant = nouveauMontant,
                    AncienneBanqueNo = ancienneBanqueNo,
                    NouvelleBanqueNo = nouvelleBanqueNo,
                    AncienneReference = ancienneReference,
                    NouvelleReference = nouvelleReference,
                    ModificationsJson = modificationsJson
                });

                _logger.LogInformation("HISTORIQUE MODIFICATION RÈGLEMENT inséré : reglementNo={ReglementNo}, user={UserName}", reglementNo, userName);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "ÉCHEC CRITIQUE INSERTION HISTORIQUE : reglementNo={ReglementNo}, userId={UserId}", reglementNo, userId);
            }
        }

        // TASK-086 (Étape 8) — Consultation de l'historique des modifications d'un règlement.
        // Protégée par l'action ReglementModifier, non conditionnée à la garde commune (traçabilité permanente).
        public List<ReglementModificationHistoriqueDto> GetHistoriqueModifications(int reglementNo, int jwtUserId, bool isAdmin)
        {
            var connProvider = new global::Tresorerie.Dapper.ConnectionProvider();
            connProvider.ConnectionString = _dbFactory.GetConnectionString();
            var repo = new global::Tresorerie.Dapper.Repositories.ReglementClientRepository(connProvider);

            var reg = repo.Get(reglementNo);
            if (reg == null)
            {
                _logger.LogWarning("CONSULTATION HISTORIQUE introuvable : reglementNo={ReglementNo}", reglementNo);
                throw new ApplicationException($"Impossible de charger le règlement [{reglementNo}].");
            }

            if (!isAdmin)
            {
                var actionGuid = new global::Tresorerie.Authorization.Core.Actions.ReglementModifier().Guid;
                VerifierAutorisationCaisse(jwtUserId, reg.CaisseOrigine, actionGuid);
            }

            using var conn = new System.Data.SqlClient.SqlConnection(_dbFactory.GetConnectionString());
            const string sql = @"
                SELECT 
                    h.Id,
                    h.ReglementNo,
                    h.UserId,
                    COALESCE(h.UserName, u.UT_Nom + ' ' + u.UT_Prenom, u.UT_Login, 'User #' + CAST(h.UserId AS VARCHAR)) AS UserName,
                    h.DateModification,
                    h.ChampsModifies,
                    h.AncienneDate,
                    h.NouvelleDate,
                    h.AncienClientNo,
                    h.NouveauClientNo,
                    h.AncienClientCode,
                    h.NouveauClientCode,
                    h.AncienClientIntitule,
                    h.NouveauClientIntitule,
                    h.AncienMontant,
                    h.NouveauMontant,
                    h.AncienneBanqueNo,
                    h.NouvelleBanqueNo,
                    h.AncienneReference,
                    h.NouvelleReference,
                    h.ModificationsJson
                FROM dbo.GRC_ReglementModificationHistorique h
                LEFT JOIN dbo.P_UTILISATEUR u ON u.UT_Id = h.UserId
                WHERE h.ReglementNo = @ReglementNo
                ORDER BY h.DateModification DESC, h.Id DESC";

            return Dapper.SqlMapper.Query<ReglementModificationHistoriqueDto>(conn, sql, new { ReglementNo = reglementNo }).ToList();
        }

        public object RapprocherManuel(List<RapprochementManuelDto> items, int jwtUserId, bool isAdmin)
        {
            var connProvider = new global::Tresorerie.Dapper.ConnectionProvider();
            connProvider.ConnectionString = _dbFactory.GetConnectionString();
            var repo = new global::Tresorerie.Dapper.Repositories.ReglementClientRepository(connProvider);

            if (items == null || items.Count == 0)
                return new { success = true, successCount = 0, errorCount = 0, errors = new List<string>() };

            // TASK-069 — Pré-contrôle d'autorisation caisse sur chaque règlement à pointer.
            if (!isAdmin)
            {
                var actionGuid = new global::Tresorerie.Authorization.Core.Actions.ReglementModifier().Guid;
                var cacheCaisses = new Dictionary<int, bool>();
                foreach (var item in items)
                {
                    var reg = repo.Get(item.ReglementId);
                    if (reg == null) continue;
                    VerifierAutorisationCaisse(jwtUserId, reg.CaisseOrigine, actionGuid, cacheCaisses);
                }
            }

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

        public object ApercuComptabilisation(List<int> reglementIds, int jwtUserId, bool isAdmin)
        {
            if (reglementIds == null || reglementIds.Count == 0)
                return Array.Empty<object>();

            // TASK-069 — Pré-contrôle d'autorisation caisse : évite la fuite de lecture comptable
            // pour des règlements hors périmètre de l'utilisateur web.
            if (!isAdmin)
            {
                var actionGuid = new global::Tresorerie.Authorization.Core.Actions.ReglementComptabiliser().Guid;
                var cacheCaisses = new Dictionary<int, bool>();
                var connProvAuth = new global::Tresorerie.Dapper.ConnectionProvider { ConnectionString = _dbFactory.GetConnectionString() };
                var repoAuth = new global::Tresorerie.Dapper.Repositories.ReglementClientRepository(connProvAuth);

                foreach (var id in reglementIds)
                {
                    var reg = repoAuth.Get(id);
                    if (reg == null) continue;
                    VerifierAutorisationCaisse(jwtUserId, reg.CaisseOrigine, actionGuid, cacheCaisses);
                }
            }

            var connProvider = new global::Tresorerie.Dapper.ConnectionProvider();
            connProvider.ConnectionString = _dbFactory.GetConnectionString();
            var generator = _kernel.Resolve<global::Tresorerie.ApplicationServices.Comptabilite.Interfaces.IEcritureComptableGenerator<global::Tresorerie.Core.Models.ReglementClient>>();

            // TASK-036 : l'aperçu doit refléter les mêmes valeurs que la compta réelle (pièce, référence,
            // libellé, DocNumero, date) pour éviter tout écart aperçu ≠ réel.
            // Lecture seule partagée, chargée UNE fois avant la boucle (pas de duplication par thread).
            var viewRows = new ReglementComptaViewRepository(_dbFactory).GetByMvIds(reglementIds);

            // TASK-047 — Société chargée UNE fois (lecture seule) : même garde de comptabilisabilité que
            // la compta réelle (VerifierComptabilisable), pour que l'aperçu et le réel restent cohérents.
            var societe = _kernel.GroupeService.SocieteManager.Societe;

            // TASK-046 : aperçu parallélisé (degré 10) comme la compta réelle `Comptabiliser`.
            // L'aperçu est en LECTURE SEULE (aucune écriture base) : le seul levier de la lenteur
            // (~20 ms/règlt × N en séquentiel) est la parallélisation. Résultat fonctionnel inchangé.
            // Ordre de sortie préservé à l'identique via un tableau indexé sur la position d'entrée
            // (les entrées ignorées — introuvable ou déjà comptabilisé — restent null puis filtrées).
            var results = new object[reglementIds.Count];
            var options = new ParallelOptions { MaxDegreeOfParallelism = 10 };

            Parallel.For(0, reglementIds.Count, options, i =>
            {
                var id = reglementIds[i];

                // Connexion + repo créés PAR THREAD (ReglementClientRepository / ConnectionProvider
                // ne sont pas thread-safe — même règle que Comptabiliser l.316-318).
                var connProvThread = new global::Tresorerie.Dapper.ConnectionProvider();
                connProvThread.ConnectionString = _dbFactory.GetConnectionString();
                var repoThread = new global::Tresorerie.Dapper.Repositories.ReglementClientRepository(connProvThread);

                global::Tresorerie.Core.Models.ReglementClient? reg = null;
                try
                {
                    reg = repoThread.Get(id);
                    if (reg == null || reg.IsComptabilise != 0)
                        return;

                    // TASK-047 — Garde AVANT Generate : convertit le NRE opaque de la DLL en message métier
                    // clair, capté ci-dessous par la gestion d'erreur PAR RÈGLEMENT (TASK-046).
                    VerifierComptabilisable(societe, reg);

                    viewRows.TryGetValue(reg.No, out var viewRow);

                    // ForcedPiece (AsyncLocal) posé ET nettoyé DANS l'itération (délégué synchrone,
                    // finally interne) — jamais hissé hors de la boucle.
                    ComptaPieceContext.ForcedPiece = PieceAForcer(reg, viewRow);
                    _logger.LogInformation(
                        "APERÇU COMPTA écriture : reglementId={ReglementId}, pièceForcée={PieceForcee}, date={Date:yyyy-MM-dd}, montant={Montant}, mode={ModeNo}",
                        id, ComptaPieceContext.ForcedPiece, reg.Date, reg.MontantDeviseSociete, reg.ModeReglementNo);
                    List<global::Tresorerie.Core.Models.EcritureComptable> ecritures;
                    try
                    {
                        ecritures = generator.Generate(reg, reg.Date, null).ToList();
                        if (viewRow != null)
                            AppliquerChampsVue(ecritures, viewRow);
                    }
                    finally
                    {
                        ComptaPieceContext.ForcedPiece = null;
                    }

                    var (docNumero1, docNumero2) = viewRow != null
                        ? CalculerDocNumeros(viewRow)
                        : (string.Empty, string.Empty);

                    // Mapping vers un DTO lisible : les objets EcritureComptable bruts
                    // ne sont pas exploitables tels quels côté front (noms de champs, enum Sens).
                    var ecrituresDto = ecritures.Select(e => new EcritureApercuDto
                    {
                        CompteGeneral = e.CompteGeneral,
                        ContrePartieCompteG = e.ContrePartieCompteG,
                        TiersNumero = e.TiersNumero,
                        CodeJournal = e.CodeJournal,
                        Libelle = e.Libelle,
                        Reference = e.Reference,
                        Sens = (int)e.Sens,               // 0 = Débit, 1 = Crédit
                        MontantDebit = e.MontantDebit,
                        MontantCredit = e.MontantCredit,
                        Date = e.Date,
                        Echeance = e.Echeance,
                        NumeroPiece = e.NumeroPiece,
                        DocNumero1 = docNumero1,
                        DocNumero2 = docNumero2
                    }).ToList();

                    results[i] = new {
                        ReglementId = id,
                        ReglementNumero = reg.Numero,
                        Client = reg.ClientIntitule,
                        Montant = reg.MontantDeviseSociete,
                        Ecritures = ecrituresDto,
                        HasError = false,
                        Erreur = (string?)null
                    };
                }
                catch (Exception ex)
                {
                    // Gestion d'erreur PAR RÈGLEMENT : une ligne KO n'arrête pas le lot.
                    _logger.LogError(ex,
                        "APERÇU COMPTA ÉCHEC : reglementId={ReglementId} — erreur DLL Sage : {Message}", id, ex.Message);
                    results[i] = new {
                        ReglementId = id,
                        ReglementNumero = reg?.Numero,
                        Client = reg?.ClientIntitule,
                        Montant = reg?.MontantDeviseSociete ?? 0m,
                        Ecritures = new List<EcritureApercuDto>(),
                        HasError = true,
                        Erreur = ex.Message
                    };
                }
            });

            // Ordre d'entrée conservé ; les positions ignorées (null) sont retirées.
            return results.Where(r => r != null).ToList();
        }
    }

    // Aperçu de comptabilisation : projection lisible d'une écriture comptable (partie double)
    public class EcritureApercuDto
    {
        public string? CompteGeneral { get; set; }
        public string? ContrePartieCompteG { get; set; }
        public string? TiersNumero { get; set; }
        public string? CodeJournal { get; set; }
        public string? Libelle { get; set; }        // vue.LibelleEcriture : espèce « ESP <facture> » ; hors espèce libellé saisi ou « Versement » (TASK-053)
        public string? Reference { get; set; }       // vue.ReferenceCompta : espèce mv_info3 (BL) ; hors espèce mv_reference (TASK-053)
        public int Sens { get; set; }               // 0 = Débit, 1 = Crédit
        public decimal MontantDebit { get; set; }
        public decimal MontantCredit { get; set; }
        public DateTime Date { get; set; }          // date comptable = MV_Date (date opération)
        public DateTime Echeance { get; set; }
        public string? NumeroPiece { get; set; }    // MV_Piece pour tous les types/modes présents dans la vue, y compris espèce ; compteur Sage seulement si absent de la vue (TASK-038)
        public string? DocNumero1 { get; set; }      // espèce : n° de facture ; sinon MV_Reference découpé au # (TASK-053)
        public string? DocNumero2 { get; set; }      // espèce : le BL ; sinon suite du découpage # (TASK-053)
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
        public int ClientNo { get; set; }
        public string? ClientCode { get; set; }
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
        public bool IsAffecte { get; set; }
        
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

    // TASK-086 — DTO pour la modification d'un règlement existant
    public class ReglementModificationDto
    {
        public DateTime? Date { get; set; }
        public decimal? Montant { get; set; }
        public int? BanqueNo { get; set; }
        public string? Reference { get; set; }
        public int? ClientNo { get; set; }
        public string? ClientCode { get; set; }
        public string? ClientIntitule { get; set; }
    }

    // TASK-086 — Résultat typé pour l'opération de modification
    public class ReglementModificationResult
    {
        public bool Success { get; set; }
        public bool Modified { get; set; }
        public List<string> ChampsModifies { get; set; } = new();
        public string Message { get; set; } = string.Empty;
    }

    // TASK-086 — DTO pour la consultation de l'historique des modifications
    public class ReglementModificationHistoriqueDto
    {
        public int Id { get; set; }
        public int ReglementNo { get; set; }
        public int UserId { get; set; }
        public string? UserName { get; set; }
        public DateTime DateModification { get; set; }
        public string ChampsModifies { get; set; } = string.Empty;
        public DateTime? AncienneDate { get; set; }
        public DateTime? NouvelleDate { get; set; }
        public int? AncienClientNo { get; set; }
        public int? NouveauClientNo { get; set; }
        public string? AncienClientCode { get; set; }
        public string? NouveauClientCode { get; set; }
        public string? AncienClientIntitule { get; set; }
        public string? NouveauClientIntitule { get; set; }
        public decimal? AncienMontant { get; set; }
        public decimal? NouveauMontant { get; set; }
        public int? AncienneBanqueNo { get; set; }
        public int? NouvelleBanqueNo { get; set; }
        public string? AncienneReference { get; set; }
        public string? NouvelleReference { get; set; }
        public string? ModificationsJson { get; set; }
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
