using System;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.Linq;
using System.Threading.Tasks;
using Dapper;
using GRC.Domain.Entities;
using GRC.Application.Interfaces;

namespace GRC.Infrastructure.Repositories
{
    public class ReleveBancaireRepository
    {
        private readonly string _connectionString;

        public ReleveBancaireRepository(IDbConnectionFactory connectionFactory)
        {
            _connectionString = connectionFactory.GetConnectionString();
        }

        public async Task<int> InsertReleveAsync(ReleveBancaireEntete entete)
        {
            using (var connection = new SqlConnection(_connectionString))
            {
                await connection.OpenAsync();
                
                using (var transaction = connection.BeginTransaction())
                {
                    try
                    {
                        string sqlEntete = @"
                            INSERT INTO [dbo].[RAPP_ReleveBancaire_Entete] 
                            ([BanqueId], [Titre], [DateImport], [ImportePar_UserId])
                            VALUES (@BanqueId, @Titre, @DateImport, @ImportePar_UserId);
                            
                            SELECT CAST(SCOPE_IDENTITY() as int);";

                        var enteteId = await connection.QuerySingleAsync<int>(sqlEntete, new
                        {
                            entete.BanqueId,
                            entete.Titre,
                            entete.DateImport,
                            entete.ImportePar_UserId
                        }, transaction);

                        entete.Id = enteteId;

                        if (entete.Lignes != null && entete.Lignes.Any())
                        {
                            string sqlLigne = @"
                                INSERT INTO [dbo].[RAPP_ReleveBancaire_Ligne]
                                ([ReleveBancaireEnteteId], [DateOperation], [DateValeur], [Libelle], 
                                 [Reference], [Code], [Debit], [Credit], [MontantReel])
                                VALUES
                                (@ReleveBancaireEnteteId, @DateOperation, @DateValeur, @Libelle, 
                                 @Reference, @Code, @Debit, @Credit, @MontantReel);";

                            foreach (var ligne in entete.Lignes)
                            {
                                ligne.ReleveBancaireEnteteId = enteteId;
                            }

                            await connection.ExecuteAsync(sqlLigne, entete.Lignes, transaction);
                        }

                        transaction.Commit();
                        return enteteId;
                    }
                    catch (Exception ex)
                    {
                        transaction.Rollback();
                        throw new Exception("Erreur critique lors de l'enregistrement en BDD : " + ex.Message, ex);
                    }
                }
            }
        }

        public async Task<List<ReleveBancaireLigne>> GetLignesExcelARapprocherAsync(int enteteId)
        {
            using (var connection = new SqlConnection(_connectionString))
            {
                await connection.OpenAsync();
                
                string sql = @"
                    SELECT * FROM [dbo].[RAPP_ReleveBancaire_Ligne]
                    WHERE ReleveBancaireEnteteId = @EnteteId 
                    AND Credit > 0 
                    AND Lettrage IS NULL";
                    
                var result = await connection.QueryAsync<ReleveBancaireLigne>(sql, new { EnteteId = enteteId });
                return result.ToList();
            }
        }

        public async Task<List<ReleveBancaireListItemDto>> GetEntetesByBanqueAsync(int banqueId, bool nonRapprochesSeulement = false)
        {
            using (var connection = new SqlConnection(_connectionString))
            {
                await connection.OpenAsync();
                string sql = @"
                    SELECT 
                        e.Id, e.BanqueId, e.Titre, e.DateImport, e.ImportePar_UserId,
                        COUNT(l.Id) AS TotalLignes,
                        SUM(CASE WHEN l.DateValidation IS NULL AND l.MV_ID IS NOT NULL THEN 1 ELSE 0 END) AS NbReserve,
                        SUM(CASE WHEN l.DateValidation IS NOT NULL THEN 1 ELSE 0 END) AS NbRapproche,
                        SUM(CASE WHEN l.DateValidation IS NULL AND l.MV_ID IS NULL THEN 1 ELSE 0 END) AS NbSansAction
                    FROM [dbo].[RAPP_ReleveBancaire_Entete] e
                    LEFT JOIN [dbo].[RAPP_ReleveBancaire_Ligne] l ON l.ReleveBancaireEnteteId = e.Id
                    WHERE e.BanqueId = @BanqueId
                      AND (@NonRapprochesSeulement = 0 OR EXISTS (
                          SELECT 1
                          FROM [dbo].[RAPP_ReleveBancaire_Ligne] l2
                          WHERE l2.ReleveBancaireEnteteId = e.Id
                            AND l2.DateValidation IS NULL
                            AND l2.Credit > 0
                      ))
                    GROUP BY e.Id, e.BanqueId, e.Titre, e.DateImport, e.ImportePar_UserId
                    ORDER BY e.DateImport DESC";
                var result = await connection.QueryAsync<ReleveBancaireListItemDto>(sql, new { BanqueId = banqueId, NonRapprochesSeulement = nonRapprochesSeulement });
                return result.ToList();
            }
        }

