# TASK-006 — Supprimer les catch silencieux à l'import (traçabilité des lignes rejetées)

- **Priorité** : 🟠 Majeur
- **Domaine** : Correction
- **Statut** : TODO
- **Dépend de** : TASK-005

## Contexte
Dans le parseur Excel, chaque ligne est entourée d'un `try { ... } catch { /* Ignore invalid rows */ }`. Le filtre date de `Program.cs` contient aussi un `catch {}`.

## Problème constaté
Pour un outil **comptable**, ignorer silencieusement des lignes est dangereux : une erreur de format ou de mapping fait disparaître des encaissements sans alerte, faussant le rapprochement.

## Objectif
Aucune perte de donnée muette : chaque ligne rejetée est comptée et remontée à l'utilisateur.

## Fichiers concernés
- `GRC.Application/Services/ReleveBancaireImportService.cs`
- `GRC.API/Controllers/ReleveBancaireController.cs` (réponse d'upload)

## Étapes d'implémentation
1. Remplacer `catch {}` par une collecte structurée : `List<LigneRejetee>` (n° ligne Excel, raison).
2. Enrichir le retour de `ParserFichierExcel` avec le compte importé + les lignes rejetées.
3. Le endpoint `upload` renvoie `lignesImportees`, `lignesRejetees` et le détail.
4. Distinguer « ligne vide/hors périmètre » (ignorée normalement) d'une « ligne en erreur » (à signaler).

## Contraintes
- Ne pas faire échouer tout l'import pour une ligne ; mais toujours rendre le rejet visible.

## Checklist VALIDATION (à remplir dans VERIFY/)
- [ ] Build OK
- [ ] Fichier avec lignes invalides → nombre + raisons remontés
- [ ] Aucune ligne perdue silencieusement
- [ ] Cohérent avec l'architecture
