# TASK-003 — Restreindre la politique CORS

- **Priorité** : 🔴 Bloquant
- **Domaine** : Sécurité
- **Statut** : TODO
- **Dépend de** : TASK-002

## Contexte
`GRC.API/Program.cs:290` définit la politique CORS `AllowAll` = `AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader()`.

## Problème constaté
Une API qui écrit en base comptable est ouverte à toute origine. Incompatible avec l'authentification par cookie (credentials) et dangereux avec token.

## Objectif
CORS restreint à la ou aux origines du frontend `gocom-web`, méthodes/headers nécessaires uniquement.

## Fichiers concernés
- `GRC.API/Program.cs`
- `appsettings.json` (liste des origines autorisées configurable)

## Étapes d'implémentation
1. Lire les origines autorisées depuis la configuration (`Cors:AllowedOrigins`).
2. Remplacer `AllowAnyOrigin` par `WithOrigins(...)` + `AllowCredentials()` si cookies.
3. Limiter méthodes/headers à ceux réellement utilisés.

## Contraintes
- `AllowAnyOrigin` + `AllowCredentials` est interdit par la spec — choisir un modèle cohérent avec TASK-002.

## Checklist VALIDATION (à remplir dans VERIFY/)
- [ ] Build OK
- [ ] Origine non autorisée bloquée (test navigateur)
- [ ] Origines configurables sans recompilation
- [ ] Cohérent avec le mode d'auth retenu
