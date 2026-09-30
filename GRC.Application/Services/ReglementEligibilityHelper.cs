using System;

namespace GRC.Application.Services
{
    public static class ReglementEligibilityHelper
    {
        // TASK-098 : Un règlement annulé (MV_Annule = 1) n'est jamais éligible au rapprochement bancaire
        public static bool EstEligibleRappBancaire(int mvType, int mvRemis, bool isAnnule)
        {
            // MV_Type == 3 : Virement
            // MV_Type IN (1, 2) : Chèque (1) / Traite (2)
            // MV_Remis == 2 : REMIS en banque
            return !isAnnule && (mvType == 3 || ((mvType == 1 || mvType == 2) && mvRemis == 2));
        }
    }
}
