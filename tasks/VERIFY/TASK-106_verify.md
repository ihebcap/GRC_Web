# VERIFY — TASK-106 (appariement ligne ↔ règlement par MV_ID)

- **Worker** : Claude (worker de secours, Gemini indisponible) — 2026-09-30
- **Base utilisée** : base LOCALE `GR_GOCOM` (serveur `DESKTOP-2VCUE93`, chaîne de `appsettings.json`, 7 relevés historiques + relevés de test `T106-*`) — **pas la prod**. API lancée en local (`dotnet run`, port 5044).
- **Comptes** : U1 = `IMONEY` (id 3, non-admin, 172 caisses), U2 = `PAYX` (id 2, non-admin, 162 caisses) — sessions réelles (comptes de la copie de test).
- **Statut** : tous les scénarios S0 → S12 exécutés, **sauf S11 (non applicable, voir plus bas)**. Aucun KO au dernier passage.
- **Arrêt au dépôt du VERIFY** : aucune clôture, aucun commit.

## Réalisé
- **Back** (`ReglementService.cs`) : `ReglementClientDto.ReleveEnteteId`, SQL réservations (+`ReleveBancaireEnteteId`), tuple à 5 champs (5 sites, dont la réaffectation après résolution du nom), `ReglementMapper.Map(..., int? releveEnteteId = null)`.
- **Front** (`RapprochementBancaire.tsx` seul) : types, mappings, `formatRepere`/`comparePairKey`, `loadedMvIds`, rendu « réservé ailleurs » (cadenas + `#id`, sans case, sans `lettered-row`), `areEqual` (+`reservedElsewhere`,`repere`), `delettrerLigne` (remplace `delettrerByLettrage`), handlers de sélection, `handleDelettrerTout`, `handleApprouver`, `getGrcCellValue`, tri 3 rangs, deps des `useMemo`, `executeManualLettrage`, `handleAutoReconcile` (Map).
- Non touchés : `utils.tsx`, endpoints reserve/release/validate, moteur, schéma SQL.

## Résultats (2026-09-30)
| Scénario | Résultat | Preuve |
|---|---|---|
| Build back / front | 0 erreur | `dotnet build GRC.API` ; `npm run build` |
| Lint | 0 erreur (warnings préexistants) | `npm run lint` |
| **S0** défaut reproduit AVANT | **reproduit** : sur l'ancien front, clic sur R1 (réservé sur RX0, lettre A) → `release-batch [Y1]` (mauvaise ligne) ; SQL : Y1 libre, X1 inchangée | `compare_before.log`, `cmp_before_s0_*.png` |
| **S0 après** | clic sur R1 : **aucun appel**, Y1 et X1 inchangées | `compare_after.log`, `cmp_after_s0_*.png` |
| **S1** non-régression mono (lot N : N1↔RN1, N2↔RN2 manuels + Auto N3↔RN3) | grille Relevé, règlements appariés (ordre, repères A/B/C, cases) **identiques** avant/après (JSON comparé) ; seul écart voulu : les règlements réservés par d'autres/ailleurs gagnent le préfixe `<idRelevé>-` (7 lignes) | `s1_before.json`, `s1_after.json`, `cmp_*_s1_lot_n.png` |
| **S1 Approuver** | 3 paires envoyées, `successCount = 3`, `errorCount = 0`, lignes et règlements disparus, SQL `MV_Point = 1` ×3 | `compare_after.log` |
| Collision réelle | relevés neufs : X1 (RX) = « A » **et** Y1 (RY) = « A » attribuées par le serveur | `e2e_real_run.log` |
| **S2** | R1 : cadenas, `#<RX>`, repère `<RX>-A`, sans case ; R3 apparié à Y1 (« A » nu) ; clic R1 = 0 appel ; clic Y1 = `release-batch [Y1]` seul ; SQL : X1 toujours réservée, Y1 libre | log + `real_s2_*.png` |
| **S3** | tri appariés < ailleurs < libres ; `validate` = `(Y1,R3)`+`(Y2,R4)` exactement, succès sans erreur ; R1 reste affiché ; SQL : Y1,Y2 validées, X1 en cours, R3,R4 `MV_Point=1`, R1 `0` | log + `real_s3_*.png` |
| **S4** (vrai U2) | U2 réserve X2↔R2 par sa session ; **U1 tente la même ligne : HTTP 409** ; X2/R2 verrouillés (cadenas + nom) chez U1 ; `validate` = `(X1,R1)` seulement, aucun message d'erreur ; X2/R2 restent visibles ; SQL : X2 toujours à U2 | log + `real_s4_*.png` |
| **S5** | R5 hors période : 0 appel `validate`, message exact (n = 1), X3 conservée, clic X3 = `release-batch [X3]`, SQL libre | log + `real_s5_message.png` |
| **S6** | ordre R6 (apparié) < R7,R2 (ailleurs) < R8 (libre) ; filtre Repère propose `A/C…`, `1038-B`, `1038-C`, `6-MS`… ; **filtrer sur « C » → 1 ligne (R6) ; sur « `<RX>-C` » → 1 ligne (R7)** | log + `real_s6_*.png` |
| **S7** | « Dérapprocher » : `release-batch [Y3]` seul ; SQL : X4 toujours réservée (MV_ID = R7) ; R7 reste « réservé ailleurs » | log + `real_s7_*.png` |
| **S8** | R1 (réservé, nom résolu « IMONEY IMONEY ») → `releveEnteteId = <RX>` non nul ; R3 → `<RY>` ; libre → `null` ; **seul** ce champ est ajouté (mêmes autres clés) | `e2e_real_run.log` |
| **Noms JSON** | `{"id":5940,"mV_ID":48142,"releveBancaireEnteteId":1041,"lettrage":"A"}` | `e2e_real_run.log` |
| **S9** | bandeau « Mettre à jour le montant et rapprocher » ; SQL : Y4 réservée avec R8 (`MV_ID` renseigné), montant R8 = montant de Y4 ; libération par un clic OK ; R8 **restauré** à son montant d'origine (PUT, HTTP 200) | log + `real_s9_bandeau.png` |
| **S10** 1 000 règlements réels | sélection d'une ligne de relevé : **0** ligne GRC modifiée ; une réservation : **1** ligne GRC modifiée (sur 1 000) — **identique à l'avant** ; temps chargement+rendu (3 mesures) : avant 5100 / 2804 / 4163 ms, après 3270 / 3855 / 3090 ms → **comparable** (bruit de mesure > écart) | `compare_*.log`, `s10_*.json` |
| **S12** | 0 `delettrerByLettrage` (hors commentaire), 0 `lettrage ===` ; `propsToCompare` = `…, onAnnuler, reservedElsewhere, repere` ; aucun `console.count/log` ajouté | `grep`, `git diff` |
| Données réelles | la copie contient 37 réservations d'un autre relevé (n°6) : affichées verrouillées `6-MS`, `6-NQ`… sans erreur | `real_s2_ry_affiche.png` |
| Simulation mockée | S2/S3/S5 PASS | `npm run test:e2e-106-mock` |

