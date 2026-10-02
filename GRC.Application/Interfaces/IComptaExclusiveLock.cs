using System;

namespace GRC.Application.Interfaces
{
    public static class ComptaOperations
    {
        public const string Comptabilisation = "comptabilisation";
        public const string LettrageParPeriode = "lettrage par période";
    }

    public sealed record ComptaLockHolder(string Operation, int UserId, int Count, DateTime StartedAt)
    {
        public string MessageRefus()
        {
            int m = (int)Math.Floor(Math.Max(0, (DateTime.Now - StartedAt).TotalMinutes));
            string hhmm = StartedAt.ToString("HH:mm");

            if (Operation == ComptaOperations.LettrageParPeriode)
            {
                return $"Une opération comptable est déjà en cours : {Operation}, lancée à {hhmm} par l'utilisateur {UserId} (depuis {m} min). Réessayez quand elle sera terminée.";
            }

            return $"Une opération comptable est déjà en cours : {Operation}, lancée à {hhmm} par l'utilisateur {UserId} ({Count} élément(s), depuis {m} min). Réessayez quand elle sera terminée.";
        }
    }

    public interface IComptaExclusiveLock
    {
        // Prend le verrou sans attendre. true => handle à disposer (using) ; false => holder renseigné.
        bool TryEnter(string operation, int userId, int count, out IDisposable? handle, out ComptaLockHolder? holder);
    }
}
