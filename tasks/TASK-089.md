# TASK-089 — Filtre date "Du/Au" sur l'écran de génération de règlement espèce

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
oubli lors de TASK-059/062/063 (uniformisation des filtres de cet écran), puisque la colonne
`montant`/`solde` a bien été traitée mais pas les 2 colonnes date.

## Objectif
Sur l'écran "Factures ouvertes" (génération de règlement espèce), les colonnes `DATE FACTURE`
et `DATE ÉCHÉANCE` affichent un filtre "Du .... / Au ...." (2 champs `<input type="date">"),
au lieu de la checklist de valeurs uniques — comportement identique au filtre Date de
`RapprochementBancaire.tsx`.

## Fichiers concernés
- `gocom-web/src/ReglementGenerationEspece.tsx` (uniquement `ALL_COLUMNS`, lignes 54-55 —
  `filterType: 'list'` → `filterType: 'date'`)

## Étapes d'implémentation
1. Dans `ALL_COLUMNS`, passer `dateFacture` et `dateEcheance` de `filterType: 'list'` à
   `filterType: 'date'`.
2. Vérifier par lecture de code (et test manuel si possible) que `filteredFactures` (déjà codé
   pour `filterType === 'date'`) produit bien le filtrage attendu avec ces 2 colonnes en
   conditions réelles : borne Du seule, borne Au seule, les deux, aucune.
3. Vérifier que le bouton "Effacer" et l'indicateur "filtre actif" (icône colorée) du composant
   `ExcelFilter` fonctionnent normalement pour ces 2 colonnes en mode `date` (ils sont génériques,
   ne devraient pas nécessiter de changement).
4. Confirmer qu'aucune autre colonne de cet écran n'a la même problématique de cardinalité
   (`clientCode`, `factureNumero` ont une cardinalité élevée aussi mais le PO n'a demandé le
   changement que pour les dates — ne pas étendre le changement sans nouvelle demande explicite).

## Contraintes
- Ne pas inventer un nouveau composant de filtre ni un nouveau mécanisme : `ExcelFilter.tsx`
  et la logique `filteredFactures` couvrent déjà ce besoin, ce changement est une correction de
  config, pas un développement.
- Ne pas toucher aux colonnes non demandées par le PO (voir étape 4).
- Respecter `ARCHITECTURE.md` § Grilles de données — cet écart est déjà pré-acté par cette
  section, mais le documenter quand même explicitement dans le VERIFY (référence TASK-063).

## Checklist VALIDATION (à remplir dans VERIFY/)
- [ ] Build OK
- [ ] Comportement vérifié end-to-end (filtre Du/Au fonctionnel sur les 2 colonnes, bornes
      seules et combinées, "Effacer" fonctionnel)
- [ ] Aucun credential/secret en dur introduit
- [ ] Aucune dette technique silencieuse
- [ ] Cohérent avec l'architecture (écart `list`→`date` documenté, référence TASK-063 et
      ARCHITECTURE.md § Grilles de données)
