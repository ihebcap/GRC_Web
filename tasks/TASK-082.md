# TASK-082 — Libellé écriture comptable règlement VERSEMENT : libellé bancaire du relevé

- **Priorité** : 🟡 Mineur
- **Domaine** : Correction (SQL vue de comptabilisation + possible Backend Infra)
- **Statut** : TODO
- **Dépend de** : TASK-053 (livrée), TASK-031/034 (livrées — flux `ExtraitNum`/`MV_Piece`), TASK-060 (livrée — génération versement)

## Contexte

Demande PO (2026-09-26) sur le libellé des écritures de versement, reçue sous cette forme :

> Pour libellé des écritures de versement
> N° pièce : code banque
> Référence : N° de facture
> Libellé : libellé de la banque 'dans le relevé'

Investigation menée avec le PO (2026-09-26) sur le "code banque" :
- Aucun champ `CodeBanque` texte n'existe dans `RAPP_ReleveBancaire_Entete`/`RAPP_ReleveBancaire_Ligne` ([SQL_001_Schema_RappReleveBancaire.sql](../SQL_001_Schema_RappReleveBancaire.sql)) ni dans le mapping C# associé.
- Le "code banque" visé par le PO est en réalité **`MV_ExtraitNum`** (confirmé PO : "on utilise donc MV_Piece pour les versements").
- Ce champ est déjà alimenté aujourd'hui, à la **validation du rapprochement** bancaire, dans `ReleveBancaireRepository.SauvegarderValidationAsync` ([ReleveBancaireRepository.cs:760-765](../GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs#L760-L765)) :
  ```csharp
  reg.ExtraitNum = pair.CodeExcel;
  reg.Info1 = pair.CodeExcel;
  reg.PieceNumero = pair.CodeExcel;   // → devient MV_Piece
  ```
  `pair.CodeExcel` vient du front ([RapprochementBancaire.tsx:892](../gocom-web/src/RapprochementBancaire.tsx#L892)) : `ligne.code || 'MANUAL'`, c'est-à-dire la colonne `Code` de `RAPP_ReleveBancaire_Ligne` (numéro d'extrait bancaire du relevé importé). **Déjà couvert par TASK-031/034, aucun changement nécessaire sur ce point.**

La vue `vw_ReglementsAComptabiliser` ([SQL_005_TASK-053_LibelleEcriture.sql](../SQL_005_TASK-053_LibelleEcriture.sql), branche `MV_Type ≠ 0` = hors espèce/versement) calcule aujourd'hui :

- `EC_Piece` (l.61-65) : `MV_Piece` tronqué à 13 — **déjà conforme** à la demande (code banque = `MV_ExtraitNum` recopié dans `MV_Piece`).
- `EC_Reference` (l.80-82) : `MV_Reference` — **à vérifier** que `MV_Reference` porte bien le n° de facture pour un versement (à date, `MV_Reference` est saisi librement par l'utilisateur à la génération du règlement, cf. `mvReference` dans `GenererVersementDepuisReleveAsync`, [ReglementGenerationService.cs:416](../GRC.Infrastructure/Services/ReglementGenerationService.cs#L416) — rien ne garantit aujourd'hui qu'il s'agisse d'un n° de facture).
- `EC_Intitule` (l.99-106) : `MV_Libelle` saisi, repli `'Versement'` — **non conforme** : rien n'alimente `MV_Libelle` depuis le libellé du relevé bancaire (`RAPP_ReleveBancaire_Ligne.Libelle`), ni à la génération du règlement (`GenererVersementDepuisReleveAsync`, paramètre 10 `libelle` = `client.Intitule`, [ReglementGenerationService.cs:403](../GRC.Infrastructure/Services/ReglementGenerationService.cs#L403)), ni à la validation du rapprochement (`SauvegarderValidationAsync` ne touche jamais `reg.Libelle`).

**Décision PO (2026-09-27) — point d'injection tranché** : au moment du rapprochement, exactement comme `Code` est déjà injecté dans `MV_Piece`, `Libelle` doit être injecté dans `MV_Libelle`, pour être réutilisé ensuite dans les écritures comptables. Symétrique à l'injection déjà en place ([ReleveBancaireRepository.cs:761-765](../GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs#L761-L765)) :
```csharp
reg.IsPointe = true;
reg.ExtraitNum = pair.CodeExcel;
reg.Info1 = pair.CodeExcel;
reg.PieceNumero = pair.CodeExcel;   // → devient MV_Piece
// à ajouter, même principe :
reg.Libelle = pair.Libelle;        // → devient MV_Libelle
```
**Option A (génération TASK-060) écartée** pour ce point précis — ne pas l'implémenter en plus sans nouvelle demande PO, cf. § Contraintes.

## Problème constaté

1. `EC_Piece` (n° pièce = code banque) : déjà correct, rien à faire.
2. `EC_Reference` (référence = n° de facture) : mécanisme actuel = saisie manuelle libre (`mvReference`), pas une résolution automatique du n° de facture. À clarifier avec le PO : un versement bancaire a-t-il systématiquement une facture identifiable au moment de la génération (via un lettrage/affectation), ou est-ce une saisie assistée/manuelle qui restera telle quelle ?
3. `EC_Intitule` (libellé = libellé bancaire du relevé) : aucun chemin ne fait transiter `RAPP_ReleveBancaire_Ligne.Libelle` vers `MV_Libelle`.

## Objectif

- `EC_Intitule` (versement) reflète le libellé de la ligne du relevé bancaire d'origine.
- `EC_Reference` (versement) reflète le n° de facture quand il est identifiable ; comportement à définir explicitement pour le cas où aucune facture n'est identifiée (ne pas laisser un comportement implicite).
- `EC_Piece` (versement) : inchangé (déjà conforme).

## Fichiers concernés

- `GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs` — `SauvegarderValidationAsync` (l.760-765) : ajouter l'injection de `Libelle` symétrique à celle de `Code` (voir décision PO ci-dessus).
- `GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs` — `ValidationPairDto` (l.924-932) : ajouter une propriété `Libelle` au DTO, à côté de `CodeExcel`.
- `gocom-web/src/RapprochementBancaire.tsx` (l.889-894) : ajouter `libelle: ligne.libelle` (ou équivalent) au payload envoyé au moment de la construction des paires, à côté de `codeExcel: ligne.code || 'MANUAL'`.
- `SQL_005_TASK-053_LibelleEcriture.sql` — si `EC_Reference` nécessite une clause de repli/formatage différente de la recopie brute de `MV_Reference` (le libellé/`EC_Intitule`, lui, n'a plus besoin d'être changé dans la vue : `MV_Libelle` sera déjà le bon libellé une fois l'injection faite au rapprochement — la branche hors espèce de la vue le recopie déjà tel quel, l.99-106).

## Étapes d'implémentation

1. ~~Vérifier que l'entité `reg` expose un setter `Libelle` mappé sur `MV_Libelle`~~ — **confirmé** : `Tresorerie.Core.Models.ReglementClient.Libelle` (`public string Libelle { get; set; }`, source décompilée `Tresorerie.Core.Models\ReglementClient.cs:167`), setter public déjà disponible, aucun changement de DLL nécessaire.
2. Ajouter `Libelle` à `ValidationPairDto` (backend) et au payload front (`RapprochementBancaire.tsx`), à côté de `CodeExcel`.
3. Dans `SauvegarderValidationAsync`, ajouter `reg.Libelle = pair.Libelle;` juste après les lignes existantes 761-765, avec un repli explicite si `pair.Libelle` est vide/NULL (ne pas laisser `MV_Libelle` vide silencieusement — décider avec le PO du repli, ex. conserver le comportement existant `'Versement'` de la vue si `MV_Libelle` reste vide).
4. Clarifier avec le PO le mécanisme de résolution automatique du n° de facture pour `EC_Reference` (versement) : existe-t-il un lettrage/affectation facture déjà disponible au moment voulu, ou la saisie manuelle actuelle (`mvReference`) reste-t-elle le mécanisme voulu et seule la vue de comptabilisation doit changer de source ?
5. Rejouer sur un échantillon réel de versements (avec rapprochement bancaire réel) et vérifier `EC_Intitule`/`EC_Reference` produits.
6. Vérifier la troncature `EC_Intitule varchar(69)` / `EC_Reference varchar(17)` sur des libellés bancaires réels (souvent plus longs qu'un simple n° de facture) — signaler tout dépassement, ne pas le laisser silencieux (cf. discipline de troncature TASK-053).

## Contraintes

- Ne jamais bypasser une règle de sécurité ou une DLL métier GRC.
- Ne pas modifier `EC_Piece`/`MV_Piece` (déjà conforme) ni le flux `ExtraitNum` déjà validé par TASK-031/034.
- Ne pas toucher à la branche espèce de la vue (`MV_Type = 0`) — objet de TASK-081.
- Point d'injection du libellé = validation du rapprochement uniquement (décision PO 2026-09-27) — ne pas implémenter en plus l'option génération (`GenererVersementDepuisReleveAsync`) sans nouvelle demande PO explicite : un seul point d'injection, pas les deux.
- Documenter explicitement le comportement de repli si `RAPP_ReleveBancaire_Ligne.Libelle` est vide/NULL, et si aucune facture n'est identifiable pour `EC_Reference`.

## Risques / dépendances

- Le mécanisme de résolution automatique du n° de facture pour `EC_Reference` n'existe pas aujourd'hui dans le flux versement (contrairement à l'espèce, où `RT_AFFECTATION` le fournit déjà) — peut nécessiter un cadrage complémentaire si le PO veut une résolution automatique plutôt qu'une saisie manuelle confirmée.

## Checklist VALIDATION (à remplir dans VERIFY/)

- [ ] Build OK
- [ ] `ValidationPairDto` + payload front étendus avec `Libelle`, `reg.Libelle = pair.Libelle` ajouté dans `SauvegarderValidationAsync`, symétrique à `Code`/`PieceNumero`
- [ ] Décision PO documentée sur le mécanisme de `EC_Reference` (résolution auto vs saisie manuelle conservée)
- [ ] Comportement vérifié end-to-end sur un versement réel rapproché (libellé bancaire du relevé retrouvé en écriture comptable)
- [ ] Vérification de la marge de troncature `EC_Intitule`/`EC_Reference` sur libellés bancaires réels, dépassements éventuels signalés
- [ ] Aucun credential/secret en dur introduit
- [ ] Aucune dette technique silencieuse
- [ ] Cohérent avec l'architecture
