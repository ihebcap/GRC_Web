using Microsoft.AspNetCore.Mvc;
using GRC.Infrastructure.Tresorerie;
using Ninject;
using Tresorerie.Core.Interfaces;
using Tresorerie.Core.Models;
using Dapper;
using System.Data.SqlClient;
using Microsoft.IdentityModel.Tokens;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using GRC.Application.Interfaces;
using GRC.Infrastructure.Data;
using Serilog;
using GRLicence;

var builder = WebApplication.CreateBuilder(args);

// TASK-041 : journalisation fichier (1 fichier/jour) pour diagnostic des 3 zones réservation /
// approbation / comptabilisation. Serilog est cantonné à GRC.API ; Infrastructure/Application
// n'utilisent que l'abstraction ILogger<T> (Clean Architecture préservée). Chemin relatif au
// ContentRoot du service Windows (ex. dossier d'installation) ; chemin + rétention lus depuis
// appsettings (section "Serilog"). L'échec d'écriture d'un log ne fait jamais échouer une requête.
builder.Host.UseSerilog((ctx, cfg) => cfg
    // TASK-044 : liste d'assemblies explicite (uniquement le cœur Serilog) => le lecteur de config
    // n'énumère PAS le DependencyContext et ne tente donc jamais de charger la brique legacy
    // Serilog.Settings.AppSettings 2.0 (référencée transitivement par les DLL Trésorerie, absente
    // de la racine). La section "Serilog" n'utilise que MinimumLevel : aucune résolution de
    // sink/enricher par chaîne n'est requise ; sinks et enrichers sont configurés en code ci-dessous.
    .ReadFrom.Configuration(
        ctx.Configuration,
        new Serilog.Settings.Configuration.ConfigurationReaderOptions(typeof(Serilog.ILogger).Assembly))   // niveaux (section "Serilog")
    .Enrich.FromLogContext()
    .WriteTo.File(
        path: ctx.Configuration["Serilog:File:Path"] ?? "logs/grc-.log",
        rollingInterval: RollingInterval.Day,     // => grc-20260710.log, un fichier/jour
        retainedFileCountLimit: int.TryParse(ctx.Configuration["Serilog:File:RetainedDays"], out var r) ? r : 90,
        shared: false,
        outputTemplate: "{Timestamp:yyyy-MM-dd HH:mm:ss.fff} [{Level:u3}] {SourceContext} {Message:lj}{NewLine}{Exception}"));

// La comptabilisation Trésorerie ouvre un TransactionScope qui écrit à la fois dans la base GRC
// (GR_GOCOM : statut du règlement) et dans la base ERP Sage (GOCOM : F_ECRITUREC). Deux bases dans
// une même transaction => escalade en transaction distribuée (MSDTC). Sous .NET moderne, cette
// escalade implicite est désactivée par défaut : on l'active ici (Windows + service MSDTC requis).
System.Transactions.TransactionManager.ImplicitDistributedTransactions = true;

// Hébergement en tant que service Windows (sans effet en console/dev).
// Le port d'écoute est paramétrable via la clé "Urls" d'appsettings.json (lue nativement).
builder.Host.UseWindowsService();

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddControllers();

var jwtKey = builder.Configuration["Jwt:Key"] ?? "une_clef_secrete_longue_et_complexe_pour_le_dev";
builder.Services.AddAuthentication("Bearer").AddJwtBearer(options => {
    options.TokenValidationParameters = new TokenValidationParameters {
        ValidateIssuer = false,
        ValidateAudience = false,
        ValidateLifetime = true,
        ValidateIssuerSigningKey = true,
        IssuerSigningKey = new SymmetricSecurityKey(System.Text.Encoding.UTF8.GetBytes(jwtKey))
    };
});
builder.Services.AddAuthorization(options =>
{
    // Tout endpoint est protégé par défaut. Seul /api/auth/login a [AllowAnonymous].
    options.FallbackPolicy = new Microsoft.AspNetCore.Authorization.AuthorizationPolicyBuilder()
        .RequireAuthenticatedUser()
        .Build();
});

var connectionString = builder.Configuration.GetConnectionString("DefaultConnection") 
    ?? throw new InvalidOperationException("La chaîne de connexion 'DefaultConnection' est introuvable.");
builder.Services.AddSingleton<IDbConnectionFactory>(new DbConnectionFactory(connectionString));

// CORS for React frontend
builder.Services.AddCors(options =>
{
    options.AddPolicy("RestrictedCors", policyBuilder => 
    {
        var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? Array.Empty<string>();
        policyBuilder.WithOrigins(allowedOrigins)
               .AllowAnyMethod()
               .AllowAnyHeader()
               .AllowCredentials();
    });
});

