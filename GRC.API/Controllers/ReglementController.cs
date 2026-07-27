using Microsoft.AspNetCore.Mvc;
using System.Collections.Generic;
using Microsoft.AspNetCore.Authorization;
using System.Security.Claims;
using GRC.Infrastructure.Services;
using System.Linq;

namespace GRC.API.Controllers
{
    [ApiController]
    [Route("api/reglements")] // pluriel, aligné sur les appels du frontend (/api/reglements[...])
    [Authorize]
    public class ReglementController : ControllerBase
    {
        private readonly ReglementService _reglementService;
        private readonly ReglementGenerationService _reglementGenerationService;
        private readonly ILogger<ReglementController> _logger;

        public ReglementController(ReglementService reglementService, ReglementGenerationService reglementGenerationService, ILogger<ReglementController> logger)
        {
            _reglementService = reglementService;
            _reglementGenerationService = reglementGenerationService;
            _logger = logger;
        }

        [HttpGet]
        public IActionResult GetReglements(
            [FromQuery] int page = 1,
            [FromQuery] int pageSize = 50,
            [FromQuery] System.DateTime? dateDebut = null,
            [FromQuery] System.DateTime? dateFin = null,
            [FromQuery] string? client = null,
            [FromQuery] string? numero = null,
            [FromQuery] string? piece = null,
            [FromQuery] string? reference = null,
            [FromQuery] string? libelle = null,
            [FromQuery] string? montant = null,
            [FromQuery] string? extrait = null,
            [FromQuery] string? pointe = null,
            [FromQuery] string? comptabilise = null,
            [FromQuery] string? remis = null,
            [FromQuery] string? impaye = null,
            [FromQuery] string? annule = null,
            [FromQuery] string? caisseNos = null,
            [FromQuery] string? banqueNos = null,
            [FromQuery] string? modeNos = null,
            [FromQuery] string? banqueClient = null,
            [FromQuery] string? solde = null,
            [FromQuery] string? info1 = null,
            [FromQuery] string? info2 = null,
            [FromQuery] string? info3 = null,
            [FromQuery] string? info4 = null,
            [FromQuery] string? montantMin = null,
            [FromQuery] string? montantMax = null,
            [FromQuery] string? soldeMin = null,
            [FromQuery] string? soldeMax = null,
            [FromQuery] bool eligibleRappBancaire = false)
        {
            if (!int.TryParse(User.FindFirst("SocieteId")?.Value, out int societeId)) return Unauthorized();
            var caisses = User.FindFirst("Caisses")?.Value;
            var caissesList = string.IsNullOrEmpty(caisses) ? System.Array.Empty<int>() : caisses.Split(',').Select(int.Parse).ToArray();

            bool isAdmin = User.FindFirst("IsAdmin")?.Value == "1";

            var allReglements = _reglementService.GetReglements(
                societeId, caissesList, dateDebut, dateFin,
                client, numero, piece, reference, libelle, montant, extrait,
                pointe, comptabilise, remis, impaye, annule, caisseNos,
                banqueNos, modeNos, banqueClient, solde, info1, info2, info3, info4,
                montantMin, montantMax, soldeMin, soldeMax, isAdmin, eligibleRappBancaire
            );

            int totalItems = allReglements.Count();
            var items = allReglements.Skip((page - 1) * pageSize).Take(pageSize).ToList();

            return Ok(new { items, totalItems });
        }

        [HttpGet("distincts")]
        public IActionResult GetDistinctReglements(
            [FromQuery] System.DateTime? dateDebut = null,
            [FromQuery] System.DateTime? dateFin = null,
            [FromQuery] bool eligibleRappBancaire = false)
        {
            if (!int.TryParse(User.FindFirst("SocieteId")?.Value, out int societeId)) return Unauthorized();
            var caisses = User.FindFirst("Caisses")?.Value;
            var caissesList = string.IsNullOrEmpty(caisses) ? System.Array.Empty<int>() : caisses.Split(',').Select(int.Parse).ToArray();

            bool isAdmin = User.FindFirst("IsAdmin")?.Value == "1";

            var result = _reglementService.GetDistinctReglements(societeId, caissesList, dateDebut, dateFin, isAdmin, eligibleRappBancaire);
            return Ok(result);
        }