**Rejouables** : `npm run test:e2e-106` (S2–S9 ; 51 OK / 0 KO au dernier passage) et `npm run test:e2e-106-compare -- <before|after> <dossier_front>` (S0/S1/S10). Env : `GRC_E2E_BASE_URL`, `GRC_E2E_USER1/PASS1`, `GRC_E2E_USER2/PASS2`, `SQLCMDPASSWORD` (mot de passe des comptes de test lu dans l'environnement, jamais dans un fichier). L'« avant » se rebâtit avec `git show HEAD:gocom-web/src/RapprochementBancaire.tsx` dans une copie du dossier front. Chaque exécution crée relevés/lignes de test et **consomme** des règlements (approbations).

## Non exécuté / limites
- **S11** : la base n'est pas une copie récente de la prod (les 5 réservations prod, relevés 4/41/154/180/205, n'y existent pas) → **« non vérifié : pas de copie prod »**, conformément au scénario.
- **S10** : mesure de temps bruitée (±1,5 s entre passes) ; pas de profileur React, on mesure les mutations DOM de la grille GRC (proxy fiable du re-rendu des lignes).
- Front testé en **build de production** derrière un proxy `/api` vers l'API locale, pas via IIS/`deploy\` réel.
- **Effets sur la base locale** : règlements pointés par les tests ; relevés `T106-*` et leurs lignes conservés ; montant de R8 restauré à chaque passage. Rien sur la prod.
- **Constat hors périmètre** (préexistant) : « Actualiser » ne recharge pas la grille GRC si les dates Du/Au sont inchangées ; une réservation faite hors de l'écran n'apparaît qu'après changement de période ou de banque.

## Go / No-Go
S2, S3, S4, S5, S7, S10 **prouvés** sur API + SQL réels → pas de motif de No-Go ; décision de clôture laissée au reviewer.

## État du dépôt
Modifs **non committées** : `ReglementService.cs`, `RapprochementBancaire.tsx`, `package.json`, `e2e_task106.cjs`, `e2e_task106_compare.cjs`, `e2e_task106_mock.cjs`, `TASK-106_verify.md`, `TASK-106_evidence/`. L'index a évolué pendant la session (TASK-099/105 déplacées vers `DONE_DETAIL/`) : trier avant commit.
