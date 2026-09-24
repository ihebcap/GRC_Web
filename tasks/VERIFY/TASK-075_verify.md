# VERIFY — TASK-075 : Faille IDOR : endpoints de lecture ReleveBancaireController sans contrôle société/caisse

## 1. Contexte & Problème traité

À la suite de l'audit architecte du 2026-09-24, une vulnérabilité critique de type IDOR (Insecure Direct Object Reference) / fuite cross-société a été identifiée sur les trois endpoints de lecture du contrôleur `GRC.API/Controllers/ReleveBancaireController.cs` :
- `GET /api/ReleveBancaire?banqueId=...` (`GetEntetes`)
- `GET /api/ReleveBancaire/{id}/lignes` (`GetLignes`)
- `GET /api/ReleveBancaire/{id}/etat` (`GetEtatRapprochement`)

Avant cette intervention :
- Ces 3 méthodes n'extrayaient aucun claim JWT (`SocieteId`, `UserId`, `Caisses`) ; seule la présence d'un token valide était requise par l'attribut `[Authorize]`.
- Un utilisateur authentifié appartenant à la Société 1 pouvait interroger `GetEntetes?banqueId=X` avec l'identifiant d'une banque appartenant à la Société 2 et obtenir la liste complète des relevés bancaires de cette société.
- En itérant séquentiellement sur les `id` d'en-tête de relevé, un utilisateur pouvait appeler `{id}/lignes` ou `{id}/etat` pour lire des montants, libellés bancaires, références et rapprochements comptables (`ReglementCaisseNo`, `ReglementClient`, `ReglementNumero`) d'autres sociétés du groupe.

## 2. Analyse technique & Modélisation du périmètre

Conformément à l'étape 1 de la spécification :
1. **Périmètre Banque / Société** :
   Dans l'architecture GRC / Sage, une banque (`vBanque`) appartient directement à une société via `SocieteNo` (`SELECT No, SocieteNo, BanqueCode, Rib FROM vBanque`). La table `RAPP_ReleveBancaire_Entete` est liée à la banque via la colonne `BanqueId`.
2. **Dimension Caisse** :
   Comme déjà documenté et établi lors de TASK-069, un relevé bancaire brut n'a pas de dimension caisse native (`RAPP_ReleveBancaire_Entete` ne possède pas de `CaisseId`, la table `P_CAISSEBANQ` est vide / inutilisée dans l'application web, et les banques sont assignées au niveau Société, cf. endpoint `/api/reference/banques` qui filtre par `SocieteNo = @SocieteId`).
3. **Mécanisme d'autorisation retenu** :
   Réutilisation stricte du pattern établi pour TASK-059/060/069 :
   - Extraction obligatoire du claim `SocieteId` dans le token JWT (`401 Unauthorized` si absent ou invalide).
   - Validation en base de l'appartenance de la banque ou du relevé à la société de l'appelant via des méthodes dédiées dans `ReleveBancaireRepository` : `VerifierAutorisationBanqueAsync` et `VerifierAutorisationReleveEnteteAsync`.
   - En cas de non-appartenance (ou ID inexistant), levée de `UnauthorizedAccessException` par le repository, interceptée par le contrôleur pour renvoyer un statut HTTP **`403 Forbidden`** (`Forbid()`), empêchant toute énumération d'identifiants séquentiels.

## 3. Modifications apportées

### `GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs`
Ajout de deux méthodes de vérification d'autorisation :
- `VerifierAutorisationBanqueAsync(int banqueId, int societeId)` :
  Vérifie dans `[dbo].[vBanque]` que `[No] = @BanqueId AND [SocieteNo] = @SocieteNo`. Si absent ou paramètres invalides, logue un avertissement et lève `UnauthorizedAccessException`.
- `VerifierAutorisationReleveEnteteAsync(int enteteId, int societeId)` :
  Résout la banque associée au relevé et contrôle son appartenance :
  ```sql
  SELECT COUNT(1)
  FROM [dbo].[RAPP_ReleveBancaire_Entete] e
  INNER JOIN [dbo].[vBanque] b ON b.No = e.BanqueId
  WHERE e.Id = @EnteteId AND b.SocieteNo = @SocieteNo
  ```
  Si le relevé n'existe pas ou n'appartient pas à la société de l'utilisateur, logue un avertissement et lève `UnauthorizedAccessException`.

### `GRC.API/Controllers/ReleveBancaireController.cs`
Sécurisation des 3 endpoints :
- `GetEntetes([FromQuery] int banqueId, [FromQuery] bool nonRapprochesSeulement = false)` :
  - Extraction de `SocieteId` depuis `User.FindFirst("SocieteId")` (si échec -> `Unauthorized()`).
  - Appel `await _releveRepository.VerifierAutorisationBanqueAsync(banqueId, societeId)`.
  - Capture de `UnauthorizedAccessException` -> `return Forbid()`.
- `GetLignes(int id)` :
  - Extraction de `SocieteId` depuis `User.FindFirst("SocieteId")` (si échec -> `Unauthorized()`).
  - Appel `await _releveRepository.VerifierAutorisationReleveEnteteAsync(id, societeId)`.
  - Capture de `UnauthorizedAccessException` -> `return Forbid()`.
- `GetEtatRapprochement(int id)` :
  - Extraction de `SocieteId` depuis `User.FindFirst("SocieteId")` (si échec -> `Unauthorized()`).
  - Appel `await _releveRepository.VerifierAutorisationReleveEnteteAsync(id, societeId)`.
  - Capture de `UnauthorizedAccessException` -> `return Forbid()`.

