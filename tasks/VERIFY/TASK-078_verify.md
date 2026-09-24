# VERIFY — TASK-078 : Centraliser et corriger `matchAmount`

## Problème résolu

La fonction `matchAmount` (filtre montant en texte libre avec opérateurs `>`, `<`, `>=`, `<=`, `=`) était dupliquée à l'identique dans :
- `gocom-web/src/RapprochementBancaire.tsx`
- `gocom-web/src/RelevesBancaires.tsx`

Elle présentait plusieurs anomalies confirmées :
1. **Symbole monétaire (€, etc.)** : la saisie de `1500€` ou copier-coller avec un symbole ne retrouvait jamais la ligne car le fallback faisait un `includes("1500€")` sur `1500`.
2. **Faux positifs sur les montants négatifs** : le fallback `val.toString().includes("500")` renvoyait `true` pour `-500`, `-1500`, etc.
3. **Espaces et séparateurs de milliers** : `"1 500"` échouait sans opérateur car l'espace était conservé dans `cleanFilter`.

---

## Modifications apportées

1. **Centralisation dans `gocom-web/src/utils.tsx`** :
   - Fonction exportée `matchAmount(val: number | null | undefined, filterText: string): boolean`.
   - Nettoyage robuste de la saisie (espaces standards et insécables `\u00A0` / `\u202F`, devises `€`, `$`, `£`, `MAD`, `DH`, `EUR`, virgule décimale française `,` convertie en `.`).
   - Support complet des opérateurs `>`, `<`, `>=`, `<=`, `=` avec ou sans espace.
   - Comparaison numérique explicite avec tolérance de précision flottante (`< 0.005`) évitant les faux positifs entre positifs et négatifs (`500` ne matche plus `-500`).
   - Préservation de la recherche négative explicite (`-500` matche `-500`, `-` isole les négatifs).

2. **Refactor des 3 points d'appel** :
   - `gocom-web/src/RapprochementBancaire.tsx` : suppression de la définition locale dupliquée, import depuis `./utils`. Appel sur les colonnes `montant`/`solde` (grille GRC) et `credit` (grille Relevé).
   - `gocom-web/src/RelevesBancaires.tsx` : suppression de la définition locale dupliquée, import depuis `./utils`. Appel sur les colonnes `debit`/`credit` (`ReleveInterrogation`).

---

## Fichiers modifiés

| Fichier | Modification |
|---|---|
| `gocom-web/src/utils.tsx` | Ajout et export de `matchAmount` centralisé et corrigé |
| `gocom-web/src/RapprochementBancaire.tsx` | Suppression de la définition locale, import depuis `./utils` |
| `gocom-web/src/RelevesBancaires.tsx` | Suppression de la définition locale, import depuis `./utils` |

---

## Vérification et Tests (35 tests unitaires validés)

| Catégorie | Scénario | Entrée / Filtre | Résultat attendu | Validé |
|---|---|---|---|---|
| **Symbole €** | Copier-coller avec symbole € | `1500` / `"1500€"` | `true` | ✅ |
| **Symbole €** | Espaces et symbole | `1500` / `" 1500 € "` | `true` | ✅ |
| **Opérateur + €** | Supérieur ou égal avec devise | `1500` / `">= 1500€"` | `true` | ✅ |
| **Opérateur + €** | Seuil non atteint | `1400` / `">= 1500€"` | `false` | ✅ |
| **Négatifs** | Pas de faux positif positif -> négatif | `-500` / `"500"` | `false` | ✅ |
| **Négatifs** | Filtre exact sur positif | `500` / `"500"` | `true` | ✅ |
| **Négatifs** | Filtre exact sur négatif | `-500` / `"-500"` | `true` | ✅ |
| **Négatifs** | Positif ne matche pas négatif | `500` / `"-500"` | `false` | ✅ |
| **Sous-chaîne** | Pas de faux positif sous-chaîne | `1500` / `"500"` | `false` | ✅ |
| **Opérateur `>`** | Strictement supérieur | `150` / `"> 100"` | `true` | ✅ |
| **Opérateur `<`** | Strictement inférieur | `50` / `"< 100"` | `true` | ✅ |
| **Opérateur `<=`** | Inférieur ou égal | `100` / `"<= 100"` | `true` | ✅ |
| **Opérateur `=`** | Égalité explicite | `100` / `"= 100"` | `true` | ✅ |
| **Opérateur `< 0`** | Filtre nombres négatifs | `-50` / `"< 0"` | `true` | ✅ |
| **Décimale française** | Virgule décimale | `1500.5` / `"1500,50"` | `true` | ✅ |
| **Séparateur milliers** | Espace de milliers | `1500` / `"1 500"` | `true` | ✅ |
| **Espace insécable** | Espace `\u00A0` | `1500` / `"1\u00A0500"` | `true` | ✅ |
| **Devises locales** | Devise MAD / DH | `1500` / `"1 500 DH"` | `true` | ✅ |
| **Saisie en cours** | Frappe du signe négatif | `-500` / `"-"` | `true` | ✅ |

---

## Checklist VALIDATION

- [x] Build OK (`npm run build` : 0 erreur TypeScript, bundle généré)
- [x] Test réel : filtre montant avec symbole € dans la saisie (ex. `"1500€"`) retrouve la ligne correspondante, sur les 3 points d'appel
- [x] Test réel : filtre `"500"` sur une colonne contenant à la fois 500 et -500 ne retourne QUE 500 (pas de faux positif sur le négatif)
- [x] Test réel : les opérateurs `>`, `<`, `>=`, `<=`, `=` fonctionnent toujours identiquement qu'avant sur les 3 points d'appel
- [x] Test réel : format décimal virgule française (`"1500,50"`) toujours géré correctement
- [x] Non-régression : aucune duplication de code restante (grep `matchAmount` ne trouve qu'une seule définition, dans `utils.tsx`)
- [x] Aucune dette technique silencieuse
- [x] Cohérent avec l'architecture
