# TASK-104 — Liste des règlements : seul écran qui affiche les annulés (flag visible) ; masqués en modes Rapprocher et Comptabiliser

- **Priorité** : 🟠 Majeur
- **Domaine** : Front (`App.tsx`) + Back (1 garde dans `RapprocherManuel`)
- **Statut** : TODO
- **Dépend de** : —
- **Lot « règlements annulés »** : TASK-098 (rapprochement) · TASK-103 (comptabilisation) · TASK-104 (liste) · TASK-105 (annulation interdite si réservé/pointé)

## Contexte
Règle PO (2026-09-30) : **l'annulation d'un règlement vaut suppression.** La liste des règlements est
**le seul endroit** où un annulé reste visible, avec un flag pour montrer qu'il est bien annulé. Dès
qu'on passe en mode **Rapprocher** ou **Comptabiliser** (boutons de la liste), les annulés ne sont
**plus affichés du tout**.

## Problèmes constatés
1. **Flag** : la colonne « Annulé » existe (`utils.tsx:104`, badge `:132`) mais n'est pas dans les
   colonnes par défaut (`utils.tsx:15`), et le choix de colonnes est **persisté par utilisateur**
   (`localStorage` `gocom_table_columns`, `App.tsx:292-310`) : ajouter `'annule'` à `DEFAULT_COLUMNS`
   n'aurait aucun effet pour les utilisateurs existants et changerait aussi la grille du Rapprochement
   (`RapprochementBancaire.tsx:309`), où l'annulé n'apparaît plus. Aucun repère au niveau de la ligne.
2. **Modes Rapprocher / Comptabiliser** : ils n'excluent pas les annulés. `buildParams`
   (`App.tsx:483-560`) ne transmet `annule` que si l'utilisateur pose lui-même le filtre (`:557`) ; les
   modes ne verrouillent que `pointe` / `comptabilise`. Les annulés sont donc listés **et sélectionnables**
   (`App.tsx:758` : `!reg.isPointe` ; `:771` : `reg.isComptabilise === 0` ; curseur `:781`). Une sélection
   « Comptabiliser » les envoie ensuite à l'aperçu (`handleRouteToApercu`, `:631`).
3. **Backend `RapprocherManuel`** (`ReglementService.cs:1269-1327`, `ReglementController.cs:261`,
   `POST /api/rapprochement`) : seules gardes = autorisation de caisse et `IsPointe`, puis
   `reg.IsPointe = true; repo.Update(reg)`. Un annulé peut être pointé par appel direct. *Le
   comportement du setter/`Update` de la DLL sur un annulé n'est pas vérifié : à prouver par test, ne
   pas présumer qu'elle refuse.*

## Objectif
- **Liste (mode normal)** : une ligne annulée est reconnaissable d'un coup d'œil **sans configurer les
  colonnes** : repère au niveau de la ligne (par ex. ligne atténuée + badge « ANNULÉ » dans une cellule
  toujours affichée). Implémentation laissée au worker ; contraintes : indépendant du choix de colonnes,
  lisible dans la 1ʳᵉ colonne (68 px), preuve par capture.