        [HttpPost("comptabiliser")]
        public IActionResult Comptabiliser([FromBody] List<int> reglementIds)
        {
            var userId = User.FindFirst("UserId")?.Value;
            using (_logger.BeginScope("Comptabilisation userId={UserId} nb={Nb}", userId, reglementIds?.Count ?? 0))
            {
                _logger.LogInformation(
                    "COMPTABILISATION entrée : userId={UserId}, {Nb} règlement(s) : {ReglementIds}",
                    userId, reglementIds?.Count ?? 0, reglementIds != null ? string.Join(",", reglementIds) : "");
                try
                {
                    var result = _reglementService.Comptabiliser(reglementIds);
                    _logger.LogInformation("COMPTABILISATION sortie : {Resultat}", result);
                    return Ok(result);
                }
                catch (System.Exception ex)
                {
                    _logger.LogError(ex, "COMPTABILISATION échec (lot) : userId={UserId}", userId);
                    return Problem(ex.Message);
                }
            }
        }

        // TASK-051 — Lettrage manuel sur période libre : l'utilisateur saisit dateMin/dateMax uniquement,
        // le back résout tous les clients distincts du périmètre caisses/société (même scoping que GetReglements).
        [HttpPost("lettrer-periode")]
        public IActionResult LettrerPeriode([FromBody] LettrerPeriodeRequest request)
        {
            if (!int.TryParse(User.FindFirst("SocieteId")?.Value, out int societeId)) return Unauthorized();
            var caisses = User.FindFirst("Caisses")?.Value;
            var caissesList = string.IsNullOrEmpty(caisses) ? System.Array.Empty<int>() : caisses.Split(',').Select(int.Parse).ToArray();
            bool isAdmin = User.FindFirst("IsAdmin")?.Value == "1";
            var userId = User.FindFirst("UserId")?.Value;

            using (_logger.BeginScope("Lettrage période userId={UserId} dateMin={DateMin} dateMax={DateMax}", userId, request.DateMin, request.DateMax))
            {
                _logger.LogInformation("LETTRAGE PÉRIODE entrée : userId={UserId}, dateMin={DateMin:yyyy-MM-dd}, dateMax={DateMax:yyyy-MM-dd}", userId, request.DateMin, request.DateMax);
                try
                {
                    var result = _reglementService.LettrerParPeriode(societeId, caissesList, request.DateMin, request.DateMax, isAdmin);
                    _logger.LogInformation("LETTRAGE PÉRIODE sortie : {Resultat}", result);
                    return Ok(result);
                }
                catch (System.Exception ex)
                {
                    _logger.LogError(ex, "LETTRAGE PÉRIODE échec (lot) : userId={UserId}", userId);
                    return Problem(ex.Message);
                }
            }
        }

        [HttpPost("apercu-comptabilisation")]
        public IActionResult ApercuComptabilisation([FromBody] List<int> reglementIds)
        {
            var userId = User.FindFirst("UserId")?.Value;
            using (_logger.BeginScope("Aperçu compta userId={UserId} nb={Nb}", userId, reglementIds?.Count ?? 0))
            {
                _logger.LogInformation(
                    "APERÇU COMPTA entrée : userId={UserId}, {Nb} règlement(s) : {ReglementIds}",
                    userId, reglementIds?.Count ?? 0, reglementIds != null ? string.Join(",", reglementIds) : "");
                try
                {
                    var result = _reglementService.ApercuComptabilisation(reglementIds);
                    _logger.LogInformation("APERÇU COMPTA sortie OK : userId={UserId}", userId);
                    return Ok(result);
                }
                catch (System.Exception ex)
                {
                    _logger.LogError(ex, "APERÇU COMPTA échec : userId={UserId}", userId);
                    return Problem(ex.Message);
                }
            }
        }

        // TASK-059 — Factures ouvertes (non soldées, Solde > 0) de la société, tous clients confondus,
        // déjà connues de RT_ECHEANCE : socle de l'écran de génération de règlements espèce.
        [HttpGet("factures-a-regler")]
        public IActionResult GetFacturesARegler()
        {
            if (!int.TryParse(User.FindFirst("SocieteId")?.Value, out int societeId)) return Unauthorized();

            try
            {
                var result = _reglementGenerationService.GetFacturesARegler(societeId);
                return Ok(result);
            }
            catch (System.Exception ex)
            {
                _logger.LogError(ex, "FACTURES À RÉGLER échec");
                return Problem(ex.Message);
            }
        }

