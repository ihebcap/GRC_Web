# VERIFY — TASK-076 : Mode Comptabilisation : le verrou du filtre "comptabilise" est contournable

## Contexte et Problème

En mode Comptabilisation (`isComptabilisationMode`), le filtre de colonne `comptabilise` affichait le pictogramme cadenas 🔒 mais ne retirait pas le composant `<ExcelFilter>` du DOM, contrairement au mode Rapprochement (`isRapprochementMode`) pour la colonne `pointe`.
L'utilisateur pouvait donc ouvrir le menu déroulant du filtre Excel, cocher "Oui" (déjà comptabilisés), et altérer les résultats de la grille en mode Comptabilisation.

De plus, lors d'une bascule directe entre modes (Rapprochement ↔ Comptabilisation), le filtre forcé du mode précédent restait présent comme un filtre actif standard.

## Modifications apportées

### 1. Exclusion du composant `<ExcelFilter>` du DOM (`gocom-web/src/App.tsx`)
- La condition de rendu du filtre en en-tête de colonne a été complétée symétriquement :
  `!(isComptabilisationMode && col.key === 'comptabilise')`.
- En mode Comptabilisation, aucun `<ExcelFilter>` n'est rendu pour la colonne `comptabilise` : seul le cadenas 🔒 avec son info-bulle explicite est présent dans le DOM.

### 2. Garde-fou défensif dans `handleFilterChange` (`gocom-web/src/App.tsx`)
- Même en cas d'appel programmatique imprévu à `handleFilterChange`, les colonnes verrouillées sont protégées :
  - `if (isRapprochementMode && key === 'pointe') return;`
  - `if (isComptabilisationMode && key === 'comptabilise') return;`

### 3. Nettoyage résiduel lors des bascules directes de modes (`gocom-web/src/App.tsx`)
- Lors de l'activation du mode Comptabilisation : suppression de `pointe` des filtres et vidage de `selectedReglements`.
- Lors de l'activation du mode Rapprochement : suppression de `comptabilise` des filtres et vidage de `selectedComptabilisation`.

## Fichiers modifiés

| Fichier | Modification |
|---|---|
| `gocom-web/src/App.tsx` | Retrait de `<ExcelFilter>` sur `comptabilise`, verrouillage dans `handleFilterChange`, nettoyage croisé lors des bascules de mode |
| `tasks/TASK-076.md` | Mise à jour du statut |

## Validation

- **Build Front** : `npm run build` exécuté avec succès (`tsc -b && vite build` terminé en 561ms, code de sortie 0).
- **Linter** : `npm run lint` (`oxlint`) exécuté avec 0 erreurs.
- **Vérification comportementale DOM** :
  - Mode Comptabilisation activé : `col.key === 'comptabilise'` retire le composant `<ExcelFilter>`, seul `<span title="Filtre verrouillé en mode Comptabilisation">🔒</span>` est rendu.
  - Mode Rapprochement activé : `col.key === 'pointe'` retire le composant `<ExcelFilter>`, seul `<span title="Filtre verrouillé en mode Rapprochement">🔒</span>` est rendu.
  - Autres colonnes : `<ExcelFilter>` reste rendu et fonctionnel (ET logique préservé).
  - Bascule directe : aucun filtre fantôme résiduel conservé.
