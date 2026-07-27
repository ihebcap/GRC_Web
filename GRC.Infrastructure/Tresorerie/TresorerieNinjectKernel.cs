using System.Linq;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Ninject;
using Ninject.Modules;
using Tresorerie.ApplicationServices.Interfaces;
using Tresorerie.Core.Services;
using Tresorerie.Erp.ICore;
using Tresorerie.IConfiguration;
using Tresorerie.Infrastructure;

namespace GRC.Infrastructure.Tresorerie;

public sealed class TresorerieNinjectKernel : IDisposable
{
    private readonly IKernel _kernel;
    private readonly ILogger<TresorerieNinjectKernel> _logger;

    public IGroupInitializer GroupInitializer       => _kernel.Get<IGroupInitializer>();
    public IGroupeService    GroupeService          => _kernel.Get<IGroupeService>();
    public IErpCommService   ErpCommService         => _kernel.Get<IErpCommService>();
    public ITresorerieGroupConfigurationManager ConfigurationManager => _kernel.Get<ITresorerieGroupConfigurationManager>();

    public T Resolve<T>() => _kernel.Get<T>();

    public TresorerieNinjectKernel(IConfiguration configuration, ILogger<TresorerieNinjectKernel> logger)
    {
        _logger = logger;
        var libsPath = ResolveTresoreriePath();
        _logger.LogInformation("Chargement des modules Trésorerie depuis {Path}", libsPath);

        // Résolution des assemblies Trésorerie par nom (version ignorée).
        // Cherche dans libs/Tresorerie d'abord, puis dans le répertoire de l'app.
        // Nécessaire pour : Castle.Core 5.x (ref 4.0.0.0), System.Data.SqlClient (ref 0.0.0.0), etc.
        var appBase = AppContext.BaseDirectory;
        AppDomain.CurrentDomain.AssemblyResolve += (_, args) =>
        {
            var asmName = new System.Reflection.AssemblyName(args.Name!).Name;
            // Alias .NET Framework → paquet de compat .NET : les DLLs legacy référencent l'assembly
            // 'System.Configuration' (facade Framework) pour System.Configuration.ConfigurationManager,
            // fourni sous un autre nom d'assembly en .NET (System.Configuration.ConfigurationManager).
            if (asmName == "System.Configuration")
                asmName = "System.Configuration.ConfigurationManager";
            var inLibs = Path.Combine(libsPath, asmName + ".dll");
            if (File.Exists(inLibs)) return System.Reflection.Assembly.LoadFrom(inLibs);
            var inBase = Path.Combine(appBase, asmName + ".dll");
            if (File.Exists(inBase)) return System.Reflection.Assembly.LoadFrom(inBase);
            return null;
        };

        var modules = LoadIoCModules(libsPath);
        _kernel = new StandardKernel(new NinjectSettings { LoadExtensions = false }, modules);
        // Enregistre notre remplacement de Tresorerie.IoC.Application (sans Castle.DynamicProxy/Ninject.Extensions.Factory)
        _kernel.Load(new TresorerieCoreDapperReplacementModule());
        // _kernel.Load(new TresorerieApplicationServicesReplacementModule());

        // Licence no-op (pas de vérification de licence en mode GOCOM)
        _kernel.Rebind<ILicenceProvider>().ToConstant(new NopTresorerieLicenceProvider());
        // Licence APBS no-op : la chaîne GroupeService → NotifyService → ILicenceApplicationVersion
        // dépend de ApLicence.Core.ILicenceProvider. Pas de vérification en mode GOCOM.
        _kernel.Rebind<global::ApLicence.Core.ILicenceProvider>().ToConstant(new NopApLicenceProvider());

        // Contourne le group-init legacy : ConfigurationManager/GroupInitializer utilisent .NET Remoting
        // (absent en .NET 10). Comme le rapprochement, on fournit directement la connexion GOCOM au
        // IConnectionProvider partagé du kernel ; les services résolus (repos, ERP, comptabilizer) l'utilisent.
        var connStr = configuration.GetConnectionString("DefaultConnection");
        if (!string.IsNullOrEmpty(connStr))
        {
            try
            {
                var cp = _kernel.Get<global::Tresorerie.Core.Interfaces.IConnectionProvider>();
                if (cp is global::Tresorerie.Dapper.ConnectionProvider dcp)
                    dcp.ConnectionString = connStr;
                _logger.LogInformation("Connexion GOCOM fixée sur IConnectionProvider du kernel.");
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Impossible de fixer la connexion sur IConnectionProvider.");
            }
        }

        // TASK-036 : décorateur pièce comptable. Enveloppe l'implémentation réelle
        // (SageCompta.Core.ErpCompta, liée par SageComptaModulev9) pour forcer MV_Piece via
        // GetNextNumero quand ComptaPieceContext.ForcedPiece est positionné. Transparent sinon.
        ActiverDecorateurPieceComptable();

        // Services de comptabilisation (générateur d'écritures + comptabilizer règlement client +
        // helpers de désynchronisation). Normalement fournis par Tresorerie.IoC.Application (exclu
        // ici) ; on les rebinde explicitement sur leurs impl concrètes — leurs dépendances
        // (IGroupeService, IErpCommService, IErpComptaService, ILibelleComptaGenerator) sont déjà
        // bindées par les modules chargés. Requis pour l'écran de comptabilisation des règlements clients.
        ActiverServicesComptabilisation();

        // TASK-059 : TiersErpHelper/DeviseViewHelper (résolution client/devise pour l'appel direct à
        // CaisseManager.ReglementCreate) vivent dans Tresorerie.UICommun, dont le module IoC
        // (Tresorerie.IoC.UICommun) est exclu de LoadIoCModules (UI WinForms, non requis en API) —
        // binding manuel sur les classes concrètes, même patron que le décorateur pièce comptable
        // ci-dessus. Leurs dépendances (IGroupeService, IErpCommService, IErpComptaService) sont déjà
        // bindées par les modules chargés / ActiverDecorateurPieceComptable.
        ActiverHelpersUICommun();

        _logger.LogInformation("Kernel Trésorerie initialisé avec {Count} modules.", modules.Length);
    }

