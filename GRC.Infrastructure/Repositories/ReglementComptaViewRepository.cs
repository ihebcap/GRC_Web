using System.Collections.Generic;
using System.Data.SqlClient;
using System.Linq;
using Dapper;
using GRC.Application.Interfaces;

namespace GRC.Infrastructure.Repositories
{
    /// <summary>
    /// TASK-036 — Ligne de la vue GRC <c>vw_ReglementsAComptabiliser</c> (1 ligne par MV_ID).
    /// Fournit les valeurs métier à imprimer sur les écritures de règlement client.
    /// </summary>
    public class ReglementComptaViewRow
    {
        public int MV_ID { get; set; }
        public string? MV_Piece { get; set; }
        public string? MV_Reference { get; set; }
        public string? ClientIntitule { get; set; }
        // MV_Type = 0 : espèce. Tout le reste (3 et 4) : hors espèce. Pilote la règle DocNumero.
        public int MV_Type { get; set; }
        // TASK-053 — libellé de l'écriture, calculé par la vue pour les deux modes (espèce :
        // « ESP <facture> » ; hors espèce : libellé saisi ou « Versement »). Jamais vide.
        public string? LibelleEcriture { get; set; }
        // TASK-053 — référence de l'écriture, calculée par la vue (espèce : mv_info3 = le BL ;
        // hors espèce : mv_reference). Déjà extraite et tronquée : ne PAS repasser FirstDoc dessus.
        public string? ReferenceCompta { get; set; }
        // TASK-053 — n° de facture affectée (RT_AFFECTATION -> RT_ECHEANCE, DO_Type = 6).
        // NULL si aucune affectation. Utilisée pour DocNumero1 en espèce.
        public string? FactureNumero { get; set; }
    }

    /// <summary>
    /// Lecture seule de la vue <c>vw_ReglementsAComptabiliser</c>, lookup par MV_ID (= reglement.No).
    /// Vue figée fournie par le PO ; requête cross-DB GOCOM assumée côté vue.
    /// </summary>
    public class ReglementComptaViewRepository
    {
        private readonly string _connectionString;

        public ReglementComptaViewRepository(IDbConnectionFactory connectionFactory)
        {
            _connectionString = connectionFactory.GetConnectionString();
        }

        /// <summary>Charge les lignes de vue pour un ensemble de MV_ID (batché en IN, chunks de 2000).</summary>
        public Dictionary<int, ReglementComptaViewRow> GetByMvIds(IEnumerable<int> mvIds)
        {
            var result = new Dictionary<int, ReglementComptaViewRow>();
            var ids = mvIds?.Distinct().ToList() ?? new List<int>();
            if (ids.Count == 0) return result;

            const string sql = @"SELECT MV_ID, MV_Piece, MV_Reference, ClientIntitule, MV_Type,
                                        LibelleEcriture, ReferenceCompta, FactureNumero
                                 FROM vw_ReglementsAComptabiliser
                                 WHERE MV_ID IN @Ids";

            using var connection = new SqlConnection(_connectionString);
            connection.Open();

            foreach (var chunk in ids.Chunk(2000))
            {
                var rows = connection.Query<ReglementComptaViewRow>(sql, new { Ids = chunk });
                foreach (var row in rows)
                    result[row.MV_ID] = row;
            }

            return result;
        }
    }
}
