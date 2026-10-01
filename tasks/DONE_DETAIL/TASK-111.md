# TASK-111 — Sidebar noire permanente (identité visuelle, inspirée xGR)

- **Priorité** : 🟡 Mineur
- **Domaine** : Architecture (UI)
- **Statut** : FAIT (validé E2E Playwright, rapport dans `tasks/DONE_DETAIL/TASK-111_verify.md`)
- **Dépend de** : — (CSS uniquement, indépendante de TASK-109/110)

## Contexte

Suite de l'analyse `pilotage/ANALYSE_UX_XGR_VS_GRC_WEB_2026-09-29.md` : xGR (`Tresorerie.Vue`,
`AppSidebar.vue`/`AppTopbar.vue`) a une sidebar **toujours noire** (`background-color: #000000`),
identité de marque fixe — **indépendante d'un éventuel dark mode** (qui reste hors périmètre,
cf. l'analyse §4 : pas de tokens de couleur centralisés dans GRC_WEB, chantier plus lourd).

Confirmé avec le PO (2026-10-01) : périmètre de cette TASK = **uniquement la sidebar/menu** passe
en noir permanent. Le reste de l'application (grilles, fonds de page, cartes) **reste blanc/clair
comme aujourd'hui** — ce n'est pas un dark mode.

## État actuel

`gocom-web/src/index.css:11-14` centralise déjà toutes les couleurs de la sidebar en 4 variables
CSS, utilisées nulle part ailleurs que dans les classes `.app-sidebar`/`.sidebar-*`
(`index.css:101-173`) :

```css
--sidebar-bg: #ffffff;           /* White sidebar */
--sidebar-text: #4a4a4a;
--sidebar-active-bg: #e3f2fd;    /* Light blue background for active */
--sidebar-active-text: #1976d2;  /* Axelor/Material Blue */
```

La sidebar (`App.tsx:927-983`) utilise des icônes `lucide-react` (`FileText`, `Download`,
`DollarSign`, `Calculator`, `Banknote`, `ChevronRight`) qui héritent de `currentColor` — pas de
couleur forcée en dur sur ces icônes de menu (seules `LayoutDashboard` du logo et `ChevronRight`
du chevron ont une couleur inline via variable, à traiter séparément, cf. étape 3).

## Objectif

La sidebar (`.app-sidebar`) a un fond noir permanent, texte et icônes clairs, avec un état actif
qui reste lisible et cohérent avec l'accent de couleur déjà utilisé dans l'app
(`--accent-primary: #1976d2`). Le reste de l'application (contenu principal, grilles, modales)
n'est pas affecté.

## Fichiers concernés

- `gocom-web/src/index.css` (variables `--sidebar-*` l.11-14, classes `.app-sidebar`/`.sidebar-*`
  l.101-173)
- `gocom-web/src/App.tsx` (vérification uniquement — logo l.933,936,943, pas de modification de
  structure attendue)

## Étapes d'implémentation

1. Remplacer les 4 variables `--sidebar-*` (`index.css:11-14`) par des valeurs sombres, par exemple
   (à ajuster pour le contraste/l'accessibilité, cf. étape 4) :
   ```css
   --sidebar-bg: #0a0a0a;
   --sidebar-text: rgba(255,255,255,0.65);
   --sidebar-active-bg: rgba(255,255,255,0.08);
   --sidebar-active-text: #4fc3f7; /* ou accent-primary éclairci si meilleur contraste sur noir */
   ```
   Ne pas toucher `--accent-primary`/`--bg-primary`/`--text-primary` etc. — ces variables servent
   aussi en dehors de la sidebar, un changement là impacterait tout le reste de l'app (hors
   périmètre, cf. Contraintes).
2. Vérifier `.app-sidebar` (`index.css:102-111`) : la `border-right: 1px solid var(--border-color)`
   et le `box-shadow: var(--shadow-sm)` (pensés pour un fond clair) peuvent devenir invisibles ou
   inutiles sur fond noir — ajuster ou retirer si besoin, sans introduire de nouvelle variable
   globale.
3. Vérifier le logo et le chevron (`App.tsx:933,936,943`) : `LayoutDashboard` et `ChevronRight`
   utilisent déjà `var(--accent-primary)`/`var(--text-tertiary)` — confirmer visuellement qu'ils
   restent lisibles sur fond noir ; si `--text-tertiary` (gris clair pensé pour fond blanc) est
   illisible, utiliser directement `var(--sidebar-text)` à cet endroit précis plutôt que de changer
   `--text-tertiary` globalement.
4. Contrôle de contraste : le texte de la sidebar (`--sidebar-text`) et l'état actif
   (`--sidebar-active-text`) doivent rester lisibles sur `--sidebar-bg` noir (viser un ratio WCAG AA
   raisonnable, pas de valeur absolue imposée par le PO — jugement visuel + capture à l'appui dans
   le VERIFY).
5. Capture d'écran avant/après de la sidebar (ouverte et réduite/`collapsed`, `App.tsx:928`) et
   d'un écran complet pour confirmer que le contenu principal (fonds, grilles) n'a pas changé.

## Contraintes

- Ne modifier **aucune** variable CSS utilisée en dehors de la sidebar (`--bg-primary`,
  `--text-primary`, `--accent-primary`, `--border-color`, etc.) — tout changement de portée globale
  est hors périmètre de cette TASK et nécessite un cadrage PO séparé (dark mode global).
- Ne pas introduire de nouveau composant de sidebar ni toucher à la logique de navigation
  (`currentView`, `setCurrentView`) — CSS/couleurs uniquement.
- Le mode `collapsed` (icônes seules, `App.tsx:928`, `index.css:113-125`) doit rester fonctionnel
  à l'identique, juste avec les nouvelles couleurs.

## Checklist VALIDATION (à remplir dans VERIFY/)
- [x] Build OK
- [x] Capture avant/après sidebar ouverte
- [x] Capture avant/après sidebar réduite (`collapsed`)
- [x] Capture d'un écran complet confirmant qu'aucune autre zone (contenu, grilles, modales) n'a
  changé de couleur
- [x] Contraste texte/fond de la sidebar jugé lisible (capture + note du ratio ou jugement visuel)
- [x] Aucune variable CSS globale (`--bg-primary`, `--text-primary`, etc.) modifiée
- [x] Aucun credential/secret en dur introduit
- [x] Aucune dette technique silencieuse
- [x] Cohérent avec l'architecture
