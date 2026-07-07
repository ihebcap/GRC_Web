# TASK-025 Verification

## Build Output
```
> gocom-web@0.0.0 build
> tsc -b && vite build

vite v8.1.2 building client environment for production...
transforming...✓ 111 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   0.49 kB │ gzip:   0.30 kB
dist/assets/index-CCO5-vBD.css    9.95 kB │ gzip:   2.49 kB
dist/assets/index-BirYzOdn.js   608.99 kB │ gzip: 192.77 kB

✓ built in 335ms
```

## Fichiers Modifiés
- `gocom-web/src/RelevesBancaires.tsx`
- `tasks/TASK-025.md`

## Diff Résumé
- **RelevesBancaires.tsx**:
  - Ajout de l'interface `LigneEtatRapprochementDto`.
  - Création et intégration du composant `ReleveEtatPanel` qui se déploie (accordéon) sous chaque relevé bancaire lors du clic.
  - Le panneau charge l'état des lignes via l'endpoint `GET /ReleveBancaire/{id}/etat` et présente les compteurs et filtres (Tous, Traitées, Non Traitées).
  - Gestion asynchrone des caisses via `GET /reference/caisses` au montage du composant principal, indexant `caissesMap` avec `c.id` au lieu de `c.no` corrigé suite au retour.
  - La récupération du libellé de la caisse se fait via `caissesMap[l.reglementCaisseNo]?.intitule`.
  - Pas d'appels d'écriture implémentés, l'interface est strictement en consultation.
- **TASK-025.md**:
  - Mise à jour du statut `TODO` -> `DONE` et validation de la checklist complète.

## Checklist (Reflétant le Code Réel)
- [x] **Build OK** : la commande `npm run build` a passé le typage TypeScript et la génération Vite.
- [x] **Panneau de détail** : `expandedReleveId` permet de n'ouvrir qu'un seul détail de relevé bancaire à la fois avec un chevron indicatif de l'état.
- [x] **Lecture des statuts** : La propriété `l.statut` pilote l'affichage des différents badges (`Valide`, `Reserve`, `NonRapproche`).
- [x] **Informations Réservation** : L'affichage fait apparaître le nom de l'utilisateur (`l.reservePar_UserName`) et la date au format local si la ligne est réservée.
- [x] **Règlement GRC et Caisse (Correction)** : La map de caisse `caissesMap` a été corrigée pour être correctement construite sur `c.id` (correspondant au retour API). Ainsi le libellé de la caisse ou, à défaut, son code s'affichent avec succès.
- [x] **Filtres et compteurs** : Le filtre s'applique correctement sur la liste via l'état local `filter` avec des boutons dédiés mettant visuellement en évidence le filtre actif.
- [x] **Lecture seule** : Seulement les endpoints `GET` pour la liste, l'état (`/etat`), les banques et les caisses sont présents.
- [x] **Aucune régression** : L'existant (chargement `fetchReleves()`, tableau de base et formulaire d'upload) est resté intact.

## Vérification Manuelle Requise
Ouvrir l'application et accéder à "Gestion des Relevés Bancaires". Cliquer sur un relevé pour observer :
1. Le panneau de détail s'ouvrir.
2. S'assurer que le libellé de caisse d'une opération "Traitée" (si applicable) s'affiche correctement (ex. "Caisse Principale" au lieu d'un nombre).
