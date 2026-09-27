# TASK-084 — Annulation des requêtes de fetch obsolètes sur la grille Règlements (`App.tsx`)

- **Priorité** : 🟡 Mineur (non urgent — décision PO 2026-09-27)
- **Domaine** : Performance (Front + interaction Front/API)
- **Statut** : TODO
- **Dépend de** : —

## Contexte
Observation réelle du PO le 2026-09-27 sur l'écran liste des règlements (`App.tsx`, build
`deploy\` en usage normal, pas le serveur dev Vite) : en enchaînant plusieurs changements de
filtre rapprochés, l'onglet réseau du navigateur montre **4 requêtes `GET /api/reglements`
quasi-identiques concurrentes**, avec des temps de réponse croissants observés : 10,84 s →
18,52 s → 25,13 s → 36,25 s. Aucun blocage fonctionnel (l'écran finit par afficher le bon
résultat, cf. garde `fetchSeqRef` déjà en place), mais la dégradation est nette et visible.

Fait suite à TASK-083 (fenêtre par défaut 30 jours glissants, fusion des 4 `useEffect` de fetch
en un point d'entrée unique) et TASK-079 (séquencement anti-race-condition `fetchSeqRef`) — ces
deux tâches réduisent déjà le nombre de déclenchements de fetch, mais ne traitent pas le fetch
précédent encore *en vol* quand un nouveau part.

## Problème constaté
Dans `fetchReglements` (`App.tsx:640-656`), la garde `fetchSeqRef` empêche uniquement
d'**appliquer** la réponse d'une requête périmée (`if (seq !== fetchSeqRef.current) return`).
Elle n'annule jamais la requête HTTP en cours (`axios.get` n'a pas de `signal`/`AbortController`).
Donc si l'utilisateur change de filtre plusieurs fois avant que le fetch précédent ait répondu,
**toutes les requêtes SQL correspondantes continuent de s'exécuter en parallèle** côté serveur,
se font concurrence pour les mêmes ressources (connexions, verrous, CPU), et ralentissent les
unes les autres — cohérent avec la progression 10,84 s → 18,52 s → 25,13 s → 36,25 s observée.

**Limite déjà identifiée côté backend** (vérifiée par lecture de code, `ReglementController.cs`
ligne 26-27) : `GetReglements` est une action **synchrone** (`IActionResult`, pas
`Task<IActionResult>`), sans paramètre `CancellationToken` nulle part dans le controller.
Une annulation `AbortController` côté front stoppera bien l'attente et le traitement de la
réponse dans le navigateur, mais **n'interrompra pas l'exécution SQL déjà lancée côté serveur**
tant que l'action reste synchrone sans `CancellationToken` propagé. Rendre l'action asynchrone
et propager un `CancellationToken` jusqu'à la requête SQL/DLL Trésorerie sous-jacente est une
tâche distincte, probablement plus lourde (dépend de si la DLL métier `Tresorerie.*` supporte
l'annulation) — **hors périmètre de cette TASK**, à ouvrir séparément si le gain constaté côté
front est jugé insuffisant.

## Objectif
Éviter l'empilement de requêtes concurrentes générées par des changements de filtre rapprochés :
quand un nouveau fetch part, annuler la requête HTTP précédente encore en vol côté navigateur.
Résultat mesurable attendu : lors d'un enchaînement rapide de filtres, au plus une requête
`GET /api/reglements` en vol à la fois côté client (visible dans l'onglet réseau du navigateur).

## Fichiers concernés
- `gocom-web/src/App.tsx` (fonction `fetchReglements`, ligne ~640, et son `fetchSeqRef`)

## Étapes d'implémentation
1. Ajouter un `useRef<AbortController | null>` dédié (ex. `abortControllerRef`).
2. Dans `fetchReglements`, avant de lancer le nouveau `axios.get` : si un controller précédent
   existe, l'annuler (`abortControllerRef.current?.abort()`), puis créer et stocker un nouveau
   `AbortController`, et passer `{ signal: controller.signal, params }` à `axios.get`.
3. Conserver la garde `fetchSeqRef` existante telle quelle (défense en profondeur, coût nul) —
   ne pas la retirer.
4. Gérer proprement l'erreur d'annulation dans le `catch` (axios lève une erreur `CanceledError`
   sur abort) : ne pas la logger comme une vraie erreur applicative (`console.error`), l'ignorer
   silencieusement — sinon chaque changement de filtre rapide polluerait la console.
5. Vérifier qu'aucun autre point d'appel (`handleExport` ligne ~370, les 3 `fetchReglements`
   post-action lignes 560/597/631, le bouton rafraîchir ligne ~1016) n'est perturbé par le
   partage du même `abortControllerRef` — si un de ces appels doit pouvoir coexister avec un
   fetch de liste en cours sans s'annuler mutuellement, documenter le choix dans le VERIFY.

## Contraintes
- Ne jamais bypasser une règle de sécurité ou une DLL métier GRC.
- Respecter la Clean Architecture (Domain ← Application ← Infrastructure/API) — cette TASK est
  strictement front, aucun changement backend attendu.
- Ne pas tenter d'ajouter un `CancellationToken` côté `ReglementController`/`ReglementService`
  dans le cadre de cette TASK (cf. limite documentée ci-dessus) — ouvrir une TASK dédiée si jugé
  nécessaire après mesure du gain obtenu ici.
- Respecter le pattern de grilles `ARCHITECTURE.md` (aucun changement de filtre attendu ici,
  seulement le mécanisme de fetch).

## Checklist VALIDATION (à remplir dans VERIFY/)
- [ ] Build OK
- [ ] Comportement vérifié end-to-end : reproduire un enchaînement rapide de plusieurs filtres
      et confirmer dans l'onglet réseau du navigateur qu'au plus une requête `/api/reglements`
      reste active à la fois (les précédentes apparaissent annulées/`canceled`)
- [ ] Aucun `console.error` parasite généré par l'annulation volontaire d'une requête
- [ ] Aucun credential/secret en dur introduit
- [ ] Aucune dette technique silencieuse
- [ ] Cohérent avec l'architecture
