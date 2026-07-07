# TASK-017 — Câblage front de la réservation persistée

- **Priorité** : 🔴 Majeur (dépend de la réservation backend)
- **Domaine** : Frontend
- **Statut** : TODO
- **Dépend de** : TASK-016

## Contexte
Suite de TASK-016. Une fois la réservation persistée côté API (`reserve` / `release` + état exposé), le front `RapprochementBancaire.tsx` doit **cesser de gérer le lettrage uniquement en state local** et refléter l'état réel de la base, y compris les réservations des autres utilisateurs.

## Objectif
Chaque appariement/dissociation appelle l'API de réservation ; l'état survit au refresh ; les lignes réservées par un autre utilisateur sont **visibles mais verrouillées** ; le filtre « Non rapproché » devient exact.

## Fichiers concernés
- `gocom-web/src/RapprochementBancaire.tsx`

## Étapes d'implémentation

### 1. Réservation à chaque appariement
- `applyManualLettrage` ([:442](../gocom-web/src/RapprochementBancaire.tsx#L442)) : après validation des montants, appeler `POST /reserve { ligneReleveId, mvId, lettrage }` ; n'appliquer le lettrage au state **que si `200`**. Sur `409` → toast « Déjà réservé par X le … » et annuler la sélection.
- `handleAutoReconcile` ([:382](../gocom-web/src/RapprochementBancaire.tsx#L382)) : pour chaque proposition, réserver (séquentiel ou batch — prévoir un éventuel endpoint `reserve-batch` si trop d'allers-retours) ; n'appliquer que les paires réellement réservées, signaler les conflits.

### 2. Dissociation → release
- `delettrerByLettrage` / `handleSelectGrc` / `handleSelectReleve` / `handleDelettrerTout` ([:435-515](../gocom-web/src/RapprochementBancaire.tsx#L435-L515)) : appeler `POST /release { ligneReleveId }` avant de retirer le lettrage du state. Ne retirer côté client qu'en cas de succès.

### 3. Chargement de l'état réel
- Au chargement des lignes relevé ([:343](../gocom-web/src/RapprochementBancaire.tsx#L343)) : ne plus ignorer `lettrage` déjà présent ; conserver aussi `mvId`, `reservePar_UserId`, `dateReservation`.
- Au chargement des règlements GRC ([:294-321](../gocom-web/src/RapprochementBancaire.tsx#L294-L321)) : **ne plus forcer `lettrage: null`** (ligne 316) ; utiliser l'info de réservation renvoyée par `/reglements` (TASK-016 §4) pour restaurer le lettrage/réservation.
- Ainsi le travail en cours **survit à un refresh**.

### 4. Affichage verrouillé (réservé par un autre)
- Marquer les lignes dont `reservePar_UserId` ≠ utilisateur courant : icône **cadenas** + libellé « réservé par X le … », **non sélectionnables** (clic sans effet, pas de dissociation possible).
- Les lignes réservées par l'utilisateur courant restent normalement dissociables.

### 5. Filtre « Non rapproché »
- Recalculer sur l'état réel : une ligne est « rapprochée » si elle porte un `Lettrage`/`MV_ID` réservé en base (pas seulement l'appariement de session). Corriger `filteredReglements` / `filteredLignes` ([:610-646](../gocom-web/src/RapprochementBancaire.tsx#L610-L646)) en conséquence.
- Retirer le pansement du worker (dérivation `Pointé=OUI` temps réel) s'il subsiste.

### 6. Validation (Approuver) : transmettre la date valeur à la DLL GRC
La Phase 2 doit poser `DatePointage` comme le fait le rapprochement manuel de référence (`ReglementService.RapprocherManuel` : `reg.DatePointage = item.DateValeur`). Actuellement le rapprochement bancaire pointe **sans date valeur**.
- `ValidationPairDto` : ajouter `DateValeur` (`DateTime?`).
- `handleApprouver` : envoyer la **date valeur brute (ISO)** de la ligne relevé — ⚠️ ne pas renvoyer `dateValeur` déjà reformatée via `toLocaleDateString()` ([:375](../gocom-web/src/RapprochementBancaire.tsx#L375)) ; conserver la valeur ISO d'origine.
- `SauvegarderValidationAsync` (Phase 2) : `if (pair.DateValeur.HasValue) reg.DatePointage = pair.DateValeur.Value;`.
- `ExtraitNum` reste alimenté par `ligne.code` (= colonne `[Code]` de `RAPP_ReleveBancaire_Ligne` = numéro d'extrait, confirmé PO) — inchangé.

## Contraintes
- Aucune écriture directe base côté front — tout passe par les endpoints TASK-016.
- Toujours réconcilier le state client sur la **réponse serveur** (pas d'optimistic write non confirmé pour la réservation).
- Aucune régression du repérage visuel des paires (lettre commune, surlignage).
- Gérer proprement les toasts d'erreur (cf. TASK-014 si livrée : préférer toasts à `alert`).

## Risques / dépendances
- **Dépend de TASK-016** (endpoints + état exposé).
- Performance : réservation séquentielle sur un gros auto-rapprochement → surveiller le nombre d'appels ; prévoir batch si nécessaire.

## Checklist VALIDATION (à remplir dans VERIFY/)
- [ ] Build OK
- [ ] Rapprochement manuel : persiste (visible après refresh)
- [ ] Auto-rapprochement : persiste, conflits signalés
- [ ] Dissociation : appelle `release`, échoue proprement si non-réservataire
- [ ] Lignes réservées par un autre : cadenas + « réservé par X », non sélectionnables
- [ ] Filtre « Non rapproché » exact (basé sur l'état base, pas le state de session)
- [ ] Aucune écriture base directe côté front
- [ ] `currentUserId` dérivé de `user.no` (pas `.id`/`.userId`) — vos propres réservations ne se verrouillent pas après refresh
- [ ] Lettrage réservé du règlement GRC exposé par `/reglements` → paires reconstruites et `Approuver` fonctionne après refresh
- [ ] Validation : `reg.DatePointage` = date valeur (ISO) de la ligne ; `ExtraitNum` = `ligne.code`
