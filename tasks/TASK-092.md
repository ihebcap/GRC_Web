# TASK-092 — Boutons « Modifier » et « Historique » en premières colonnes, icônes seules

- **Priorité** : 🟡 Mineur
- **Domaine** : Correction (Front, UX)
- **Statut** : TODO
- **Dépend de** : — (chevauchement de fichier avec TASK-093 — même bloc JSX `App.tsx:770-816` ;
  traiter l'une après l'autre, pas en parallèle, pour éviter un conflit de merge)

## Contexte

Remontée PO (2026-09-29) sur l'écran de liste des règlements
([App.tsx](../gocom-web/src/App.tsx)) : les boutons **« Modifier »** et **« Historique »** doivent
tous les deux devenir les **premières colonnes** du tableau, sous forme d'**icône seule** (sans
libellé texte), pour minimiser l'espace utilisé — au lieu d'être regroupés dans la colonne
« Actions » à droite comme actuellement.

État actuel ([App.tsx:770-816](../gocom-web/src/App.tsx#L770-L816)) : la colonne « Actions »
(dernière colonne, `App.tsx:1338`) contient, dans l'ordre :
- bouton « Modifier » (icône `Edit` + texte, conditionnel — cf. TASK-093 pour le cadrage de sa
  condition d'affichage, hors périmètre de cette tâche qui ne touche que la position/présentation),
- bouton « Annuler » (icône `XCircle` + texte, conditionnel, même bloc),
- bouton « Historique » (icône `History` + texte, toujours affiché).

## Objectif

- Les boutons **Modifier** et **Historique** deviennent chacun une colonne dédiée en **tout début**
  de tableau (avant les colonnes de données `selectedColumns`), sous forme d'**icône seule** (garder
  les icônes `Edit` et `History` de lucide-react déjà utilisées), sans texte visible.
- Conserver un `title` explicite sur chaque bouton (« Modifier le règlement », « Historique des
  modifications ») pour que la fonction reste identifiable au survol/lecteur d'écran — seul le texte
  visible disparaît.
- Le bouton **Modifier** garde sa condition d'affichage actuelle inchangée
  (`!reg.isAnnule && reg.isComptabilise === 0 && !reg.isPointe && reg.isRemis === 0 && !reg.isAffecte`,
  `App.tsx:775`) — si la condition est fausse, la colonne reste vide pour cette ligne (pas de bouton
  désactivé à ce stade, cf. TASK-093 qui traite séparément l'indice visuel/cadrage métier de cette
  condition).
- Le bouton **Annuler** n'est pas concerné par cette tâche : il reste dans la colonne « Actions »
  existante, avec son texte, à sa position actuelle (le PO n'a demandé le déplacement que pour
  Modifier et Historique).
- Le comportement au clic de Modifier (`setEditingReglement(reg)`, `App.tsx:780`) et d'Historique
  (`setHistoryReglement(reg)`, `App.tsx:806`) reste inchangé.

## Fichiers concernés

- `gocom-web/src/App.tsx` — en-tête du tableau (`<thead>`, ligne ~1338 et le `.map(selectedColumns)`
  qui précède), corps du tableau (`tableBodyMemo` / rendu de ligne, lignes ~770-816).

## Étapes d'implémentation

1. Ajouter deux colonnes d'en-tête dédiées (Modifier, Historique) en première position du `<thead>`
   (avant le `.map(col => ...)` sur `selectedColumns`), largeur minimale adaptée à une icône seule
   (ex. 32-40px chacune), sans libellé texte.
2. Dans le rendu de chaque ligne, sortir les boutons Modifier et Historique de la `<td>` « Actions »
   et les placer chacun dans leur propre nouvelle `<td>` en tête de ligne, avant
   `selectedColumns.map(...)`. Le bouton Modifier reste conditionnel (colonne vide si condition
   fausse) ; le bouton Historique reste inconditionnel.
3. Retirer les `<span>Modifier</span>` / `<span>Historique</span>` des boutons déplacés, garder
   uniquement les icônes (`<Edit size={13} />`, `<History size={13} />`) et leur `title`.
4. Le bouton Annuler reste seul dans la `<td>` « Actions » (fin de tableau), avec son texte, inchangé.
5. Vérifier l'alignement visuel (padding/centrage) des deux nouvelles colonnes icône, cohérent entre
   elles et avec le reste du tableau.
6. Vérifier que chaque `onClick` garde son `e.stopPropagation()` (la ligne a un `onClick` de
   sélection en mode Rapprochement, cf. `App.tsx:765`) pour ne pas déclencher la sélection de ligne
   par erreur.

## Contraintes

- Ne pas toucher au comportement fonctionnel de la modification ou de l'historique (endpoints,
  modals, contenu, condition d'affichage de Modifier) — uniquement la position et la présentation
  des boutons déclencheurs.
- Ne pas casser le `colSpan` utilisé par la ligne d'édition inline du mode Rapprochement
  (`App.tsx:825`, `colSpan={selectedColumns.length + 1}`) — avec l'ajout de 2 colonnes fixes en tête
  (Modifier, Historique) en plus de la colonne « Actions » (Annuler) déjà existante en fin de
  tableau, ce calcul doit devenir `selectedColumns.length + 3` (2 nouvelles colonnes + Actions).
  Vérifier visuellement qu'il n'y a pas de décalage de bordure sur cette ligne après implémentation.
- Respecter `ARCHITECTURE.md` § Grilles de données si les colonnes s'intègrent au mécanisme
  `selectedColumns`/`ColumnDef` existant — sinon, des colonnes fixes hors `selectedColumns` (comme
  l'est déjà « Actions ») sont acceptables, à documenter dans le VERIFY.

## Checklist VALIDATION (à remplir dans VERIFY/)

- [ ] Build front OK (0 erreur)
- [ ] Boutons Modifier et Historique visuellement en premières colonnes, icônes seules, sans texte
- [ ] Clic sur Modifier ouvre toujours `ModifierReglementModal` pour la bonne ligne, condition
      d'affichage inchangée (vérifiée sur un règlement conditionnellement masqué et un affiché)
- [ ] Clic sur Historique ouvre toujours `HistoriqueReglementModal` pour la bonne ligne
- [ ] `colSpan` de la ligne d'édition inline (mode Rapprochement) mis à jour et cohérent après ajout
      des 2 colonnes (vérifié visuellement, pas de décalage de bordure)
- [ ] Bouton Annuler toujours fonctionnel, inchangé dans la colonne Actions
- [ ] Aucune dette technique silencieuse
- [ ] Cohérent avec l'architecture
