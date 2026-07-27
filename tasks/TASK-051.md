# TASK-051 — Bouton « Lettrer entre deux périodes » (lettrage en masse par période)

- **Priorité** : 🟠 Nouveau fonctionnel (demande PO)
- **Domaine** : Backend (API + Infrastructure) + Front (liste des règlements)
- **Dépend de** : TASK-050 (binding IoC `ILettrageReglementClient` — **prérequis partagé**, à faire une seule fois pour les deux tâches)

## Contexte

Demande PO (2026-07-14), en complément de TASK-050 (lettrage auto à la comptabilisation) : ajouter un **bouton dédié** dans la liste des règlements pour déclencher manuellement le lettrage sur une **période libre** (deux dates), indépendamment de toute comptabilisation.

Décision actée avec le PO sur le périmètre du bouton : **l'utilisateur saisit seulement `dateMin`/`dateMax`** (pas de sélection de lignes, pas de filtre client obligatoire). Le back détermine tous les clients distincts ayant des règlements dans cette période et lance le lettrage natif **pour chacun**.

Analyse du moteur natif (Mono.Cecil/IL, complémentaire à TASK-050) — méthode dédiée trouvée et tracée en entier :

`LettrageReglementClient.Lettrer(int clientNo, DateTime dateMin, DateTime dateMax) : bool`

