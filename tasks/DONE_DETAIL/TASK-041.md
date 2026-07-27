# TASK-041 — Journalisation fichier (Serilog, 1 fichier/jour) : réservation + approbation + comptabilisation

- **Priorité** : 🟠 Majeur (diagnostic terrain — le PO suspecte des erreurs à la réservation, à l'approbation et à la comptabilisation, sans trace exploitable aujourd'hui)
- **Domaine** : Backend (transverse : API + Infrastructure)
- **Dépend de** : TASK-037 (réservation), TASK-034/031 (approbation), TASK-035/036/038 (comptabilisation) — instrumente l'existant, ne le modifie pas

## Contexte
Aujourd'hui l'API n'écrit **aucun log fichier** : `ILogger` par défaut d'ASP.NET, aucun provider fichier, et l'API tourne en **service Windows** (`builder.Host.UseWindowsService()`, [Program.cs:25](../GRC.API/Program.cs#L25)) → les logs partent en console/EventLog, non exploitables après coup. La seule conf présente est le niveau (`Logging:LogLevel`, [appsettings.json](../GRC.API/appsettings.json)).

Le PO constate des comportements douteux **à la réservation**, **à l'approbation** et **à la comptabilisation** mais **ne peut rien analyser** faute de trace. Besoin : un **log complet écrit dans des fichiers sur le serveur, un fichier par jour**, pour analyse a posteriori.

