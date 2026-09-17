# TASK-040 — Bouton « Valider & Enregistrer » de la comptabilisation non visible : diagnostic affichage

- **Priorité** : 🟡 UX (à requalifier en 🔴 si le bouton est réellement inaccessible → comptabilisation impossible)
- **Domaine** : Front
- **Dépend de** : —

## Contexte
Le PO signale qu'il **ne voit que le bouton « Simulation »**, pas de bouton validant l'écriture. Or le code contient déjà tout le dispositif :
- Bouton **« Valider & Enregistrer »** (vert) dans un panneau flottant *« Validation Globale »* — [ApercuComptabilisation.tsx:415-426](../gocom-web/src/ApercuComptabilisation.tsx#L415).
- Handler `handleValider` [l.231-251](../gocom-web/src/ApercuComptabilisation.tsx#L231) → `POST /reglements/comptabiliser` [l.236](../gocom-web/src/ApercuComptabilisation.tsx#L236).
- Endpoint back existant : [ReglementController.cs:89](../GRC.API/Controllers/ReglementController.cs#L89) → `ReglementService.Comptabiliser` (persiste : `comptabilizer.Comptabiliser` + `EcrireDocNumeros`).

Conditions actuelles :
- **Affiché** seulement si `apercus.length > 0` ([l.396](../gocom-web/src/ApercuComptabilisation.tsx#L396)) — après une simulation renvoyant ≥ 1 ligne.
- **Désactivé** si `isSubmitting || hasErrors` ([l.418](../gocom-web/src/ApercuComptabilisation.tsx#L418)), `hasErrors` = une écriture sans `compteGeneral` ([l.229](../gocom-web/src/ApercuComptabilisation.tsx#L229)).
- Les lignes en erreur de pièce arrivent avec `ecritures = []` ([l.207](../gocom-web/src/ApercuComptabilisation.tsx#L207)) → **ne déclenchent pas** `hasErrors`.

Le bouton devrait donc être visible + actif dès qu'une simulation renvoie des résultats. Le panneau étant en `position: absolute; bottom: 1rem` dans son conteneur ([l.397-398](../gocom-web/src/ApercuComptabilisation.tsx#L397)), un **problème de layout** (conteneur sans `position: relative`, hauteur insuffisante, recouvrement, hors-viewport) est le suspect n°1.

## Objectif
Rendre le bouton de validation systématiquement visible et accessible après une simulation à résultats — livré directement (cf. étape 0 assouplie), testé sur la nouvelle version déployée plutôt que par repro préalable.

## Étape 0 — Reproduction (assouplie 2026-09-17)
Décision PO : ne plus bloquer sur une session de repro dédiée — livrer directement le correctif de layout (option robuste ci-dessous) **accompagné d'un log diagnostic front**, puis observer le comportement réel à la prochaine utilisation.
- Log diagnostic (`console.debug` ou équivalent, retirable facilement) juste avant le rendu du panneau [l.396](../gocom-web/src/ApercuComptabilisation.tsx#L396) : `apercus.length`, `hasErrors`. Objectif : si le panneau reste invisible malgré le correctif, distinguer immédiatement "liste vide → pas un bug" de "liste non vide mais bandeau toujours invisible → autre cause à creuser", sans nouvelle session avec le PO.
- Le correctif de layout (étape 1-3 ci-dessous) est appliqué **directement**, pas conditionné à une repro préalable.

## Fichiers concernés
- `gocom-web/src/ApercuComptabilisation.tsx` : panneau flottant [l.396-428](../gocom-web/src/ApercuComptabilisation.tsx#L396) et son conteneur parent [l.302](../gocom-web/src/ApercuComptabilisation.tsx#L302).

## Étapes d'implémentation
1. Vérifier que le conteneur parent du panneau (`.card.table-container`, [l.302](../gocom-web/src/ApercuComptabilisation.tsx#L302)) porte bien `position: relative` — sinon le `position: absolute` se cale sur un ancêtre inattendu.
2. S'assurer que le panneau reste dans le viewport (pas masqué par un overflow / une hauteur `minHeight:0`).
3. Option robuste : ancrer le panneau en `position: fixed` bas-de-page ou le sortir du conteneur scrollable, pour garantir sa visibilité indépendamment du contenu.

## Contraintes
- **Front uniquement** ; ne pas modifier la logique `handleValider` / l'endpoint (fonctionnels).
- Ne pas lever la garde `disabled={hasErrors}` : un déséquilibre / compte manquant doit rester bloquant.

## Risques / dépendances
- Faible côté code. Risque accepté par le PO (2026-09-17) : livrer le correctif sans repro préalable, avec le log diagnostic front en filet de sécurité pour interpréter le résultat réel sur la version déployée.

## Checklist VALIDATION (à remplir dans VERIFY/)
- [ ] Log diagnostic front présent (`apercus.length`, `hasErrors`) juste avant le rendu du panneau
- [ ] Après simulation à résultats, le bouton « Valider & Enregistrer » est visible sans scroll/manipulation
- [ ] Bouton actif quand écritures valides ; désactivé si `hasErrors` / `isSubmitting`
- [ ] Clic → `POST /reglements/comptabiliser` → toast de succès, `apercus` vidé
- [ ] Build front OK
- [ ] Testé sur la version déployée (pas seulement en dev) — noter le résultat observé dans le VERIFY
