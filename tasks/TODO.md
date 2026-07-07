# TODO — Rapprochement Bancaire (scope client · LAN 100% · remplacement WinForm)

Contexte cadré avec le PO :
- **Déploiement LAN fermé**, multi-postes, remplace une appli WinForm lourde.
- **Réutilisation des DLLs `Tresorerie.*`** pour hériter des règles métier comptables.
- Curseur : justesse comptable, non-corruption base, déploiement — pas la propreté « produit ».
- **Lot du 2026-07-07** : **12 tâches validées** (voir `DONE.md` / `CHANGELOG.md`). TASK-002 rejetée au 1er passage puis corrigée et validée.

## ▶️ ACTIF — reste du backlog (ordre de priorité)

| Task | Priorité | Domaine | Sujet |
|------|----------|---------|-------|
| [TASK-029](TASK-029.md) | 🟠 | Correction | Écran interrogation relevé (TASK-028) : filtres **liste** (Libellé/Code/Statut) inopérants — `selectedValues` passé `undefined` au lieu de `[]`, `ExcelFilter` court-circuite au 1er clic. Ajouter `\|\| []` (×3) |
| [TASK-033](TASK-033.md) | 🟠 | Back+Front | Supprimer un relevé bancaire (en-tête + lignes) **uniquement si toutes les lignes sont sans action** (ni réservée ni validée). Garde atomique `DELETE ... WHERE NOT EXISTS(Lettrage/MV_ID/DateValidation IS NOT NULL)` + `HttpDelete("{id}")` → 204/409/404. Tout-ou-rien, pur RAPP, **aucun appel DLL GRC** (on refuse, pas de dépointage/libération). Front : confirmation + bouton désactivé si `NbReserve + NbRapproche > 0` |
| [TASK-031](TASK-031.md) | 🟠 | Correction | Validation rapprochement : écrire aussi **n° pièce** (`MV_Piece = MV_ExtraitNum`, sans garde `Type==3`, domaine 0) et **date règlement** (`MV_Date = DateValeur` **si `MV_Compta=0`** uniquement). Remplace le job SQL WinForm de rattrapage. Écriture via DLL `repo.Update`, jamais de comptabilisé touché |
| [TASK-018](TASK-018.md) | 🔴 | Robustesse | `GetReglements` plante en `SqlException` 8003 (>2100 params) : chunker la requête réservations `MV_ID IN @Ids` (même pattern que `GetDistinctReglements`) |
| [TASK-015](TASK-015.md) | 🟠 | Performance | `/reglements/distincts` : période bornée OK (via TASK-008-A), mais reste un dédup **en mémoire** — passer en `SELECT DISTINCT` base |
| [TASK-014](TASK-014.md) | 🟡 | UX | Finitions écran rapprochement (toasts vs alert, repérage paires, empty-state, format montant, login pré-rempli) |
| [TASK-030](TASK-030.md) | 🟡 | Back+Front | Liste des relevés : supprimer la flèche d'interrogation obsolète, ajouter 4 compteurs par relevé (Total / Réservées / Rapprochées / Restantes sans action) via requête agrégée (1 seule, pas de N+1) sur l'endpoint partagé. DTO de liste dédié |
| [TASK-023](TASK-023.md) | 🟡 | UX | Cadenas de réservation : afficher le **nom** de l'utilisateur réservataire (jointure `P_UTILISATEUR`) au lieu de l'ID, aux 2 grilles |

## ⏸️ DIFFÉRÉ / NON RETENU pour ce livrable

| Task | Raison |
|------|--------|
| [TASK-008](TASK-008.md) **partie B** | Pagination SQL `OFFSET/FETCH` complète : différée tant que le jeu borné par période reste raisonnable (partie A **livrée**) |
| [TASK-010](TASK-010.md) | Migration `Microsoft.Data.SqlClient` : cosmétique — backlog |

## ✅ LIVRÉ (2026-07-07)
TASK-001 · TASK-002 · TASK-003 · TASK-004 · TASK-005 · TASK-006 · TASK-007 · TASK-008-A · TASK-009 · TASK-011 · TASK-012 · TASK-013 · TASK-016 · TASK-017 · TASK-019 · TASK-020 · TASK-021 · TASK-022 · TASK-024 · TASK-025 · TASK-026 · TASK-027 · TASK-028 · TASK-032 → voir `DONE.md` / `DONE_DETAIL/` / `CHANGELOG.md`.

## Règles worker
- Une TASK = un lot cohérent. À la fin : `VERIFY/TASK-XXX_verify.md` avec checklist VALIDATION remplie **et exacte** (le VERIFY-002 cochait un point faux — les cases doivent refléter le code réel).
- Interdictions : bypasser une règle de sécurité ou une DLL métier GRC ; secret en dur ; `UPDATE` SQL brut sur une table métier GRC pilotée par DLL ; URL/serveur en dur.
- Respecter la Clean Architecture : Domain ← Application ← Infrastructure/API.

## Écarts avec `analyse_rapprochement.md` — ACTÉS (voulus par le PO)
- **Drag & Drop (Étape 4)** : abandonné volontairement (rapprochement par sélection → lettrage auto).
- **Liens visuels / cartes (Étape 3)** : remplacés par deux grilles + lettre commune.
- **Matching montant SEUL** (date ignorée) : voulu.
- **Rapprochement strict 1=1** : voulu.

## Algorithme d'auto-rapprochement — VALIDÉ
`AutoReconciliationEngine.CalculerPropositions` correct et sûr (match sur montant unique des deux côtés → aucun faux positif, 1-à-1 garanti). Câblage vrais règlements (`MontantDeviseSociete`) livré via TASK-012 ; reprise de lettrage via TASK-007/013.
