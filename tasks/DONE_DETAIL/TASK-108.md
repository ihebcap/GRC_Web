# TASK-108 — Règlement espèce : le tableau Résultat disparaît juste après la génération

- **Priorité** : 🟠 Majeur
- **Domaine** : Correction
- **Statut** : DONE (APPROVE 2026-10-01)
- **Dépend de** : — (indépendante de TASK-107, à traiter en priorité)

## Contexte
Écran « Règlement espèce » (TASK-059). Constaté par lecture du code lors de l'analyse de TASK-107 (2026-10-01), reproduit à l'exécution via harnais E2E Playwright (`node e2e_task108.cjs reproduce`).

## Problème constaté
Dans `gocom-web/src/ReglementGenerationEspece.tsx`, après un lot, `setResultats(combined)` (l.~276) est suivi de `chargerFactures()` (l.~284), dont les premières lignes font `setResultats(null)` et `setChecked({})` (l.134-135). Le tableau « Résultat — 1 règlement par facture » est donc effacé aussitôt : l'utilisateur ne voit plus le détail des erreurs par facture après un lot partiel (pas de `TransactionScope` global, cf. TASK-059), seul un toast subsiste. Risque comptable : régénération ou ressaisie en doublon. Chaque génération redéclenche aussi un GET complet (10,7 Mo).

## Objectif
Après une génération, le tableau Résultat reste affiché (succès et erreurs par facture) jusqu'à ce que l'utilisateur lance une nouvelle action ; la liste des factures est rafraîchie sans effacer les résultats.

## Fichiers concernés
- `gocom-web/src/ReglementGenerationEspece.tsx` (`chargerFactures`, `handleGenerer`)

## Étapes d'implémentation
1. **Reproduire** d'abord (lot avec au moins une erreur) et consigner la capture.
2. Séparer le rechargement post-génération du chargement initial : ne pas réinitialiser `resultats` dans le rechargement post-génération ; réinitialiser `checked` seulement pour les factures traitées avec succès.
3. Préférer retirer/mettre à jour localement les factures réglées plutôt qu'un refetch complet (cohérent avec le cache serveur de TASK-107 si livré).

## Contraintes
- Ne jamais bypasser une règle de sécurité ou une DLL métier GRC ; ne pas modifier le back.
- Ne pas masquer d'erreur : les échecs par facture doivent rester lisibles.

## Checklist VALIDATION (à remplir dans VERIFY/)
- [x] Build OK
- [x] Bug reproduit avant correctif (capture), disparu après
- [x] Lot partiel : erreurs par facture visibles après génération
- [x] Factures en échec restent cochées/listées, factures réglées disparaissent de la liste
- [x] Aucun credential/secret en dur introduit
- [x] Aucune dette technique silencieuse
- [x] Cohérent avec l'architecture
