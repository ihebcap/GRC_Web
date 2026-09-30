# TASK-098 — Rapprochement : ne plus afficher les règlements annulés dans la grille « Règlements GRC »

- **Priorité** : 🟠 Majeur
- **Domaine** : Correction (front, 1 ligne + vérif backend)
- **Statut** : TODO
- **Dépend de** : —

## Contexte
Demande PO (2026-09-30). Sur l'écran Rapprochement bancaire, le bloc du bas (« Règlements GRC »)
liste encore les règlements annulés. Un règlement annulé n'a aucune raison d'être rapproché.

## Problème constaté
`fetchReglementsGrc` (`RapprochementBancaire.tsx` ~l.471-506) appelle
`/reglements?...&pointe=false&eligibleRappBancaire=true{dateParams}` **sans** paramètre `annule`.
Le backend n'exclut donc pas les annulés (`ReglementService.cs:132-135` ne filtre que si `isAnnule`
est fourni ; `EstEligibleRappBancaire` ne regarde que le type et `IsRemis`).

## Objectif
Aucun règlement `IsAnnule = true` dans la grille GRC du Rapprochement, quel que soit le filtre
utilisateur. La colonne « Annulé » (si affichée) ne doit plus pouvoir proposer « OUI ».

## Fichiers concernés
- `gocom-web/src/RapprochementBancaire.tsx` (`fetchReglementsGrc`, colonne `annule` dans `getGrcFilterOptions`)
- `GRC.API/Controllers/ReglementController.cs:26` (paramètre `annule` — déjà existant, lecture seule)

## Étapes d'implémentation
1. Ajouter `&annule=false` à l'URL de `fetchReglementsGrc` (paramètre déjà supporté par l'API,
   même mécanique que `App.tsx:557`).
2. Vérifier que l'auto-rapprochement (`/auto-reconcile`, qui relit les règlements côté serveur)
   n'inclut pas non plus les annulés : lire `AutoReconciliationEngine` / la requête d'entrée.
   **Si les annulés y sont inclus, le signaler dans le VERIFY et corriger** (un annulé ne doit
   jamais être proposé ni réservé).
3. Vérifier `reserve` / `reserve-batch` : refus d'un règlement annulé (garde défensive). Si absente,
   le signaler dans le VERIFY (ne pas corriger sans accord si cela touche plus de 5 lignes).

## Contraintes
- Ne jamais bypasser une règle de sécurité ou une DLL métier GRC.
- Respecter la Clean Architecture.
- Aucun changement du moteur strict 1=1 (son refus de deviner est voulu).

## Checklist VALIDATION (à remplir dans VERIFY/, avec preuve datée par critère)
- [ ] Build OK (back + front, 0 erreur)
- [ ] Un règlement annulé (repéré en base de test) n'apparaît plus dans la grille
- [ ] Auto-rapprochement : aucun annulé proposé (preuve : lecture de code + test)
- [ ] Aucun credential/secret en dur introduit
- [ ] Aucune dette technique silencieuse
- [ ] Cohérent avec l'architecture
