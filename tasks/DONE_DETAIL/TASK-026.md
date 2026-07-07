# TASK-026 — Écran rapprochement : n'afficher que les relevés contenant des lignes non rapprochées

- **Priorité** : 🟡 Mineur (pertinence UX — éviter les relevés « morts » dans le déroulant)
- **Domaine** : Backend (Repository + API) + petite modif Frontend
- **Statut** : DONE
- **Dépend de** : — (mais **interfère avec TASK-024/025** — voir Risques)

## Contexte
Sur l'écran de rapprochement ([RapprochementBancaire.tsx](../gocom-web/src/RapprochementBancaire.tsx)), le déroulant « Relevé associé… » est alimenté par `GET /api/relevebancaire?banqueId=X` → [`GetEntetesByBanqueAsync`](../GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs#L95). La requête actuelle renvoie **tous** les relevés de la banque, sans filtre :

```sql
SELECT * FROM [dbo].[RAPP_ReleveBancaire_Entete] WHERE BanqueId = @BanqueId ORDER BY DateImport DESC
```

Conséquence : un relevé dont toutes les lignes sont déjà rapprochées (validées) reste proposé, alors qu'il n'y a plus rien à y faire.

Décision PO (2026-07-07) : **sur l'écran de rapprochement**, ne lister que les relevés ayant encore au moins une ligne non rapprochée. Une ligne **réservée** compte comme non rapprochée (réservation ≠ rapprochement final — cf. [[rapprochement-reservation-2-phases]]) : le critère « non rapproché » est `DateValidation IS NULL`, jamais la présence d'un `Lettrage`/`ReservePar_UserId`.

⚠️ **Contrainte structurante** : ce même endpoint est aussi consommé par l'écran **« Gestion des Relevés Bancaires »** ([RelevesBancaires.tsx:45](../gocom-web/src/RelevesBancaires.tsx#L45)), qui — via TASK-025 — doit au contraire pouvoir lister **tous** les relevés (y compris entièrement traités) pour en consulter l'état. Le filtre ne doit donc **pas** être appliqué globalement : il doit être **opt-in** et n'affecter que l'écran rapprochement.

## Objectif
Permettre à l'écran de rapprochement de ne recevoir que les relevés ayant ≥ 1 ligne restant à rapprocher, **sans** changer le comportement par défaut de l'endpoint (pour ne pas casser « Gestion des Relevés Bancaires »).

## Fichiers concernés
- `GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs` — `GetEntetesByBanqueAsync` (nouveau paramètre)
- `GRC.API/Controllers/ReleveBancaireController.cs` — action `GetEntetes` (nouveau `[FromQuery]`)
- `gocom-web/src/RapprochementBancaire.tsx` — ajout du paramètre à l'appel du déroulant ([:361](../gocom-web/src/RapprochementBancaire.tsx#L361))

## Étapes d'implémentation

### 1. Repository — filtre conditionnel (défaut = tout renvoyer)
Ajouter un paramètre `bool nonRapprochesSeulement = false` à `GetEntetesByBanqueAsync`. Quand `false`, comportement **strictement inchangé**. Quand `true`, ajouter un `EXISTS` sur les lignes encaissement non validées :

```sql
SELECT e.*
FROM [dbo].[RAPP_ReleveBancaire_Entete] e
WHERE e.BanqueId = @BanqueId
  AND (@NonRapprochesSeulement = 0 OR EXISTS (
      SELECT 1
      FROM [dbo].[RAPP_ReleveBancaire_Ligne] l
      WHERE l.ReleveBancaireEnteteId = e.Id
        AND l.DateValidation IS NULL
        AND l.Credit > 0
  ))
ORDER BY e.DateImport DESC
```

- `DateValidation IS NULL` : cohérent avec [`GetAllLignesExcelAsync`](../GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs#L106) — les lignes réservées (non encore validées) restent visibles → le relevé doit rester listé.
- `Credit > 0` : l'écran de rapprochement ne travaille que sur les encaissements ([RapprochementBancaire.tsx:763](../gocom-web/src/RapprochementBancaire.tsx#L763)). Sans ce prédicat, un relevé ne contenant que des débits non validés apparaîtrait alors qu'il s'ouvrirait vide. **Point à confirmer PO** si le déroulant doit un jour servir aussi aux décaissements.

### 2. Controller — exposer le paramètre (optionnel, défaut préservé)
```csharp
[HttpGet]
public async Task<IActionResult> GetEntetes([FromQuery] int banqueId, [FromQuery] bool nonRapprochesSeulement = false)
{
    var entetes = await _releveRepository.GetEntetesByBanqueAsync(banqueId, nonRapprochesSeulement);
    return Ok(entetes);
}
```
Le défaut `false` garantit qu'un appel existant sans le paramètre (dont [RelevesBancaires.tsx:45](../gocom-web/src/RelevesBancaires.tsx#L45)) reste inchangé.

### 3. Front rapprochement — activer le filtre
Dans [RapprochementBancaire.tsx:361](../gocom-web/src/RapprochementBancaire.tsx#L361), ajouter `&nonRapprochesSeulement=true` à l'URL du déroulant. **Ne pas** toucher l'appel de `RelevesBancaires.tsx` (il doit continuer à recevoir tous les relevés).

## Contraintes
- **Aucune modification du schéma** ni des DLL métier `Tresorerie.*`.
- Filtre purement en lecture (SELECT) ; aucune écriture.
- **Comportement par défaut inchangé** : `nonRapprochesSeulement=false` renvoie exactement la liste actuelle (non-régression de « Gestion des Relevés Bancaires » / TASK-025).
- Forme du DTO retourné inchangée (toujours la liste d'entêtes) — seul le contenu est filtré quand le flag est actif.
- Respecter la Clean Architecture (logique confinée Infrastructure ; le flag transite en paramètre, pas de SQL au front).

## Risques / dépendances
- **Interférence confirmée avec TASK-025** : `RelevesBancaires.tsx` et `RapprochementBancaire.tsx` appellent le **même** `GET /api/relevebancaire?banqueId=`. Un filtre global casserait la consultation des relevés traités (TASK-025). → **résolu** par l'approche opt-in de cette tâche : ne jamais rendre le filtre global.
- **TASK-024** ajoute une méthode **distincte** (`GetEtatRapprochementAsync`) ; elle n'est pas impactée. Vérifier néanmoins qu'aucune autre modif en cours ne change la signature de `GetEntetesByBanqueAsync` en parallèle (conflit de merge possible si TASK-024/025 touchent le même fichier repo).
- Effet de bord voulu côté rapprochement : après validation de la dernière ligne encaissement d'un relevé, celui-ci disparaît du déroulant au prochain chargement. Comportement attendu (filtrage d'affichage, aucune perte de données).

## Checklist VALIDATION (à remplir dans VERIFY/)
- [ ] Build OK
- [ ] Écran **rapprochement** : un relevé avec ≥ 1 ligne encaissement `DateValidation IS NULL` apparaît dans le déroulant
- [ ] Écran **rapprochement** : un relevé dont toutes les lignes encaissement sont validées **n'apparaît plus**
- [ ] Écran **rapprochement** : un relevé avec des lignes **réservées** (non validées) apparaît toujours (réservation ≠ rapprochement)
- [ ] Écran **« Gestion des Relevés Bancaires »** : **tous** les relevés restent listés (appel sans le flag, comportement inchangé)
- [ ] Aucune régression sur le chargement des lignes d'un relevé sélectionné
- [ ] Aucune écriture base, aucune modif de schéma
