# TASK-007 — Lettrage séquentiel : reprise de l'index (éviter les collisions)

- **Priorité** : 🟠 Majeur
- **Domaine** : Correction
- **Statut** : TODO
- **Dépend de** : —

## Contexte
`AutoReconciliationEngine.CalculerPropositions` accepte un `startIndexLettrage` (défaut 1), mais le contrôleur `auto-reconcile` (`ReleveBancaireController.cs:236`) l'appelle **sans** passer d'index → toujours 1.

## Problème constaté
Un 2ᵉ passage d'auto-rapprochement sur un relevé déjà partiellement lettré régénère la séquence à partir de `A` → **collisions de lettrage** (deux paires différentes portant `A`, `B`…). Le générateur lui-même est correct (style colonnes Excel), c'est l'amorçage qui est faux.

## Objectif
Le lettrage proposé continue toujours après le dernier lettrage existant du relevé.

## Fichiers concernés
- `GRC.API/Controllers/ReleveBancaireController.cs`
- `GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs`
- `GRC.Application/Services/AutoReconciliationEngine.cs`

## Étapes d'implémentation
1. Ajouter une requête repo : dernier index/lettrage utilisé pour un `EnteteId` (convertir lettrage max → index, ou stocker un compteur).
2. Passer `startIndexLettrage = dernierIndex + 1` à `CalculerPropositions`.
3. Garantir l'unicité du lettrage par relevé (contrainte ou vérification avant persistance).

## Contraintes
- La reprise doit être cohérente avec les lettrages posés manuellement (« Lettrer » / « Délettrer », Phase 4).

## Checklist VALIDATION (à remplir dans VERIFY/)
- [ ] Build OK
- [ ] 2 passages successifs → aucune collision de lettrage
- [ ] Lettrages manuels pris en compte dans la reprise
- [ ] Cohérent avec l'architecture
