# TASK-099 — Rapprochement : bouton « Annuler le règlement » dans la grille GRC

- **Priorité** : 🟠 Majeur
- **Domaine** : Front (réutilisation d'un endpoint existant)
- **Statut** : DONE
- **Dépend de** : **TASK-098** (prérequis dur : sans elle, un règlement annulé resterait affiché dans la grille après l'action)
- **Complément serveur** : TASK-105 (refus côté serveur d'annuler un règlement réservé/pointé ; peut être livrée avant ou après,
  le message du refus est affiché tel quel)
- **Mise en prod** : front seul, aucun script SQL, aucune config. Retour arrière = redéployer le front précédent.
- **Références de ligne** : état du dépôt au commit `12f2dc0` (2026-09-30). Si un fichier a bougé (autre TASK fusionnée avant), se repérer par le **nom de la fonction**, pas par le numéro.

## Contexte
Demande PO (2026-09-30) : pouvoir annuler un règlement sans quitter l'écran de rapprochement. Règle PO liée :
l'annulation vaut suppression (l'annulé disparaît de la grille, TASK-098) et **on ne peut pas annuler un règlement
réservé ou pointé** (TASK-105).
L'annulation existe déjà sur l'écran principal (TASK-085/096) : `App.tsx:659-670` (`handleAnnulerReglement` :
confirmation puis `POST /api/reglements/{no}/annuler`) et bouton icône `XCircle` `App.tsx:829-841`. Le backend
(`ReglementController.cs:294`, DLL native `CaisseManager.ReglementClientAnnuler` + garde `IsComptabilise` + droits caisse)
**ne change pas**. Le PO **ne teste pas avant la mise en production** : les preuves sont produites par le worker sur la
base de **test** et figurent dans le VERIFY.

## Problème constaté (références vérifiées le 2026-09-30)
- `GrcTableBody` (`RapprochementBancaire.tsx:117`) et `GrcTableRow` (`:73`) n'ont aucune action par ligne côté GRC.
- La 1ʳᵉ colonne de la grille est « Sel. » (`<th style={{width:'40px'}}>` `:1365`) : case à cocher, ou cadenas si la ligne est
  réservée par un autre utilisateur (`:79-92`). **Ce n'est pas une colonne d'actions** (contrairement à la liste).
- Le composant `RapprochementBancaire` reçoit `showToast` mais **pas `showConfirm`** (`App.tsx:983` ; `showConfirm` existe
  dans `Dashboard`, `App.tsx:114` et `:272`).
- **Piège de mémoïsation** : `GrcTableRowMemo` utilise `areEqual` (`:102-113`) qui ne compare qu'une **liste fixe de props**
  (`row`, `isSelected`, `onSelect`, `selectedColumns`, `caissesMap`, `modesMap`, `banquesMap`, `currentUserId`). Une nouvelle
  prop ne déclenche donc aucun re-rendu si on ne l'ajoute pas à cette liste ; la grille peut afficher jusqu'à 1000 lignes
  (`pageSize=1000`, `:484`) : le handler doit être **stable**.
- L'interface `ReglementGrc` (`:27-38`) ne déclare pas `isAnnule`, `isPointe`, `isComptabilise`, `isRemis`, `isAffecte`
  (ils arrivent pourtant dans le JSON, `:487-494`).

## Objectif
Un bouton icône seule `XCircle` (`title="Annuler le règlement"`), par ligne de la grille GRC, qui :
1. demande confirmation (même texte que `App.tsx:660`),
2. appelle `POST /reglements/{no}/annuler`,
3. affiche le toast de succès/erreur (message serveur affiché tel quel, comme `App.tsx:666`),
4. recharge la grille GRC (`fetchReglementsGrc`) : le règlement annulé **disparaît** (TASK-098).

## Règles d'affichage du bouton (cohérentes avec `App.tsx:829`)
| État du règlement | Bouton |
|---|---|
| libre : `!isAnnule && isComptabilise === 0 && !isPointe && isRemis === 0 && !isAffecte`, non réservé | **actif** |
| **réservé** (`lettrage` non vide **ou** `reservePar_UserId` renseigné), par soi ou par un autre | **visible mais désactivé**, infobulle « Dérapprochez d'abord la ligne » |
| comptabilisé, pointé, remis, affecté | **absent** (comme dans la liste) |

Conséquence à connaître : les chèques et traites éligibles au rapprochement ont `isRemis = 2` (`ReglementEligibilityHelper`) ;
ils n'auront donc **jamais** le bouton. Seuls les **virements** l'auront — c'est voulu (règle de la liste).

## Étapes d'implémentation
1. `App.tsx:983` : passer `showConfirm={showConfirm}` à `RapprochementBancaire` ; l'ajouter à l'interface `Props`
   (`RapprochementBancaire.tsx:213-220`) et à la destructuration du composant (`:222`).
   **Ne pas dupliquer** le composant de confirmation.
2. Compléter `ReglementGrc` (`:27-38`) avec les champs optionnels utilisés (`isAnnule`, `isPointe`, `isComptabilise`, `isRemis`, `isAffecte`).
3. Handler `handleAnnulerReglementGrc` : copie fidèle de `handleAnnulerReglement` (`App.tsx:659-670`), suivi de
   `fetchReglementsGrc()`. **Référence stable** : `React.useCallback` + refs pour les valeurs lues (même approche que
   `handleSelectGrc`, `:831-851`), jamais de fonction recréée à chaque rendu.
4. `GrcTableBody` / `GrcTableRow` : nouvelle prop `onAnnuler` ; **l'ajouter à `propsToCompare` (`:105`)** ; nouvelle colonne
   étroite (40 px) placée **juste après « Sel. »** (la case à cocher reste la 1ʳᵉ colonne) : `<th>` vide + `<td>` avec le bouton,
   `onClick` avec `stopPropagation`. Ajuster tout `colSpan` éventuel (ligne vide, ligne de détail).
5. Après un succès : réinitialiser `selectedGrcId` si le règlement annulé était sélectionné (et la sélection du relevé associée si elle en dépendait).
6. Ne rien changer au comportement de sélection/lettrage existant.

## Jeu d'essai (base de TEST uniquement)
- **Rl** : virement libre ; **Rr** : virement réservé sur une ligne de relevé (via l'écran, sans valider) ; **Rc** : chèque remis
  (`isRemis = 2`) ; **Rx** : règlement d'une caisse pour laquelle le compte de test **n'a pas** le droit d'annulation.
- Comptes : un avec droit d'annulation, un **sans**, un admin.

## Scénarios de test (à rejouer par le worker)
- **S1 Libre** : bouton visible sur Rl → confirmation → toast de succès → Rl disparaît de la grille ; le compteur
  « n élément(s) affiché(s) » diminue de 1.
- **S2 Réservé** : Rr → bouton désactivé + infobulle ; aucun appel réseau au clic (onglet Réseau).
- **S3 Remis** : Rc → **pas** de bouton.
- **S4 Refus serveur** : sur Rx (compte sans droit) → toast avec le message serveur, grille **inchangée**.
- **S5 Annulation puis lettrage** : annuler Rl pendant qu'une autre ligne est sélectionnée (`selectedGrcId`) → aucune
  sélection fantôme, les autres lignes gardent leur sélection/lettrage.
- **S6 Non-régression grille** : sélection, lettrage manuel, auto-rapprochement, filtres et tri fonctionnent comme avant ;
  ouverture de la grille à 1000 lignes sans ralentissement perceptible (comparer au comportement avant).
- **S7 Mémoïsation** : ouvrir le profileur React (ou `console.count` temporaire, **retiré ensuite**) : sélectionner une
  ligne ne ré-affiche pas toutes les lignes.
- **S8 Double clic** : cliquer deux fois vite sur le bouton confirmé → au pire un second message « déjà annulé » (inoffensif).

## Risques et points d'attention
- Le risque principal est la **régression de performance** de la grille (voir mémoïsation) : S7 est obligatoire.
- Ne pas modifier la couleur/forme des lignes lettrées ni le cadenas de réservation.
- **Coordination** : livrer TASK-099 **avant** TASK-100/101/102. TASK-100 (RISK HIGH) modifie aussi `GrcTableRow`,
  l'interface `ReglementGrc` (ajout de `releveEnteteId`) et `pairedLettrages` : elle devra reprendre la colonne d'action,
  `propsToCompare` et le handler stable. TASK-102 modifie l'en-tête (`<thead>`) : conflit de fusion possible, sans impact
  fonctionnel. En cas de fusion, conserver « Sel. » en 1ʳᵉ colonne et la liste `propsToCompare` à jour.
- La colonne d'action, comme « Sel. », n'est **pas** dans `selectedColumns` : elle n'apparaît ni dans le choix de colonnes,
  ni dans l'export de TASK-101.

## Contraintes
- Ne jamais bypasser une règle de sécurité ou une DLL métier GRC (aucun UPDATE SQL, aucune modification backend :
  endpoint réutilisé tel quel).
- Pas de nouveau composant de confirmation.
- Grille : respecter `ARCHITECTURE.md` § Grilles de données.

## Fichiers concernés
- `gocom-web/src/RapprochementBancaire.tsx` (`GrcTableBody`, `GrcTableRow`, `areEqual`, `ReglementGrc`, props, handler, refresh, en-tête)
- `gocom-web/src/App.tsx` (`:983` uniquement : passage de `showConfirm`)

## Checklist VALIDATION (VERIFY : preuve datée par critère — capture, réponse API ou extrait de log)
- [ ] Build front OK, 0 erreur (preuve : sortie du build)
- [ ] S1 annulation d'un règlement libre : toast + disparition de la ligne (preuve : captures avant/après)
- [ ] S2 bouton désactivé pour un réservé, sans appel réseau (preuve : capture + onglet Réseau)
- [ ] S3 aucun bouton pour un règlement remis/pointé/comptabilisé/affecté (preuve : captures)
- [ ] S4 refus serveur : message affiché, grille inchangée (preuve : capture)
- [ ] S5 sélection cohérente après annulation (preuve : capture)
- [ ] S6 grille non régressée (sélection, lettrage manuel, auto-rapprochement, filtres, tri) (preuve : captures ou description datée)
- [ ] S7 pas de re-rendu global à la sélection ; `areEqual` mis à jour (preuve : extrait de diff + mesure)
- [ ] Aucun `console.count`/log de debug laissé (preuve : `git diff`)
- [ ] Aucun credential/secret en dur introduit
- [ ] Aucune dette technique silencieuse
- [ ] Cohérent avec l'architecture

## Go / No-Go
**No-Go si** S6 ou S7 ne sont pas prouvés : la grille du Rapprochement est l'écran le plus utilisé et le plus sensible à la performance.
