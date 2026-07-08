# TASK-034 — Validation rapprochement : dates du règlement alignées sur la DATE OPÉRATION du relevé (au lieu de la date valeur)

- **Priorité** : 🟠 Majeur
- **Domaine** : Correction / Métier comptable
- **Dépend de** : TASK-031 (même bloc de pose des dates dans `SauvegarderValidationAsync`)
- **Statut** : DONE

## Contexte
À la validation d'une paire (ligne relevé ↔ règlement GRC), le pointage du règlement client
via la DLL `Tresorerie` (`repo.Update(reg)`) renseigne aujourd'hui les dates à partir de la
**date valeur** de la ligne relevé — [ReleveBancaireRepository.cs:313-322](../GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs#L313-L322) :

```csharp
if (pair.DateValeur.HasValue)
{
    reg.DatePointage = pair.DateValeur.Value;                 // date rapprochement
    if (reg.IsComptabilise == EtatComptabilite.NonComptabilise)
        reg.ChangeDate(pair.DateValeur.Value);                // date règlement (MV_Date)
}
```

Le PO veut désormais que les dates du règlement soient calées sur la **date opération**
du relevé (colonne `RAPP_ReleveBancaire_Ligne.DateOperation`), **plus la date valeur**,
et que **la date échéance** soit également alignée.

## Problème constaté / besoin
1. **Mauvaise source** : les dates du règlement sont posées depuis `DateValeur` ; le besoin
   métier est la **date opération** du relevé.
2. **Date échéance non traitée** : `MV_DateEcheance` (propriété `ReglementClient.DateEcheance`)
   n'est jamais alignée aujourd'hui.

## Objectif
À la validation d'une paire, pour un **règlement client (domaine 0)**, en prenant comme source
la **date opération** de la ligne relevé (`DateOperation`) :

| Champ métier | Propriété DLL | Setter | Règle |
|---|---|---|---|
| date rapprochement | `DatePointage` | public | **Toujours** posée (marqueur de rapprochement, non comptable) |
| date règlement | `Date` (setter **privé**) → `ChangeDate()` | méthode | **Uniquement si `MV_Compta = 0`** (non comptabilisé) |
| date échéance | `DateEcheance` | public | **Uniquement si `MV_Compta = 0`** (non comptabilisé) |

Résultat mesurable : après validation web d'une paire **non comptabilisée**, `MV_Date`,
`MV_DatePointage` **et** `MV_DateEcheance` valent la **date opération** de la ligne relevé.
Un règlement **comptabilisé** conserve `MV_Date` **et** `MV_DateEcheance` d'origine ; seule
`MV_DatePointage` est posée.

## Décisions / hypothèses actées (PO)
- **Source = date opération**, remplace la date valeur pour les 3 champs.
- **Lecture serveur** : la `DateOperation` est lue **côté backend** dans
  `RAPP_ReleveBancaire_Ligne` par `ReleveLigneId` (table déjà interrogée pour le re-check de
  réservation) — **source unique fiable, aucune confiance à une date envoyée par le client**.
- **Garde comptabilisation étendue à l'échéance** : `DateEcheance` suit la **même garde** que
  `MV_Date` → modifiée **uniquement si `IsComptabilise == NonComptabilise`**. `DatePointage`
  reste posée sans garde (comportement existant, marqueur non comptable).
- **Hors périmètre** : le flux `POST /api/rapprochement` (`ReglementService.RapprocherManuel`,
  [ReglementService.cs:324-366](../GRC.Infrastructure/Services/ReglementService.cs#L324-L366))
  — rapprochement manuel depuis la grille règlements, **sans relevé**, date **saisie** par
  l'utilisateur : pas de notion de « date opération », non concerné.

## Faits DLL vérifiés (réflexion `Tresorerie.Core.dll`, `ReglementClient`)
- `Date` : setter **privé** → passer par `reg.ChangeDate(newDate)` (jamais `reg.Date = …`).
  `ChangeDate` **lève `InvalidOperationException`** si le règlement est pointé/comptabilisé/
  annulé/remis/affecté → **appeler AVANT `reg.IsPointe = true`** (invariant TASK-031).
- `DatePointage` : setter **public** simple, sans garde.
- `DateEcheance` : setter **public** simple, sans garde → assignation directe `reg.DateEcheance = …`.

## Fichiers concernés
- `GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs`
  - méthode `SauvegarderValidationAsync` : re-check réservation [274-289](../GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs#L274-L289) et bloc de pose des dates [313-322](../GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs#L313-L322).
  - DTO `ValidationPairDto` [405-412](../GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs#L405-L412).
- **Front : aucune modification requise** (la date n'est plus lue depuis le payload client).

## Étapes d'implémentation
> ⚠️ **ORDRE D'APPEL CRITIQUE** (invariant TASK-031) : `reg.ChangeDate(...)` doit rester
> appelé **AVANT** `reg.IsPointe = true`.

1. **Lire la date opération côté serveur.** Dans la boucle de re-check réservation
   ([272-289](../GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs#L272-L289)),
   étendre le `SELECT` pour ramener aussi `DateOperation` :
   ```sql
   SELECT ReservePar_UserId, DateOperation
   FROM [dbo].[RAPP_ReleveBancaire_Ligne]
   WHERE Id = @ReleveLigneId AND MV_ID = @GrcReglementId
   ```
   Récupérer la ligne (objet/record au lieu de `QueryFirstOrDefaultAsync<int?>`), conserver la
   vérification `ReservePar_UserId == userId`, et pour une paire valide stocker la date opération
   (p. ex. renseigner `pair.DateOperation` — voir étape 2).
2. **DTO** : ajouter `public DateTime? DateOperation { get; set; }` à `ValidationPairDto`
   (champ **rempli côté serveur**). La date envoyée par le client (`DateValeur`) n'est **plus lue**
   pour la pose des dates (la laisser dans le DTO ne gêne pas ; ne pas la réutiliser ici).
3. **Bloc de pose des dates** — remplacer [313-322](../GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs#L313-L322) par :
   ```csharp
   if (pair.DateOperation.HasValue)
   {
       var dateOp = pair.DateOperation.Value;

       // Date rapprochement : toujours (marqueur, non comptable)
       reg.DatePointage = dateOp;

       // Date règlement + date échéance : uniquement si NON comptabilisé (sécurité comptable)
       // ChangeDate AVANT IsPointe (setter Date privé + garde règlement pointé) — invariant TASK-031
       if (reg.IsComptabilise == global::Tresorerie.Core.Enum.EtatComptabilite.NonComptabilise)
       {
           reg.ChangeDate(dateOp);      // MV_Date
           reg.DateEcheance = dateOp;   // MV_DateEcheance (setter public)
       }
   }

   reg.IsPointe = true;
   reg.ExtraitNum  = pair.CodeExcel;
   reg.Info1       = pair.CodeExcel;
   reg.PieceNumero = pair.CodeExcel;   // inchangé (TASK-031)
   ```
4. Le pointage/n° pièce (`IsPointe`, `ExtraitNum`, `Info1`, `PieceNumero`) reste **inconditionnel**
   comme aujourd'hui (posé même si `DateOperation` est absente — cas théorique, l'import exige une
   date opération).
5. Commenter les deux règles (source = date opération relevé ; garde comptabilisation sur
   `MV_Date` **et** `MV_DateEcheance`) et rappeler l'ordre `ChangeDate` avant `IsPointe`.

## Contraintes
- **Interdit de toucher `MV_Date` ni `MV_DateEcheance` d'un règlement comptabilisé**
  (`IsComptabilise != NonComptabilise`) : cœur de la sécurité comptable de cette tâche.
- Écriture du règlement **exclusivement via la DLL `Tresorerie`** (`repo.Update`) — aucun `UPDATE`
  SQL brut sur `rt_mouvement`. Le `SELECT DateOperation` porte sur la table applicative
  `RAPP_ReleveBancaire_Ligne` (autorisé, lecture seule).
- Ne pas modifier le flux `RapprocherManuel` / `/api/rapprochement` (hors périmètre).
- Respecter la Clean Architecture (Domain ← Application ← Infrastructure/API).
- `ChangeDate` peut légitimement lever pour un règlement annulé/remis/affecté/remplacé : ces paires
  partent en échec propre via le `try/catch` existant — comportement métier attendu (à documenter
  dans le VERIFY, ce n'est pas un bug).

## Point à vérifier (à confirmer dans le VERIFY)
- Confirmer que `repo.Update(reg)` **persiste bien `MV_DateEcheance`** et qu'aucune entité
  d'échéancier séparée (`RT_ECHEANCE` / `EcheanceRepository`) n'a besoin d'être mise à jour pour un
  règlement client domaine 0. Si un échéancier lié existe et n'est pas synchronisé, le signaler
  (ne pas élargir le périmètre sans accord PO).

## Checklist VALIDATION (à remplir dans VERIFY/)
- [x] Build OK (backend)
- [x] `DateOperation` lue **côté serveur** depuis `RAPP_ReleveBancaire_Ligne` (pas depuis le payload client)
- [x] Paire **non comptabilisée** qui passe réellement (SuccessCount++) : `MV_Date`, `MV_DatePointage` **et** `MV_DateEcheance` = date opération de la ligne relevé
- [x] Paire **comptabilisée** : `MV_Date` **et** `MV_DateEcheance` **inchangées** ; `MV_DatePointage` = date opération
- [x] `ChangeDate` toujours appelé **avant** `IsPointe = true` (sinon `InvalidOperationException` systématique)
- [x] `ExtraitNum`, `Info1`, `PieceNumero`, `IsPointe` toujours renseignés (pas de régression TASK-031)
- [x] Flux `/api/rapprochement` (`RapprocherManuel`) **non modifié**
- [x] Point « échéancier séparé » tranché (persistance `MV_DateEcheance` confirmée) - La persistance est assurée par `repo.Update(reg)` de la DLL `Tresorerie`.
- [x] Aucun `UPDATE` SQL brut sur `rt_mouvement` ; écriture via `repo.Update`
- [x] Aucun credential/secret en dur, aucune dette silencieuse, cohérent avec l'architecture
