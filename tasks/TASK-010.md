# TASK-010 — Migrer System.Data.SqlClient → Microsoft.Data.SqlClient

- **Priorité** : 🟡 Mineur
- **Domaine** : Architecture / Maintenance
- **Statut** : TODO
- **Dépend de** : TASK-001

## Contexte
Le code utilise `System.Data.SqlClient` (`ReleveBancaireRepository.cs`, `Program.cs`).

## Problème constaté
`System.Data.SqlClient` est déprécié et ne reçoit plus que des correctifs de sécurité critiques. Le package recommandé est `Microsoft.Data.SqlClient`.

## Objectif
Tout l'accès SQL passe par `Microsoft.Data.SqlClient`.

## Fichiers concernés
- `GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs`
- `GRC.API/Program.cs`
- `.csproj` concernés (référence de package)

## Étapes d'implémentation
1. Ajouter le package `Microsoft.Data.SqlClient`, retirer `System.Data.SqlClient`.
2. Remplacer les `using`/`new SqlConnection`.
3. Vérifier les options de chaîne de connexion (`Encrypt`/`TrustServerCertificate` : comportement par défaut différent entre les deux libs).

## Contraintes
- À coordonner avec TASK-001 (centralisation de la chaîne de connexion).

## Checklist VALIDATION (à remplir dans VERIFY/)
- [ ] Build OK
- [ ] Plus aucune référence à `System.Data.SqlClient`
- [ ] Connexion SQL fonctionnelle (Encrypt/TrustServerCertificate corrects)
- [ ] Cohérent avec l'architecture
