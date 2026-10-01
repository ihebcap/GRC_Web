# TASK-113 — Logo GRC + écran de connexion inspiré xGR (favicon, icône sidebar, login)

- **Priorité** : 🟡 Mineur
- **Domaine** : Architecture (UI)
- **Statut** : FAIT (2026-10-01)
- **Dépend de** : — (indépendante, fait partie du même esprit que le chantier « Harmonisation xGR »
  mais traite un sujet distinct : identité visuelle de marque plutôt que thème)

## Contexte

Demande PO (2026-10-02) : remplacer le favicon par défaut (logo décoratif violet/bleu généré par un
outil tiers, sans rapport avec GRC, `gocom-web/public/favicon.svg`) et l'icône générique
(`LayoutDashboard` de `lucide-react`, grille 2x2) dans le titre de la sidebar, par un logo simple
propre à l'application. Décision PO : monogramme « GRC », et appliqué aussi sur l'écran de
connexion (actuellement texte seul, aucun logo).

Un logo (`gocom-web/public/grc-logo.svg`) a été dessiné et validé visuellement par le PO
(rendu Playwright à 64px/24px/16px) avant la création de cette TASK — carré arrondi noir
(`#0a0a0a`, cohérent avec la sidebar noire livrée en TASK-111), monogramme « GRC » blanc, trait
d'accent bleu (`#1976d2`, couleur d'accent déjà en place, inchangée).

**Précision PO (2026-10-02)** : l'écran de connexion doit aussi s'inspirer du style de l'écran de
login xGR (`D:\_vibe\xGR\xGR\Tresorerie.Vue\src\pages\Auth\Login.vue`) et afficher le nom de
l'éditeur de l'application, **APBS** (pas une société cliente du `<select>` déjà existant — GRC_WEB
gère déjà un choix de société cliente au login, `App.tsx:188-189,252-262`, qui reste inchangé ;
il s'agit bien du nom de l'éditeur de l'application, à ajouter comme élément d'identité visuelle).

Référence xGR (`Login.vue:58-65`) : carte blanche centrée sur fond gris clair
(`min-h-screen flex items-center justify-center bg-gray-50`, carte `max-w-sm bg-white rounded-xl
shadow-lg p-8`), logo en haut suivi d'un sous-titre discret (`text-sm text-gray-500`,
« Connectez-vous à votre espace »). GRC_WEB a déjà une structure équivalente
(`.auth-container`/`.auth-card`, `index.css`) — à **aligner les détails de style** sur ce modèle
(radius, ombre, padding, hiérarchie typographique du sous-titre) plutôt qu'à reconstruire l'écran
depuis zéro.

## État actuel

| Emplacement | Fichier | Ligne(s) | Actuel |
|---|---|---|---|
| Favicon (onglet navigateur) | `gocom-web/index.html` | 5 | `<link rel="icon" type="image/svg+xml" href="/favicon.svg" />` → pointe vers `gocom-web/public/favicon.svg` (logo décoratif sans rapport, dégradés violet/bleu/vert) |
| Titre sidebar | `gocom-web/src/App.tsx` | 933, 943 | `<LayoutDashboard size={24} style={{color: 'var(--sidebar-active-text)'}} />` (icône générique lucide-react, un carré 2x2) |
| Écran de connexion | `gocom-web/src/App.tsx` | ~220-223 | `<div className="auth-card"><h1 className="auth-title">GRC</h1>...` — aucune icône/logo, texte seul |
| Style carte login | `gocom-web/src/index.css` | 187-220 | `.auth-container`/`.auth-card`/`.auth-title`/`.auth-subtitle` déjà proches du modèle xGR (carte centrée, radius, ombre, sous-titre) — `.auth-subtitle` affiche actuellement « Accès sécurisé à l'espace de gestion » |

