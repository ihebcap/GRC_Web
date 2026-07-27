using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using GRC.Application.Services;
using System.Collections.Generic;
using GRC.Infrastructure.Repositories;
using Microsoft.Extensions.Configuration;
using System.Linq;
using GRC.Application.Interfaces;
using GRC.Infrastructure.Tresorerie;
using GRC.Infrastructure.Services;
using System.Security.Claims;

namespace GRC.API.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class ReleveBancaireController : ControllerBase
    {
        private readonly ReleveBancaireImportService _importService;
        private readonly AutoReconciliationEngine _reconciliationEngine;
        private readonly ReleveBancaireRepository _releveRepository;
        private readonly IDbConnectionFactory _dbFactory;
        private readonly TresorerieNinjectKernel _kernel;
        private readonly ReglementGenerationService _generationService;
        private readonly ILogger<ReleveBancaireController> _logger;

        public ReleveBancaireController(
            ReleveBancaireImportService importService,
            AutoReconciliationEngine reconciliationEngine,
            ReleveBancaireRepository releveRepository,
            IDbConnectionFactory dbFactory,
            TresorerieNinjectKernel kernel,
            ReglementGenerationService generationService,
            ILogger<ReleveBancaireController> logger)
        {
            _importService = importService;
            _reconciliationEngine = reconciliationEngine;
            _releveRepository = releveRepository;
            _dbFactory = dbFactory;
            _kernel = kernel;
            _generationService = generationService;
            _logger = logger;
        }

        [HttpGet]
        public async Task<IActionResult> GetEntetes([FromQuery] int banqueId, [FromQuery] bool nonRapprochesSeulement = false)
        {
            var entetes = await _releveRepository.GetEntetesByBanqueAsync(banqueId, nonRapprochesSeulement);
            return Ok(entetes);
        }

        [HttpGet("{id}/lignes")]
        public async Task<IActionResult> GetLignes(int id)
        {
            var lignes = await _releveRepository.GetAllLignesExcelAsync(id);
            return Ok(lignes);
        }

        [HttpGet("{id}/etat")]
        public async Task<IActionResult> GetEtatRapprochement(int id)
        {
            var etat = await _releveRepository.GetEtatRapprochementAsync(id);
            return Ok(etat);
        }

        [HttpPost("upload")]
        public async Task<IActionResult> UploadExcel([FromForm] IFormFile file, [FromForm] string titre, [FromForm] int? banqueId, [FromForm] string? userId)
        {
            if (file == null || file.Length == 0)
                return BadRequest("Aucun fichier n'a été fourni.");

            using (var stream = file.OpenReadStream())
            {
                var finalUserId = string.IsNullOrEmpty(userId) ? "INCONNU" : userId; 
                
                var importResult = _importService.ParserFichierExcel(stream, titre, banqueId, finalUserId);
                int enteteId = await _releveRepository.InsertReleveAsync(importResult.Entete);
                
                return Ok(new { 
                    message = "Fichier parsé et enregistré en base de données avec succès !", 
                    lignesImportees = importResult.Entete.Lignes.Count,
                    lignesRejeteesCount = importResult.LignesRejetees.Count,
                    lignesRejetees = importResult.LignesRejetees,
                    releveId = enteteId
                });
            }
        }

        [HttpPost("auto-reconcile")]
        public async Task<IActionResult> GenererPropositions([FromBody] AutoReconcileRequest request)
        {
            if (!int.TryParse(User.FindFirst("SocieteId")?.Value, out int societeId)) return Unauthorized();

            var toutesLesLignes = await _releveRepository.GetAllLignesExcelAsync(request.ReleveBancaireEnteteId);
            var lignesExcel = toutesLesLignes.Where(l => string.IsNullOrEmpty(l.Lettrage)).ToList();
            
            int startIndex = 1;
            var lignesLettrees = toutesLesLignes.Where(l => !string.IsNullOrEmpty(l.Lettrage)).ToList();
            if (lignesLettrees.Any())
            {
                var indexMax = lignesLettrees.Max(l => GRC.Application.Services.LettrageGenerator.GetIndexFromLettrage(l.Lettrage));
                if (indexMax > 0)
                {
                    startIndex = indexMax + 1;
                }
            }
            
            // Charger les vrais règlements GRC non pointés pour la banque sélectionnée
            var connProvider = new global::Tresorerie.Dapper.ConnectionProvider();
            connProvider.ConnectionString = _dbFactory.GetConnectionString();
            var reglRepo = new global::Tresorerie.Dapper.Repositories.ReglementClientRepository(connProvider);

            var caisses = User.FindFirst("Caisses")?.Value;
            var caissesList = string.IsNullOrEmpty(caisses) ? System.Array.Empty<int>() : caisses.Split(',').Select(int.Parse).ToArray();

            // Se limiter à la période sélectionnée dans la grille (même périmètre que ce que voit l'utilisateur)
            var debut = request.DateDebut ?? new System.DateTime(2000, 1, 1);
            var fin = request.DateFin ?? new System.DateTime(2030, 1, 1);

            // Filtrer par banque (si un banqueId est fourni) et non pointés
            var allReglements = caissesList.Length > 0
                ? reglRepo.GetAll(societeId, debut, fin, caissesList) ?? new List<global::Tresorerie.Core.Models.ReglementClient>()
                : new List<global::Tresorerie.Core.Models.ReglementClient>();

            // Filtrer : non pointés, et si banqueId fourni, de la bonne banque, et éligible au rapprochement
            var reglementsFiltered = allReglements
                .Where(r => !r.IsPointe)
                .Where(r => request.BanqueId == null || request.BanqueId == 0 || r.BanqueNo == request.BanqueId)
                .Where(r => GRC.Application.Services.ReglementEligibilityHelper.EstEligibleRappBancaire((int)r.Type, (int)r.IsRemis))
                .ToList();

            var reglementsGrc = reglementsFiltered.Select(r => new GrcReglementDto
            {
                MV_ID = r.No,
                Montant = r.MontantDeviseSociete
            }).ToList();
            
            var propositions = _reconciliationEngine.CalculerPropositions(lignesExcel, reglementsGrc, startIndex);
            
            return Ok(propositions);
        }

        [HttpPost("validate")]
        public async Task<IActionResult> ValiderRapprochement([FromBody] List<ValidationPairDto> pairesLettrage)
        {
            if (pairesLettrage == null || pairesLettrage.Count == 0)
                return BadRequest("Aucun règlement lettré à valider.");

            var userIdStr = User.FindFirst("UserId")?.Value;
            if (!int.TryParse(userIdStr, out int userId))
                return Unauthorized();

            // Corrélation : regroupe toutes les lignes de cette approbation dans le fichier de log.
            using (_logger.BeginScope("Approbation userId={UserId} paires={NbPaires}", userId, pairesLettrage.Count))
            {
                _logger.LogInformation(
                    "APPROBATION entrée : userId={UserId}, {NbPaires} paire(s) : {Paires}",
                    userId, pairesLettrage.Count,
                    string.Join(", ", pairesLettrage.Select(p => $"[ligne={p.ReleveLigneId},mv={p.GrcReglementId},lettre={p.Lettrage}]")));

                try
                {
                    // Appelle la méthode Dapper du Repository
                    var validationResult = await _releveRepository.SauvegarderValidationAsync(pairesLettrage, userId);

                    _logger.LogInformation(
                        "APPROBATION sortie : Success={Success}, SuccessCount={SuccessCount}, ErrorCount={ErrorCount}, FailedLigneIds={FailedLigneIds}",
                        validationResult.Success, validationResult.SuccessCount, validationResult.ErrorCount,
                        string.Join(",", validationResult.FailedLigneIds));

                    return Ok(validationResult);
                }
                catch (System.Exception ex)
                {
                    _logger.LogError(ex, "APPROBATION échec inattendu : userId={UserId}", userId);
                    return StatusCode(500, new { message = "Une erreur inattendue est survenue lors de la sauvegarde.", errors = new List<string> { ex.Message } });
                }
            }
        }

        public class ReserveRequest
        {
            public int LigneReleveId { get; set; }
            public int MvId { get; set; }
            // TASK-037 : conserve pour compat client mais IGNORE cote serveur (lettre calculee serveur).
            public string? Lettrage { get; set; }
        }

        [HttpPost("reserve")]
        public async Task<IActionResult> ReserveLigne([FromBody] ReserveRequest request)
        {
            var userIdStr = User.FindFirst("UserId")?.Value;
            if (!int.TryParse(userIdStr, out int userId))
                return Unauthorized();

            // Corrélation : regroupe les lignes de cette réservation dans le fichier de log.
            using (_logger.BeginScope("Réservation userId={UserId} ligne={LigneReleveId} mv={MvId}", userId, request.LigneReleveId, request.MvId))
            {
                _logger.LogInformation(
                    "RÉSERVATION entrée : userId={UserId}, ligneReleveId={LigneReleveId}, mvId={MvId}",
                    userId, request.LigneReleveId, request.MvId);

                try
                {
                    // La lettre proposee par le client (request.Lettrage) est volontairement ignoree :
                    // le repository calcule et renvoie la lettre attribuee (result.Lettrage).
                    var result = await _releveRepository.ReserverLigneAsync(request.LigneReleveId, request.MvId, userId);

                    if (result != null)
                    {
                        _logger.LogInformation(
                            "RÉSERVATION 200 : ligneReleveId={LigneReleveId}, mvId={MvId}, lettre attribuée={Lettrage}",
                            request.LigneReleveId, request.MvId, result.Lettrage);
                        return Ok(result);
                    }
                    else
                    {
                        var conflitInfo = await _releveRepository.GetLigneConflitAsync(request.LigneReleveId, request.MvId);
                        _logger.LogInformation(
                            "RÉSERVATION 409 (conflit) : ligneReleveId={LigneReleveId}, mvId={MvId}, détail={Conflit}",
                            request.LigneReleveId, request.MvId, conflitInfo);
                        return StatusCode(409, new { message = "Ligne ou règlement déjà réservé.", detail = conflitInfo });
                    }
                }
                catch (System.Exception ex)
                {
                    _logger.LogError(ex, "RÉSERVATION échec : userId={UserId}, ligneReleveId={LigneReleveId}, mvId={MvId}", userId, request.LigneReleveId, request.MvId);
                    throw;
                }
            }
        }

        // TASK-066 : réservation en lot — un seul aller-retour HTTP pour N paires (au lieu d'un POST /reserve par paire).
        // Verrouillage applock par enteteId toujours respecté côté repository (une seule prise par enteteId distinct,
        // tenue pour toute la transaction du lot).
        [HttpPost("reserve-batch")]
        public async Task<IActionResult> ReserveLignesBatch([FromBody] List<ReserveRequest> requests)
        {
            var userIdStr = User.FindFirst("UserId")?.Value;
            if (!int.TryParse(userIdStr, out int userId))
                return Unauthorized();

            if (requests == null || requests.Count == 0)
                return BadRequest("Aucune paire à réserver.");

            using (_logger.BeginScope("Réservation lot userId={UserId} nbPaires={NbPaires}", userId, requests.Count))
            {
                _logger.LogInformation(
                    "RÉSERVATION LOT entrée : userId={UserId}, {NbPaires} paire(s) : {Paires}",
                    userId, requests.Count,
                    string.Join(", ", requests.Select(r => $"[ligne={r.LigneReleveId},mv={r.MvId}]")));

                var items = requests.Select(r => new ReserveBatchItemDto { LigneReleveId = r.LigneReleveId, MvId = r.MvId }).ToList();
                var resultats = await _releveRepository.ReserverLignesBatchAsync(items, userId);

                _logger.LogInformation(
                    "RÉSERVATION LOT sortie : {Success}/{Total} succès",
                    resultats.Count(r => r.Success), requests.Count);

                return Ok(resultats);
            }
        }

        public class ReleaseRequest
        {
            public int LigneReleveId { get; set; }
        }

        [HttpPost("release")]
        public async Task<IActionResult> ReleaseLigne([FromBody] ReleaseRequest request)
        {
            var userIdStr = User.FindFirst("UserId")?.Value;
            if (!int.TryParse(userIdStr, out int userId))
                return Unauthorized();

            var result = await _releveRepository.LibererLigneAsync(request.LigneReleveId, userId);
            if (result)
                return Ok(new { message = "Ligne libérée." });
            else
                return StatusCode(403, new { message = "Impossible de libérer la ligne (pas le réservataire ou déjà libre)." });
        }
        [HttpDelete("{id}")]
        public async Task<IActionResult> SupprimerReleve(int id)
        {
            var result = await _releveRepository.SupprimerReleveAsync(id);
            if (result == -1)
                return NotFound(new { message = "Relevé introuvable." });
            else if (result == 0)
                return StatusCode(409, new { message = "Suppression impossible : ce relevé contient au moins une ligne en cours de rapprochement ou déjà validée." });
            
            return NoContent();
        }

        // TASK-060 — Endpoint de génération d'un règlement versement (ModeNo = 12) depuis une ligne de relevé bancaire.
        [HttpPost("generer-reglement")]
        public async Task<IActionResult> GenererReglementVersement([FromBody] GenererReglementVersementRequest request)
        {
            if (!int.TryParse(User.FindFirst("UserId")?.Value, out int userId))
                return Unauthorized();

            if (!int.TryParse(User.FindFirst("SocieteId")?.Value, out int societeId))
                return Unauthorized();

            bool isAdmin = User.FindFirst("IsAdmin")?.Value == "1";

            if (request == null || request.LigneReleveId <= 0 || string.IsNullOrWhiteSpace(request.ClientCode) || string.IsNullOrWhiteSpace(request.CaisseCode))
                return BadRequest(new { success = false, erreur = "La ligne de relevé, le client et la caisse sont obligatoires." });

            using (_logger.BeginScope("Génération versement userId={UserId} ligneReleveId={LigneReleveId} caisse={CaisseCode} client={ClientCode}",
                userId, request.LigneReleveId, request.CaisseCode, request.ClientCode))
            {
                _logger.LogInformation(
                    "GÉNÉRATION VERSEMENT entrée : userId={UserId}, ligneReleveId={LigneReleveId}, client={ClientCode}, caisse={CaisseCode}",
                    userId, request.LigneReleveId, request.ClientCode, request.CaisseCode);
                try
                {
                    var result = await _generationService.GenererVersementDepuisReleveAsync(
                        userId, societeId, request.LigneReleveId, request.ClientCode, request.CaisseCode, request.MvReference, isAdmin);

                    if (!result.Success)
                    {
                        return BadRequest(result);
                    }

                    return Ok(result);
                }
                catch (System.UnauthorizedAccessException ex)
                {
                    _logger.LogWarning(ex, "GÉNÉRATION VERSEMENT refusée (autorisation) : userId={UserId}", userId);
                    return Forbid();
                }
                catch (System.Exception ex)
                {
                    _logger.LogError(ex, "GÉNÉRATION VERSEMENT échec : userId={UserId}", userId);
                    return BadRequest(new GRC.Infrastructure.Services.ReglementVersementResultDto { Success = false, Erreur = ex.Message });
                }
            }
        }
    }

    public class AutoReconcileRequest
    {
        public int ReleveBancaireEnteteId { get; set; }
        public int? BanqueId { get; set; }
        public System.DateTime? DateDebut { get; set; }
        public System.DateTime? DateFin { get; set; }
    }

    public class GenererReglementVersementRequest
    {
        public long LigneReleveId { get; set; }
        public string ClientCode { get; set; } = string.Empty;
        public string CaisseCode { get; set; } = string.Empty;
        public string MvReference { get; set; } = string.Empty;
    }
}