// Configure Ninject Kernel for Tresorerie DLLs
builder.Services.AddSingleton<TresorerieNinjectKernel>(sp =>
{
    var kernel = new TresorerieNinjectKernel(sp.GetRequiredService<IConfiguration>(), sp.GetRequiredService<ILogger<TresorerieNinjectKernel>>());
    return kernel;
});

// Initialise le groupe/exercice Trésorerie au démarrage (chargement config .apt + Authenticate),
// requis pour la comptabilisation (exercice, journaux, comptes). Fonctionne depuis le passage à
// Ninject netstandard (l'ancien build net45 échouait sur .NET Remoting).
builder.Services.AddHostedService<GRC.Infrastructure.Tresorerie.TresorerieGroupInitializerService>();

builder.Services.AddMemoryCache(); // TASK-064 — requis par ReglementGenerationService (cache liste clients ERP)
builder.Services.AddScoped<GRC.Application.Services.ReleveBancaireImportService>();
builder.Services.AddScoped<GRC.Application.Services.AutoReconciliationEngine>();
builder.Services.AddScoped<GRC.Infrastructure.Repositories.ReleveBancaireRepository>();
builder.Services.AddScoped<GRC.Infrastructure.Services.ReglementService>();
builder.Services.AddScoped<GRC.Infrastructure.Services.ReglementGenerationService>();

// TASK-061 : Contrôle de licence GRLicence (singleton applicatif, point de contrôle unique).
// ─────────────────────────────────────────────────────────────────────────────────────────────
// RÈGLES INVIOLABLES (contrat CDC §5 + GRLicence README) :
//   - Subject "/LIC/TRESO_GRC" codé en dur dans cette constante — JAMAIS dans appsettings.
//   - LicenceMonitor instancié en Singleton unique — un seul GetStatus() dans le middleware.
//   - DemarrerAsync() appelé après builder.Build(), avant app.Run() — ne doit jamais throw.
//   - État initial = Invalide (fail-closed) : les premiers accès post-démarrage sont bloqués
//     jusqu'à ce que la vérification initiale ait réussi — comportement voulu, pas un bug.
//   - Aucun try/catch n'entoure les appels GRLicence pour préserver l'état fail-closed.
// ─────────────────────────────────────────────────────────────────────────────────────────────
const string LicenceSubject = "/LIC/TRESO_GRC"; // immuable — ne jamais déplacer vers la config

// Adaptateur ILicenceConfigProvider lisant address/port/requestTimeoutSeconds depuis la section
// "GRLicence" d'appsettings.json. Le subject n'y figure PAS (contrat CDC §5 + décision PO 17/07).
builder.Services.AddSingleton<ILicenceConfigProvider>(sp =>
{
    var cfg = sp.GetRequiredService<IConfiguration>();
    return new AppSettingsLicenceConfigProvider(cfg);
});

builder.Services.AddSingleton<LicenceMonitor>(sp =>
{
    var configProvider = sp.GetRequiredService<ILicenceConfigProvider>();
    var loggerFactory = sp.GetRequiredService<ILoggerFactory>();
    return new LicenceMonitor(LicenceSubject, configProvider, loggerFactory);
});

var app = builder.Build();

// TASK-061 : démarrage du monitor de licence (check initial + timer 24h fixe).
// Appelé APRÈS builder.Build() et AVANT app.Run() — cf. contrat README GRLicence.
// Ne lève jamais d'exception (contrat CDC §1.3) — NE PAS encapsuler dans un try/catch.
var licenceMonitor = app.Services.GetRequiredService<LicenceMonitor>();
await licenceMonitor.DemarrerAsync();

// Sert le front (SPA) depuis wwwroot : index.html, assets, config.js.
app.UseDefaultFiles();
app.UseStaticFiles();

app.UseCors("RestrictedCors");

// TASK-061 : middleware de contrôle de licence — POINT DE CONTRÔLE UNIQUE.
// Placé AVANT UseAuthentication/UseAuthorization/MapControllers pour couvrir TOUTES les routes
// sans exception, y compris /api/auth/login (décision documentée dans VERIFY/TASK-061_verify.md :
// un poste sans licence valide ne doit pas pouvoir s'authentifier — cohérence fail-closed §1.3).
// La librairie ne retourne JAMAIS d'exception depuis GetStatus() — lecture instantanée en mémoire.
app.Use(async (context, next) =>
{
    var status = licenceMonitor.GetStatus();
    if (!status.EstValide)
    {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        context.Response.ContentType = "application/json; charset=utf-8";
        var message = status.Message ?? "Licence invalide. Merci de vérifier la licence GRC.";
        await context.Response.WriteAsync(
            System.Text.Json.JsonSerializer.Serialize(new { error = message }));
        return;
    }
    await next(context);
});

app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();

