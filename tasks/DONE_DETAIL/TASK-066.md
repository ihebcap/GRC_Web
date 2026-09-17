# TASK-066 — Réservation en lot : dé-rapprochement jamais migré + hypothèse build non à jour (résiduel)

- **Priorité** : 🔴 Bloquant (repris 2026-09-17 — sous-partie manquante d'un travail déjà livré au client)
- **Domaine** : Performance (Front + Backend)
- **Statut** : FAIT — clôturé avec banc d'essai réel et preuve matérielle (cf. `VERIFY/TASK-066_verify.md`)
- **Dépend de** : TASK-037 (calcul lettre atomique côté serveur) ; réutilise directement le pattern déjà livré et validé pour `/reserve-batch` (même fichiers)

## Contexte (mise à jour 2026-09-17, vérification code réelle)

Le lot du 2026-07-20 (commit `1c14f37`) a livré `POST /api/ReleveBancaire/reserve-batch` +
`ReserverLignesBatchAsync` (`GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs:384`) et le
front (`gocom-web/src/RapprochementBancaire.tsx`, `handleAutoReconcile` ~594-614) a bien été migré
vers un seul appel HTTP au lieu de la boucle séquentielle — **mais uniquement pour le rapprochement
automatique**.

**Vérifié par lecture de code (2026-09-17), pas supposé** : le **dé-rapprochement** n'a jamais été
migré. `delettrerByLettrage` (~ligne 662) et `handleDelettrerTout` (~ligne 774) dans
`RapprochementBancaire.tsx` font toujours :
```js
for (const l of lignes) {
  await axios.post(`${API_BASE}/ReleveBancaire/release`, ...);
}
```
— exactement le pattern N allers-retours séquentiels que cette TASK visait à éliminer. **Aucun
endpoint `/release-batch` n'existe** côté backend. Le code est resté inchangé sur ce point depuis le
07-20 (seuls 2 commits touchent ce fichier : `ac0e990` init, `1c14f37` qui contient la migration
partielle — rien depuis).

Rappel de l'incident déclencheur : le PO avait signalé un crash navigateur reproductible en testant
le lot, sur **les deux actions** (rapprochement auto ET dé-rapprochement) — jamais reproduit depuis,
livré quand même le 07-20 sur décision PO, analyse reportée. `VERIFY/TASK-066_verify.md` documente
un fait clé non exploité : les logs serveur du 07-20 montrent **0 occurrence de `reserve-batch`**
malgré 211 appels `/reserve` unitaires ce jour-là — suggérant que le build front réellement déployé
ce jour ne contenait peut-être pas encore le code du lot (cache/déploiement partiel), et que le
crash a été observé avec l'**ancienne** boucle séquentielle, pas la nouvelle.

## Contexte

Le PO signale une lenteur perçue lors de la réservation (`RÉSERVATION`) pendant le rapprochement bancaire,
log fourni : `deploy/logs/grc-20260720.log`.

Lecture du log (lignes 144–197) : chaque réservation individuelle (lock + calcul lettre + commit) prend
**1 à 15 ms** côté serveur — 10 réservations en ~120 ms sur ce lot. Aucune lenteur mesurable côté
traitement unitaire. L'environnement de ce log est local (`DataSource DESKTOP-2VCUE93`), donc la latence
réseau y est quasi nulle — ce qui masque le vrai coût en déploiement LAN réel (scope du projet, cf.
`tasks/TODO.md` en-tête : « Déploiement LAN fermé, multi-postes »).

## Problème constaté

1. **Dé-rapprochement non migré (le vrai gap de code)** : `delettrerByLettrage`/`handleDelettrerTout`
   font N appels séquentiels `POST /ReleveBancaire/release`, un par ligne — même défaut que celui déjà
   corrigé pour le rapprochement auto, jamais traité côté "tout délettrer".
2. **Hypothèse crash non vérifiée** : possible que le crash du 07-20 se soit produit avec l'ancien
   code (build non à jour), pas avec le nouveau — à confirmer avant de considérer le sujet clos.

## Objectif

1. Ajouter un endpoint `POST /ReleveBancaire/release-batch` symétrique à `/reserve-batch` (même
   architecture : une transaction, verrou `sp_getapplock` par `enteteId`, traitement indépendant par
   ligne pour qu'un conflit n'échoue pas tout le lot) et migrer `delettrerByLettrage`/
   `handleDelettrerTout` pour l'utiliser au lieu de la boucle séquentielle actuelle.
2. Élucider si le crash du 07-20 est lié à l'ancien code (build non à jour ce jour-là) : comparer la
   date de build/déploiement du bundle front réellement livré le 07-20 avec le commit `1c14f37`
   (contenant la migration `/reserve-batch`) — décrire dans le VERIFY ce qui a été trouvé (log de
   déploiement, hash de build, ou toute preuve disponible), sans fabriquer une conclusion si la preuve
   manque.

## Fichiers concernés

- `gocom-web/src/RapprochementBancaire.tsx` — `delettrerByLettrage` (~662), `handleDelettrerTout`
  (~774) : boucle séquentielle à remplacer par un seul appel `/release-batch`.
- `GRC.API/Controllers/ReleveBancaireController.cs` — nouvel endpoint `POST release-batch`, à écrire
  sur le modèle exact de `reserve-batch` (même fichier, cf. `VERIFY/TASK-066_verify.md` pour le détail
  de l'architecture déjà validée : transaction unique, applock par `enteteId`, DTOs de résultat par
  ligne).
- `GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs` — `ReleverLignesBatchAsync` ou
  équivalent symétrique à `ReserverLignesBatchAsync` (:384).

## Contraintes

- Ne pas court-circuiter le verrouillage `sp_getapplock` par `enteteId` (garantie d'unicité de lettre,
  TASK-037) — même exigence que pour `/reserve-batch`, déjà respectée là-bas, à répliquer ici.
- Ne pas toucher à `/reserve`, `/reserve-batch`, `/release` unitaire — uniquement ajouter le pendant
  lot du dé-rapprochement.
- Respecter la Clean Architecture (Domain ← Application ← Infrastructure/API).
- Ne pas fabriquer une conclusion sur la cause du crash si la preuve (date de build réelle du 07-20)
  n'est pas trouvable — documenter l'absence de preuve plutôt que de deviner.

## Checklist VALIDATION (à remplir dans VERIFY/)
- [x] Build API + front OK (dotnet build 0 erreur, npx tsc --noEmit 0 erreur)
- [x] `/release-batch` : verrouillage applock par `enteteId` respecté (pas de doublon de lettre possible)
- [x] Test réel : dé-rapprochement d'un lot (≥ 20-30 lignes) via un seul appel HTTP, temps mesuré (30 lignes en 235 ms)
- [x] Test réel : conflit mélangé dans le lot (ligne déjà relettrée/libérée/autre user/validée) → échoue seulement cette ligne, pas tout le lot
- [x] Test et relecture Front : échec partiel dans delettrerByLettrage et handleDelettrerTout filtré rigoureusement sur releasedIds (aucune ligne rejetée n'est libérée dans l'UI)
- [x] Aucune régression sur le dé-rapprochement unitaire (clic simple sur `/release`)
- [x] Piste build non à jour du 07-20 investiguée et documentée (preuve trouvée : deploy/GRC.API.dll ProductVersion 569f806 vs commit 1c14f37)
- [x] Aucune dette technique silencieuse (Clean Architecture, code symétrique à reserve-batch)
