# VERIFY — TASK-077 : Filtre "date" grille GRC de Rapprochement Bancaire

## Problème résolu

La colonne "Date" de la grille "Règlements GRC" de l'écran Rapprochement Bancaire est affichée au format `jj/mm/aaaa` via `renderSharedCell` (`formatDate(reg.date)`).
Cependant, la logique de filtrage textuel dans `filteredReglements` comparait la saisie utilisateur contre la valeur retournée par `getGrcCellValue(r, 'date')`, qui retombait sur la valeur ISO brute `r.date` (ex. `"2026-09-24T00:00:00"`).

Par conséquent :
- Taper `24/09` ou `24/09/2026` ne renvoyait aucun résultat.
- Seule une saisie au format ISO (non visible à l'écran) pouvait matcher.

### Point critique pris en compte (Tri chronologique vs alphabétique)
`getGrcCellValue` est également appelée par `sortedReglements` pour ordonner les lignes.
Remplacer le retour de `getGrcCellValue` par `formatDate(r.date)` aurait corrompu le tri en le transformant en un tri alphabétique sur `jj/mm/aaaa` (ex. "05/01/2026" se retrouvant classé avant "12/12/2025").

La séparation a donc été strictement respectée :
1. **Filtrage (`filteredReglements`)** : branche dédiée `key === 'date'` appliquant `formatDate(r.date).toLowerCase().includes(filter.value.toLowerCase())`.
2. **Tri (`sortedReglements`)** : `getGrcCellValue` conserve sa valeur ISO brute non formatée, et un comparateur chronologique explicite par timestamp (`new Date(valA).getTime() - new Date(valB).getTime()`) garantit un ordre chronologique ascendant/descendant rigoureux.
3. **Filtres de type liste (`grcFilterOptionsMap`)** : conservation de l'exclusion de `date` du calcul d'options.

---

## Fichiers modifiés

| Fichier | Modification |
|---|---|
| `gocom-web/src/RapprochementBancaire.tsx` | - Import de `formatDate` depuis `./utils`<br>- Ajout de la branche `key === 'date'` dans `filteredReglements`<br>- Sécurisation du tri chronologique dans `sortedReglements` via timestamps numériques |

---

## Vérification et Tests

Un harnais de test automatisé a vérifié l'ensemble des scénarios :

1. **Recherche date complète affichée** : la saisie `24/09/2026` retrouve exactement la ligne correspondante (`mv_Id: 1`).
2. **Recherche date partielle jour/mois** : la saisie `24/09` retrouve la ligne du 24 septembre 2026.
3. **Recherche date partielle mois** : la saisie `/09/` retrouve les lignes du 24/09/2026 et du 15/09/2026.
4. **Recherche date partielle année** : la saisie `2025` retrouve la ligne du 12/12/2025.
5. **Non-régression critique sur le tri chronologique** :
   - Dates testées dont l'ordre alphabétique diverge de l'ordre chronologique :
     - `12/12/2025`
     - `05/01/2026`
     - `15/09/2026`
     - `24/09/2026`
   - Tri croissant (ASC) obtenu : `12/12/2025` -> `05/01/2026` -> `15/09/2026` -> `24/09/2026` (chronologique respecté, "05/01/2026" n'est PAS classé avant "12/12/2025").
   - Tri décroissant (DESC) obtenu : `24/09/2026` -> `15/09/2026` -> `05/01/2026` -> `12/12/2025`.
6. **Non-régression autres filtres** :
   - Montant : filtres textuels (`> 2000`) toujours fonctionnels.
   - Solde : filtres textuels (`= 0`) toujours fonctionnels.
   - Mode de règlement : filtre liste multi-valeurs toujours fonctionnel.
   - Filtres combinés : date + montant en conjonction (ET logique) vérifié.

---

## Checklist VALIDATION

- [x] Build OK (`npm run build` : 0 erreur TypeScript, bundle généré)
- [x] Lint OK (`oxlint` : 0 erreur)
- [x] Test réel : filtrer sur une date affichée (`jj/mm/aaaa` complet) retrouve bien la ligne correspondante
- [x] Test réel : filtrer sur une date partielle (`jj/mm`) retrouve bien les lignes du bon jour/mois
- [x] **Test de non-régression critique** : le tri (croissant et décroissant) de la colonne Date reste chronologiquement correct après le correctif (pas de bascule en tri alphabétique) — vérifié avec 05/01/2026 vs 12/12/2025
- [x] Non-régression : filtres Montant, Solde, Mode, Caisse de la même grille toujours fonctionnels
- [x] Non-régression : filtres combinés (Date + un autre filtre) toujours en ET logique
- [x] Aucune dette technique silencieuse
- [x] Cohérent avec l'architecture
