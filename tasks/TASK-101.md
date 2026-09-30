# TASK-101 — Rapprochement : bouton « Exporter » sur la grille Relevé et sur la grille Règlements GRC

- **Priorité** : 🟡 Mineur
- **Domaine** : Front
- **Statut** : TODO
- **Dépend de** : — (de préférence après TASK-100, pour exporter aussi la colonne « Relevé »)

## Contexte
Demande PO (2026-09-30) : exporter l'affichage de chaque grille. La lib `xlsx` est déjà en
dépendance et utilisée : `App.tsx:4` et export `App.tsx:~420-438` (`json_to_sheet` →
`XLSX.writeFile`). **Réutiliser ce mécanisme, aucune nouvelle dépendance.**

## Problème constaté
Aucun export dans `RapprochementBancaire.tsx`.

## Objectif
Un bouton « Exporter » (icône `Download`) dans l'en-tête de chaque grille :
- **Relevé** : exporte `sortedLignes` (lignes **après filtres et tri**), colonnes visibles
  (Repère, Date Op., Date Val., Libellé, Référence, Code, Crédit).
- **Règlements GRC** : exporte `sortedReglements` (après filtres/tri), colonnes = `selectedColumns`
  dans l'ordre affiché, libellés = ceux de l'en-tête, valeurs lisibles (mode « Virement », OUI/NON,
  date jj/mm/aaaa) via `getGrcCellValue`/`renderSharedCell` — **pas d'ids bruts**.
- Montants exportés en **nombre** (sommables), pas en chaîne formatée.
- Fichiers : `Export_Releve_<yyyy-mm-dd>.xlsx` et `Export_Reglements_GRC_<yyyy-mm-dd>.xlsx`.
- Bouton désactivé (infobulle) si la grille est vide.
- L'export reflète l'écran : ce qui est filtré n'est pas exporté.

## Fichiers concernés
- `gocom-web/src/RapprochementBancaire.tsx`

## Étapes d'implémentation
1. `import * as XLSX from 'xlsx'`.
2. Deux handlers `handleExportReleve` / `handleExportGrc` construisant `exportData` à partir des
   listes triées/filtrées.
3. Boutons dans `.grid-header` de chaque bloc, style compact aligné sur l'existant.

## Contraintes
- Pas de nouvelle dépendance ; pas de nouveau composant de grille.
- Aucune donnée hors périmètre affiché exportée.
- **Après TASK-106 / TASK-100** : la colonne « Repère » exportée est le **repère affiché** (`formatRepere(...)`, p. ex. `12-A` quand plusieurs relevés sont cochés, ou pour un règlement « réservé ailleurs »), **jamais** la lettre brute `lettrage` ; la colonne « Relevé » (`titre (#id)`) est exportée **quand elle est visible** (plus d'un relevé coché). Sens crédit uniquement : aucune ligne débit.

## Checklist VALIDATION (à remplir dans VERIFY/, preuve datée par critère)
- [ ] Build OK
- [ ] Export Relevé : nb de lignes du fichier = compteur affiché, filtres actifs respectés
- [ ] Export GRC : colonnes/ordre/libellés = écran ; montants numériques
- [ ] Grille vide : bouton désactivé
- [ ] Aucun credential/secret en dur introduit
- [ ] Aucune dette technique silencieuse
- [ ] Cohérent avec l'architecture
