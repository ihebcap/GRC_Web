using System;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.Linq;
using Dapper;
using GRC.Application.Interfaces;
using GRC.Infrastructure.Tresorerie;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using GRC.Infrastructure.Repositories;

namespace GRC.Infrastructure.Services
{
    // TASK-059 — Génération interactive de règlements client espèce, affectation intégrale sur des
    // factures déjà dans l'échéancier (RT_ECHEANCE). Appelle DIRECTEMENT
    // Tresorerie.Core.Services.CaisseManager.ReglementCreate (36 paramètres), en court-circuitant
    // ImporterReglements/ReglementClientCoffreCreate/Verify() — motif : MV_Info3 (numéro de facture)
    // est structurellement inatteignable via ce pipeline (hardcodé String.Empty en natif), cf.
    // tasks/TASK-059.md. Ce service reproduit lui-même les résolutions/contrôles que Verify() assurait :
    // client (TiersErpHelper par échéance), caisse + compatibilité mode (Societe.GetCaisse/Caisse.HasModeReglement),
    // devise société (DeviseViewHelper). Zéro logique métier de ReglementCreate réécrite.
    public class ReglementGenerationService
    {
        private readonly IDbConnectionFactory _dbFactory;
        private readonly TresorerieNinjectKernel _kernel;
        private readonly ReleveBancaireRepository _releveRepository;
        private readonly ILogger<ReglementGenerationService> _logger;
        private readonly IMemoryCache _cache;

        // Durée de vie du cache clients ERP : évite de relancer GetAll() à chaque requête.
        // 10 minutes : raisonnable pour une liste de clients (données stables) sans consommer
        // indéfiniment la mémoire. Ajustable via la constante si nécessaire.
        private static readonly TimeSpan ClientsCacheTtl = TimeSpan.FromMinutes(10);
        private const string ClientsCacheKey = "ReglementGenerationService_Clients";

        public ReglementGenerationService(
            IDbConnectionFactory dbFactory,
            TresorerieNinjectKernel kernel,
            ReleveBancaireRepository releveRepository,
            ILogger<ReglementGenerationService> logger,
            IMemoryCache cache)
        {
            _dbFactory = dbFactory;
            _kernel = kernel;
            _releveRepository = releveRepository;
            _logger = logger;
            _cache = cache;
        }

        // Lecture de TOUTES les factures ouvertes (non soldées, Solde > 0) de la société, tous clients confondus,
        // uniquement celles déjà connues de RT_ECHEANCE (périmètre v1 acté avec le PO).
        public List<EcheanceARegleDto> GetFacturesARegler(int societeId)
        {
            var echeanceRepo = _kernel.Resolve<global::Tresorerie.Core.Interfaces.IEcheanceRepository>();
            var echeances = echeanceRepo.GetAll(
                global::Tresorerie.Core.Enum.ErpDomaine.Vente,
                societeId,
                nonPaye: false,
                onlySpe: false,
                dateDebut: null,
                dateFin: null);

            var collabHelper = _kernel.Resolve<global::Tresorerie.UICommun.Helper.CollaborateurHelper>();

            return (echeances ?? Enumerable.Empty<global::Tresorerie.Core.Models.Echeance>())
                .Where(e => e.Solde > 0)
                .Select(e =>
                {
                    string representant = string.Empty;
                    try
                    {
                        if (e.CollaborateurNo > 0)
                        {
                            var collab = collabHelper.Get(e.CollaborateurNo);
                            if (collab != null)
                                representant = $"{collab.Nom} {collab.Prenom}".Trim();
                        }
                    }
                    catch { /* fallback en cas d'erreur de résolution collaborateur */ }

                    return new EcheanceARegleDto
                    {
                        EcheanceNo = e.No,
                        ClientCode = e.ClientCode ?? string.Empty,
                        ClientIntitule = e.ClientIntitule ?? string.Empty,
                        FactureNumero = e.DocumentNumero ?? string.Empty,
                        DateFacture = e.DocumentDate,
                        DateEcheance = e.Date,
                        Commentaire = e.Commentaire ?? string.Empty,
                        Montant = e.Montant,
                        Solde = e.Solde,
                        Info1 = e.Info1 ?? string.Empty,
                        Info2 = e.Info2 ?? string.Empty,
                        Info3 = e.Info3 ?? string.Empty,
                        Info4 = e.Info4 ?? string.Empty,
                        Representant = representant
                    };
                })
                .OrderBy(e => e.ClientIntitule)
                .ThenBy(e => e.DateEcheance)
                .ToList();
        }

