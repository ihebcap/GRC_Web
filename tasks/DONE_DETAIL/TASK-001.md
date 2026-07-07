# TASK-001 — Supprimer les identifiants SQL en dur (compte sa / mot de passe 1234)

- **Priorité** : 🔴 Bloquant
- **Domaine** : Sécurité
- **Statut** : TODO
- **Dépend de** : —

## Contexte
La chaîne de connexion `Server=DESKTOP-2VCUE93;Database=GR_GOCOM;User Id=sa;Password=1234;TrustServerCertificate=True` est répétée en fallback dans ~12 endroits.

## Problème constaté
- Compte `sa` (super-admin SQL) + mot de passe trivial `1234` + secret en clair dans le code source.
- Répétition massive du même littéral → toute rotation de secret est impossible sans risque d'oubli.
- Fichiers : `GRC.API/Program.cs` (lignes 318, 374, 582, 616, 656, 664, 687, 695, 709, 725…), `GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs:20`.

## Objectif
Zéro credential en dur dans le code. Une seule source de vérité pour la chaîne de connexion.

## Fichiers concernés
- `GRC.API/Program.cs`
- `GRC.API/appsettings.json` (+ `appsettings.Development.json`)
- `GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs`

## Étapes d'implémentation
1. Définir `ConnectionStrings:DefaultConnection` dans `appsettings.json` (sans secret) et surcharger via **User Secrets / variables d'environnement** en dev, et secret manager en prod.
2. Créer un compte SQL applicatif dédié à droits minimaux (pas `sa`), mot de passe fort.
3. Centraliser l'accès via un `IDbConnectionFactory` injecté ; supprimer **tous** les fallbacks `?? "Server=…1234…"`.
4. Faire échouer explicitement le démarrage si la chaîne est absente (fail-fast), plutôt qu'un fallback silencieux.

## Contraintes
- Aucun secret ne doit apparaître dans le dépôt (vérifier `.gitignore` pour les fichiers de secrets).

## Checklist VALIDATION (à remplir dans VERIFY/)
- [ ] Build OK
- [ ] `grep` sur `1234` / `User Id=sa` = 0 résultat dans le code
- [ ] L'app démarre via config/secret, échoue proprement si absente
- [ ] Compte SQL non-`sa` utilisé
- [ ] Cohérent avec l'architecture