app.MapPost("/api/auth/login", (
    [FromBody] LoginRequest req, 
    TresorerieNinjectKernel kernel,
    IDbConnectionFactory dbFactory,
    IConfiguration config) =>
{


    var connString = dbFactory.GetConnectionString();
    
    var connProvider = new Tresorerie.Dapper.ConnectionProvider();
    connProvider.ConnectionString = connString;

    var userRepo = new Tresorerie.Dapper.Repositories.UtilisateurRepository(connProvider);
    var user = userRepo.Get(req.Username);

    if (user == null) 
    {
        return Results.Unauthorized();
    }
    
    // True Verification using the legacy DLL
    var hasher = new Tresorerie.Infrastructure.PasswordHasher();
    var computedHash = hasher.Hash(req.Password, user.Salt);
    
    if (computedHash == null || user.Hash == null || !computedHash.SequenceEqual(user.Hash))
    {
        return Results.Unauthorized();
    }
    
    // Get user's caisses for societe via Dapper
    using var sqlConn = new System.Data.SqlClient.SqlConnection(connString);
    var caisses = sqlConn.Query<int>("SELECT CA_Id FROM P_UTILISATEURCAISSE WHERE UT_Id = @UserId", new { UserId = user.No }).ToArray();
    
    var isAdminInt = sqlConn.QueryFirstOrDefault<int?>("SELECT UT_Admin FROM P_UTILISATEUR WHERE UT_Id = @UserId", new { UserId = user.No });
    bool isAdmin = (isAdminInt == 1);
    
    var societeInfo = sqlConn.QueryFirstOrDefault("SELECT SO_RaisonSocial as RaisonSociale, SO_IntituleInfoLibre1 as Info1, SO_IntituleInfoLibre2 as Info2, SO_IntituleInfoLibre3 as Info3, SO_IntituleInfoLibre4 as Info4 FROM P_SOCIETE WHERE SO_Id = @SocieteId", new { SocieteId = req.SocieteId });

        // Generate JWT
    var tokenHandler = new JwtSecurityTokenHandler();
    var key = System.Text.Encoding.UTF8.GetBytes(config["Jwt:Key"] ?? "une_clef_secrete_longue_et_complexe_pour_le_dev");
    var claims = new List<Claim>
    {
        new Claim("UserId", user.No.ToString()),
        new Claim("SocieteId", req.SocieteId.ToString()),
        new Claim("Caisses", string.Join(",", caisses)),
        new Claim("IsAdmin", isAdmin ? "1" : "0")
    };
    var tokenDescriptor = new SecurityTokenDescriptor
    {
        Subject = new ClaimsIdentity(claims),
        Expires = DateTime.UtcNow.AddHours(8),
        SigningCredentials = new SigningCredentials(new SymmetricSecurityKey(key), SecurityAlgorithms.HmacSha256Signature)
    };
    var token = tokenHandler.CreateToken(tokenDescriptor);
    var tokenString = tokenHandler.WriteToken(token);

    return Results.Ok(new 
    { 
        user.No, 
        user.Login, 
        user.Nom, 
        user.Prenom, 
        IsAdmin = isAdmin,
        SocieteId = req.SocieteId,
        SocieteName = societeInfo?.RaisonSociale ?? "Inconnue",
        Info1Label = societeInfo?.Info1,
        Info2Label = societeInfo?.Info2,
        Info3Label = societeInfo?.Info3,
        Info4Label = societeInfo?.Info4,
        Caisses = caisses,
        Token = tokenString
    });
}).AllowAnonymous(); // Login public — tous les autres endpoints sont protégés par FallbackPolicy

app.MapGet("/api/reference/caisses", (IDbConnectionFactory dbFactory) => 
{
    var connString = dbFactory.GetConnectionString();
    using var sqlConn = new System.Data.SqlClient.SqlConnection(connString);
    var caisses = sqlConn.Query("SELECT CA_Id as id, CA_Code as code, CA_Intitule as intitule FROM RT_CAISSE");
    return Results.Ok(caisses);
}).RequireAuthorization();

app.MapGet("/api/reference/modes", (IDbConnectionFactory dbFactory, ClaimsPrincipal user) => 
{
    var caisses = user.FindFirst("Caisses")?.Value;
    bool isAdmin = user.FindFirst("IsAdmin")?.Value == "1";
    var connString = dbFactory.GetConnectionString();
    using var sqlConn = new System.Data.SqlClient.SqlConnection(connString);
    
    if (!isAdmin && !string.IsNullOrEmpty(caisses)) 
    {
        var ids = caisses.Split(',').Select(int.Parse).ToArray();
        var sql = $@"
            SELECT DISTINCT m.MR_Id as id, m.MR_Code as code, m.MR_Intitule as intitule, m.MR_TypeNo as typeNo
            FROM P_MODEREGLEMENT m
            INNER JOIN P_CAISSEMODREG cm ON m.MR_Id = cm.MR_Id
            WHERE cm.CA_Id IN ({string.Join(",", ids)})";
        var modes = sqlConn.Query(sql);
        return Results.Ok(modes);
    }
    else 
    {
        var modes = sqlConn.Query("SELECT MR_Id as id, MR_Code as code, MR_Intitule as intitule, MR_TypeNo as typeNo FROM P_MODEREGLEMENT");
        return Results.Ok(modes);
    }
}).RequireAuthorization();

