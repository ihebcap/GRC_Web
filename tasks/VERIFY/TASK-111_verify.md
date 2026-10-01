# VERIFY — TASK-111 : Sidebar noire permanente (identité visuelle, inspirée xGR)

- **Tâche** : TASK-111 — Sidebar noire permanente (identité visuelle, inspirée xGR)
- **Date** : 2026-10-01
- **Auteur** : Antigravity (Agent d'implémentation)
- **Statut** : FAIT (validé E2E Playwright, vérifications de styles calculés et captures visuelles avant/après)

---

## 1. Contexte & Périmètre

Suite à l'analyse UX (`pilotage/ANALYSE_UX_XGR_VS_GRC_WEB_2026-09-29.md`), xGR possède une sidebar permanente noire (`#000000`), marquant l'identité visuelle de l'application indépendamment d'un dark mode global.
Le cadrage PO du 2026-10-01 a fixé :
- **Périmètre strict** : Uniquement la sidebar/menu (`.app-sidebar`) passe en noir permanent.
- **Hors périmètre strict** : Le reste de l'application (grilles, barres d'outils, fonds de page, modales) **reste blanc/clair comme aujourd'hui**. Aucune variable globale (`--bg-primary`, `--text-primary`, `--accent-primary`, etc.) ne doit être modifiée.
- **Préservation fonctionnelle** : Le mode replié (`collapsed`) avec icônes seules doit continuer de fonctionner à l'identique.

---

## 2. Modifications apportées

### Fichiers modifiés

