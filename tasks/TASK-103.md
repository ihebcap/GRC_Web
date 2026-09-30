# TASK-103 — Comptabilisation : un règlement annulé n'est jamais listé ni comptabilisable (écran Comptabilisation)

- **Priorité** : 🟠 Majeur
- **Domaine** : Correction (front, 1 ligne + vérification backend sans code)
- **Statut** : TODO
- **Dépend de** : —
- **Lot « règlements annulés »** : TASK-098 (rapprochement) · TASK-103 (comptabilisation) · TASK-104 (liste)

## Contexte
Règle PO (2026-09-30) : un règlement annulé n'apparaît que dans la liste des règlements (avec un flag,
TASK-104) ; il ne doit ni être rapproché (TASK-098) ni **apparaître dans l'écran de comptabilisation ni
être comptabilisé**.

Le **backend est déjà sûr** : la garde TASK-088 (`VerifierComptabilisable`,
`ReglementService.cs:721-725`) refuse un annulé dans l'aperçu (`:1391`) comme dans la compta réelle
(`:503`). Le défaut est dans **l'écran** : il charge les annulés, puis s'en trouve bloqué.

## Problème constaté
1. `handleSimuler` (`ApercuComptabilisation.tsx:205-217`) appelle `GET /reglements` sans `annule`.
   Le filtre `isComptabilise === 0` (`:219`) ne les écarte pas (un annulé n'est pas comptabilisé).
2. Avec `includeEspeceEtAutreSiPointeFiltre: true`, les règlements de type 0 (Espèce) et 4 (Autre) sont
   **toujours inclus, pointés ou non** (`ReglementService.cs:112-114`) : tout annulé Espèce/Autre de la
   période est donc chargé.
3. Chaque annulé revient de l'aperçu en `hasError` (« règlement annulé »). Or `hasErrors` désactive le
   bouton « Comptabiliser » pour **tout le lot** (`ApercuComptabilisation.tsx:302-305` et `:616`).
   Conséquence : **un seul annulé dans la période bloque la comptabilisation de tous les autres règlements.**

Le cas de la sélection venant de la liste (`handleSimulerPreselection`, `:257`) est traité dans
**TASK-104** (les annulés ne sont plus sélectionnables) : `PreselectionItem` ne porte pas `isAnnule`,
le filtre n'a pas sa place ici.

## Objectif
Aucun règlement `IsAnnule = true` dans les règlements chargés par l'écran Comptabilisation ; l'aperçu
ne contient plus de ligne « Non comptabilisable » due à un annulé ; le bouton « Comptabiliser » n'est
plus bloqué par eux. La garde TASK-088 reste en place (filet de sécurité).

## Étapes d'implémentation
1. `handleSimuler` : ajouter `annule: false` aux `params` du `GET /reglements` (paramètre déjà supporté,
   `ReglementController.cs:45` ; même mécanique que `App.tsx:557`).
   *Choix assumé* : paramètre explicite plutôt que règle serveur, car l'écran n'a pas de drapeau
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
      le bouton est bloqué (capture/réponse), **après** l'annulé est absent et le bouton actif
- [ ] L'annulé n'apparaît plus dans l'aperçu (ni en « Non comptabilisable »)
- [ ] Appel API direct `apercu-comptabilisation` et `comptabiliser` avec l'id d'un annulé : refus
      « annulé », aucune écriture créée (TASK-088 inchangée)
- [ ] Non-régression : nombre de règlements listés = avant − nombre d'annulés ; filtres pointé/dates
      inchangés
- [ ] Aucun credential/secret en dur introduit
- [ ] Aucune dette technique silencieuse
- [ ] Cohérent avec l'architecture
