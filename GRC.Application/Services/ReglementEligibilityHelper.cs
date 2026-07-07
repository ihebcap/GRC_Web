using System;

namespace GRC.Application.Services
{
    public static class ReglementEligibilityHelper
    {
        public static bool EstEligibleRappBancaire(int mvType, int mvRemis)
        {
            // MV_Type == 3 : Virement
            // MV_Type IN (1, 2) : Chèque (1) / Traite (2)
            // MV_Remis == 2 : REMIS en banque
            return mvType == 3 || ((mvType == 1 || mvType == 2) && mvRemis == 2);
        }
    }
}