1. `gocom-web/src/index.css` :
   - Mise à jour des 4 variables CSS dédiées à la sidebar (`:root`) :
     - `--sidebar-bg`: `#0a0a0a` (fond noir permanent adouci).
     - `--sidebar-text`: `rgba(255, 255, 255, 0.65)` (texte et icônes inactifs clairs et lisibles).
     - `--sidebar-active-bg`: `rgba(255, 255, 255, 0.08)` (surlignage translucide discret pour l'onglet actif).
     - `--sidebar-active-text`: `#4fc3f7` (bleu clair lumineux haute lisibilité sur fond noir).
   - Ajustements des classes `.app-sidebar` et `.sidebar-*` :
     - `.app-sidebar` : remplacement de la bordure claire `var(--border-color)` par une bordure subtile sombre `rgba(255, 255, 255, 0.08)` et suppression de l'ombre portée fond blanc (`box-shadow: none`).
     - `.sidebar-header` : couleur de titre passée à `#ffffff` et séparateur `rgba(255, 255, 255, 0.08)`.
     - `.sidebar-item:hover` : fond `rgba(255, 255, 255, 0.05)` et texte `#ffffff` (au lieu d'un flash blanc `var(--bg-tertiary)` sur noir).
     - `.sidebar-item.active` : liseré gauche `border-left: 3px solid var(--sidebar-active-text)`.
     - `.sidebar-footer` : fond aligné sur `var(--sidebar-bg)` (au lieu du blanc `var(--bg-secondary)`), séparateur `rgba(255, 255, 255, 0.08)`, et style de survol du bouton déconnexion.

2. `gocom-web/src/App.tsx` :
   - Logo `LayoutDashboard` : couleur inline synchronisée sur `var(--sidebar-active-text)`.
   - Chevron de rétraction `ChevronRight` et sous-titre société `user.societeName` : couleur synchronisée sur `var(--sidebar-text)` (au lieu de `--text-tertiary` / `--text-secondary` inadaptés sur noir).
   - Pied de page (`sidebar-footer`) : nom de l'utilisateur en blanc `#ffffff`, informations de caisses en `var(--sidebar-text)`, bouton déconnexion stylé en fond sombre translucide avec bordure fine.

3. `gocom-web/package.json` :
   - Ajout du script de vérification : `"test:e2e-111": "node e2e_task111.cjs verify"`.

4. `gocom-web/e2e_task111.cjs` :
   - Script de test et validation Playwright automatisé (vérification des couleurs calculées dans le DOM et capture des preuves d'écran).

---

## 3. Contrôle de Contraste et Accessibilité (WCAG)

| Élément | Couleur texte | Couleur fond | Ratio de contraste | Conformité WCAG |
|---|---|---|---|---|
| Titre "GRC" & Nom utilisateur | `#ffffff` | `#0a0a0a` | **19.8:1** | AAA (exige ≥ 7:1) |
| Texte & icônes inactifs | `rgba(255, 255, 255, 0.65)` | `#0a0a0a` | **8.5:1** | AAA (exige ≥ 7:1) |
| Élément actif ("Règlements") | `#4fc3f7` | `#1c1c1c` (`rgba 0.08`) | **9.7:1** | AAA (exige ≥ 7:1) |

Les contrastes dépassent largement le seuil WCAG AA (4.5:1 pour texte normal, 3:1 pour icônes/gros texte) et atteignent le niveau AAA.

---

## 4. Preuves d'écran

Toutes les captures ont été générées automatiquement par le banc Playwright E2E dans `tasks/VERIFY/TASK-111_evidence/` :

1. **Sidebar ouverte** :
   - Avant : `tasks/VERIFY/TASK-111_evidence/screenshot_task111_before_sidebar_open.png`
   - Après : `tasks/VERIFY/TASK-111_evidence/screenshot_task111_after_sidebar_open.png`

2. **Sidebar réduite (`collapsed`)** :
   - Avant : `tasks/VERIFY/TASK-111_evidence/screenshot_task111_before_sidebar_collapsed.png`
   - Après : `tasks/VERIFY/TASK-111_evidence/screenshot_task111_after_sidebar_collapsed.png`

3. **Écran complet (preuve de non-régression du contenu principal)** :
   - Avant : `tasks/VERIFY/TASK-111_evidence/screenshot_task111_before_full_screen.png`
   - Après : `tasks/VERIFY/TASK-111_evidence/screenshot_task111_after_full_screen.png`
   - **Constat** : Le fond principal (`#f5f7fa`), les cartes (`#ffffff`), la barre d'outils, la grille de données, les filtres et les boutons de l'écran principal conservent strictement leur apparence et couleurs claires d'origine.

---

## 5. Résultat d'exécution du test E2E

```text
> gocom-web@0.0.0 test:e2e-111
> node e2e_task111.cjs verify

Serveur mock démarré sur http://localhost:3511

--- Mode: verify ---
  Captures open & full enregistrées (screenshot_task111_after)
  Computed .app-sidebar background: rgb(10, 10, 10)
  Computed .sidebar-item.active color: rgb(79, 195, 247)
  Computed body background: rgb(245, 247, 250)
  Capture collapsed enregistrée (screenshot_task111_after)

>>> SUCCESS mode verify : toutes les vérifications sont validées ! <<<
```

---

## 6. Checklist VALIDATION

- [x] Build OK (`tsc -b && vite build` : 0 erreur, bundle déployé dans `deploy/wwwroot/`)
- [x] Capture avant/après sidebar ouverte (`screenshot_task111_before_sidebar_open.png` vs `screenshot_task111_after_sidebar_open.png`)
- [x] Capture avant/après sidebar réduite / `collapsed` (`screenshot_task111_before_sidebar_collapsed.png` vs `screenshot_task111_after_sidebar_collapsed.png`)
- [x] Capture d'un écran complet confirmant qu'aucune autre zone (contenu, grilles, modales) n'a changé de couleur (`screenshot_task111_before_full_screen.png` vs `screenshot_task111_after_full_screen.png`)
- [x] Contraste texte/fond de la sidebar jugé lisible (ratios WCAG 8.5:1 à 19.8:1, conformité WCAG AAA)
- [x] Aucune variable CSS globale (`--bg-primary`, `--text-primary`, `--accent-primary`, etc.) modifiée
- [x] Aucun credential/secret en dur introduit
- [x] Aucune dette technique silencieuse
- [x] Cohérent avec l'architecture
