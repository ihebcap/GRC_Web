# TASK-044 — Démarrage : `Serilog.Settings.AppSettings 2.0` introuvable au chargement de la configuration

- **Domaine** : Build / Déploiement (runtime)
- **Priorité** : 🔴 bloquant démarrage
- **Statut** : DONE — APPROVE 2026-07-10
- **Origine** : révélée une fois TASK-043 passée (masquée avant par le crash `Serilog 4.2`). Complément *runtime* de TASK-043 (build) et correction ciblée du code TASK-041.
- **Mode** : worker (autorisé explicitement par le PO — « tu implémente directement »).

## Problème

Après TASK-043 (racine déterministe = Serilog 4.2), un **second** échec de démarrage apparaît :

```
Unhandled exception. System.IO.FileNotFoundException:
  Could not load file or assembly 'Serilog.Settings.AppSettings, Version=2.0.0.0,
  Culture=neutral, PublicKeyToken=24c2f752a8e58a10'. Le fichier spécifié est introuvable.
   at Serilog.Settings.Configuration.ConfigurationReader.LoadConfigurationAssemblies(...)
   ...
   at Program.<Main>$(...) in D:\_vibe\GRC_WEB\GRC.API\Program.cs:line 23
```

## Cause racine

`.ReadFrom.Configuration(ctx.Configuration)` (Serilog.Settings.Configuration 9) énumère le
**`DependencyContext`** (`GRC.API.deps.json`) pour découvrir les extensions `Serilog.*`. Il y
trouve `Serilog.Settings.AppSettings` **2.0** — brique legacy compagnon de Serilog 2.10,
**référencée transitivement** par les DLL `Tresorerie.*` (donc listée dans deps.json) — et tente
un `Assembly.Load` par nom complet. Or ce fichier n'est **pas** à la racine (présent uniquement
dans `libs\Tresorerie\`, où il sert le kernel Ninject Trésorerie) → `FileNotFoundException`.

## Correctif (Program.cs, cantonné à la ligne 23)

```csharp
.ReadFrom.Configuration(
    ctx.Configuration,
    new Serilog.Settings.Configuration.ConfigurationReaderOptions(typeof(Serilog.ILogger).Assembly))
```

Passer une **liste d'assemblies explicite** (le seul cœur `Serilog`) désactive l'énumération du
`DependencyContext` : le lecteur ne tente plus jamais de charger la brique legacy 2.0.

**Pourquoi c'est sûr :** la section `Serilog` d'`appsettings.json` n'utilise que `MinimumLevel`
(niveaux + override par catégorie). Aucun `WriteTo` / `Using` / `Enrich` par chaîne → aucune
résolution de sink/enricher par réflexion n'est requise. Les sinks (File, Console) et
`Enrich.FromLogContext` sont configurés **en code** (inchangés). Le comportement de journalisation
TASK-041 est strictement identique.

## Contraintes respectées

- Aucun bypass sécurité, aucune DLL métier GRC touchée, aucun secret en dur, aucun `UPDATE` SQL.
- Version NuGet Serilog non rétrogradée (≥ 4.2) ; set legacy 2.x préservé dans `libs\Tresorerie\`.
- Modification circonscrite à `Program.cs:23`.

## Recette (VALIDATION)

- [x] `dotnet build -c Release` → **0 erreur** (9 warnings préexistants hors périmètre).
- [x] `dotnet publish` propre → racine = Serilog 4.2 **sans** `Serilog.Settings.AppSettings` ;
      `libs\Tresorerie\` conserve le set 2.x (dont `Serilog.Settings.AppSettings` 2.2.2).
- [x] Démarrage depuis `publish` : **plus aucun** `FileNotFoundException` Serilog ; **l'hôte se
      construit entièrement** (on dépasse `Program.cs:23`).
- [x] Le processus s'arrête ensuite sur `NullReferenceException` dans
      `TresorerieGroupConfigurationValidator.Validate` (config `.apt` absente/invalide sur poste
      dev) — **dépendance d'environnement**, aucune trace d'assembly Serilog. Résiduel
      « à confirmer côté serveur » commun à TASK-041/043.

## Verdict

**APPROVE.** Les deux `FileNotFoundException` Serilog (4.2 puis 2.0) sont éliminés ; la
construction de l'hôte réussit. Seule limite restante (init Trésorerie end-to-end) attribuée à la
config d'environnement, hors périmètre.
