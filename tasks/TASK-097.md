# TASK-097 — Filtre par numéro de règlement (`No` / `mv_numero`) sur la grille des règlements

- **Priorité** : 🟡 Mineur
- **Domaine** : Front (`gocom-web/src/App.tsx`) + Backend (API + Infra)
- **Statut** : TODO
- **Dépend de** : —

## Contexte

Demande PO (2026-09-29) : sur l'écran principal de liste des règlements, impossible de filtrer par
numéro de règlement (colonne SQL `mv_numero`, exposée en `No` dans `ReglementClientDto` —
`GRC.Infrastructure/Services/ReglementService.cs:1498`).

Exploration du code (2026-09-29) : ce n'est pas un oubli isolé, le filtre est **absent des 3 couches**
de la chaîne filtre :

1. **Rendu UI** — `gocom-web/src/App.tsx` :
   - Ligne 1339 : `else if (col.key !== 'no')` — construction des valeurs distinctes du filtre liste
     explicitement sautée pour `no`.
   - Ligne 1363 : `col.key !== 'no' && ...` — le composant `<ExcelFilter>` n'est **pas rendu du tout**
     dans le `<th>` de la colonne `no`. Aucun contrôle de filtre n'apparaît à l'écran pour cette
     colonne.
   - Ligne 1315-1316 : `filterType` n'a pas de cas dédié pour `no` (retombe sur `'list'` par défaut,
     inadapté — cardinalité 1 valeur/ligne, cf. `ARCHITECTURE.md` "Écarts actés").
2. **Construction de la requête** — `buildParams` (`App.tsx:483-...`) : aucune entrée `if
   (currentFilters.no) ...` — même si l'UI envoyait une valeur, elle ne serait jamais transmise au
   backend.
3. **Backend** — `GRC.API/Controllers/ReglementController.cs:27-60` (`GetReglements`) et
   `GRC.Infrastructure/Services/ReglementService.cs:28-32` (`GetReglementsPaged`) : aucun paramètre
   pour filtrer sur `No`. Le paramètre existant `numero` (ligne 35 du contrôleur, ligne 78-81 du
   service) filtre sur `r.Numero`, un champ métier **différent** (référence bancaire/pièce) — ne pas
   le confondre ni le réutiliser pour `No`.

Le champ `No` (`ReglementClient.No`, DLL `Tresorerie.Dapper`) existe déjà et est déjà exploité pour le
tri (`ReglementService.cs:202` et toutes les branches `ThenBy(r => r.No)`) — la donnée est disponible,
seul le filtre est manquant de bout en bout.

## Objectif

Permettre de filtrer la grille des règlements par numéro de règlement (`No`), en respectant le
pattern déjà en place pour les filtres numériques à forte cardinalité (`montant`/`solde` : plage
min/max, cf. `ARCHITECTURE.md`), pas un filtre liste (une checklist avec une valeur par ligne serait
inutilisable).

## Fichiers concernés

- `gocom-web/src/App.tsx` (rendu colonne, `buildParams`)
- `GRC.API/Controllers/ReglementController.cs` (`GetReglements`)
- `GRC.Infrastructure/Services/ReglementService.cs` (`GetReglementsPaged`)

## Étapes d'implémentation

1. **Frontend — `App.tsx`** :
   - Ligne ~1315-1316 : ajouter `'no'` au groupe de colonnes numériques à filtre plage, aux côtés de
     `montant`/`solde` (`filterType = 'number'`). Si un numéro de règlement se filtre plutôt par
     valeur exacte que par plage côté PO, clarifier avec le PO avant de trancher entre plage
     min/max (comme `montant`) et saisie exacte (comme `client`/`piece`, `filterType: 'text'`) — ne
     pas décider seul, documenter le choix retenu dans le VERIFY.
   - Ligne 1339 : retirer l'exclusion `col.key !== 'no'` (devient sans effet si `filterType` n'est
     plus `'list'` pour `no`, mais la nettoyer pour éviter toute confusion).
   - Ligne 1363 : retirer `col.key !== 'no' &&` pour que `<ExcelFilter>` se rende pour cette colonne.
   - `buildParams` (~ligne 522-542) : ajouter la lecture de `currentFilters.no` et son mapping vers
     les paramètres query (`noMin`/`noMax` si plage, ou `no` si valeur exacte — cohérent avec le choix
     de `filterType` ci-dessus).
2. **Backend — `ReglementController.cs`** : ajouter le(s) paramètre(s) `[FromQuery]` correspondant(s)
   (`string? no`, ou `string? noMin`/`string? noMax`) à `GetReglements`, et les transmettre à
   `_reglementService.GetReglementsPaged(...)`.
3. **Backend — `ReglementService.cs`** : ajouter le(s) paramètre(s) à la signature de
   `GetReglementsPaged` et le filtre correspondant sur `allReglements` (même emplacement que les
   filtres existants, ~ligne 73-104), sur `r.No` (int) — comparaison directe si valeur exacte,
   `>=`/`<=` si plage.
4. Vérifier qu'aucune autre grille de règlements (`RapprochementBancaire.tsx`,
   `ApercuComptabilisation.tsx`, `ReglementGenerationEspece.tsx`) n'a la même exclusion sur une colonne
   équivalente — corriger uniquement si le PO confirme que ces écrans sont dans le périmètre demandé
   (la demande initiale ne mentionne que "la liste des règlements", à clarifier si ambigu).

## Contraintes

- Ne pas confondre `No` (identifiant technique du règlement, `mv_numero`) avec `Numero` (champ métier
  déjà filtrable, paramètre `numero` existant) — deux colonnes distinctes, ne pas réutiliser le
  paramètre `numero` existant pour ce nouveau filtre.
- Respecter `ARCHITECTURE.md` : pas de nouveau composant de filtre, réutiliser `ExcelFilter.tsx` en
  mode `number` (pattern `montant`/`solde`) ou `text`, selon la décision de l'étape 1.
- Filtrage actuellement fait en mémoire côté service (`IEnumerable<ReglementClient>.Where(...)`), pas
  en SQL direct — rester cohérent avec les filtres voisins déjà présents dans la même méthode, ne pas
  introduire un accès SQL brut parallèle.

## Checklist VALIDATION (à remplir dans VERIFY/)

- [ ] Filtre visible et fonctionnel sur la colonne `N°` de la grille principale des règlements
- [ ] `buildParams` transmet bien la valeur saisie à l'API (vérifier l'onglet réseau ou un log)
- [ ] Filtre backend appliqué sur `r.No`, pas sur `r.Numero` (non-régression du filtre existant)
- [ ] Tri par colonne `no` toujours fonctionnel après modification (non-régression, cf.
  `ReglementService.cs:202`)
- [ ] Build back + front 0 erreur
- [ ] Décision documentée : filtre plage (min/max) ou valeur exacte pour `No`, avec justification
