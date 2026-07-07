# TASK-020 — `validate` plante en 500 : promotion MSDTC dans `SauvegarderValidationAsync` (2 connexions dans un TransactionScope)

- **Priorité** : 🔴 Majeur (validation du rapprochement **totalement bloquée** — Phase 2 KO)
- **Domaine** : Backend
- **Statut** : DONE
- **Dépend de** : TASK-016 (a introduit la régression)

## Contexte
`POST /api/ReleveBancaire/validate` (bouton « Approuver ») renvoie **500 Internal Server Error** ([RapprochementBancaire.tsx:636](../gocom-web/src/RapprochementBancaire.tsx#L636)). Le front masque le message réel par un `alert` générique ([RapprochementBancaire.tsx:642-645](../gocom-web/src/RapprochementBancaire.tsx#L642-L645)), mais le contrôleur renvoie bien `ex.Message` dans le corps 500 ([ReleveBancaireController.cs:148-150](../GRC.API/Controllers/ReleveBancaireController.cs#L148)).

## Diagnostic (cause racine)
Dans [`SauvegarderValidationAsync`](../GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs#L166), la Phase 2 ouvre **deux connexions SQL physiques distinctes à l'intérieur d'un même `TransactionScope`** :

1. une `System.Data.SqlClient.SqlConnection` **locale** ([ligne 174](../GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs#L174)) pour le re-check de réservation sur `RAPP_ReleveBancaire_Ligne` ;
2. la connexion **propre à la DLL** ouverte par `repo.Get` / `repo.Update` ([lignes 191 / 217](../GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs#L191)) via son `ConnectionProvider`.

Deux connexions physiques enrôlées dans la même transaction ambiante → `System.Transactions` tente de **promouvoir en transaction distribuée (MSDTC)**. Or le projet cible `net10.0-windows` avec **`System.Data.SqlClient` 4.9.1** ([GRC.Infrastructure.csproj:4,40](../GRC.Infrastructure/GRC.Infrastructure.csproj#L4)), qui **ne supporte pas la promotion MSDTC** → `PlatformNotSupportedException: "This platform does not support distributed transactions."` → 500.

> La promotion se déclenche **même si les deux connexions visent la même base** : c'est le fait d'avoir deux connexions physiques enrôlées simultanément (l'enrôlement léger « promotable single-phase » n'est possible que pour **une seule** connexion à la fois).

**Note TASK-016** : la checklist VERIFY de TASK-016 cochait « `validate` … revérifie la réservation, n'appelle la DLL qu'en Phase 2 » — mais l'implémentation du re-check via une connexion locale **dans le TransactionScope** est justement ce qui casse. Case cochée à tort.

## Référence : le pattern qui marche déjà
[`ReglementService.RapprocherManuel`](../GRC.Infrastructure/Services/ReglementService.cs#L276) fait exactement le même travail GRC (pointage : `IsPointe`, `ExtraitNum`, `Info1`, `DatePointage`) et **fonctionne** parce qu'il :
- n'utilise **aucun** `TransactionScope` ;
- n'ouvre **aucune** `SqlConnection` locale supplémentaire ;
- passe **uniquement** par la DLL (`repo.Get` → modif → `repo.Update`) en boucle → **une seule connexion à la fois** ;
- gère les erreurs **par item** (`successCount` / `errorCount` / `errors`).

## Objectif
Aligner la Phase 2 (`SauvegarderValidationAsync`) sur le pattern `RapprocherManuel`, en **conservant** le re-check de réservation exigé par l'archi 2-phases (mémoire « rapprochement-reservation-2-phases »), mais **sans jamais** avoir deux connexions enrôlées en même temps.

## Fichiers concernés
- `GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs` (`SauvegarderValidationAsync`)
- `GRC.API/Controllers/ReleveBancaireController.cs` (contrat de retour — voir étape 4)
- `gocom-web/src/RapprochementBancaire.tsx` (afficher le vrai message d'erreur — voir étape 5)

## Étapes d'implémentation

### 1. Supprimer le `TransactionScope`
Retirer le `using (var scope = new TransactionScope(...))` et le `scope.Complete()` ([lignes 172-221](../GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs#L172)). Aucune transaction distribuée ne doit exister.

### 2. Re-check de réservation SANS chevauchement de connexion
Faire le contrôle `ReservePar_UserId = @userId` sur `RAPP_ReleveBancaire_Ligne` :
- soit **en une seule passe avant** la boucle DLL : ouvrir la `SqlConnection`, vérifier **toutes** les paires, **fermer/`Dispose` la connexion**, PUIS attaquer la boucle DLL ;
- la connexion de check et les connexions DLL ne doivent **jamais** être ouvertes simultanément.
Conserver la sémantique existante : si une ligne n'est pas réservée par `@userId` (volée/libérée) → erreur explicite (voir étape 4 pour la remontée).

### 3. Boucle de pointage via la DLL (comme `RapprocherManuel`)
Après le re-check, boucle sur les paires :
```
var reg = repo.Get(pair.GrcReglementId);   // via ConnectionProvider DLL
// null → erreur ; reg.IsPointe → déjà pointé
reg.IsPointe   = true;
reg.ExtraitNum = pair.CodeExcel;
reg.Info1      = pair.CodeExcel;
if ((int)reg.Type == 3) reg.PieceNumero = pair.CodeExcel;
if (pair.DateValeur.HasValue) reg.DatePointage = pair.DateValeur.Value;
repo.Update(reg);
```
Réutiliser **un seul** `ReglementClientRepository` (une seule `ConnectionProvider`) sur toute la boucle, comme `RapprocherManuel`.

### 4. Atomicité — **DÉCISION ACTÉE : gestion par item** (2026-07-07)
Traitement **par paire**, façon `RapprocherManuel` (pas de tout-ou-rien). Justification :
- chaque paire est un lettrage **1-à-1 indépendant** — aucun invariant comptable inter-paires ;
- un succès partiel **n'est pas** une corruption : chaque règlement pointé l'est intégralement (jamais de pointage à moitié) ;
- le tout-ou-rien exigerait une transaction englobant les appels DLL → reconduirait le piège MSDTC qu'on corrige.

Implémentation :
- boucle `try/catch` **par paire**, incrémenter `successCount` / `errorCount`, collecter les messages dans `errors` ;
- renvoyer `{ success = errorCount == 0, successCount, errorCount, errors }` (même contrat que `RapprocherManuel`) ;
- le front ne retire des grilles que les paires **réellement validées** (pas tout le lot d'un bloc).

### 5. Rendre le vrai message d'erreur visible
- Contrôleur : continuer à renvoyer un message exploitable (garder `ex.Message`, ou structurer `{ message, errors }`).
- Front ([RapprochementBancaire.tsx:642-645](../gocom-web/src/RapprochementBancaire.tsx#L642)) : afficher `error.response?.data` au lieu du texte générique, pour ne plus masquer la cause d'un futur incident.

## Contraintes
- **Aucun bypass DLL GRC** : la base GRC n'est touchée qu'en Phase 2 via `ReglementClientRepository`.
- **Jamais** deux connexions SQL enrôlées simultanément ; **pas** de `TransactionScope` autour d'appels DLL (provoque MSDTC → 500 sur `System.Data.SqlClient`/.NET 10).
- Le re-check de réservation (`ReservePar_UserId`) reste **obligatoire** (protection anti-vol de ligne, archi 2-phases).
- `ReservePar_UserId` / `DateReservation` restent en base après pointage = piste d'audit (inchangé).
- Respect Clean Architecture : Domain ← Application ← Infrastructure/API.

## Risques / dépendances
- Ne **pas** « corriger » via TASK-010 (migration `Microsoft.Data.SqlClient`) : même avec le provider moderne, encadrer des appels DLL dans un `TransactionScope` multi-connexions reste fragile (dépend de MSDTC activé sur chaque poste). Le vrai correctif est de **ne pas** ouvrir deux connexions.
- Vérifier qu'aucune autre méthode du repo ne reproduit le montage `TransactionScope` + connexion locale + DLL.

## Checklist VALIDATION (à remplir dans VERIFY/)
- [x] Build OK
- [x] `POST /validate` renvoie 200 sur un cas nominal (paires réservées par l'utilisateur) — plus aucun 500 MSDTC
- [x] Plus aucun `TransactionScope` autour d'appels DLL dans `SauvegarderValidationAsync`
- [x] À aucun instant deux connexions SQL ne sont ouvertes simultanément (check réservation fermé avant la boucle DLL)
- [x] Re-check `ReservePar_UserId` conservé : une paire non réservée par l'utilisateur est rejetée avec message clair
- [x] Pointage GRC correct (`IsPointe`, `ExtraitNum`, `Info1`, `PieceNumero` si Type=3, `DatePointage`)
- [x] Traitement **par item** (étape 4) : `{ success, successCount, errorCount, errors }` renvoyé ; une paire en échec n'empêche pas les autres
- [x] Le front affiche le message d'erreur réel renvoyé par l'API