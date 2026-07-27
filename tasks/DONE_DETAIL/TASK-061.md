# TASK-061 — Intégration du moteur de licence GRLicence (contrôle unique, lecture seule)

- **Priorité** : 🟠 Majeur
- **Domaine** : Sécurité / Architecture
- **Statut** : TODO
- **Dépend de** : —

## Contexte

Un moteur de licence existe déjà et est packagé pour être consommé par des applications tierces
.NET, dont GRC_WEB nommément : `D:\_vibe\nuget-local\GRLicence.1.1.1.nupkg`. C'est une librairie
partagée **lecture seule** contre un serveur `ApLicence.Server` existant (protocole `REQUEST`
uniquement — ne consomme jamais de siège de licence). Spécification complète :
`D:\_vibe\apbs-gr_winform\analayse\CDC-LICENCE-LECTURE-SEULE-APPLI-TIERCE.md`.

GRC_WEB n'a aujourd'hui **aucun contrôle de licence** : le service démarre et sert toutes les
routes sans vérification.

## Problème constaté

`GRC.API/Program.cs` n'a aucun point de contrôle de licence. N'importe quel poste pouvant
atteindre le service GRC_WEB en LAN accède à l'application sans vérification qu'une licence
valide couvre son usage.

## Objectif

Brancher `GRLicence` sur GRC_WEB avec **un seul point de contrôle** (middleware ASP.NET en amont
de toutes les routes, avant `MapControllers()`/`FallbackPolicy`), conformément au contrat de la
librairie. Le service démarre toujours ; c'est l'accès fonctionnel qui est bloqué si la licence
est invalide.

**Subject imposé, codé en dur** : `/LIC/TRESO_GRC` — ne doit **jamais** être lu depuis un fichier
de configuration livré/modifiable chez le client (règle non négociable du contrat GRLicence,
décision PO du 17/07/2026 sur le projet GRLicence lui-même).

## Fichiers concernés

- `GRC.API/GRC.API.csproj` (nouvelle source NuGet locale + `PackageReference`)
- `GRC.API/Program.cs` (instanciation singleton, `DemarrerAsync()`, middleware de blocage)
- `GRC.API/appsettings.json` / `appsettings.Development.json` (section `<option>`/équivalent
  JSON : `address`, `port`, `requestTimeoutSeconds` — valeurs par défaut si non fournies)
- Nouveau fichier `nuget.config` à la racine du repo (ou mise à jour s'il existe déjà) pour
  déclarer `D:\_vibe\nuget-local` comme source

## Étapes d'implémentation

1. Déclarer `D:\_vibe\nuget-local` comme source NuGet locale (`nuget.config` à la racine du
   repo, cf. `examples/nuget.config` livré dans le package GRLicence).
2. Ajouter `<PackageReference Include="GRLicence" Version="1.1.1" />` dans `GRC.API.csproj`.
3. Dans `Program.cs`, instancier `LicenceMonitor` **une seule fois** en singleton applicatif
   (`builder.Services.AddSingleton<LicenceMonitor>(...)`), avec :
   - `subject` = `"/LIC/TRESO_GRC"` codé en dur (constante), jamais lu depuis la config.
   - un `ILicenceConfigProvider` lisant `address`/`port`/`requestTimeoutSeconds` depuis
     `appsettings.json` (implémentation `AppConfigLicenceConfigProvider` fournie par le package,
     ou adaptation équivalente si le package attend un `app.config` classique plutôt que JSON —
     à vérifier contre `ApLicence.Common.dll`/`GRLicence.dll` réels).
4. Appeler `await licenceMonitor.DemarrerAsync()` au démarrage du host, **après** `builder.Build()`
   et avant `app.Run()`. Ne doit jamais faire échouer le démarrage (contrat CDC §1.3 — la lib ne
   lève pas, à ne pas re-wrapper dans un try/catch qui changerait ce comportement).
5. Ajouter un middleware **avant** `app.UseAuthorization()`/`app.MapControllers()` qui lit
   `licenceMonitor.GetStatus()` et bloque (ex. `403` avec `status.Message`) si `!EstValide`.
   Doit couvrir toutes les routes API — décision à prendre sur `/api/auth/login` (déjà
   `[AllowAnonymous]`) : bloquer aussi le login si licence invalide, ou seulement les routes
   métier ? Trancher explicitement dans le VERIFY, ne pas laisser un écran de contournement
   silencieux.
6. Ajouter la section de config (`address`/`port`/`requestTimeoutSeconds`) dans
   `appsettings.json` avec les valeurs par défaut documentées (`127.0.0.1`/`8003`/`5`) —
   à ajuster pour l'environnement réel de déploiement LAN (cf. `DEPLOY.md`).
7. Vérifier que le build inclut correctement les dépendances transitives du package
   (`DotNetty.*`, `Newtonsoft.Json`, `System.Configuration.ConfigurationManager`) sans collision
   avec les DLL `Tresorerie.*`/Ninject déjà en place (cf. historique TASK-041/043 — conflit
   Serilog déjà rencontré sur ce projet avec des DLL legacy homonymes, vigilance équivalente
   requise ici).

## Contraintes

- Ne jamais bypasser le contrôle de licence par un flag de config, un `#if !DEBUG`, ou un
  try/catch qui avale une exception en conservant un état "valide" par défaut — contrat
  non-négociable du package GRLicence (CDC §5), à respecter côté GRC_WEB également.
- Le `subject` ne doit apparaître **nulle part** dans un fichier de configuration livré/modifiable
  côté client (`appsettings.json`, `web.config`, etc.) — uniquement en dur dans `Program.cs`.
- Un seul point de contrôle (`GetStatus()`) — ne pas ajouter de vérifications éparses dans
  chaque contrôleur.
- Ne jamais bypasser une règle de sécurité ou une DLL métier GRC.
- Respecter la Clean Architecture (Domain ← Application ← Infrastructure/API) : si un accès à
  `LicenceMonitor`/`GetStatus()` est nécessaire hors `GRC.API`, passer par une abstraction dans
  `GRC.Application`, ne pas référencer `GRLicence` depuis `GRC.Domain`.

## Checklist VALIDATION (à remplir dans VERIFY/)
- [ ] Build OK
- [ ] Comportement vérifié end-to-end (licence valide → accès normal ; serveur `ApLicence.Server`
  injoignable/subject invalide → accès bloqué avec message, service reste démarré)
- [ ] Subject `/LIC/TRESO_GRC` codé en dur, absent de toute config fichier
- [ ] Aucun credential/secret en dur introduit
- [ ] Aucune dette technique silencieuse (pas de bypass, pas de retry ajouté en dehors du contrat)
- [ ] Cohérent avec l'architecture (point de contrôle unique, Clean Architecture respectée)
- [ ] Décision documentée sur le périmètre du blocage (login inclus ou non)
