# TASK-118 — Comptabilisation : une seule opération comptable à la fois (exclusion mutuelle serveur)

- **Priorité** : 🔴 Bloquant
- **Domaine** : Correction
- **Statut** : ✅ FAIT (approuvée sous réserve le 2026-10-02, review indépendante, sur délégation du PO ; réserves et actions post-déploiement dans `TASK-118_verify.md` § 7)
- **Dépend de** : — (aucune). TASK-048 (comptabilisation séquentielle *dans* un appel) reste en place ; cette TASK la complète *entre* appels.

## En une phrase
Deux utilisateurs qui lancent « Comptabiliser » en même temps font collisionner la DLL Sage (même numéro d'écriture alloué deux fois) : on interdit le chevauchement côté serveur, le second reçoit un refus immédiat et clair.

## Contexte (faits établis dans `grc-20261002.log`, 2026-10-02)
- Le service tourne en **un seul process** (service Windows, `DEPLOY.md` ; `TresorerieNinjectKernel` et `IDbConnectionFactory` sont des singletons, `GRC.API/Program.cs:79` et `:95`). `ReglementService` est *scoped* (`Program.cs:110`) : chaque requête a sa propre instance, donc rien ne sérialise deux requêtes.
- `ReglementService.Comptabiliser` (`GRC.Infrastructure/Services/ReglementService.cs:436`) est séquentiel **dans** un appel (boucle `foreach`, l. 490 ; justification TASK-048, l. 474-479 : la DLL Sage alloue `IEC_ECNO` = « prochain n° puis INSERT » **sans verrou**, elle n'est pas thread-safe). Cette protection ne vaut que pour un appel : deux appels simultanés = deux threads dans la DLL.
- Chronologie du 2026-10-02 (toutes les lignes sont `userId=186`, c'est-à-dire que les deux personnes utilisent le même compte, ou un seul onglet doublé) :
  - 11:38:57 appel A : `COMPTABILISATION entrée`, 3 851 règlements (log l. 73384) ;
  - 11:45:56 appel B : `COMPTABILISATION entrée`, 1 796 règlements (l. 107257), **pendant que A tourne encore** ;
  - 11:54:42 fin de B : 1 769 OK / 27 en échec ; 11:55:51 fin de A : 3 828 OK / 23 en échec.
- **Les 50 échecs** (`COMPTABILISATION ÉCHEC`, l. 107346 → 120548, de 11:46:02 à 11:53:38) sont **tous** dans la fenêtre de chevauchement (11:45:56 → 11:55) et **tous** de la même erreur : `Violation de la contrainte UNIQUE KEY « IEC_ECNO »` sur `dbo.F_ECRITUREC` (clés dupliquées 503166 … 509278). Aucun échec avant 11:46. Les listes d'identifiants de A et B sont **disjointes** (0 recoupement) et aucun règlement n'apparaît deux fois en `COMPTABILISATION OK` : pas de double comptabilisation constatée ce jour-là, mais voir « Risque aggravant » ci-dessous.
- Le run de 02:41 (appel unique, 3 239 règlements, fin 02:58:40, `errorCount = 0`) n'a eu **aucun** échec de ce type.
- **Limite avérée du verrou (log mis à jour, 12:12:59)** : un échec `IEC_ECNO` (règlement 78528) est survenu pendant qu'**un seul** appel GRC tournait et sans aucune autre opération GRC dans la fenêtre : écrivain extérieur (compta Sage) ; la TASK-118 ne peut pas le couvrir, le PO a choisi de ne pas la retenter automatiquement : l'utilisateur re-soumet à la main, d'où TASK-119 (message clair et persistant). Le verrou reste nécessaire : il supprime la cause massive (50 échecs) et le risque de double comptabilisation.
- Pendant l'appel A, 6 lots de `generer-espece` (11:39:07 → 11:40:23, même `userId`) ont tourné **sans aucune erreur** : preuve empirique que la génération n'entre pas en collision avec la comptabilisation (justifie qu'elle reste hors du verrou).
- La comptabilisation d'un règlement est **une transaction unique** dans la DLL (`ComptabilizerReglement.Comptabiliser`, `TransactionScope` englobant `_erpCompta.Comptabiliser` + `caisseManager.ComptabiliserReglement`) : un échec `IEC_ECNO` annule ce règlement en entier, ce qui rend l'absence d'écriture orpheline très probable (à confirmer, voir « Reprise »).

### Risque aggravant (non survenu, mais possible tant que le verrou n'existe pas)
La garde « déjà comptabilisé » (`reg.IsComptabilise != 0`, `ReglementService.cs:499`) est un *lire-puis-écrire* non atomique. Si le même règlement est soumis par deux appels simultanés (typique : l'utilisateur recharge la page pendant un appel de 7 à 13 minutes et relance), les deux passent la garde et le règlement est **comptabilisé deux fois**. Le verrou règle aussi ce cas, y compris quand le navigateur est fermé : la requête serveur continue jusqu'au bout (le code ne prend aucun `CancellationToken`), donc le verrou reste tenu jusqu'à la vraie fin.

## Problème constaté
Rien n'empêche deux requêtes `POST /api/reglements/comptabiliser` (ou une comptabilisation et un `lettrer-periode`) de s'exécuter en parallèle. Conséquences observées : 50 règlements non comptabilisés (erreur `IEC_ECNO`) ; conséquences possibles : double comptabilisation, lettres de rapprochement dupliquées (`GetNextLettre` = max + 1, lecture puis écriture sans verrou).

## Objectif
1. Une seule opération « comptable » à la fois dans le service : `POST /api/reglements/comptabiliser` **et** `POST /api/reglements/lettrer-periode` partagent le même verrou (les deux écrivent dans `F_ECRITUREC` / posent des verrous d'enregistrement sur les journaux Sage).
2. Si le verrou est pris : refus **immédiat** (pas d'attente), HTTP **409**, message qui dit qui, quand, quoi, depuis combien de temps.
3. Le verrou est **toujours** relâché, même en cas d'exception ou de refus d'autorisation.
4. Aucun changement de comportement quand il n'y a pas de concurrence.

## Contrat de comportement
| Situation | Résultat |
|---|---|
| Aucune opération en cours, `comptabiliser` ou `lettrer-periode` | Comportement actuel inchangé (200, mêmes champs de réponse). |
| `comptabiliser` appelé avec une liste vide ou absente | Comportement actuel inchangé (200 immédiat, résultat vide) : **pas de verrou pris**, jamais de 409. |
| Une opération est en cours, un second appel `comptabiliser` ou `lettrer-periode` arrive | **409 Conflict** en moins d'une seconde, rien n'est exécuté (aucune lecture de règlement, aucun contrôle d'autorisation, aucune écriture). |
| L'opération en cours se termine (succès, erreur, exception, 403) | Le verrou est libéré ; l'appel suivant réussit. |
| Le navigateur du premier utilisateur est fermé / la page rechargée pendant l'opération | La requête serveur continue ; le verrou reste tenu jusqu'à sa fin réelle ; un nouvel appel reçoit 409 tant qu'elle tourne. |
| `apercu-comptabilisation`, `generer-espece`, `/api/rapprochement`, `validate`, `annuler`, etc. | **Non verrouillés, comportement inchangé** (voir Périmètre). |
| Redémarrage du service | Le verrou disparaît avec le process (pas de verrou « fantôme » en base). |

**Corps de la réponse 409** : `ProblemDetails` (`Problem(detail: …, statusCode: 409, title: "Opération comptable déjà en cours")`). Le champ `detail` est **exactement** :

`Une opération comptable est déjà en cours : {operation}, lancée à {HH:mm} par l'utilisateur {userId} ({nb} élément(s), depuis {m} min). Réessayez quand elle sera terminée.`

avec `{operation}` ∈ { `comptabilisation`, `lettrage par période` }, `{HH:mm}` = heure locale du serveur de début, `{nb}` = nombre d'identifiants reçus, `{m}` = minutes écoulées (arrondi inférieur, 0 si < 1 min).
**Deux variantes exactes, choisies selon l'opération (jamais selon `Count`)** :
- comptabilisation : `Une opération comptable est déjà en cours : comptabilisation, lancée à 11:38 par l'utilisateur 186 (3851 élément(s), depuis 7 min). Réessayez quand elle sera terminée.`
- lettrage par période : `Une opération comptable est déjà en cours : lettrage par période, lancée à 11:38 par l'utilisateur 186 (depuis 7 min). Réessayez quand elle sera terminée.`

**Pourquoi `detail`** : le front lit déjà `err.response.data.detail` pour `comptabiliser` (`gocom-web/src/ApercuComptabilisation.tsx:272-275`) ; pour `lettrer-periode` il ne le lit pas (`gocom-web/src/App.tsx:646`, message générique) → à corriger (étape 5).

**Journalisation** (Serilog, mêmes conventions que l'existant) :
- refus : `LogWarning("COMPTABILISATION refusée (opération comptable déjà en cours) : userId={UserId}, détenteur={Operation}/{HolderUserId}/{StartedAt:HH:mm:ss}", …)` (idem préfixe `LETTRAGE PÉRIODE` pour l'autre route) ;
- acquisition et libération : `LogInformation` avec la durée de détention à la libération.

## Périmètre
**Dans le périmètre** : `comptabiliser`, `lettrer-periode` (même verrou).
**Hors périmètre, volontairement** :
- `apercu-comptabilisation` : lecture seule (les numéros de pièce sont forcés via `ComptaPieceContext`, `AsyncLocal`, donc isolés par requête ; vérifier en S7 qu'un aperçu pendant une comptabilisation répond toujours).
- `generer-espece`, `generer-reglement`, rapprochement, annulation : n'écrivent pas dans `F_ECRITUREC` (création/affectation de règlements, pas d'écritures comptables ; `isImporterComptabiliser = false`, `ReglementGenerationService.cs:406` et `:592`).
- Les sessions Sage (poste utilisateur), les jobs SQL Agent « Reglement Inwi », une éventuelle seconde instance de GRC.API : **non protégés par cette TASK** (verrou en mémoire du process). C'est une limite assumée, à écrire dans `ARCHITECTURE.md` (étape 6).
- Traitement du verrou de journal `[VENTES]` par la compta (cas normal) et retour `lettré=false` : voir « Constats connexes », TASKs séparées.

## Fichiers concernés
- `GRC.Application/Interfaces/IComptaExclusiveLock.cs` (nouveau) — contrat + type `ComptaLockHolder`.
- `GRC.Infrastructure/Services/ComptaExclusiveLock.cs` (nouveau) — implémentation en mémoire.
- `GRC.API/Program.cs` — enregistrement singleton (près de `:110`).
- `GRC.API/Controllers/ReglementController.cs` — `Comptabiliser` (l. 102-130) et `LettrerPeriode` (l. 134-158) ; injection dans le constructeur (l. 19).
- `gocom-web/src/App.tsx` — `handleSubmitLettragePeriode`, bloc `catch` (l. 645-647).
- `gocom-web/src/ApercuComptabilisation.tsx` — **vérification seulement** (l. 268-278), aucune modification attendue.
- `ARCHITECTURE.md` — une courte section.

## Étapes d'implémentation
1. **Contrat** (`GRC.Application/Interfaces/IComptaExclusiveLock.cs`) :
   ```csharp
   public sealed record ComptaLockHolder(string Operation, int UserId, int Count, DateTime StartedAt)
   {
       public string MessageRefus() { /* gabarit unique, voir étape 2 */ }
   }
   public interface IComptaExclusiveLock
   {
       // Prend le verrou sans attendre. true => handle à disposer (using) ; false => holder renseigné.
       bool TryEnter(string operation, int userId, int count, out IDisposable? handle, out ComptaLockHolder? holder);
   }
   ```
2. **Implémentation** (`GRC.Infrastructure/Services/ComptaExclusiveLock.cs`) : classe `sealed`, état `ComptaLockHolder? _current` protégé par un `lock` (objet privé) — **pas** de `Monitor` conservé entre appels ni de `SemaphoreSlim` avec `Wait` bloquant : le verrou doit pouvoir être relâché depuis un autre thread que celui qui l'a pris. `TryEnter` : si `_current != null` → `holder = _current`, `return false` (copie immuable, record) ; sinon pose `_current = new(operation, userId, count, DateTime.Now)` et renvoie un handle dont `Dispose()` remet `_current = null` **une seule fois** (idempotent) et journalise la durée. Le handle ne libère que s'il est encore le détenteur courant (comparaison de référence) pour qu'un double `Dispose` ne libère pas le verrou d'un autre.
   - Constantes d'opération dans le même fichier que le contrat : `public static class ComptaOperations { public const string Comptabilisation = "comptabilisation"; public const string LettrageParPeriode = "lettrage par période"; }`.
   - **Un seul gabarit de message**, porté par le record : `public string MessageRefus()` sur `ComptaLockHolder` (dans `GRC.Application`, donc utilisable par le contrôleur sans référence supplémentaire). Il choisit la variante selon `Operation` (voir Contrat) et calcule `{m}` avec `DateTime.Now - StartedAt`. Pour `lettrer-periode`, passer `count = 0` (valeur ignorée par la variante « lettrage par période »).
   - Constructeur : `ComptaExclusiveLock(ILogger<ComptaExclusiveLock> logger)` (journalise acquisition et libération avec la durée).
3. **Enregistrement** : `builder.Services.AddSingleton<GRC.Application.Interfaces.IComptaExclusiveLock, GRC.Infrastructure.Services.ComptaExclusiveLock>();` près des autres services (`Program.cs:107-111`). **Singleton obligatoire** (un scoped/transient n'exclurait rien).
4. **Contrôleur** (`ReglementController.cs`) :
   - Injecter `IComptaExclusiveLock` dans le constructeur (l. 19).
   - `Comptabiliser` (l. 102-130). **Squelette attendu** (le contenu métier existant ne change pas) :
     ```csharp
     if (!int.TryParse(User.FindFirst("UserId")?.Value, out int userId)) return Unauthorized();
     bool isAdmin = ...;                                   // inchangé
     IDisposable? verrou = null;
     if (reglementIds != null && reglementIds.Count > 0)   // liste vide : pas de verrou, comportement actuel
     {
         if (!_comptaLock.TryEnter(ComptaOperations.Comptabilisation, userId, reglementIds.Count, out verrou, out var detenteur))
         {
             _logger.LogWarning("COMPTABILISATION refusée (opération comptable déjà en cours) : userId={UserId}, détenteur={Operation}/{HolderUserId}/{StartedAt:HH:mm:ss}",
                 userId, detenteur!.Operation, detenteur.UserId, detenteur.StartedAt);
             return Problem(detail: detenteur.MessageRefus(), statusCode: 409, title: "Opération comptable déjà en cours");
         }
     }
     try
     {
         using (_logger.BeginScope(...)) { /* bloc existant, strictement inchangé (entrée, try/catch, Forbid, Problem 500) */ }
     }
     finally { verrou?.Dispose(); }
     ```
     Le `Forbid()` (l. 122) et le `Problem` 500 (l. 127) sont dans le `try` : ils relâchent donc le verrou.
   - `LettrerPeriode` (l. 134-158) : même schéma avec `ComptaOperations.LettrageParPeriode` et `count = 0`. **Piège** : ici `userId` est une **chaîne** (`var userId = User.FindFirst("UserId")?.Value;`, l. 141) et il n'y a aucun `Unauthorized()` sur `UserId`. Pour le verrou : `int.TryParse(userId, out var uid)` avec repli `uid = 0`, **sans** introduire de nouveau `Unauthorized()` ni changer les logs existants. Poser le verrou après le calcul de `isAdmin`/`caissesList` (l. 137-141), avant le `BeginScope`.
   - Le verrou est pris **avant** le pré-contrôle d'autorisation du service (`ReglementService.cs:441-456`) : un utilisateur sans droit qui reçoit un 403 relâche le verrou immédiatement via le `finally`. Conséquence assumée : un utilisateur authentifié mais non autorisé peut lire le message 409 (qui/quoi/quand) ; acceptable sur un LAN fermé, endpoint déjà protégé par `[Authorize]`.
5. **Front** — `App.tsx:645-647` : dans le `catch (err)` du lettrage par période, lire `err?.response?.data?.detail` (même motif que `ApercuComptabilisation.tsx:272-273`) et l'afficher dans le toast ; repli sur `'Erreur lors du lettrage par période'` si absent. Ne rien changer d'autre. `ApercuComptabilisation.tsx` : **ne pas modifier** ; contrôler qu'un 409 laisse l'aperçu et la sélection intacts (la branche `successCount > 0` n'est pas atteinte dans le `catch`, l. 263-267 : c'est le cas aujourd'hui).
6. **Documentation** — `ARCHITECTURE.md` : section « Opérations comptables exclusives » (à la fin du fichier, après « Sélecteur à cases à cocher ») : quels endpoints, pourquoi (DLL Sage non thread-safe, alloc `IEC_ECNO` sans verrou), message 409, **limites** (process unique ; Sage poste, jobs SQL et seconde instance non couverts), et procédure en cas de verrou bloqué (DLL gelée) : redémarrer le service Windows (le message affiche la durée de détention pour le repérer).
7. **Test de concurrence automatisé** (S2 à S6 et S11) — adapter le motif de `run_test114_via_api.ps1` (variables d'environnement `HARNESS_*`, jamais de secret en dur) en un script `run_test118_via_api.ps1` à la racine qui joue S2 à S6 contre l'API locale branchée sur la **base de test**, et S11 en chargeant `GRC.Application.dll` / `GRC.Infrastructure.dll` depuis PowerShell (aucun projet de test n'existe dans `GRC.slnx` : ne pas en créer, ne pas ajouter de dépendance).

## Contraintes
- Ne jamais bypasser une règle de sécurité ou une DLL métier GRC ; ne **pas** modifier `ReglementService.Comptabiliser`, la DLL, ni la logique d'autorisation.
- Clean Architecture : interface dans `GRC.Application`, implémentation dans `GRC.Infrastructure`, composition dans `GRC.API`.
- **Pas d'attente** (aucune file, aucun `Wait` avec délai) : un appel dure 7 à 13 minutes, une attente ferait expirer la requête HTTP.
- Pas de verrou SQL (`sp_getapplock`) ni de table de verrou : le process est unique, un verrou en base resterait « fantôme » après un plantage.
- Tests **uniquement** sur la base de TEST (DESKTOP-2VCUE93), jamais sur la prod (172.16.0.205). Identifiants par variables d'environnement.
- Pas de nouveau composant UI, pas de polling de statut (idée écartée pour rester petit ; voir « Idées notées »).

## Jeu d'essai (base de test)
- 30 règlements espèce **non comptabilisés** `R1..R30`, caisse autorisée, exercice ouvert, journal non verrouillé. Lots disjoints : `LotA = R1..R15`, `LotB = R16..R30` (~5 s par lot à 0,33 s/règlement ; si trop court pour chevaucher, prendre 60 règlements).
- Si la base de test n'a pas 30 règlements espèce non comptabilisés, en créer via `generer-espece` (motif de `run_test114_via_api.ps1`) et **les supprimer/restaurer en fin de test**.
- Deux jetons JWT distincts si possible (deux comptes), sinon deux appels du même compte (le verrou ne dépend pas du compte).
- Relever avant chaque scénario : nombre de lignes `F_ECRITUREC` de l'exercice, état de comptabilisation des `R*`, dernier `EC_No`.

## Scénarios (chacun : action → résultat attendu → **preuve**)
- **S1 — nominal, un seul utilisateur.** `comptabiliser(LotA)`. → 200, `successCount=15`, `errorCount=0`, mêmes champs qu'avant. *Preuve* : réponse JSON + log `COMPTABILISATION sortie`.
- **S2 — deux comptabilisations simultanées.** Lancer `comptabiliser(LotA)`, puis 1 s plus tard `comptabiliser(LotB)`. → A : 200 `successCount=15` ; B : **409** en < 1 s avec le `detail` exact du contrat ; `R16..R30` toujours non comptabilisés ; **0** erreur `IEC_ECNO` dans le log. *Preuve* : codes HTTP + durée du 409 + `grep IEC_ECNO` vide + état SQL de `R16..R30`.
- **S3 — comptabilisation vs lettrage période, dans les deux sens.** (a) `comptabiliser(LotB)` puis, pendant l'exécution, `lettrer-periode` → 409 (`operation = comptabilisation`). (b) `lettrer-periode` sur une grande période puis `comptabiliser` → 409 (`operation = lettrage par période`). *Preuve* : deux `detail` conformes.
- **S4 — libération après erreur d'autorisation.** Avec un compte **non admin** sans droit `ReglementComptabiliser` sur la caisse des règlements : `comptabiliser(LotB)` → 403 (`Forbid`), puis immédiatement avec un compte autorisé `comptabiliser(LotB)` → 200. *Preuve* : codes HTTP ; le log montre la libération avec durée. (Un identifiant inexistant ne convient **pas** : le service l'ignore et répond 200, il ne teste donc pas le chemin d'erreur. Le chemin 500 est couvert par S11.)
- **S5 — libération normale.** Après la fin de S1, `comptabiliser(LotB)` → 200. *Preuve* : réponse.
- **S6 — déconnexion du client pendant l'exécution.** Lancer `comptabiliser(LotA)` puis couper le client après 2 s (`curl --max-time 2` ou annulation du job). Relancer **immédiatement** le même `LotA` → 409 ; attendre la fin serveur (log `COMPTABILISATION sortie`) ; relancer `LotA` → 200 avec `successCount=0` (tous déjà comptabilisés, log `ignoré`) et **pas** de seconde écriture. *Preuve* : 409, puis 200 ; nombre d'`ErpNo` par règlement inchangé (2 par règlement espèce, comme dans le log du 2026-10-02) ; aucune ligne `F_ECRITUREC` en double pour une même pièce.
- **S7 — aperçu non bloqué.** Pendant une comptabilisation longue, `apercu-comptabilisation` d'autres règlements → 200 et contenu correct. *Preuve* : réponse. (L'aperçu est parallèle, degré 10 ; `GetNextNumero` de la DLL est un `MAX + 1` en lecture seule, `SageCompta.Core.ErpCompta.GetNextNumero` : il ne consomme aucun compteur, donc pas de collision avec la comptabilisation.)
- **S8 — génération non bloquée.** Pendant une comptabilisation longue, `generer-espece` d'une facture de test → comportement inchangé (200, règlement créé). *Preuve* : réponse + nouveau `MV_Id`. (Nettoyer le règlement créé en fin de test.)
- **S9 — front.** Comptabilisation lancée par un navigateur 1 ; navigateur 2 tente « Comptabiliser » → toast + panneau d'erreur avec le message exact, aperçu et sélection **conservés**, bouton de nouveau actif ; idem pour « Lettrer par période » (toast = `detail`, plus le texte générique). *Preuve* : capture d'écran de chaque cas.
- **S10 — non-régression.** Reprise de `LotB` (maintenant libre) → 200 ; performance par règlement comparable à celle d'avant la TASK (écart < 10 % ou explication écrite ; mesure sur les logs `COMPTABILISATION écriture` → `lettrage`, bruitée : informatif, non bloquant seul). *Preuve* : extrait de log + calcul.
- **S11 — test direct de la classe de verrou (sans API).** Charger les deux DLL, instancier `ComptaExclusiveLock` avec un logger nul : (a) `TryEnter` → `true` ; (b) second `TryEnter` → `false` et `holder` rempli (opération, utilisateur, `Count`) ; (c) `Dispose()` puis `TryEnter` → `true` ; (d) `Dispose()` **deux fois** sur le premier handle ne libère pas le verrou pris ensuite par le second ; (e) 50 `TryEnter` simultanés (`ForEach-Object -Parallel`) → **exactement un** `true` ; (f) `MessageRefus()` produit mot pour mot les deux variantes du contrat. *Preuve* : sortie du script.

## Risques et parades
| Risque | Parade |
|---|---|
| Verrou jamais relâché (exception non prévue) | `try/finally` autour de **tout** le corps ; handle idempotent ; scénario S4. |
| DLL gelée (cas connu : blocage MSDTC à l'ACK cross-machine, cf. mémoire projet) : le verrou reste tenu | Le message donne la durée (« depuis N min ») pour repérer l'anomalie ; procédure = redémarrer le service Windows (documentée, étape 6). Pas d'expiration automatique (elle rouvrirait la porte à la concurrence pendant que l'appel tourne encore). |
| Écrivain extérieur dans `F_ECRITUREC` (compta Sage) : collision `IEC_ECNO` résiduelle, non évitable par un verrou GRC | Avérée le 2026-10-02 12:12:59 (1 cas sur 3 429). L'utilisateur re-soumet à la main ; TASK-119 rend le message clair et persistant. Ne pas la compter comme un échec de S2 (S2 se joue sans écrivain extérieur). |
| Seconde instance de GRC.API sur la même base (test pointant vers la prod, nouvelle machine) | Non couverte, documentée. Si ce cas devient réel : passer à un verrou applicatif SQL dans une TASK séparée. |
| Même compte (`userId=186`) pour deux personnes : le message ne les distingue pas | Le message porte l'heure et le nombre d'éléments, suffisant pour reconnaître son propre appel. |
| Utilisateurs impatients qui relancent | Le 409 explicite remplace l'erreur silencieuse ; le message précise de patienter. |
| Un appel `comptabiliser` vide ou un `UserId` illisible dans `lettrer-periode` casserait le comportement actuel | Liste vide = pas de verrou ; `UserId` illisible en lettrage = repli `0`, aucun nouveau 401 (étape 4). |
| `Dispose` appelé deux fois ou depuis un autre thread | Handle idempotent, comparaison de référence du détenteur (étape 2). |

## Mise en production
1. Déployer **back et front ensemble** (le front corrigé affiche `detail` pour `lettrer-periode` ; avec l'ancien front le comptabiliser affiche déjà `detail`, le lettrage resterait générique : sans gravité).
2. Aucune migration SQL, aucun changement de configuration.
3. Retour arrière : redéployer le build précédent (aucun état persistant).
4. **Avant** de redéployer : s'assurer qu'aucune comptabilisation n'est en cours (le redémarrage du service interromprait l'appel ; chaque règlement est traité dans sa propre transaction, donc pas de demi-règlement, mais le lot serait incomplet).

## Reprise des dégâts du 2026-10-02 (**hors code, après déploiement**, à tracer dans le VERIFY)
- **Règlements en échec `IEC_ECNO`**, à re-soumettre à la comptabilisation (par un seul utilisateur). **État au log du 2026-10-02 12:20** : sur les 50 échecs de 11:46-11:53, **23 ont été re-soumis à 12:00:31** (23 OK, 0 erreur, aucun « ignoré » : l'échec était propre) ; il en reste **27**, et un 51ᵉ échec est apparu à 12:12:59 (**78528**, écrivain extérieur). **À re-soumettre : 28 règlements** :
  `57878, 58142, 58414, 59526, 63813, 76102, 76188, 76195, 76202, 76204, 76206, 76216, 76227, 76236, 76240, 76246, 76253, 78528, 101617, 101619, 101625, 101635, 101639, 101648, 101691, 101693, 101698, 101709`.
  (Liste d'origine de 50, pour mémoire : `57878, 58142, 58414, 59526, 63813, 73649, 73652, 73713, 73716, 73718, 73720, 73726, 73728, 73739, 73755, 73758, 73760, 75640, 75879, 76102, 76188, 76195, 76202, 76204, 76206, 76216, 76227, 76236, 76240, 76246, 76253, 76539, 76562, 78383, 80203, 88189, 88396, 95613, 95794, 100568, 101617, 101619, 101625, 101635, 101639, 101648, 101691, 101693, 101698, 101709`.)
  **Contrôle préalable en lecture seule (prod, accès fourni par le PO à la demande, `SELECT` uniquement)** : pour ces identifiants, l'état de comptabilisation du règlement (colonne lue par `ReglementClientRepository.Get` pour `IsComptabilise`) est bien « non comptabilisé » et **aucune** écriture orpheline n'existe dans `F_ECRITUREC` pour leur pièce. Si une écriture orpheline existe : **bloquer et signaler** (ne rien supprimer sans décision du PO).
- **Règlements comptabilisés mais non lettrés** : 1 709 avertissements `lettrage échoué` / `Le journal [VENTES] est en cours d'utilisation` entre 11:39:07 et 11:46:39 (1 646 de l'appel A, 63 de l'appel B). Liste dans [TASK-118_ids_lettrage_a_refaire.txt](TASK-118_ids_lettrage_a_refaire.txt). Leurs dates de règlement vont du **2026-02-18 au 2026-09-30** : « Lettrer par période » est un balayage par période et par caisses (pas par identifiants) ; choisir la période après avoir vérifié avec la compta que le journal VENTES n'est plus verrouillé. Les autres règlements des deux appels n'ont **pas** eu d'exception de verrou, mais affichent quand même `lettré=false` à cause du bug de retour de la DLL (constat 2) : leur lettrage réel est à lire dans Sage (`EC_Lettre`), pas dans le log.

## Constats connexes (hors périmètre — TASKs séparées à ouvrir, ne rien corriger ici)
1. **Verrou `[VENTES]` = cas normal (précision du PO).** Un utilisateur de la compta Sage peut légitimement verrouiller le journal VENTES (saisie en cours) : `ThrowIfJournalIsUsed` (`SageCompta.Core.ErpCompta`) lève alors `Le journal [VENTES] est en cours d'utilisation !` (`CB_IsRecordLock('F_JMOUV', id)` ≠ 0). Du 2026-10-02 de 11:39:07 à 11:46:39 il a fait échouer le lettrage des 1 709 règlements traités dans cet intervalle (1 646 de l'appel A, 63 de l'appel B), alors que leur comptabilisation avait réussi (écritures committées, seul le lettrage a été sauté, sans écriture partielle). Ce n'est pas l'appel B (il démarre à 11:45:56). Ce n'est pas un bug à corriger côté verrou ; c'est le **traitement** qui est à revoir dans une TASK séparée : (a) reconnaître cette exception précise (type `InvalidOperationException` + message) et ne pas retenter le lettrage de chaque règlement suivant tant que le journal reste verrouillé (un seul test, puis lettrage différé pour le reste du lot) ; (b) la remonter en **un seul** avertissement agrégé « N règlements comptabilisés, lettrage différé : journal VENTES verrouillé par la compta » au lieu de N traces d'exception complètes ; (c) permettre de relettrer plus tard (« Lettrer par période » existe déjà, `lettrer-periode`) sans refaire la comptabilisation.
2. **`lettré=false` systématique = bug de valeur de retour de la DLL.** Dans `LettrageReglementClient.Lettrer(int reglementNo, int[] echeancesNo, IErpExercice)` (méthode appelée par `LettrerAsync`), `bool result = false;` n'est **jamais** mis à `true`, alors que la surcharge par client le fait. `LettrerAsync` renvoie donc toujours `false`, même quand `LettreEcrituresMontant` a lettré dans Sage, et le miroir GRC (`RT_HISTCOMPTA.HC_Lettre`) n'est pas mis à jour par cette surcharge. Conséquence : le texte « non lettré (affectation partielle ou exercice clôturé) » (`ReglementService.cs:570`) est faux dans tous les cas. À vérifier : état réel `EC_Lettre` dans Sage pour des règlements de janvier, puis décider (lire l'état réel dans Sage plutôt que le booléen de la DLL).
3. **Journal de log très verbeux** : 1 709 traces d'exception complètes pour une même cause connue (4 741 `WRN`/`ERR` dans le fichier du jour). Couvert par le point 1(b).

## Idées notées (ne pas faire ici)
- `GET` de statut + bandeau « Comptabilisation en cours par X » et bouton désactivé pour tous les postes.
- Faire passer `LettrerParPeriode` / la comptabilisation sur un seul lettrage par client (gain de temps estimé : le lettrage coûte ~0,13 s par règlement sur 0,33 s).

## Checklist VALIDATION (à remplir dans VERIFY/)
Pour chaque case : date + méthode + preuve (log, requête, capture), et pour une case non cochée, la raison.
- [x] Build OK (back + front)
- [x] S1 nominal inchangé
- [x] S2 : 409 immédiat avec message exact, 0 `IEC_ECNO`, règlements du second lot intacts
- [x] S3 : exclusion dans les deux sens comptabilisation ↔ lettrage période
- [x] S4 : verrou relâché après erreur / 403
- [x] S5 : verrou relâché après succès
- [x] S6 : déconnexion client sans double comptabilisation
- [x] S7 / S8 : aperçu et génération non bloqués
- [x] S9 : front (captures, aperçu et sélection conservés)
- [x] S10 : non-régression perf (< 10 % ou explication)
- [x] S11 : test direct de la classe de verrou (a à f)
- [x] `ARCHITECTURE.md` mis à jour (limites + procédure de déblocage)
- [x] Contrôle prod en lecture seule des 50 règlements (ou raison de ne pas l'avoir fait)
- [x] Aucun credential/secret en dur introduit
- [x] Aucune dette technique silencieuse
- [x] Cohérent avec l'architecture

## Go / No-Go
- **Go** : S1 à S9 et S11 verts avec preuves (S10 informatif), aucune modification de `ReglementService.Comptabiliser` ni des DLL, front déployé avec le back.
- **No-Go** : un seul 409 renvoyé sur une liste vide, ou un seul 409 renvoyé alors qu'aucune opération ne tournait (verrou resté pris), ou un seul `IEC_ECNO` dans S2, ou un `Dispose` non garanti.
