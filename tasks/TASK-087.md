# TASK-087 — Écran comptabilisation : filtre « Rapproché » fixé à Oui, espèces exclues du filtre

- **Priorité** : 🟡 Mineur (demande PO, réunion 2026-09-28)
- **Domaine** : Backend (Infrastructure) + Front (`ApercuComptabilisation.tsx`)
- **Statut** : TODO
- **Dépend de** : —

## Contexte

Remarque PO en réunion (2026-09-28) : sur l'écran de comptabilisation, le filtre « Rapproché » doit
être fixé obligatoirement à **Oui**, en veillant à ne pas exclure la partie **espèces** du
périmètre — les espèces n'ont pas de notion de rapprochement bancaire au même sens que
virement/chèque/traite.

État actuel confirmé par lecture de code :
- [ApercuComptabilisation.tsx:175](../gocom-web/src/ApercuComptabilisation.tsx#L175) — 
  `const [rapproche, setRapproche] = useState<'all'|'oui'|'non'>('all')`, select libre à 3 valeurs
  ([ApercuComptabilisation.tsx:417-418](../gocom-web/src/ApercuComptabilisation.tsx#L417)), défaut
  `'all'`.
- [ApercuComptabilisation.tsx:220](../gocom-web/src/ApercuComptabilisation.tsx#L220) —
  `pointe: rapproche === 'all' ? undefined : (rapproche === 'oui')`, transmis en query param
  `pointe` à `GET /api/reglements`.
- [ReglementService.cs:101-103](../GRC.Infrastructure/Services/ReglementService.cs#L101) — filtre
  backend `IsPointe == pointeVal` appliqué **à tous les règlements sans distinction de mode**, y
  compris les espèces.
- Identification des espèces déjà en usage dans le code (convention `MV_Type==0`, cf.
  [ReglementService.cs:648](../GRC.Infrastructure/Services/ReglementService.cs#L648)
  `CalculerDocNumeros`, et `ReglementEligibilityHelper.EstEligibleRappBancaire` qui exclut déjà
  structurellement les espèces du rapprochement bancaire — TASK-021/045).
- TASK-045 a déjà acté que l'écran de comptabilisation affiche **tous les modes** sans filtre
  d'éligibilité rapprochement — cette TASK ne revient pas dessus, elle ajoute une combinaison
  supplémentaire sur le filtre `pointe` existant.

## Objectif

Sur l'écran de comptabilisation :
1. Le filtre « Rapproché » est **verrouillé sur Oui — décision PO actée (2026-09-28)** : le
   `<select>` disparaît de l'UI ou est affiché désactivé/grisé, toujours figé sur Oui. L'utilisateur
   ne peut plus le repasser sur "Tous" ou "Non", même ponctuellement.
2. Les règlements **espèce** (`MV_Type == 0`) restent **toujours inclus**, indépendamment de leur
   état de rapprochement (qui n'a pas de sens pour ce mode) — jamais exclus par ce filtre.

## Fichiers concernés

- `gocom-web/src/ApercuComptabilisation.tsx` — state `rapproche` et le `<select>` associé.
- `GRC.Infrastructure/Services/ReglementService.cs` — méthode contenant le filtre `IsPointe` (autour
  de la ligne 101-103).

## Étapes d'implémentation

1. **Front** : verrouiller le filtre à `'oui'` — retirer le `<select>` de l'UI, ou le conserver visible
   mais désactivé (`disabled`) avec la valeur figée sur "Oui" (au choix d'implémentation, l'un ou
   l'autre convient — la seule exigence est qu'aucune interaction utilisateur ne puisse changer la
   valeur transmise au backend). Ne pas se contenter de changer la valeur par défaut de `useState` :
   ça resterait modifiable par l'utilisateur, ce qui ne répond pas à la décision PO.
2. **Backend** : dans `ReglementService.GetReglements` (ou méthode équivalente portant le filtre
   `IsPointe`), transformer la clause pour que les espèces soient **toujours incluses** quel que
   soit `pointeVal`, en réutilisant la convention déjà en place `MV_Type == 0` /
   `ReglementEligibilityHelper` — par exemple (pseudocode) :
   `r => r.Type == 0 /* espèce */ || !pointeVal.HasValue || r.IsPointe == pointeVal.Value`.
   Réutiliser le helper existant plutôt que de recoder la détection espèce localement.
3. **Vérifier `GetDistinctReglements`** (ou tout autre point d'entrée partageant potentiellement la
   même logique de filtre) pour cohérence, si applicable.
4. **Test manuel** : avec le filtre verrouillé sur Oui, un lot mixte (espèces non rapprochées +
   virements rapprochés + virements non rapprochés) doit afficher les espèces **et** les virements
   rapprochés, mais pas les virements non rapprochés.

## Contraintes

- Réutiliser `ReglementEligibilityHelper`/la convention `MV_Type==0` existante — ne pas dupliquer la
  logique de détection espèce (cf. TASK-078, déjà corrigé une fois pour une duplication similaire
  sur `matchAmount`).
- Aucun changement de schéma, aucune DLL impliquée — modification de logique de filtrage uniquement.
- Respecter la Clean Architecture (Domain ← Application ← Infrastructure/API).

## Risques / dépendances

- Vérifier qu'aucun autre appelant de l'endpoint `GetReglements` (liste des règlements, App.tsx) ne
  soit affecté par le changement de logique backend — le changement de comportement doit être
  scopé à l'usage réel du paramètre `pointe` par `ApercuComptabilisation.tsx` uniquement, sans casser
  la sémantique du paramètre pour d'autres appelants (vérifier tous les points d'appel de
  `GetReglements`/`pointe` avant de modifier le comportement partagé).

## Checklist VALIDATION (à remplir dans VERIFY/)

- [ ] Build back + front OK (0 erreur)
- [ ] Filtre « Rapproché » verrouillé sur Oui (aucune interaction utilisateur possible pour le
      changer — select retiré ou désactivé)
- [ ] Règlements espèce toujours inclus dans les résultats, quel que soit leur état `IsPointe`
- [ ] Règlements non-espèce non rapprochés bien exclus (comportement Oui strict préservé pour les
      autres modes)
- [ ] Aucune régression sur les autres appelants de `GetReglements`/paramètre `pointe` (liste des
      règlements, App.tsx)
- [ ] Aucune duplication de la logique de détection espèce (réutilisation du helper existant)
