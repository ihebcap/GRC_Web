using System;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.Linq;
using System.Threading.Tasks;
using Dapper;
using GRC.Domain.Entities;
using GRC.Application.Interfaces;
using Microsoft.Extensions.Logging;

namespace GRC.Infrastructure.Repositories
{
    public class ReleveBancaireRepository
    {
        private readonly string _connectionString;
        private readonly ILogger<ReleveBancaireRepository> _logger;

        public ReleveBancaireRepository(IDbConnectionFactory connectionFactory, ILogger<ReleveBancaireRepository> logger)
        {
            _connectionString = connectionFactory.GetConnectionString();
            _logger = logger;
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

        // TASK-037 : la lettre est CALCULEE cote serveur (la lettre proposee par le client est ignoree).
        // Calcul + ecriture serialises par releve via sp_getapplock dans une transaction (pas de check-then-act).
        public async Task<ReleveBancaireLigne?> ReserverLigneAsync(int ligneReleveId, int mvId, int userId)
        {
            using (var connection = new SqlConnection(_connectionString))
            {
                await connection.OpenAsync();
                using (var transaction = connection.BeginTransaction())
                {
                    try
                    {
                        // 1. Deriver l'entete depuis la ligne.
                        var enteteId = await connection.QuerySingleOrDefaultAsync<int?>(
                            "SELECT ReleveBancaireEnteteId FROM dbo.RAPP_ReleveBancaire_Ligne WHERE Id=@Id",
                            new { Id = ligneReleveId }, transaction);
                        if (enteteId == null)
                        {
                            _logger.LogInformation("RÉSERVATION : ligne {LigneReleveId} introuvable (enteteId null) → conflit/409", ligneReleveId);
                            transaction.Rollback();
                            return null;
                        }
                        _logger.LogInformation("RÉSERVATION : ligne={LigneReleveId}, mvId={MvId}, enteteId dérivé={EnteteId}", ligneReleveId, mvId, enteteId.Value);

                        // 2. Verrou applicatif EXCLUSIF par releve, tenu jusqu'a la fin de la transaction :
                        //    empeche deux reservations concurrentes de lire le meme "max".
                        var lockResult = await connection.ExecuteScalarAsync<int>(
                            "DECLARE @r INT; EXEC @r = sp_getapplock @Resource=@Resource, @LockMode='Exclusive', @LockOwner='Transaction', @LockTimeout=15000; SELECT @r;",
                            new { Resource = "rapp_lettrage_" + enteteId.Value.ToString() }, transaction);
                        _logger.LogInformation("RÉSERVATION : sp_getapplock enteteId={EnteteId} → lockResult={LockResult}", enteteId.Value, lockResult);
                        if (lockResult < 0)
                        {
                            // Verrou non obtenu (timeout / deadlock) -> traite comme un conflit.
                            _logger.LogInformation("RÉSERVATION : verrou non obtenu (lockResult={LockResult}) enteteId={EnteteId} → conflit/409", lockResult, enteteId.Value);
                            transaction.Rollback();
                            return null;
                        }

                        // 3. Lettres presentes du releve -> prochaine libre en C# via LettrageGenerator (base 26).
                        //    Regle : max present + 1 (coherent avec l'ancienne logique client ; une lettre
                        //    liberee par delettrage peut etre reattribuee).
                        var lettresPresentes = (await connection.QueryAsync<string>(
                            @"SELECT Lettrage FROM dbo.RAPP_ReleveBancaire_Ligne
                              WHERE ReleveBancaireEnteteId=@EnteteId AND Lettrage IS NOT NULL",
                            new { EnteteId = enteteId.Value }, transaction)).ToList();

                        int maxIndex = 0;
                        foreach (var l in lettresPresentes)
                        {
                            var idx = GRC.Application.Services.LettrageGenerator.GetIndexFromLettrage(l);
                            if (idx > maxIndex) maxIndex = idx;
                        }
                        string lettreServeur = GRC.Application.Services.LettrageGenerator.GetLettrage(maxIndex + 1);
                        _logger.LogInformation("RÉSERVATION : enteteId={EnteteId}, maxIndex={MaxIndex} → lettre calculée={Lettre}", enteteId.Value, maxIndex, lettreServeur);

                        // 4. UPDATE conditionnel : ligne encore libre ET MV_ID pas deja reserve.
                        string sql = @"
                            UPDATE dbo.RAPP_ReleveBancaire_Ligne
                            SET Lettrage=@Lettrage, MV_ID=@MvId, ReservePar_UserId=@UserId, DateReservation=GETDATE()
                            OUTPUT INSERTED.*
                            WHERE Id=@LigneReleveId
                              AND Lettrage IS NULL
                              AND NOT EXISTS (SELECT 1 FROM dbo.RAPP_ReleveBancaire_Ligne x WHERE x.MV_ID=@MvId);
                        ";
                        var result = await connection.QuerySingleOrDefaultAsync<ReleveBancaireLigne>(sql, new {
                            Lettrage = lettreServeur, MvId = mvId, UserId = userId, LigneReleveId = ligneReleveId
                        }, transaction);

                        // 5. rowcount 0 -> rollback -> 409 ; rowcount 1 -> commit, on renvoie la ligne (avec Lettrage).
                        if (result == null)
                        {
                            _logger.LogInformation("RÉSERVATION : UPDATE rowcount=0 (ligne déjà lettrée ou mvId={MvId} déjà réservé) → conflit/409", mvId);
                            transaction.Rollback();
                            return null;
                        }

                        transaction.Commit();
                        _logger.LogInformation("RÉSERVATION : commit OK ligne={LigneReleveId}, mvId={MvId}, lettre={Lettre}", ligneReleveId, mvId, result.Lettrage);
                        return result;
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError(ex, "RÉSERVATION : exception, rollback ligne={LigneReleveId}, mvId={MvId}", ligneReleveId, mvId);
                        transaction.Rollback();
                        throw;
                    }
                }
            }
        }

        // TASK-066 : version lot de ReserverLigneAsync — un seul aller-retour réseau au lieu de N.
        // Même logique (lettre calculée serveur, verrou applock par enteteId), mais :
        // - une seule connexion/transaction pour tout le lot,
        // - le verrou sp_getapplock par enteteId n'est pris qu'UNE FOIS par enteteId distinct du lot
        //   (déjà tenu pour la transaction entière -> pas de gain/perte de sérialisation vs boucle unitaire),
        // - chaque paire est traitée indépendamment (une paire en conflit n'annule pas les autres),
        // - la numérotation de lettre progresse en mémoire au fil du lot (pas de re-lecture DB par paire).
        public async Task<List<ReserveBatchItemResultDto>> ReserverLignesBatchAsync(List<ReserveBatchItemDto> items, int userId)
        {
            var resultats = new List<ReserveBatchItemResultDto>();
            if (items == null || items.Count == 0) return resultats;

            using (var connection = new SqlConnection(_connectionString))
            {
                await connection.OpenAsync();
                using (var transaction = connection.BeginTransaction())
                {
                    try
                    {
                        // 1. Dériver l'enteteId de chaque ligne en une seule requête.
                        var ligneIds = items.Select(i => i.LigneReleveId).Distinct().ToList();
                        var enteteParLigne = (await connection.QueryAsync<(int LigneId, int EnteteId)>(
                            "SELECT Id AS LigneId, ReleveBancaireEnteteId AS EnteteId FROM dbo.RAPP_ReleveBancaire_Ligne WHERE Id IN @Ids",
                            new { Ids = ligneIds }, transaction))
                            .ToDictionary(x => x.LigneId, x => x.EnteteId);

                        // 2. Verrou applock par enteteId distinct, pris une seule fois (tenu pour la transaction).
                        var entetesDistincts = enteteParLigne.Values.Distinct().ToList();
                        var maxIndexParEntete = new Dictionary<int, int>();
                        foreach (var enteteId in entetesDistincts)
                        {
                            var lockResult = await connection.ExecuteScalarAsync<int>(
                                "DECLARE @r INT; EXEC @r = sp_getapplock @Resource=@Resource, @LockMode='Exclusive', @LockOwner='Transaction', @LockTimeout=15000; SELECT @r;",
                                new { Resource = "rapp_lettrage_" + enteteId.ToString() }, transaction);
                            if (lockResult < 0)
                            {
                                _logger.LogInformation("RÉSERVATION LOT : verrou non obtenu enteteId={EnteteId}", enteteId);
                                transaction.Rollback();
                                foreach (var i in items) resultats.Add(new ReserveBatchItemResultDto { LigneReleveId = i.LigneReleveId, MvId = i.MvId, Success = false });
                                return resultats;
                            }

                            var lettresPresentes = (await connection.QueryAsync<string>(
                                @"SELECT Lettrage FROM dbo.RAPP_ReleveBancaire_Ligne
                                  WHERE ReleveBancaireEnteteId=@EnteteId AND Lettrage IS NOT NULL",
                                new { EnteteId = enteteId }, transaction)).ToList();

                            int maxIndex = 0;
                            foreach (var l in lettresPresentes)
                            {
                                var idx = GRC.Application.Services.LettrageGenerator.GetIndexFromLettrage(l);
                                if (idx > maxIndex) maxIndex = idx;
                            }
                            maxIndexParEntete[enteteId] = maxIndex;
                        }

                        // 3. Traitement séquentiel des paires (même ordre que le lot reçu), une UPDATE conditionnelle par paire.
                        string sql = @"
                            UPDATE dbo.RAPP_ReleveBancaire_Ligne
                            SET Lettrage=@Lettrage, MV_ID=@MvId, ReservePar_UserId=@UserId, DateReservation=GETDATE()
                            OUTPUT INSERTED.*
                            WHERE Id=@LigneReleveId
                              AND Lettrage IS NULL
                              AND NOT EXISTS (SELECT 1 FROM dbo.RAPP_ReleveBancaire_Ligne x WHERE x.MV_ID=@MvId);
                        ";

                        foreach (var item in items)
                        {
                            if (!enteteParLigne.TryGetValue(item.LigneReleveId, out var enteteId))
                            {
                                resultats.Add(new ReserveBatchItemResultDto { LigneReleveId = item.LigneReleveId, MvId = item.MvId, Success = false });
                                continue;
                            }

                            int nextIndex = maxIndexParEntete[enteteId] + 1;
                            string lettreServeur = GRC.Application.Services.LettrageGenerator.GetLettrage(nextIndex);

                            var result = await connection.QuerySingleOrDefaultAsync<ReleveBancaireLigne>(sql, new
                            {
                                Lettrage = lettreServeur,
                                MvId = item.MvId,
                                UserId = userId,
                                LigneReleveId = item.LigneReleveId
                            }, transaction);

                            if (result == null)
                            {
                                _logger.LogInformation("RÉSERVATION LOT : conflit ligne={LigneReleveId}, mv={MvId}", item.LigneReleveId, item.MvId);
                                resultats.Add(new ReserveBatchItemResultDto { LigneReleveId = item.LigneReleveId, MvId = item.MvId, Success = false });
                            }
                            else
                            {
                                maxIndexParEntete[enteteId] = nextIndex;
                                resultats.Add(new ReserveBatchItemResultDto { LigneReleveId = item.LigneReleveId, MvId = item.MvId, Success = true, Lettrage = result.Lettrage });
                            }
                        }

                        transaction.Commit();
                        _logger.LogInformation("RÉSERVATION LOT : commit OK — {Success}/{Total} succès", resultats.Count(r => r.Success), items.Count);
                        return resultats;
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError(ex, "RÉSERVATION LOT : exception, rollback");
                        transaction.Rollback();
                        throw;
                    }
                }
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
                        SELECT ReservePar_UserId, DateOperation FROM [dbo].[RAPP_ReleveBancaire_Ligne]
                        WHERE Id = @ReleveLigneId AND MV_ID = @GrcReglementId";
                    
                    var row = await connection.QueryFirstOrDefaultAsync<ReleveBancaireLigne>(sqlCheck, pair);
                    if (row == null || row.ReservePar_UserId != userId)
                    {
                        _logger.LogWarning(
                            "APPROBATION re-check REJET : ligne={LigneReleveId}, mv={MvId} — réservation volée/libérée (réservataire={Reservataire}, attendu userId={UserId})",
                            pair.ReleveLigneId, pair.GrcReglementId, row?.ReservePar_UserId, userId);
                        result.ErrorCount++;
                        result.FailedLigneIds.Add(pair.ReleveLigneId);
                        result.Errors.Add($"La ligne {pair.ReleveLigneId} n'est pas réservée par vous ou a été libérée/volée.");
                    }
                    else
                    {
                        pair.DateOperation = row.DateOperation;
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

                    if (pair.DateOperation.HasValue)
                    {
                        var dateOp = pair.DateOperation.Value;

                        // Date rapprochement : toujours (marqueur, non comptable)
                        reg.DatePointage = dateOp;

                        // Date règlement + date échéance : uniquement si NON comptabilisé (sécurité comptable)
                        // ChangeDate AVANT IsPointe (setter Date privé + garde règlement pointé) — invariant TASK-031
                        if (reg.IsComptabilise == global::Tresorerie.Core.Enum.EtatComptabilite.NonComptabilise)
                        {
                            _logger.LogInformation(
                                "APPROBATION item : mv={MvId} non comptabilisé → ChangeDate {AncienneDate:yyyy-MM-dd} → {NouvelleDate:yyyy-MM-dd}, DateEcheance idem",
                                reg.No, reg.Date, dateOp);
                            // Contournement garde affectation (choix métier) : ChangeDate refuse tout
                            // règlement affecté à une échéance. On reproduit ses 5 AUTRES gardes et on
                            // saute uniquement la garde affectation, puis on pose Date via le setter privé.
                            // Aucune écriture sur l'affectation : le lien règlement↔facture est préservé.
                            SetDateBypassAffectation(reg, dateOp);   // MV_Date
                            reg.DateEcheance = dateOp;               // MV_DateEcheance (setter public)
                        }
                        else
                        {
                            _logger.LogInformation(
                                "APPROBATION item : mv={MvId} comptabilisé (IsComptabilise={Etat}) → ChangeDate ignoré (sécurité comptable)",
                                reg.No, (int)reg.IsComptabilise);
                        }
                    }

                    reg.IsPointe = true;
                    reg.ExtraitNum = pair.CodeExcel;
                    reg.Info1 = pair.CodeExcel;

                    // On affecte le n° pièce pour tout règlement (plus de garde type 3)
                    reg.PieceNumero = pair.CodeExcel;

                    repo.Update(reg);
                    _logger.LogInformation(
                        "APPROBATION item OK : ligne={LigneReleveId}, mv={MvId}, IsPointe=true, MV_Piece={Piece}, DatePointage={DatePointage:yyyy-MM-dd}",
                        pair.ReleveLigneId, reg.No, pair.CodeExcel, reg.DatePointage);
                    result.SuccessCount++;
                    successLigneIds.Add(pair.ReleveLigneId);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex,
                        "APPROBATION item ÉCHEC : ligne={LigneReleveId}, mv={MvId} — message DLL : {Message}",
                        pair.ReleveLigneId, pair.GrcReglementId, ex.Message);
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
                    var rowCount = await connection.ExecuteAsync(sqlUpdate, new { Ids = successLigneIds });
                    _logger.LogInformation(
                        "APPROBATION : UPDATE DateValidation ids={Ids} → rowcount={RowCount}",
                        string.Join(",", successLigneIds), rowCount);
                }
            }

            result.Success = result.ErrorCount == 0;
            _logger.LogInformation(
                "APPROBATION récap : Success={Success}, SuccessCount={SuccessCount}, ErrorCount={ErrorCount}, FailedLigneIds={FailedLigneIds}",
                result.Success, result.SuccessCount, result.ErrorCount, string.Join(",", result.FailedLigneIds));
            return result;
        }
        public async Task<int> SupprimerReleveAsync(int enteteId)
        {
            using (var connection = new System.Data.SqlClient.SqlConnection(_connectionString))
            {
                await connection.OpenAsync();
                
                var exists = await connection.ExecuteScalarAsync<int>("SELECT COUNT(1) FROM dbo.RAPP_ReleveBancaire_Entete WHERE Id = @Id", new { Id = enteteId });
                if (exists == 0) return -1;

                using (var transaction = connection.BeginTransaction())
                {
                    try
                    {
                        var sqlDeleteLignes = @"
                            DELETE FROM dbo.RAPP_ReleveBancaire_Ligne
                            WHERE ReleveBancaireEnteteId = @Id
                              AND NOT EXISTS (
                                SELECT 1 FROM dbo.RAPP_ReleveBancaire_Ligne x
                                WHERE x.ReleveBancaireEnteteId = @Id
                                  AND (x.Lettrage IS NOT NULL OR x.MV_ID IS NOT NULL OR x.DateValidation IS NOT NULL)
                              );";
                              
                        await connection.ExecuteAsync(sqlDeleteLignes, new { Id = enteteId }, transaction);
                        
                        int remainingLines = await connection.ExecuteScalarAsync<int>("SELECT COUNT(1) FROM dbo.RAPP_ReleveBancaire_Ligne WHERE ReleveBancaireEnteteId = @Id", new { Id = enteteId }, transaction);
                        
                        if (remainingLines > 0)
                        {
                            transaction.Rollback();
                            return 0; // Refused (lines actioned)
                        }
                        
                        await connection.ExecuteAsync("DELETE FROM dbo.RAPP_ReleveBancaire_Entete WHERE Id = @Id", new { Id = enteteId }, transaction);
                        transaction.Commit();
                        return 1; // Deleted
                    }
                    catch
                    {
                        transaction.Rollback();
                        throw;
                    }
                }
            }
        }

