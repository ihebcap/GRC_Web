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

        public ReleveBancaireController(
            ReleveBancaireImportService importService,
            AutoReconciliationEngine reconciliationEngine,
            ReleveBancaireRepository releveRepository,
            IDbConnectionFactory dbFactory,
            TresorerieNinjectKernel kernel)
        {
            _importService = importService;
            _reconciliationEngine = reconciliationEngine;
            _releveRepository = releveRepository;
            _dbFactory = dbFactory;
            _kernel = kernel;
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

            try
            {
                // Appelle la méthode Dapper du Repository
                var validationResult = await _releveRepository.SauvegarderValidationAsync(pairesLettrage, userId);
                
                return Ok(validationResult);
            }
            catch (System.Exception ex)
            {
                return StatusCode(500, new { message = "Une erreur inattendue est survenue lors de la sauvegarde.", errors = new List<string> { ex.Message } });
            }
        }

        public class ReserveRequest
        {
            public int LigneReleveId { get; set; }
            public int MvId { get; set; }
            public string Lettrage { get; set; }
        }

        [HttpPost("reserve")]
        public async Task<IActionResult> ReserveLigne([FromBody] ReserveRequest request)
        {
            var userIdStr = User.FindFirst("UserId")?.Value;
            if (!int.TryParse(userIdStr, out int userId))
                return Unauthorized();

            var result = await _releveRepository.ReserverLigneAsync(request.LigneReleveId, request.MvId, request.Lettrage, userId);
            
            if (result != null)
            {
                return Ok(result);
            }
            else
            {
                var conflitInfo = await _releveRepository.GetLigneConflitAsync(request.LigneReleveId, request.MvId);
                return StatusCode(409, new { message = "Ligne ou règlement déjà réservé.", detail = conflitInfo });
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
    }

    public class AutoReconcileRequest
    {
        public int ReleveBancaireEnteteId { get; set; }
        public int? BanqueId { get; set; }
        public System.DateTime? DateDebut { get; set; }
        public System.DateTime? DateFin { get; set; }
    }
}
