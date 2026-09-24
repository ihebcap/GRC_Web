# TASK-079 — Race condition sur le chargement des grilles de Rapprochement Bancaire

- **Priorité** : 🟠 Majeur
- **Domaine** : Correction (Front)
- **Statut** : DONE
- **Dépend de** : —

## Contexte

Audit architecte du 2026-09-24. `App.tsx` protège déjà son fetch principal de règlements contre les
réponses réseau qui arrivent dans le désordre, via un compteur de séquence (`fetchSeqRef`,
lignes ~618-640, avec un commentaire indiquant que ce garde-fou corrige un bug réel déjà rencontré).
`RapprochementBancaire.tsx` n'a aucune protection équivalente sur ses propres fetches.

## Problème constaté

`gocom-web/src/RapprochementBancaire.tsx`, `fetchReglementsGrc` (lignes ~462-488) :

```js
const fetchReglementsGrc = React.useCallback(() => {
    setLoadingGrc(true);
    axios.get(`${API_BASE}/reglements?...`)
        .then(res => { setReglementsGrc(res.data.items.map(...)); })
        .catch(err => console.error(err))
        .finally(() => setLoadingGrc(false));
}, [selectedBanqueId, appliedDateDebut, appliedDateFin]);

React.useEffect(() => { fetchReglementsGrc(); }, [fetchReglementsGrc]);
```

Aucun identifiant de requête, aucun `AbortController`/`CancelToken`. **Scénario concret** :
l'utilisateur sélectionne la banque A, puis change rapidement pour la banque B avant que la réponse
de A ne soit revenue. Si la réponse de A (plus lente, ex. plus de données) arrive après celle de B,
c'est `setReglementsGrc` de la requête A qui écrase en dernier — la grille affiche alors les
règlements de la banque A alors que le sélecteur affiche B. Même vulnérabilité pour le chargement
des relevés (lignes ~522-539, dépend de `selectedBanqueId` seul) et des lignes de relevé
(lignes ~541-569, dépend de `selectedReleveId`).

Constat annexe du même audit, à corriger dans la même TASK car même zone de code et même cause
racine (état de chargement non exploité) : les indicateurs `loadingGrc`/`loadingReleve` (déclarés
lignes ~229-230, mis à jour dans les `.then`/`.finally`) **ne sont jamais utilisés dans le rendu**
— aucun spinner, aucun dimming, aucun signal visuel pendant un changement de banque/période/relevé.
L'utilisateur peut croire qu'un changement de filtre n'a rien fait si la requête est lente, ou pire,
interagir avec des données obsolètes en pensant qu'elles sont à jour (sélection de lignes pour
lettrage).

## Objectif

1. Les 3 fetches de cet écran (règlements GRC, entêtes de relevé, lignes de relevé) doivent ignorer
   toute réponse devenue obsolète (arrivée après une requête plus récente déclenchée par un
   changement de sélection).
2. `loadingGrc`/`loadingReleve` doivent produire un signal visuel réel pendant le chargement
   (spinner ou dimming), sur le modèle de ce qui existe déjà dans `App.tsx` (lignes ~1135-1148 :
   bandeau "Mise à jour..." + opacité réduite + `pointerEvents: none` pendant le chargement).

## Fichiers concernés

- `gocom-web/src/RapprochementBancaire.tsx` (`fetchReglementsGrc` et les fetches équivalents pour
  les relevés/lignes de relevé, rendu JSX des grilles)

## Étapes d'implémentation

1. Protéger `fetchReglementsGrc` contre les réponses obsolètes — réutiliser le pattern déjà validé
   dans `App.tsx` (compteur de séquence `fetchSeqRef`) plutôt que d'introduire un nouveau mécanisme
   (`AbortController` accepté aussi si plus adapté au contexte, mais rester cohérent avec l'existant
   du projet si possible).
2. Appliquer la même protection au chargement des entêtes de relevé et des lignes de relevé.
3. Exploiter `loadingGrc`/`loadingReleve` dans le rendu JSX des deux grilles concernées (indicateur
   visuel pendant le chargement, cohérent avec le traitement déjà en place dans `App.tsx`).
4. Ne pas modifier le comportement du mode nominal (pas de changement rapide de sélection) — le
   correctif ne doit être visible que dans le scénario de course/latence.

## Contraintes

- Ne jamais bypasser une règle de sécurité ou une DLL métier GRC.
- Réutiliser un pattern déjà validé dans le projet (`fetchSeqRef` d'`App.tsx`) plutôt que d'inventer
  un nouveau mécanisme, sauf si techniquement injustifiable pour ce contexte — à justifier dans le
  VERIFY si un autre choix est fait.
- Ne pas dégrader la vitesse perçue de l'écran (le signal de chargement doit rester léger, pas un
  écran de chargement plein page comme au premier montage d'App.tsx).

## Checklist VALIDATION (à remplir dans VERIFY/)
- [x] Build OK
- [x] Test réel : changer rapidement de banque plusieurs fois de suite affiche bien les données de
  la DERNIÈRE banque sélectionnée, jamais une réponse antérieure obsolète (à tester avec un
  throttling réseau simulé si nécessaire pour provoquer le désordre de réponses)
- [x] Test réel : un indicateur visuel de chargement apparaît bien pendant le changement de
  banque/période/relevé sur les deux grilles
- [x] Non-régression : le comportement normal (un seul changement de sélection à la fois) reste
  identique en fonctionnalité
- [x] Aucune dette technique silencieuse
- [x] Cohérent avec l'architecture
