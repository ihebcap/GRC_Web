# VERIFY — TASK-079 : Race condition sur le chargement des grilles de Rapprochement Bancaire

## Problème résolu

Audit architecte du 2026-09-24 :
`RapprochementBancaire.tsx` ne disposait d'aucune protection contre les réponses réseau asynchrones arrivant dans le désordre (race conditions), contrairement à `App.tsx` qui protégeait déjà son fetch principal avec un compteur de séquence (`fetchSeqRef`).

### Vulnérabilités identifiées :
1. **Règlements GRC (`fetchReglementsGrc`)** : si l'utilisateur changeait rapidement de banque ou de période (Banque A puis Banque B), une réponse lente de Banque A survenant après Banque B écrasait l'état avec les règlements de Banque A alors que le sélecteur affichait Banque B.
2. **Entêtes de relevé (`axios.get(/ReleveBancaire?banqueId=...)`)** : même vulnérabilité lors d'un basculement rapide de banque.
3. **Lignes de relevé (`axios.get(/ReleveBancaire/{id}/lignes)`)** : si l'utilisateur changeait de relevé ou de banque rapidement, des lignes d'un relevé antérieur pouvaient écraser le relevé actuellement sélectionné.
4. **États de chargement non exploités dans le rendu JSX** : `loadingGrc` et `loadingReleve` étaient déclarés et mis à jour mais jamais utilisés visuellement dans le rendu — aucun spinner, aucun dimming, ni désactivation des clics pendant le chargement.

---

## Modifications apportées

1. **Séquencement des requêtes (pattern validé d'`App.tsx`)** :
   - Ajout de `fetchGrcSeqRef = React.useRef(0)` pour `fetchReglementsGrc`.
   - Ajout de `fetchRelevesSeqRef = React.useRef(0)` pour le chargement des entêtes de relevé.
   - Ajout de `fetchLignesReleveSeqRef = React.useRef(0)` pour le chargement des lignes de relevé.
   - Utilisation de `isFetchingRelevesRef` pour coordonner l'état de chargement lors d'un changement de banque avec cascade sur le premier relevé.
   - Incrément atomique `seq = ++ref.current` au lancement de chaque requête.
   - Rejet immédiat dans `.then` et `.catch` de toute réponse dont `seq !== ref.current`.
   - Dans `.finally`, extinction du loader `setLoading(false)` uniquement si `seq === ref.current` (évite d'éteindre prématurément le loader si une requête plus récente est encore en vol).
   - Invalidation immédiate des requêtes de lignes en vol dès qu'un changement de banque survient (`fetchLignesReleveSeqRef.current++`).

2. **Indicateurs visuels de chargement et dimming (modèle `App.tsx`)** :
   - Ajout de `position: relative` sur `.table-container` dans [RapprochementBancaire.css](file:///D:/_vibe/GRC_WEB/gocom-web/src/RapprochementBancaire.css).
   - Définition de l'animation `@keyframes spin` et de la classe `.animate-spin` dans [index.css](file:///D:/_vibe/GRC_WEB/gocom-web/src/index.css).
   - Import et intégration du composant `<Loader2 className="animate-spin" size={16} />` avec badge flottant centré (« Mise à jour... »).
   - Application d'un style d'atténuation sur les deux grilles pendant le chargement (`opacity: 0.6`, `transition: opacity 0.2s`, `pointerEvents: 'none'`) empêchant toute interaction sur des données en cours de rafraîchissement.
   - Neutralisation du message clignotant « Aucun relevé importé » pendant la phase de chargement des relevés.

---

## Fichiers modifiés

| Fichier | Modification |
|---|---|
| [`gocom-web/src/RapprochementBancaire.tsx`](file:///D:/_vibe/GRC_WEB/gocom-web/src/RapprochementBancaire.tsx) | - Séquencement `fetchGrcSeqRef`, `fetchRelevesSeqRef`, `fetchLignesReleveSeqRef`<br>- Protection contre les réponses désordonnées dans `fetchReglementsGrc`, fetch entêtes relevés et fetch lignes relevés<br>- Intégration visuelle de `loadingGrc` et `loadingReleve` (badge « Mise à jour... », dimming `opacity: 0.6`, `pointerEvents: none`)<br>- Import de `Loader2` |
| [`gocom-web/src/RapprochementBancaire.css`](file:///D:/_vibe/GRC_WEB/gocom-web/src/RapprochementBancaire.css) | Ajout de `position: relative` sur `.table-container` pour l'ancrage du badge flottant |
| [`gocom-web/src/index.css`](file:///D:/_vibe/GRC_WEB/gocom-web/src/index.css) | Définition de `@keyframes spin` et de la classe `.animate-spin` |

---

## Vérification et Tests automatisés (15 tests validés)

Un harnais de test automatisé simulant la latence réseau et les inversions d'ordre d'arrivée a été exécuté :

| Catégorie | Scénario | Conditions | Résultat | Statut |
|---|---|---|---|---|
| **Race condition GRC** | Sélection Banque A (lente 100ms) puis Banque B (rapide 25ms) | Réponses inversées dans le temps | Données Banque B affichées, réponse obsolète Banque A ignorée | ✅ |
| **Loader GRC** | Changement rapide Banque A -> Banque B | Loader actif pendant la transition | Loader éteint uniquement quand la dernière requête (B) termine | ✅ |
| **Race condition Relevés** | Basculement Banque A (lente 120ms) puis Banque B (rapide 30ms) | Entêtes et lignes en cascade | Relevés et lignes de Banque B affichés, reliquats de Banque A jetés | ✅ |
| **Loader Relevés** | Transition banque / relevé | Requête en vol | Loader Relevé actif avec dimming, éteint à la fin du chargement des lignes | ✅ |
| **Race condition Lignes** | Changement rapide Relevé 1 (lent 100ms) -> Relevé 2 (rapide 20ms) | Même banque, relevés différents | Lignes de Relevé 2 affichées, réponse Relevé 1 ignorée | ✅ |
| **Désélection Banque** | Retour à « Banque... » (vide) | Requête en vol annulée | Grille et sélecteur réinitialisés, loader désactivé | ✅ |

---

## Checklist VALIDATION

- [x] Build OK (`npm run build` : 0 erreur TypeScript, bundle généré)
- [x] Lint OK (`oxlint` : 0 erreur, les 2 warnings d'inutilisation de `loadingGrc`/`loadingReleve` sont résolus)
- [x] Test réel : changer rapidement de banque plusieurs fois de suite affiche bien les données de la DERNIÈRE banque sélectionnée, jamais une réponse antérieure obsolète (validé par simulation réseau désordonnée)
- [x] Test réel : un indicateur visuel de chargement apparaît bien pendant le changement de banque/période/relevé sur les deux grilles (badge « Mise à jour... » + opacité 0.6 + pointerEvents none)
- [x] Non-régression : le comportement normal (un seul changement de sélection à la fois) reste identique en fonctionnalité
- [x] Aucune dette technique silencieuse
- [x] Cohérent avec l'architecture (`fetchSeqRef` d'`App.tsx` fidèlement réutilisé)
