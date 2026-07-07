# TASK-015 — `/api/reglements/distincts` recharge tout l'historique

- **Priorité** : 🟠 Majeur
- **Domaine** : Performance
- **Statut** : TODO
- **Dépend de** : TASK-008-A (même logique de bornage)

## Contexte
`GRC.API/Program.cs` — endpoint `/api/reglements/distincts` (~ligne 613) appelle `repo.GetAll(societeId, new DateTime(2000,1,1), new DateTime(2030,1,1), caisses)` puis extrait en mémoire les valeurs distinctes (client, pièce, extrait, référence, numéro, libellé, info1-4) pour alimenter les filtres du frontend.

## Problème constaté
- Même défaut que TASK-008-A : **tout l'historique** est chargé en mémoire à chaque appel, ici uniquement pour construire des listes de valeurs distinctes.
- Appelé au chargement du dashboard (`fetchReferences` dans `App.tsx`) → coût payé à chaque ouverture.
- À ~88 000 lignes/an en accumulation, ça devient lourd sur la durée de vie de l'appli.
- 213 caisses > 20 déclenche en plus le chemin parallèle `Chunk(20)` (11 connexions concurrentes) à chaque appel.

## Objectif
Les listes de valeurs distinctes se construisent sans charger l'intégralité de l'historique.

## Fichiers concernés
- `GRC.API/Program.cs` (endpoint `/api/reglements/distincts`)
- `gocom-web/src/App.tsx` (`fetchReferences`) — transmettre la période si applicable

## Étapes d'implémentation
1. Borner la requête à la **période réelle** (cohérent avec TASK-008-A), plutôt que `2000→2030`.
2. Idéalement, obtenir les valeurs distinctes via `SELECT DISTINCT` côté base (une requête par colonne ou une requête agrégée) plutôt que de charger toutes les lignes puis dédupliquer en mémoire.
3. Vérifier que les filtres frontend restent alimentés correctement pour la période affichée.

## Contraintes
- Conserver le respect des droits (caisses autorisées).
- Pas de régression fonctionnelle des filtres.

## Checklist VALIDATION (à remplir dans VERIFY/)
- [ ] Build OK
- [ ] Plus de chargement `2000→2030` de tout l'historique
- [ ] Filtres frontend toujours correctement alimentés
- [ ] Temps de réponse stable avec plusieurs années d'historique
