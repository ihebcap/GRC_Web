# TASK-025 — Voir l'état de rapprochement d'un relevé depuis « Gestion des Relevés Bancaires » (front, lecture seule)

- **Priorité** : 🟠 Majeur (fonctionnalité de suivi demandée par le PO)
- **Domaine** : Frontend
- **Statut** : DONE
- **Dépend de** : TASK-024 (endpoint `GET {id}/etat`)

## Contexte
Suite de TASK-024. Le PO veut, **après import**, savoir **quelles lignes du relevé sont traitées et lesquelles ne le sont pas encore**. Le bon emplacement est l'écran **« Gestion des Relevés Bancaires »** ([RelevesBancaires.tsx](../gocom-web/src/RelevesBancaires.tsx)) — celui qui liste les relevés importés (`#id`, titre, date d'import, importé par) — **pas** l'écran de rapprochement (workspace). Interaction attendue par le PO : **cliquer sur le nom du relevé** (ou un bouton à côté de la ligne) pour afficher son état.

## Objectif
Dans `RelevesBancaires.tsx`, rendre chaque relevé **cliquable** : au clic, afficher (panneau déroulant sous la ligne) l'état de rapprochement de **toutes** ses lignes :
- infos ligne : date opération, libellé, montant (`credit`/`montantReel`), code (n° extrait) ;
- **statut** en badge : **Non traité** (`NonRapproche`) / **Traité** — le « traité » se décline en *Réservé* (en cours, + par qui) et *Validé* ;
- pour les lignes traitées : le **règlement GRC** lié — numéro, date, **caisse (libellé)**, client ;
- un **filtre Traité / Non traité** + des **compteurs** (nb traité / nb non traité) pour répondre directement au besoin.

## Fichiers concernés
- `gocom-web/src/RelevesBancaires.tsx`

## Étapes d'implémentation

### 1. Rendre la ligne relevé cliquable
- Le tableau des relevés existe déjà ([RelevesBancaires.tsx:167-174](../gocom-web/src/RelevesBancaires.tsx#L167)). Rendre le titre (ou toute la ligne) cliquable, avec un affordance visuel (curseur, chevron ▸/▾). Gérer un state `expandedReleveId` (accordéon : un seul relevé ouvert à la fois, ou plusieurs — au choix, garder simple).
- Optionnel : un bouton « État » dans une colonne d'action, si préféré au clic sur le titre. Le clic sur le titre reste l'interaction principale demandée par le PO.

### 2. Chargement de l'état à l'ouverture
- À l'expansion d'un relevé : `GET ${API_BASE}/ReleveBancaire/{id}/etat` (même casse de route que les appels existants `/ReleveBancaire?banqueId=` et `/ReleveBancaire/upload`, [:45](../gocom-web/src/RelevesBancaires.tsx#L45) et [:93](../gocom-web/src/RelevesBancaires.tsx#L93)).
- Typer la réponse (`LigneEtatRapprochementDto` de TASK-024). État de chargement + gestion d'erreur (le composant utilise `alert` aujourd'hui ; rester cohérent ou afficher un message inline).
- **Aucun** appel d'écriture (`reserve`/`release`/`validate`) : consultation pure.

### 3. Résolution du libellé caisse
⚠️ Contrairement à `RapprochementBancaire`, ce composant **ne reçoit pas** `caissesMap` en prop. Le backend renvoie `reglementCaisseNo` (numéro). Pour afficher le **libellé** :
- charger une fois la référence caisses (`GET ${API_BASE}/reference/caisses`, déjà utilisée dans `App.tsx` [:359](../gocom-web/src/App.tsx#L359)) et construire un `Record<number,{code,intitule}>` ;
- afficher `caissesMap[ligne.reglementCaisseNo]?.intitule` (repli `?.code`, puis le numéro brut).
- Si tu préfères éviter l'appel de référence : afficher le numéro de caisse brut est acceptable (à valider en review) — mais le libellé est plus lisible pour l'opérateur.

### 4. Rendu du panneau détail (lecture seule)
- Sous la ligne relevé ouverte, un sous-tableau : Date opération · Libellé · Montant · Code · **Statut** (badge) · **Réservé par** (nom + date si réservé) · **Règlement** (numéro · date · caisse · client, vides si non traité).
- Badge : Non traité (neutre) / Réservé (orange, + `reservePar_UserName`, `dateReservation`) / Validé (vert).
- Aucune case à cocher / aucun bouton d'écriture.

### 5. Filtre Traité / Non traité + compteurs
- Filtre local : **Non traité** (`statut === "NonRapproche"`) vs **Traité** (`"Reserve"` ou `"Valide"`), plus « Tous ».
- Afficher des compteurs (ex. « 12 traitées · 3 non traitées ») en tête du panneau.

## Contraintes
- **Lecture seule** : aucun appel d'écriture depuis cet écran.
- **Additif** : ne pas régresser l'import ni la liste existante de `RelevesBancaires.tsx`.
- Aucune écriture base directe ; tout passe par `GET {id}/etat` (et éventuellement `/reference/caisses` en lecture).
- Format montant/date cohérent avec l'existant (le composant importe déjà `RapprochementBancaire.css`).

## Risques / dépendances
- **Dépend de TASK-024** (endpoint + DTO).
- Casse d'URL : respecter `ReleveBancaire` (PascalCase) comme les appels déjà en place dans ce fichier.
- Ne pas confondre avec TASK-026 (filtrage du **déroulant de l'écran rapprochement**) : périmètre et écran différents.

## Checklist VALIDATION (à remplir dans VERIFY/)
- [x] Build OK
- [x] Depuis « Gestion des Relevés Bancaires », cliquer un relevé affiche l'état de toutes ses lignes
- [x] Statut correct et lisible : Non traité vs Traité (Réservé / Validé distingués)
- [x] Ligne réservée : nom du réservataire + date affichés
- [x] Ligne traitée : numéro, date, **caisse (libellé)**, client du règlement GRC affichés
- [x] Filtre Traité / Non traité fonctionnel + compteurs (traité vs non traité)
- [x] Strictement lecture seule (aucun appel d'écriture)
- [x] Aucune régression de l'import / de la liste des relevés
