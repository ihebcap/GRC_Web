# TASK-076 — Mode Comptabilisation : le verrou du filtre "comptabilise" est contournable

- **Priorité** : 🔴 Bloquant
- **Domaine** : Correction (Front)
- **Statut** : DONE
- **Dépend de** : —

## Contexte

Audit architecte du 2026-09-24. `App.tsx` a deux modes spéciaux sur la grille de règlements : mode
Rapprochement (`isRapprochementMode`) et mode Comptabilisation (`isComptabilisationMode`). Dans ces
modes, un filtre de colonne est censé être verrouillé (icône 🔒) et forcé à une valeur cohérente
avec l'intention métier du mode : `pointe='non'` en Rapprochement, `comptabilise='non'` en
Comptabilisation.

## Problème constaté

`App.tsx:1204` :

```jsx
{col.key !== 'no' && !(isRapprochementMode && col.key === 'pointe') && (
  <ExcelFilter ... onChange={(val) => handleFilterChange(col.key, ...)} />
)}
{isRapprochementMode && col.key === 'pointe' && <span ...>🔒</span>}
{isComptabilisationMode && col.key === 'comptabilise' && <span ...>🔒</span>}
```

La condition qui retire le composant `<ExcelFilter>` du rendu ne teste QUE
`isRapprochementMode && col.key === 'pointe'`. Elle ne teste jamais
`isComptabilisationMode && col.key === 'comptabilise'`. Résultat : en mode Comptabilisation, la
colonne "comptabilise" affiche le cadenas 🔒 (purement décoratif) **ET** un `<ExcelFilter>`
pleinement actif juste à côté — asymétrie de code entre les deux modes, vraisemblablement un oubli
lors de l'ajout du mode Comptabilisation par copie du mode Rapprochement.

**Scénario concret** :
1. Clic "Comptabiliser" → `isComptabilisationMode=true`, `filters.comptabilise='non'`.
2. Colonne "comptabilise" : le 🔒 est visible mais le filtre reste cliquable.
3. L'utilisateur ouvre le filtre, coche "Oui", décoche "Non", valide.
4. `handleFilterChange` écrase `filters.comptabilise` à `'oui'` sans aucun garde-fou.
5. La requête part avec `comptabilise=true` — contradiction directe avec l'intention du mode
   (afficher les règlements restant à comptabiliser). Aucune resynchronisation automatique ne
   remet `'non'`.

Le mode Rapprochement, lui, est correctement protégé sur ce point exact : `pointe` n'a tout
simplement aucun `<ExcelFilter>` rendu dans le DOM en mode Rapprochement (pas de composant
cliquable), donc pas de contournement possible.

Point annexe constaté par le même audit (à documenter dans le VERIFY, pas nécessairement à corriger
dans cette TASK sauf si trivial) : lors d'une bascule directe Rapprochement → Comptabilisation (sans
repasser par le mode normal), le filtre `pointe='non'` du mode précédent n'est pas explicitement
retiré de `filters` — il redevient un filtre "normal" avec l'icône entonnoir standard, sans qu'aucun
état visuel incohérent (double cadenas) n'apparaisse. Effet mineur mais réel : ce filtre résiduel
continue de restreindre les résultats sans être signalé comme intentionnel.

## Objectif

En mode Comptabilisation, la colonne "comptabilise" doit être verrouillée de la même façon robuste
que "pointe" en mode Rapprochement : composant de filtre totalement retiré du DOM (pas seulement
grisé/décoratif), impossible à modifier tant que le mode est actif.

## Fichiers concernés

- `gocom-web/src/App.tsx` (ligne ~1204 et environs)

## Étapes d'implémentation

1. Corriger la condition d'exclusion du rendu de `<ExcelFilter>` (ligne ~1204) pour couvrir
   symétriquement les deux cas : `isRapprochementMode && col.key === 'pointe'` **et**
   `isComptabilisationMode && col.key === 'comptabilise'`.
2. Vérifier qu'aucun autre endroit du code ne s'attend à ce que le filtre "comptabilise" reste
   modifiable en mode Comptabilisation (grep sur les usages de `filters.comptabilise` dans ce
   fichier).
3. Pour le point annexe (filtre résiduel lors d'une bascule directe entre modes) : si la correction
   est triviale (ex. retirer explicitement la clé de l'ancien mode au moment d'activer le nouveau),
   l'inclure. Sinon, documenter le comportement observé dans le VERIFY sans le corriger, et
   soumettre à l'architecte pour trancher si un fix séparé est nécessaire.

## Contraintes

- Ne jamais bypasser une règle de sécurité ou une DLL métier GRC.
- Ne pas modifier le comportement du mode Rapprochement (déjà correct), uniquement corriger
  l'asymétrie côté Comptabilisation.
- Respecter `ARCHITECTURE.md` § Grilles de données si le composant `ExcelFilter` est touché.

## Checklist VALIDATION (à remplir dans VERIFY/)
- [x] Build OK
- [x] Test réel : en mode Comptabilisation, la colonne "comptabilise" n'affiche plus d'icône de
  filtre cliquable (composant retiré du DOM, pas juste désactivé visuellement)
- [x] Test réel : impossible de faire apparaître des règlements déjà comptabilisés en mode
  Comptabilisation, quelle que soit l'action tentée sur cette colonne
- [x] Non-régression : mode Rapprochement toujours correctement verrouillé sur "pointe"
- [x] Non-régression : les autres filtres de colonnes restent combinables normalement en mode
  Comptabilisation (ET logique préservé)
- [x] Aucune dette technique silencieuse
- [x] Cohérent avec l'architecture