- **Modes Rapprocher et Comptabiliser** : les annulés **ne sont pas affichés** (ni dans le tableau, ni dans
  l'export). Le filtre « Annulé » est verrouillé pendant le mode. En quittant le mode, la liste normale
  les réaffiche.
- `RapprocherManuel` refuse un annulé : erreur par élément (comme `IsPointe`), message clair, les autres
  éléments du lot passent.

## Étapes d'implémentation
1. Repère de ligne « annulé » dans `tableBodyMemo` (`App.tsx:749-907`) ; ne pas modifier `DEFAULT_COLUMNS`.
2. **Masquage dans les modes — dérivé du mode, pas stocké dans `filters`** : dans `buildParams`, juste
   après la ligne `:557`, forcer `params.annule = false` si `isRapprochementMode || isComptabilisationMode`.
   Raison : les filtres verrouillés `pointe` / `comptabilise` sont posés puis retirés en 6 endroits
   (`:583`, `:653`, `:1031-1035`, `:1049-1053`, `:1087-1091`, `:1105-1109`) ; stocker `annule` dans
   `filters` obligerait à le retirer aux 6 sorties, et un oubli laisserait les annulés masqués **hors mode**
   (violation de la règle PO). Le rechargement à l'entrée/sortie de mode est déjà déclenché par le
   changement de `filters` (`:350-389`) : le vérifier par test.
3. **Filtre « Annulé » verrouillé en mode** (même mécanique que TASK-076 pour `pointe`/`comptabilise`) :
   - à l'entrée de chaque mode (branches `:1042-1046` et `:1098-1102`) : `delete f.annule` (un éventuel
     filtre utilisateur « Annulé = Oui » est abandonné, rien à restaurer) ;
   - `handleFilterChange` (`:735-736`) : ignorer `annule` si l'un des deux modes est actif ;
   - en-tête de colonne (`:1363-1378`) : masquer `ExcelFilter` et afficher le 🔒 pour `annule` dans les
     deux modes.
4. **Garde défensive de sélection** (fenêtre du debounce de 500 ms, `:351`, ou donnée périmée) : ajouter
   `!reg.isAnnule` aux conditions de clic `:758` et `:771` et au curseur `:781`.
5. Garde back dans `RapprocherManuel`, à côté de `IsPointe` (`:1304`) :
   `if (reg.IsAnnule) throw new InvalidOperationException(...)`.
6. **Preuve DLL** : avant la garde, appeler `POST /api/rapprochement` sur un annulé de test et consigner
   si la DLL le refuse d'elle-même (information pour le VERIFY ; la garde applicative reste obligatoire).

## Contraintes
- Ne jamais bypasser une règle de sécurité ou une DLL métier GRC.
- Ne pas retirer les annulés de la liste en mode normal : ils y sont voulus (règle PO).
- Grille : respecter `ARCHITECTURE.md` § Grilles de données ; ne pas dupliquer de composant.
- Front minimal : pas de refonte de `App.tsx`. Le bouton « Annuler » de la liste relève de TASK-105.

## Fichiers concernés
- `gocom-web/src/App.tsx` (`buildParams`, `handleFilterChange`, boutons de mode, en-tête, `tableBodyMemo`)
- `GRC.Infrastructure/Services/ReglementService.cs` (`RapprocherManuel`)
- `gocom-web/src/utils.tsx` (lecture seule ; ne pas toucher `DEFAULT_COLUMNS`)

## Checklist VALIDATION (à remplir dans VERIFY/, avec preuve datée par critère)
- [ ] Build OK (back + front, 0 erreur)
- [ ] Liste normale : un annulé est identifiable avec les colonnes par défaut **et** avec un choix de
      colonnes déjà sauvegardé (preuve : 2 captures)
- [ ] Mode Rapprocher : aucun annulé affiché ; sortie du mode → annulés de retour
- [ ] Mode Comptabiliser : idem ; « Comptabiliser (n) » n'envoie jamais d'annulé à l'aperçu
- [ ] Bascule directe Rapprocher ↔ Comptabiliser : aucun annulé à aucun moment (après le rechargement)
- [ ] Filtre « Annulé = Oui » posé avant d'entrer dans un mode : abandonné, pas d'écran vide ni de
      filtre fantôme en sortie ; filtre « Annulé » masqué + 🔒 pendant le mode
- [ ] Export Excel pendant un mode : sans annulés ; hors mode : inchangé
- [ ] `POST /api/rapprochement` avec un annulé (appel direct) → erreur claire, `IsPointe` inchangé ;
      les autres éléments du lot pointés normalement
- [ ] Résultat du test « la DLL refuse-t-elle d'elle-même ? » consigné
- [ ] Aucun credential/secret en dur introduit
- [ ] Aucune dette technique silencieuse
- [ ] Cohérent avec l'architecture
