# TASK-066 — Réservation en lot : boucle séquentielle front N allers-retours (constat lenteur PO 2026-07-20)

- **Priorité** : 🟠 Majeur
- **Domaine** : Performance (Front + Backend)
- **Statut** : À FAIRE
- **Dépend de** : TASK-037 (calcul lettre atomique côté serveur)

## Contexte

Le PO signale une lenteur perçue lors de la réservation (`RÉSERVATION`) pendant le rapprochement bancaire,
log fourni : `deploy/logs/grc-20260720.log`.

Lecture du log (lignes 144–197) : chaque réservation individuelle (lock + calcul lettre + commit) prend
**1 à 15 ms** côté serveur — 10 réservations en ~120 ms sur ce lot. Aucune lenteur mesurable côté
traitement unitaire. L'environnement de ce log est local (`DataSource DESKTOP-2VCUE93`), donc la latence
réseau y est quasi nulle — ce qui masque le vrai coût en déploiement LAN réel (scope du projet, cf.
`tasks/TODO.md` en-tête : « Déploiement LAN fermé, multi-postes »).

## Problème constaté (par lecture de code)

`gocom-web/src/RapprochementBancaire.tsx:562-579` : l'auto-rapprochement itère les propositions dans une
boucle `for...of` avec un `await axios.post(${API_BASE}/ReleveBancaire/reserve)` **par proposition, en
série** — jamais en parallèle, jamais en lot. Pour N propositions, c'est N allers-retours HTTP séquentiels.
Sur LAN réel (latence réseau non nulle, plusieurs dizaines de ms par aller-retour), un lot de plusieurs
dizaines de lignes (cf. génération réglement du même log : 48 échéances en une passe) peut se traduire par
plusieurs secondes de blocage UI perçu comme un gel.

Côté serveur, `GRC.API/Controllers/ReleveBancaireController.cs:192-230` →
`ReleveBancaireRepository.ReserverLigneAsync` prend un `sp_getapplock` **par `enteteId`** (visible au log :
tous les appels du lot ligne 144–197 partagent `enteteId=6`). Ce verrou sérialise déjà les réservations
d'un même relevé côté base — voulu pour garantir l'unicité de la lettre (cf. mémoire
`lettrage-repere-interne`, TASK-037). Une parallélisation front seule sur ce même relevé ne gagnerait donc
que la latence réseau (aller-retour HTTP), pas le temps base — mais c'est probablement l'essentiel du coût
en LAN.

## Hypothèse à valider avant tout dev

1. Reproduire sur poste client réel (pas localhost) avec un lot de taille comparable (≥ 20-30 propositions)
   et mesurer le temps total ressenti + un profil réseau (Network tab navigateur) pour confirmer que le
   coût dominant est bien le nombre d'allers-retours séquentiels, pas autre chose (ex. re-render React à
   chaque étape, taille de payload, etc.).
2. Si confirmé : évaluer un endpoint de réservation en lot (`POST /ReleveBancaire/reserve-batch` ou
   équivalent) qui applique la boucle et le verrouillage **côté serveur** (un seul aller-retour réseau,
   verrous `sp_getapplock` toujours séquentiels par `enteteId` en interne) plutôt qu'une simple
   parallélisation `Promise.all` côté front (qui n'apporterait rien vu la sérialisation serveur existante
   et risquerait de créer de la contention supplémentaire sur l'applock).

## Fichiers concernés (probables, à confirmer après repro)

- `gocom-web/src/RapprochementBancaire.tsx` (boucle séquentielle, lignes ~562-579)
- `GRC.API/Controllers/ReleveBancaireController.cs` (endpoint `reserve`, éventuel nouvel endpoint lot)
- `GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs` (`ReserverLigneAsync`, éventuelle version lot)

## Contraintes

- Ne pas court-circuiter le verrouillage `sp_getapplock` par `enteteId` (garantie d'unicité de lettre,
  TASK-037) — toute évolution doit le préserver, y compris dans un endpoint lot.
- Pas de fix avant reproduction réelle mesurée (pas de log actuel ne démontrant une lenteur serveur) —
  éviter un correctif sur une cause non confirmée.
- Respecter la Clean Architecture (Domain ← Application ← Infrastructure/API).

## Checklist VALIDATION (à remplir dans VERIFY/)
- [ ] Repro réelle en LAN avec mesure avant/après (pas seulement raisonnement)
- [ ] Verrouillage applock par `enteteId` toujours respecté (pas de doublon de lettre possible)
- [ ] Build API + front OK
- [ ] Aucune régression sur la réservation unitaire (clic simple)
- [ ] Aucune dette technique silencieuse