## Décisions actées avec le PO
- **Moteur** : **Serilog** (`Serilog.AspNetCore` + `Serilog.Sinks.File`), rotation **quotidienne** (`rollingInterval: Day`) — rotation, rétention, thread-safety fournis. (Refus d'un provider maison : rotation/verrou/rétention à recoder = risque de bug.)
- **Périmètre** : les **3 zones** — réservation, approbation, comptabilisation. Pas de middleware global (bruit/volume).

## Objectif
Ajouter une journalisation fichier **additive** (aucun changement de comportement métier, aucun bypass DLL, aucune écriture base) qui trace, pour chaque opération des 3 zones : entrées, points de décision, résultats et **exceptions complètes (avec stack)**, dans `logs/grc-AAAAMMJJ.log` sur le serveur, chemin et rétention **configurables**.

## Fichiers concernés
- `GRC.API/GRC.API.csproj` : ajout des packages `Serilog.AspNetCore`, `Serilog.Sinks.File`.
- `GRC.API/Program.cs` : configuration Serilog (host + sink fichier rolling day, lecture chemin/rétention depuis `appsettings`), avant `builder.Build()`.
- `GRC.API/appsettings.json` : bloc `Serilog` (ou `Logging:File`) — chemin, rétention (jours), niveau.
- `GRC.API/Controllers/ReleveBancaireController.cs` : `ReserveLigne` (l.170), `ValiderRapprochement` (l.139) — logs d'entrée/sortie + exceptions.
- `GRC.API/Controllers/ReglementController.cs` : `comptabiliser` (l.89), `apercu-comptabilisation` (l.103) — logs d'entrée/sortie + exceptions.
- `GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs` : `ReserverLigneAsync` (l.215), `SauvegarderValidationAsync` — logs des points de décision métier via `ILogger<ReleveBancaireRepository>` **injecté** (constructeur).
- `GRC.Infrastructure/Services/ReglementService.cs` : `Comptabiliser` (l.287), `ApercuComptabilisation` (l.485) — logs via `ILogger<ReglementService>` **injecté**.

> Ces deux classes Infrastructure sont enregistrées `Scoped` ([Program.cs:79-80](../GRC.API/Program.cs#L79)) → injection `ILogger<T>` standard. **Ne référencer Serilog nulle part hors `GRC.API`** : Infrastructure/Application utilisent uniquement l'abstraction `Microsoft.Extensions.Logging` (Clean Architecture préservée).

## Étapes d'implémentation

### 1. Packages + configuration Serilog (API)
- Ajouter `Serilog.AspNetCore` et `Serilog.Sinks.File` au `.csproj`.
- Dans `Program.cs`, avant `builder.Build()` :
  ```csharp
  builder.Host.UseSerilog((ctx, cfg) => cfg
      .ReadFrom.Configuration(ctx.Configuration)   // niveaux, surcharge par catégorie
      .Enrich.FromLogContext()
      .WriteTo.File(
          path: ctx.Configuration["Serilog:File:Path"] ?? "logs/grc-.log",
          rollingInterval: RollingInterval.Day,     // => grc-20260710.log, un fichier/jour
          retainedFileCountLimit: int.TryParse(ctx.Configuration["Serilog:File:RetainedDays"], out var r) ? r : 90,
          shared: false,
          outputTemplate: "{Timestamp:yyyy-MM-dd HH:mm:ss.fff} [{Level:u3}] {SourceContext} {Message:lj}{NewLine}{Exception}"));
  ```
- `appsettings.json` :
  ```json
  "Serilog": {
    "File": { "Path": "logs/grc-.log", "RetainedDays": "90" },
    "MinimumLevel": { "Default": "Information",
      "Override": { "Microsoft.AspNetCore": "Warning" } }
  }
  ```
- Chemin **relatif au ContentRoot** du service (documenter la résolution réelle côté serveur Windows).

### 2. Zone RÉSERVATION (`ReserveLigne` + `ReserverLigneAsync`)
Logger (Information sauf erreurs) :
- **Entrée** : `userId`, `ligneReleveId`, `mvId`.
- `enteteId` dérivé ; résultat `sp_getapplock` (`lockResult`) ; **lettre calculée** (`maxIndex` → `lettreServeur`).
- **Sortie** : `200` avec lettre attribuée **ou** `409` (rowcount 0 / lock non obtenu) + info conflit.
- **Exception** : `Error` avec message + stack (`_logger.LogError(ex, ...)`).

### 3. Zone APPROBATION (`ValiderRapprochement` + `SauvegarderValidationAsync`)
- **Entrée** : `userId`, nombre de paires, et par paire `{ligneReleveId, mvId, lettrage}`.
- **Re-check réservation** : toute paire rejetée (réservation volée/libérée) journalisée.
- **Par item DLL** : `ChangeDate` (ancienne → nouvelle date, ou skip si `MV_Compta≠0`), `IsPointe`, `MV_Piece` posée, dates (`MV_Date`/`MV_DateEcheance`/`DatePointage`), **succès/échec** + message DLL.
- **UPDATE `DateValidation`** groupé : ids concernés + rowcount.
- **Récap** : `SuccessCount`, `ErrorCount`, `FailedLigneIds`.
- **Exceptions** par item et globales : `Error` + stack (message DLL GRC intégral).

### 4. Zone COMPTABILISATION (`comptabiliser`/`apercu` + `Comptabiliser`/`ApercuComptabilisation`)
- **Entrée** : `userId` (si disponible), nombre de `reglementIds`, liste des ids.
- **Par écriture** : `reglementId`, journal, compte, **pièce forcée** (`PieceAForcer`), `NumeroDocument`, dates, montant, sens.
- **Résultat** `Generate`/`Comptabiliser` : `ErpNo`/`NumeroPiece` attribué.
- **Exceptions DLL Sage** (ex. « Le numero de piece contient unexpected caracters! ») : `Error` + **`reglementId` fautif** + stack — c'est le cas d'usage central de TASK-038.
- **Récap** : succès/échec du lot.
- Réutiliser les `catch` **existants** ([ReglementService.cs:352,359,475,553](../GRC.Infrastructure/Services/ReglementService.cs#L352)) pour y ajouter le log (ne pas changer le flux de contrôle ni avaler différemment les exceptions).

### 5. Corrélation
- Envelopper chaque opération dans un `using (_logger.BeginScope(...))` ou `LogContext.PushProperty` portant un identifiant d'opération (ex. `enteteId`/`reglementId` + userId) pour regrouper les lignes d'un même appel dans le fichier.

## Contraintes
- **Additif strict** : aucun changement de comportement métier, aucun `UPDATE` base ajouté, **aucun bypass DLL** GRC. La journalisation observe, elle n'agit pas.
- **Ne JAMAIS logger de secret** : chaîne de connexion, mot de passe, `Hash`/`Salt`, **token JWT**, en-têtes d'auth. Liste blanche de champs métier uniquement (`userId`, `ligneId`, `mvId`, `enteteId`, montant, lettre, pièce, dates).
- **Robustesse** : l'échec d'écriture d'un log ne doit **jamais** faire échouer une requête métier (comportement Serilog par défaut ; à confirmer, pas de `throw` depuis le logging).
- **Clean Architecture** : Serilog **uniquement** dans `GRC.API`. Infrastructure/Application → `ILogger<T>` (abstraction `Microsoft.Extensions.Logging`) injecté. Domain inchangé.
- **Pas de nouvelle dépendance** hors `Serilog.AspNetCore` + `Serilog.Sinks.File` (validées PO).
- Niveaux : métier en `Information`, erreurs en `Error`. Pas de `Debug`/`Verbose` en production.

## Risques / dépendances
- **Droits d'écriture** : l'API tourne en **service Windows** — le compte de service doit avoir le droit d'écrire dans le dossier `logs/`. À vérifier au déploiement (sinon aucun fichier créé, silencieusement).
- **Volume disque** : rétention par défaut **90 jours** (configurable). Surveiller la taille sur le serveur ; ajuster `RetainedDays` si besoin.
- **Données sensibles** : revue obligatoire de chaque message pour garantir l'absence de secret (voir Contraintes). Bloquant si un secret fuit.
- **Performance** : sink fichier synchrone acceptable au volume LAN interne. `Serilog.Sinks.Async` = **hors périmètre** (à ouvrir si le débit devient un problème).
- **Processus unique** : `shared: false` suffit (une seule instance de service). Si un jour plusieurs instances écrivent le même fichier, repasser en `shared: true`.

## Checklist VALIDATION (à remplir dans VERIFY/)
- [ ] Build OK (API)
- [ ] Packages `Serilog.AspNetCore` + `Serilog.Sinks.File` ajoutés (aucune autre dépendance)
- [ ] Au démarrage, un fichier `logs/grc-AAAAMMJJ.log` est créé ; **rotation quotidienne** vérifiée (nom daté), rétention `RetainedDays` appliquée
- [ ] RÉSERVATION : entrée (userId/ligne/mv), lettre calculée, applock, 200/409 et exceptions tracés
- [ ] APPROBATION : paires, re-check, par-item (ChangeDate/IsPointe/pièce/dates + succès/échec DLL), récap Success/Error/Failed et exceptions tracés
- [ ] COMPTABILISATION : entrée, par-écriture (pièce forcée/document/dates/montant), résultat, **exceptions DLL Sage avec `reglementId`** tracées
- [ ] Corrélation : les lignes d'une même opération sont regroupables (scope/propriété)
- [ ] **Aucun secret** dans les logs (connexion, mot de passe, hash/salt, JWT) — revue faite
- [ ] Serilog **absent** de Infrastructure/Application/Domain (seul `ILogger<T>` y est utilisé)
- [ ] Aucun changement de comportement métier ni de flux d'exception (les `catch` existants conservés)
- [ ] Chemin + rétention lus depuis `appsettings` (pas de chemin en dur non configurable)
