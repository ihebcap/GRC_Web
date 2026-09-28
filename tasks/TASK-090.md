# TASK-090 — Correction du montant du règlement depuis l'écran de rapprochement (remplace le « Forcer » silencieux)

- **Priorité** : 🟠 Nouveau fonctionnel (demande PO, 2026-09-28)
- **Domaine** : Front (`RapprochementBancaire.tsx`)
- **Statut** : TODO
- **Dépend de** : TASK-086 (endpoint de modification de règlement, déjà livré et en `DONE_DETAIL/`)

## Contexte

Sur l'écran de rapprochement bancaire, quand l'utilisateur sélectionne une ligne de relevé et un
règlement dont les montants diffèrent, une modale propose aujourd'hui de **« Forcer »** le
rapprochement (`RapprochementBancaire.tsx:1242-1248`, `pendingReservation` / `executeManualLettrage`).

Ce « Forcer » actuel se contente d'appeler `POST /ReleveBancaire/reserve` malgré l'écart : il
**réserve/lettre la paire sans jamais toucher au montant du règlement** (`RT_MOUVEMENT` inchangé).
L'écart entre le montant du règlement et celui du relevé persiste silencieusement après le forçage —
c'est exactement le point que le PO a explicitement écarté lors du cadrage de TASK-086 : *« pas de
mécanisme de forçage/tolérance d'écart dédié : le geste attendu est de corriger le montant du
règlement pour qu'il corresponde à la ligne de relevé »*. TASK-086 a livré la capacité technique de
corriger ce montant (`PUT /api/reglements/{id}`, `ReglementModificationDto { Montant }`) mais ne l'a
câblée que depuis la liste générale des règlements (`App.tsx`) — pas depuis cet écran, où le besoin
métier réel se présente.

**Demande PO (2026-09-28)** : quand l'utilisateur valide le forçage sur un écart de montant, au lieu
de (ou en complément de) réserver tel quel, on met à jour le montant du règlement avec celui de la
ligne de relevé sélectionnée, puis on procède au rapprochement normalement (montants désormais
identiques).

## Objectif

Sur l'écran de rapprochement bancaire, quand l'utilisateur confirme le forçage d'un rapprochement à
montants différents :
1. Le montant du règlement est mis à jour pour correspondre exactement au montant (`credit`) de la
   ligne de relevé sélectionnée — via l'endpoint de modification déjà existant (TASK-086), pas un
   nouvel appel ad hoc.
2. Une fois la mise à jour réussie, le rapprochement (réservation/lettrage) est effectué normalement,
   sur des montants désormais identiques.
3. Une ligne d'historique de modification est créée pour ce règlement (comportement déjà natif de
   l'endpoint réutilisé, TASK-086 — rien à coder en plus pour ça).

## Fichiers concernés

- `gocom-web/src/RapprochementBancaire.tsx` — modale de confirmation (lignes ~1242-1248),
  `applyManualLettrage`/`executeManualLettrage` (lignes ~745-785).
- Aucun changement backend attendu : `PUT /api/reglements/{id}` (`ReglementController.cs:330`,
  `ReglementService.ModifierReglement`) accepte déjà un DTO où seul `Montant` est renseigné (tous les
  autres champs de `ReglementModificationDto` sont nullable, cf. TASK-086) — un appel ne portant que
  `{ Montant: <credit de la ligne> }` est déjà supporté tel quel, à vérifier en base réelle avant de
  considérer cette TASK terminée (ne pas supposer, cf. discipline de preuve).

## Étapes d'implémentation

1. **Remplacer entièrement le bouton « Forcer » actuel** (décision PO actée le 2026-09-28, pas
   d'option de forçage sans correction conservée) — modale existante (`pendingReservation`,
   lignes ~1242-1248), un seul bouton renommé (ex. « Mettre à jour le montant et rapprocher ») qui :
   - appelle `PUT /api/reglements/{id}` avec `{ Montant: releve.credit }` (le montant de la ligne de
     relevé sélectionnée, pas celui du règlement) ;
   - si l'appel réussit, enchaîne avec l'appel existant `executeManualLettrage(grcId, ligneId)` pour
     réaliser le rapprochement (les montants sont désormais égaux, donc plus de blocage) ;
   - si l'appel de modification échoue (règlement devenu comptabilisé/affecté/annulé entre-temps,
     autre garde native de `ReglementUpdate` — cf. TASK-086 §3bis), afficher le message métier lisible
     déjà remonté par l'endpoint, **ne pas enchaîner le rapprochement** dans ce cas.
