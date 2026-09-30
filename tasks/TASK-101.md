# TASK-101 — Rapprochement : bouton « Exporter » sur la grille Relevé et sur la grille Règlements GRC

- **Priorité** : 🟡 Mineur
- **Domaine** : Front uniquement (aucun back, aucun SQL, aucune config)
- **Statut** : TODO
- **Dépend de** : TASK-106, TASK-100 et TASK-102 — **toutes approuvées et en place** (repère préfixé `formatRepere`, colonne « Relevé », filtres de date en plage). Partir du dépôt à jour.
- **Mise en prod** : front seul. Retour arrière = redéployer le front précédent.
- **Références** : se repérer par le **nom de la fonction**, jamais par un numéro de ligne (le fichier a beaucoup bougé).

## Contexte
Demande PO (2026-09-30) : exporter l'affichage de chaque grille du Rapprochement. La bibliothèque `xlsx` est déjà en dépendance et utilisée par `handleExport` dans `App.tsx` (`json_to_sheet` → `XLSX.writeFile`) : **réutiliser ce mécanisme, aucune nouvelle dépendance.**
Le PO **ne teste pas avant la mise en production** : toutes les preuves sont produites par le worker sur la base de **test** et figurent dans le VERIFY.

## Problème constaté (vérifié au commit `e77345b`)
- `RapprochementBancaire.tsx` n'a aucun export.
- **Piège n°1 — les fonctions d'affichage existantes ne servent pas telles quelles à l'export.**
  - `renderSharedCell` (`utils.tsx`) renvoie du **JSX** (badges, `<span>`), pas des valeurs.
  - `getGrcCellValue` (dans le composant) sert au **tri/filtre** : pour plusieurs clés elle renvoie une **valeur brute** — `banque` → identifiant numérique, `date` → chaîne ISO, `banqueClient` → `undefined` — et pour `pointe` elle renvoie « OUI » dès qu'une ligne est **réservée** alors que l'écran affiche « - » tant que le règlement n'est pas pointé. L'utiliser donnerait un fichier **différent de l'écran**.
  - Le bon modèle est le **mapping manuel de `handleExport` (`App.tsx`)**, qui produit des valeurs lisibles. Il faut un mapping dédié, calqué sur ce que **l'écran affiche** (`renderSharedCell`).
- La seule clé où `getGrcCellValue` est exacte pour l'export est `lettrage` (elle applique `formatRepere(..., showPrefix || réservé ailleurs)`).