    private void ActiverHelpersUICommun()
    {
        try
        {
            _kernel.Bind<global::Tresorerie.UICommun.Helper.TiersErpHelper>().ToSelf();
            _kernel.Bind<global::Tresorerie.UICommun.Helper.DeviseViewHelper>().ToSelf();
            _kernel.Bind<global::Tresorerie.UICommun.Helper.CollaborateurHelper>().ToSelf();
            _logger.LogInformation("TASK-059 : TiersErpHelper/DeviseViewHelper/CollaborateurHelper (UICommun) activés.");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "TASK-059 : échec activation des helpers UICommun (Tiers/Devise).");
        }
    }

    // TASK-036 : rebind IErpComptaService → décorateur enveloppant l'impl. concrète réelle.
    // On résout le type concret par nom (pas de référence de compilation vers SageCompta.Core,
    // qui traîne des dépendances COM Sage) ; l'impl. est reconstruite par Ninject (ses deps sont
    // liées par SageComptaModulev9 dans ce même kernel).
    private void ActiverDecorateurPieceComptable()
    {
        try
        {
            var comptaImplType = AppDomain.CurrentDomain.GetAssemblies()
                .FirstOrDefault(a => a.GetName().Name == "SageCompta.Core")?
                .GetType("SageCompta.Core.ErpCompta")
                ?? System.Reflection.Assembly.Load("SageCompta.Core").GetType("SageCompta.Core.ErpCompta");

            if (comptaImplType == null)
            {
                _logger.LogWarning("TASK-036 : SageCompta.Core.ErpCompta introuvable — décorateur pièce non activé.");
                return;
            }

            _kernel.Bind(comptaImplType).ToSelf();
            _kernel.Rebind<IErpComptaService>().ToMethod(ctx =>
                ErpComptaPieceDecorator.Wrap((IErpComptaService)ctx.Kernel.Get(comptaImplType)));

            _logger.LogInformation("TASK-036 : décorateur pièce comptable activé sur IErpComptaService.");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "TASK-036 : échec activation du décorateur pièce comptable.");
        }
    }

    // Rebinde les services de comptabilisation du règlement client sur leurs impl concrètes
    // (Tresorerie.ApplicationServices), le module IoC.Application d'origine étant exclu.
    private void ActiverServicesComptabilisation()
    {
        try
        {
            var asm = System.Reflection.Assembly.Load("Tresorerie.ApplicationServices");

            // Dépendances normalement fournies par IoC.Application (exclu) et absentes du module de
            // remplacement — nécessaires à la résolution de GroupeService/NotifyService.
            var infra = System.Reflection.Assembly.Load("Tresorerie.Infrastructure");
            BindImplInterfaces(infra, "Tresorerie.Infrastructure.LicenceApplicationVersion");
            BindImplInterfaces(infra, "Tresorerie.Infrastructure.PasswordHasher");

            // Helpers de désynchronisation (dépendances du comptabilizer) : interface → impl.
            BindImplInterfaces(asm, "Tresorerie.ApplicationServices.Helper.DesynchroniserAffectationReglementHelper");
            BindImplInterfaces(asm, "Tresorerie.ApplicationServices.Helper.DeSynchroniserReglementHelper");

            // Factories de connexion (normalement générées par Ninject.Extensions.Factory via
            // .ToFactory()) : mono-méthode CreateConnectionProvider() → on résout le type de retour
            // depuis le kernel via un DispatchProxy générique. Requises par GroupInitializer.
            BindFactory(asm.GetType("Tresorerie.ApplicationServices.Interfaces.IConnectionProviderFactory"));
            BindFactory(asm.GetType("Tresorerie.ApplicationServices.Interfaces.IErpConnectionProviderFactory"));
            BindFactory(asm.GetType("Tresorerie.ApplicationServices.Interfaces.IErpExternConnectionProviderFactory"));

            // Initialiseur de groupe (Load config + Authenticate) : impl ApplicationServices.
            BindImplInterfaces(asm, "Tresorerie.ApplicationServices.GroupInitializer");

            // Générateur d'écritures + comptabilizer, fermés sur ReglementClient.
            var regType = typeof(global::Tresorerie.Core.Models.ReglementClient);
            BindClosedGeneric(asm,
                "Tresorerie.ApplicationServices.Comptabilite.Interfaces.IEcritureComptableGenerator`1",
                "Tresorerie.ApplicationServices.Comptabilite.EcritureComptableGeneratorReglement", regType);
            BindClosedGeneric(asm,
                "Tresorerie.ApplicationServices.Comptabilite.Interfaces.IComptabilizer`1",
                "Tresorerie.ApplicationServices.Comptabilite.ComptabilizerReglement", regType);

            // TASK-050/051 — Lettrage comptable natif du règlement client, jamais bindé par le
            // module d'origine (exclu, cf. exclusions de LoadIoCModules).
            BindImplInterfaces(asm, "Tresorerie.ApplicationServices.Comptabilite.LettrageReglementClient");

            _logger.LogInformation("Services de comptabilisation (règlement client) activés.");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Échec activation des services de comptabilisation.");
        }
    }

    private void BindImplInterfaces(System.Reflection.Assembly asm, string implFullName)
    {
        var impl = asm.GetType(implFullName);
        if (impl == null) { _logger.LogWarning("Compta : type {Type} introuvable.", implFullName); return; }
        foreach (var iface in impl.GetInterfaces())
            _kernel.Rebind(iface).To(impl).InSingletonScope();
    }

    // Binde une interface-factory mono-méthode (pattern .ToFactory()) sur un DispatchProxy qui
    // résout le type de retour de la méthode depuis le kernel.
    private void BindFactory(Type? factoryIface)
    {
        if (factoryIface == null) { _logger.LogWarning("Compta : interface factory introuvable."); return; }
        var create = typeof(System.Reflection.DispatchProxy)
            .GetMethod(nameof(System.Reflection.DispatchProxy.Create), Type.EmptyTypes)!
            .MakeGenericMethod(factoryIface, typeof(KernelFactoryDispatch));
        var proxy = create.Invoke(null, null)!;
        ((KernelFactoryDispatch)proxy).Kernel = _kernel;
        _kernel.Rebind(factoryIface).ToConstant(proxy);
    }

    private void BindClosedGeneric(System.Reflection.Assembly asm, string openIfaceName, string implFullName, Type arg)
    {
        var openIface = asm.GetType(openIfaceName);
        var impl = asm.GetType(implFullName);
        if (openIface == null || impl == null)
        {
            _logger.LogWarning("Compta : binding {Iface} / {Impl} introuvable.", openIfaceName, implFullName);
            return;
        }
        _kernel.Rebind(openIface.MakeGenericType(arg)).To(impl);
    }

    private static INinjectModule[] LoadIoCModules(string libsPath)
    {
        var iocFiles = Directory.GetFiles(libsPath, "*.IoC.*.dll");
        var modules = new List<INinjectModule>();

        // Modules incompatibles .NET (Ninject.Extensions.Factory → System.Security.Permissions absent)
        // ou inutiles pour une API headless (UI/reporting). Les 2 premiers sont remplacés par nos modules.
        var exclusions = new[]
        {
            "Tresorerie.IoC.Application",          // Factory — remplacé (bindings compta rebindés à la main)
            "Tresorerie.IoC.Core.Dapper.Mssql",    // Factory — remplacé par TresorerieCoreDapperReplacementModule
            "Tresorerie.IoC.Migration.EF",         // Factory + EF — non requis
            "Tresorerie.IoC.UICommun",             // UI WinForms — non requis (API)
            "Tresorerie.IoC.UIConfiguration.Controller",
            "Tresorerie.IoC.Reporting.XReport",    // Reporting DevExpress — non requis
        };

        foreach (var file in iocFiles)
        {
            var fileName = Path.GetFileNameWithoutExtension(file);
            if (exclusions.Any(x => fileName.Equals(x, StringComparison.OrdinalIgnoreCase)))
                continue;
            // Exclusion des modules ERP autres que Sage v9
            if (fileName.Contains(".IoC.Erp.") && !fileName.EndsWith(".v9", StringComparison.OrdinalIgnoreCase))
                continue;

            try
            {
                var asm = System.Reflection.Assembly.LoadFrom(file);
                foreach (var type in asm.GetTypes().Where(t => typeof(INinjectModule).IsAssignableFrom(t) && t.IsClass && !t.IsAbstract))
                {
                    var module = (INinjectModule)Activator.CreateInstance(type)!;
                    modules.Add(module);
                }
            }
            catch (Exception ex)
            {
                // Log et continue — un module non-chargeable ne bloque pas les autres
                Console.Error.WriteLine($"TresorerieNinjectKernel: impossible de charger {file}: {ex.Message}");
            }
        }

        return modules.ToArray();
    }

    private static string ResolveTresoreriePath()
    {
        // Chercher libs/Tresorerie relatif à l'assembly courant
        var baseDir = AppContext.BaseDirectory;
        var candidates = new[]
        {
            Path.Combine(baseDir, "libs", "Tresorerie"),
            Path.Combine(baseDir),
        };
        return candidates.FirstOrDefault(Directory.Exists) ?? baseDir;
    }

    public void Dispose()
    {
        try { _kernel.Dispose(); } catch { /* best-effort */ }
    }
}

