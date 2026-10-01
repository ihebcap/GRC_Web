# TASK-112 — Police globale Inter → Roboto (harmonisation xGR)

- **Priorité** : 🟡 Mineur
- **Domaine** : Architecture (UI)
- **Statut** : FAIT (validé 2026-10-01, rapport `tasks/VERIFY/TASK-112_verify.md`)
- **Dépend de** : — (CSS uniquement, indépendante de TASK-109/110/111, mais fait partie du même
  chantier d'harmonisation visuelle avec xGR, cf. ci-dessous)

## Contexte

Suite de `pilotage/ANALYSE_UX_XGR_VS_GRC_WEB_2026-09-29.md`. Le PO a demandé (2026-10-01) une
**harmonisation complète mais a minima** avec le thème xGR (`Tresorerie.Vue`), répartie en 4 TASKS
indépendantes mais formant un même chantier cohérent :

- TASK-111 (sidebar noire permanente)
- TASK-112 (cette TASK — police)
- TASK-110 (liseré de statut + totaux grille)
- TASK-109 (harmonisation interne des barres de titre)

xGR utilise **Roboto** comme police globale (`Tresorerie.Vue/src/assets/layout/_main.scss:13` :
`Roboto, 'Helvetica Neue Light', 'Helvetica Neue', Helvetica, Arial, 'Lucida Grande', sans-serif`
— stack Material/PrimeVue par défaut). GRC_WEB utilise aujourd'hui **Inter**
(`gocom-web/src/index.css:1,52`). Décision PO explicite : aligner GRC_WEB sur Roboto.

**Hors périmètre de cette TASK** (confirmé par le PO) : couleur d'accent, boutons, badges, cartes —
seule la police change, le reste de la palette (`--accent-primary: #1976d2`, etc.) reste inchangé.

## État actuel — points d'ancrage de la police

| Fichier | Ligne | Contenu |
|---|---|---|
| `gocom-web/src/index.css` | 1 | `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');` |
| `gocom-web/src/index.css` | 52 | `font-family: 'Inter', sans-serif;` (règle globale `body`) |
| `gocom-web/src/RapprochementBancaire.css` | 7 | `font-family: 'Inter', sans-serif;` — redéclaration locale à vérifier (redondante avec le global ou override volontaire ?) |
| `gocom-web/src/LicenceBlockedScreen.tsx` | 21 | `fontFamily: 'Inter, Roboto, sans-serif'` — Roboto déjà présent en fallback, à corriger dans le même sens |

Recherche faite par grep sur `font-family`/`Inter` dans tout `gocom-web/src` — ces 4 points sont
les seuls trouvés ; si l'implémenteur en trouve d'autres (styles inline dispersés), les inclure
dans le même mouvement plutôt que de laisser un résidu Inter isolé.

## Objectif

Toute l'application affiche la police **Roboto** (au lieu d'Inter), sans incohérence résiduelle
d'un écran à l'autre, sans régression de poids de police disponible (300/400/500/600/700 déjà
chargés pour Inter — s'assurer que les mêmes graisses existent pour Roboto).

## Fichiers concernés

- `gocom-web/src/index.css` (import Google Fonts + règle `body`)
- `gocom-web/src/RapprochementBancaire.css:7`
- `gocom-web/src/LicenceBlockedScreen.tsx:21`

## Étapes d'implémentation

1. Remplacer l'import Google Fonts (`index.css:1`) par Roboto, en gardant les mêmes graisses
   utilisées aujourd'hui (300/400/500/600/700) :
   ```css
   @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;600;700&display=swap');
   ```
2. Remplacer `font-family: 'Inter', sans-serif;` par `font-family: 'Roboto', sans-serif;`
   (`index.css:52`).
3. Même remplacement dans `RapprochementBancaire.css:7` — vérifier au préalable si cette
   redéclaration a une raison d'être (ex. portée différente du `body` global) avant de la changer
   mécaniquement ; si elle est strictement redondante avec la règle globale, envisager de la
   supprimer plutôt que de la dupliquer (mais ne pas le faire si cela sort du périmètre minimal
   sans vérifier l'absence de régression visuelle).
4. `LicenceBlockedScreen.tsx:21` : passer `'Inter, Roboto, sans-serif'` → `'Roboto, sans-serif'`.
5. Vérifier visuellement (capture avant/après) au moins 3 écrans représentatifs (Règlements,
   Rapprochement, Comptabilisation) pour confirmer qu'aucune graisse n'affiche un fallback système
   (signe qu'une graisse Roboto manquerait au chargement Google Fonts).

## Contraintes

- Ne pas toucher aux couleurs, tailles ou graisses au-delà de ce qui est strictement nécessaire
  pour permuter la police — pas de refonte visuelle plus large (hors périmètre, cf. décision PO
  "les 4 éléments déjà identifiés, rien de plus").
- Ne pas introduire de police auto-hébergée ni de nouvelle dépendance — rester sur le même
  mécanisme `@import` Google Fonts déjà en place pour Inter.

## Checklist VALIDATION (à remplir dans VERIFY/)
- [x] Build OK
- [x] Capture avant/après d'au moins 3 écrans (Règlements, Rapprochement, Comptabilisation)
- [x] Les 5 graisses (300/400/500/600/700) confirmées chargées (DevTools → Network/Fonts)
- [x] `RapprochementBancaire.css:7` et `LicenceBlockedScreen.tsx:21` traités, pas de résidu "Inter"
  dans le code (grep final)
- [x] Aucun credential/secret en dur introduit
- [x] Aucune dette technique silencieuse
- [x] Cohérent avec l'architecture
