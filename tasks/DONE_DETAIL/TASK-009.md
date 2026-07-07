# TASK-009 — Rétablir l'injection de dépendances et sortir la logique métier de Program.cs

- **Priorité** : 🟡 Mineur (dette structurelle)
- **Domaine** : Architecture
- **Statut** : TODO
- **Dépend de** : —

## Contexte
- `ReleveBancaireController` instancie ses dépendances avec `new` : `new ReleveBancaireImportService()`, `new AutoReconciliationEngine()`, `new ReleveBancaireRepository(config)` (`ReleveBancaireController.cs:196`).
- `Program.cs` contient ~500 lignes de logique métier (filtrage, tri, rapprochement, comptabilisation) directement dans les minimal APIs, avec un hack de réflexion pour extraire le champ privé `_kernel` de Ninject répété à chaque endpoint.

## Problème constaté
- DI contournée → code non testable, alors qu'un conteneur est configuré.
- Logique métier dans la couche API au lieu de `GRC.Application` → violation de la Clean Architecture.
- Réflexion `GetField("_kernel", NonPublic|Instance)` fragile et dupliquée.

## Objectif
Contrôleurs/endpoints minces ; logique dans Application ; dépendances injectées ; plus de réflexion sur Ninject.

## Fichiers concernés
- `GRC.API/Program.cs`
- `GRC.API/Controllers/ReleveBancaireController.cs`
- `GRC.Infrastructure/Tresorerie/TresorerieNinjectKernel.cs`
- `GRC.Application/Services/*`

## Étapes d'implémentation
1. Enregistrer `ReleveBancaireImportService`, `AutoReconciliationEngine`, `ReleveBancaireRepository`, `IDbConnectionFactory` dans le conteneur DI.
2. Injecter ces services par constructeur dans le contrôleur.
3. Exposer proprement le kernel Ninject (méthode/propriété publique `Resolve<T>()`) au lieu de la réflexion.
4. Déplacer la logique des endpoints `/api/reglements`, `/api/rapprochement`, `/comptabiliser` vers des services Application ; les endpoints ne font qu'appeler + mapper.
5. Supprimer les fichiers placeholder `Class1.cs` des 4 projets.

## Contraintes
- Refactor sans changement de comportement fonctionnel observable.

## Checklist VALIDATION (à remplir dans VERIFY/)
- [ ] Build OK
- [ ] Contrôleur sans `new` de service ; dépendances injectées
- [ ] Plus de réflexion sur `_kernel`
- [ ] Logique métier hors de Program.cs
- [ ] `Class1.cs` supprimés
- [ ] Non-régression fonctionnelle vérifiée
