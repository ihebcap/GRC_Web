# TASK-029 — Écran d'interrogation relevé : filtres liste inopérants (`selectedValues` undefined)

- **Priorité** : 🟠 Majeur
- **Domaine** : Correction
- **Statut** : TODO
- **Dépend de** : TASK-028 (régression du nouvel écran)

## Contexte
Écran `ReleveInterrogation` créé en TASK-028
([RelevesBancaires.tsx:44](../gocom-web/src/RelevesBancaires.tsx#L44)). Les filtres type Excel
par colonne ne filtrent pas : signalé par le PO.

## Problème constaté
Les filtres **liste** (menus à cases à cocher) — **Libellé**, **Code**, **Statut** — ne
s'appliquent jamais. Au premier clic sur une case, rien ne se sélectionne.

Cause racine : `selectedValues` est passé à `ExcelFilter` **sans fallback `|| []`**, donc
`undefined` tant qu'aucun filtre n'est posé
([RelevesBancaires.tsx:166](../gocom-web/src/RelevesBancaires.tsx#L166),
[169](../gocom-web/src/RelevesBancaires.tsx#L169),
[170](../gocom-web/src/RelevesBancaires.tsx#L170)) :
```
selectedValues={filters['libelle']?.value}   // undefined à l'état initial
```
Or `ExcelFilter` court-circuite quand `selectedValues` est `undefined`
([ExcelFilter.tsx:73](../gocom-web/src/ExcelFilter.tsx#L73) et
[79](../gocom-web/src/ExcelFilter.tsx#L79)) :
```
handleToggleAll: if (!options || !selectedValues) return;
handleToggleOne: if (!selectedValues) return;
```
→ le clic sort immédiatement, aucune valeur n'entre dans `filters`, le filtre reste inactif.

Le pattern de référence [RapprochementBancaire.tsx:929](../gocom-web/src/RapprochementBancaire.tsx#L929)
passe bien `selectedValues={releveFilters['lettrage']?.value || []}` — le `|| []` a été omis lors de la reprise.

## Objectif
Les filtres liste Libellé / Code / Statut sélectionnent et filtrent correctement, comme les
filtres liste de l'écran de rapprochement.

## Fichiers concernés
- `gocom-web/src/RelevesBancaires.tsx`

## Étapes d'implémentation
1. Ajouter le fallback `|| []` aux trois `selectedValues` de type `list` :
   - Libellé ([ligne 166](../gocom-web/src/RelevesBancaires.tsx#L166))
   - Code ([ligne 169](../gocom-web/src/RelevesBancaires.tsx#L169))
   - Statut ([ligne 170](../gocom-web/src/RelevesBancaires.tsx#L170))
   ```
   selectedValues={filters['libelle']?.value || []}
   selectedValues={filters['code']?.value || []}
   selectedValues={filters['statut']?.value || []}
   ```

## Contraintes
- Aucun impact backend, aucune modification d'`ExcelFilter`.
- Ne pas toucher aux filtres texte/date déjà fonctionnels.

## Checklist VALIDATION (à remplir dans VERIFY/)
- [ ] Build front OK
- [ ] Filtre Libellé (liste) : cocher une valeur restreint la grille
- [ ] Filtre Code (liste) : idem
- [ ] Filtre Statut (liste) : idem
- [ ] « Tout sélectionner » et « Effacer » fonctionnent
- [ ] Aucune régression sur les filtres texte/date (Débit, Crédit, Réservé par, Règlement GRC, Date Op.)
