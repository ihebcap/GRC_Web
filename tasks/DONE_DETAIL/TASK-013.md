# TASK-013 — Lettrage manuel front : dépassement après Z + reset incorrect

- **Priorité** : 🟠 Majeur
- **Domaine** : Correction
- **Statut** : TODO
- **Dépend de** : TASK-007 (aligner sur la logique serveur)

## Contexte
`RapprochementBancaire.tsx` gère le lettrage manuel avec `currentLetterCode` (init 65) et `String.fromCharCode(currentLetterCode)` (ligne 199), incrémenté à chaque paire, remis à 65 après `handleApprouver` (ligne 246).

## Problème constaté
1. **Après la 26ᵉ lettre** (Z = charCode 90), `String.fromCharCode(91…)` produit `[ \ ] ^ _ ...` au lieu de `AA, AB…`. Divergence avec le `LettrageGenerator` backend (style colonnes Excel).
2. **Reset à 65 après validation** : un nouveau lettrage repart à `A` alors que des lettrages persistés existent déjà sur le relevé → **collisions** (même défaut que TASK-007, côté client).

## Objectif
Lettrage manuel identique à la logique serveur, sans dépassement ni collision.

## Fichiers concernés
- `gocom-web/src/RapprochementBancaire.tsx`

## Étapes d'implémentation
1. Remplacer `String.fromCharCode` par une fonction équivalente au `LettrageGenerator` (A…Z, AA, AB…). Idéalement factoriser une seule implémentation partagée.
2. Initialiser le compteur à partir du **dernier lettrage existant** du relevé chargé (cf. TASK-007), pas à 65 fixe.
3. Ne pas réinitialiser à `A` après validation tant que des lettrages subsistent sur le relevé.

## Contraintes
- Le lettrage affiché côté front doit correspondre à celui persisté côté back.

## Checklist VALIDATION (à remplir dans VERIFY/)
- [ ] Build OK
- [ ] 27ᵉ lettrage = `AA` (pas `[`)
- [ ] Pas de collision après validation partielle
- [ ] Cohérent avec LettrageGenerator backend