Le logo cible existe déjà : `gocom-web/public/grc-logo.svg` (viewBox 64×64, carré arrondi noir
`rx=14`, texte "GRC" blanc gras centré, barre d'accent bleue `#1976d2`).

## Objectif

1. Le favicon de l'onglet navigateur affiche le logo GRC (plus le dégradé violet/bleu par défaut).
2. L'icône dans le titre de la sidebar (ouverte et réduite/`collapsed`) est le logo GRC à la place
   de `LayoutDashboard`.
3. L'écran de connexion affiche le logo GRC au-dessus (ou à côté) du titre « GRC », avec un style
   de carte aligné sur le modèle xGR (radius plus prononcé type `rounded-xl`, hiérarchie
   logo→titre→sous-titre claire).
4. Le sous-titre de l'écran de connexion mentionne l'éditeur **APBS** (ex. remplacer ou compléter
   le texte actuel « Accès sécurisé à l'espace de gestion » par une mention du type « GRC — APBS »
   ou équivalent — formulation exacte au choix de l'implémenteur, à soumettre dans le VERIFY pour
   validation PO si plusieurs options sont possibles).
5. Lisibilité confirmée à toutes les tailles d'usage réelles (favicon ~16px, icône sidebar 24px,
   écran de login taille plus grande — à choisir par l'implémenteur, suggestion 48-64px).

## Fichiers concernés

- `gocom-web/public/grc-logo.svg` (déjà créé — ne pas modifier le design sans repasser par le PO)
- `gocom-web/public/favicon.svg` (à remplacer par le contenu de `grc-logo.svg`, ou faire pointer
  `index.html` directement vers `grc-logo.svg` — au choix de l'implémenteur, le plus simple à
  maintenir)
- `gocom-web/index.html` (lien favicon, l.5)
- `gocom-web/src/App.tsx` (icône sidebar l.933,943 ; écran de connexion ~l.220-223)
- `gocom-web/src/index.css` (`.auth-card`/`.auth-title`/`.auth-subtitle`, l.187-220 — ajustements
  de radius/ombre/sous-titre uniquement, pas de refonte structurelle)

## Étapes d'implémentation

1. **Favicon** : soit remplacer le contenu de `gocom-web/public/favicon.svg` par celui de
   `grc-logo.svg` (garde un seul nom de fichier référencé dans `index.html`, pas de changement de
   lien), soit changer `index.html:5` pour pointer vers `/grc-logo.svg` et supprimer l'ancien
   `favicon.svg` devenu inutile — éviter de garder les deux fichiers en doublon silencieux.
2. **Icône sidebar** (`App.tsx:933,943`) : remplacer `<LayoutDashboard size={24} .../>` par une
   balise `<img src="/grc-logo.svg" width={24} height={24} alt="GRC" />` (ou composant React dédié
   si le projet a déjà un pattern d'icône SVG inline — vérifier avant d'improviser un nouveau
   pattern). Les deux occurrences (sidebar ouverte l.933, réduite l.943) doivent utiliser le même
   rendu.
3. **Écran de connexion** (`App.tsx` ~l.220-223) : ajouter le logo au-dessus du `<h1 className="auth-title">GRC</h1>`,
   taille suggérée 48-64px, centré dans `.auth-card`. Mettre à jour `.auth-subtitle`
   (`index.css:215-220`) pour mentionner l'éditeur APBS, à la place ou en complément du texte actuel
   « Accès sécurisé à l'espace de gestion ». Rapprocher `.auth-card` (`index.css:196-205`) du modèle
   xGR (`Login.vue:60` : `rounded-xl shadow-lg p-8`) — ajuster `border-radius`/`box-shadow`/`padding`
   si l'écart visuel avec le style actuel (`var(--radius-lg)`, `var(--shadow-md)`, `2.5rem`) le
   justifie, sans réécrire la structure `.auth-container`/`.auth-card` existante.
4. Vérifier qu'aucun import `lucide-react` ne devient orphelin après le retrait de
   `LayoutDashboard` dans `App.tsx` (si l'icône n'est plus utilisée ailleurs dans le fichier,
   retirer l'import ; sinon la garder).
5. Capture d'écran avant/après des 3 emplacements (onglet navigateur avec favicon, sidebar
   ouverte+réduite, écran de connexion).

## Contraintes

- Ne pas modifier le design du logo (`grc-logo.svg`) sans repasser par le PO — il a été validé
  visuellement avant cette TASK.
- Ne pas changer la couleur d'accent (`--accent-primary`) ni toucher au reste du thème — strictement
  le logo à ces 3 emplacements, rien d'autre (cohérent avec le périmètre borné du chantier
  « Harmonisation xGR », cf. `tasks/TODO.md`).
- Ne pas introduire de build step supplémentaire (conversion SVG→PNG, génération multi-résolution
  `.ico`) sauf si un navigateur cible l'exige explicitement — SVG seul suffit pour les navigateurs
  modernes (`index.html` utilise déjà `type="image/svg+xml"`).
- Ne pas toucher au `<select>` société existant du formulaire de login (`App.tsx:188-189,252-262`)
  — la mention APBS est un ajout d'identité visuelle de l'éditeur, distincte de ce sélecteur
  fonctionnel (choix de société cliente), à ne pas confondre ni fusionner.
- S'inspirer du style xGR (radius, ombre, hiérarchie) sans dépendance à Tailwind/PrimeVue — rester
  en CSS classique cohérent avec le reste de `index.css`, pas de nouvelle librairie UI.

## Checklist VALIDATION (à remplir dans VERIFY/)
- [x] Build OK
- [x] Capture de l'onglet navigateur avec le nouveau favicon
- [x] Capture sidebar ouverte avec le nouveau logo (au lieu de `LayoutDashboard`)
- [x] Capture sidebar réduite (`collapsed`) avec le nouveau logo
- [x] Capture écran de connexion avec le logo ajouté et la mention APBS visible
- [x] Sélecteur société existant (`App.tsx:188-189,252-262`) non régressé (toujours fonctionnel,
  non confondu avec la mention APBS)
- [x] Aucun import devenu orphelin (`LayoutDashboard` retiré si plus utilisé ailleurs)
- [x] Aucun credential/secret en dur introduit
- [x] Aucune dette technique silencieuse (pas de doublon `favicon.svg`/`grc-logo.svg` non résolu)
- [x] Cohérent avec l'architecture
