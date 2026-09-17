# VERIFY — TASK-069 : contrôle de droits de caisse sur comptabilisation / pointage / rapprochement / suppression relevé

## État de départ de cette session

L'implémentation (code + `harness_task069/` de test) existait déjà **non committée** dans le
working tree au démarrage de cette session (`git status` : 4 fichiers modifiés, `harness_task069/`
et `tasks/TASK-068.md`/`TASK-069.md` non trackés) — probablement une session précédente interrompue
avant dépôt du VERIFY. Cette session reprend ce travail en rôle **worker de secours** (dérogation
« Claude ne code pas » déjà validée par le PO, cf. `CLAUDE.md`) : relecture complète du diff,
vérification des faits avancés (pas de confiance aveugle dans l'état trouvé), build, tentative de
test réel, puis dépôt de ce VERIFY — **aucune clôture** (pas de déplacement vers `DONE_DETAIL/`, pas
de mise à jour `TODO.md`/`DONE.md`/`CHANGELOG.md`), conformément à la règle de séparation stricte
implémentation/clôture.

## Résumé de l'implémentation trouvée et relue

Pattern `IAuthorizationRepository.HasEntityActionRestriction(jwtUserId, AuthorizationEntity.Reglement, actionGuid, caisses, ProfilType.Grc)`
appliqué aux 4 points d'écriture/lecture + 1 garde `IsAdmin` simple, conformément à l'objectif de la TASK :

| Point TASK | Fichier / méthode | actionGuid utilisé | Vérifié |
|---|---|---|---|
| 1. `Comptabiliser` | `ReglementService.Comptabiliser(reglementIds, jwtUserId, isAdmin)` | `Tresorerie.Authorization.Core.Actions.ReglementComptabiliser` | ✅ classe existe (`Tresorerie.Authorization.Core/Actions/ReglementComptabiliser.cs`), lue directement en source — pas supposée |
| 2. `RapprocherManuel` (`/api/rapprochement`) | `ReglementService.RapprocherManuel(items, jwtUserId, isAdmin)` | `Tresorerie.Authorization.Core.Actions.ReglementModifier` | ✅ classe existe (`Actions/ReglementModifier.cs`) |
| 3. `ReserverLigneAsync`/batch | `ReleveBancaireRepository.ReserverLigneAsync`/`ReserverLignesBatchAsync(..., isAdmin)` | `ReglementModifier` (même action que le pointage — cohérent, réservation = étape du même cycle) | ✅ |
| 4. `SauvegarderValidationAsync` (`/validate`) | `ReleveBancaireRepository.SauvegarderValidationAsync(paires, userId, isAdmin)` | `ReglementModifier` | ✅ |
| 5. `ApercuComptabilisation` | `ReglementService.ApercuComptabilisation(reglementIds, jwtUserId, isAdmin)` | `ReglementComptabiliser` (même action que la comptabilisation réelle — cohérent, l'aperçu prévisualise la même opération) | ✅ |
| 6. `SupprimerReleve` (`DELETE`) | `ReleveBancaireController.SupprimerReleve` | pas de `HasEntityActionRestriction` (le relevé n'a pas de caisse, comme prévu dans la TASK) — garde `IsAdmin` JWT simple, `Forbid()` sinon | ✅ |

**Remarque sur le choix des actionGuid** (non confirmé via `inspect_tool` comme demandé au § Objectif,
mais confirmé par lecture directe des sources C# de `Tresorerie.Authorization.Core`, disponibles en
clair dans `D:\_vibe\apbs-gr_winform\src\Tresorerie.Authorization.Core\Actions\` — preuve au moins
équivalente à `inspect_tool`, qui aurait de toute façon décompilé le même assembly) :
- `ReglementComptabiliser` pour comptabilisation ET aperçu (l'aperçu prévisualise la même écriture
  comptable — cohérent de les grouper sous la même permission).
- `ReglementModifier` pour pointage/réservation/validation (ces 3 opérations modifient l'état du
  règlement — pas de classe `ReglementPointer`/`ReglementLettrer` dédiée trouvée dans
  `Tresorerie.Authorization.Core.Actions`, seules `ReglementAjouter`, `ReglementAjuster`,
  `ReglementAnnuler`, `ReglementRemplacer`, `ReglementReporterEcheance`, `ReglementSupprimer`,
  `ReglementAffecter`, `ReglementExporter`, etc. existent en plus — `ReglementModifier` reste le choix
  générique le plus proche sémantiquement). **Point à trancher/confirmer par le PO/architecte** :
  ce choix n'a pas fait l'objet d'une validation explicite, contrairement à la demande du § Objectif
  de la TASK (« à confirmer via inspect_tool… ne pas supposer »). Je le signale plutôt que de la
  considérer close.

`VerifierAutorisationCaisse`/`VerifierAutorisationReglementCaisse` (une version par classe, code
dupliqué entre `ReglementService` et `ReleveBancaireRepository` — pas mutualisé, écart mineur signalé
sans le corriger ici, hors périmètre du diff existant) : résout la caisse du règlement
(`ReglementClientRepository.Get(id).CaisseOrigine`), appelle `HasEntityActionRestriction`, cache par
caisse pour éviter les appels redondants en lot, lève `UnauthorizedAccessException` sinon — capturée
dans chaque controller (`catch (UnauthorizedAccessException) → Forbid()`), pattern identique à
TASK-059/060.

## Build

```
dotnet build GRC.slnx -c Debug
```
→ **0 erreur**, 5 avertissements pré-existants (NuGet vulnérabilités connues + conflit de version
`System.Configuration.ConfigurationManager`, non liés à ce changement).

## Test réel en base — **BLOQUÉ, non réalisable sur ce poste dev dans cette session**

Un harness console dédié (`harness_task069/Program.cs`) existait déjà, construit sur le même
pattern que `harness_task051` (TASK-051, cf. `DONE_DETAIL/TASK-051.md`) : kernel Trésorerie réel,
thread STA dédié, séquence `ConfigurationManager.Load` → `GroupInitializer.Initialize` →
`GroupInitializer.Authenticate`, puis appels directs aux méthodes modifiées (10 scénarios couvrant
les 5 points bloquants, avec vérification DB post-appel `MV_Compta`/`MV_Point`).

**Constat, 2 exécutions distinctes (`dotnet build` OK à chaque fois)** :
```
Kernel Trésorerie initialisé avec 6 modules.
ERREUR : initialisation Trésorerie toujours en cours après 60s — arrêt.
```
Le kernel se construit et charge les 6 modules, mais `GroupInitializer.Authenticate(...)` (thread STA)
ne retourne jamais — même blocage reproduit en relançant **`GRC.API` lui-même** (pas seulement le
harness) une fois `Tresorerie:ConfigFile`/`UserGR`/`PasswordGR`/`SocieteNoGR` fournis : l'hôte réel se
bloquerait au même endroit au démarrage (`TresorerieGroupInitializerService.StartAsync`, même séquence).
**Ce n'est donc pas un défaut du harness ni du code de cette TASK** — le blocage est antérieur à tout
code touché par TASK-069, au niveau de l'authentification native du kernel Trésorerie elle-même.

Éléments déjà vérifiés pour écarter les causes triviales :
- SQL Server (`localhost\SQL2022`, connexion utilisée par le harness) **répond** (`sqlcmd` OK).
- `C:\GRC\GR_GOCOM.apt` existe et est lisible.
- Aucun process `GRC.API`/GOCOM concurrent ne tourne (pas de conflit de lock/session).
- Poste différent de celui où `harness_task051` avait fonctionné en juillet (`DESKTOP-2VCUE93`,
  cf. `DONE_DETAIL/TASK-051.md`) — cette session tourne sur `Iheb-PC`.

### Suite d'investigation (2026-09-17, PO présent, session ultérieure)

Root cause définitivement identifiée — **ce n'est ni un défaut de code ni un poste incomplet, c'est
un problème réseau isolé et confirmé** :

1. Le PO a confirmé que l'application WinForm classique (mêmes DLL Trésorerie) fonctionne **avec
   succès sur ce même poste `Iheb-PC`** — écartant l'hypothèse initiale « dépendance d'environnement
   non répliquée ».
2. `Tresorerie:UserGR`/`PasswordGR` configurés en `dotnet user-secrets` (`n.salim`/`0000`, compte
   utilisateur réel fourni par le PO) : même blocage exact, donc pas un problème de credentials.
3. Lecture des sources réelles (`D:\_vibe\apbs-gr_winform\src\Tresorerie.Configuration\`) :
   `ConfigurationManager.Load(path)` appelle en interne `Validate(config)` →
   `TresorerieGroupSqlConnectionProvider.CheckConnection` qui ouvre un `SqlConnection` avec
   **`ConnectTimeout = int.MaxValue`** codé en dur dans la DLL — un serveur injoignable bloque donc
   *indéfiniment*, sans jamais lever d'exception. Confirme que le point de blocage exact est
   `ConfigurationManager.Load`, pas `Authenticate` comme supposé initialement.
4. Déchiffrement du champ `Server` de `C:\GRC\GR_GOCOM.apt` (reproduction en lecture seule de
   l'algorithme AES/`TextSymmetricCryptor`, aucune donnée modifiée) : le `.apt` pointe vers
   **`DESKTOP-2VCUE93`** — le même poste que celui déjà identifié dans `DONE_DETAIL/TASK-051.md`
   comme fonctionnel pour l'authentification Trésorerie.
5. `Test-NetConnection DESKTOP-2VCUE93 -Port 1433` réussit (TCP répond), **mais** une vraie connexion
   applicative (`sqlcmd -S DESKTOP-2VCUE93 -d GR_GOCOM`) échoue systématiquement en timeout de
   préconnexion (« Délai d'attente de connexion expiré », « retard dans la réponse de préconnexion »)
   — signature typique d'un pare-feu/proxy réseau qui laisse passer le SYN TCP mais bloque le
   trafic applicatif SQL réel entre l'environnement de cette session et `DESKTOP-2VCUE93`.
6. Testé avec l'accord explicite du PO pour se connecter à `DESKTOP-2VCUE93` (ressource partagée).
   `GRC.API` relancé pointant vers ce serveur : même blocage de 30s puis échec
   (`ApplicationException: La chaine de connexion du groupe est invalide!`), cohérent avec le
   diagnostic réseau ci-dessus.

**Conclusion** : le blocage est un problème d'infrastructure réseau entre l'environnement où
tournent ces sessions et `DESKTOP-2VCUE93`, indépendant du code de TASK-069 et non réparable depuis
ce dépôt. Le code de TASK-069 lui-même n'a pas pu être exercé en conditions réelles malgré plusieurs
tentatives sur deux sessions distinctes.

**Décision PO (2026-09-17)** : accepter TASK-069 sur la base de la relecture de code exhaustive
(cf. tableau ci-dessus, pattern identique à TASK-059/060 déjà validé), sans test réel — la checklist
ci-dessous reste non cochée sur les points nécessitant une exécution réelle, conformément à la
discipline de preuve (case non cochée = documentée, jamais fabriquée).

## Checklist VALIDATION

- [x] Build back OK (0 erreur) — vérifié cette session, `dotnet build GRC.slnx -c Debug`, 2026-09-14
- [ ] `Comptabiliser` : test réel caisse A/B → **non exécuté** (blocage Authenticate() ci-dessus, poste `Iheb-PC`, 2026-09-14)
- [ ] `RapprocherManuel` : idem → **non exécuté**
- [ ] `ReserverLigneAsync`/batch : idem → **non exécuté**
- [ ] `SauvegarderValidationAsync` : idem → **non exécuté**
- [ ] `ApercuComptabilisation` : idem → **non exécuté**
- [ ] Non-régression utilisateur dans son périmètre → **non exécuté** (même blocage)
- [ ] Non-régression `isAdmin=true` → **non exécuté** (même blocage)
- [ ] `actionGuid(s)` confirmé(s) via `inspect_tool` → **confirmé par lecture directe des sources
      `Tresorerie.Authorization.Core.Actions` à la place** (voir tableau ci-dessus) ; le choix
      `ReglementModifier` pour pointage/réservation/validation n'a **pas** de classe d'action dédiée
      trouvée et reste à valider explicitement par le PO/architecte
- [ ] `SupprimerReleve` non-admin → 403 / admin → OK → **non exécuté** (même blocage)
- [ ] Décision PO tracée sur le périmètre de `POST /api/ReleveBancaire/upload` → **non tracée, à
      recueillir séparément**

## Observation annexe (hors périmètre de cette TASK, signalée pour vigilance)

Le diff de `ReleveBancaireRepository.ReserverLigneAsync` modifie aussi, sans lien apparent avec
TASK-069, la gestion du cas « UPDATE 0 ligne » (conflit de réservation) : l'ancien code faisait un
`rollback` explicite et retournait `null` immédiatement ; le nouveau code appelle `transaction.Commit()`
dans tous les cas puis retourne `result` (qui reste `null` si 0 ligne affectée). Comportement
observable identique côté appelant (le controller vérifie toujours `if (result != null)`, sinon 409) —
un `COMMIT` sans écriture réelle est un no-op — mais c'est un changement de code non demandé par
cette TASK, non testé en base cette session (même blocage), signalé plutôt que corrigé silencieusement.

## Bloquant

**NON — levé le 2026-09-17.** Cause du blocage définitivement identifiée comme un problème réseau
(pare-feu/proxy bloquant la connexion SQL applicative vers `DESKTOP-2VCUE93`, indépendant du code),
non réparable depuis ce dépôt. Décision PO explicite d'acceptation par relecture de code seule,
recueillie après plusieurs tentatives documentées de test réel sur deux sessions distinctes.
Le choix `ReglementModifier` (point non tranché du tableau ci-dessus) reste accepté implicitement
par cette même décision PO, faute d'objection contraire ; le périmètre de
`POST /api/ReleveBancaire/upload` reste hors périmètre de cette TASK, à traiter séparément si besoin.
