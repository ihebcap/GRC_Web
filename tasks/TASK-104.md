# TASK-104 — Liste des règlements : flag « Annulé » bien visible, et annulé non sélectionnable en mode Rapprocher / Comptabiliser

- **Priorité** : 🟠 Majeur
- **Domaine** : Front (`App.tsx`) + Back (1 garde dans `RapprocherManuel`)
- **Statut** : TODO
- **Dépend de** : —
- **Lot « règlements annulés »** : TASK-098 (rapprochement) · TASK-103 (comptabilisation) · TASK-104 (liste)

## Contexte
Règle PO (2026-09-30) : la liste des règlements est **le seul écran où un annulé reste visible**, avec un
flag pour montrer qu'il est bien annulé. Mais cette liste propose aussi deux modes de sélection
(« Rapprocher » = pointage manuel par N° d'extrait, « Comptabiliser » = envoi à l'aperçu de compta) où
un annulé ne doit pas pouvoir être choisi.

## Problèmes constatés
1. **Flag** : la colonne « Annulé » existe (`utils.tsx:104`, badge `:132`) mais n'est pas dans les
   colonnes par défaut (`utils.tsx:15`), et le choix de colonnes est **persisté par utilisateur**
   (`localStorage` `gocom_table_columns`, `App.tsx:292-310`) : ajouter `'annule'` à `DEFAULT_COLUMNS`
   n'aurait aucun effet pour les utilisateurs existants et changerait aussi la grille du Rapprochement
   (`RapprochementBancaire.tsx:309`), où l'annulé n'apparaît plus. Aucun repère au niveau de la ligne.
2. **Mode Rapprocher** : le clic de ligne accepte tout `!reg.isPointe` (`App.tsx:758`, curseur `:781`),
   annulé compris. Validation par `POST /api/rapprochement`.
3. **Mode Comptabiliser** : le clic de ligne accepte tout `reg.isComptabilise === 0` (`App.tsx:771`,
   curseur `:781`), annulé compris ; la sélection part à l'aperçu (`handleRouteToApercu`, `:631`) où
   l'annulé passe en erreur et **bloque tout le lot** (voir TASK-103).
4. **Backend `RapprocherManuel`** (`ReglementService.cs:1269-1327`, `ReglementController.cs:261`) : seules
   gardes = autorisation de caisse et `IsPointe`, puis `reg.IsPointe = true; repo.Update(reg)`. Un annulé
   peut être pointé par appel direct. *Le comportement du setter/`Update` de la DLL sur un annulé n'est
   pas vérifié : à prouver par test, ne pas présumer qu'elle refuse.*

## Objectif
- Une ligne annulée est **reconnaissable d'un coup d'œil sans configurer les colonnes** : repère au
  niveau de la ligne (par ex. ligne atténuée + badge « ANNULÉ » dans une cellule toujours affichée).
  L'implémentation exacte est laissée au worker, contrainte : indépendante du choix de colonnes, lisible
  dans les deux thèmes/largeurs de la 1ʳᵉ colonne (68 px), preuve par capture.
- En mode **Rapprocher** et **Comptabiliser** : un annulé **reste affiché** mais n'est **pas
  sélectionnable** (pas de sélection au clic, curseur normal, infobulle « Règlement annulé : ne peut pas
  être rapproché / comptabilisé »).
- `RapprocherManuel` refuse un annulé : erreur par élément (comme `IsPointe`), message clair, les
  autres éléments du lot passent.

## Étapes d'implémentation
1. Repère de ligne « annulé » dans `tableBodyMemo` (`App.tsx:749-907`) ; ne pas modifier `DEFAULT_COLUMNS`.
2. Conditions de sélection : `:758` → `!reg.isPointe && !reg.isAnnule` ; `:771` → `... && !reg.isAnnule` ;
   curseur `:781` aligné ; infobulle. Vérifier la liste de dépendances du `useMemo` (`:907`).
3. Garde back dans `RapprocherManuel`, à côté de `IsPointe` (`:1304`) :
   `if (reg.IsAnnule) throw new InvalidOperationException(...)`.
4. **Preuve DLL** : avant la garde, appeler `POST /api/rapprochement` sur un annulé de test et consigner
   si la DLL le refuse d'elle-même (information pour le VERIFY, la garde applicative reste obligatoire).

## Contraintes
- Ne jamais bypasser une règle de sécurité ou une DLL métier GRC.
- Ne pas retirer les annulés de la liste : ils y sont voulus (règle PO).
- Grille : respecter `ARCHITECTURE.md` § Grilles de données ; ne pas dupliquer de composant.
- Front minimal : pas de refonte de `App.tsx`.

## Fichiers concernés
- `gocom-web/src/App.tsx` (`tableBodyMemo`, conditions `:758`, `:771`, `:781`)
- `GRC.Infrastructure/Services/ReglementService.cs` (`RapprocherManuel`)
- `gocom-web/src/utils.tsx` (lecture seule ; ne pas toucher `DEFAULT_COLUMNS`)

## Checklist VALIDATION (à remplir dans VERIFY/, avec preuve datée par critère)
- [ ] Build OK (back + front, 0 erreur)
- [ ] Un annulé est identifiable dans la liste avec les colonnes par défaut **et** avec un choix de
      colonnes déjà sauvegardé (preuve : 2 captures)
- [ ] Mode Rapprocher : clic sur un annulé → pas de sélection, infobulle affichée ; règlement normal
      toujours sélectionnable (non-régression)
- [ ] Mode Comptabiliser : idem ; « Comptabiliser la sélection » n'envoie jamais d'annulé à l'aperçu
- [ ] `POST /api/rapprochement` avec un annulé (appel direct) → erreur claire, `IsPointe` inchangé ;
      les autres éléments du lot pointés normalement
- [ ] Résultat du test « la DLL refuse-t-elle d'elle-même ? » consigné
- [ ] Aucun credential/secret en dur introduit
- [ ] Aucune dette technique silencieuse
- [ ] Cohérent avec l'architecture