        public async Task<List<ReleveBancaireLigne>> GetAllLignesExcelAsync(int enteteId)
        {
            using (var connection = new SqlConnection(_connectionString))
            {
                await connection.OpenAsync();
                string sql = @"
                    SELECT l.*, COALESCE(NULLIF(LTRIM(RTRIM(ISNULL(u.UT_Nom, '') + ' ' + ISNULL(u.UT_Prenom, ''))), ''), u.UT_Login) AS ReservePar_UserName
                    FROM [dbo].[RAPP_ReleveBancaire_Ligne] l
                    LEFT JOIN [dbo].[P_UTILISATEUR] u ON u.UT_Id = l.ReservePar_UserId
                    WHERE l.ReleveBancaireEnteteId = @EnteteId AND l.DateValidation IS NULL 
                    ORDER BY l.DateOperation ASC";
                var result = await connection.QueryAsync<ReleveBancaireLigne>(sql, new { EnteteId = enteteId });
                return result.ToList();
            }
        }

        public async Task<List<LigneEtatRapprochementDto>> GetEtatRapprochementAsync(int enteteId)
        {
            var paires = new List<LigneEtatRapprochementDto>();

            // 1. Lecture des lignes (toutes, sans filtre DateValidation)
            using (var connection = new SqlConnection(_connectionString))
            {
                await connection.OpenAsync();
                string sql = @"
                    SELECT l.*, COALESCE(NULLIF(LTRIM(RTRIM(ISNULL(u.UT_Nom, '') + ' ' + ISNULL(u.UT_Prenom, ''))), ''), u.UT_Login) AS ReservePar_UserName
                    FROM [dbo].[RAPP_ReleveBancaire_Ligne] l
                    LEFT JOIN [dbo].[P_UTILISATEUR] u ON u.UT_Id = l.ReservePar_UserId
                    WHERE l.ReleveBancaireEnteteId = @EnteteId
                    ORDER BY l.DateOperation ASC;";
                
                var result = await connection.QueryAsync<LigneEtatRapprochementDto>(sql, new { EnteteId = enteteId });
                paires = result.ToList();
            }

            // 2. Enrichissement règlement GRC via la DLL (lecture)
            var mvIds = paires.Where(p => p.MV_ID.HasValue).Select(p => p.MV_ID.Value).Distinct().ToList();

            if (mvIds.Any())
            {
                var connProvider = new global::Tresorerie.Dapper.ConnectionProvider();
                connProvider.ConnectionString = _connectionString;
                var repo = new global::Tresorerie.Dapper.Repositories.ReglementClientRepository(connProvider);

                var reglements = new Dictionary<int, global::Tresorerie.Core.Models.ReglementClient>();

                foreach (var mvId in mvIds)
                {
                    var reg = repo.Get(mvId);
                    if (reg != null)
                    {
                        reglements[mvId] = reg;
                    }
                }

                foreach (var ligne in paires)
                {
                    if (ligne.DateValidation != null)
                        ligne.Statut = "Valide";
                    else if (ligne.MV_ID != null)
                        ligne.Statut = "Reserve";
                    else
                        ligne.Statut = "NonRapproche";

                    if (ligne.MV_ID.HasValue && reglements.TryGetValue(ligne.MV_ID.Value, out var reglement))
                    {
                        ligne.ReglementNumero = reglement.Numero;
                        ligne.ReglementDate = reglement.Date;
                        ligne.ReglementCaisseNo = reglement.CaisseNo;
                        ligne.ReglementClient = reglement.ClientIntitule;
                    }
                }
            }
            else
            {
                foreach (var ligne in paires)
                {
                    if (ligne.DateValidation != null)
                        ligne.Statut = "Valide";
                    else if (ligne.MV_ID != null)
                        ligne.Statut = "Reserve";
                    else
                        ligne.Statut = "NonRapproche";
                }
            }

            return paires;
        }

