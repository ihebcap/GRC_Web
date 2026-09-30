# TASK-099 — Rapprochement : bouton « Annuler le règlement » dans la grille GRC

- **Priorité** : 🟠 Majeur
- **Domaine** : Front (réutilisation d'un endpoint existant)
- **Statut** : TODO
- **Dépend de** : TASK-098 (le règlement annulé disparaît de la grille après l'action)
- **Complément serveur** : TASK-105 (l'annulation d'un règlement réservé/pointé est refusée côté serveur ;
  le message du refus est affiché tel quel, comme prévu ci-dessous)

## Contexte
Demande PO (2026-09-30) : pouvoir annuler un règlement sans quitter l'écran de rapprochement.
L'annulation existe déjà sur l'écran principal (TASK-085/096) : `App.tsx:659-670`
(`handleAnnulerReglement` : confirmation puis `POST /api/reglements/{no}/annuler`) et bouton icône
`XCircle` `App.tsx:829-841`. Le backend (`ReglementController.cs:294`, DLL native
`CaisseManager.ReglementClientAnnuler` + garde `IsComptabilise` + droits caisse) **ne change pas**.

## Problème constaté
`GrcTableBody` (`RapprochementBancaire.tsx:117`) n'a aucune action par ligne côté GRC. Le composant
n'a pas de `showConfirm` (seulement `showToast`).

## Objectif
Un bouton icône seule `XCircle` (`title="Annuler le règlement"`), par ligne de la grille GRC, qui :
1. demande confirmation (même texte que `App.tsx:660`),
2. appelle `POST /reglements/{no}/annuler`,
3. affiche le toast de succès/erreur (message serveur affiché tel quel, comme `App.tsx:666`),
4. recharge la grille GRC (`fetchReglementsGrc`).

## Règles d'affichage du bouton (identiques à `App.tsx:829`)
Visible seulement si `!isAnnule && isComptabilise === 0 && !isPointe && isRemis === 0 && !isAffecte`.
**En plus (spécifique au rapprochement)** : bouton désactivé si le règlement est **réservé**
(`lettrage` non vide ou `reservePar_UserId` renseigné), avec infobulle « Dérapprochez d'abord la
ligne ». On ne laisse pas annuler un règlement réservé (surtout par un autre utilisateur).

## Fichiers concernés
- `gocom-web/src/RapprochementBancaire.tsx` (`GrcTableBody`, props, handler, refresh)
- `gocom-web/src/App.tsx` (lecture seule ; passer `showConfirm` en prop — **ne pas dupliquer** le
  composant de confirmation)

## Étapes d'implémentation
1. Passer `showConfirm` à `RapprochementBancaire` via ses props.
2. Ajouter la colonne d'action (1ère colonne, comme TASK-096) avec le bouton.
3. Handler = copie fidèle de `handleAnnulerReglement`, suivi de `fetchReglementsGrc()`.
4. Réinitialiser `selectedGrcId` si le règlement annulé était sélectionné.
5. Ajuster les `colSpan` éventuels.

## Contraintes
- Ne jamais bypasser une règle de sécurité ou une DLL métier GRC (aucun UPDATE SQL, aucune
  modification backend : endpoint réutilisé tel quel).
- Pas de nouveau composant de confirmation.
- Grille : respecter `ARCHITECTURE.md` § Grilles de données.

## Checklist VALIDATION (à remplir dans VERIFY/, avec preuve datée par critère)
- [ ] Build OK
- [ ] Annulation d'un règlement libre depuis le rapprochement : toast + disparition de la ligne
- [ ] Bouton désactivé pour un règlement réservé, pointé, comptabilisé, remis, affecté
- [ ] Refus serveur (droits caisse / comptabilisé) : message affiché, grille inchangée
- [ ] Aucun credential/secret en dur introduit
- [ ] Aucune dette technique silencieuse
- [ ] Cohérent avec l'architecture