app.MapGet("/api/reference/societes", (IDbConnectionFactory dbFactory) => 
{
    var connString = dbFactory.GetConnectionString();
    using var sqlConn = new System.Data.SqlClient.SqlConnection(connString);
    var societes = sqlConn.Query("SELECT SO_Id as id, SO_RaisonSocial as raisonSociale FROM P_SOCIETE");
    return Results.Ok(societes);
}).AllowAnonymous(); // Liste des sociétés affichée sur la page de login, avant authentification

app.MapGet("/api/reference/banques", (IDbConnectionFactory dbFactory, ClaimsPrincipal user) => 
{
    if (!int.TryParse(user.FindFirst("SocieteId")?.Value, out int societeId)) return Results.Unauthorized();
    var connString = dbFactory.GetConnectionString();
    using var sqlConn = new System.Data.SqlClient.SqlConnection(connString);
    var banques = sqlConn.Query("SELECT No as id, BanqueCode as code, Rib as rib FROM vBanque WHERE SocieteNo = @SocieteId", new { SocieteId = societeId });
    return Results.Ok(banques);
}).RequireAuthorization();

app.MapGet("/api/reference/clients", (GRC.Infrastructure.Services.ReglementGenerationService genSvc) => 
{
    var clients = genSvc.GetClients();
    return Results.Ok(clients);
}).RequireAuthorization();

// TASK-064 — Count des clients ERP depuis le cache (0 appel ERP supplémentaire si le cache est chaud).
// Utile pour le front pour afficher le volume ou adapter l'UX.
app.MapGet("/api/reference/clients/count", (GRC.Infrastructure.Services.ReglementGenerationService genSvc) =>
{
    var count = genSvc.GetClientsCount();
    return Results.Ok(new { count });
}).RequireAuthorization();

// TASK-064 — Recherche côté serveur bornée depuis le cache :
// charge la liste au plus une fois par TTL (10 min), filtre en mémoire et tronque à max.
// Paramètres : q (terme de recherche, obligatoire), max (nb max de résultats, défaut 50).
app.MapGet("/api/reference/clients/search", (string? q, int? max, GRC.Infrastructure.Services.ReglementGenerationService genSvc) =>
{
    if (string.IsNullOrWhiteSpace(q)) return Results.BadRequest(new { erreur = "Le paramètre q est obligatoire." });
    var results = genSvc.SearchClients(q, max ?? 50);
    return Results.Ok(results);
}).RequireAuthorization();



// Fallback SPA : toute route non-API renvoie index.html (routage côté client).
app.MapFallbackToFile("index.html").AllowAnonymous();

app.Run();

public record LoginRequest(string Username, string Password, int SocieteId);

// TASK-061 : Adaptateur ILicenceConfigProvider pour ASP.NET Core (appsettings.json).
// Lit address/port/requestTimeoutSeconds depuis la section "GRLicence" de la configuration JSON.
// Retombe sur les valeurs par défaut si une clé est absente (comportement identique à celui du
// AppConfigLicenceConfigProvider fourni par la lib — section "option" en app.config/web.config).
// Le subject n'est JAMAIS lu depuis ici (contrat CDC §5 + décision PO 17/07/2026).
public sealed class AppSettingsLicenceConfigProvider : ILicenceConfigProvider
{
    private readonly IConfiguration _configuration;

    public AppSettingsLicenceConfigProvider(IConfiguration configuration)
    {
        _configuration = configuration;
    }

    public GRLicence.ServerConnectionConfig GetConfig()
    {
        var addressStr = _configuration["GRLicence:address"] ?? "127.0.0.1";
        var address = System.Net.IPAddress.TryParse(addressStr, out var ip)
            ? ip
            : System.Net.IPAddress.Loopback;

        var port = int.TryParse(_configuration["GRLicence:port"], out var p) ? p : 8003;

        var timeoutSeconds = int.TryParse(_configuration["GRLicence:requestTimeoutSeconds"], out var t) ? t : 5;
        var timeout = System.TimeSpan.FromSeconds(timeoutSeconds);

        return new GRLicence.ServerConnectionConfig(address, port, timeout);
    }
}