        // Orchestration principale : pré-contrôle droits de caisse (utilisateur JWT réel, PAS
        // l'utilisateur technique du kernel) → résolutions caisse/devise (une fois) → boucle
        // par facture cochée → résolution du client par échéance → 1 appel ReglementCreate PAR facture (jamais de split, cf. TASK-050).
        public List<ReglementEspeceItemResultDto> GenererReglementsEspece(
            int jwtUserId,
            int societeId,
            string caisseCode,
            List<int> echeanceNos,
            bool isAdmin)
        {
            var societe = _kernel.GroupeService.SocieteManager.Societe;

            var caisse = societe.GetCaisse(caisseCode);
            if (caisse == null)
                throw new InvalidOperationException($"Caisse introuvable : {caisseCode}");

            // Pré-contrôle d'autorisation — AVANT toute résolution client/devise et toute création.
            // HasEntityActionRestriction prend le userNo EXPLICITEMENT : on lui passe le UserId du JWT
            // (utilisateur web réel), jamais l'utilisateur technique authentifié une fois au démarrage
            // du kernel (Tresorerie:UserGR) — c'est tout l'enjeu de ce contrôle (cf. TASK-054/059).
            // isAdmin reproduit le court-circuit natif d'AuthorizationService.HasRestriction
            // (« si Utilisateur.IsAdmin → aucune restriction appliquée »), ancré ici sur le VRAI
            // utilisateur (JWT) plutôt que sur l'utilisateur technique du kernel.
            if (!isAdmin)
            {
                var authRepo = _kernel.Resolve<global::Tresorerie.Authorization.Core.Repositories.IAuthorizationRepository>();
                var actionGuid = new global::Tresorerie.Authorization.Core.Actions.ReglementGenerer().Guid;
                bool restreint = authRepo.HasEntityActionRestriction(
                    jwtUserId,
                    global::Tresorerie.Core.Enum.AuthorizationEntity.Reglement,
                    actionGuid,
                    new List<global::Tresorerie.Core.Models.Caisse> { caisse },
                    global::Tresorerie.Core.Enum.ProfilType.Grc);

                if (restreint)
                {
                    _logger.LogWarning(
                        "GÉNÉRATION RÈGLEMENT ESPÈCE refusée : userId={UserId} non autorisé sur la caisse {CaisseCode} (n°{CaisseNo}).",
                        jwtUserId, caisseCode, caisse.No);
                    throw new UnauthorizedAccessException(
                        $"Vous n'êtes pas autorisé à générer des règlements sur la caisse {caisseCode}.");
                }
            }

            if (!caisse.HasModeReglement(1))
                throw new InvalidOperationException($"La caisse {caisseCode} n'accepte pas le mode de règlement Espèce.");

            var deviseHelper = _kernel.Resolve<global::Tresorerie.UICommun.Helper.DeviseViewHelper>();
            var devise = deviseHelper.GetSocieteDevise(societe);
            if (devise == null)
                throw new InvalidOperationException("Devise société introuvable.");

            var echeanceRepo = _kernel.Resolve<global::Tresorerie.Core.Interfaces.IEcheanceRepository>();
            var echeancesOuvertes = (echeanceRepo.GetAll(
                global::Tresorerie.Core.Enum.ErpDomaine.Vente,
                societeId,
                nonPaye: false,
                onlySpe: false,
                dateDebut: null,
                dateFin: null) ?? Enumerable.Empty<global::Tresorerie.Core.Models.Echeance>())
                .Where(e => e.Solde > 0)
                .ToDictionary(e => e.No);

            var tiersHelper = _kernel.Resolve<global::Tresorerie.UICommun.Helper.TiersErpHelper>();
            var caisseManager = _kernel.Resolve<global::Tresorerie.Core.Services.CaisseManager>();
            var societeManager = _kernel.GroupeService.SocieteManager;
            caisseManager.SocieteManager = societeManager;

            var verifySoldeManager = _kernel.Resolve<global::Tresorerie.Core.Services.VerifySoldeManager>();
            if (verifySoldeManager.SocieteManager == null)
            {
                verifySoldeManager.SocieteManager = societeManager;
            }

            var affectationRepo = _kernel.Resolve<global::Tresorerie.Core.Interfaces.IAffectationRepository>();
            var resultats = new List<ReglementEspeceItemResultDto>();

            // Boucle SÉQUENTIELLE, SANS TransactionScope autour de l'ensemble : chaque appel
            // ReglementCreate est sa propre unité — un échec sur une facture (ex. délai de paiement
            // dépassé, ApplicationException native) ne doit JAMAIS empêcher le traitement des factures
            // suivantes (import partiel assumé, cf. Risques TASK-059). Jamais de split : 1 appel
            // ReglementCreate = 1 facture, jamais plusieurs factures dans un même règlement.
            foreach (var echeanceNo in echeanceNos)
            {
                if (!echeancesOuvertes.TryGetValue(echeanceNo, out var echeance))
                {
                    resultats.Add(new ReglementEspeceItemResultDto
                    {
                        EcheanceNo = echeanceNo,
                        Success = false,
                        Erreur = "Facture introuvable ou déjà soldée."
                    });
                    continue;
                }

                try
                {
                    var client = tiersHelper.Get(echeance.ClientCode, true);
                    if (client == null)
                        throw new InvalidOperationException($"Client introuvable ({echeance.ClientCode}) pour la facture {echeance.DocumentNumero}");

                    // Numéro de pièce issu du compteur applicatif officiel standard (EntityNumerotation.ReglementClient)
                    var numero = societeManager.GetNumeroPieceCourante(global::Tresorerie.Core.Enum.EntityNumerotation.ReglementClient, societeManager.Societe);

                    // Mapping infoLibre3 (MV_Info3) : EC_Info3 (Echeance.Info3) avec repli sur DO_Numero (Echeance.DocumentNumero) si vide.
                    // Mapping reference (MV_Reference) : string.Empty (TASK-062 : MV_Reference doit rester vide).
                    string infoLibre3Val = !string.IsNullOrWhiteSpace(echeance.Info3) ? echeance.Info3 : echeance.DocumentNumero;

                    int reglementNo = caisseManager.ReglementCreate(
                        numero,                                    // 0  numero
                        echeance.DocumentDate,                     // 1  date = date facture
                        echeance.Solde,                            // 2  montant = solde intégral
                        devise.No,                                  // 3  deviseNo
                        client.No,                                  // 4  clientNo
                        client.Numero,                              // 5  clientCode (canonique)
                        client.Intitule,                            // 6  clientIntitule
                        1,                                          // 7  modeNo = Espèce
                        caisse.No,                                  // 8  caisseNo
                        string.Empty,                               // 9  piece
                        echeance.DocumentNumero,                    // 10 libelle = numéro de facture
                        "",                                         // 11 tire
                        echeance.Date,                              // 12 echeance = date d'échéance
                        null,                                       // 13 banqueNo
                        "",                                         // 14 banqueClient
                        1m,                                         // 15 coursDevise
                        devise.No,                                  // 16 deviseSocieteNo
                        string.Empty,                               // 17 affaireNumero
                        string.Empty,                               // 18 ribClient
                        string.Empty,                               // 19 infoLibre1
                        string.Empty,                               // 20 infoLibre2
                        infoLibre3Val,                              // 21 infoLibre3 (MV_Info3) = EC_Info3 (repli DO_Numero)
                        string.Empty,                               // 22 infoLibre4
                        string.Empty,                               // 23 reference (MV_Reference) = string.Empty (TASK-062)
                        0,                                          // 24 collaborateurNo
                        false,                                      // 25 isCertifier
                        null,                                       // 26 dateValidite
                        null,                                       // 27 montantPlafond
                        0m,                                         // 28 baseRetenue
                        0m,                                         // 29 tauxRetenue
                        global::Tresorerie.Core.Enum.ReglementNature.Reglement, // 30 reglementNature (0, défaut)
                        false,                                      // 31 soumisDroitTimbre
                        0m,                                         // 32 montantDroitTimbre
                        false,                                      // 33 isImporterFromErp
                        false,                                      // 34 isImporterComptabiliser
                        true);                                      // 35 useNotification

                    // Création de l'affectation règlement ↔ facture dans RT_AFFECTATION (dérive de l'affectation intégrale)
                    var affectation = new global::Tresorerie.Core.Models.Affectation(
                        0,                        // erpNo
                        DateTime.Now,             // date
                        echeance.Solde,           // montant
                        reglementNo,              // reglementNo
                        echeance.No,              // echeanceNo
                        echeance.Solde,           // montantDevise
                        null                      // ecartEcheanceNo
                    );
                    affectationRepo.Create(affectation);

                    // Recalcul officiel des soldes (solde de l'échéance EC_Solde et solde du règlement MV_Solde)
                    verifySoldeManager.UpdateSoldeEcheance(echeance.No);
                    verifySoldeManager.UpdateSoldeReglementClient(reglementNo);

                    // Remise à zéro explicite de RT_ECHEANCE.EC_SoldeDevise.
                    // Verification faite sur les DLLs Tresorerie.* : VerifySoldeManager.UpdateSoldeEcheance n'exécute que :
                    // UPDATE [RT_ECHEANCE] SET [EC_Solde]=@Solde, [EC_Etat]=@Etat WHERE [EC_Id]=@No, sans jamais toucher EC_SoldeDevise.
                    // Aucune autre méthode native de DLL n'existe pour réinitialiser EC_SoldeDevise, ce qui justifie cet UPDATE SQL brut dédié.
                    using (var sqlConn = new SqlConnection(_dbFactory.GetConnectionString()))
                    {
                        sqlConn.Execute("UPDATE [RT_ECHEANCE] SET [EC_SoldeDevise] = 0 WHERE [EC_Id] = @EcheanceNo", new { EcheanceNo = echeance.No });
                    }

                    _logger.LogInformation(
                        "GÉNÉRATION RÈGLEMENT ESPÈCE OK : userId={UserId}, client={ClientCode}, caisse={CaisseCode}, facture={Facture}, échéanceNo={EcheanceNo}, montant={Montant}, reglementNo={ReglementNo}, numero={Numero}",
                        jwtUserId, client.Numero, caisseCode, echeance.DocumentNumero, echeanceNo, echeance.Solde, reglementNo, numero);

                    resultats.Add(new ReglementEspeceItemResultDto
                    {
                        EcheanceNo = echeanceNo,
                        FactureNumero = echeance.DocumentNumero,
                        Success = true,
                        ReglementNo = reglementNo,
                        ReglementNumero = numero
                    });
                }
                catch (Exception ex)
                {
                    // Isolation par facture : capture TOUTE exception (dont l'ApplicationException
                    // native de délai de paiement dépassé) sans jamais interrompre la boucle.
                    _logger.LogError(ex,
                        "GÉNÉRATION RÈGLEMENT ESPÈCE ÉCHEC : userId={UserId}, client={ClientCode}, échéanceNo={EcheanceNo} — {Message}",
                        jwtUserId, echeance.ClientCode, echeanceNo, ex.Message);

                    resultats.Add(new ReglementEspeceItemResultDto
                    {
                        EcheanceNo = echeanceNo,
                        FactureNumero = echeance.DocumentNumero,
                        Success = false,
                        Erreur = ex.Message
                    });
                }
            }

            return resultats;
        }

