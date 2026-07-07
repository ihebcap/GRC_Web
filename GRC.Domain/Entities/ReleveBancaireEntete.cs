using System;
using System.Collections.Generic;

namespace GRC.Domain.Entities
{
    public class ReleveBancaireEntete
    {
        public int Id { get; set; }
        public int? BanqueId { get; set; }
        public string Titre { get; set; }
        public DateTime DateImport { get; set; }
        public string ImportePar_UserId { get; set; }

        public List<ReleveBancaireLigne> Lignes { get; set; } = new List<ReleveBancaireLigne>();
    }

    public class ReleveBancaireListItemDto
    {
        public int Id { get; set; }
        public int? BanqueId { get; set; }
        public string Titre { get; set; }
        public DateTime DateImport { get; set; }
        public string ImportePar_UserId { get; set; }
        
        public int TotalLignes { get; set; }
        public int NbReserve { get; set; }
        public int NbRapproche { get; set; }
        public int NbSansAction { get; set; }
    }
}
