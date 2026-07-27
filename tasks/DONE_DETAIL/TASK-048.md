# TASK-048 — Collision `IEC_ECNO` en comptabilisation : la DLL Sage n'est pas thread-safe

- **Priorité** : 🔴 Fonctionnel majeur (règlements perdus en comptabilisation, statut trompeur)
- **Domaine** : Backend (Infrastructure)
- **Dépend de** : —

## Contexte

Erreur remontée en comptabilisation d'un lot (2026-07-10 17:54, `reglementId=44879`) :

```
System.Data.SqlClient.SqlException (2627) : Violation de la contrainte UNIQUE KEY « IEC_ECNO ».
Impossible d'insérer une clé en double dans l'objet « dbo.F_ECRITUREC ». Valeur de clé dupliquée : (292497).
  at SageCompta.v9.Dapper.Repositories.EcritureComptableRepository.Create(...)
  at SageCompta.Core.ErpCompta.Comptabiliser(...)
  at ...ComptabilizerReglement.Comptabiliser(...)
  at GRC.Infrastructure.Services.ReglementService...<Comptabiliser>b__0(Int32 id) : ligne 351
```

Sortie du lot : `successCount = 1, errorCount = 2` — **deux échecs pointent la même valeur dupliquée `292497`**.

### Cause racine

La comptabilisation itère les règlements en **`Parallel.ForEach` avec `MaxDegreeOfParallelism = 10`** — [ReglementService.cs:304](../GRC.Infrastructure/Services/ReglementService.cs#L304).

La DLL Sage (`EcritureComptableRepository.Create`) **alloue elle-même le numéro d'écriture `IEC_ECNO`** (lecture du prochain n° puis INSERT), **sans verrou**. Sous parallélisme, plusieurs threads lisent le même « prochain n° » et collisionnent sur la contrainte UNIQUE : le thread gagnant insère `292497`, les deux autres échouent sur la même valeur.

→ La DLL `SageCompta` **n'est pas thread-safe** sur l'allocation du n° d'écriture. Le `Parallel.ForEach` viole cette contrainte implicite.

### Précisions

- **Sans lien avec TASK-036** : le décorateur `ErpComptaPieceDecorator` n'intercepte que `GetNextNumero` (n° de **pièce**), pas l'allocation interne de `IEC_ECNO` par la DLL — [ErpComptaPieceDecorator.cs:51](../GRC.Infrastructure/Tresorerie/ErpComptaPieceDecorator.cs#L51).
- **Fragilité cumulée** : la compta écrit dans 2 bases sous un `TransactionScope` → MSDTC (cf. mémoire `compta-msdtc-lab-2machines`). Le parallélisme aggrave cette fragilité sans bénéfice métier réel (un lot de règlements ne justifie pas 10 threads).

## Objectif

Éliminer la collision `IEC_ECNO` en respectant la contrainte de non-réentrance de la DLL Sage : **sérialiser l'appel à la comptabilisation**.

## Fichiers concernés

- `GRC.Infrastructure/Services/ReglementService.cs` — méthode `Comptabiliser` (l.292 à l.400), boucle l.312.

## Étapes d'implémentation

1. **Sérialiser la comptabilisation** (option retenue) :
   - Remplacer `MaxDegreeOfParallelism = 10` par `1` — [ReglementService.cs:304](../GRC.Infrastructure/Services/ReglementService.cs#L304) — **ou** remplacer le `Parallel.ForEach` par un `foreach` séquentiel simple.
   - Conserver à l'identique : gardes (`IsComptabilise != 0`), gestion `successCount`/`errorCount`, `docNumeroWarnings`, positionnement/reset de `ComptaPieceContext.ForcedPiece`.
2. **Si l'on veut garder le parallélisme sur les phases hors-DLL** (non recommandé — plus complexe pour un gain nul ici) : encadrer **uniquement** `comptabilizer.Comptabiliser(reg, ecritures)` (l.351) par un verrou global (`SemaphoreSlim(1,1)` statique ou `lock`). À ne faire que si un besoin de perf est démontré.

## Contraintes

- **Ne pas modifier la DLL Sage** ni contourner son allocation de `IEC_ECNO`.
- **Ne pas** générer le n° d'écriture côté GRC (INSERT brut / MAX+1) : c'est un bypass de DLL métier, interdit.
- Conserver le comportement transactionnel existant (aucune régression sur le commit compta / DocNumero post-compta).
- Respecter la Clean Architecture (Domain ← Application ← Infrastructure/API).

## Risques / dépendances

- **Perf** : la sérialisation allonge le temps d'un gros lot. Acceptable — le curseur projet est la justesse comptable, pas le débit. À surveiller sur les très gros lots ; si nécessaire, envisager un traitement asynchrone en tâche de fond (hors scope de cette TASK).
- **Idempotence** : vérifier qu'un règlement échoué reste `IsComptabilise = 0` (re-run possible) — la garde l.321 le suppose déjà.
- Interaction MSDTC (mémoire `compta-msdtc-lab-2machines`) : la sérialisation réduit aussi la pression sur le coordinateur de transactions.

## Checklist VALIDATION — APPROVE 2026-07-14 (voir CHANGELOG.md / DONE.md)

- [x] Build back OK (0 erreur)
- [x] Comptabilisation d'un lot ≥ 3 règlements éligibles : `successCount` = nombre de règlements, `errorCount = 0`, aucune `SqlException 2627 IEC_ECNO` — rejoué réellement (`MV_Id` 48337/48338/48339) : `successCount=3, errorCount=0`
- [x] Chaque écriture obtient un `IEC_ECNO` distinct et croissant — confirmé en base : `EC_No` 289671→289676
- [x] Gardes conservées : règlement déjà comptabilisé (`IsComptabilise != 0`) ignoré, non recompté en erreur
- [x] `ComptaPieceContext.ForcedPiece` toujours remis à `null` après chaque règlement (aucune fuite de pièce forcée entre règlements)
- [x] `docNumeroWarnings` toujours remontés sans faire basculer la compta en erreur
- [x] Règlement en échec reste `IsComptabilise = 0` (re-run possible)
