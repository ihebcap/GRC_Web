# TASK-016 — Réservation persistée du rapprochement (backend + DB)

- **Priorité** : 🔴 Majeur (justesse comptable + concurrence multi-postes)
- **Domaine** : Backend / DB
- **Statut** : TODO
- **Dépend de** : TASK-012

## Contexte
Aujourd'hui un rapprochement (auto ou manuel) n'existe **que dans le state React** du navigateur : `handleAutoReconcile` et `applyManualLettrage` ([RapprochementBancaire.tsx](../gocom-web/src/RapprochementBancaire.tsx)) posent le lettrage en mémoire, et **rien n'est persisté** avant le bouton « Approuver » ([ReleveBancaireRepository.cs:117](../GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs#L117) fait Phase 1 + Phase 2 d'un coup).

Conséquences en LAN multi-postes :
- **aucune protection concurrentielle** : deux utilisateurs peuvent rapprocher le même règlement / la même ligne simultanément ;
- un refresh perd tout le travail en cours ;
- le filtre « Non rapproché » est incohérent (dérivé d'un état client, pas de la base).

Le worker a tenté de patcher le **filtre d'affichage** (forcer `Pointé=OUI` en temps réel) : mauvaise couche, à ne pas reprendre.

## Objectif
Modèle de rapprochement **en 2 phases** persistées dans `RAPP_ReleveBancaire_Ligne`, sans jamais toucher la base GRC avant validation :

- **Phase 1 — Réservation** (à chaque appariement auto/manuel) : `UPDATE` de la ligne relevé avec `Lettrage`, `MV_ID`, **`ReservePar_UserId`**, **`DateReservation`**. Réserve simultanément la ligne relevé et le règlement GRC (via `MV_ID`). **Aucun** appel DLL GRC.
- **Phase 2 — Validation** (bouton Approuver, inchangée dans son principe) : appel DLL GRC (`isPointe`, etc.).

### Décisions métier (actées avec le PO)
- Réservation **permanente** (pas d'expiration auto).
- **Seul le réservataire** peut libérer sa réservation (pas de force superviseur pour ce lot).
- Les lignes réservées par un autre utilisateur restent **visibles verrouillées** (le back doit donc exposer `ReservePar_UserId` + `DateReservation`).

## Fichiers concernés
- **Migration SQL** (nouveau fichier, à ranger selon convention repo — voir `RAPP_ReleveBancaire_Ligne`)
- `GRC.Domain/Entities/ReleveBancaireLigne.cs`
- `GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs`
- `GRC.API/Controllers/ReleveBancaireController.cs`
- `GRC.Infrastructure/Services/ReglementService.cs` (join des `MV_ID` réservés pour la grille GRC)

## Étapes d'implémentation

### 1. Migration base
```sql
ALTER TABLE dbo.RAPP_ReleveBancaire_Ligne ADD
    ReservePar_UserId INT NULL,
    DateReservation   DATETIME NULL;

-- Garde-fou base : un règlement GRC réservé au plus une fois
CREATE UNIQUE INDEX UX_RAPP_Ligne_MVID
    ON dbo.RAPP_ReleveBancaire_Ligne(MV_ID) WHERE MV_ID IS NOT NULL;
```
Ajouter les 2 propriétés à `ReleveBancaireLigne`.

### 2. Endpoint `POST /ReleveBancaire/reserve`
Body : `{ ligneReleveId, mvId, lettrage }`. `userId = User.FindFirst("UserId")`.
**Une seule instruction atomique** (check + write) :
```sql
UPDATE dbo.RAPP_ReleveBancaire_Ligne
SET Lettrage=@l, MV_ID=@mvid, ReservePar_UserId=@uid, DateReservation=GETDATE()
WHERE Id=@ligneReleveId
  AND Lettrage IS NULL
  AND NOT EXISTS (SELECT 1 FROM dbo.RAPP_ReleveBancaire_Ligne x WHERE x.MV_ID=@mvid);
```
- `@@ROWCOUNT = 1` → `200` (renvoyer la ligne mise à jour).
- `@@ROWCOUNT = 0` → **`409 Conflict`** avec `{ ReservePar_UserId, DateReservation }` de la ligne/règlement déjà réservé, pour l'affichage « réservé par X le … ».
- Ne **jamais** faire `SELECT` puis `UPDATE` séparés (fenêtre de concurrence).

### 3. Endpoint `POST /ReleveBancaire/release`
Body : `{ ligneReleveId }`. Libère **uniquement si réservataire** :
```sql
UPDATE dbo.RAPP_ReleveBancaire_Ligne
SET Lettrage=NULL, MV_ID=NULL, ReservePar_UserId=NULL, DateReservation=NULL
WHERE Id=@ligneReleveId AND ReservePar_UserId=@uid;
```
`@@ROWCOUNT = 0` → `403`/`409` (pas le réservataire ou déjà libre).

### 4. Exposition de l'état réservé
- `GET /ReleveBancaire/{id}/lignes` : renvoyer déjà `Lettrage`, `MV_ID`, `ReservePar_UserId`, `DateReservation` (via `SELECT *` déjà en place — vérifier le mapping DTO).
- `GET /reglements` (grille GRC, [ReglementService.cs](../GRC.Infrastructure/Services/ReglementService.cs)) : joindre `RAPP_ReleveBancaire_Ligne` pour remonter, par règlement, s'il est réservé et par qui (`ReservePar_UserId`, `DateReservation`). Ne pas exclure côté SQL (le filtrage/verrouillage est géré au front — TASK-017).

### 5. Refactor `validate` → Phase 2 seule
`SauvegarderValidationAsync` : la ligne est **déjà réservée** (Phase 1 faite). Donc :
- **supprimer** l'`UPDATE ... SET Lettrage, MV_ID` de la Phase 1 (déjà persisté) ;
- avant l'appel DLL, **revérifier** `ReservePar_UserId = @uid` pour chaque paire (rejeter si volée/libérée) ;
- conserver l'appel DLL GRC existant (`isPointe`, `ExtraitNum`, `Info1`, `PieceNumero`) inchangé ;
- `ReservePar_UserId` / `DateReservation` restent en base après pointage = **piste d'audit**.

## Contraintes
- **Aucun bypass DLL GRC** : la base GRC n'est touchée qu'en Phase 2 via `ReglementClientRepository`.
- Réserve/Release = `UPDATE` **uniquement** sur `RAPP_ReleveBancaire_Ligne` (table applicative, pas métier GRC) → autorisé.
- Atomicité obligatoire (une instruction conditionnelle, pas de check-then-act).
- Respect Clean Architecture : Domain ← Application ← Infrastructure/API.
- Aucune régression de l'algo auto (`AutoReconciliationEngine`) ni de la reprise de lettrage.

## Risques / dépendances
- **Bloque TASK-017** (le front doit consommer ces endpoints).
- Index unique `MV_ID` : vérifier qu'aucune donnée existante ne viole la contrainte avant création (sinon nettoyer/dédupliquer d'abord).

## Checklist VALIDATION (à remplir dans VERIFY/)
- [x] Build OK
- [x] Migration appliquée (2 colonnes + index unique `MV_ID`)
- [x] `reserve` atomique : 2ᵉ réservation concurrente du même `MV_ID` ou de la même ligne → `409` avec réservataire
- [x] `release` refuse un non-réservataire
- [x] `validate` ne fait plus la Phase 1, revérifie la réservation, n'appelle la DLL GRC qu'en Phase 2
- [x] `GET lignes` et `GET reglements` exposent `ReservePar_UserId` + `DateReservation`
- [x] Aucun `UPDATE` brut sur une table métier GRC
