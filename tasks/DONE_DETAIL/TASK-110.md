# TASK-110 — Grille Règlements : liseré de statut par ligne + ligne de totaux (inspiré xGR)

- **Priorité** : 🟡 Mineur
- **Domaine** : Architecture (UI)
- **Statut** : DONE (APPROVE 2026-10-01)
- **Dépend de** : — (indépendante ; à ne pas lancer en parallèle de TASK-109 sur `App.tsx`, même zone de rendu `tableBodyMemo`)

## Contexte

Demande PO (2026-09-29/10-01) : analyse comparative du thème/UX de `D:\_vibe\xGR\xGR\Tresorerie.Vue`
(composant `XGrid.vue`, doc `XGRID.md`) vs la grille actuelle de GRC_WEB — voir
`pilotage/ANALYSE_UX_XGR_VS_GRC_WEB_2026-09-29.md`. Le PO a demandé de reprendre **le minimum** pour
se rapprocher de la logique xGR, sans changer de stack ni de pattern de filtre (`ARCHITECTURE.md`
reste la référence pour `ExcelFilter`/`ColumnDef`).

Deux idées xGR retenues, choisies parce qu'elles **prolongent un mécanisme déjà présent dans
`App.tsx`** plutôt que d'en introduire un nouveau :

1. **Liseré de statut par ligne** (`rowStatus` dans `XGrid.vue`, §8.19 de `XGRID.md`) — bord gauche
   coloré selon l'état métier de la ligne. `App.tsx:792-793` utilise déjà exactement ce mécanisme
   (`boxShadow: inset 4px 0 0 var(--success-color, #22c55e)`) pour matérialiser `isSelected` : il
   s'agit de l'étendre au cas non sélectionné, avec les couleurs déjà en place dans le code
   (`--success-color #22c55e`, `--danger-color #ef4444`, `#f59e0b`), pas d'en inventer de nouvelles.
2. **Ligne de totaux visible sans sélection** (`pinnedBottom`, §8.9 de `XGRID.md`) — xGR affiche une
   ligne sticky en bas de grille avec la somme de toutes les lignes **filtrées**. GRC_WEB a déjà un
   total, mais seulement pour les lignes **sélectionnées** en mode Comptabilisation
   (`App.tsx:1208-1216`, « Total Sélectionné »). Rien n'affiche le total de l'ensemble filtré
   actuellement visible à l'écran.

## Problème constaté

- Statut métier déjà calculé par ligne (`isAnnule`, `isComptabilise`, `isPointe`, `isRemis` —
  cf. `getModificationDisabledReason`, `App.tsx:61-69`, utilisé depuis TASK-093) mais **aucun
  indice visuel de couleur** à l'échelle de la ligne entière : l'utilisateur doit lire les colonnes
  ou ouvrir l'infobulle du bouton Modifier pour connaître l'état d'un règlement.
- Aucun total du jeu de données filtré actuellement affiché : seul le total de la sélection
  (mode Comptabilisation) existe. En mode Rapprochement, aucun total n'est affiché du tout.

## Objectif

