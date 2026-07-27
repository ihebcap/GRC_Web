# TASK-038 — Forcer `MV_Piece` pour TOUS les types/modes de règlement (retrait de l'exception espèce)

- **Priorité** : 🟠 Majeur (justesse de la pièce comptable — numérotation Sage réelle)
- **Domaine** : Backend (aperçu + compta réelle)
- **Dépend de** : TASK-036 (pièce forcée via vue `vw_ReglementsAComptabiliser`)

## Contexte
TASK-036 forçait le numéro de pièce à `MV_Piece` **sauf** pour l'espèce/caisse, qui conservait le compteur Sage (décision PO d'alors — voir commentaire [ReglementService.cs:321](../GRC.Infrastructure/Services/ReglementService.cs#L321) et méthode `PieceAForcer` [ReglementService.cs:389-394](../GRC.Infrastructure/Services/ReglementService.cs#L389)).

Lors des tests d'aperçu (client « Caisse Operation Marrakech »), plusieurs règlements ont levé côté DLL Sage :
> `Le numero de piece contient unexpected caracters!`

Diagnostic vérifié sur les données :
- Les pièces en échec (`TT26161LGJBZ`, `TT26161GDH5V`, `TT26161WS4Z1`) sont **propres** (ASCII imprimable, aucun caractère invisible, décodage hex confirmé) mais **se terminent par des lettres**.
- Le seul règlement qui passait (`42191`) utilisait en réalité le **compteur numérique Sage** (`FAG2635852`), pas sa `MV_Piece`.
- Hypothèse retenue : Sage refuse une pièce à suffixe non numérique.

**Décision PO (nouvelle)** : la **vue a été corrigée** pour fournir des `MV_Piece` valides **pour tous les modes et tous les types**, et on **force désormais `MV_Piece` partout** — y compris espèce/caisse. L'exception espèce dans le code doit sauter.

## Objectif
Aligner le code sur la nouvelle règle : `PieceAForcer` renvoie `MV_Piece` **pour tout règlement présent dans la vue**, sans distinction de type/mode. Garder le comportement de repli (pièce non forcée → compteur Sage) **uniquement** si la vue ne renvoie pas la ligne.

## Fichiers concernés
- `GRC.Infrastructure/Services/ReglementService.cs` :
  - `PieceAForcer` [l.389-394](../GRC.Infrastructure/Services/ReglementService.cs#L389) — retirer la condition espèce.
  - Commentaire [l.321](../GRC.Infrastructure/Services/ReglementService.cs#L321) — corriger le texte « SAUF caisse/espèce ».
- Mémoire projet `task036-piece-docnumero-compta` — MAJ après validation (l'ancienne règle y est actée).

## Étapes d'implémentation
1. Simplifier `PieceAForcer` :
   ```csharp
   // AVANT : espèce → null (compteur Sage) ; autres → MV_Piece
   // APRÈS : MV_Piece pour tous ; null seulement si la vue ne renvoie pas la ligne
   private static string? PieceAForcer(ReglementClient reg, ReglementComptaViewRow? viewRow)
       => viewRow?.MV_Piece;
   ```
   (Le paramètre `reg` peut rester dans la signature ou être retiré si plus utilisé ; pas de changement d'appelant.)
2. Corriger le commentaire l.321 pour refléter « pièce = `MV_Piece` pour tous les types/modes présents dans la vue ; compteur Sage seulement si absent de la vue ».
3. Vérifier que **les deux chemins** (`ApercuComptabilisation` l.508 et `Comptabiliser` l.323) passent bien par `PieceAForcer` → un seul point de vérité, pas de duplication de règle.

## Contraintes
- **Aperçu = réel** : la même valeur de pièce doit sortir dans l'aperçu et dans la compta réelle (les deux appellent `PieceAForcer`).
- **Aucun `UPDATE` brut** sur table métier GRC hors du dispositif TASK-036 existant.
- Le forçage passe par le décorateur IoC `ErpComptaPieceDecorator` / `ComptaPieceContext` déjà en place (TASK-036) — ne pas réintroduire d'écriture directe.
- Respect Clean Architecture : Domain ← Application ← Infrastructure/API.

## Risques / dépendances
- **Dépend de la correction de la vue** : ne tient que si `vw_ReglementsAComptabiliser` renvoie des `MV_Piece` **acceptées par Sage pour 100 % des lignes** (pas de suffixe en lettres). À faire confirmer/tester par le PO **sur le périmètre complet**, pas seulement sur les cas rejouées.
- **Effet sur la numérotation Sage réelle** : forcer la pièce sur l'espèce fait qu'on n'utilise plus le compteur `F_ECRITUREC` natif. Le PO doit confirmer que c'est voulu **en comptabilisation définitive**, pas seulement en aperçu.
- Régression possible si un mode particulier n'est pas couvert par la vue → repli compteur Sage (comportement conservé, à documenter).

## Checklist VALIDATION (à remplir dans VERIFY/)
- [ ] Build OK (API)
- [ ] `PieceAForcer` renvoie `MV_Piece` pour espèce **et** autres modes quand la vue renvoie la ligne
- [ ] Repli compteur Sage **uniquement** si la ligne est absente de la vue (viewRow null)
- [ ] Aperçu d'un règlement espèce affiche bien `MV_Piece` (plus le compteur Sage)
- [ ] Aperçu == comptabilisation réelle sur un échantillon (pièce identique)
- [ ] Comptabilisation réelle d'un lot mixte (espèce + autres modes) : 0 erreur « unexpected caracters », pièces conformes en base
- [ ] Commentaire l.321 corrigé
- [ ] Mémoire projet `task036-piece-docnumero-compta` mise à jour
