# VERIFY — TASK-112 : Police globale Inter → Roboto (harmonisation xGR)

- **Tâche** : TASK-112 — Police globale Inter → Roboto (harmonisation xGR)
- **Date** : 2026-10-01
- **Auteur** : Antigravity (Agent d'implémentation)
- **Statut** : FAIT (validé E2E Playwright, vérification des 5 graisses chargées, inspection DOM et captures avant/après)

---

## 1. Contexte & Périmètre

Suite à l'analyse UX (`pilotage/ANALYSE_UX_XGR_VS_GRC_WEB_2026-09-29.md`), xGR (`Tresorerie.Vue`) utilise la police **Roboto** comme typographie globale (`Roboto, 'Helvetica Neue Light', 'Helvetica Neue', Helvetica, Arial, 'Lucida Grande', sans-serif` — stack Material/PrimeVue par défaut). GRC_WEB utilisait jusqu'à présent **Inter** (`gocom-web/src/index.css:1,52`).

Le cadrage PO du 2026-10-01 a fixé :
- **Périmètre strict** : Aligner la police de toute l'application GRC_WEB sur **Roboto** via `@import` Google Fonts, en conservant les 5 graisses existantes (300, 400, 500, 600, 700).
- **Élimination des résidus "Inter"** : Traiter les occurrences isolées identifiées dans le code (`RapprochementBancaire.css:7` et `LicenceBlockedScreen.tsx:21`).
- **Hors périmètre strict** : Couleurs d'accent, boutons, badges, cartes — seul le remplacement de police est opéré, toute la palette de couleurs et la mise en page restent inchangées.

---

## 2. Modifications apportées

### Fichiers modifiés

1. `gocom-web/src/index.css` :
   - Remplacement de l'import Google Fonts (ligne 1) :
     ```css
     @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;600;700&display=swap');
     ```
   - Remplacement de la règle globale `body` (ligne 52) :
     ```css
     body {
       font-family: 'Roboto', sans-serif;
       ...
     }
     ```

2. `gocom-web/src/RapprochementBancaire.css` :
   - Mise à jour de la règle locale du conteneur (ligne 7) :
     ```css
     .rapprochement-container {
         ...
         font-family: 'Roboto', sans-serif;
     }
     ```

3. `gocom-web/src/LicenceBlockedScreen.tsx` :
   - Mise à jour du style inline (ligne 21) :
     ```tsx
     fontFamily: 'Roboto, sans-serif',
     ```

4. `gocom-web/package.json` :
   - Ajout du script de validation automatisé :
     ```json
     "test:e2e-112": "node e2e_task112.cjs verify"
     ```

5. `gocom-web/e2e_task112.cjs` :
   - Script Playwright de validation automatisée : capture des écrans représentatifs (Règlements, Rapprochement, Comptabilisation), vérification des styles calculés dans le DOM (`body` et `.rapprochement-container`), et vérification du chargement effectif des 5 graisses (300, 400, 500, 600, 700) via l'API `document.fonts`.

---

## 3. Preuves de chargement des 5 graisses Roboto

L'URL Google Fonts utilisée :
`https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;600;700&display=swap`

Toutes les 5 graisses ont été vérifiées et chargées dans le navigateur via `document.fonts.load()` :
- **300** (Light) : `status: 'loaded'` ✅
- **400** (Regular) : `status: 'loaded'` ✅
- **500** (Medium) : `status: 'loaded'` ✅
- **600** (Semi-Bold) : `status: 'loaded'` ✅
- **700** (Bold) : `status: 'loaded'` ✅

Résultat de l'inspection dynamique Playwright :
```json
{ "300": true, "400": true, "500": true, "600": true, "700": true }
```

---

## 4. Vérification d'absence de résidus "Inter"

Recherche globale par `git grep "Inter" gocom-web/src/` :
```text
gocom-web/src/RelevesBancaires.tsx:const ReleveInterrogation: React.FC<{ releve: any; caissesMap: Record<number, any>; onBack: () => void }> = ({ releve, caissesMap, onBack }) => {
gocom-web/src/RelevesBancaires.tsx:        return <ReleveInterrogation releve={selectedReleve} caissesMap={caissesMap} onBack={() => setSelectedReleve(null)} />;
gocom-web/src/api.ts:// TASK-065 — Intercepteur de réponse : détecte un 403 GRLicence et déclenche
```
Aucune occurrence typographique ou résidu de la police "Inter" dans le code.

---

## 5. Preuves d'écran avant / après (3 écrans représentatifs)

Toutes les captures sont stockées dans `tasks/VERIFY/TASK-112_evidence/` :

1. **Écran Règlements** :
   - Avant (Inter) : `tasks/VERIFY/TASK-112_evidence/screenshot_task112_before_reglements.png`
   - Après (Roboto) : `tasks/VERIFY/TASK-112_evidence/screenshot_task112_after_reglements.png`

2. **Écran Rapprochement Bancaire** :
   - Avant (Inter) : `tasks/VERIFY/TASK-112_evidence/screenshot_task112_before_rapprochement.png`
   - Après (Roboto) : `tasks/VERIFY/TASK-112_evidence/screenshot_task112_after_rapprochement.png`

3. **Écran Comptabilisation** :
   - Avant (Inter) : `tasks/VERIFY/TASK-112_evidence/screenshot_task112_before_comptabilisation.png`
   - Après (Roboto) : `tasks/VERIFY/TASK-112_evidence/screenshot_task112_after_comptabilisation.png`

---

## 6. Résultat d'exécution du test E2E

```text
> gocom-web@0.0.0 test:e2e-112
> node e2e_task112.cjs verify

Serveur mock TASK-112 démarré sur http://localhost:3512

--- Démarrage test mode: verify ---
Capture Écran 1: Règlements...
  Body font-family: "Roboto, sans-serif"
Navigation vers Écran 2: Rapprochement...
  Rapprochement-container font-family: "Roboto, sans-serif"
Navigation vers Écran 3: Comptabilisation...

--- Vérification des polices actives ---
  Body contient "Roboto" : true (Roboto, sans-serif)
  Rapprochement contient "Roboto" : true (Roboto, sans-serif)
  Vérification du chargement effectif des 5 graisses (300, 400, 500, 600, 700): { '300': true, '400': true, '500': true, '600': true, '700': true }

>>> SUCCÈS : Toutes les 5 graisses Roboto (300, 400, 500, 600, 700) sont confirmées chargées ! <<<
Captures enregistrées sous D:\_vibe\GRC_WEB\tasks\VERIFY\TASK-112_evidence
```

---

## 7. Checklist VALIDATION

- [x] Build OK (`tsc -b && vite build` : 0 erreur, `dotnet build GRC.slnx` : 0 erreur)
- [x] Capture avant/après d'au moins 3 écrans (Règlements, Rapprochement, Comptabilisation)
- [x] Les 5 graisses (300/400/500/600/700) confirmées chargées (`document.fonts.load` vérifié avec succès)
- [x] `RapprochementBancaire.css:7` et `LicenceBlockedScreen.tsx:21` traités, pas de résidu "Inter" dans le code (grep final)
- [x] Aucun credential/secret en dur introduit
- [x] Aucune dette technique silencieuse
- [x] Cohérent avec l'architecture
