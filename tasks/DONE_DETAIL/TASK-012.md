# TASK-012 — Auto-Rapprochement front cassé (bouton mort)

- **Priorité** : 🔴 Bloquant (fonctionnalité phare)
- **Domaine** : Correction / UX
- **Statut** : TODO
- **Dépend de** : TASK-004 (backend renvoie de vraies propositions)

## Contexte
`RapprochementBancaire.tsx:175-184`, `handleAutoReconcile` :
```
const response = await axios.post(".../auto-reconcile", { releveBancaireEnteteId: 1 });
alert(`L'algorithme a trouvé ${response.data.length} correspondances...`);
// TODO: Re-fetch list
```

## Problème constaté
1. `releveBancaireEnteteId: **1**` est **codé en dur** au lieu du `selectedReleveId` sélectionné → interroge toujours le mauvais relevé.
2. Le résultat n'est **jamais appliqué** aux grilles : un simple `alert()` puis `// TODO`. Les propositions ne sont ni affichées, ni lettrées, ni surlignées. **Le bouton ne fait rien de visible.**
3. Côté backend, `auto-reconcile` renvoie une liste mockée vide (`reglementsGrc = new List<GrcReglementDto>()`) → même sans le bug front, 0 proposition.

C'est l'Étape 3 « La Magie de l'Auto-Rapprochement » de `analyse_rapprochement.md`, cœur de la valeur du module : actuellement inexistante de bout en bout.

## Objectif
Cliquer sur « Auto-Rapprochement (1=1) » applique et affiche les propositions dans les deux grilles.

## Fichiers concernés
- `gocom-web/src/RapprochementBancaire.tsx`
- `GRC.API/Controllers/ReleveBancaireController.cs` (brancher les vrais règlements GRC — lié à TASK-004)

## Précision — architecture retenue (option A)
> L'**affichage** des grilles utilise déjà les vraies données (`/api/reglements?...&pointe=false`). Le mock est **uniquement** dans le calcul `auto-reconcile`.
> **Option retenue : le backend recharge lui-même les vrais règlements** (via `ReglementClientRepository`, mêmes filtres que la grille : banque, non pointés), il reste maître de la donnée GRC. Le front n'envoie donc pas les listes, mais le contexte nécessaire.

## Étapes d'implémentation
1. Front : passer au endpoint `selectedReleveId` (pas `1`) **+** le contexte de sélection GRC (`banqueId`/`societeId`/`caisses`) nécessaire au rechargement backend.
2. Backend : remplacer `new List<GrcReglementDto>()` (mock, ligne ~242) par un vrai chargement via `ReglementClientRepository` (règlements non pointés de la banque), en réutilisant la même logique que `/api/reglements`. Mapper vers `GrcReglementDto` en prenant le **bon champ montant** (`MontantDeviseSociete`) — cohérent avec `l.Credit` (arrondi/signe).
3. Front : à réception, appliquer le lettrage proposé aux lignes relevé **et** aux règlements GRC correspondants (mise à jour du state), avec un style visuel « proposé » distinct d'un lettrage validé.
4. Remplacer l'`alert` par un toast + focus/scroll sur les paires proposées.

## Contraintes
- Une proposition n'est pas une validation : l'utilisateur doit pouvoir corriger avant « Approuver ».

## Checklist VALIDATION (à remplir dans VERIFY/)
- [ ] Build OK
- [ ] Auto-rapprochement sur le relevé sélectionné (pas ID=1)
- [ ] Propositions réellement affichées et modifiables
- [ ] Backend renvoie de vraies paires (non mock)
- [ ] Cohérent avec la règle 1=1
