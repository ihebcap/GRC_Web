using System;

namespace GRC.Application.Services
{
    /// <summary>
    /// TASK-036 — Dérivation des champs compta à partir de MV_Reference.
    /// MV_Reference est multi-valué : n° de documents (BL) séparés par '#' entre eux, sans
    /// séparateur final (ex. "BLG2600096#BLG2600100" ; cas courant : un seul BL "BLG2601870").
    /// Aucun n° de document ne doit jamais être coupé.
    /// </summary>
    public static class MvReferenceHelper
    {
        /// <summary>1er n° de document de MV_Reference (token avant le 1er '#') → EcritureComptable.Reference.</summary>
        public static string FirstDoc(string? mvReference)
        {
            if (string.IsNullOrEmpty(mvReference)) return string.Empty;
            int idx = mvReference.IndexOf('#');
            return idx < 0 ? mvReference : mvReference.Substring(0, idx);
        }

        /// <summary>
        /// Répartit MV_Reference sur 2 zones de <paramref name="maxLen"/> car. (69 par défaut),
        /// découpage au séparateur '#' uniquement. Le '#' n'est conservé qu'ENTRE deux tokens
        /// (jamais en fin de zone). Un token qui ne tient dans aucune des 2 zones est abandonné
        /// (tronqué) — jamais d'erreur, jamais de blocage compta.
        /// </summary>
        public static (string DocNumero1, string DocNumero2) SplitDocNumeros(string? mvReference, int maxLen = 69)
        {
            string d1 = string.Empty, d2 = string.Empty;
            if (string.IsNullOrEmpty(mvReference)) return (d1, d2);

            foreach (var token in mvReference.Split('#', StringSplitOptions.RemoveEmptyEntries))
            {
                if (Fits(d1, token, maxLen)) { d1 = Append(d1, token); continue; }
                if (Fits(d2, token, maxLen)) { d2 = Append(d2, token); }
                // sinon : token abandonné (au-delà de 2×maxLen car.)
            }
            return (d1, d2);

            // Longueur si on ajoute le token : +1 pour le '#' séparateur si la zone est déjà remplie.
            static bool Fits(string zone, string token, int max)
                => (zone.Length == 0 ? token.Length : zone.Length + 1 + token.Length) <= max;

            static string Append(string zone, string token)
                => zone.Length == 0 ? token : zone + "#" + token;
        }
    }
}
