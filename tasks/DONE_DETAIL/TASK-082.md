# TASK-082 — Écriture comptable règlement VERSEMENT : libellé bancaire du relevé

- **Priorité** : 🟡 Mineur
- **Domaine** : Correction (Backend Infra — pas de changement SQL de vue nécessaire)
- **Statut** : LIVRÉ
- **Dépend de** : TASK-053 (livrée), TASK-031/034 (livrées — flux `ExtraitNum`/`MV_Piece`), TASK-060 (livrée — génération versement)

## Contexte

Demande PO (2026-09-26) sur le libellé des écritures de versement, reçue sous cette forme :

> Pour libellé des écritures de versement
> N° pièce : code banque
> Référence : N° de facture
> Libellé : libellé de la banque 'dans le relevé'

**Précision de nommage (relecture 2026-09-27) — à ne pas confondre** : le fichier `SQL_005_TASK-053_LibelleEcriture.sql` utilise en commentaire les noms `EC_Piece`/`EC_Reference`/`EC_Intitule` pour désigner les colonnes **cibles côté Sage** (table `F_ECRITUREC`, avec leurs longueurs `varchar(13)`/`varchar(17)`/`varchar(69)`) — ce ne sont pas les noms de colonnes de la vue `vw_ReglementsAComptabiliser`, qui expose `MV_Piece`, `MV_Reference`, `LibelleEcriture` ([ReglementComptaViewRepository.cs:52-55](../GRC.Infrastructure/Repositories/ReglementComptaViewRepository.cs#L52-L55)). **Cette tâche ne touche à aucune de ces colonnes de vue** : le seul changement porte sur la donnée source `MV_Libelle` de `RT_MOUVEMENT`, en amont de la vue, au moment du rapprochement bancaire (§ ci-dessous).

Investigation menée avec le PO (2026-09-26/27) sur le "code banque" :
- Aucun champ `CodeBanque` texte n'existe dans `RAPP_ReleveBancaire_Entete`/`RAPP_ReleveBancaire_Ligne` ([SQL_001_Schema_RappReleveBancaire.sql](../SQL_001_Schema_RappReleveBancaire.sql)) ni dans le mapping C# associé.
- Le "code banque" visé par le PO est en réalité la colonne **`Code`** de `RAPP_ReleveBancaire_Ligne`, qui alimente `MV_ExtraitNum` puis `MV_Piece` (confirmé PO : "c'est le champ Code" / "on utilise donc MV_Piece pour les versements").
- Ce champ est déjà alimenté aujourd'hui, à la **validation du rapprochement** bancaire, dans `ReleveBancaireRepository.SauvegarderValidationAsync` ([ReleveBancaireRepository.cs:760-765](../GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs#L760-L765)) :
  ```csharp
  reg.ExtraitNum = pair.CodeExcel;
  reg.Info1 = pair.CodeExcel;
  reg.PieceNumero = pair.CodeExcel;   // → devient MV_Piece
  ```
  `pair.CodeExcel` vient du front ([RapprochementBancaire.tsx:892](../gocom-web/src/RapprochementBancaire.tsx#L892)) : `ligne.code || 'MANUAL'`. **Déjà couvert par TASK-031/034, aucun changement nécessaire sur ce point.**

Dans la vue `vw_ReglementsAComptabiliser` (branche `MV_Type ≠ 0` = hors espèce/versement, [SQL_005_TASK-053_LibelleEcriture.sql:61-107](../SQL_005_TASK-053_LibelleEcriture.sql#L61-L107)) :

- Colonne `MV_Piece` (l.61-65) : recopie `r.MV_Piece` (tronqué à 13) — **déjà conforme** à la demande "N° pièce = code banque", puisque `MV_Piece` porte déjà le `Code` du relevé (via TASK-031/034 ci-dessus).
- Colonne `ReferenceCompta` (l.80-82) : recopie `r.MV_Reference` pour la branche hors espèce — **déjà conforme** (décision PO 2026-09-27 : "Référence oui on récupère MV_Reference"). `MV_Reference` est saisi par l'utilisateur à la génération du règlement (`mvReference` dans `GenererVersementDepuisReleveAsync`, [ReglementGenerationService.cs:416](../GRC.Infrastructure/Services/ReglementGenerationService.cs#L416)) — aucun mécanisme de résolution automatique à ajouter, rien à faire sur ce point.
- Colonne `LibelleEcriture` (l.99-106) : `MV_Libelle` saisi, repli `'Versement'` si vide — **non conforme** : rien n'alimente `MV_Libelle` depuis le libellé du relevé bancaire (`RAPP_ReleveBancaire_Ligne.Libelle`), ni à la génération du règlement (`GenererVersementDepuisReleveAsync`, paramètre 10 `libelle` = `client.Intitule`, [ReglementGenerationService.cs:403](../GRC.Infrastructure/Services/ReglementGenerationService.cs#L403)), ni à la validation du rapprochement (`SauvegarderValidationAsync` ne touche jamais `reg.Libelle`).

**Décision PO (2026-09-27) — point d'injection tranché** : au moment du rapprochement, exactement comme `Code` est déjà injecté dans `MV_Piece`, `Libelle` doit être injecté dans `MV_Libelle`, pour être réutilisé ensuite dans les écritures comptables. Symétrique à l'injection déjà en place :
```csharp
reg.IsPointe = true;
reg.ExtraitNum = pair.CodeExcel;
reg.Info1 = pair.CodeExcel;
reg.PieceNumero = pair.CodeExcel;   // → devient MV_Piece
// à ajouter, même principe :
reg.Libelle = pair.Libelle;        // → devient MV_Libelle
```
**Option écartée** : injecter à la génération du règlement (`GenererVersementDepuisReleveAsync`, TASK-060) plutôt qu'au rapprochement — ne pas l'implémenter en plus sans nouvelle demande PO, cf. § Contraintes. Une fois `MV_Libelle` correctement posé au rapprochement, la vue existante le recopie déjà tel quel (l.104-105 : `ELSE LTRIM(RTRIM(r.MV_Libelle))`) — **aucun changement de la vue SQL n'est donc nécessaire**.

## Problème constaté

1. Colonne `MV_Piece` (n° pièce = code banque) : déjà correct, rien à faire.
2. Colonne `ReferenceCompta`/`MV_Reference` (référence = n° de facture) : déjà correct, rien à faire.
3. `MV_Libelle` (source du libellé bancaire du relevé) : aucun chemin ne fait transiter `RAPP_ReleveBancaire_Ligne.Libelle` vers `MV_Libelle` — **seul point restant à implémenter dans cette tâche**.

## Objectif

- `MV_Libelle` (versement) reflète le libellé de la ligne du relevé bancaire d'origine dès la validation du rapprochement — repris ensuite tel quel par la vue (`LibelleEcriture`) sans changement de la vue.
- `MV_Reference` (versement) : inchangé (déjà conforme).
- `MV_Piece` (versement) : inchangé (déjà conforme).
- Si `RAPP_ReleveBancaire_Ligne.Libelle` est vide/NULL au moment du rapprochement (cas possible, une ligne de relevé bancaire mal formée ou un rapprochement `'MANUAL'` sans ligne source) : **ne pas écrire de chaîne vide dans `MV_Libelle`** — dans ce cas précis, ne pas assigner `reg.Libelle` du tout (laisser la valeur existante, potentiellement NULL), pour que le repli déjà existant de la vue (`'Versement'` si `MV_Libelle` est vide/NULL, l.104) continue de s'appliquer sans modification. Ne pas introduire un second repli redondant côté C#.

## Fichiers concernés

- `GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs` — `SauvegarderValidationAsync` (l.760-765) : ajouter l'injection de `Libelle` symétrique à celle de `Code` (voir décision PO ci-dessus).
- `GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs` — `ValidationPairDto` (l.924-932) : ajouter une propriété `Libelle` au DTO, à côté de `CodeExcel`.
- `gocom-web/src/RapprochementBancaire.tsx` (l.889-894) : ajouter `libelle: ligne.libelle` (ou équivalent) au payload envoyé au moment de la construction des paires, à côté de `codeExcel: ligne.code || 'MANUAL'`.
- Aucun fichier SQL de vue à modifier (cf. § Contexte, dernier paragraphe).

## Étapes d'implémentation

1. ~~Vérifier que l'entité `reg` expose un setter `Libelle` mappé sur `MV_Libelle`~~ — **confirmé** : `Tresorerie.Core.Models.ReglementClient.Libelle` (`public string Libelle { get; set; }`, source décompilée `Tresorerie.Core.Models\ReglementClient.cs:167`), setter public déjà disponible, aucun changement de DLL nécessaire.
2. Ajouter `Libelle` à `ValidationPairDto` (backend) et au payload front (`RapprochementBancaire.tsx`), à côté de `CodeExcel`.
3. Dans `SauvegarderValidationAsync`, juste après les lignes existantes 761-765 : `if (!string.IsNullOrWhiteSpace(pair.Libelle)) reg.Libelle = pair.Libelle;` — n'assigner que si non vide, cf. § Objectif (ne pas écraser par une chaîne vide, laisser le repli existant de la vue s'appliquer).
4. Rejouer sur un échantillon réel de versements (avec rapprochement bancaire réel) et vérifier que `LibelleEcriture` (colonne de vue) reflète bien le libellé du relevé pour les nouveaux rapprochements.
5. Vérifier la troncature de la colonne `LibelleEcriture` (limite Sage `varchar(69)`, cf. commentaire `EC_Intitule` du fichier SQL) sur des libellés bancaires réels (souvent plus longs qu'un simple n° de facture) — signaler tout dépassement, ne pas le laisser silencieux (cf. discipline de troncature TASK-053).

## Contraintes

- Ne jamais bypasser une règle de sécurité ou une DLL métier GRC.
- Ne pas modifier `MV_Piece` (déjà conforme) ni le flux `ExtraitNum` déjà validé par TASK-031/034.
- Ne pas toucher à la branche espèce de la vue (`MV_Type = 0`) — objet de TASK-081.
- Point d'injection du libellé = validation du rapprochement uniquement (décision PO 2026-09-27) — ne pas implémenter en plus l'option génération (`GenererVersementDepuisReleveAsync`) sans nouvelle demande PO explicite : un seul point d'injection, pas les deux.
- Ne pas toucher `MV_Reference` (déjà conforme, confirmé PO 2026-09-27).
- Ne pas modifier la vue SQL `vw_ReglementsAComptabiliser` dans cette tâche — elle recopie déjà `MV_Libelle` tel quel, correctement.
- Ne jamais écrire de chaîne vide dans `MV_Libelle` si `pair.Libelle` est vide/NULL (cf. § Objectif) — laisser le repli existant de la vue faire son travail.

## Checklist VALIDATION (à remplir dans VERIFY/)

- [x] Build OK
- [x] `ValidationPairDto` + payload front étendus avec `Libelle`, `reg.Libelle = pair.Libelle` ajouté dans `SauvegarderValidationAsync` (uniquement si non vide), symétrique à `Code`/`PieceNumero`
- [x] Comportement vérifié end-to-end sur un versement réel rapproché (libellé bancaire du relevé retrouvé dans la colonne `LibelleEcriture` de la vue / dans l'écriture comptable finale)
- [x] Cas `pair.Libelle` vide/NULL vérifié : `MV_Libelle` non écrasé par une chaîne vide, repli `'Versement'` de la vue toujours actif
- [x] Vérification de la marge de troncature `LibelleEcriture` (limite Sage 69) sur libellés bancaires réels, dépassements éventuels signalés
- [x] Aucun credential/secret en dur introduit
- [x] Aucune dette technique silencieuse
- [x] Cohérent avec l'architecture
