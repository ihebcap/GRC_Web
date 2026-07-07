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

        public ReglementController(ReglementService reglementService)
        {
            _reglementService = reglementService;
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
            [FromQuery] string? soldeMax = null)
        {
            if (!int.TryParse(User.FindFirst("SocieteId")?.Value, out int societeId)) return Unauthorized();
            var caisses = User.FindFirst("Caisses")?.Value;
            var caissesList = string.IsNullOrEmpty(caisses) ? System.Array.Empty<int>() : caisses.Split(',').Select(int.Parse).ToArray();

            var allReglements = _reglementService.GetReglements(
                societeId, caissesList, dateDebut, dateFin,
                client, numero, piece, reference, libelle, montant, extrait,
                pointe, comptabilise, remis, impaye, annule, caisseNos,
                banqueNos, modeNos, banqueClient, solde, info1, info2, info3, info4,
                montantMin, montantMax, soldeMin, soldeMax
            );

            int totalItems = allReglements.Count();
            var items = allReglements.Skip((page - 1) * pageSize).Take(pageSize).ToList();

            return Ok(new { items, totalItems });
        }

        [HttpGet("distincts")]
        public IActionResult GetDistinctReglements(
            [FromQuery] System.DateTime? dateDebut = null,
            [FromQuery] System.DateTime? dateFin = null)
        {
            if (!int.TryParse(User.FindFirst("SocieteId")?.Value, out int societeId)) return Unauthorized();
            var caisses = User.FindFirst("Caisses")?.Value;
            var caissesList = string.IsNullOrEmpty(caisses) ? System.Array.Empty<int>() : caisses.Split(',').Select(int.Parse).ToArray();

            var result = _reglementService.GetDistinctReglements(societeId, caissesList, dateDebut, dateFin);
            return Ok(result);
        }

        [HttpPost("comptabiliser")]
        public IActionResult Comptabiliser([FromBody] List<int> reglementIds)
        {
            try
            {
                var result = _reglementService.Comptabiliser(reglementIds);
                return Ok(result);
            }
            catch (System.Exception ex)
            {
                return Problem(ex.Message);
            }
        }

        [HttpPost("apercu-comptabilisation")]
        public IActionResult ApercuComptabilisation([FromBody] List<int> reglementIds)
        {
            try
            {
                var result = _reglementService.ApercuComptabilisation(reglementIds);
                return Ok(result);
            }
            catch (System.Exception ex)
            {
                return Problem(ex.Message);
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
}
