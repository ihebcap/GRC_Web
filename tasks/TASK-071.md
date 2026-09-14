# TASK-071 — Filtre Mode/Type de règlement (et Caisse Code/Intitulé) silencieusement ignoré en cas d'intersection vide

- **Priorité** : 🔴 Correctif (signalement client 2026-09-14 : « je filtre sur Espèce, ça ne marche pas »)
- **Domaine** : Front (`gocom-web/src/App.tsx`)
- **Dépend de** : rien. Aucune dépendance avec TASK-069/070 (autorisation/JWT) ni TASK-068 (secrets), sujets indépendants trouvés le même jour.

## Contexte

Le PO a reçu un signalement client : le filtre de liste des règlements sur le mode **Espèce** « ne marche pas ». Analyse en trois temps :

1. **Piste écartée** — le mode Espèce (`MR_Id=1`) est bien présent dans `/api/reference/modes` pour l'utilisateur concerné (`n.salim`, testé en direct sur la prod cliente, lecture seule) : pas de gap de paramétrage `P_CAISSEMODREG` comme celui déjà documenté pour le mode 18/RELAIS (`CHANGELOG.md`, TASK-047).
2. **Filtre isolé fonctionnel, vérifié en direct sur la prod** :
   ```
   GET /api/reglements?page=1&pageSize=1                → totalItems = 42337
   GET /api/reglements?page=1&pageSize=1&modeNos=1       → totalItems = 32346   (filtre appliqué)
   ```
3. **Bug confirmé, reproduit en direct sur la prod** :
   ```
   GET /api/reglements?page=1&pageSize=1&modeNos=        → totalItems = 42337   (identique au "sans filtre" !)
   ```
   Une chaîne `modeNos` vide (mais présente) n'est **pas** traitée comme "aucun filtre demandé" côté utilisateur — elle doit résulter d'un choix utilisateur (ex. mode sélectionné + colonne Type de règlement filtrée sur un type sans recoupement) et devrait donc renvoyer **zéro résultat**, pas la liste complète.

### Cause racine (`gocom-web/src/App.tsx:437-443`)

```js
if (currentFilters.mode) params.modeNos = toCsv(currentFilters.mode);

if (currentFilters.typeReglement) {
  const selectedTypes = currentFilters.typeReglement.split('|||').map(Number);
  const matchedModes = Object.values(modesMap).filter((m: any) => selectedTypes.includes(m.typeNo)).map((m: any) => m.id);
  params.modeNos = params.modeNos
    ? params.modeNos.split(',').filter((id: string) => matchedModes.includes(parseInt(id))).join(',')
    : (matchedModes.length > 0 ? matchedModes.join(',') : '-1');
}
```

- Cas **Type seul** (`params.modeNos` vide au départ) : si `matchedModes` est vide, le code envoie la sentinelle `'-1'` → 0 résultat. **Correct.**
- Cas **Mode + Type combinés** (`params.modeNos` déjà renseigné par le filtre Mode) : si l'intersection `matchedModes ∩ modeNos` est vide, `.join(',')` produit `""`. Cette chaîne vide est envoyée telle quelle au backend (`modeNos=`), qui la traite comme **absence de filtre** (`ReglementService.cs:134`, `string.IsNullOrEmpty(modeNosFilter)`) → **le filtre est abandonné silencieusement**, la liste complète est renvoyée.

**Impact utilisateur** : un utilisateur qui filtre Mode="Espèce" (ou tout autre mode) puis ajoute/laisse un filtre Type de règlement sans recoupement voit la liste complète au lieu d'une liste vide — donnant l'impression que le filtre Mode « ne fonctionne pas », alors qu'il est en réalité totalement ignoré dans ce cas précis.

**Second foyer identique** (même fichier, même pattern, non signalé par le client mais même défaut structurel) — `App.tsx:430-434`, combinaison des colonnes **Caisse (Code)** et **Caisse (Intitulé)** qui filtrent la même dimension caisse :

```js
if (currentFilters.caisseCode) params.caisseNos = toCsv(currentFilters.caisseCode);
if (currentFilters.caisseIntitule) {
  const nos = toCsv(currentFilters.caisseIntitule);
  const selected = nos.split(',');
  params.caisseNos = params.caisseNos
    ? params.caisseNos.split(',').filter((id: string) => selected.includes(id)).join(',')
    : nos;
}
```
Même défaut : pas de fallback sentinelle si l'intersection caisseCode ∩ caisseIntitule est vide → `caisseNos=""` → `ReglementService.cs:124-127` ignore le filtre caisse dans ce cas, alors qu'aucune caisse ne devrait correspondre.

**Ce second foyer a été reproduit en direct sur la prod cliente (pas seulement déduit par analogie de code)**, avec en complément la validation de la sentinelle `-1` pour les deux dimensions :

