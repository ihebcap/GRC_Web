# VERIFY — TASK-101 : bouton « Exporter » (grilles Relevé et GRC)

**Worker** : Claude (worker de secours, dérogation PO) — **ne clôt pas la TASK** : review par un tiers requise.
**Date des preuves** : 2026-09-30 · **Base** : `GR_GOCOM@DESKTOP-2VCUE93` (base de TEST, 172.19.0.193 — pas la prod 172.16.0.205) · API locale `dotnet run` (http://localhost:5044), front = `deploy/wwwroot` (`npm run build`).

## Conclusion
Les 11 scénarios sont rejoués et passent : **39 assertions OK, 0 KO** (`TASK-101_evidence/e2e_run.txt`, `npm run test:e2e-101`). S4, S5, S6 (critères No-Go) sont prouvés par **relecture du fichier `.xlsx` généré** (`xlsx` côté Node), comparé ligne à ligne, colonne à colonne à ce que l'écran affiche.

## Changements
- `gocom-web/src/RapprochementBancaire.tsx` : imports `xlsx`/`Download`/`getTypeReglementLabel`, helpers `isoVersJourFr` / `dateDuJour`, `getGrcExportValue` (mapping manuel calqué sur `renderSharedCell`), `telechargerXlsx`, `handleExportReleve`, `handleExportGrc`, deux boutons « Exporter » (en-tête Relevé passé en flex comme l'en-tête GRC ; GRC avant « Actualiser »).
- `gocom-web/e2e_task101.cjs` (nouveau) + script `test:e2e-101` dans `package.json`.
- Non modifiés : `App.tsx`, `utils.tsx`, `GrcTableRow`, `areEqual`, `renderSharedCell`, `getGrcCellValue`. Aucune dépendance ajoutée.

## Jeu d'essai (consigné, supprimé en fin de banc — vérifié par `SELECT` : 0 relevé `T101-%` restant, règlements réels non touchés)
Dernier passage : R1 = 1277, R2 = 1278 (lignes 6583–6590). Règlements réels (banque 1, virements, 2026-04-15) : 27059 (n° 126263, libre), 27072 (126264, **réservé sur R1**), 27080 (126268, **réservé sur R2**), 27081 (126269). Réservations faites par `POST /api/ReleveBancaire/reserve` (HTTP 200 ×2), jamais validées. Lignes crédit uniquement ; dates J1 13/04, J2 14/04 (×3), J3 15/04 ; crédit 1234,56 ; libellé `=SOMME(1+1)`.

## Checklist (preuve par critère, 2026-09-30)
- [x] **Build OK, lint** : `npm run build` ✓ ; `npm run lint` : uniquement des warnings préexistants (aucun nouveau de mon fait ; le `catch` de l'export est sans variable).
- [x] **S1 Relevé mono** : `Export_Releve_<date>.xlsx`, feuille `Releve`, 4 lignes = compteur, pas de colonne « Relevé », repère `A` nu sur la seule ligne réservée, dates jj/mm/aaaa, Crédit 1234.56 de type `n`, libellé `=SOMME(1+1)` de type `s` sans formule (`e2e_run.txt` § S1 ; capture `screenshot_s1_releve_mono.png`).
- [x] **S2 Relevé multi** : « Relevé » en 1re colonne (`titre (#id)`), repères `1277-A` / `1278-A`, 8 lignes = compteur, ordre = écran (`screenshot_s2_releve_multi.png`).
- [x] **S3 Relevé filtré/trié** : Date Op. Du=Au=J2 + tri Crédit décroissant → 3 lignes (J2 ×3, pas 4 : R1 a2, a3 et R2 b2), `[10082, 5503, 2222.22]`, même ordre que l'écran (`screenshot_s3_releve_filtre_trie.png`).
- [x] **S4 GRC valeurs lisibles** : 273 lignes = écran = compteur ; en-têtes = écran ; **toutes les valeurs identiques à l'écran** (montants numériques `t=n`, dates jj/mm/aaaa, Banque = code `BCP`, Type = `Virement`, mode/caisse lisibles, `Pointé` : « - » de l'écran ↔ « NON », 5 lignes réservées non pointées → « NON ») (`screenshot_s4_grc.png`).
- [x] **S5 Repères GRC** : R1 seul → réservé sur R1 = `A` (nu), réservé sur R2 = `1278-A` (réservé ailleurs) ; R1+R2 → `1277-A` et `1278-A`, aucun repère nu (`screenshot_s5_grc_multi.png`).
- [x] **S6 GRC = écran** : colonne « Comptabilisé » masquée (absente du fichier), « Montant Devise » déplacée avant « Client » (drag), filtre Date en plage, tri Montant : 178 lignes = compteur, colonnes/ordre/valeurs = écran (`screenshot_s6_grc.png`).
- [x] **S7 Grille vide** : les deux boutons désactivés, infobulle « Aucune ligne à exporter », aucun événement `download` (`screenshot_s7_vide_*.png`).
- [x] **S8 Date locale** : `page.clock.setFixedTime` à 23:30 locale (fuseau Africa/Casablanca) → `Export_Releve_2026-04-15.xlsx`.
- [x] **S9 Erreur de génération** : `URL.createObjectURL` forcé à lever → toast « Erreur lors de l'export. », écran utilisable, 0 `pageerror` (`screenshot_s9_erreur.png`).
- [x] **S10 Non-régression** : sélection d'une ligne GRC sur 273 → **1 rendu** de `GrcTableRow` (273 au chargement) — mesuré avec un `console.log` temporaire (`s10_rendus.txt`), **retiré ensuite** : `git diff | grep -c "GRCROW\|TEMP-TASK101"` = 0 et bundle final sans `GRCROW` ; sélection relevé + GRC sans erreur.
- [x] **S11 Preuve par le code** : `toISOString`/`new Date(` dans les helpers : **0 dans `isoVersJourFr`**. `dateDuJour` contient `new Date()` **sans argument** (date du jour, composantes locales `getFullYear/getMonth/getDate`, pas d'UTC) : c'est ce que demande l'étape 3 de la TASK, en tension avec la lettre de S11 — à arbitrer par le reviewer (prouvé par S8). `git diff --stat` : seuls `RapprochementBancaire.tsx` et `package.json` modifiés (+ le banc) ; aucun secret, aucun `console.log` ajouté.
- [x] **Aucun secret en dur** : le banc lit `GRC_E2E_*` / `SQLCMDPASSWORD` ; en session, le mot de passe SQL a été lu depuis `GRC.API/appsettings.json` local (non commité) dans une variable d'environnement, jamais écrit.

## Écarts à l'énoncé, à connaître (non cochés comme « faits » ailleurs)
- **Compte de test** : `Admin` (administrateur) au lieu d'un U1 non-admin ; sans effet sur l'export (aucune logique de droits dedans).
- **S10 « 999 autres lignes »** : mesuré sur **273** règlements (plafond de 1000 non atteint sur la base de test).
- **Réservations** faites par l'API et non par clic sur l'écran ; filtres, tri, colonnes et sélection, eux, par l'écran.
- **Type de règlement vide** : si `typeNo` du mode est inconnu, l'écran et le fichier affichent vide (identique à l'écran ; `getGrcCellValue` dirait « Autre »). Non rencontré en données de test (tous « Virement »).
- **Comparaison à l'écran** : espaces multiples/insécables normalisés des deux côtés (le navigateur les replie), casse des en-têtes ignorée (CSS `text-transform`).
- Non testé : volume > quelques centaines de lignes, autre banque que la banque 1.

## Point d'arrêt
VERIFY déposé. Commit local `feat(rapprochement): …(TASK-101)`, sans `DONE.md`/`TODO.md`/`CHANGELOG.md`/`DONE_DETAIL`, sans « approuve ».
