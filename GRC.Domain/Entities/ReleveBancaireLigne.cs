using System;

namespace GRC.Domain.Entities
{
    public class ReleveBancaireLigne
    {
        public int Id { get; set; }
        public int ReleveBancaireEnteteId { get; set; }
        
        public DateTime? DateOperation { get; set; }
        public DateTime? DateValeur { get; set; }
        public string Libelle { get; set; }
        public string Reference { get; set; }
        public string Code { get; set; }
        
        public decimal? Debit { get; set; }
        public decimal? Credit { get; set; }
        public decimal? MontantReel { get; set; }
        
        public string Lettrage { get; set; }
        public int? MV_ID { get; set; }
        
        public int? ReservePar_UserId { get; set; }
        public string ReservePar_UserName { get; set; }
        public DateTime? DateReservation { get; set; }
        public DateTime? DateValidation { get; set; }

        public ReleveBancaireEntete Entete { get; set; }
    }
}