        // Setter privé ReglementClient.Date, résolu une fois (ChangeDate n'expose pas la date autrement).
        private static readonly System.Reflection.MethodInfo _setDate =
            typeof(global::Tresorerie.Core.Models.ReglementClient)
                .GetProperty("Date", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance)
                ?.GetSetMethod(nonPublic: true)
            ?? throw new InvalidOperationException("ReglementClient.Date : setter introuvable par réflexion.");

        // Reproduit les gardes de ReglementClient.ChangeDate SAUF la garde affectation (contournement métier
        // validé, voie A). Toute autre sécurité comptable (annulé/comptabilisé/remis/remplacé/pointé) reste active.
        private static void SetDateBypassAffectation(global::Tresorerie.Core.Models.ReglementClient reg, DateTime date)
        {
            if (reg.IsAnnule)
                throw new InvalidOperationException("Le règlement est annulé.");
            if ((int)reg.IsComptabilise == 1)
                throw new InvalidOperationException($"Le règlement {reg.No} est comptabilisé : date non modifiable.");
            if ((int)reg.IsRemis == 1)
                throw new InvalidOperationException($"Le règlement {reg.No} est remis : date non modifiable.");
            if (reg.GetRemplacements().Any())
                throw new InvalidOperationException($"Le règlement {reg.No} est déjà remplacé : date non modifiable.");
            if (reg.IsPointe)
                throw new InvalidOperationException($"Le règlement {reg.No} est déjà pointé : date non modifiable.");
            // Garde affectation volontairement omise.
            _setDate.Invoke(reg, new object[] { date });
        }