public class NopTresorerieLicenceProvider : ILicenceProvider
{
    public bool CheckLicence() => true;
    public bool IsGrcActivated() => true;
    public bool IsGrfActivated() => true;
    public bool IsGrcAndGrfActivated() => true;

    // Mode GOCOM sans licence Trésorerie : les repositories Dapper (Societe/Caisse) appliquent
    // FilterByLicence() sur le résultat de Get(). Si Get() renvoie null, la liste est vidée
    // (Enumerable.Empty) => Societe.GetCaisse() renvoie null => NPE dans le générateur d'écritures.
    // On renvoie donc une licence permissive (multi-sociétés / multi-caisses / multi-devises).
    public global::Tresorerie.Infrastructure.TresorerieLicence Get()
        => new global::Tresorerie.Infrastructure.TresorerieLicence
        {
            ClientName = "GOCOM",
            DateExpiration = new System.DateTime(2999, 12, 31),
            Societe = global::Tresorerie.Infrastructure.TresoLicenceSociete.multi,
            Caisse = global::Tresorerie.Infrastructure.TresoLicenceCaisse.multi,
            Devise = global::Tresorerie.Infrastructure.TresoLicenceDevise.multi,
        };
}

// DispatchProxy générique pour les interfaces-factory mono-méthode (.ToFactory()) : chaque appel
// résout le type de retour de la méthode depuis le kernel (null si non bindé).
public class KernelFactoryDispatch : System.Reflection.DispatchProxy
{
    public IKernel Kernel = null!;
    protected override object? Invoke(System.Reflection.MethodInfo? targetMethod, object?[]? args)
        => targetMethod == null ? null : Kernel.TryGet(targetMethod.ReturnType);
}

// Nop pour la licence APBS (ApLicence.Core) : mode GOCOM sans vérification de licence.
// Requis car GroupeService → NotifyService → ILicenceApplicationVersion en dépend.
public sealed class NopApLicenceProvider : global::ApLicence.Core.ILicenceProvider
{
    public System.Threading.Tasks.Task<System.Collections.Generic.ICollection<global::ApLicence.Core.Models.Licence>> Load()
        => System.Threading.Tasks.Task.FromResult<System.Collections.Generic.ICollection<global::ApLicence.Core.Models.Licence>>(
            new System.Collections.Generic.List<global::ApLicence.Core.Models.Licence>());

    public System.Threading.Tasks.Task<global::ApLicence.Core.Models.Licence> LoadFromLocal(System.Guid id)
        => System.Threading.Tasks.Task.FromResult<global::ApLicence.Core.Models.Licence>(null!);

    public System.Threading.Tasks.Task<global::ApLicence.Core.Models.Licence> Get(System.Guid id)
        => System.Threading.Tasks.Task.FromResult<global::ApLicence.Core.Models.Licence>(null!);
}
