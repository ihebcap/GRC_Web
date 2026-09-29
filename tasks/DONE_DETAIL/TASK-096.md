# TASK-096 — Rapprocher le bouton « Annuler » du bouton « Modifier » (icône seule)

- **Priorité** : 🟡 Mineur
- **Domaine** : Front (UX)
- **Statut** : TODO
- **Dépend de** : —

## Contexte

Demande PO 2026-09-29 : dans la liste des règlements (`App.tsx`), le bouton « Annuler » doit être
placé à côté du bouton « Modifier », en icône seule (sans le libellé texte « Annuler » actuellement
affiché à côté de l'icône `XCircle`).

La grille de règlements a aujourd'hui 4 colonnes dédiées aux actions/état, dans cet ordre
(`App.tsx:1308-1384` pour les en-têtes, `App.tsx:786-860` pour les cellules d'une ligne) :
1. Colonne Modifier (40px) — icône `Edit` seule, `App.tsx:786-828`.
2. Colonne Historique (40px) — icône `History` seule, `App.tsx:829-841`.
3. Colonnes de données (`selectedColumns`).
4. Colonne « Actions » (100px, en-tête `App.tsx:1384`) — bouton Annuler avec icône `XCircle` +
   texte « Annuler », `App.tsx:845-860`, tout à la fin de la ligne.

Le bouton Annuler est donc aujourd'hui à l'autre bout de la ligne par rapport au bouton Modifier,
avec un texte visible en plus.

## Problème constaté

- Le bouton Annuler (`App.tsx:846-859`) est séparé du bouton Modifier par la colonne Historique et
  toutes les colonnes de données : il n'est pas visuellement à côté du bouton Modifier.
- Le bouton Annuler affiche un texte « Annuler » (`App.tsx:857`, `<span>Annuler</span>`) en plus de
  l'icône `XCircle`, alors que le bouton Modifier et le bouton Historique sont en icône seule (avec
  `title` pour l'info-bulle).

## Objectif

Le bouton « Annuler » doit être déplacé dans la même colonne d'actions que le bouton « Modifier »
(en tout début de ligne, à côté de l'icône Modifier), rendu en icône seule (`XCircle`, sans
`<span>Annuler</span>`), avec un `title="Annuler le règlement"` conservé pour l'info-bulle — sur le
même modèle que le bouton Modifier (icône + `title`, pas de texte visible).

La colonne « Actions » actuelle (`App.tsx:845-860`, en-tête `App.tsx:1384`) disparaît : elle ne
contenait que ce bouton. Sa largeur (100px) doit être libérée puisque le bouton rejoint la colonne
Modifier.

Comportement fonctionnel strictement inchangé :
- La condition d'affichage du bouton Annuler reste exactement
  `!reg.isAnnule && reg.isComptabilise === 0 && !reg.isPointe && reg.isRemis === 0 && !reg.isAffecte`
  (`App.tsx:846`).
- L'appel `handleAnnulerReglement(reg)` (`App.tsx:850`) et le `e.stopPropagation()` sont conservés
  à l'identique.
- Quand le bouton Annuler n'est pas affiché (condition fausse), ne rien casser dans la mise en page
  de la colonne Modifier (pas de décalage visuel bizarre si le bouton Annuler est absent alors que
  Modifier est présent, ou inversement) — s'inspirer du pattern déjà utilisé pour le bouton Modifier
  désactivé (`App.tsx:799-827`, remplacement par un `span` occupant l'espace) si nécessaire, ou
  accepter que la colonne soit simplement plus étroite quand le bouton est absent, à trancher au
  moment de l'implémentation selon ce qui rend le mieux visuellement.

## Fichiers concernés

- `gocom-web/src/App.tsx` :
  - En-têtes de colonnes `App.tsx:1308-1310` (colonnes Modifier/Historique) et `App.tsx:1384`
    (en-tête « Actions » à supprimer).
  - Cellule Modifier `App.tsx:786-828`.
  - Cellule Annuler actuelle `App.tsx:845-860` (à déplacer et transformer en icône seule).
  - Vérifier le `colSpan` utilisé pour les lignes de détail rapprochement
    (`App.tsx:864-869`, `selectedColumns.length + 3`) : avec une colonne en moins, ce calcul doit
    être corrigé en conséquence (probablement `selectedColumns.length + 2`).

## Étapes d'implémentation

1. Dans la cellule Modifier (`App.tsx:786-828`), ajouter le bouton Annuler juste à côté de l'icône
   `Edit`, à l'intérieur de la même `<td>` (ou dans une `<td>` immédiatement adjacente dédiée, selon
   ce qui est le plus propre avec le pattern `not-allowed`/désactivé existant), en conservant :
   - la condition d'affichage exacte de `App.tsx:846` ;
   - `onClick` avec `e.stopPropagation()` puis `handleAnnulerReglement(reg)` ;
   - `title="Annuler le règlement"` ;
   - l'icône `XCircle size={13} color="#ef4444"` seule, **sans** `<span>Annuler</span>`.
2. Supprimer la `<span>Annuler</span>` (`App.tsx:857`) et retirer le texte du bouton, garder
   uniquement l'icône (adapter le style du bouton en conséquence : padding resserré comme pour
   Modifier/Historique plutôt que le padding actuel `'4px 8px'` pensé pour icône+texte).
3. Supprimer l'ancienne `<td>` Actions (`App.tsx:845-860`) devenue vide, et son en-tête associé
   `<th>Actions</th>` (`App.tsx:1384`).
4. Ajuster le `colSpan` des lignes de détail (`App.tsx:864-869` et tout autre endroit utilisant
   `selectedColumns.length + 3`, à vérifier par grep) pour refléter le nombre de colonnes réel après
   suppression de la colonne Actions.
5. Rebuild front (`npm run build` dans `gocom-web/`) et vérifier visuellement dans le navigateur :
   - le bouton Annuler apparaît bien à côté du bouton Modifier (icône seule, pas de texte) ;
   - il respecte la même condition d'affichage qu'avant (absent si le règlement est déjà
     comptabilisé/pointé/remis/affecté/annulé) ;
   - le clic déclenche toujours `handleAnnulerReglement` correctement (test manuel sur un
     règlement annulable) ;
   - aucune colonne résiduelle vide « Actions » dans l'en-tête ;
   - les lignes de détail rapprochement (bande verte sous une ligne sélectionnée) s'étendent
     toujours sur toute la largeur du tableau sans décalage (`colSpan` correct).

## Contraintes

- Ne jamais bypasser une règle de sécurité ou une DLL métier GRC (non concerné ici — changement
  purement visuel/structurel de la grille, aucune logique métier touchée).
- Ne pas modifier la condition d'affichage du bouton Annuler ni la logique de
  `handleAnnulerReglement`.
- Ne pas toucher au bouton Historique (`App.tsx:829-841`), qui reste dans sa colonne actuelle.
- Respecter le pattern de grille déjà en place dans ce fichier (pas de nouveau composant de grille
  inventé, cf. `ARCHITECTURE.md` § Grilles de données).

## Checklist VALIDATION (à remplir dans VERIFY/)
- [ ] Build OK (date + méthode : build log front)
- [ ] Comportement vérifié end-to-end (capture d'écran avant/après ; clic Annuler testé
      manuellement sur un règlement annulable ; vérification que le bouton reste absent quand la
      condition d'affichage est fausse)
- [ ] Aucun credential/secret en dur introduit
- [ ] Aucune dette technique silencieuse (colonne « Actions » et son en-tête bien supprimés,
      `colSpan` des lignes de détail corrigé et vérifié par grep qu'aucune autre occurrence de
      l'ancien calcul ne subsiste)
- [ ] Cohérent avec l'architecture (aucun nouveau composant de grille inventé, pattern
      icône+title réutilisé tel qu'existant pour Modifier/Historique)