2. **Rafraîchir l'affichage du règlement dans la grille GRC de l'écran** après la mise à jour réussie
   (le montant affiché doit refléter la nouvelle valeur, pas rester sur l'ancienne jusqu'au prochain
   rechargement complet de l'écran).
3. **Réutiliser le contrôle de droits déjà en place sur l'endpoint de modification** (action
   `ReglementModifier`, TASK-086) — aucun contrôle de droits supplémentaire à ajouter côté front,
   l'endpoint refuse déjà lui-même un utilisateur non autorisé.
4. **Ne pas dupliquer la logique de garde métier** (comptabilisé/affecté/annulé, gardes natives par
   mode de règlement) : c'est l'endpoint de modification existant qui les applique déjà, cette TASK
   ne fait que l'appeler depuis un nouvel endroit du front.

## Contraintes

- Aucun nouveau endpoint backend, aucune nouvelle logique de garde métier — cette TASK est une
  intégration front d'un endpoint déjà livré et validé (TASK-086), pas un nouveau développement
  métier.
- Ne pas modifier le comportement du « Forcer » pour les autres écrans (aucun autre écran ne propose
  ce mécanisme aujourd'hui, mais s'assurer qu'aucune régression n'affecte `App.tsx` ou d'autres modes
  de cette même page).
- Respecter `ARCHITECTURE.md` si un nouveau composant d'affichage (modale, message) est introduit —
  réutiliser les patterns de confirmation/toast déjà en place sur cet écran (TASK-055).

## Risques / dépendances

- **Décision UX actée (2026-09-28)** : le bouton « Forcer » actuel est intégralement remplacé, pas
  d'option de forçage sans correction conservée en parallèle — cohérent avec la position PO déjà
  actée lors du cadrage de TASK-086 (pas de tolérance d'écart comme mécanisme permanent).
- **Cas d'échec partiel** : si la mise à jour du montant réussit mais que le rapprochement échoue
  ensuite (ex. conflit de réservation concurrente, HTTP 409 déjà géré par `executeManualLettrage`),
  le règlement reste modifié avec le nouveau montant mais non rapproché — comportement acceptable
  (le montant corrigé est une donnée juste en soi, indépendamment du rapprochement), mais à confirmer
  dans le VERIFY plutôt que supposé.
- **Montant affiché vs montant réellement comparé** : rappel du piège déjà documenté en TASK-086 —
  `ReglementUpdate` compare son paramètre montant à `Montant` (devise d'origine), pas à
  `MontantDeviseSociete` (affiché dans les grilles). Si le règlement est en devise société (cas
  très majoritaire, cf. TASK-086), ce piège est invisible ; sinon, vérifier explicitement quelle
  valeur envoyer.

## Checklist VALIDATION (à remplir dans VERIFY/)

- [ ] Build front OK (0 erreur)
- [ ] Sélection d'un règlement et d'une ligne de relevé de montants différents → modale de
      confirmation propose la mise à jour du montant (pas seulement un forçage silencieux)
- [ ] Confirmation → montant du règlement mis à jour en base réelle avec la valeur exacte de la
      ligne de relevé (`credit`), testé réellement (pas seulement par lecture de code)
- [ ] Après mise à jour réussie → rapprochement (réservation/lettrage) effectué automatiquement,
      sans nouvelle action utilisateur
- [ ] Ligne d'historique de modification créée pour ce règlement (comportement natif de l'endpoint
      TASK-086, à confirmer non régressé)
- [ ] Échec de la mise à jour (règlement devenu non modifiable entre-temps) → message métier clair,
      rapprochement NON effectué dans ce cas, testé réellement avec un cas d'échec provoqué
- [ ] Affichage de la grille GRC rafraîchi avec le nouveau montant après mise à jour réussie
- [ ] Aucune régression sur le reste de l'écran de rapprochement (sélection, dé-rapprochement,
      auto-rapprochement)
- [ ] Aucun nouveau endpoint créé, aucune duplication de la logique de garde déjà dans
      `ReglementService.ModifierReglement`