## 4. Signalement annexe (hors périmètre strict de cette TASK)

Comme expressément noté dans la spécification TASK-075 :
> `POST /api/ReleveBancaire/upload` n'a pas non plus de contrôle que `banqueId` (form-data) appartient à la société de l'utilisateur — c'est une action d'écriture, contrairement aux 3 endpoints ci-dessus, mais elle n'a pas le contrôle d'autorisation caisse que les autres endpoints d'écriture du même contrôleur ont. Ne pas corriger dans cette TASK sans clarification PO — juste le signaler dans le VERIFY.

**Signalement formel** : Le endpoint `UploadExcel` accepte actuellement `[FromForm] int? banqueId` sans validation d'appartenance à `SocieteId`. Cette observation est tracée ici pour arbitrage ultérieur du PO.

## 5. Preuves de validation & Tests réels (`harness_task075`)

Un harness de test automatisé complet a été développé et exécuté : `harness_task075` (projet console exécuté avec connexion SQL réelle et instances réelles de `ReleveBancaireRepository` et `ReleveBancaireController`).

### Jeu de données injecté en base
- **Société 1** : Banque `101`, Relevé `10` avec 1 ligne d'encaissement de `1500.00 €`.
- **Société 2** : Banque `202`, Relevé `20` (confidentiel Société 2) avec 1 ligne d'encaissement de `99999.00 €`.

### Résultat de l'exécution : **22 / 22 TESTS PASSÉS AVEC SUCCÈS**

```
================================================================
=== HARNESS TASK-075 : Test d'isolation IDOR lecture relevé  ===
================================================================

[1/5] Initialisation du schéma de test dans tempdb...
    Données de test insérées : Soc 1 (Banque 101, Relevé 10), Soc 2 (Banque 202, Relevé 20)

[2/5] Test SCÉNARIO 1 : Tentatives d'IDOR cross-société (Soc 1 -> Soc 2)...
  [PASS] GetEntetes(banqueId=202) [banque hors société] doit renvoyer 403 Forbid
  [PASS] GetEntetes(banqueId=999) [banque inexistante] doit renvoyer 403 Forbid
  [PASS] GetEntetes(banqueId=0) [banqueId invalide] doit renvoyer 403 Forbid
  [PASS] GetLignes(id=20) [relevé hors société] doit renvoyer 403 Forbid
  [PASS] GetLignes(id=999) [relevé inexistant] doit renvoyer 403 Forbid
  [PASS] GetEtatRapprochement(id=20) [relevé hors société] doit renvoyer 403 Forbid
  [PASS] GetEtatRapprochement(id=999) [relevé inexistant] doit renvoyer 403 Forbid

[3/5] Test SCÉNARIO 2 : Accès légitime Société 1 (Non-régression)...
  [PASS] GetEntetes(banqueId=101) doit renvoyer 200 OK
  [PASS] GetEntetes(101) doit retourner exactement le relevé 10 de Soc 1
  [PASS] GetLignes(id=10) doit renvoyer 200 OK
  [PASS] GetLignes(10) doit renvoyer la ligne de Soc 1
  [PASS] GetEtatRapprochement(id=10) doit renvoyer 200 OK
  [PASS] GetEtatRapprochement(10) doit renvoyer l'état de Soc 1

[4/5] Test SCÉNARIO 3 : Accès légitime Société 2 et symétrie du cloisonnement...
  [PASS] User Soc 2 : GetEntetes(101) [Soc 1] doit renvoyer 403 Forbid
  [PASS] User Soc 2 : GetLignes(10) [Soc 1] doit renvoyer 403 Forbid
  [PASS] User Soc 2 : GetEtatRapprochement(10) [Soc 1] doit renvoyer 403 Forbid
  [PASS] User Soc 2 : GetEntetes(202) doit renvoyer 200 OK
  [PASS] User Soc 2 : GetLignes(20) doit renvoyer 200 OK
  [PASS] User Soc 2 : GetEtatRapprochement(20) doit renvoyer 200 OK

[5/5] Test SCÉNARIO 4 : Sécurité JWT (claim SocieteId absente)...
  [PASS] GetEntetes sans claim SocieteId doit renvoyer 401 Unauthorized
  [PASS] GetLignes sans claim SocieteId doit renvoyer 401 Unauthorized
  [PASS] GetEtatRapprochement sans claim SocieteId doit renvoyer 401 Unauthorized

================================================================
=== BILAN DU HARNESS : 22/22 TESTS PASSÉS AVEC SUCCÈS ===
================================================================
```

### Compilation finale
`dotnet build GRC.slnx` -> **0 Erreur**.

## 6. Checklist de validation

- [x] Build OK (0 erreur sur l'ensemble de la solution `GRC.slnx`).
- [x] Test réel : un utilisateur A (société 1) ne peut plus lire les relevés/lignes/état d'une banque hors de son périmètre (403 Forbid constaté et testé sur `GetEntetes`, `GetLignes`, `GetEtatRapprochement`).
- [x] Test réel : le même utilisateur A continue de lire normalement les relevés de son propre périmètre (200 OK avec données intactes, pas de régression fonctionnelle).
- [x] Test réel : absence de token ou claim `SocieteId` manquant renvoie 401 Unauthorized.
- [x] Aucun credential/secret en dur introduit.
- [x] Aucune dette technique silencieuse.
- [x] Cohérent avec l'architecture (réutilisation du pattern d'autorisation du repository et des codes HTTP 401/403 du contrôleur).
- [x] Constat annexe `UploadExcel` formellement signalé dans ce rapport sans modification hors périmètre.