        // TASK-059 — Génération de règlements espèce : un CaisseManager.ReglementCreate PAR facture
        // cochée (jamais de split), après pré-contrôle HasEntityActionRestriction sur l'utilisateur
        // JWT réel (pas l'utilisateur technique du kernel). Échec par facture isolé : les autres
        // factures cochées restent traitées (pas de TransactionScope global, cf. TASK-059 Risques).
        [HttpPost("generer-espece")]
        public IActionResult GenererEspece([FromBody] GenererReglementsEspeceRequest request)
        {
            if (!int.TryParse(User.FindFirst("SocieteId")?.Value, out int societeId)) return Unauthorized();
            if (!int.TryParse(User.FindFirst("UserId")?.Value, out int userId)) return Unauthorized();
            bool isAdmin = User.FindFirst("IsAdmin")?.Value == "1";

            if (request == null || string.IsNullOrWhiteSpace(request.CaisseCode)
                || request.EcheanceNos == null || request.EcheanceNos.Count == 0)
                return BadRequest("caisseCode et echeanceNos (au moins une facture) sont obligatoires.");

            using (_logger.BeginScope("Génération règlement espèce userId={UserId} caisse={CaisseCode} nb={Nb}",
                userId, request.CaisseCode, request.EcheanceNos.Count))
            {
                _logger.LogInformation(
                    "GÉNÉRATION RÈGLEMENT ESPÈCE entrée : userId={UserId}, caisse={CaisseCode}, échéances={EcheanceNos}",
                    userId, request.CaisseCode, string.Join(",", request.EcheanceNos));
                try
                {
                    var resultats = _reglementGenerationService.GenererReglementsEspece(
                        userId, societeId, request.CaisseCode, request.EcheanceNos, isAdmin);

                    var reglementsCreees = resultats.Where(r => r.Success).ToList();
                    var erreurs = resultats.Where(r => !r.Success)
                        .Select(r => new { r.EcheanceNo, r.FactureNumero, erreur = r.Erreur })
                        .ToList();

                    _logger.LogInformation(
                        "GÉNÉRATION RÈGLEMENT ESPÈCE sortie : userId={UserId}, {NbOk} créé(s), {NbKo} en échec",
                        userId, reglementsCreees.Count, erreurs.Count);

                    return Ok(new { success = erreurs.Count == 0, reglementsCreees, erreurs });
                }
                catch (System.UnauthorizedAccessException ex)
                {
                    _logger.LogWarning(ex, "GÉNÉRATION RÈGLEMENT ESPÈCE refusée (autorisation) : userId={UserId}", userId);
                    return Forbid();
                }
                catch (System.Exception ex)
                {
                    _logger.LogError(ex, "GÉNÉRATION RÈGLEMENT ESPÈCE échec (lot) : userId={UserId}", userId);
                    return Problem(ex.Message);
                }
            }
        }

        // Rapprochement manuel — route absolue pour matcher l'appel front POST /api/rapprochement
        [HttpPost("/api/rapprochement")]
        public IActionResult Rapprocher([FromBody] List<RapprochementManuelDto> items)
        {
            if (items == null || items.Count == 0)
                return BadRequest("Aucun règlement à rapprocher.");
            try
            {
                var result = _reglementService.RapprocherManuel(items);
                return Ok(result);
            }
            catch (System.Exception ex)
            {
                return Problem(ex.Message);
            }
        }
    }

    // TASK-051 — Payload du lettrage par période : deux dates uniquement, pas de sélection de lignes.
    public class LettrerPeriodeRequest
    {
        public System.DateTime DateMin { get; set; }
        public System.DateTime DateMax { get; set; }
    }

    // TASK-059 — Payload de génération de règlements espèce : pas de champ mode (constante Espèce),
    // pas de champ montant (solde intégral de chaque échéance), pas de champ référence (dérivée du
    // numéro de facture) — tout est dérivé côté serveur, cf. tasks/TASK-059.md.
    public class GenererReglementsEspeceRequest
    {
        public string CaisseCode { get; set; } = string.Empty;
        public List<int> EcheanceNos { get; set; } = new();
    }
}
