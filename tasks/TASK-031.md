# TASK-031 — Validation rapprochement : écrire aussi n° pièce et date règlement

- **Priorité** : 🟠 Majeur
- **Domaine** : Correction / Métier comptable
- **Statut** : TODO
- **Dépend de** : —

## Contexte
À la validation d'une paire (ligne relevé ↔ règlement GRC), le rapprochement écrit
dans le règlement client via la DLL `Tresorerie` (`repo.Update(reg)`) —
[ReleveBancaireRepository.cs:313-325](../GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs#L313-L325).

Aujourd'hui il renseigne :
- `ExtraitNum` (`MV_ExtraitNum`, n° extrait) — toujours ;
- `Info1` (`MV_Info1`) — toujours ;
- `PieceNumero` (`MV_Piece`, n° pièce) — **seulement si `reg.Type == 3`** (le commentaire
  « Ordre Extrait » est trompeur : dans l'enum `ReglementType`, `3 = Virement`) ;
- `DatePointage` (date de rapprochement/pointage) — si `DateValeur` renseignée ;
- `IsPointe = true` (`MV_Point = 1`).

Le PO comblait le besoin métier par un **job SQL WinForm** de rattrapage :
```sql
UPDATE m SET MV_Piece = MV_ExtraitNum
FROM rt_mouvement m
WHERE mv_type = 3 AND mv_domaine = 0 AND MV_Point = 1
  AND ISNULL(MV_ExtraitNum,'') <> ISNULL(MV_Piece,'');
```

## Problème constaté
- **N° pièce** : la garde `reg.Type == 3` empêche l'alignement `MV_Piece = MV_ExtraitNum`
  pour tous les autres types de règlement client → nécessite le job SQL manuel après coup.
- **Date règlement** : `MV_Date` (date comptable du règlement) n'est jamais alignée sur la
  date valeur de l'extrait ; seul `DatePointage` l'est.

## Objectif
Au moment de la validation, en plus de l'existant, pour un **règlement client (domaine 0)** :
1. `MV_Piece = MV_ExtraitNum` (= `CodeExcel`) **sans garde de type** ;
2. `MV_Date = DateValeur` **uniquement si le règlement n'est pas comptabilisé**
   (`MV_Compta = 0` → `IsComptabilise == EtatComptabilite.NonComptabilise`).

Résultat mesurable : après validation web, plus besoin du job SQL de rattrapage ; les
règlements comptabilisés conservent leur `MV_Date` d'origine.

## Décisions / hypothèses actées (PO)
- **N° pièce** : retirer la garde `Type == 3`, portée = tout règlement client, **domaine 0**.
- **Date règlement** : aligner `MV_Date` sur `DateValeur` **tant que `MV_Compta = 0`**, via
  `reg.ChangeDate(DateValeur)` (le setter `reg.Date` est privé) et **avant** `IsPointe = true`.
- **Domaine 0** : il n'existe **aucune** propriété `Domaine` sur `ReglementClient`. Le filtre
  `mv_domaine = 0` est **garanti structurellement** car toute la validation passe par
  `Tresorerie.Dapper.Repositories.ReglementClientRepository` (règlements clients = domaine 0).
  → Aucun test de domaine à coder. **À confirmer** que ce périmètre est bien celui voulu.

## Fichiers concernés
- `GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs`
  (méthode `SauvegarderValidationAsync`, bloc [313-325](../GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs#L313-L325)).

## Étapes d'implémentation
> ⚠️ **ORDRE D'APPEL CRITIQUE** (vérifié à l'IL de la DLL) : `reg.ChangeDate(...)` **lève
> `InvalidOperationException` si le règlement est déjà pointé** (`IsPointe == true`), ainsi que si
> `IsAnnule`, `IsRemis`, ou s'il porte des affectations/remplacements. La date DOIT donc être
> changée **AVANT** `reg.IsPointe = true`. Le setter `reg.Date` étant **privé**, on passe
> obligatoirement par la méthode métier `reg.ChangeDate(newDate)` (pas `reg.Date = ...`).

1. **Date règlement d'abord** (tant que `IsPointe` est encore `false`) : dans le bloc
   `if (pair.DateValeur.HasValue)`, après `reg.DatePointage = pair.DateValeur.Value;` (setter simple,
   sans garde), ajouter :
   ```csharp
   if (reg.IsComptabilise == global::Tresorerie.Core.Enum.EtatComptabilite.NonComptabilise)
   {
       reg.ChangeDate(pair.DateValeur.Value); // setter Date privé → passer par la méthode métier
   }
   ```
2. **Puis pointage + n° pièce sans garde** : ensuite seulement, `reg.IsPointe = true;`,
   `reg.ExtraitNum`, `reg.Info1`, et `reg.PieceNumero = pair.CodeExcel;` inconditionnellement
   (plus de `if ((int)reg.Type == 3)`). Ces setters sont simples, sans garde.
3. Commenter clairement les deux règles métier (portée domaine 0, garde comptabilisation) **et**
   la raison de l'ordre (ChangeDate refuse un règlement pointé).
4. `ChangeDate` peut légitimement lever pour un règlement annulé/remis/affecté/remplacé : ces paires
   partent en échec propre par le `try/catch` existant — comportement métier attendu, à documenter
   dans le VERIFY (ce n'est pas un bug).
5. Aucune modification de schéma, aucun `UPDATE` SQL brut ajouté : l'écriture reste faite par
   `repo.Update(reg)` (DLL métier). Le bloc `UPDATE dbo.RAPP_ReleveBancaire_Ligne SET DateValidation`
   ([344-349](../GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs#L344-L349)) reste inchangé.

## Contraintes
- **Interdit de toucher `reg.Date` d'un règlement comptabilisé** (`IsComptabilise != NonComptabilise`) :
  la garde est le cœur de la sécurité comptable de cette tâche.
- Passer exclusivement par la DLL `Tresorerie` (`repo.Update`) — aucun `UPDATE` SQL direct sur
  `rt_mouvement`.
- Respecter la Clean Architecture (Domain ← Application ← Infrastructure/API).
- Ne pas modifier le contrat `ValidationPairDto` ni l'API (les valeurs `CodeExcel` / `DateValeur`
  sont déjà transmises).

## Checklist VALIDATION (à remplir dans VERIFY/)
- [ ] Build OK (backend)
- [ ] Après validation d'une paire : `MV_Piece = MV_ExtraitNum` sur le règlement, **quel que soit le type**
- [ ] `MV_Date` alignée sur `DateValeur` quand `MV_Compta = 0` — **testé sur une paire qui passe réellement** (SuccessCount++), pas en théorie
- [ ] `ChangeDate` appelé **avant** `IsPointe = true` (sinon `InvalidOperationException` systématique → toutes les paires en échec)
- [ ] `MV_Date` **inchangée** quand `MV_Compta ≠ 0` (règlement comptabilisé) — testé sur un cas comptabilisé
- [ ] `DatePointage`, `ExtraitNum`, `Info1`, `IsPointe` toujours renseignés comme avant (pas de régression)
- [ ] Aucun `UPDATE` SQL brut sur `rt_mouvement` introduit ; écriture via `repo.Update`
- [ ] Aucun credential/secret en dur, aucune dette silencieuse, cohérent avec l'architecture
