# VERIFY TASK-102 — Filtres de date Rapprochement (Relevé + GRC) — v2 (après REJECT « rien n'a été exécuté »)

Worker : Claude (worker de secours, dérogation PO). Dates : 2026-09-30. **Clôture réservée à un reviewer tiers.**
Méthode : API réelle (`dotnet run`, http://localhost:5044) + base de TEST `DESKTOP-2VCUE93/GR_GOCOM` (confirmée PO), navigateur Playwright piloté par `gocom-web/e2e_task102.cjs` (front = `deploy/wwwroot` rebuildé avec TASK-102). Compte `Admin` (config de test locale). Jeu d'essai : relevé `T102-RX` (4 lignes crédit, créé puis supprimé par le script ; A1 réservée à un vrai règlement pour le test Repère). Sortie brute : 27 `OK`, 0 `KO`, exit 0. Captures : `tasks/VERIFY/TASK-102_evidence/`.

## Changements (front uniquement, inchangés depuis v1)
`utils.tsx` : `matchDateRange(raw, "min~max")` (10 premiers caractères, bornes inclusives, date absente/invalide exclue si borne active, pas de `new Date()`). `RapprochementBancaire.tsx` : `filterType="date"` sur Date Op. / Date Val. (Relevé) et Date (GRC), branches `date` dans `filteredLignes` / `filteredReglements`, ancienne branche texte localisée supprimée, import `formatDate` retiré.

## Étape 1 — Reproduction / API GRC (réponses réelles)
- **Format `r.date` confirmé** : `"2026-07-27T00:00:00"`, `"2026-07-26T12:09:28.153"` ; les 226 lignes de juillet commencent toutes par `yyyy-mm-ddT` (les lignes Relevé `dateOperation` idem : `"2026-07-15T09:00:00"`).
- **Requête envoyée par l'UI** (Du=Au=2026-07-20 puis Actualiser) : `…&dateDebut=2026-07-20&dateFin=2026-07-20T23:59:59` → **2 lignes reçues, toutes du 20**, = 2 en requête large = 2 en SQL brut. **Borne de fin incluse via l'UI ; aucun défaut côté API/UI sur ce parcours.** UI affiche 2 = réponse API.
- Jours testés (API `dateFin="<jour>T23:59:59"` vs large) : 07-20 → 2/2, 07-26 → 1/1, 07-27 → 1/1.
- **Constat en marge (non corrigé, hors périmètre)** : si un appelant envoie `dateFin` **sans heure** (`2026-07-26`), l'API renvoie **0/1** pour un règlement daté `2026-07-26T12:09:28` → borne de fin exclusive pour les dates nues. L'écran Rapprochement n'est pas concerné (il ajoute `T23:59:59`, cf. TASK-080) ; à vérifier pour les autres appelants si besoin. Le perçu « Du/Au ne marche pas » venait donc d'abord du filtre de colonne en texte (corrigé ici) et/ou de l'oubli d'Actualiser.

## Checklist VALIDATION (preuve par critère, 2026-09-30)
- [x] Build OK + lint — `tsc -b` 0 erreur, `npm run build` OK, `oxlint` 0 erreur (warnings préexistants).
- [x] Relevé Date Op. (lignes op 10, 15, 15, 20/07 ; bornes tombant sur les dates) : Du=15 → A2,A3,A4 ; Au=15 → A1,A2,A3 ; Du=Au=15 → A2,A3 (deux lignes même jour, l'une à 23:59 → inclusive) ; 16→19 → 0 ligne ; Effacer → 4 lignes. Captures `releve_00…03`.
- [x] Relevé Date Val. (val 12, 15, 18, 22/07) : Du=15 → A2,A3,A4 ; Au=15 → A1,A2 ; 15→18 → A2,A3 ; 23→31 → 0 ; Effacer → 4.
- [x] GRC colonne Date (226 lignes affichées = 226 API ; dates 07-20 ×2, 07-26 ×1 avec heure 12:09, 07-27 ×1) : Du=20 → 4 ; Au=20 → 224 ; Du=Au=20 → 2 ; Du=Au=26 → 1 ; 21→25 → 0 ; Effacer → 226. Captures `grc_01…04`.
- [x] Du/Au d'en-tête + Actualiser documenté après reproduction (voir étape 1) — `grc_05_du_au_actualiser_20.png`.
- [x] Tri chronologique inchangé — captures `nonreg_tri_asc/desc` : asc 01/07 → 03/07, desc 27/07, 26/07, 20/07, 06/07 (règlements réservés groupés en tête : comportement TASK-100/106 existant).
- [x] Non-régression filtre montant (Crédit « 222,22 » → A2 seule) et filtre Repère TASK-100 (liste → A1, seule réservée). Captures `nonreg_montant`, `nonreg_repere`.
- [x] Aucun secret introduit (script : identifiants via variables d'environnement ; mot de passe SQL lu dans la config locale au lancement, jamais écrit).
- [x] Export (TASK-101 non codée) / auto-reconcile : grep de `RapprochementBancaire.tsx` (2026-09-30) : `grcFilters`/`releveFilters` ne sont lus que dans `filteredReglements`/`filteredLignes` (l.1184-1227) et les en-têtes ; `handleAutoReconcile` (l.793-861) ne les référence pas.
- [ ] Limite assumée : filtre testé avec 1 seul compte (Admin, toutes caisses) ; pas de test multi-utilisateurs (sans objet pour un filtre d'affichage).
- [x] Aucune dette silencieuse : le constat `dateFin` nue est documenté ci-dessus, non corrigé.

## Nettoyage
Relevé de test supprimé par le script (lettrage de A1 libéré avant suppression) ; API de test arrêtée. Aucun commit effectué.

## Question PO (inchangée)
Barre « Du / Au » globale sur le Relevé : non ajoutée (défaut retenu).