1. Chaque ligne de la grille Règlements (`App.tsx`, `tableBodyMemo`) affiche, **quand elle n'est
   pas sélectionnée**, un liseré gauche de 4px dont la couleur reflète son statut, dans cet ordre
   de priorité (le premier qui matche l'emporte) :
   - `isAnnule` → rouge (`var(--danger-color, #ef4444)`)
   - `isComptabilise !== 0` → vert (`var(--success-color, #22c55e)`)
   - `isPointe` → bleu (nouvelle variable `--info-color`, défaut `#2563eb` — déjà utilisé comme
     couleur du bouton Modifier à `App.tsx:795-798`, donc cohérent avec l'existant)
   - `isRemis !== 0` → orange (`#f59e0b`, déjà utilisé ailleurs dans `App.tsx` pour les avertissements)
   - sinon → pas de liseré (comportement actuel inchangé)
   Quand la ligne **est** sélectionnée, le comportement actuel (liseré vert de sélection) reste
   prioritaire et inchangé — ne pas superposer deux liserés.
2. Une ligne de totaux apparaît en bas de la grille (sticky si possible, sinon ligne `<tfoot>`
   simple en V1), affichant :
   - le nombre de lignes actuellement filtrées (déjà disponible via `reglements.length` ou `total`
     selon pagination serveur en place),
   - la somme de `montantDeviseSociete` des lignes actuellement filtrées (pas seulement
     sélectionnées).
   Cette ligne est additive : elle ne remplace pas le bloc « Total Sélectionné » existant du mode
   Comptabilisation (`App.tsx:1208-1216`), qui reste tel quel.

## Fichiers concernés

- `gocom-web/src/App.tsx` (`tableBodyMemo` l.757-920 pour le liseré ; zone tableau l.1322+ pour la
  ligne de totaux)
- `gocom-web/src/index.css` (si une nouvelle variable `--info-color` est ajoutée, à côté des
  variables `--success-color`/`--danger-color` existantes)

## Étapes d'implémentation

1. Localiser la déclaration des variables CSS de couleur (`--success-color`, `--danger-color`) dans
   `index.css` et ajouter `--info-color: #2563eb;` au même endroit si elle n'existe pas déjà.
2. Dans `tableBodyMemo` (`App.tsx:789-794`), calculer une couleur de statut par ligne (fonction pure,
   même ordre de priorité que ci-dessus) et l'appliquer en `boxShadow` **uniquement si `!isSelected`**
   — ne pas toucher à la branche `isSelected` existante.
3. Calculer le total filtré (somme `montantDeviseSociete` sur `reglements`, le tableau déjà chargé
   côté client pour la page courante — **attention** : si pagination serveur active (cf. TASK-107),
   clarifier avec le PO si le total doit porter sur la page affichée ou sur l'ensemble filtré côté
   serveur avant d'implémenter ; ne pas improviser ce choix).
4. Ajouter la ligne de totaux sous le `<tbody>` (ou `<tfoot>`), réutilisant `formatMoney` et le
   `colSpan` déjà calculé ailleurs (`selectedColumns.length + 2`, cf. `App.tsx:883,918`).
5. Vérifier qu'aucune des 4 couleurs ne rentre en conflit visuel avec le `opacity: 0.55` déjà
   appliqué aux lignes annulées (`App.tsx:790`) — le liseré rouge doit rester visible malgré
   l'opacité réduite.

## Contraintes

- Ne pas introduire de nouveau composant de grille ni toucher à `ExcelFilter.tsx` — cette TASK est
  additive autour du rendu existant, pas un remplacement du pattern de filtre (`ARCHITECTURE.md`).
- Ne pas reprendre d'autres idées de `XGrid.vue` (opérateurs de filtre riches, regroupement,
  colonnes épinglées par glisser-déposer, Advanced Filter) — explicitement hors périmètre de cette
  TASK, cf. `pilotage/ANALYSE_UX_XGR_VS_GRC_WEB_2026-09-29.md` §5.
- Si pagination serveur (TASK-107) est déjà livrée au moment de cette TASK, vérifier la cohérence
  du total affiché avec la source de vérité choisie dans TASK-107 — signaler et bloquer si ambigu
  plutôt que d'improviser.
- Respecter la Clean Architecture : aucune modification backend nécessaire a priori (données déjà
  exposées par l'API existante) — si un champ supplémentaire s'avère nécessaire, s'arrêter et
  signaler avant d'étendre le contrat API.

## Checklist VALIDATION (à remplir dans VERIFY/)
- [x] Build OK
- [x] Comportement vérifié end-to-end (capture d'écran avant/après pour les 4 couleurs de statut +
  la ligne de totaux, sur au moins un règlement de chaque statut)
- [x] Liseré de sélection existant non régressé (capture avec une ligne sélectionnée)
- [x] Total filtré exact (vérifié par calcul manuel sur un jeu de données de test)
- [x] Aucun credential/secret en dur introduit
- [x] Aucune dette technique silencieuse
- [x] Cohérent avec l'architecture (`ARCHITECTURE.md` §Grilles de données non enfreint)
