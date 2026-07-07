using System;
using System.Collections.Generic;
using System.Linq;
using GRC.Domain.Entities;

namespace GRC.Application.Services
{
    // DTO représentant un règlement de la GRC pour le besoin du calcul
    public class GrcReglementDto
    {
        public int MV_ID { get; set; }
        public decimal Montant { get; set; }
    }

    // Résultat du rapprochement retourné à l'interface
    public class ReconciliationMatch
    {
        public int LigneReleveId { get; set; }
        public int ReglementGrcId { get; set; }
        public decimal Montant { get; set; }
        public string LettragePropose { get; set; }
    }

    public class AutoReconciliationEngine
    {
        /// <summary>
        /// Calcule les propositions de rapprochement strictement sur le principe de "1=1 sur le montant".
        /// </summary>
        public List<ReconciliationMatch> CalculerPropositions(
            List<ReleveBancaireLigne> lignesReleve, 
            List<GrcReglementDto> reglementsGrc,
            int startIndexLettrage = 1)
        {
            var matches = new List<ReconciliationMatch>();
            
            // 1. Appliquer le filtre métier : Uniquement les Encaissements (Crédit > 0) non lettrés
            var encaissements = lignesReleve
                .Where(l => l.Credit.HasValue && l.Credit.Value > 0 && string.IsNullOrEmpty(l.Lettrage))
                .ToList();
            
            // 2. Grouper les lignes de relevé par montant (On ne garde que les montants uniques)
            var groupesReleve = encaissements
                .GroupBy(l => l.Credit.Value)
                .Where(g => g.Count() == 1) // Règle stricte : 1 seule ligne pour ce montant
                .ToDictionary(g => g.Key, g => g.First());
                                             
            // 3. Grouper les règlements GRC par montant (On ne garde que les montants uniques)
            var groupesGrc = reglementsGrc
                .GroupBy(r => r.Montant)
                .Where(g => g.Count() == 1) // Règle stricte : 1 seul règlement pour ce montant
                .ToDictionary(g => g.Key, g => g.First());
                                          
            // 4. Croiser les deux (Intersection parfaite)
            int currentIndex = startIndexLettrage;
            
            foreach (var kvp in groupesReleve)
            {
                var montant = kvp.Key;
                
                // Si on trouve le même montant unique côté GRC
                if (groupesGrc.TryGetValue(montant, out var reglementGrc))
                {
                    var ligneReleve = kvp.Value;
                    string lettre = LettrageGenerator.GetLettrage(currentIndex);
                    
                    matches.Add(new ReconciliationMatch 
                    {
                        LigneReleveId = ligneReleve.Id,
                        ReglementGrcId = reglementGrc.MV_ID,
                        Montant = montant,
                        LettragePropose = lettre
                    });
                    
                    currentIndex++;
                }
            }
            
            return matches;
        }
    }

    /// <summary>
    /// Utilitaire pour générer des lettres (A, B, C... Z, AA, AB...) à la manière des colonnes Excel
    /// </summary>
    public static class LettrageGenerator
    {
        public static string GetLettrage(int index)
        {
            if (index <= 0) throw new ArgumentOutOfRangeException(nameof(index), "L'index doit être supérieur à 0.");
            
            string lettrage = string.Empty;
            while (index > 0)
            {
                int modulo = (index - 1) % 26;
                lettrage = Convert.ToChar('A' + modulo) + lettrage;
                index = (index - modulo) / 26;
            }
            return lettrage;
        }

        public static int GetIndexFromLettrage(string? lettrage)
        {
            if (string.IsNullOrEmpty(lettrage)) return 0;
            int index = 0;
            foreach (char c in lettrage.ToUpper())
            {
                if (c < 'A' || c > 'Z') continue;
                index = index * 26 + (c - 'A' + 1);
            }
            return index;
        }
    }
}
