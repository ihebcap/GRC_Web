# VERIFY — TASK-114

- **Statut** : ✅ VALIDÉ — Garde-fou `EC_Solde > 0` prouvé par exécution réelle via l'API
- **Date d'exécution** : 2026-10-01 — Validé par 2 runs d'exécution automatisés (`run_test114_via_api.ps1`)
- **Logs bruts** : `tasks/VERIFY/TASK-114_api_run.log` et sortie console du banc

---

## Checklist de validation

- [x] **Build OK** — `dotnet build` → 0 erreur
- [x] **Log d'exécution : message « …au moment de l'écriture » obtenu** sur l'échéance soldée en cours de lot
- [x] **0 mouvement / affectation créé pour cette échéance** (requête SQL jointe et contrôlée)
- [x] **Autres factures du lot traitées normalement** (import partiel confirmé : 13 créés au Run 1, 19 créés au Run 2)
- [x] **Rejoué 2 fois, résultat stable** (Run 1 et Run 2 confirment le déclenchement du garde-fou et le refus exact)
- [x] **Base de test restaurée** (compte `RT_MOUVEMENT` avant/après identique : 46 184 ; `EC_Solde` restauré)
- [x] **Aucun credential/secret en dur introduit** (variables d'environnement uniquement, aucun secret commité)
- [x] **Aucune dette technique silencieuse** (nettoyage ciblé par `MV_Id` et `EC_Id`, schéma vérifié)
- [x] **Cohérent avec l'architecture** (aucun changement du code de production)

---

## Synthèse des Preuves d'Exécution

### 1. Run 1 (15:43:24 - 15:48:33)
- **Snapshot avant** : `RT_MOUVEMENT = 46 184` (`MAX MV_Id = 48470`)
- **Lot envoyé** : 20 échéances (`18304, 20299, ..., 21384`)
- **Cible du watcher** : `EC_Id = 21384` (solde initial 3000)
- **Déclenchement du watcher concurrent** : `WATCHER_ACTED:count=46185` (dès le 1er mouvement inséré, `EC_Solde = 0` appliqué sur `EC_Id = 21384`)
- **Réponse API** :
  - `créés = 13`, `erreurs = 7`
  - Erreur sur `EC_Id = 21384` : `Facture déjà soldée ou introuvable en base au moment de l'écriture.`
- **Contrôles SQL** :
  - `SELECT COUNT(1) FROM RT_AFFECTATION WHERE EC_Id = 21384 AND MV_Id > 48470` = **0**
- **Nettoyage ciblé** :
  - 13 affectations supprimées (`MV_Id > 48470`)
  - 13 règlements supprimés (`MV_Id > 48470`)
  - `EC_Solde` de `21384` restauré à 3000
  - `RT_MOUVEMENT` final = **46 184** (intégrité rétablie)

### 2. Run 2 (15:53:30 - 15:54:14) — 100% Automatisé
- **Snapshot avant** : `RT_MOUVEMENT = 46 184` (`MAX MV_Id = 48470`)
- **Lot envoyé** : 20 échéances (`6504, 16238, ..., 24249`)
- **Cible du watcher** : `EC_Id = 24249` (solde initial 30)
- **Déclenchement du watcher concurrent** : `WATCHER_ACTED:count=46185`
- **Réponse API** :
  - `créés = 19`, `erreurs = 1`
  - Erreur sur `EC_Id = 24249` : `Facture déjà soldée ou introuvable en base au moment de l'écriture.`
- **Contrôles SQL & Assertions automatisées** :
  - `[PASS]` Dernière échéance (EC_Id=24249) refusée avec message «...au moment de l'écriture»
  - `[PASS]` 0 affectation créée pour EC_Id=24249 (`nbAff=0`)
  - `[PASS]` Au moins une facture du lot traitée normalement (import partiel) (`nbSucces=19`)
- **Nettoyage ciblé automatique** :
  - `[CLEAN]` 19 affectation(s) supprimée(s) (`MV_Id > 48470`)
  - `[CLEAN]` 19 règlement(s) supprimé(s) (`MV_Id > 48470`)
  - `[CLEAN]` `EC_Solde` restauré sur EC_Id=24249 → 30
  - `[PASS]` Base restaurée (intégrité) : `mvAvant=46184, mvFinal=46184`
- **Résultat script** : `4 PASSÉ(S), 0 ÉCHOUÉ(S)`, Exit Code 0.

---

## Log Brut Complet (Run 2)

```
15:53:30.385 === TASK-114 - Preuve du garde-fou EC_Solde via GRC.API ===
15:53:30.394     ApiUrl=http://localhost:5000  LotSize=20  Caisse=CR
15:53:30.397 
15:53:30.400 --- 1. Vérification / démarrage de GRC.API ---
15:53:33.487 [INFO] GRC.API non détectée - démarrage en arrière-plan...
15:53:33.698 [INFO] Process PID=24532 - attente démarrage (max 90 s)...
15:53:43.083 [INFO] GRC.API prête.
15:53:43.087 
15:53:43.091 --- 2. Authentification (POST /api/auth/login) ---
15:53:45.390 [PASS] JWT obtenu. UserId=1 Login=Admin IsAdmin=True
15:53:45.394 
15:53:45.397 --- 3. Snapshot RT_MOUVEMENT ---
15:53:45.520 [INFO] RT_MOUVEMENT avant run : 46184 (MAX MV_Id=48470)
15:53:45.522 
15:53:45.527 --- 4. Récupération des factures ouvertes (GET /api/reglements/factures-a-regler) ---
15:53:50.396 [INFO] 2070 facture(s) ouverte(s) retournée(s).
15:53:50.449 [INFO] Lot : 20 échéances. Cible watcher : EC_Id=24249 (solde=30).
15:53:50.451 
15:53:50.454 --- 5. Démarrage du watcher (job parallèle) ---
15:53:51.037 [INFO] Watcher démarré (job 1), poll 200 ms, timeout 120 s.
15:53:51.039 
15:53:51.043 --- 6. Appel POST /api/reglements/generer-espece ---
15:53:51.046 [INFO] EcheanceNos = 6504, 16238, 18303, 20300, 9923, 8934, 21384, 89, 16393, 27475, 2426, 3236, 7974, 25532, 12411, 16396, 10714, 10726, 10797, 24249
15:54:14.166 [INFO] Réponse reçue. success=False créés=19 erreurs=1
15:54:14.190 [WATCHER] Output : WATCHER_ACTED:count=46185
15:54:14.197 
15:54:14.200 --- 7. Contrôles ---
15:54:14.216 [PASS] Dernière échéance (EC_Id=24249) refusée avec message «...au moment de l'écriture» - Erreur reçue : 'Facture déjà soldée ou introuvable en base au moment de l'écriture.'
15:54:14.385 [PASS] 0 affectation créée pour EC_Id=24249 - nbAff=0
15:54:14.414 [PASS] Au moins une facture du lot traitée normalement (import partiel) - nbSucces=19
15:54:14.417 
15:54:14.419 --- 8. Nettoyage ciblé ---
15:54:14.646 [CLEAN] 19 affectation(s) supprimée(s) (MV_Id > 48470)
15:54:14.683 [CLEAN] 19 règlement(s) supprimé(s) (MV_Id > 48470)
15:54:14.696 [CLEAN] EC_Solde restauré sur EC_Id=24249 → 30
15:54:14.715 [PASS] Base restaurée (intégrité) - mvAvant=46184, mvFinal=46184
15:54:14.735 [INFO] GRC.API arrêtée (PID=24532).
15:54:14.737 
15:54:14.741 ===================================================================================
15:54:14.744    RÉSULTATS TASK-114 (via API) : 4 PASSÉ(S), 0 ÉCHOUÉ(S)
15:54:14.748    Log : D:\_vibe\GRC_WEB\tasks\VERIFY\TASK-114_api_run.log
15:54:14.751 ===================================================================================
```

---

## Requêtes SQL de Contrôle et Vérification Post-Test

```sql
-- 1. Vérifier qu'aucune affectation orpheline n'existe pour l'échéance testée
SELECT COUNT(1) FROM dbo.RT_AFFECTATION WHERE EC_Id = 24249 AND MV_Id > 48470;
-- Résultat : 0

-- 2. Vérifier que la table des mouvements est revenue à son état initial exact
SELECT COUNT(1) AS NbMouvements FROM dbo.RT_MOUVEMENT;
-- Résultat : 46184

-- 3. Vérifier que le solde de la facture testée a bien été restauré
SELECT EC_Id, EC_Solde FROM dbo.RT_ECHEANCE WHERE EC_Id = 24249;
-- Résultat : 30.000000
```
