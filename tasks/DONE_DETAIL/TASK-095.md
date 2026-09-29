# TASK-095 — Compacter la barre de filtres de l'écran Comptabilisation (aligner sur Rapprochement)

- **Priorité** : 🟡 Mineur
- **Domaine** : Front (UX)
- **Statut** : FAIT (validé E2E)
- **Dépend de** : —

## Contexte

Demande PO 2026-09-29 (capture d'écran à l'appui) : la barre de filtres de l'écran
« Comptabilisation » (`ApercuComptabilisation.tsx`) est visuellement beaucoup plus haute et
aérée que le reste de l'application, alors que l'écran « Rapprochement bancaire »
(`RapprochementBancaire.tsx`) a déjà reçu un compactage de sa barre d'outils via une classe CSS
dédiée `.rappro-toolbar` (`RapprochementBancaire.css:11-65`). Le PO demande explicitement le
« même compactage » sur l'écran de comptabilisation.

Confirmé avec le PO avant rédaction de cette TASK :
- Le pattern de référence à reproduire est bien `.rappro-toolbar` / `.toolbar-group` /
  `.toolbar-select` / `.toolbar-actions` (`RapprochementBancaire.css:11-65`), pas une
  réinvention.
- Le compactage doit aussi réduire la largeur et le padding interne du composant
  `CheckboxDropdown` (local à `ApercuComptabilisation.tsx:63-161`, actuellement 220px de large,
  padding `0.375rem 0.625rem`, texte `0.8125rem`) — pas seulement les espacements autour.

## Problème constaté

Dans `ApercuComptabilisation.tsx:390-436` (bande « Filtres de simulation »), tout est en style
inline avec des valeurs nettement plus généreuses que `.rappro-toolbar` :
- Conteneur : `padding: '1rem'`, `gap: '1rem'` (vs `padding: 6px 12px`, `gap: 16px` côté
  rapprochement).
- `CheckboxDropdown` (Caisses / Modes) : largeur fixe `220px`, padding interne
  `0.375rem 0.625rem`, texte `0.8125rem` (13px) — pas de version compacte.
- Champs date (`input[type="date"]`) : `width: '120px'`, classe générique `form-input` (pas
  `toolbar-select`).
- Sélecteur « Rapproché » verrouillé (`ApercuComptabilisation.tsx:416-427`) : mêmes styles
  inline `0.8125rem` / `padding` large.
- Bouton « Générer l'Aperçu » (`ApercuComptabilisation.tsx:430-433`) : classes globales
  `btn btn-primary` standard, pas alignées avec `.toolbar-actions` / boutons compacts de
  `.rappro-toolbar`.

Le bandeau présélection (`ApercuComptabilisation.tsx:378-386`, affiché uniquement en mode
« sélection depuis la liste ») utilise un padding proche (`0.75rem 1rem`) : il reste **hors
périmètre** de cette TASK sauf si le compactage de la barre de filtres juste en dessous crée une
incohérence visuelle flagrante entre les deux bandeaux quand ils s'affichent l'un sans l'autre —
dans ce cas, documenter l'écart dans le VERIFY plutôt que d'étendre silencieusement le périmètre.

## Objectif

La bande « Filtres de simulation » de `ApercuComptabilisation.tsx` doit visuellement adopter la
même densité que `.rappro-toolbar` : hauteur réduite, `gap`/`padding` alignés, tailles de police
~12.5px sur les contrôles de filtre, dropdowns et select plus compacts, bouton d'action aligné à
droite (`margin-left: auto` déjà en place, à conserver).

Résultat mesurable : la hauteur de la bande de filtres (mesurée du haut du conteneur au bas,
hors bandeau présélection) doit se rapprocher de celle de `.rappro-toolbar` sur
`RapprochementBancaire.tsx` (actuellement ~40-48px de hauteur de bande hors bordures, contre
plus du double sur l'écran comptabilisation aujourd'hui).

## Fichiers concernés

- `gocom-web/src/ApercuComptabilisation.tsx` (bande de filtres lignes 390-436, composant
  `CheckboxDropdown` lignes 63-161)
