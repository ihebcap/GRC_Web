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
- DLL `Tresorerie.Dapper.Repositories.ReglementClientRepository.GetAll(societeNo, dateDebut, dateFin, caissesNo)`
  — **vérifiée** (source `apbs-gr_winform/src/Tresorerie.Dapper/Repositories/ReglementClientRepository.cs:230-247`
  + `ReglementClientRepository.Script.cs:9-135`) : exécute un vrai SQL Dapper sur `RT_MOUVEMENT`
  avec `WHERE SO_Id=@SocieteNo AND CA_IdOut IN @CaissesNo AND MV_Date BETWEEN @DateDebut AND @DateFin`.
  **Aucun `TOP`/`OFFSET-FETCH`** (pas de pagination SQL) et **aucun filtre serveur** sur
  client/numéro/pièce/référence/libellé/montant/pointé/comptabilisé/remis/impayé/annulé/banque/mode
  — ces critères n'existent pas dans cette requête. C'est la méthode la plus fine que la DLL propose
  pour ce cas d'usage (liste large tous critères) ; pas de surcharge alternative qui ferait mieux
  sans modifier la DLL elle-même.

## Décision PO (2026-09-27)

**Fenêtre de dates par défaut = 30 jours glissants** (au lieu de `2000-01-01`→`2030-01-01`),
**modifiable par l'utilisateur après coup**. Le mécanisme de modification existe déjà côté front :
le filtre colonne "Date" ([App.tsx:1168](../gocom-web/src/App.tsx#L1168), type `ExcelFilter` mode
date) envoie déjà `dateDebut`/`dateFin` dès que l'utilisateur pose une valeur
([App.tsx:506-511](../gocom-web/src/App.tsx#L506)) — donc **aucun nouveau composant front à créer**,
seule la valeur par défaut côté back change quand ces paramètres ne sont pas fournis. Pas de bouton
"voir tout l'historique" à ajouter : élargir manuellement le filtre date suffit à retrouver un
règlement plus ancien.

## Diagnostic DLL — tranché

Vérification faite par lecture du code source réel de la DLL (pas de la version décompilée), donc
fiable sans nécessiter de mesure d'exécution pour cette partie :

- **Le filtre de dates est bien poussé en SQL** (`BETWEEN` dans le `WHERE`) — ce n'est pas le
  problème. Le problème est la **largeur de la plage** envoyée par défaut par
  `ReglementService.cs:40-41` (`2000-01-01` → `2030-01-01`) quand le front n'a pas de filtre date
  actif : le `BETWEEN` SQL ramène alors tout l'historique du périmètre caisses en une seule requête,
  avant même le filtrage LINQ.
- **Pousser les autres filtres (client, montant, pointé, etc.) en SQL est impossible sans modifier
  la DLL** — ils n'existent dans aucune requête de `ReglementClientRepository`. Modifier la DLL
  métier étant hors périmètre (règle absolue du projet), cette option est écartée : **le seul levier
  disponible côté back sans toucher à la DLL est de borner la fenêtre de dates par défaut.**
- **Pas de pagination SQL possible non plus** sans modifier la DLL (pas de `TOP`/`OFFSET-FETCH`
  dans la requête). Le `Skip/Take` en mémoire actuel restera nécessaire tant que la DLL n'est pas
  modifiée — mais son coût devient acceptable une fois le jeu de base réduit par la fenêtre de dates.

## Étapes d'implémentation

1. **Borner la fenêtre de dates par défaut à 30 jours glissants** dans
   `ReglementService.GetReglements` ([ReglementService.cs:40-41](../GRC.Infrastructure/Services/ReglementService.cs#L40)) :
   remplacer `debut = dateDebut ?? new DateTime(2000, 1, 1)` par
   `debut = dateDebut ?? DateTime.Now.Date.AddDays(-30)`, et `fin = dateFin ?? new DateTime(2030, 1, 1)`
   par `fin = dateFin ?? DateTime.Now.Date.AddDays(1).AddSeconds(-1)` (borne de fin de journée
   courante, cohérent avec le pattern déjà utilisé côté front pour `dateFin` — cf.
   [App.tsx:510](../gocom-web/src/App.tsx#L510)). Uniquement la valeur par défaut change ; dès que
   `dateDebut`/`dateFin` sont fournis (l'utilisateur a modifié le filtre "Date" existant), ils
   priment sans changement de comportement.
2. Vérifier qu'aucun autre appelant de `GetReglements` ne compte implicitement sur l'ancienne
   fenêtre par défaut avant de livrer (cf. Risques/dépendances).
3. Mesurer le volume réel de lignes/temps de réponse sur le jeu de données de prod avant/après ce
   changement (le `Skip/Take` en mémoire reste en place, donc le volume de base doit vraiment
   baisser pour que le correctif ait un effet).
4. Côté front, fusionner les 4 `useEffect` de déclenchement de fetch en un seul point d'entrée
   (ex. `useEffect` unique sur un objet d'état combiné `{page, pageSize, sortCol, sortDesc,
   debouncedFilters}`) pour éliminer les requêtes en rafale — sans changer le comportement
   fonctionnel actuel (reset de page sur changement de filtre/tri/pageSize à préserver).

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

- **Confirmé** (pas hypothétique) : `ReglementClientRepository` n'expose aucun filtre SQL pour
  client/montant/pointé/comptabilisé/etc. — le filtrage fin restera en mémoire après correctif, sur
  un jeu réduit par la fenêtre de dates. C'est un compromis accepté, pas une solution 100% poussée
  en SQL ; la DLL elle-même n'est pas modifiée (règle absolue respectée).
- **Tranché par le PO (2026-09-27)** : fenêtre par défaut = 30 jours glissants, modifiable via le
  filtre "Date" déjà existant côté front. Un utilisateur qui veut retrouver un règlement plus ancien
  élargit simplement ce filtre — pas de régression fonctionnelle attendue, le mécanisme de repli
  demandé par l'architecte est déjà présent, pas à construire.
- `GetDistinctReglements` ([ReglementService.cs:258+](../GRC.Infrastructure/Services/ReglementService.cs#L258))
  et `LettrerParPeriode` ([ReglementService.cs:479+](../GRC.Infrastructure/Services/ReglementService.cs#L479))
  suivent le même pattern `GetAll` mais avec leurs propres dates (souvent fournies explicitement par
  l'appelant) — vérifier qu'ils ne sont pas affectés par le changement de la valeur par défaut de
  `GetReglements` avant de livrer.

## Checklist VALIDATION (à remplir dans VERIFY/)
- [ ] Build OK (back + front)
- [ ] Fenêtre de dates par défaut = 30 jours glissants (décision PO 2026-09-27), `dateFin` par défaut = fin de journée courante
- [ ] Filtre "Date" front toujours fonctionnel pour élargir/réduire la période après coup (aucune régression du composant existant)
- [ ] Comportement vérifié end-to-end sur jeu de données réel (pas seulement dev) — temps de réponse mesuré avant/après
- [ ] Aucune régression de scoping caisses/société (isAdmin et périmètre caisse identiques)
- [ ] Aucun credential/secret en dur introduit
- [ ] Aucune dette technique silencieuse
- [ ] Cohérent avec l'architecture (DLL Trésorerie non recodée, Clean Architecture respectée)
