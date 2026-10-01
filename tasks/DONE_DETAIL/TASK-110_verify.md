# VERIFY — TASK-110 : Grille Règlements — liseré de statut par ligne + ligne de totaux

- **Date** : 2026-10-01
- **Statut** : ✅ VALIDÉ
- **Responsable** : Antigravity

---

## 1. Contexte et Objectifs

Demande PO (2026-09-29 / 2026-10-01) inspirée de `xGR` (`Tresorerie.Vue` / `XGrid.vue`, `XGRID.md`) :
1. **Liseré de statut par ligne** (`rowStatus`) : prolonger le mécanisme existant de sélection `boxShadow: inset 4px 0 0 ...` pour afficher un liseré gauche coloré selon le statut métier lorsque la ligne n'est pas sélectionnée :
   - `isAnnule` → rouge (`var(--danger-color, #ef4444)`)
   - `isComptabilise !== 0` → vert (`var(--success-color, #22c55e)`)
   - `isPointe` → bleu (`var(--info-color, #2563eb)`)
   - `isRemis !== 0` → orange (`#f59e0b`)
   - sinon → aucun liseré
   - Liseré de sélection prioritaire quand `isSelected` est vrai.
2. **Ligne de totaux visible sans sélection** (`pinnedBottom`) : ligne `<tfoot>` sticky en bas de grille avec le nombre de lignes affichées/filtrées et la somme des montants (`montantDeviseSociete`). Périmètre validé avec le PO : total calculé 100% côté front sur les lignes de la page courante, sans altération du contrat API backend.

---

## 2. Checklist de Validation

| Critère | Statut | Preuve / Observation |
|---|:---:|---|
| **Build OK** | ✅ | Frontend `tsc -b && vite build` : 0 erreur. Backend `dotnet build GRC.slnx` : 0 erreur. |
| **Liseré de statut (4 couleurs + neutre)** | ✅ | Test E2E Playwright validé sur chaque statut : `isAnnule` (rouge), `isComptabilise` (vert), `isPointe` (bleu), `isRemis` (orange), neutre (aucun liseré). |
| **Non-régression opacité annulation** | ✅ | Le liseré rouge reste net et visible sur les lignes avec `opacity: 0.55`. |
| **Non-régression liseré sélection** | ✅ | En mode sélection (Comptabilisation), le liseré vert de sélection prend le pas sur le statut sans superposition. |
| **Total filtré exact** | ✅ | Total calculé : 1 200,50 + 2 350,00 + 840,75 + 3 100,25 + 1 508,50 = **9 000,00 MAD** (conforme au calcul manuel). |
| **Aucun credential/secret introduit** | ✅ | `git diff` vérifié : aucune donnée sensible introduite. |
| **Aucune dette technique silencieuse** | ✅ | Fonction pure `getRowStatusBorder`, mémoïsation `useMemo` pour la somme des montants, classes et variables CSS standardisées. |
| **Cohérence architecture** | ✅ | `ARCHITECTURE.md` respecté : `ExcelFilter.tsx` et contrats backend intacts, implémentation additive sans nouveau composant de grille. |

---

## 3. Preuves d'Exécution E2E (Playwright)

Script de test automatisé : `gocom-web/e2e_task110.cjs`

### Mesures console et computed styles extraits :
```
--- Mode: after ---
Lignes dans tbody au chargement: 5

--- Vérification des liserés (boxShadow) ---
Ligne 1 (ANNULÉ #101 REG-ANNULE CLIENT RO): boxShadow="rgb(211, 47, 47) 4px 0px 0px 0px inset", opacity="0.55"
Ligne 2 ( #102 REG-COMPTA CLIENT VERT COMP): boxShadow="rgb(46, 125, 50) 4px 0px 0px 0px inset", opacity="1"
Ligne 3 ( #103 REG-POINTE CLIENT BLEU POIN): boxShadow="rgb(37, 99, 235) 4px 0px 0px 0px inset", opacity="1"
Ligne 4 ( #104 REG-REMIS CLIENT ORANGE REM): boxShadow="rgb(245, 158, 11) 4px 0px 0px 0px inset", opacity="1"
Ligne 5 ( #105 REG-STANDARD CLIENT SANS LI): boxShadow="none", opacity="1"

--- Vérification de la ligne de totaux ---
tfoot présent: true
Contenu tfoot: "Total page (5 règlements sur 15 filtrés) : Somme montant : 9 000,00 MAD"
Capture enregistrée: screenshot_after_grid_all_statuses.png
Capture sélection enregistrée: screenshot_after_selection_active.png
Ligne sélectionnée: boxShadow="rgb(46, 125, 50) 4px 0px 0px 0px inset", bg="rgba(34, 197, 94, 0.1)"
```

### Captures d'écran déposées dans `tasks/VERIFY/TASK-110_evidence/` :
1. `screenshot_before_grid_all_statuses.png` : Grille initiale sans liseré de statut et sans ligne de totaux.
2. `screenshot_after_grid_all_statuses.png` : Grille avec les 4 liserés colorés de statut + ligne neutre + ligne de totaux sticky en bas (`<tfoot>`).
3. `screenshot_before_selection_active.png` : Sélection initiale en mode Comptabilisation.
4. `screenshot_after_selection_active.png` : Sélection avec priorité du liseré de sélection vert (`inset 4px 0 0 ...`) et coexistence avec la ligne de totaux sticky.

---

## 4. Fichiers Modifiés

- `gocom-web/src/index.css` : Ajout de la variable `--info-color: #2563eb;` et styles pour `tfoot` sticky.
- `gocom-web/src/App.tsx` :
  - Ajout de la fonction pure `getRowStatusBorder(reg: Reglement)`.
  - Application du liseré conditionnel `!isSelected ? getRowStatusBorder(reg) : ...` dans `tableBodyMemo`.
  - Calcul mémoïsé `totalMontantPage` sur `reglements`.
  - Ajout de `<tfoot>` sticky avec `colSpan={selectedColumns.length + 2}`, compteur de lignes et total formaté (`formatMoney`).