        // TASK-060 — Génération d'un règlement client "versement" (ModeNo = 12) depuis une ligne de relevé bancaire.
        // Formulaire minimal : client sélectionné + caisse (contrôle droits JWT) + MV_Reference saisi.
        // Résolution SERVEUR : Montant = montant relevé, Date = date relevé, BanqueNo = banqueId relevé depuis LigneReleveId.
        public async System.Threading.Tasks.Task<ReglementVersementResultDto> GenererVersementDepuisReleveAsync(
            int jwtUserId,
            int societeId,
            long ligneReleveId,
            string clientCode,
            string caisseCode,
            string mvReference,
            bool isAdmin)
        {
            if (ligneReleveId <= 0)
                throw new InvalidOperationException("L'identifiant de la ligne de relevé est obligatoire.");

            if (string.IsNullOrWhiteSpace(clientCode))
                throw new InvalidOperationException("Le code client est obligatoire.");

            if (string.IsNullOrWhiteSpace(caisseCode))
                throw new InvalidOperationException("La caisse est obligatoire.");

            // Résolution serveur de la ligne de relevé bancaire source (sécurité & intégrité des données)
            var ligneReleve = await _releveRepository.GetLignePourGenerationAsync(ligneReleveId);
            if (ligneReleve == null)
                throw new InvalidOperationException($"Ligne de relevé bancaire introuvable : {ligneReleveId}");

            if (!string.IsNullOrEmpty(ligneReleve.Lettrage))
                throw new InvalidOperationException("La ligne de relevé bancaire est déjà lettrée / rapprochée.");

            if (ligneReleve.Credit <= 0)
                throw new InvalidOperationException("La ligne de relevé doit être un encaissement (crédit > 0).");

            decimal montant = ligneReleve.Credit;
            DateTime dateOperation = ligneReleve.DateOperation;
            int banqueId = ligneReleve.BanqueId;

            var societe = _kernel.GroupeService.SocieteManager.Societe;
            var caisse = societe.GetCaisse(caisseCode);
            if (caisse == null)
                throw new InvalidOperationException($"Caisse introuvable : {caisseCode}");

            // Pré-contrôle d'autorisation sur l'utilisateur JWT réel
            if (!isAdmin)
            {
                var authRepo = _kernel.Resolve<global::Tresorerie.Authorization.Core.Repositories.IAuthorizationRepository>();
                var actionGuid = new global::Tresorerie.Authorization.Core.Actions.ReglementGenerer().Guid;
                bool restreint = authRepo.HasEntityActionRestriction(
                    jwtUserId,
                    global::Tresorerie.Core.Enum.AuthorizationEntity.Reglement,
                    actionGuid,
                    new List<global::Tresorerie.Core.Models.Caisse> { caisse },
                    global::Tresorerie.Core.Enum.ProfilType.Grc);

                if (restreint)
                {
                    _logger.LogWarning(
                        "GÉNÉRATION VERSEMENT refusée : userId={UserId} non autorisé sur la caisse {CaisseCode} (n°{CaisseNo}).",
                        jwtUserId, caisseCode, caisse.No);
                    throw new UnauthorizedAccessException(
                        $"Vous n'êtes pas autorisé à générer des règlements sur la caisse {caisseCode}.");
                }
            }

            if (!caisse.HasModeReglement(12))
                throw new InvalidOperationException($"La caisse {caisseCode} n'accepte pas le mode de règlement Versement (12).");

            var deviseHelper = _kernel.Resolve<global::Tresorerie.UICommun.Helper.DeviseViewHelper>();
            var devise = deviseHelper.GetSocieteDevise(societe);
            if (devise == null)
                throw new InvalidOperationException("Devise société introuvable.");

            var tiersHelper = _kernel.Resolve<global::Tresorerie.UICommun.Helper.TiersErpHelper>();
            var client = tiersHelper.Get(clientCode, true);
            if (client == null)
                throw new InvalidOperationException($"Client introuvable ({clientCode}).");

            var societeManager = _kernel.GroupeService.SocieteManager;
            var caisseManager = _kernel.Resolve<global::Tresorerie.Core.Services.CaisseManager>();
            caisseManager.SocieteManager = societeManager;

            // Numéro de pièce issu du compteur officiel applicatif (EntityNumerotation.ReglementClient)
            var numero = societeManager.GetNumeroPieceCourante(global::Tresorerie.Core.Enum.EntityNumerotation.ReglementClient, societeManager.Societe);

            int reglementNo = caisseManager.ReglementCreate(
                numero,                                    // 0  numero
                dateOperation,                             // 1  date = date du relevé
                montant,                                   // 2  montant = montant du relevé
                devise.No,                                 // 3  deviseNo
                client.No,                                 // 4  clientNo
                client.Numero,                             // 5  clientCode (canonique)
                client.Intitule,                           // 6  clientIntitule
                12,                                        // 7  modeNo = 12 (Versement)
                caisse.No,                                 // 8  caisseNo
                string.Empty,                              // 9  piece
                client.Intitule,                           // 10 libelle
                "",                                        // 11 tire
                dateOperation,                             // 12 echeance = date du relevé
                banqueId > 0 ? (int?)banqueId : null,      // 13 banqueNo = BanqueId de la ligne de relevé
                "Banque",                                  // 14 banqueClient (non-vide pour passer le contrôle type Virement/Chèque)
                1m,                                        // 15 coursDevise
                devise.No,                                 // 16 deviseSocieteNo
                string.Empty,                              // 17 affaireNumero
                string.Empty,                              // 18 ribClient
                string.Empty,                              // 19 infoLibre1
                string.Empty,                              // 20 infoLibre2
                string.Empty,                              // 21 infoLibre3
                string.Empty,                              // 22 infoLibre4
                mvReference ?? string.Empty,               // 23 reference (MV_Reference, saisie utilisateur)
                0,                                         // 24 collaborateurNo
                false,                                     // 25 isCertifier
                null,                                      // 26 dateValidite
                null,                                      // 27 montantPlafond
                0m,                                        // 28 baseRetenue
                0m,                                        // 29 tauxRetenue
                global::Tresorerie.Core.Enum.ReglementNature.Reglement, // 30 reglementNature (0, défaut)
                false,                                     // 31 soumisDroitTimbre
                0m,                                        // 32 montantDroitTimbre
                false,                                     // 33 isImporterFromErp
                false,                                     // 34 isImporterComptabiliser
                true);                                     // 35 useNotification

            _logger.LogInformation(
                "GÉNÉRATION VERSEMENT OK : userId={UserId}, client={ClientCode}, caisse={CaisseCode}, banqueId={BanqueId}, montant={Montant}, reglementNo={ReglementNo}, numero={Numero}",
                jwtUserId, client.Numero, caisseCode, banqueId, montant, reglementNo, numero);

            return new ReglementVersementResultDto
            {
                Success = true,
                ReglementNo = reglementNo,
                ReglementNumero = numero
            };
        }