        public async Task<ReleveBancaireLigne?> ReserverLigneAsync(int ligneReleveId, int mvId, string lettrage, int userId)
        {
            using (var connection = new SqlConnection(_connectionString))
            {
                await connection.OpenAsync();
                string sql = @"
                    UPDATE dbo.RAPP_ReleveBancaire_Ligne
                    SET Lettrage=@Lettrage, MV_ID=@MvId, ReservePar_UserId=@UserId, DateReservation=GETDATE()
                    OUTPUT INSERTED.*
                    WHERE Id=@LigneReleveId
                      AND Lettrage IS NULL
                      AND NOT EXISTS (SELECT 1 FROM dbo.RAPP_ReleveBancaire_Ligne x WHERE x.MV_ID=@MvId);
                ";
                var result = await connection.QuerySingleOrDefaultAsync<ReleveBancaireLigne>(sql, new { 
                    Lettrage = lettrage, MvId = mvId, UserId = userId, LigneReleveId = ligneReleveId 
                });
                return result;
            }
        }

        public async Task<bool> LibererLigneAsync(int ligneReleveId, int userId)
        {
            using (var connection = new SqlConnection(_connectionString))
            {
                await connection.OpenAsync();
                string sql = @"
                    UPDATE dbo.RAPP_ReleveBancaire_Ligne
                    SET Lettrage=NULL, MV_ID=NULL, ReservePar_UserId=NULL, DateReservation=NULL
                    WHERE Id=@LigneReleveId AND ReservePar_UserId=@UserId AND DateValidation IS NULL;
                ";
                var rowCount = await connection.ExecuteAsync(sql, new { LigneReleveId = ligneReleveId, UserId = userId });
                return rowCount > 0;
            }
        }

        public async Task<object?> GetLigneConflitAsync(int ligneReleveId, int mvId)
        {
            using (var connection = new SqlConnection(_connectionString))
            {
                await connection.OpenAsync();
                string sql = @"
                    SELECT ReservePar_UserId, DateReservation 
                    FROM dbo.RAPP_ReleveBancaire_Ligne 
                    WHERE Id=@LigneReleveId OR MV_ID=@MvId
                ";
                return await connection.QueryFirstOrDefaultAsync<object>(sql, new { LigneReleveId = ligneReleveId, MvId = mvId });
            }
        }

