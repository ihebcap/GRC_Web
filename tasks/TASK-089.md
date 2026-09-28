# TASK-089 — Filtres Du/Au (date) et plage (montant) sur l'écran de génération de règlement espèce

- **Priorité** : 🟡 Mineur
- **Domaine** : Correction (Front)
- **Statut** : TODO
- **Dépend de** : —

## Contexte
Remarque PO (2026-09-28, capture d'écran de l'écran "Factures ouvertes" — génération de
règlement espèce) : le filtre sur les colonnes `DATE FACTURE` / `DATE ÉCHÉANCE` affiche une
checklist Excel (mode `list`) avec une valeur par ligne (ex. `02/01/2024`, `04/01/2024`,
`08/01/2024`...). Sur un jeu de 3319 factures ouvertes, cela produit potentiellement des
centaines de dates uniques à cocher une par une — inexploitable pour trouver une période.

Le PO demande le même filtre "Du .... Au ...." que celui déjà en place sur la grille de la
liste des règlements (`RapprochementBancaire.tsx`, colonne Date).

`ARCHITECTURE.md` § Grilles de données documente déjà explicitement ce cas : le mode `list`
est jugé inutilisable sur les colonnes à forte cardinalité (montant, **date**) et l'écart
(passage à un filtre de plage) doit être documenté dans le VERIFY plutôt que de revenir en
arrière silencieusement — précédent : TASK-063.

## Problème constaté
Dans `gocom-web/src/ReglementGenerationEspece.tsx:54-55`, les colonnes `dateFacture` et
`dateEcheance` sont déclarées avec `filterType: 'list'` dans `ALL_COLUMNS`, ce qui génère une
checklist de valeurs uniques (une par date distincte) au lieu d'un filtre de plage.

Point notable : la logique de filtrage pour `filterType === 'date'` (bornes `min~max`, comparaison
lexicographique sur `YYYY-MM-DD`) est **déjà implémentée** dans ce même fichier
(`ReglementGenerationEspece.tsx:186-190`, dans `filteredFactures`) et le composant partagé
`ExcelFilter.tsx:149-158` sait déjà rendre un sélecteur "Du / Au" (`type="date"`) pour
`filterType === 'date'`. Seule la config `ALL_COLUMNS` n'a pas été alignée — probablement un
oubli lors de TASK-059/062/063 (uniformisation des filtres de cet écran).

**Revue étendue demandée par le PO (2026-09-28)** : passage en revue de toutes les colonnes à
filtre de l'ensemble des écrans à grille (`App.tsx`, `RapprochementBancaire.tsx`,
`RelevesBancaires.tsx`, `ReglementGenerationEspece.tsx`) pour détecter d'autres anomalies de
filtre du même ordre. Résultat :
- **`montant`/`solde` de `ReglementGenerationEspece.tsx:56-57`** sont eux aussi en
  `filterType: 'list'`, alors que le pattern de référence `App.tsx:1270-1271` (écran liste des
  règlements) traite explicitement `['montant', 'solde'].includes(col.key)` en
  `filterType: 'number'` (plage min/max). Même cause racine que les 2 colonnes date : oubli lors
  de TASK-059/062/063. La logique de filtrage `filter.type === 'number'` est déjà implémentée
  dans ce fichier (`ReglementGenerationEspece.tsx:180-185`) — même situation que pour les dates,
  correction de config uniquement.
- **`RelevesBancaires.tsx`** (état de rapprochement d'un relevé) : `Date Op.` est déjà en
  `filterType="date"` (ligne 153) — conforme. `Débit`/`Crédit` sont en `filterType="text"` mais
  utilisent `matchAmount` (ligne 78-79, cf. TASK-078) pour un matching de valeur, pas une plage —
  choix délibéré différent du besoin "Du/Au", **non retenu comme anomalie**.
- **`App.tsx`/`RapprochementBancaire.tsx`** : déjà conformes, c'est le pattern de référence utilisé
  ci-dessus pour identifier l'écart.

Aucune autre anomalie de filtre trouvée sur les écrans passés en revue.

## Objectif
Sur l'écran "Factures ouvertes" (génération de règlement espèce) :
- Les colonnes `DATE FACTURE` et `DATE ÉCHÉANCE` affichent un filtre "Du .... / Au ...." (2 champs
  `<input type="date">`), au lieu de la checklist de valeurs uniques — comportement identique au
  filtre Date de `RapprochementBancaire.tsx`/`App.tsx`.
- Les colonnes `MONTANT` et `SOLDE` affichent un filtre de plage "Min / Max", au lieu de la
  checklist de valeurs uniques — comportement identique au filtre Montant de `App.tsx`.

## Fichiers concernés
- `gocom-web/src/ReglementGenerationEspece.tsx` (uniquement `ALL_COLUMNS`, lignes 54-57 :
  `dateFacture`/`dateEcheance` `filterType: 'list'` → `'date'` ;
  `montant`/`solde` `filterType: 'list'` → `'number'`)

## Étapes d'implémentation
1. Dans `ALL_COLUMNS`, passer `dateFacture` et `dateEcheance` de `filterType: 'list'` à
   `filterType: 'date'`.
2. Dans `ALL_COLUMNS`, passer `montant` et `solde` de `filterType: 'list'` à `filterType: 'number'`
   (conserver `isAmount: true`, indépendant du filtre — ne régit que l'alignement d'affichage).
3. Vérifier par lecture de code (et test manuel si possible) que `filteredFactures` (déjà codé
   pour `filterType === 'date'` et `filterType === 'number'`, lignes 180-190) produit bien le
   filtrage attendu sur les 4 colonnes en conditions réelles : borne min/Du seule, borne max/Au
   seule, les deux, aucune.
4. Vérifier que le bouton "Effacer" et l'indicateur "filtre actif" (icône colorée) du composant
   `ExcelFilter` fonctionnent normalement pour ces 4 colonnes dans leur nouveau mode (ils sont
   génériques, ne devraient pas nécessiter de changement).
5. Confirmer qu'aucune autre colonne de cet écran n'a la même problématique de cardinalité
   (`clientCode`, `factureNumero` ont une cardinalité élevée aussi mais le PO n'a demandé le
   changement que pour date/montant — ne pas étendre le changement sans nouvelle demande explicite).

## Contraintes
- Ne pas inventer un nouveau composant de filtre ni un nouveau mécanisme : `ExcelFilter.tsx`
  et la logique `filteredFactures` couvrent déjà ce besoin, ce changement est une correction de
  config, pas un développement.
- Ne pas toucher aux colonnes non demandées par le PO (voir étape 5).
- Respecter `ARCHITECTURE.md` § Grilles de données — cet écart est déjà pré-acté par cette
  section pour montant ET date, mais le documenter quand même explicitement dans le VERIFY
  (référence TASK-063).

## Checklist VALIDATION (à remplir dans VERIFY/)
- [ ] Build OK
- [ ] Comportement vérifié end-to-end (filtre Du/Au fonctionnel sur les 2 colonnes date, filtre
      Min/Max fonctionnel sur les 2 colonnes montant, bornes seules et combinées, "Effacer"
      fonctionnel sur les 4 colonnes)
- [ ] Aucun credential/secret en dur introduit
- [ ] Aucune dette technique silencieuse
- [ ] Cohérent avec l'architecture (écart `list`→`date`/`number` documenté, référence TASK-063 et
      ARCHITECTURE.md § Grilles de données)
