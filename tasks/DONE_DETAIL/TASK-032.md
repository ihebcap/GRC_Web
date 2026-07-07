# TASK-032 — Compte admin (`UT_Admin`) : voir TOUS les règlements (bypass du filtre par caisses)

- **Priorité** : 🟠 Majeur (droits / périmètre données)
- **Domaine** : Back + Front (Auth / Scope)
- **Statut** : TODO
- **Dépend de** : — (indépendante ; touche le login et le filtrage règlements existants)

## Contexte
Aujourd'hui, après authentification, le login lit les caisses de l'utilisateur dans `P_UTILISATEURCAISSE` et les place dans le claim JWT `Caisses` ([Program.cs:113-126](../GRC.API/Program.cs#L113)). Toute la liste des règlements est ensuite **restreinte à ces caisses** : `ReglementController.GetReglements` / `GetDistinctReglements` lisent le claim `Caisses` et passent `caissesList` à `repo.GetAll(societeId, …, caissesList)` ([ReglementController.cs:55-56](../GRC.API/Controllers/ReglementController.cs#L55), [ReglementService.cs:33-48](../GRC.Infrastructure/Services/ReglementService.cs#L33)).

Un opérateur ne voit donc que les caisses qui lui sont affectées. Le PO veut qu'un **compte administrateur voie TOUS les règlements**, sans restriction de caisse.

## Décisions PO (actées)
1. **Source du statut admin = colonne DB `P_UTILISATEUR.UT_Admin`** (vérifiée en base : `int`, `1`=admin, `0`=normal). Aujourd'hui seul le login `Admin` (id 1) a `UT_Admin=1` ; **`PAYX` (id 2) a `UT_Admin=0`**.
2. **Périmètre admin = tout, toutes sociétés + caisses.** ⚠️ La base ne contient **qu'une seule société** (`GOCOM`) et **213 caisses** (`RT_CAISSE.SO_Id` → société). Le besoin se réduit donc **en pratique** à *voir toutes les caisses*. Le volet multi-société est traité en note de portée ci-dessous (aucune boucle inutile tant qu'il n'y a qu'une société).

## Objectif
Quand l'utilisateur connecté est admin (`UT_Admin=1`), la liste des règlements (et les valeurs distinctes) n'est plus filtrée par ses caisses : il voit **toutes les caisses de la société sélectionnée**. Comportement inchangé pour les non-admins (aucune régression).

## Fichiers concernés
- `GRC.API/Program.cs` — endpoint `/api/auth/login` : lire `UT_Admin`, ajouter un claim `IsAdmin`, renvoyer `isAdmin` dans la réponse.
- `GRC.API/Controllers/ReglementController.cs` — `GetReglements` et `GetDistinctReglements` : si admin, remplacer la scope caisses par *toutes les caisses de la société*.
- `GRC.API/Program.cs` — `/api/reference/modes` (facultatif, cohérence) : même bypass pour l'admin (sinon les modes restent restreints à ses caisses). À traiter, sinon incohérence d'affichage des filtres.
- `gocom-web/src/App.tsx` — type `User` : ajouter `isAdmin?: boolean` (déjà persisté tel quel dans `sessionStorage`, cf. `handleLogin` L81-85). Usage front minimal (voir §4).

## Étapes d'implémentation

### 1. Login — exposer le statut admin (lecture seule)
Dans `/api/auth/login`, après avoir authentifié l'utilisateur et **avec la connexion `sqlConn` déjà ouverte** ([Program.cs:114](../GRC.API/Program.cs#L114)) :
```sql
SELECT UT_Admin FROM P_UTILISATEUR WHERE UT_Id = @UserId
```
- Ne PAS dépendre du modèle de la DLL `UtilisateurRepository` pour ce champ (non prouvé) — lecture SQL explicite, déterministe. Colonne `UT_Admin` **vérifiée en base**.
- `isAdmin = (UT_Admin == 1)`.
- Ajouter le claim : `new Claim("IsAdmin", isAdmin ? "1" : "0")` dans la liste `claims` ([Program.cs:122-127](../GRC.API/Program.cs#L122)).
- Ajouter `IsAdmin = isAdmin` dans l'objet de réponse `Results.Ok(new { … })` ([Program.cs:137-151](../GRC.API/Program.cs#L137)).
- **Le claim `Caisses` reste inchangé** (vraies caisses de l'utilisateur) — ne pas gonfler le JWT avec 213 ids. Le bypass se fait côté lecture (§2).

### 2. Bypass du filtre caisses côté lecture (source de vérité serveur)
Le contournement doit être **fait côté serveur** (jamais piloté par un flag envoyé par le front — règle de sécurité). Dans `ReglementController.GetReglements` **et** `GetDistinctReglements` :
- Lire `bool isAdmin = User.FindFirst("IsAdmin")?.Value == "1";`
- Si `isAdmin` : `caissesList = ` **toutes les caisses de la société** :
  ```sql
  SELECT CA_Id FROM RT_CAISSE WHERE SO_Id = @societeId
  ```
  (récupérées via `IDbConnectionFactory` — injecter la factory dans le contrôleur, ou déléguer au service ; voir §Contraintes).
- Sinon : comportement actuel (caisses du claim).
- La liste de 213 caisses passe déjà par le **chunking >20** existant (`ReglementService` L33-44 / L238-249) — aucune régression `SqlException 8003` à craindre de ce fait.
- **Ne PAS** modifier la signature métier : on passe simplement un `caissesList` élargi à `repo.GetAll(societeId, …, caissesList)`. Aucune écriture, aucune règle métier DLL contournée.

> Alternative acceptable et plus propre (au choix du worker) : porter la logique « si admin → toutes caisses société » dans une petite méthode du `ReglementService` (Infrastructure) prenant `isAdmin` en paramètre, plutôt que dans le contrôleur. Le contrôleur reste fin, la résolution des caisses reste en Infrastructure (cohérent Clean Archi). Ne PAS mettre de SQL de résolution des caisses dans le front.

### 3. `/api/reference/modes` (cohérence des filtres)
Même principe : si `IsAdmin`, ne pas restreindre les modes aux caisses de l'utilisateur — renvoyer les modes de toutes les caisses de la société (ou tous les modes). Sinon l'admin verrait tous les règlements mais un filtre « mode » tronqué. ([Program.cs:162-184](../GRC.API/Program.cs#L162)).

### 4. Front (minimal)
- Ajouter `isAdmin?: boolean;` à l'interface `User` ([App.tsx:8-21](../gocom-web/src/App.tsx#L8)). Il est déjà persisté (l'objet complet est stocké en `sessionStorage`).
- **Aucun changement de logique d'appel requis** : le filtrage est côté serveur. `user.caisses` reste les vraies caisses ; ne PAS s'en servir pour re-filtrer l'affichage quand admin.
- ⚠️ Vérifier les endroits front qui filtrent l'UI par `user.caisses` (ex. [App.tsx:1016](../gocom-web/src/App.tsx#L1016), :1018 : options de caisses `user.caisses.includes(...) || user.caisses.length === 0`). Pour un admin, ces sélecteurs doivent proposer **toutes** les caisses : soit `isAdmin` court-circuite le `includes`, soit s'appuyer sur `caisses.length === 0` (mais l'admin peut avoir des caisses). Traiter explicitement : `user.isAdmin || user.caisses.includes(c.id) || user.caisses.length === 0`.
- (Optionnel, non bloquant) petit badge « Admin » près du nom ([App.tsx:689](../gocom-web/src/App.tsx#L689)).

## Périmètre & limite « toutes sociétés » (à acter)
La DLL `ReglementClientRepository.GetAll(societeId, …)` **exige un `societeId`**. La base n'ayant **qu'une société**, l'admin voit déjà « tout » en voyant toutes les caisses de la société sélectionnée au login.
- **Retenu pour cette TASK** : admin = toutes caisses de la société du JWT. Suffisant tant qu'il n'y a qu'une société.
- **Différé (non implémenté)** : agrégation multi-société (boucle `GetAll` sur tous les `SO_Id`). À ouvrir en TASK séparée **si** une 2ᵉ société est créée. Ne PAS coder de boucle inutile maintenant (règle : simple avant complexe, pas d'abstraction non demandée).

## Note de déploiement (hors code)
La demande évoque « utilisateur par défaut PAYX … avec un compte isAdmin ». Le login est **déjà pré-rempli à `PAYX`** ([App.tsx:126](../gocom-web/src/App.tsx#L126)). Mais **`PAYX` a `UT_Admin=0`** en base : il ne verra donc PAS tout tant que son flag n'est pas passé à `1`. Deux cas :
- Tester le comportement admin → se connecter avec le login **`Admin`** (`UT_Admin=1`).
- Vouloir que `PAYX` soit admin → **changement de donnée** (`UPDATE P_UTILISATEUR SET UT_Admin=1 WHERE UT_Login='PAYX'`), décision PO, **hors périmètre code** de cette TASK.

## Contraintes
- **Le bypass est décidé côté serveur** à partir du claim `IsAdmin` (issu de la base au login). Ne jamais accepter un flag « admin » envoyé par le client.
- Lecture seule : le seul ajout est un `SELECT UT_Admin` et un `SELECT CA_Id … WHERE SO_Id`. Aucune écriture sur `P_UTILISATEUR` / `RT_CAISSE`.
- Ne pas contourner la DLL métier : on élargit `caissesList`, on ne réécrit pas la logique de lecture des règlements.
- Respecter la Clean Architecture (Domain ← Application ← Infrastructure/API) : résolution des caisses en API/Infrastructure, jamais au front.
- Pas de secret ni serveur en dur (rappel des interdictions worker).
- Aucune régression pour les non-admins : `IsAdmin=0` ⇒ comportement strictement identique à l'actuel.

## Checklist VALIDATION (à remplir dans VERIFY/)
- [ ] Build OK
- [ ] Colonne `UT_Admin` lue au login ; claim `IsAdmin` présent dans le JWT ; `isAdmin` renvoyé dans la réponse login
- [ ] Connecté en **`Admin`** (`UT_Admin=1`) : la liste des règlements affiche des caisses **hors** de celles de l'utilisateur (toutes caisses société)
- [ ] `/reglements/distincts` : valeurs distinctes couvrent toutes les caisses pour l'admin
- [ ] `/reference/modes` cohérent pour l'admin (pas de filtre mode tronqué)
- [ ] Connecté en **non-admin** (ex. un compte avec caisses limitées) : **aucune** régression, périmètre identique à avant
- [ ] Sélecteurs de caisses du front proposent toutes les caisses quand admin
- [ ] Bypass décidé côté serveur uniquement (aucun flag admin accepté depuis le client)
- [ ] Lecture seule ; aucune écriture `P_UTILISATEUR` / `RT_CAISSE`
- [ ] Chunking >20 caisses opérationnel (213 caisses, pas d'erreur SQL 8003)
