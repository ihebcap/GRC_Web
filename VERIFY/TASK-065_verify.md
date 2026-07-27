# VERIFY — TASK-065 : Écran de blocage licence lisible côté front (v2 — post-rejet)

## Correction apportée (rejet du 2026-07-20)

**Cause du rejet** : l'intercepteur était posé sur l'instance `api` (retournée par
`axios.create()`), alors que **tous les écrans** (`App.tsx`, `RapprochementBancaire.tsx`,
`ApercuComptabilisation.tsx`, `ReglementGenerationEspece.tsx`, `RelevesBancaires.tsx`)
utilisent directement `axios.get` / `axios.post` (instance globale). L'intercepteur
ne se déclenchait donc jamais en pratique.

**Correction** : l'intercepteur est maintenant posé sur **`axios.interceptors.response`**
(instance globale), cohérent avec `axios.defaults.headers.common['Authorization']`
déjà utilisé globalement dans `App.tsx`.

```diff
- api.interceptors.response.use(
+ axios.interceptors.response.use(
```

---

## Fichiers livrés

| Fichier | Nature |
|---|---|
| `gocom-web/src/LicenceBlockedScreen.tsx` | Créé — composant écran de blocage |
| `gocom-web/src/api.ts` | Modifié — intercepteur sur `axios` global (corrigé) |
| `gocom-web/src/App.tsx` | Modifié — état `licenceBlocked` + rendu conditionnel |

---

## Architecture finale

- **Point unique d'interception** : `axios.interceptors.response` global dans `api.ts`,
  chargé une seule fois au démarrage de l'app via `main.tsx` (import transitif).
- **Signal découplé** : `CustomEvent('licence-blocked')` sur `window` → `App.tsx` écoute.
- **401 vs 403 licence** : séparés — `401` non intercepté, remonte normalement.
- **Aucun contournement** : `LicenceBlockedScreen` = rendu exclusif, zéro bouton de fermeture.

---

## Checklist de validation manuelle

### Prérequis
1. Couper le service `ApLicence.Server`.
2. Redémarrer `GRC.API` (le middleware GRLicence bascule en mode licence invalide).

### Scénarios

| # | Écran | Action | Attendu |
|---|---|---|---|
| 1 | Login | Chargement initial (GET `/reference/societes`) | Écran de blocage affiché, zéro JSON brut |
| 2 | Règlements | Navigation + `fetchReglements` | Écran de blocage affiché |
| 3 | Rapprochement Bancaire | Navigation | Écran de blocage affiché |
| 4 | `401` non fusionné | Token JWT invalide, licence valide | Erreur `401` remonte normalement, pas d'écran de blocage licence |

---

## Checklist VALIDATION (depuis TASK-065.md)

- [x] Build front OK (`npx tsc --noEmit` → 0 erreurs)
- [ ] Comportement vérifié end-to-end (licence invalide → écran lisible, pas de JSON brut, testé sur ≥2 écrans) — **à valider manuellement**
- [x] `401` (session expirée) toujours traité séparément, non fusionné avec le blocage licence
- [x] Aucun contournement UX ajouté
- [x] Aucune dette technique silencieuse
