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
**Confirmer d'abord si c'est un vrai bug** (repro PO) ou une simple méconnaissance du panneau flottant. Si bug : rendre le bouton de validation systématiquement visible et accessible après une simulation à résultats.

## Étape 0 — Reproduction (bloquant avant tout dev)
Faire reproduire au PO : lancer une simulation qui **renvoie des résultats** et observer le bas de l'écran.
- **Si le bandeau « Validation Globale » apparaît** → pas de bug, fermer la TASK (formation/UX mineure).
- **S'il n'apparaît pas** → bug de layout confirmé, poursuivre.

## Fichiers concernés
- `gocom-web/src/ApercuComptabilisation.tsx` : panneau flottant [l.396-428](../gocom-web/src/ApercuComptabilisation.tsx#L396) et son conteneur parent [l.302](../gocom-web/src/ApercuComptabilisation.tsx#L302).

## Étapes d'implémentation (si bug confirmé)
1. Vérifier que le conteneur parent du panneau (`.card.table-container`, [l.302](../gocom-web/src/ApercuComptabilisation.tsx#L302)) porte bien `position: relative` — sinon le `position: absolute` se cale sur un ancêtre inattendu.
2. S'assurer que le panneau reste dans le viewport (pas masqué par un overflow / une hauteur `minHeight:0`).
3. Option robuste : ancrer le panneau en `position: fixed` bas-de-page ou le sortir du conteneur scrollable, pour garantir sa visibilité indépendamment du contenu.

## Contraintes
- **Front uniquement** ; ne pas modifier la logique `handleValider` / l'endpoint (fonctionnels).
- Ne pas lever la garde `disabled={hasErrors}` : un déséquilibre / compte manquant doit rester bloquant.

## Risques / dépendances
- Faible côté code. Le vrai risque est de **coder un correctif pour un non-bug** : l'étape 0 (repro) est impérative avant tout changement.

## Checklist VALIDATION (à remplir dans VERIFY/)
- [ ] Repro PO effectuée (bug confirmé ou infirmé)
- [ ] Si bug : après simulation à résultats, le bouton « Valider & Enregistrer » est visible sans scroll/manipulation
- [ ] Bouton actif quand écritures valides ; désactivé si `hasErrors` / `isSubmitting`
- [ ] Clic → `POST /reglements/comptabiliser` → toast de succès, `apercus` vidé
- [ ] Build front OK