## Comportement attendu (contrat)
| Situation | Résultat attendu |
|---|---|
| Clic « Exporter » sur la grille **Relevé** | fichier `Export_Releve_<aaaa-mm-jj>.xlsx`, feuille « Releve » : **une ligne par ligne affichée** (`sortedLignes` : après filtres et tri), dans l'ordre de l'écran |
| Colonnes du fichier Relevé | dans l'ordre de l'écran : **« Relevé »** (seulement si plus d'un relevé coché : libellé `titre (#id)`), « Repère », « Date Op. », « Date Val. », « Libellé », « Référence », « Code », « Crédit » |
| Clic « Exporter » sur la grille **GRC** | fichier `Export_Reglements_GRC_<aaaa-mm-jj>.xlsx`, feuille « Reglements GRC » : une ligne par règlement affiché (`sortedReglements`), colonnes = `selectedColumns` dans l'ordre affiché, en-têtes = libellés de l'en-tête (« Repère » pour `lettrage`) |
| Valeurs GRC | **celles de l'écran** : `caisseCode`, `caisseIntitule`, `mode` (« code - intitulé »), `typeReglement` (« Virement »…), `banque` = **code** de la banque, `banqueClient` = `banqueTier` sinon `ribClient`, `pointe`/`comptabilise`/`remis`/`impaye`/`annule` = **« OUI » ou « NON »**, `client` = intitulé, `piece`, `extrait`, `reference`, `numero`, `libelle`, `info1..4` = texte brut (vide si absent) ; **aucun identifiant numérique brut** hors `no` |
| Repère | valeur **affichée** : lettre nue avec un seul relevé ; `<idRelevé>-<lettre>` avec plusieurs relevés cochés, et pour un règlement « réservé ailleurs » (jamais la lettre brute en multi-relevés) |
| Dates | texte **jj/mm/aaaa** tiré de la date brute (`slice(0,10)` → inversion des parties), **sans `new Date()`** (cohérent avec TASK-102, pas de décalage de fuseau) ; vide si absente |
| Montants (`Crédit`, `montant`, `solde`) et `no` | **nombres** (sommables dans Excel), jamais chaîne formatée. `montant` = `montantDeviseSociete \|\| montant` ; `solde` = `soldeDeviseSociete` |
| Filtres, tri, plage de dates, colonnes choisies | l'export **reflète l'écran** : ce qui est filtré n'est pas exporté |
| Grille vide | bouton **désactivé** avec infobulle « Aucune ligne à exporter » ; aucun fichier |
| Erreur pendant la génération | toast `error` « Erreur lors de l'export. » ; l'écran reste utilisable |
| Débit | aucune ligne débit (la grille Relevé n'en contient pas) |

## Étapes d'implémentation (tout dans `gocom-web/src/RapprochementBancaire.tsx`)
1. Imports : `import * as XLSX from 'xlsx';` et ajouter `Download` à l'import `lucide-react`.
2. Helper local `isoVersJourFr(raw)` : `const d = (raw || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.split('-').reverse().join('/') : '';`.
3. Helper local `dateDuJour()` pour le nom de fichier : **composantes locales** (`getFullYear`, `getMonth()+1`, `getDate()`, complétées à 2 chiffres) — **jamais `toISOString()`** (décalage UTC le soir, le fichier porterait la date de la veille).
4. Fonction `getGrcExportValue(r, key)` : mapping **manuel** calqué sur `renderSharedCell` et sur `handleExport` (`App.tsx`), selon le tableau ci-dessus. Cas particuliers : `lettrage` → `getGrcCellValue(r, 'lettrage')` (seule réutilisation autorisée) ; `date` → `isoVersJourFr(r.date)` ; `banque` → `banquesMap[r.banqueNo]?.code ?? (r.banqueNo ?? '')` ; `typeReglement` → `getTypeReglementLabel(modesMap[r.modeReglementNo]?.typeNo)` (déjà exporté par `utils.tsx`). Toute clé non mappée → `r[key] ?? ''` **et** ne jamais renvoyer un objet.
5. `handleExportReleve` et `handleExportGrc` (simples fonctions, pas de `useCallback` nécessaire : le bouton n'est pas dans une ligne mémoïsée) : construire `exportData` à partir de `sortedLignes` / `sortedReglements` **au moment du clic** ; en-têtes GRC = libellé de `[{key:'lettrage', label:'Repère'}, ...availableColumns]` ; `XLSX.utils.json_to_sheet` → `book_new` → `book_append_sheet` → `XLSX.writeFile` ; `try/catch` avec `showToast("Erreur lors de l'export.", 'error')`.
6. Boutons : dans l'en-tête de chaque grille. Relevé : `.grid-header` (aujourd'hui `<h3>` + badge, non flex) → le passer en `display:flex; justify-content:space-between; align-items:center` **comme l'en-tête GRC**. GRC : dans `.grid-header-controls`, **avant** « Actualiser ». Icône `Download`, libellé « Exporter », style compact aligné sur l'existant, `disabled={sortedX.length === 0}` + `title`.
7. **Ne pas toucher** : `GrcTableRow`/`areEqual`/`propsToCompare`, le chargement des lignes, les filtres, le tri, `renderSharedCell`, `getGrcCellValue`, `handleExport` de `App.tsx`.

## Jeu d'essai (base de TEST uniquement — jamais la prod)
Réutiliser le cadre et les scripts de TASK-100 (`gocom-web/e2e_task100.cjs`, `e2e_task100_api.cjs` : connexion, création de relevés `T101-*` par `INSERT` dans `RAPP_*`, règlements réels existants ; variables `GRC_E2E_*` et `SQLCMDPASSWORD`, jamais de secret dans un script ni dans le VERIFY). Lignes **crédit** uniquement.
- **Relevés** : **R1** et **R2** de la même banque de test, avec 4 lignes chacun, dates d'opération sur **trois jours distincts** (J1, J2, J3), montants distincts dont un à **deux décimales** (ex. 1 234,56) et un **libellé commençant par « = »** (ex. `=SOMME(1+1)` : doit sortir en **texte**, pas en formule).
- **Règlements** : au moins un virement libre, un règlement **réservé** (via l'écran, sans valider) sur R1, un règlement **réservé sur R2** (pour le cas « réservé ailleurs » quand seul R1 est coché), un règlement avec banque renseignée. Vérifier par `SELECT` leurs montants et dates avant le test.
- Lecture du fichier généré : `page.waitForEvent('download')` + `download.saveAs(...)` + relecture par `xlsx` côté Node (`XLSX.readFile`, `sheet_to_json`), assertions sur les valeurs et les types de cellule.
- Écrire le banc dans `gocom-web/e2e_task101.cjs` (+ script `"test:e2e-101"` dans `package.json`). Captures dans `tasks/VERIFY/TASK-101_evidence/`. Consigner les identifiants réels (R1, R2, lignes, règlements).

## Scénarios de test (à rejouer par le worker ; résultat + preuve + date dans le VERIFY)
- **S1 Relevé, 1 relevé coché** : fichier `Export_Releve_<date du jour>.xlsx` ; nombre de lignes = compteur « n élément(s) affiché(s) » ; **pas** de colonne « Relevé » ; repère = lettre nue ; dates `jj/mm/aaaa` ; « Crédit » = **nombre** (type cellule `n`, valeur 1234.56) ; le libellé `=SOMME(1+1)` est un **texte** (type `s`), pas une formule.
- **S2 Relevé, 2 relevés cochés** : colonne « Relevé » présente en **première** position avec `titre (#id)` ; repères `<R1>-A`, `<R2>-A` (jamais « A » nu) ; ordre des lignes = ordre de l'écran.
- **S3 Relevé filtré et trié** : filtre « Date Op. » Du=Au=J2 (TASK-102) + tri décroissant sur « Crédit » → le fichier ne contient que les lignes de J2, dans l'ordre affiché ; nombre de lignes = compteur.
- **S4 GRC, valeurs lisibles** : colonnes par défaut + `banque`, `typeReglement`, `mode` → « Virement », code de banque, « code - intitulé » ; **aucun identifiant numérique brut** dans `banque`, `caisse`, `mode` ; `pointe` = « NON » pour un règlement **réservé mais non pointé** (comme l'écran, qui affiche « - ») ; OUI/NON partout ailleurs ; `montant` numérique ; `date` en `jj/mm/aaaa`.
- **S5 GRC, repère** : avec R1 seul coché, le règlement réservé sur R2 sort avec le repère **`<R2>-<lettre>`** (réservé ailleurs) et celui de R1 avec la lettre nue ; avec R1 + R2 cochés, **tous** les repères sont préfixés.
- **S6 GRC filtré, trié, colonnes choisies** : masquer une colonne, en déplacer une, filtrer « Date » en plage (TASK-102) et trier → le fichier a **exactement** les colonnes, l'ordre, les lignes et l'ordre de l'écran.
- **S7 Grille vide** : filtre qui ne laisse aucune ligne → bouton désactivé, infobulle « Aucune ligne à exporter » ; aucun téléchargement (assertion Playwright : pas d'événement `download`).
- **S8 Nom de fichier et date du jour** : le nom porte la date **locale** du jour ; en simulant l'horloge à 23:30 locale (`page.clock` ou équivalent), le nom porte toujours la date du jour (pas celle de la veille).
- **S9 Erreur de génération** : forcer une exception (ex. `XLSX.writeFile` remplacé par une fonction qui lève, via `page.evaluate`/`addInitScript`) → toast « Erreur lors de l'export. », l'écran reste utilisable, aucune erreur non interceptée.
- **S10 Non-régression de la grille** : sélection, lettrage manuel, Auto, filtres, tri comme avant ; **S7 de TASK-099 rejoué** (sélectionner une ligne ne ré-affiche pas les 999 autres : compter les rendus de `GrcTableRow` avec un `console.log` temporaire **retiré ensuite**, `grep` = 0).
- **S11 Preuve par le code** : `grep -n "toISOString\|new Date(" ` dans les nouveaux helpers → 0 ; `git diff` : `App.tsx`, `utils.tsx`, `GrcTableRow`, `areEqual` **non modifiés** ; aucune dépendance ajoutée ; aucun `console.log` restant.

## Risques et points d'attention
- **Le fichier doit être identique à l'écran**, pas à l'état interne : c'est tout l'enjeu du piège n°1. Les scénarios S4 et S5 le prouvent ; ne pas les réduire à un comptage de lignes.
- `RapprochementBancaire.tsx` est en `// @ts-nocheck` : le build ne détecte ni clé oubliée ni appel cassé ; seuls les `grep` et le banc protègent.
- **Bouton dans l'en-tête GRC** : ne pas casser la mise en page des champs « Du / Au » (capture avant/après de l'en-tête).
- **Volume** : 1 000 règlements au plus (plafond de la grille) et quelques milliers de lignes de relevé : `xlsx` les traite sans difficulté ; un export très volumineux reste synchrone (acceptable ici).
- **Coordination** : dernière TASK du lot Rapprochement ; aucune TASK en parallèle sur ce fichier (livrer seule, puis clôture).

## Hors périmètre
- Export du **sens débit** (décaissement) : hors périmètre PO.
- Export des lignes **non affichées** ou de toute la base : non (l'export reflète l'écran).
- Changement de la bibliothèque, format CSV, mise en forme Excel (largeurs, styles) : non.

## Contraintes
- Ne jamais bypasser une règle de sécurité ni une DLL métier GRC. Aucune nouvelle dépendance. Aucun secret en dur (scripts compris).
- Respecter `ARCHITECTURE.md` § Grilles de données ; aucun nouveau composant de grille.
- **Le worker s'arrête au dépôt du VERIFY** : `tasks/VERIFY/TASK-101_verify.md`. Il ne clôt pas la TASK : pas de déplacement vers `DONE_DETAIL/`, pas de mise à jour de `DONE.md` / `TODO.md` / `CHANGELOG.md`, aucun message de commit contenant « approuve ».

## Fichiers concernés
- `gocom-web/src/RapprochementBancaire.tsx` (imports, helpers, `getGrcExportValue`, `handleExportReleve`, `handleExportGrc`, en-têtes des deux grilles)
- `gocom-web/e2e_task101.cjs` (nouveau) et `gocom-web/package.json` (script `test:e2e-101`)

## Checklist VALIDATION (VERIFY : preuve datée par critère — fichier lu par `xlsx`, capture, sortie de commande)
- [ ] Build OK, `npm run lint` 0 erreur (preuve : sorties)
- [ ] S1 Relevé mono : lignes = compteur, repère nu, dates jj/mm/aaaa, Crédit numérique, libellé `=…` en texte (preuve : lecture du fichier)
- [ ] S2 Relevé multi : colonne « Relevé » en tête, repères préfixés (preuve : lecture du fichier)
- [ ] S3 Relevé filtré/trié : uniquement les lignes affichées, même ordre (preuve : lecture du fichier + capture de l'écran)
- [ ] S4 GRC valeurs lisibles, aucun identifiant brut, `pointe` = « NON » pour un réservé (preuve : lecture du fichier + capture)
- [ ] S5 GRC repères, y compris « réservé ailleurs » (preuve : lecture du fichier)
- [ ] S6 GRC colonnes/ordre/filtre/plage de dates = écran (preuve : lecture du fichier + capture)
- [ ] S7 grille vide : bouton désactivé, aucun téléchargement (preuve : assertion)
- [ ] S8 nom de fichier à la date locale, y compris à 23:30 (preuve : assertion)
- [ ] S9 erreur de génération : toast, écran utilisable (preuve : capture)
- [ ] S10 grille non régressée, 1 rendu de ligne par sélection (preuve : mesure)
- [ ] S11 `grep`/`git diff` : aucun `toISOString`/`new Date(` dans les helpers, fichiers protégés inchangés (preuve : sorties)
- [ ] Aucun secret en dur, aucun log de debug laissé (preuve : `git diff`)
- [ ] Aucune dette technique silencieuse
- [ ] Cohérent avec l'architecture

## Go / No-Go
**No-Go si** S4 (valeurs identiques à l'écran, `pointe` compris), S5 (repères préfixés) ou S6 (export = écran, filtres et plage de dates inclus) ne sont pas prouvés par **lecture du fichier généré** : un export qui ne correspond pas à l'écran est pire que pas d'export.
