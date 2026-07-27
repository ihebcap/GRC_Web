# ARCHITECTURE.md — Conventions transverses GRC_WEB

## Grilles de données (tableaux avec filtres)

Toute nouvelle grille de données tabulaires (factures, règlements, relevés, écritures...)
DOIT réutiliser le pattern existant, validé sur `ReglementGenerationEspece.tsx` (TASK-059/062/063) :

- **Filtre par colonne** : composant `gocom-web/src/ExcelFilter.tsx`, mode `list` par défaut
  (checklist de valeurs uniques + recherche intégrée), pas de champ texte libre ni de plage
  min/max sauf dérogation explicite du PO documentée dans le VERIFY.
- **Config colonnes** : tableau `ColumnDef[]` (`key`, `label`, `filterType`, `defaultVisible`)
  suivant le modèle `ALL_COLUMNS` de `ReglementGenerationEspece.tsx:50-64`.
- **Valeurs uniques** : `getOptions(key)` — `Array.from(new Set(...))`, trié, libellé `(Vide)`
  pour valeur vide. Ne pas dupliquer cette logique.
- **Choix des colonnes affichées** : persistance `localStorage`, une clé dédiée par écran
  (ex. `gocom_reglement_espece_columns`), pattern `ReglementGenerationEspece.tsx:66,84-119`.

**Interdit** : inventer un nouveau composant de filtre, un nouveau mécanisme de persistance
colonnes, ou un filtre texte/plage sans accord PO préalable.

**Écarts actés** : si le PO juge le mode `list` inutilisable sur une colonne à forte
cardinalité (montant, date), documenter l'écart dans le VERIFY — ne pas revenir en arrière
silencieusement (cf. TASK-063).
