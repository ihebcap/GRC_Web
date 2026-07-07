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

var builder = WebApplication.CreateBuilder(args);

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

builder.Services.AddScoped<GRC.Application.Services.ReleveBancaireImportService>();
builder.Services.AddScoped<GRC.Application.Services.AutoReconciliationEngine>();
builder.Services.AddScoped<GRC.Infrastructure.Repositories.ReleveBancaireRepository>();
builder.Services.AddScoped<GRC.Infrastructure.Services.ReglementService>();

var app = builder.Build();

// Sert le front (SPA) depuis wwwroot : index.html, assets, config.js.
app.UseDefaultFiles();
app.UseStaticFiles();

app.UseCors("RestrictedCors");
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



// Fallback SPA : toute route non-API renvoie index.html (routage côté client).
app.MapFallbackToFile("index.html").AllowAnonymous();

app.Run();

public record LoginRequest(string Username, string Password, int SocieteId);






