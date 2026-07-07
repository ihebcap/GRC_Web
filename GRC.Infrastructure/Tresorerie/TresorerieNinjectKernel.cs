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

        _logger.LogInformation("Kernel Trésorerie initialisé avec {Count} modules.", modules.Length);
    }

    private static INinjectModule[] LoadIoCModules(string libsPath)
    {
        var iocFiles = Directory.GetFiles(libsPath, "*.IoC.*.dll");
        var modules = new List<INinjectModule>();

        foreach (var file in iocFiles)
        {
            var fileName = Path.GetFileNameWithoutExtension(file);
            // Remplacés par nos modules sans Castle.DynamicProxy/Ninject.Extensions.Factory
            if (fileName.Equals("Tresorerie.IoC.Application", StringComparison.OrdinalIgnoreCase))
                continue;
            if (fileName.Equals("Tresorerie.IoC.Core.Dapper.Mssql", StringComparison.OrdinalIgnoreCase))
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
    public global::Tresorerie.Infrastructure.TresorerieLicence Get() => null;
}