        // TASK-064 — Cache des clients ERP : le chargement complet (GetAll) est coûteux.
        // GetClientsFromCache() garantit qu'un seul appel ERP est déclenché par fenêtre de TTL,
        // quelle que soit la fréquence des appels à GetClients / GetClientsCount / SearchClients.
        // Limite : TiersErpHelper n'expose pas d'API de recherche paramétrée ni de count léger ;
        // le chargement initial reste nécessairement complet (c'est une contrainte de la DLL native,
        // pas un choix de ce code). Le cache améliore significativement les appels suivants.
        private List<ClientDto> GetClientsFromCache()
        {
            return _cache.GetOrCreate(ClientsCacheKey, entry =>
            {
                entry.AbsoluteExpirationRelativeToNow = ClientsCacheTtl;
                var tiersHelper = _kernel.Resolve<global::Tresorerie.UICommun.Helper.TiersErpHelper>();
                var raw = tiersHelper.GetAll(global::Tresorerie.Core.Enum.FiltreTiers.Client, false);
                var list = (raw ?? Enumerable.Empty<global::Tresorerie.Core.Models.IErpClient>())
                    .Select(c => new ClientDto { Code = c.Numero ?? string.Empty, Intitule = c.Intitule ?? string.Empty, No = c.No })
                    .OrderBy(c => c.Intitule)
                    .ToList();
                _logger.LogInformation(
                    "CACHE CLIENTS chargé (miss) : {Count} clients ERP, TTL={Ttl}min.",
                    list.Count, ClientsCacheTtl.TotalMinutes);
                return list;
            }) ?? new List<ClientDto>();
        }