```
GET /api/reglements?page=1&pageSize=1&caisseNos=      → totalItems = 42337   (= sans filtre, bug confirmé, symétrique à modeNos)
GET /api/reglements?page=1&pageSize=1&caisseNos=-1    → totalItems = 0       (sentinelle sûre : aucun CaisseNo réel ne vaut -1)
GET /api/reglements?page=1&pageSize=1&modeNos=-1      → totalItems = 0       (sentinelle déjà validée côté mode)
GET /api/reglements?page=1&pageSize=1&modeNos=1&caisseNos=197 → totalItems = 1176   (sanity : filtre combiné mode+caisse réel fonctionne normalement)
```
Ces quatre requêtes lèvent l'incertitude notée plus bas dans « Risques » : la sentinelle `-1` est confirmée sans danger pour `caisseNos` comme pour `modeNos` sur ce jeu de données réel — pas besoin de vérifier le modèle `CaisseNo` séparément avant implémentation, c'est déjà tranché empiriquement.

## Objectif

Quand l'intersection de deux filtres portant sur la même dimension (Mode×Type, ou CaisseCode×CaisseIntitulé) est vide, la requête envoyée au backend doit produire **zéro résultat**, pas ignorer le filtre. Comportement à aligner sur celui déjà correct du cas « Type seul » (sentinelle `'-1'`, qui ne matche aucun ID réel côté `ReglementService.cs` puisque les identifiants métier sont toujours positifs).

## Fichiers concernés

- `gocom-web/src/App.tsx:437-443` (bloc `typeReglement` → `modeNos`)
- `gocom-web/src/App.tsx:430-434` (bloc `caisseIntitule` → `caisseNos`)

## Étapes d'implémentation

1. Dans le bloc `typeReglement` (`App.tsx:439-443`), remplacer l'affectation directe par un calcul explicite de l'intersection, puis appliquer la même sentinelle `'-1'` que la branche « Type seul » si cette intersection est vide :
   ```js
   if (currentFilters.typeReglement) {
     const selectedTypes = currentFilters.typeReglement.split('|||').map(Number);
     const matchedModes = Object.values(modesMap).filter((m: any) => selectedTypes.includes(m.typeNo)).map((m: any) => m.id);
     if (params.modeNos) {
       const intersected = params.modeNos.split(',').filter((id: string) => matchedModes.includes(parseInt(id)));
       params.modeNos = intersected.length > 0 ? intersected.join(',') : '-1';
     } else {
       params.modeNos = matchedModes.length > 0 ? matchedModes.join(',') : '-1';
     }
   }
   ```
2. Appliquer le même correctif au bloc `caisseIntitule` (`App.tsx:430-434`), avec la même sentinelle `'-1'` — **déjà validée empiriquement en prod** (voir Contexte ci-dessus : `caisseNos=-1` → 0 résultat), pas besoin de re-vérifier le modèle `CaisseNo` avant d'implémenter.
3. Ne toucher à aucun autre bloc de `buildParams` — périmètre strictement limité à ces deux intersections.

## Contraintes

- Ne pas modifier le comportement du cas « un seul des deux filtres actif » (déjà correct dans les deux blocs).
- Ne pas modifier le backend (`ReglementService.cs`) — la sentinelle `'-1'` déjà en usage suffit à obtenir 0 résultat sans changement côté API.
- Respecter le pattern déjà en place (pas de nouvelle abstraction, juste corriger le calcul d'intersection existant).

## Risques / dépendances

- Sentinelle `-1` pour `CaisseNo` : **déjà validée empiriquement en prod** (voir Contexte), aucune vérification supplémentaire requise avant implémentation.
- Aucun risque de régression sur le rapprochement/comptabilisation : ce bloc ne concerne que le filtrage d'affichage de la liste principale (`GetReglements`), pas les écritures.

## Checklist VALIDATION (à remplir dans VERIFY/)

- [ ] Build front OK (0 erreur)
- [ ] Repro réelle **avant correctif** : Mode="Espèce" + Type filtré sur un type sans recoupement → liste complète affichée (bug confirmé)
- [ ] Repro réelle **après correctif** : même scénario → liste vide affichée
- [ ] Cas Mode seul (Espèce) → toujours filtré correctement (non régressé, ex. ~32346/42337 sur le jeu de données prod au moment du constat, ordre de grandeur à revérifier sur l'environnement de test)
- [ ] Cas Type seul (Espèce) → toujours filtré correctement (non régressé)
- [ ] Cas CaisseCode + CaisseIntitulé sans recoupement → liste vide (avant : liste complète)
- [ ] Cas CaisseCode seul / CaisseIntitulé seul → non régressé
- [ ] Aucune autre combinaison de filtres du même écran non testée par erreur comme régressée (test manuel rapide sur 2-3 autres colonnes)
