using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Tresorerie.Core.Services;

namespace GRC.Infrastructure.Tresorerie;

public class TresorerieGroupInitializerService : IHostedService
{
    private readonly TresorerieNinjectKernel _kernel;
    private readonly IConfiguration _configuration;
    private readonly ILogger<TresorerieGroupInitializerService> _logger;

    public TresorerieGroupInitializerService(
        TresorerieNinjectKernel kernel,
        IConfiguration configuration,
        ILogger<TresorerieGroupInitializerService> logger)
    {
        _kernel = kernel;
        _configuration = configuration;
        _logger = logger;
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        var configFile = _configuration["Tresorerie:ConfigFile"]
            ?? throw new InvalidOperationException("Tresorerie:ConfigFile manquant dans la configuration.");
        var user = _configuration["Tresorerie:UserGR"]
            ?? throw new InvalidOperationException("Tresorerie:UserGR manquant.");
        var password = _configuration["Tresorerie:PasswordGR"]
            ?? throw new InvalidOperationException("Tresorerie:PasswordGR manquant.");
        var societeNo = int.Parse(_configuration["Tresorerie:SocieteNoGR"]
            ?? throw new InvalidOperationException("Tresorerie:SocieteNoGR manquant."));

        _logger.LogInformation("Initialisation Trésorerie (config: {ConfigFile}, user: {User}).", configFile, user);

        // Les DLLs Trésorerie (COM/STA) doivent s'initialiser sur un thread STA dédié.
        // L'init sur le thread ASP.NET Core (MTA) peut provoquer un blocage indéfini.
        var initThread = new Thread(() =>
        {
            try
            {
                _logger.LogInformation("Trésorerie — Load config...");
                _kernel.ConfigurationManager.Load(configFile);
                _logger.LogInformation("Trésorerie — Initialize...");
                _kernel.GroupInitializer.Initialize();
                _logger.LogInformation("Trésorerie — Authenticate...");
                _kernel.GroupInitializer.Authenticate(user, password, societeNo);
                _logger.LogInformation("Trésorerie initialisée et authentifiée (societeNo: {SocieteNo}).", societeNo);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Échec initialisation Trésorerie.");
                throw;
            }
        });

        initThread.SetApartmentState(ApartmentState.STA);
        initThread.IsBackground = true;
        initThread.Start();
        initThread.Join(TimeSpan.FromSeconds(30));

        if (initThread.IsAlive)
            _logger.LogWarning("Initialisation Trésorerie toujours en cours après 30s — l'API démarre quand même.");

        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        try
        {
            _kernel.GroupInitializer.Disconnecte();
            _logger.LogInformation("Session Trésorerie fermée.");
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Erreur lors de la déconnexion Trésorerie.");
        }
        return Task.CompletedTask;
    }
}
