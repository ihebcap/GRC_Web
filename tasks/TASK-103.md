# TASK-103 — Comptabilisation : les règlements annulés ne sont jamais proposés (écran Comptabilisation)

- **Priorité** : 🟠 Majeur
- **Domaine** : Correction (front, 1 ligne + vérification backend sans code)
- **Statut** : TODO
- **Dépend de** : —
- **Lot « règlements annulés »** : TASK-098 (rapprochement) · TASK-103 (comptabilisation) · TASK-104 (liste) · TASK-105 (annulation interdite si réservé/pointé)

## Contexte
Règle PO (2026-09-30) : **l'annulation d'un règlement vaut suppression.** Un règlement annulé n'est
visible que dans la liste des règlements (avec un flag, TASK-104). Il n'est **jamais proposé** pour la
comptabilisation, ni pour le rapprochement (TASK-098).

## Problème constaté
L'écran Comptabilisation **propose aujourd'hui des règlements annulés** :
1. `handleSimuler` (`ApercuComptabilisation.tsx:205-217`) appelle `GET /reglements` sans `annule`. Le
   filtre `isComptabilise === 0` (`:219`) ne les écarte pas (un annulé n'est pas comptabilisé).
2. Avec `includeEspeceEtAutreSiPointeFiltre: true`, les règlements de type 0 (Espèce) et 4 (Autre) sont
   **toujours inclus, pointés ou non** (`ReglementService.cs:112-114`) : tout annulé Espèce/Autre de la
   période est donc proposé.
3. Ils sont envoyés à l'aperçu, qui les affiche « Non comptabilisable » : c'est la garde TASK-088
   (`ReglementService.cs:721-725`, appelée en `:1391` et `:503`) qui les arrête **après coup**. Elle
   reste un filet de sécurité (rien de faux n'est écrit), mais un annulé n'a pas à être proposé.
   *Symptôme secondaire, pas la raison d'être de la TASK* : leur présence désactive « Comptabiliser »
   pour tout le lot (`ApercuComptabilisation.tsx:302-305`, `:616`).

La sélection venue de la liste (`handleSimulerPreselection`, `:257`) est couverte par TASK-104 (les
annulés sont masqués en mode Comptabiliser).

## Objectif
Aucun règlement annulé chargé ni affiché par l'écran Comptabilisation (ni dans la liste, ni dans
l'aperçu). La garde TASK-088 reste en place.

## Étapes d'implémentation
1. `handleSimuler` : ajouter `annule: false` aux `params` du `GET /reglements` (paramètre déjà supporté,
   `ReglementController.cs:45` ; même mécanique que `App.tsx:557`).
   *Choix assumé* : paramètre explicite plutôt que règle serveur, car cet écran n'a pas de drapeau
   d'éligibilité dédié (le coupler à `includeEspeceEtAutreSiPointeFiltre` serait implicite) et
   l'opposabilité est déjà assurée côté serveur par TASK-088.
2. **Vérification sans code** : appeler directement `POST /reglements/apercu-comptabilisation` et
   `POST /reglements/comptabiliser` avec l'id d'un annulé → refus « annulé », rien de comptabilisé.
   Si ce n'est pas le cas, **le signaler** (ne pas corriger sans accord).

## Contraintes
- Ne pas retirer ni modifier la garde TASK-088, ni le contrat `HasError`/blocage global de TASK-073.
- Ne jamais bypasser une règle de sécurité ou une DLL métier GRC.
- Ne pas modifier le backend (aucun code attendu dans cette TASK).

## Fichiers concernés
- `gocom-web/src/ApercuComptabilisation.tsx` (`handleSimuler`)
- `GRC.Infrastructure/Services/ReglementService.cs` (lecture seule : `:721`, `:503`, `:1391`)

## Checklist VALIDATION (à remplir dans VERIFY/, avec preuve datée par critère)
- [ ] Build front OK (0 erreur)
- [ ] Période contenant ≥ 1 annulé Espèce **et** ≥ 1 règlement comptabilisable : **avant** le correctif
      l'annulé est proposé (« Non comptabilisable ») et le bouton bloqué ; **après** il est absent de
      l'aperçu et le bouton est actif (preuve : capture ou réponse API, datée)
- [ ] Appel API direct `apercu-comptabilisation` et `comptabiliser` avec l'id d'un annulé : refus
      « annulé », aucune écriture créée (TASK-088 inchangée)
- [ ] Non-régression : nombre de règlements listés = avant − nombre d'annulés ; filtres pointé/dates
      inchangés
- [ ] Aucun credential/secret en dur introduit
- [ ] Aucune dette technique silencieuse
- [ ] Cohérent avec l'architecture