Comportement confirmé par IL :
1. Charge tous les exercices comptables, ne garde que ceux qui **chevauchent** `[dateMin, dateMax]`.
2. Charge le client via `IErpCommService.GetClient(clientNo)` — **lève une `ApplicationException`** si le client est introuvable.
3. Pour **chaque exercice chevauchant**, calcule une plage bornée à l'intersection `[max(exerciceDebut, dateMin), min(exerciceFin, dateMax)]` (normalisée en jours pleins), puis appelle `Lettrage(client, dateMinReg, dateMaxReg, exercice)` — qui applique la même règle d'équilibre Σdébit=Σcrédit par groupe d'affectations que celle tracée dans TASK-050.
4. **Toute la boucle multi-exercices tourne sous un seul `TransactionScope(IsolationLevel.Serializable, MaximumTimeout)`** — plus englobant que `LettrerAsync` (qui n'ouvre une transaction que par règlement).
5. Retourne `true` si au moins un exercice a produit un lettrage.

⚠️ **Point de comportement à bien faire comprendre côté UI/PO** : cette méthode **balaie tout l'historique du client sur la période**, pas seulement les règlements affichés/filtrés dans la grille au moment du clic. Un règlement ancien, déjà comptabilisé mais jamais lettré, totalement affecté et dans la période, sera lettré même s'il n'est pas visible dans la vue courante de la liste.

## Objectif

Un nouveau bouton « Lettrer entre deux périodes » dans l'écran liste des règlements ([App.tsx](../gocom-web/src/App.tsx) / composant liste règlements), avec saisie de `dateMin`/`dateMax`, qui :
1. Récupère la liste des clients distincts ayant au moins un règlement dans la période, **restreinte au périmètre caisses/société de l'utilisateur** (même scoping que `GetReglements`).
2. Appelle `Lettrer(clientNo, dateMin, dateMax)` pour chaque client trouvé.
3. Restitue un résumé (nb clients traités, nb lettrages effectifs, erreurs par client) — même format que le retour de `Comptabiliser`.

## Prérequis — partagé avec TASK-050

Le binding IoC de `ILettrageReglementClient` dans `TresorerieNinjectKernel.ActiverServicesComptabilisation()` est un **prérequis commun** aux deux tâches. **Ne pas le dupliquer** : s'il a déjà été fait pour TASK-050, cette tâche le réutilise tel quel.

## Fichiers concernés

- `GRC.Infrastructure/Services/ReglementService.cs` — nouvelle méthode, ex. `LettrerParPeriode(int societeId, int[] caissesList, DateTime dateMin, DateTime dateMax)`.
- `GRC.API/Controllers/ReglementController.cs` — nouvel endpoint, ex. `[HttpPost("lettrer-periode")]`, même pattern d'extraction `SocieteId`/`Caisses` que [ReglementController.cs:57-58](../GRC.API/Controllers/ReglementController.cs#L57-L58) (route `GetReglements`).
- `gocom-web/src/App.tsx` (ou composant dédié à la liste des règlements) — nouveau bouton + petit formulaire deux dates (à côté du bouton « Comptabiliser » existant, [ReglementController.cs:93-94](../GRC.API/Controllers/ReglementController.cs#L93-L94) pour le pendant back).

## Étapes d'implémentation

1. **Résoudre les clients distincts de la période, dans le périmètre autorisé** : réutiliser `ReglementClientRepository.GetAll(societeId, dateMin, dateMax, caissesList)` (même repo/pattern que `GetReglements`/`GetDistinctReglements`, [ReglementService.cs:38-58](../GRC.Infrastructure/Services/ReglementService.cs#L38-L58)) puis `.Select(r => r.ClientNo).Distinct()`. **Ne pas balayer tous les clients de la société sans restriction caisses** — respecter la même autorisation que le reste de l'écran.
2. **Résoudre `ILettrageReglementClient`** via le kernel (même prérequis binding que TASK-050).
3. **Boucler séquentiellement** sur les clients distincts (pas de `Parallel.ForEach`) : chaque appel `Lettrer(clientNo, dateMin, dateMax)` ouvre son propre `TransactionScope(Serializable)` sur potentiellement plusieurs exercices — cumuler du parallélisme ici reproduirait exactement le risque déjà écarté en TASK-048 (contention/MSDTC), en pire (transactions plus longues, multi-exercices). **Séquentiel par défaut, à ne changer que si un besoin de perf réel est démontré.**
4. **Gestion d'erreur par client** (pattern `Comptabiliser`) : un client en échec (ex. `GetClient` introuvable — cas normal si le client a été supprimé/fusionné entre-temps) ne doit pas interrompre le traitement des autres clients. Capturer, logger, remonter dans une liste d'erreurs nommées par client.
5. **Retour structuré** : `{ success, clientsTraites, clientsAvecLettrage, errors[] }` (ou équivalent), affiché côté front en résumé (toast ou modal), pas juste un booléen brut.
6. **Front** : bouton dédié, formulaire deux dates (proposer par défaut les dates de filtre déjà actives dans la liste, si présentes, sans obliger l'utilisateur à les ressaisir — à la discrétion du worker), confirmation avant lancement (opération non triviale : balaie potentiellement plus que ce qui est affiché, cf. avertissement ci-dessus — le prévenir explicitement dans le libellé du bouton ou une info-bulle).

## Contraintes

- **Ne pas modifier la DLL** ni recoder la logique d'intersection exercice/période ou la règle d'équilibre — appeler `Lettrer(clientNo, dateMin, dateMax)` telle quelle.
- **Respecter le scoping caisses/société** de l'utilisateur connecté — ne jamais lettrer des clients hors du périmètre auquel l'utilisateur a accès dans l'écran règlements.
- Aucun `UPDATE` SQL brut sur les tables pilotées par la DLL.
- Respecter la Clean Architecture (Domain ← Application ← Infrastructure/API).
- Cohérence avec TASK-050 : les deux tâches partagent le même binding IoC et la même politique « pas de parallélisme sur les appels au moteur de lettrage natif ».

## Risques / dépendances

- **Effet plus large que la vue courante** (cf. avertissement ci-dessus) : à documenter clairement dans l'UI pour éviter toute surprise PO/utilisateur (« ce bouton peut lettrer des règlements non visibles dans la liste actuelle »).
- **Performance** : nombre de clients distincts sur une période large potentiellement élevé × un `TransactionScope(Serializable)` multi-exercices par client → opération potentiellement longue. Envisager un indicateur de progression ou un traitement asynchrone si les volumes réels s'avèrent problématiques (à mesurer, pas à anticiper par une optimisation prématurée).
- **Confusion de nommage** (déjà signalée en TASK-050) : bien nommer le bouton pour ne pas le confondre avec le « lettrage » du module de rapprochement bancaire (mécanisme homonyme mais totalement différent, propre à GRC_WEB).
- **Dépendance dure au binding IoC** de TASK-050 : si TASK-050 est reportée/rejetée, cette tâche est bloquée aussi (même prérequis).

## Checklist VALIDATION (à remplir dans VERIFY/)

- [ ] Build back + front OK (0 erreur)
- [ ] Endpoint `lettrer-periode` respecte le scoping société/caisses (un client hors périmètre caisses de l'utilisateur n'est jamais traité)
- [ ] Période avec plusieurs clients ayant des règlements totalement affectés → tous lettrés, résumé correct (`clientsAvecLettrage` cohérent)
- [ ] Client dans la période mais sans règlement totalement affecté → traité sans erreur, simplement aucun lettrage
- [ ] Client introuvable/erreur individuelle → n'interrompt pas le traitement des autres clients, erreur remontée nommément
- [ ] Aucun appel parallèle au moteur de lettrage (boucle séquentielle vérifiée dans le code)
- [ ] Bouton front affiche clairement l'avertissement « peut lettrer au-delà des lignes actuellement affichées »
- [ ] Aucune régression sur TASK-050 ni sur la comptabilisation (TASK-048)
