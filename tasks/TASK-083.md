# TASK-083 — Lenteur écran liste des règlements (8 Mo / requête, 14-38s, pagination illusoire)

- **Priorité** : 🔴 Bloquant
- **Domaine** : Performance (Backend Infrastructure + API)
- **Statut** : TODO
- **Dépend de** : rien pour le diagnostic. Toute correction touche `ReglementService.GetReglements`,
  utilisé par au moins l'écran principal (`App.tsx`) et potentiellement d'autres consommateurs à
  vérifier avant de modifier la signature.

## Contexte

Constat PO (2026-09-27) sur trace réseau navigateur : l'appel `GET /api/reglements?societeId=1&caisses=...&page=1&p...`
prend entre **14,30 s et 38,10 s** par requête, pour une réponse de **8 078 Ko (~8 Mo)**, et se
répète **4 fois d'affilée** en quelques secondes lors du chargement de l'écran (capture DevTools
fournie par le PO). Écran concerné : liste des règlements (`App.tsx`, grille principale GRC_WEB).

## Problème constaté

1. **Pagination illusoire** — [ReglementController.cs:73-76](../GRC.API/Controllers/ReglementController.cs#L73-L76) :
   `allReglements.Count()` puis `.Skip((page-1)*pageSize).Take(pageSize)` sont appliqués sur un
   `IEnumerable<object>` **déjà matérialisé en mémoire** par
   [ReglementService.GetReglements](../GRC.Infrastructure/Services/ReglementService.cs#L27) — la
   pagination ne réduit ni le volume chargé depuis la DLL Trésorerie, ni le volume sérialisé côté
   service (le filtrage LINQ tourne sur l'ensemble avant la pagination ; c'est la taille de la
   *réponse HTTP* après `Skip/Take` qui reste à expliquer au regard des 8 Mo observés — à vérifier
   en priorité, cf. étape 1 ci-dessous, avant de conclure que la totalité du payload est bien
   renvoyée telle quelle).
2. **Fenêtre de dates par défaut trop large** — [ReglementService.cs:40-41](../GRC.Infrastructure/Services/ReglementService.cs#L40-L41) :
   si le front n'envoie pas `dateDebut`/`dateFin` (cas où l'utilisateur n'a pas encore posé de
   filtre date), le repo `Tresorerie.Dapper.Repositories.ReglementClientRepository.GetAll` est
   interrogé sur **`2000-01-01` → `2030-01-01`**, soit l'historique complet de toutes les caisses
   du périmètre. Tout le filtrage (client, numéro, pièce, référence, libellé, montant, pointé,
   comptabilisé, remis, impayé, annulé, banque, mode, etc. — [ReglementService.cs:66-178](../GRC.Infrastructure/Services/ReglementService.cs#L66-L178))
   s'exécute ensuite **en mémoire en C#** sur ce jeu complet, jamais traduit en filtre SQL/DLL.
3. **4 requêtes quasi simultanées** observées dans la trace — cohérent avec les 4 `useEffect`
   indépendants d'[App.tsx:331-349](../gocom-web/src/App.tsx#L331-L349) qui appellent chacun
   `fetchReglements` (reset page, changement page, changement pageSize, changement tri) ; un
   changement d'état combiné (ex. tri + reset page) peut déclencher plusieurs de ces effects en
   cascade avant que le premier fetch ne réponde. Le garde-fou `fetchSeqRef` (App.tsx:622,625,630)
   n'empêche que l'**application** des réponses obsolètes, pas leur **déclenchement** — chaque
   requête inutile continue de coûter 14-38s de charge DLL/réseau côté serveur.

## Objectif

- Le volume de données remonté depuis la DLL Trésorerie pour une page de grille doit être borné par
  `pageSize`, pas par toute la fenêtre de dates du périmètre caisses/société.
- Un chargement d'écran sans filtre explicite ne doit plus scanner 30 ans d'historique par défaut.
- Un changement combiné d'état (page + tri + filtre) ne doit déclencher qu'un seul fetch réseau,
  pas un par `useEffect` indépendant.
- Cible indicative à valider avec le PO : temps de réponse de la liste principale ramené à un ordre
  de grandeur exploitable en usage normal (secondes, pas dizaines de secondes) sur le jeu de
  données réel de prod.

## Fichiers concernés

- `GRC.API/Controllers/ReglementController.cs:26-77` (`GetReglements`)
- `GRC.Infrastructure/Services/ReglementService.cs:27-237` (`GetReglements`, filtrage en mémoire)
- `gocom-web/src/App.tsx:330-349,618-632` (`fetchReglements`, les 4 `useEffect` déclencheurs, `fetchSeqRef`)
- DLL `Tresorerie.Dapper.Repositories.ReglementClientRepository.GetAll` — à inspecter (signature,
  capacité ou non à filtrer/paginer côté SQL) avant de décider de la stratégie de correction ; ne
  pas supposer qu'elle supporte une pagination native.

## Étapes d'implémentation

1. **Diagnostiquer d'abord, ne pas corriger à l'aveugle** : instrumenter (log temporaire ou
   profiling) pour mesurer séparément (a) le temps de l'appel DLL `GetAll`, (b) le nombre de lignes
   renvoyées par la DLL sans filtre date, (c) le temps du filtrage LINQ en mémoire, (d) la taille
   réelle du payload JSON renvoyé après `Skip/Take`. Confirmer que les 8 Mo viennent bien de (b)/(c)
   et pas d'un bug de sérialisation qui renverrait `allReglements` en entier au lieu de `items`.
2. Une fois la cause confirmée, évaluer avec le PO l'option de correction : borner la fenêtre de
   dates par défaut (ex. période glissante récente au lieu de 2000-2030) **et/ou** pousser le
   filtrage vers la DLL/SQL si `ReglementClientRepository` le permet **et/ou** introduire un cache
   court applicatif si la DLL ne peut pas être modifiée. Ne pas décider seul de la stratégie sans
   validation PO — plusieurs approches possibles avec impacts différents sur le périmètre DLL
   Trésorerie (règle "ne jamais recoder la logique métier des DLL" à respecter).
3. Côté front, fusionner les 4 `useEffect` de déclenchement de fetch en un seul point d'entrée
   (ex. `useEffect` unique sur un objet d'état combiné `{page, pageSize, sortCol, sortDesc,
   debouncedFilters}`) pour éliminer les requêtes en rafale — sans changer le comportement
   fonctionnel actuel (reset de page sur changement de filtre/tri/pageSize à préserver).
4. Mesurer à nouveau après correction sur le jeu de données réel de prod (pas seulement en dev) —
   le volume réel de règlements en base conditionne la validité du correctif.

## Contraintes

- Ne jamais bypasser une règle de sécurité ou une DLL métier GRC.
- Ne pas recoder la logique de filtrage/pagination de la DLL Trésorerie si elle existe déjà —
  vérifier d'abord ce que `ReglementClientRepository` propose réellement.
- Respecter la Clean Architecture (Domain ← Application ← Infrastructure/API).
- Le scoping caisses/société (isAdmin, `caissesList`) doit rester strictement identique après
  correction — aucune régression de périmètre d'accès.
- Si la tâche introduit ou modifie une grille de données tabulaires : respecter `ARCHITECTURE.md`
  § Grilles de données.

## Risques / dépendances

- La DLL `Tresorerie.Dapper.Repositories.ReglementClientRepository` peut ne pas exposer de filtre
  SQL suffisant pour tout ce que fait actuellement le LINQ en mémoire (filtres composites sur
  colonnes non indexées côté DLL) — une correction complète peut nécessiter un compromis (ex.
  fenêtre de dates bornée + filtres fins toujours en mémoire mais sur un jeu réduit) plutôt qu'une
  solution 100% poussée en SQL.
- `GetDistinctReglements` ([ReglementService.cs:258+](../GRC.Infrastructure/Services/ReglementService.cs#L258))
  et `LettrerParPeriode` ([ReglementService.cs:479+](../GRC.Infrastructure/Services/ReglementService.cs#L479))
  suivent le même pattern `GetAll` — à ne pas casser par effet de bord si la signature de `GetAll`
  ou du repo est modifiée pour ce correctif ; vérifier tous les appelants avant de toucher à la DLL
  wrapper.

## Checklist VALIDATION (à remplir dans VERIFY/)
- [ ] Build OK (back + front)
- [ ] Diagnostic préalable documenté (temps DLL vs filtrage vs sérialisation, taille payload avant/après)
- [ ] Comportement vérifié end-to-end sur jeu de données réel (pas seulement dev) — temps de réponse mesuré avant/après
- [ ] Aucune régression de scoping caisses/société (isAdmin et périmètre caisse identiques)
- [ ] Aucun credential/secret en dur introduit
- [ ] Aucune dette technique silencieuse
- [ ] Cohérent avec l'architecture (DLL Trésorerie non recodée, Clean Architecture respectée)
