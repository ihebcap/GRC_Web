# TASK-004 — Validation du rapprochement via les DLLs GRC (supprimer le bypass SQL brut)

- **Priorité** : 🔴 Bloquant
- **Domaine** : Sécurité / Correction métier
- **Statut** : TODO
- **Dépend de** : —

## Contexte
`ReleveBancaireRepository.SauvegarderValidationAsync` (`GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs:119-160`) exécute un `UPDATE [dbo].[RT_MOUVEMENT] SET MV_Point=1, MV_Info1=@CodeExcel, N_Extrait=@CodeExcel` en SQL brut, avec un nom de table commenté « -- Ou le nom exact de votre table GRC ».

## Problème constaté
- `analyse_rapprochement.md` §Étape 5 impose de passer par **les DLLs de rapprochement GRC** pour verrouiller la base et respecter la relation 1-à-1. L'`UPDATE` brut **contourne les règles métier des DLLs** → bypass interdit par le CLAUDE.md.
- Le nom de la table est incertain (deviné).
- Incohérence : `/api/rapprochement` (Program.cs:577) passe correctement par `repo.Update(reg)` (DLL), alors que `/api/relevebancaire/validate` écrit en SQL direct. **Deux chemins d'écriture divergents pour la même opération.**

## Objectif
Un seul chemin de validation, passant par les repositories/DLLs GRC (`Tresorerie.Dapper.Repositories.ReglementClientRepository` + services métier), garantissant le verrou 1-à-1.

## Fichiers concernés
- `GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs`
- `GRC.API/Controllers/ReleveBancaireController.cs` (endpoint `validate`)

## Étapes d'implémentation
1. Remplacer l'`UPDATE RT_MOUVEMENT` brut par l'appel aux DLLs GRC (comme `/api/rapprochement`) : charger le règlement, positionner `IsPointe`, `ExtraitNum`, `Info1`, puis `repo.Update`.
2. Conserver l'`UPDATE` de la table applicative `RAPP_ReleveBancaire_Ligne` (Lettrage + MV_ID) dans **la même transaction / unité de travail**.
3. Vérifier/garantir la contrainte 1-à-1 (une ligne relevé ↔ un règlement) avant écriture.
4. Supprimer le endpoint dupliqué ou factoriser les deux chemins en un seul service Application.

## Contraintes
- Interdiction absolue d'écrire en SQL brut sur les tables métier GRC pilotées par DLL.

## Checklist VALIDATION (à remplir dans VERIFY/)
- [ ] Build OK
- [ ] La validation passe exclusivement par les DLLs GRC
- [ ] Relation 1-à-1 vérifiée et non contournable
- [ ] Un seul chemin de code pour valider un rapprochement
- [ ] Rollback correct en cas d'échec partiel
