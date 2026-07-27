# TASK-042 — Comptabiliser depuis la liste (1 ou N règlements) via l'écran d'aperçu, chemin unique

- **Priorité** : 🟠 Majeur (besoin PO : pouvoir comptabiliser un **seul** règlement pour tester, sans passer par les filtres de l'écran dédié, mais **avec** l'aperçu de contrôle)
- **Domaine** : Front
- **Dépend de** : TASK-035 (écran aperçu), TASK-036/038 (valeurs forcées à la compta) — réutilise l'existant, **aucun changement backend**

## Contexte
Deux chemins de comptabilisation coexistent aujourd'hui côté front, et ils **divergent** :

1. **Liste des règlements** (`App.tsx`) — un mode « Comptabiliser » avec sélection par cases → `handleSubmitComptabilisation` → **POST direct `/reglements/comptabiliser` SANS aperçu** ([App.tsx:493-512](../gocom-web/src/App.tsx#L493), bouton [l.760-787](../gocom-web/src/App.tsx#L760), bandeau [l.870-920](../gocom-web/src/App.tsx#L870)). C'est un commit métier **aveugle** : pas de contrôle visuel des valeurs forcées (pièce, DocNumero, dates — TASK-036/038).
2. **Écran dédié `ApercuComptabilisation`** — charge les règlements par **filtres** (caisses / modes / dates / rapproché, [l.189-232](../gocom-web/src/ApercuComptabilisation.tsx#L189)) → simule (`/apercu-comptabilisation`) → valide (`/comptabiliser`, [l.251-256](../gocom-web/src/ApercuComptabilisation.tsx#L256)). Il **ne prend pas** une sélection explicite d'IDs.

Le PO veut comptabiliser **un seul** règlement (test) sans devoir reconstruire les filtres de l'écran dédié — donc en le **sélectionnant dans la liste** — mais **sans perdre l'aperçu** de contrôle.

**Le backend est déjà bon et unitaire** : `/apercu-comptabilisation` et `/comptabiliser` prennent une **liste d'IDs** ([ReglementController.cs:89,103](../GRC.API/Controllers/ReglementController.cs#L89)) ; 1 règlement = liste de 1. Garde d'idempotence en place : `if (reg == null || reg.IsComptabilise != 0) return;` ([ReglementService.cs:316](../GRC.Infrastructure/Services/ReglementService.cs#L316)) → un règlement déjà comptabilisé est **ignoré**, jamais re-comptabilisé.

## Décision actée avec le PO
On **ne rajoute pas un 2ᵉ chemin aveugle**. On fait **converger la sélection de la liste vers l'écran d'aperçu** : sélectionner 1 (ou N) règlement(s) dans la liste ouvre l'aperçu **pré-alimenté sur ces IDs**, puis simulation → validation. Un seul chemin de code, l'aperçu de contrôle est conservé.

## Objectif
Permettre de comptabiliser depuis la liste **une sélection explicite** (1 règlement minimum) en la routant vers `ApercuComptabilisation`, qui simule et valide ces IDs précis via les endpoints existants. Supprimer le POST direct aveugle `handleSubmitComptabilisation`.

> **Exigence PO (obligatoire, non négociable)** : le bouton **« Comptabiliser »** de l'écran d'aperçu **lance réellement la comptabilisation** des lignes affichées (persistance via `POST /reglements/comptabiliser`). L'aperçu **n'est pas** un cul-de-sac de prévisualisation : un clic = commit métier des règlements simulés. C'est le rôle du handler `handleValider` existant ([ApercuComptabilisation.tsx:251-256](../gocom-web/src/ApercuComptabilisation.tsx#L251)) ; le renommage du libellé en « Comptabiliser » ne doit rien changer à ce comportement.

## Fichiers concernés
- `gocom-web/src/ApercuComptabilisation.tsx` : ajout d'une entrée « par IDs » (prop optionnelle) en plus du mode « par filtres » actuel.
- `gocom-web/src/App.tsx` : le mode « Comptabiliser » de la liste route la sélection vers la vue aperçu au lieu du POST direct ; retrait de `handleSubmitComptabilisation` (POST aveugle) et du bandeau « Lancer la Comptabilisation ».

## Étapes d'implémentation

### 1. `ApercuComptabilisation` accepte une sélection d'IDs (mode additif)
- Ajouter une prop **optionnelle** `preselection?: { id: number; client: string; date: string; montant: number; piece: string }[]` (métadonnées déjà présentes dans les lignes de la liste → **pas de re-fetch** des règlements).
- Si `preselection` est fournie : **court-circuiter** le fetch par filtres de `handleSimuler` ; utiliser directement `ids = preselection.map(r => r.id)`, appeler `POST /apercu-comptabilisation` avec ces IDs, et construire `apercusData` à partir des métadonnées passées (même mapping qu'aux [l.219-229](../gocom-web/src/ApercuComptabilisation.tsx#L219)).
- Si `preselection` est absente : **comportement filtres inchangé** (l'écran dédié via sidebar continue de marcher à l'identique).
- Optionnel UX : lancer la simulation automatiquement à l'arrivée quand `preselection` est fournie (sinon garder le bouton « Simulation »).

### 2. `App.tsx` — router la sélection vers l'aperçu
- Le mode « Comptabiliser » de la liste (sélection par cases, [l.581-582](../gocom-web/src/App.tsx#L581)) reste ; seule la **sortie** change.
- Le bouton d'action (aujourd'hui « Lancer la Comptabilisation », [l.917](../gocom-web/src/App.tsx#L917)) devient « Comptabiliser (N) » et **bascule vers la vue aperçu** (`setCurrentView('comptabilisation')`) en passant `preselection` = les lignes sélectionnées (id + client/date/montant/pièce depuis `reglements`). Ce bouton **ouvre l'aperçu** ; c'est le bouton **« Comptabiliser » de l'aperçu** qui **commite** (voir Objectif).
- **Supprimer** `handleSubmitComptabilisation` ([l.493-512](../gocom-web/src/App.tsx#L493)) et le POST direct `/reglements/comptabiliser` aveugle.
- Câbler le passage de `preselection` à `<ApercuComptabilisation … />` ([l.720](../gocom-web/src/App.tsx#L720)) ; à la fin de la validation (succès), vider `selectedComptabilisation` et revenir à la liste rafraîchie.

### 3. Cohérence sélection
- La garde de sélectionnabilité en liste (`isComptabilisationMode && reg.isComptabilise === 0`, [l.581,591](../gocom-web/src/App.tsx#L581)) reste : on ne peut sélectionner qu'un règlement **non comptabilisé** (cohérent avec la garde backend).

## Contraintes
- **Front uniquement** — **aucun changement backend** (les 2 endpoints existent, prennent des listes, sont protégés par la garde `IsComptabilise != 0`).
- **Un seul chemin de commit** : la validation passe **toujours** par l'aperçu (`handleValider` existant). Ne pas réintroduire de POST `/comptabiliser` direct depuis la liste.
- **Le bouton « Comptabiliser » de l'aperçu commite (obligatoire)** : il persiste la comptabilisation des lignes affichées. Ne pas le transformer en simple bouton de navigation/prévisualisation.
- **Périmètre strict = l'aperçu affiché (obligatoire)** : le commit porte **exactement** sur `apercus.map(a => a.id)` — **uniquement** les règlements visibles dans l'aperçu, **jamais** l'ensemble des non-comptabilisés. Exemple : 2000 non comptabilisés, aperçu d'une caisse = 10 lignes → le bouton comptabilise **ces 10**, pas les 2000. Interdit d'introduire un appel « comptabiliser tout ce qui n'est pas comptabilisé ». (Comportement déjà correct en [ApercuComptabilisation.tsx:255](../gocom-web/src/ApercuComptabilisation.tsx#L255) — à **préserver**.)
- Conserver la garde `disabled={hasErrors}` de l'aperçu ([ApercuComptabilisation.tsx:249,418](../gocom-web/src/ApercuComptabilisation.tsx#L418)) : un déséquilibre / compte manquant reste bloquant.
- Ne pas dupliquer la logique de mapping des écritures : réutiliser celle de `handleSimuler`.

## Risques / dépendances
- **Irréversibilité** : une fois `IsComptabilise=1`, la garde bloque tout re-run — **pas de dé-comptabilisation**. « Tester » = définitif sur ce règlement → **utiliser un règlement de test**, pas un vrai. (Ce risque est inhérent à la compta, pas introduit par cette TASK.)
- **MSDTC / 2 machines** ([mémoire compta-msdtc-lab-2machines]) : la compta ouvre 2 bases dans un seul `TransactionScope` → en lab 2 machines hors-domaine, hang à l'ACK et `DocNumero` NULL. **Indépendant du nombre de règlements** : 1 seul ne le supprime pas. À vérifier avant test (API + SQL co-localisés ou en domaine = OK).
- **Régression écran dédié** : la prop `preselection` doit rester **optionnelle** — l'entrée par filtres (sidebar) ne doit rien perdre. Point de vigilance à la revue.

## Checklist VALIDATION (à remplir dans VERIFY/)
- [ ] Build front OK
- [ ] Depuis la liste, sélection d'**un seul** règlement non comptabilisé → bascule sur l'écran d'aperçu, simulation de **ce seul** règlement affichée
- [ ] Sélection de **N** règlements → aperçu des N (mêmes lignes, aucun règlement en trop/en moins)
- [ ] **Le bouton « Comptabiliser » de l'aperçu lance réellement la compta** → `POST /reglements/comptabiliser` sur les IDs affichés → persistance (`IsComptabilise=1`) → toast succès + retour liste rafraîchie
- [ ] **Périmètre strict** : filtrer une caisse (ex. 10 lignes) alors que 2000 sont non comptabilisés → le commit ne touche **que les 10 affichés** ; les autres restent non comptabilisés (vérifié en base)
- [ ] Garde `hasErrors` toujours active (bouton « Comptabiliser » désactivé si compte manquant / déséquilibre)
- [ ] Écran dédié (sidebar, par filtres) **inchangé** : simulation + validation fonctionnent comme avant (prop `preselection` absente)
- [ ] `handleSubmitComptabilisation` (POST direct aveugle) **supprimé** ; plus aucun chemin de commit sans aperçu
- [ ] Un règlement déjà comptabilisé n'est pas sélectionnable en liste (garde `isComptabilise === 0`)
