# TASK-068 — Secrets en dur dans appsettings.json / appsettings.Development.json (Trésorerie)

- **Priorité** : 🔴 Sécurité (constat review architecte 2026-07-27, fichiers non commités depuis)
- **Domaine** : Config (`GRC.API/appsettings.json`, `GRC.API/appsettings.Development.json`)
- **Dépend de** : rien pour le code. Bloque cependant le commit de ces deux fichiers, exclus volontairement du commit TASK-064 (`0e4d471`) pour cette raison.

## Contexte

`appsettings.json` et `appsettings.Development.json` portent des modifications locales non commitées ajoutant une section `Tresorerie` :

```json
"Tresorerie": {
  "ConfigFile": "C:\\GRC\\GR_GOCOM.apt",
  "UserGR": "Admin",
  "PasswordGR": "Admin",
  "SocieteNoGR": "1"
}
```

`UserGR`/`PasswordGR` = `"Admin"/"Admin"` en clair dans les deux fichiers. C'est un secret en dur, interdit explicitement par `tasks/TODO.md:46` (« Interdictions : ... secret en dur ... »). Ces clés sont lues sans détour dans [TresorerieGroupInitializerService.cs:26-33](../GRC.Infrastructure/Tresorerie/TresorerieGroupInitializerService.cs#L26-L33) via `_configuration["Tresorerie:UserGR"]` etc.

Constat annexe (hors périmètre strict de cette tâche, mais de même nature) : `appsettings.json` contient déjà, **et ceci est committé de longue date**, `ConnectionStrings:DefaultConnection` avec `User Id=sa;Password=1234` en clair. À traiter par une tâche dédiée si le PO le souhaite — signalé ici pour ne pas laisser la dette silencieuse, non inclus dans la checklist de cette tâche pour ne pas en élargir le périmètre sans validation PO.

## Objectif

Aucun secret (mot de passe, identifiant applicatif) ne doit apparaître en clair dans un fichier versionné du dépôt. Les valeurs `Tresorerie:UserGR` / `Tresorerie:PasswordGR` (et idéalement `ConfigFile`/`SocieteNoGR` qui diffèrent déjà entre dev et prod) doivent venir d'une source non versionnée :

- **Dev** : `dotnet user-secrets` (déjà standard .NET, pas de dépendance supplémentaire) pour `GRC.API`.
- **Prod** : variable d'environnement (`Tresorerie__UserGR`, `Tresorerie__PasswordGR`, binding automatique par le double underscore) ou fichier de config hors dépôt (ex. monté au déploiement), au choix de l'infra en place — ne pas supposer, vérifier comment les autres secrets de prod (ex. `ConnectionStrings`) sont gérés aujourd'hui en dehors du dépôt avant de choisir.

## Fichiers concernés

- `GRC.API/appsettings.json` — retirer `UserGR`/`PasswordGR` (garder au besoin `ConfigFile`/`SocieteNoGR` si non sensibles, ou les sortir aussi pour cohérence).
- `GRC.API/appsettings.Development.json` — idem, remplacer par `dotnet user-secrets`.
- `GRC.Infrastructure/Tresorerie/TresorerieGroupInitializerService.cs:26-33` — aucun changement de code attendu si le binding `IConfiguration` reste la seule source (user-secrets et variables d'environnement s'intègrent nativement dans la chaîne de configuration .NET) ; à confirmer en testant, pas à supposer.

## Étapes d'implémentation

1. Vérifier si `GRC.API.csproj` a déjà un `UserSecretsId` ; sinon l'ajouter (`dotnet user-secrets init` depuis `GRC.API`).
2. `dotnet user-secrets set "Tresorerie:UserGR" "Admin"` (et `PasswordGR`) en dev — retirer ces clés de `appsettings.Development.json`.
3. Pour `appsettings.json` (prod), retirer `UserGR`/`PasswordGR` en dur et documenter (README ou doc infra existante) que ces valeurs doivent être injectées via variables d'environnement `Tresorerie__UserGR` / `Tresorerie__PasswordGR` au déploiement.
4. Relancer l'application en dev et vérifier que `TresorerieGroupInitializerService` s'initialise toujours correctement (les `InvalidOperationException` de L.27/29/31/33 sont le signal si une clé manque).
5. Ne pas committer de nouveau mot de passe en clair, même temporairement, dans le message de commit ou un fichier de test.

## Contraintes

- Ne pas modifier le comportement de `TresorerieGroupInitializerService` (toujours les mêmes clés de configuration lues, seule leur **source** change).
- Ne pas introduire de nouvelle dépendance externe (pas de vault tiers) sans validation PO — `user-secrets` + variables d'environnement suffisent au périmètre actuel.

## Risques / dépendances

- Si l'environnement de déploiement prod actuel ne permet pas facilement d'injecter des variables d'environnement (à vérifier avec qui gère le déploiement), prévoir un fichier de config hors dépôt comme alternative — ne pas bloquer la tâche sur ce point sans clarifier d'abord le mécanisme de déploiement réel.
- Constat annexe `ConnectionStrings:DefaultConnection` (sa/1234, déjà committé) : signalé mais **non traité par cette tâche** — à arbitrer séparément avec le PO (peut nécessiter une rotation du mot de passe SQL, impact plus large).

## Checklist VALIDATION (à remplir dans VERIFY/)

- [ ] Build back OK (0 erreur)
- [ ] `git diff`/`git show` sur `appsettings.json` et `appsettings.Development.json` : plus aucune valeur `UserGR`/`PasswordGR` en clair
- [ ] Dev : `dotnet user-secrets list` (depuis `GRC.API`) montre les clés `Tresorerie:UserGR`/`Tresorerie:PasswordGR`
- [ ] Démarrage de `GRC.API` en dev réussi, `TresorerieGroupInitializerService` initialisé sans exception
- [ ] Documentation (README ou équivalent) mise à jour indiquant comment fournir ces valeurs en prod (variables d'environnement `Tresorerie__UserGR`/`Tresorerie__PasswordGR`)
- [ ] Aucun secret en clair ajouté ailleurs (commit, log, fichier de test) à l'occasion de cette tâche
