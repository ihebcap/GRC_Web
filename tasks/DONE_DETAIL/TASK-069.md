# TASK-069 — Écritures/lecture GRC sans contrôle de droits de caisse (comptabilisation, pointage manuel, réservation/validation rapprochement, aperçu compta)

- **Priorité** : 🔴 Sécurité / Autorisation (constat audit architecte 2026-09-14, demande PO explicite « vérifier en profondeur les droits d'accès caisse »)
- **Domaine** : Backend (`GRC.Infrastructure/Services/ReglementService.cs`, `GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs`, `GRC.API/Controllers/ReglementController.cs`, `GRC.API/Controllers/ReleveBancaireController.cs`)
- **Dépend de** : pattern déjà validé et livré par TASK-059/060 (`GenererReglementsEspece` / `GenererVersementDepuisReleveAsync`) — réutiliser à l'identique, ne rien réinventer. **Voir aussi [TASK-070](TASK-070.md)** (clé JWT codée en dur, constat du même audit 2026-09-14) : tant que TASK-070 n'est pas corrigée, un JWT forgé avec `IsAdmin=1` contourne de toute façon les contrôles de caisse ajoutés ici — TASK-070 est la faille racine, à traiter en priorité ou en parallèle, pas après.
- **RISK : CRITICAL** — bypass de cloisonnement caisse sur des écritures réelles en base GRC (comptabilisation Sage, pointage, lettrage).

## Contexte

[[autorisations-utilisateur-kernel-vs-jwt]] (mémoire projet, analysée sur TASK-054) a établi un fait transverse : le kernel Ninject Trésorerie est authentifié **une seule fois au démarrage** avec un utilisateur technique (`Tresorerie:UserGR`, cf. TASK-068). Toute DLL de contrôle de droits appelée sans précaution évalue donc les droits de **cet utilisateur technique**, pas ceux de l'utilisateur web connecté — et si `UserGR` est admin, les restrictions sont silencieusement contournées.

TASK-059/060 ont implémenté le contournement correct : `IAuthorizationRepository.HasEntityActionRestriction(jwtUserId, entity, actionGuid, caisses, ProfilType.Grc)`, appelé **avec le `UserId` du JWT explicitement**, avant toute création de règlement. Voir [ReglementGenerationService.cs:120-146](../GRC.Infrastructure/Services/ReglementGenerationService.cs#L120-L146) et [:351-366](../GRC.Infrastructure/Services/ReglementGenerationService.cs#L351-L366) — c'est LE pattern de référence pour cette tâche.

**Le problème** : ce pré-contrôle n'existe que pour la **génération** (création) de règlements. Toutes les étapes **suivantes** du cycle de vie d'un règlement — comptabilisation, pointage manuel, réservation/validation de rapprochement — n'ont **aucun** contrôle de droits de caisse, ni côté controller ni côté service. Un utilisateur authentifié mais restreint à une ou plusieurs caisses (`Caisses` du JWT) peut agir sur des règlements d'une caisse à laquelle il n'a pas accès, du moment qu'il en connaît (ou devine) l'identifiant — la grille (`GetReglements`/`GetDistinctReglements`, correctement scopée par `caissesList`) ne les affiche pas, mais les endpoints d'écriture ne vérifient rien : IDOR classique.

Périmètre confirmé par lecture directe du code (pas supposé) :

### 1. Comptabilisation — `POST /api/reglements/comptabiliser`
- [ReglementController.cs:95-116](../GRC.API/Controllers/ReglementController.cs#L95-L116) : extrait `userId` **pour le log uniquement**, ne lit ni `Caisses` ni `IsAdmin`, ne les passe pas au service.
- [ReglementService.cs:292](../GRC.Infrastructure/Services/ReglementService.cs#L292) `Comptabiliser(List<int> reglementIds)` : aucun paramètre d'utilisateur/caisse dans la signature. Boucle directement sur les IDs reçus, appelle `comptabilizer.Comptabiliser(reg, ecritures)` (écriture Sage réelle, `IsComptabilise=1`) sans aucune vérification que `reg.CaisseOrigine` fait partie des caisses de l'appelant.
- **Impact** : un utilisateur restreint à la caisse A peut comptabiliser (générer des écritures comptables Sage, DocNumero, lettrage) un règlement de la caisse B, en lot, simplement en connaissant son `reglementId`.

### 2. Pointage manuel — `POST /api/rapprochement`
- [ReglementController.cs:239-253](../GRC.API/Controllers/ReglementController.cs#L239-L253) : **aucune** lecture de `UserId`/`Caisses`/`IsAdmin`, pas même pour le log. Le contrôle le plus faible des trois.
- [ReglementService.cs:644](../GRC.Infrastructure/Services/ReglementService.cs#L644) `RapprocherManuel(List<RapprochementManuelDto> items)` : idem, pose `IsPointe=true` sur n'importe quel `ReglementId` reçu, sans vérification de périmètre.

### 3. Réservation et validation du rapprochement bancaire
- `POST /api/ReleveBancaire/reserve` et `/reserve-batch` ([ReleveBancaireController.cs:192-265](../GRC.API/Controllers/ReleveBancaireController.cs#L192-L265)) → `ReserverLigneAsync`/`ReserverLignesBatchAsync` ([ReleveBancaireRepository.cs:218](../GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs#L218), [:312](../GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs#L312)) : `userId` uniquement utilisé comme identité du réservataire (verrou optimiste), jamais comme filtre d'autorisation sur `mvId`.
- `POST /api/ReleveBancaire/validate` ([ReleveBancaireController.cs:146-182](../GRC.API/Controllers/ReleveBancaireController.cs#L146-L182)) → `SauvegarderValidationAsync` ([ReleveBancaireRepository.cs:445](../GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs#L445)) : même constat — valide (pose la lettre définitive, `IsPointe`) sans vérifier que le `GrcReglementId` de chaque paire appartient à une caisse autorisée pour `userId`.
- **Impact** : un utilisateur peut réserver puis valider le rapprochement d'un règlement d'une caisse hors périmètre.

### 4. Aperçu comptabilisation — `POST /api/reglements/apercu-comptabilisation`
- [ReglementService.cs:688](../GRC.Infrastructure/Services/ReglementService.cs#L688), appelée par [ReglementController.cs:146-167](../GRC.API/Controllers/ReglementController.cs#L146-L167) : lecture seule, mais **fuite de lecture confirmée** (pas une conjecture) — un utilisateur peut envoyer n'importe quel `reglementId` et obtenir en retour le détail comptable complet (montant, client, pièce, DocNumero, écritures générées) d'un règlement d'une caisse hors périmètre, sans jamais le voir dans sa grille. Reclassé **bloquant** (même correctif que les 3 points d'écriture ci-dessus — pas de complexité supplémentaire à l'inclure dans le même lot).

### 5. Suppression d'un relevé bancaire — `DELETE /api/ReleveBancaire/{id}`
- [ReleveBancaireController.cs:285-295](../GRC.API/Controllers/ReleveBancaireController.cs#L285-L295) → `SupprimerReleveAsync` : **aucune** vérification `IsAdmin` ni d'authentification au-delà du `[Authorize]` de classe — n'importe quel utilisateur connecté peut supprimer n'importe quel relevé bancaire, protégé uniquement par la règle métier « aucune ligne en cours de rapprochement/validée » ([[suppression-releve-bancaire]]), qui n'est pas un contrôle de droits. Un relevé n'étant importé qu'une fois (pas de caisse assignée avant rapprochement), ce n'est pas un cas de cloisonnement caisse au sens strict de cette TASK, mais reste une écriture destructive sans aucune barrière d'autorisation — reclassé **bloquant a minima sur un contrôle `IsAdmin`** (pas de contrôle caisse à inventer ici, le relevé n'en a pas).

### Constat secondaire (hors caisse, observation pour vigilance — pas bloquant ici)
- `POST /api/ReleveBancaire/upload` ([ReleveBancaireController.cs:69-90](../GRC.API/Controllers/ReleveBancaireController.cs#L69-L90)) : import d'un relevé bancaire complet, ouvert à tout utilisateur connecté, aucun contrôle `IsAdmin`. Ne touche aucun règlement GRC existant (table `RAPP_ReleveBancaire_*` seulement) donc pas un trou de cloisonnement caisse — mais une question de gouvernance similaire à `DELETE` ci-dessus (qui a le droit d'importer/écraser des relevés). À signaler au PO, pas à trancher seul ; pas inclus dans la checklist bloquante de cette TASK.

**Pourquoi ce n'est pas déjà couvert par le contrôle DLL natif** : comme documenté dans [[autorisations-utilisateur-kernel-vs-jwt]], `AuthorizationService.HasRestriction` interne à la DLL évalue `SocieteManager.Utilisateur`, c'est-à-dire l'utilisateur technique `UserGR` authentifié une fois au démarrage du kernel — pas l'utilisateur web. Si un client a configuré `UserGR` en admin Sage (cas courant pour ce compte technique), le contrôle interne de la DLL ne bloque jamais rien, quel que soit l'utilisateur web réel — d'où **« selon le client y'a un trou »** : le trou existe pour tout client, mais n'est invisible que tant que `UserGR` a des droits larges (le cas le plus probable en pratique).

## Objectif

Appliquer le même pré-contrôle que TASK-059/060 (`HasEntityActionRestriction` avec le `UserId` du JWT explicite, court-circuit `isAdmin` reproduit côté GRC_WEB) sur les points 1-4, et un simple contrôle `IsAdmin` sur le point 5-bis, **avant** toute écriture ou lecture base :

1. `ReglementService.Comptabiliser` — vérifier, pour chaque règlement (ou pour l'ensemble des caisses distinctes du lot avant la boucle), que `CaisseOrigine` est autorisée pour `jwtUserId` ; rejeter (ou exclure du lot avec message explicite, à trancher avec le PO — cohérent avec le comportement « échec par facture isolé » déjà en place) les règlements hors périmètre.
2. `ReglementService.RapprocherManuel` — même contrôle avant `IsPointe=true`.
3. `ReleveBancaireRepository.ReserverLigneAsync`/`ReserverLignesBatchAsync` — même contrôle avant réservation (le `MvId` résout un règlement, donc une caisse, via `ReglementClientRepository.Get`).
4. `ReleveBancaireRepository.SauvegarderValidationAsync` — même contrôle avant validation finale.
5. `ReglementService.ApercuComptabilisation` — même contrôle avant de renvoyer le détail comptable (lecture seule, mais même règle : filtrer/rejeter les règlements hors périmètre avant de construire la réponse).
6. `ReleveBancaireController.SupprimerReleve` — ajouter un contrôle `IsAdmin` (JWT) avant l'appel à `SupprimerReleveAsync` ; pas de dimension caisse ici (le relevé n'en a pas), donc pas de `HasEntityActionRestriction` à appliquer, juste le court-circuit `isAdmin` déjà utilisé ailleurs — refuser (403) si `!isAdmin`.

Le `actionGuid` à utiliser pour chaque opération (`Comptabiliser`, `Pointer`/`Rapprocher`, `Lettrer`) est à confirmer via `inspect_tool` dans `Tresorerie.Authorization.Core.Actions` (même démarche que TASK-054/067 — ne pas supposer que `ReglementGenerer` convient aux autres actions, ni inventer une classe qui n'existe pas). Si aucune action dédiée n'existe côté DLL pour une de ces opérations, le signaler explicitement au PO/architecte plutôt que d'improviser (règle absolue du projet) — un fallback possible à documenter (pas à décider seul) serait de réutiliser `ReglementGenerer` ou de bloquer purement par appartenance caisse (`caissesList` JWT) sans passer par la DLL, à valider par le PO côté métier.

## Fichiers concernés

- `GRC.Infrastructure/Services/ReglementService.cs` — `Comptabiliser`, `RapprocherManuel`, `ApercuComptabilisation` (signatures à faire évoluer pour recevoir `jwtUserId`/`isAdmin`, comme `GenererReglementsEspece`) — les 3 sont bloquants dans cette TASK.
- `GRC.API/Controllers/ReglementController.cs` — `Comptabiliser`, `Rapprocher`, `ApercuComptabilisation` (extraire `UserId`/`IsAdmin` du JWT et les transmettre, comme déjà fait sur `GenererEspece`).
- `GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs` — `ReserverLigneAsync`, `ReserverLignesBatchAsync`, `SauvegarderValidationAsync`.
- `GRC.API/Controllers/ReleveBancaireController.cs` — `ReserveLigne`, `ReserveLignesBatch`, `ValiderRapprochement`, `SupprimerReleve` (ajout garde `IsAdmin`).

## Contraintes

- Réutiliser strictement le pattern `IAuthorizationRepository.HasEntityActionRestriction` + `isAdmin` déjà validé (TASK-059/060) — ne pas inventer un second mécanisme de contrôle.
- Ne rien changer au comportement métier existant pour un utilisateur **dans** son périmètre (aucune régression sur TASK-048/050/053 — comptabilisation, lettrage natif, DocNumero).
- Pas de contournement de sécurité, pas de `TODO`/`FIXME` laissant le trou ouvert « pour plus tard ».
- Comportement à l'échec du contrôle : suivre le pattern déjà en place (`UnauthorizedAccessException` → `403 Forbid()` côté controller, cf. `GenererEspece`/`GenererReglementVersement`), pas un 500 générique.

## Risques / dépendances

- Les points 1-5 concernent des écritures/lectures réelles en base GRC (compta Sage, `IsPointe`, lettrage) — tester en base réelle est indispensable, pas seulement en isolation (cohérent avec la discipline de preuve du projet).
- Vérifier qu'aucun flux front légitime (poste avec plusieurs caisses assignées à un même utilisateur) ne casse : le contrôle doit accepter toute caisse présente dans `caissesList` du JWT, pas une seule caisse.
- Point 6 (`SupprimerReleve`) : vérifier qu'un usage front légitime existant (suppression d'un relevé mal importé par un utilisateur non-admin) ne casse pas silencieusement — si c'est un cas réel, le signaler au PO avant de livrer plutôt que de fermer l'accès sans le dire.
- `POST /api/ReleveBancaire/upload` (import) reste hors périmètre bloquant de cette TASK (cf. constat secondaire) — à signaler au PO séparément si son ouverture à tout utilisateur pose problème.

## Checklist VALIDATION (à remplir dans VERIFY/)

- [ ] Build back OK (0 erreur)
- [ ] `Comptabiliser` : test réel avec un utilisateur JWT restreint à une caisse A tentant de comptabiliser un règlement de caisse B → refusé explicitement (403), règlement B non comptabilisé en base (vérifié `IsComptabilise` inchangé)
- [ ] `RapprocherManuel` (`/api/rapprochement`) : même test, règlement B non passé `IsPointe=true`
- [ ] `ReserverLigneAsync`/batch : même test, aucune réservation créée sur un `MvId` hors périmètre
- [ ] `SauvegarderValidationAsync` (`/validate`) : même test, aucune lettre posée sur un règlement hors périmètre
- [ ] `ApercuComptabilisation` : même test, aucun détail comptable (montant/client/pièce/DocNumero/écritures) renvoyé pour un règlement hors périmètre
- [ ] Non-régression : un utilisateur dans son périmètre caisse effectue les 4 opérations normalement (aucun changement de comportement observé, avant/après)
- [ ] Non-régression : `isAdmin=true` (JWT) continue de tout autoriser, comme aujourd'hui
- [ ] `actionGuid(s)` utilisé(s) confirmé(s) via `inspect_tool` (pas supposé), documenté dans le VERIFY
- [ ] `SupprimerReleve` (`DELETE /api/ReleveBancaire/{id}`) : test réel avec un utilisateur JWT non-admin → refusé (403) ; avec `isAdmin=1` → suppression normale inchangée
- [ ] Décision PO tracée sur le périmètre de `POST /api/ReleveBancaire/upload` (inclus dans une future tâche ou explicitement accepté tel quel)
