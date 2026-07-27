using System.Reflection;
using System.Runtime.ExceptionServices;
using System.Threading;
using Tresorerie.Erp.ICore;

namespace GRC.Infrastructure.Tresorerie;

/// <summary>
/// TASK-036 — Contexte d'exécution portant le n° de pièce à forcer (MV_Piece).
/// Positionné par <c>ReglementService</c> avant chaque comptabilisation / aperçu, lu par le
/// décorateur dans <c>GetNextNumero</c>. AsyncLocal : isolé par itération de <c>Parallel.ForEach</c>.
/// Transparent tant que <see cref="ForcedPiece"/> est null (comportement Sage normal).
/// </summary>
public static class ComptaPieceContext
{
    private static readonly AsyncLocal<string?> _forcedPiece = new();

    /// <summary>Pièce à renvoyer par GetNextNumero, ou null pour déléguer au compteur Sage (caisse/espèce).</summary>
    public static string? ForcedPiece
    {
        get => _forcedPiece.Value;
        set => _forcedPiece.Value = value;
    }
}

/// <summary>
/// TASK-036 — Décorateur de <see cref="IErpComptaService"/> (impl. concrète : SageCompta.Core.ErpCompta).
/// Délègue tout à l'instance réelle, SAUF <c>GetNextNumero</c> : si <see cref="ComptaPieceContext.ForcedPiece"/>
/// est positionné, renvoie cette pièce (MV_Piece) au lieu du compteur Sage. Le comptabilizer comme le
/// générateur d'écritures passent par GetNextNumero → l'aperçu et la compta réelle restent cohérents.
///
/// Implémenté via <see cref="DispatchProxy"/> pour éviter d'écrire à la main les ~40 membres de l'interface
/// (aucune modif des DLL métier — interception pure côté IoC).
/// </summary>
public class ErpComptaPieceDecorator : DispatchProxy
{
    private IErpComptaService _inner = null!;

    public static IErpComptaService Wrap(IErpComptaService inner)
    {
        var proxy = Create<IErpComptaService, ErpComptaPieceDecorator>();
        ((ErpComptaPieceDecorator)(object)proxy!)._inner = inner;
        return (IErpComptaService)proxy!;
    }

    protected override object? Invoke(MethodInfo? targetMethod, object?[]? args)
    {
        if (targetMethod is null)
            return null;

        if (targetMethod.Name == nameof(IErpComptaService.GetNextNumero))
        {
            var forced = ComptaPieceContext.ForcedPiece;
            if (!string.IsNullOrEmpty(forced))
                return forced;
        }

        try
        {
            return targetMethod.Invoke(_inner, args);
        }
        catch (TargetInvocationException tie) when (tie.InnerException != null)
        {
            // Préserver l'exception métier réelle (journal clôturé, écritures déséquilibrées, …)
            // que DispatchProxy encapsule sinon dans un TargetInvocationException générique.
            ExceptionDispatchInfo.Capture(tie.InnerException).Throw();
            throw; // inatteignable
        }
    }
}