        public async Task<ValidationResultDto> SauvegarderValidationAsync(List<ValidationPairDto> paires, int userId)
        {
            var result = new ValidationResultDto();

            // 1. Re-check de réservation en une seule passe, on ferme la connexion avant la suite
            var pairesValides = new List<ValidationPairDto>();
            using (var connection = new System.Data.SqlClient.SqlConnection(_connectionString))
            {
                await connection.OpenAsync();
                
                foreach (var pair in paires)
                {
                    string sqlCheck = @"
                        SELECT ReservePar_UserId FROM [dbo].[RAPP_ReleveBancaire_Ligne]
                        WHERE Id = @ReleveLigneId AND MV_ID = @GrcReglementId";
                    
                    var reserverId = await connection.QueryFirstOrDefaultAsync<int?>(sqlCheck, pair);
                    if (reserverId == null || reserverId != userId)
                    {
                        result.ErrorCount++;
                        result.FailedLigneIds.Add(pair.ReleveLigneId);
                        result.Errors.Add($"La ligne {pair.ReleveLigneId} n'est pas réservée par vous ou a été libérée/volée.");
                    }
                    else
                    {
                        pairesValides.Add(pair);
                    }
                }
            }

            // 2. Boucle DLL sans chevauchement de connexion, traitement par item
            var connProvider = new global::Tresorerie.Dapper.ConnectionProvider();
            connProvider.ConnectionString = _connectionString;
            var repo = new global::Tresorerie.Dapper.Repositories.ReglementClientRepository(connProvider);
            var successLigneIds = new List<int>();

            foreach (var pair in pairesValides)
            {
                try
                {
                    var reg = repo.Get(pair.GrcReglementId);
                    if (reg == null)
                    {
                        throw new Exception($"Le règlement {pair.GrcReglementId} n'existe pas.");
                    }

                    if (reg.IsPointe)
                    {
                        throw new InvalidOperationException($"Le règlement {reg.No} est déjà pointé et ne peut pas être rapproché à nouveau.");
                    }

                    reg.IsPointe = true;
                    reg.ExtraitNum = pair.CodeExcel;
                    reg.Info1 = pair.CodeExcel;
                    
                    if ((int)reg.Type == 3) // Ordre Extrait
                    {
                        reg.PieceNumero = pair.CodeExcel;
                    }

                    if (pair.DateValeur.HasValue)
                    {
                        reg.DatePointage = pair.DateValeur.Value;
                    }

                    repo.Update(reg);
                    result.SuccessCount++;
                    successLigneIds.Add(pair.ReleveLigneId);
                }
                catch (Exception ex)
                {
                    result.ErrorCount++;
                    result.FailedLigneIds.Add(pair.ReleveLigneId);
                    result.Errors.Add($"Erreur sur la paire (Ligne: {pair.ReleveLigneId}, Reglement: {pair.GrcReglementId}) : {ex.Message}");
                }
            }

            if (successLigneIds.Any())
            {
                using (var connection = new System.Data.SqlClient.SqlConnection(_connectionString))
                {
                    await connection.OpenAsync();
                    string sqlUpdate = @"
                        UPDATE dbo.RAPP_ReleveBancaire_Ligne 
                        SET DateValidation = GETDATE() 
                        WHERE Id IN @Ids";
                    await connection.ExecuteAsync(sqlUpdate, new { Ids = successLigneIds });
                }
            }

            result.Success = result.ErrorCount == 0;
            return result;
        }
    }

    public class ValidationPairDto
    {
        public int ReleveLigneId { get; set; }
        public int GrcReglementId { get; set; }
        public string? Lettrage { get; set; }
        public string? CodeExcel { get; set; }
        public DateTime? DateValeur { get; set; }
    }

    public class ValidationResultDto
    {
        public bool Success { get; set; }
        public int SuccessCount { get; set; }
        public int ErrorCount { get; set; }
        public List<string> Errors { get; set; } = new List<string>();
        public List<int> FailedLigneIds { get; set; } = new List<int>();
    }

    public class LigneEtatRapprochementDto
    {
        // Ligne relevé
        public int Id { get; set; }
        public DateTime? DateOperation { get; set; }
        public DateTime? DateValeur { get; set; }
        public string? Libelle { get; set; }
        public string? Reference { get; set; }
        public string? Code { get; set; }
        public decimal? Debit { get; set; }
        public decimal? Credit { get; set; }
        public decimal? MontantReel { get; set; }
        // État
        public string Statut { get; set; } = "NonRapproche"; // "NonRapproche" | "Reserve" | "Valide"
        public string? Lettrage { get; set; }
        public int? MV_ID { get; set; }
        public int? ReservePar_UserId { get; set; }
        public string? ReservePar_UserName { get; set; }
        public DateTime? DateReservation { get; set; }
        public DateTime? DateValidation { get; set; }
        // Règlement GRC lié (null si MV_ID null ou règlement introuvable)
        public string? ReglementNumero { get; set; }
        public DateTime? ReglementDate { get; set; }
        public int? ReglementCaisseNo { get; set; }
        public string? ReglementClient { get; set; }
    }
}
