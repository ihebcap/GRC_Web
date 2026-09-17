# TASK-014 — Finitions UX de l'écran Rapprochement

- **Priorité** : 🟡 Mineur (confort, faible coût)
- **Domaine** : UX
- **Statut** : DONE (APPROVE 2026-09-17)
- **Dépend de** : TASK-012

## Contexte
Écran `RapprochementBancaire.tsx`. Plusieurs frictions UX faciles à corriger, sur un outil censé remplacer une WinframForm et gagner en fluidité.

## Problèmes constatés
1. **`alert()` / `window.confirm()` bloquants** (lignes 179, 192, 237, 243, 249) alors qu'un système de **toast** existe déjà dans `App.tsx`. Incohérence + interruption du flux.
2. **Pas de repérage visuel des paires lettrées** : relevé (haut) et GRC (bas) ne partagent qu'une lettre ; retrouver la paire « C » oblige à scanner les deux grilles. → surlignage/couleur par lettre, ou tri conjoint par lettrage.
3. **Empty-state manquant** : si aucun relevé n'existe pour la banque, l'utilisateur est bloqué sans message ni lien vers l'import du relevé.
4. **Formatage montant incohérent** : `Number(row.credit).toFixed(2)` (sans séparateur/devise) côté relevé, alors que `formatMoney` existe dans `utils`. Uniformiser.
5. **Identifiants de test en dur** dans le `Login` (`PAYX` / `0000` / société `1`, `App.tsx:127-129`) → à retirer avant livraison.

## Objectif
Flux de rapprochement fluide, cohérent visuellement, sans boîtes de dialogue natives bloquantes.

## Fichiers concernés
- `gocom-web/src/RapprochementBancaire.tsx`
- `gocom-web/src/App.tsx`

## Étapes d'implémentation
1. Remplacer `alert`/`confirm` par les toasts (passer `showToast` en prop) ; pour la confirmation « montants différents », utiliser une confirmation inline non bloquante.
2. Surligner les lignes lettrées par couleur/lettre commune (ou proposer un tri « par lettrage » synchronisé sur les 2 grilles).
3. Ajouter un empty-state « Aucun relevé importé pour cette banque » + accès à l'import.
4. Utiliser `formatMoney` partout pour les montants.
5. Vider les valeurs par défaut du formulaire de login.

## Contraintes
- Aucune régression du lettrage/validation existant.

## Checklist VALIDATION (remplie, cf. VERIFY archivé dans CHANGELOG.md)
- [x] Build OK — `npm run build` (tsc + vite), 0 erreur, 2026-09-17
- [x] Plus aucun `alert`/`confirm` natif dans le flux (périmètre déclaré `RapprochementBancaire.tsx`
      + `App.tsx`) — grep vérifié après modification, 2026-09-17 ; `RelevesBancaires.tsx` hors
      périmètre signalé, non traité
- [x] Paires lettrées repérables visuellement — déjà en place, confirmé par lecture de code
      (`getLettrageColor`), non modifié cette session
- [x] Empty-state présent — déjà en place, confirmé par lecture de code, non modifié cette session
- [x] Montants formatés uniformément — `formatMoney` déjà utilisé dans `RapprochementBancaire.tsx` (l.170, l.1320)
- [x] Login sans identifiants pré-remplis — déjà vrai dans le code actuel, énoncé original de la
      TASK obsolète (grep `PAYX` négatif) ; non testé dans le navigateur cette session, validé par
      lecture de code uniquement

> Ces cases étaient précédemment cochées sans VERIFY déposé ni implémentation (`git log` : fichier intact depuis le commit initial) — corrigé le 2026-09-17 pour refléter l'état réel du code, puis réellement implémentées/vérifiées la même session (cf. `CHANGELOG.md`).