        // Retourne la liste complète (depuis le cache).
        public List<ClientDto> GetClients()
            => GetClientsFromCache();

        // TASK-064 — Count sans chargement ERP supplémentaire (lecture du cache).
        public int GetClientsCount()
            => GetClientsFromCache().Count;

        // TASK-064 — Recherche filtrée bornée, depuis le cache (0 appel ERP supplémentaire).
        // Filtre sur code (Numero) ou intitulé, retourne au plus maxResults résultats.
        public List<ClientDto> SearchClients(string term, int maxResults = 50)
        {
            var t = (term ?? string.Empty).Trim().ToLowerInvariant();
            var all = GetClientsFromCache();
            if (string.IsNullOrEmpty(t))
                return all.Take(maxResults).ToList();
            return all
                .Where(c =>
                    c.Code.ToLowerInvariant().Contains(t) ||
                    c.Intitule.ToLowerInvariant().Contains(t))
                .Take(maxResults)
                .ToList();
        }
    }

    public class ClientDto
    {
        public int No { get; set; }
        public string Code { get; set; } = string.Empty;
        public string Intitule { get; set; } = string.Empty;
    }

    public class EcheanceARegleDto
    {
        public int EcheanceNo { get; set; }
        public string ClientCode { get; set; } = string.Empty;
        public string ClientIntitule { get; set; } = string.Empty;
        public string FactureNumero { get; set; } = string.Empty;
        public DateTime DateFacture { get; set; }
        public DateTime DateEcheance { get; set; }
        public string Commentaire { get; set; } = string.Empty;
        public decimal Montant { get; set; }
        public decimal Solde { get; set; }
        public string Info1 { get; set; } = string.Empty;
        public string Info2 { get; set; } = string.Empty;
        public string Info3 { get; set; } = string.Empty;
        public string Info4 { get; set; } = string.Empty;
        public string Representant { get; set; } = string.Empty;
    }

    public class ReglementEspeceItemResultDto
    {
        public int EcheanceNo { get; set; }
        public string FactureNumero { get; set; } = string.Empty;
        public bool Success { get; set; }
        public int? ReglementNo { get; set; }
        public string? ReglementNumero { get; set; }
        public string? Erreur { get; set; }
    }

    public class ReglementVersementResultDto
    {
        public bool Success { get; set; }
        public int? ReglementNo { get; set; }
        public string? ReglementNumero { get; set; }
        public string? Erreur { get; set; }
    }
}