        public async Task<ReleveLigneGenerationDto?> GetLignePourGenerationAsync(long ligneReleveId)
        {
            using (var connection = new System.Data.SqlClient.SqlConnection(_connectionString))
            {
                await connection.OpenAsync();
                string sql = @"
                    SELECT 
                        l.Id,
                        l.DateOperation,
                        l.Credit,
                        l.Lettrage,
                        e.BanqueId
                    FROM dbo.RAPP_ReleveBancaire_Ligne l
                    INNER JOIN dbo.RAPP_ReleveBancaire_Entete e ON e.Id = l.ReleveBancaireEnteteId
                    WHERE l.Id = @Id;
                ";
                return await connection.QueryFirstOrDefaultAsync<ReleveLigneGenerationDto>(sql, new { Id = ligneReleveId });
            }
        }
    }

    public class ReserveBatchItemDto
    {
        public int LigneReleveId { get; set; }
        public int MvId { get; set; }
    }

    public class ReserveBatchItemResultDto
    {
        public int LigneReleveId { get; set; }
        public int MvId { get; set; }
        public bool Success { get; set; }
        public string? Lettrage { get; set; }
    }

    public class ValidationPairDto
    {
        public int ReleveLigneId { get; set; }
        public int GrcReglementId { get; set; }
        public string? Lettrage { get; set; }
        public string? CodeExcel { get; set; }
        public DateTime? DateValeur { get; set; }
        public DateTime? DateOperation { get; set; }
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

    public class ReleveLigneGenerationDto
    {
        public long Id { get; set; }
        public DateTime DateOperation { get; set; }
        public decimal Credit { get; set; }
        public string? Lettrage { get; set; }
        public int BanqueId { get; set; }
    }
}
