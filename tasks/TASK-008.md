# TASK-008 — Borner la requête règlements par période (perf durable)

- **Priorité** : 🟠 Majeur (partie A) · ⏸️ Différé (partie B)
- **Domaine** : Performance
- **Statut** : TODO (partie A)
- **Dépend de** : —

> **Volume vérifié + précision PO** : ~44 000 lignes = **6 mois** → ~88 000/an, en accumulation.
> Mono-société. En mémoire c'est OK **aujourd'hui**, mais la requête charge tout l'historique.

## Partie A — ACTIVE (🟠, faible coût, fort impact durable)
Problème : `repo.GetAll(societeId, new DateTime(2000,1,1), new DateTime(2030,1,1), caisses)` ([Program.cs:379](../GRC.API/Program.cs#L379) et :619) charge **tout l'historique** en mémoire à chaque appel. À ~88k/an, dans quelques années = plusieurs centaines de milliers de lignes chargées/filtrées/triées **par requête**.

→ Passer l'**intervalle de dates réel** (celui déjà sélectionné à l'écran) au lieu de `2000→2030`. Le jeu en mémoire reste borné à une période, indépendamment de l'historique. Peu coûteux, supprime la bombe à retardement.

## Partie B — DIFFÉRÉE (pagination SQL `OFFSET/FETCH`)
Refonte complète du filtrage/tri/pagination côté base. **Non retenue** tant que le volume par période reste raisonnable. À rouvrir si, même borné par période, le jeu devient trop gros ou si des lenteurs apparaissent.

## Autre point (mineur)
213 caisses > 20 déclenche le chemin parallèle `Chunk(20)` (11 connexions concurrentes) à chaque appel — gaspillage, pas bloquant.

## Fichiers concernés
- `GRC.API/Program.cs` (endpoints `/api/reglements`, `/api/reglements/distincts`)
- Front : transmettre l'intervalle de dates de l'écran

## Checklist VALIDATION (à remplir dans VERIFY/)
- [ ] Build OK
- [ ] La requête n'utilise plus `2000→2030` mais la période réelle
- [ ] Résultats fonctionnellement identiques sur une période donnée
- [ ] Temps de réponse stable même avec plusieurs années d'historique

## Contexte
`/api/reglements` et `/api/reglements/distincts` (`GRC.API/Program.cs`) appellent `repo.GetAll(societeId, 2000-01-01, 2030-01-01, caisses)` puis filtrent, trient et paginent **en mémoire** (LINQ-to-objects).

## Problème constaté
- Toutes les lignes de règlement sont chargées en RAM à chaque appel, y compris pour récupérer une seule page.
- `/distincts` recharge l'intégralité pour extraire des valeurs distinctes.
- Filtre montant : `r.MontantDeviseSociete.ToString().Contains(montantFilter)` → comparaison texte de décimaux, culture-dépendante, non indexable.
- Chunking par 20 caisses + `Task.Run` + `Task.WaitAll` masque le problème sans le résoudre.

## Objectif
Filtrage, tri et pagination poussés côté base ; temps de réponse constant quel que soit le volume.

## Fichiers concernés
- `GRC.API/Program.cs`
- `GRC.Infrastructure` (repository de lecture des règlements)
- `GRC.Application` (service de requête paginée)

## Étapes d'implémentation
1. Créer une requête repo paginée (`OFFSET/FETCH`) acceptant filtres, tri, page/pageSize.
2. Passer l'intervalle de dates réel (issu de l'écran) au lieu de 2000→2030.
3. Traiter le filtre montant en numérique (égalité/plage), pas en `.ToString().Contains`.
4. Pour `/distincts`, utiliser `SELECT DISTINCT` en base.

## Contraintes
- Conserver le respect des droits (caisses autorisées) — cf. TASK-002.

## Checklist VALIDATION (à remplir dans VERIFY/)
- [ ] Build OK
- [ ] Une page renvoyée sans charger tout le jeu en mémoire
- [ ] Filtres/tri identiques au comportement actuel (non-régression fonctionnelle)
- [ ] Filtre montant numérique correct
- [ ] Temps de réponse stable sur gros volume
