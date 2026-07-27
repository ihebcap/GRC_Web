# TASK-XXX — <Titre>

- **Priorité** : 🔴 Bloquant | 🟠 Majeur | 🟡 Mineur
- **Domaine** : Sécurité | Correction | Performance | Architecture
- **Statut** : TODO
- **Dépend de** : —

## Contexte
Pourquoi cette tâche existe (référence au fichier/ligne concerné).

## Problème constaté
Description précise du défaut actuel.

## Objectif
Résultat attendu, mesurable.

## Fichiers concernés
- `chemin/fichier.cs`

## Étapes d'implémentation
1. ...

## Contraintes
- Ne jamais bypasser une règle de sécurité ou une DLL métier GRC.
- Respecter la Clean Architecture (Domain ← Application ← Infrastructure/API).
- Si la tâche introduit ou modifie une grille de données tabulaires : respecter
  `ARCHITECTURE.md` § Grilles de données (réutiliser `ExcelFilter.tsx` + pattern colonnes,
  pas de nouveau composant inventé).

## Checklist VALIDATION (à remplir dans VERIFY/)
- [ ] Build OK
- [ ] Comportement vérifié end-to-end
- [ ] Aucun credential/secret en dur introduit
- [ ] Aucune dette technique silencieuse
- [ ] Cohérent avec l'architecture