- `gocom-web/src/RapprochementBancaire.css` (référence à lire, ne pas modifier sauf si le PO
  valide d'y factoriser des classes communes — voir Contraintes)
- Un nouveau fichier CSS dédié (ex. `gocom-web/src/ApercuComptabilisation.css`) ou une extension
  du CSS existant si l'écran en a déjà un — à vérifier avant de créer un nouveau fichier
  (`grep -n "import.*\.css" gocom-web/src/ApercuComptabilisation.tsx`)

## Étapes d'implémentation

1. Vérifier si `ApercuComptabilisation.tsx` importe déjà un fichier CSS dédié. Si non, en créer
   un (`ApercuComptabilisation.css`) et l'importer en tête de fichier.
2. Reprendre telles quelles les valeurs de `.rappro-toolbar` / `.toolbar-select` (padding,
   gap, font-size, border, border-radius, box-shadow) pour la bande de filtres : ne pas
   réinventer de nouvelles valeurs de densité, dupliquer/adapter les classes existantes sous des
   noms propres à cet écran (ex. `.apercu-toolbar`, `.apercu-toolbar-select`) pour éviter tout
   couplage accidentel entre les deux écrans si l'un est retouché plus tard sans l'autre.
3. Appliquer ces classes au conteneur de la bande de filtres (`ApercuComptabilisation.tsx:391`)
   et aux éléments qu'elle contient (dropdowns, dates, select « Rapproché », bouton).
4. Compacter `CheckboxDropdown` (`ApercuComptabilisation.tsx:63-161`) : réduire la largeur du
   conteneur (actuellement `width: '220px'` ligne 103) et les paddings internes vers des valeurs
   cohérentes avec `.toolbar-select` (~6px 10px, ~12.5px de police) sans casser la recherche
   intégrée ni le comportement « tout sélectionner » existants — changement de style uniquement,
   aucune logique à toucher.
5. Aligner les champs date et le select « Rapproché » verrouillé sur les mêmes tailles de police
   et paddings compacts.
6. Rebuild front (`npm run build` dans `gocom-web/`) et vérifier visuellement dans le navigateur
   (capture d'écran avant/après à joindre au VERIFY) que :
   - la bande est nettement plus basse qu'avant ;
   - aucun élément n'est tronqué ou ne se chevauche à largeur d'écran standard ;
   - le comportement des dropdowns (recherche, tout sélectionner, fermeture au clic extérieur)
     est inchangé.
7. Vérifier le mode présélection (bandeau `ApercuComptabilisation.tsx:378-386`, non modifié par
   cette TASK) ne produit pas une incohérence visuelle flagrante juste en dessous de la nouvelle
   bande compacte — si c'est le cas, le documenter dans le VERIFY sans le corriger dans cette
   TASK (hors périmètre, cf. Contexte).

## Contraintes

- Ne jamais bypasser une règle de sécurité ou une DLL métier GRC (non concerné ici — changement
  purement visuel/CSS).
- Respecter la Clean Architecture (Domain ← Application ← Infrastructure/API) — non concerné,
  aucun changement backend.
- Aucune grille de données tabulaires n'est introduite ou modifiée par cette TASK — le tableau
  d'aperçu des écritures (`ApercuComptabilisation.tsx:439+`) est hors périmètre, ne pas y
  toucher, ne pas y appliquer `ExcelFilter.tsx` (aucune demande PO en ce sens).
- Ne pas modifier `RapprochementBancaire.tsx` / `RapprochementBancaire.css` dans cette TASK
  (référence à lire seule) — toute factorisation de classes communes entre écrans doit être une
  décision PO explicite documentée dans le VERIFY, pas une initiative spontanée.
- Ne pas changer la logique métier (filtres, appels API, validation) — changement de présentation
  uniquement.

## Checklist VALIDATION (à remplir dans VERIFY/)
- [x] Build OK (2026-09-29, build log front `npm run build` : `tsc -b && vite build` terminé en 773ms sans erreur)
- [x] Comportement vérifié end-to-end (captures d'écran avant `screenshot_task095_before.png` / après `screenshot_task095.png` jointes ; test Playwright `e2e_task095.cjs` 100% PASSED : hauteur 45px vs 44px référence, dropdowns Caisses/Modes testés : ouverture, recherche, tout sélectionner, fermeture au clic extérieur, dates et select verrouillé)
- [x] Aucun credential/secret en dur introduit
- [x] Aucune dette technique silencieuse (mode présélection mutuellement exclusif avec la barre de filtres vérifié sans impact résiduel)
- [x] Cohérent avec l'architecture (`RapprochementBancaire.css` non modifié, style isolé dans `ApercuComptabilisation.css`, pas de nouveau composant de filtre inventé)
