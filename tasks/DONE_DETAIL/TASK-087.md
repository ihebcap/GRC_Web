# TASK-087 — Écran comptabilisation : filtre « Rapproché » fixé à Oui, MV_Type 0/4 exclus du filtre

- **Priorité** : 🟡 Mineur (demande PO, réunion 2026-09-28 — précisée le 2026-09-28)
- **Domaine** : Backend (Infrastructure) + Front (`ApercuComptabilisation.tsx`)
- **Statut** : DONE
- **Dépend de** : —

## Contexte

Remarque PO en réunion (2026-09-28) : sur l'écran de comptabilisation, le filtre « Rapproché » doit
être fixé obligatoirement à **Oui**, en veillant à ne pas exclure du périmètre les règlements qui
n'ont **pas de notion de rapprochement bancaire** au sens propre.

Précision PO obtenue le 2026-09-28 (en clarification directe de cette TASK) : le besoin métier exact
est **« comptabiliser uniquement les règlements `MV_Type IN (1,2,3)` qui sont rapprochés, et
`MV_Type IN (0,4)` — qui n'ont pas de notion de rapprochement — à considérer comme toujours vrais
sur ce filtre »**.

⚠️ **Changement de doctrine actée pour cette TASK précisément** — à ne pas généraliser sans nouvel
arbitrage PO explicite : jusqu'ici (TASK-021/DONE_DETAIL, TASK-053), `MV_Type=4` (« Autre ») était
traité **comme un virement** (`MV_Type=3`) — éligible au rapprochement bancaire, jamais dispensé
(cf. `DONE_DETAIL/TASK-021.md:37`, `DONE_DETAIL/TASK-053.md:42`). Le PO a tranché le 2026-09-28,
spécifiquement pour le filtre « Rapproché » de l'écran de comptabilisation, que `MV_Type=4` doit
être traité **comme `MV_Type=0` (Espèce)** : dispensé de la notion de rapprochement, toujours inclus.
Cette TASK ne modifie **rien** à l'éligibilité rapprochement bancaire au sens de
`ReglementEligibilityHelper.EstEligibleRappBancaire` (TASK-021) ni à la règle d'écriture comptable
`MV_Type=4` traité comme 3 (TASK-053) — ces deux règles restent inchangées, dans leur périmètre
respectif. Seul le filtre `pointe` de l'écran comptabilisation change de comportement pour
`MV_Type IN (0,4)`.

Valeurs `MV_Type` confirmées PO (cf. `DONE_DETAIL/TASK-021.md:73`) : `0` Espèce, `1` Chèque,
`2` Traite, `3` Virement, `4` Autre.

État actuel confirmé par lecture de code :
- [ApercuComptabilisation.tsx:175](../gocom-web/src/ApercuComptabilisation.tsx#L175) —
  `const [rapproche, setRapproche] = useState<'all'|'oui'|'non'>('all')`, select libre à 3 valeurs
  ([ApercuComptabilisation.tsx:417-418](../gocom-web/src/ApercuComptabilisation.tsx#L417)), défaut
  `'all'`.
- [ApercuComptabilisation.tsx:220](../gocom-web/src/ApercuComptabilisation.tsx#L220) —
  `pointe: rapproche === 'all' ? undefined : (rapproche === 'oui')`, transmis en query param
  `pointe` à `GET /api/reglements`.
- [ReglementController.cs:39](../GRC.API/Controllers/ReglementController.cs#L39) — `pointe` est un
  paramètre `string?` **partagé par tous les appelants** de `GET /api/reglements`, sans distinction
  d'écran.
- [ReglementService.cs:101-104](../GRC.Infrastructure/Services/ReglementService.cs#L101) — filtre
  backend `IsPointe == pointeVal` appliqué **à tous les règlements sans distinction de mode**, y
  compris espèces et « Autre ».
- **Autres appelants confirmés du même paramètre `pointe`/`isPointe`, à ne pas régresser** :
  - [App.tsx:529](../gocom-web/src/App.tsx#L529) et
    [App.tsx:697](../gocom-web/src/App.tsx#L697) — mode Rapprochement de la liste générale verrouille
    `pointe='non'` (filtre inverse, sur les non-rapprochés).
  - [RapprochementBancaire.tsx:483](../gocom-web/src/RapprochementBancaire.tsx#L483) —
    `pointe=false&eligibleRappBancaire=true`, grille GRC du rapprochement bancaire.
  - Un changement de comportement **non scopé** dans `ReglementService.GetReglements` rendrait les
    espèces et le type « Autre » non pointés visibles/sélectionnables dans ces deux écrans de
    rapprochement bancaire, où ils n'ont pourtant rien à faire (l'espèce et le type 4 y sont déjà
    exclus par `EstEligibleRappBancaire`, TASK-021 — ne pas court-circuiter cette exclusion).
- `ReglementEligibilityHelper.EstEligibleRappBancaire` (`GRC.Application/Services/`) **n'est pas
  utilisable tel quel** pour détecter « espèce ou Autre » : il répond à la question « éligible au
  rapprochement bancaire » (`mvType==3 || (mvType IN (1,2) && mvRemis==2)`), pas à « fait partie de
  {0,4} ». Le complément logique `!EstEligibleRappBancaire(...)` engloberait aussi les
  chèques/traites **non remis**, ce qui inclurait à tort des règlements ayant une vraie notion de
  rapprochement non encore réalisée. **Utiliser un test direct sur `MV_Type`, pas ce helper.**
- TASK-045 a déjà acté que l'écran de comptabilisation affiche **tous les modes** sans filtre
  d'éligibilité rapprochement — cette TASK ne revient pas dessus, elle ajoute une combinaison
  supplémentaire sur le filtre `pointe` existant.

## Objectif

Sur l'écran de comptabilisation :
1. Le filtre « Rapproché » est **verrouillé sur Oui — décision PO actée (2026-09-28)** : le
   `<select>` disparaît de l'UI ou est affiché désactivé/grisé, toujours figé sur Oui. L'utilisateur
   ne peut plus le repasser sur "Tous" ou "Non", même ponctuellement.
2. Les règlements `MV_Type IN (0, 4)` (Espèce, Autre) restent **toujours inclus**, indépendamment de
   leur état `IsPointe` (qui n'a pas de sens pour ces deux modes) — jamais exclus par ce filtre.
3. Les règlements `MV_Type IN (1, 2, 3)` (Chèque, Traite, Virement) restent soumis au filtre Oui
   strict : seuls les rapprochés (`IsPointe=true`) apparaissent.
4. **Portée strictement scopée à l'écran de comptabilisation** : le comportement de `pointe` pour
   `App.tsx` (liste + mode Rapprochement) et `RapprochementBancaire.tsx` doit rester strictement
   inchangé (non-régression, cf. section Risques).

## Fichiers concernés

- `gocom-web/src/ApercuComptabilisation.tsx` — state `rapproche` et le `<select>` associé.
- `GRC.Infrastructure/Services/ReglementService.cs` — méthode `GetReglements`, filtre `IsPointe`
  (autour de la ligne 101-104).
- `GRC.API/Controllers/ReglementController.cs` — signature `GetReglements`, ajout du paramètre de
  scope (voir étape 2).

## Étapes d'implémentation

1. **Front** : verrouiller le filtre à `'oui'` — retirer le `<select>` de l'UI, ou le conserver
   visible mais désactivé (`disabled`) avec la valeur figée sur "Oui" (au choix d'implémentation,
   l'un ou l'autre convient — la seule exigence est qu'aucune interaction utilisateur ne puisse
   changer la valeur transmise au backend). Ne pas se contenter de changer la valeur par défaut de
   `useState` : ça resterait modifiable par l'utilisateur, ce qui ne répond pas à la décision PO.
2. **Backend — scoper le changement à l'écran de comptabilisation uniquement** : ajouter un nouveau
   paramètre explicite (ex. `bool includeEspeceEtAutreSiPointeFiltre = false`) sur
   `ReglementController.GetReglements` et `ReglementService.GetReglements`, transmis uniquement par
   `ApercuComptabilisation.tsx` (valeur `true`, fixe, non liée au state `rapproche`). Ne **pas**
   changer le comportement par défaut de `GetReglements` pour les appelants existants
   (`App.tsx`, `RapprochementBancaire.tsx` ne passent pas ce paramètre → comportement actuel
   strictement inchangé).
3. **Backend — logique du filtre**, dans `ReglementService.GetReglements`, remplacer le bloc
   `isPointe` (ligne ~101-104) par (pseudocode) :
   ```csharp
   if (!string.IsNullOrEmpty(isPointe)) {
       bool pointeVal = bool.Parse(isPointe);
       allReglements = includeEspeceEtAutreSiPointeFiltre
           ? allReglements.Where(r => r.Type == 0 || r.Type == 4 || r.IsPointe == pointeVal)
           : allReglements.Where(r => r.IsPointe == pointeVal);
   }
   ```
   Test direct sur `r.Type` (0 et 4) — **ne pas** utiliser
   `!ReglementEligibilityHelper.EstEligibleRappBancaire(...)` comme proxy (cf. Contexte : ce n'est
   pas équivalent, il engloberait aussi les chèques/traites non remis).
4. **Vérifier `GetDistinctReglements`** (ou tout autre point d'entrée partageant potentiellement la
   même logique de filtre) pour cohérence, si applicable — appliquer le même scope conditionnel s'il
   est concerné.
5. **Test manuel** : avec le filtre verrouillé sur Oui, un lot mixte (espèces non pointées + type
   « Autre » non pointé + virements rapprochés + virements non rapprochés) doit afficher les espèces,
   le type « Autre » et les virements rapprochés, mais pas les virements non rapprochés.
6. **Test manuel de non-régression** : rejouer le mode Rapprochement d'`App.tsx`
   (`pointe='non'`) et la grille GRC de `RapprochementBancaire.tsx` (`pointe=false`) — vérifier que
   les espèces et le type « Autre » restent exclus comme avant (comportement `EstEligibleRappBancaire`
   / TASK-021 non court-circuité).

## Contraintes

- Ne pas utiliser `ReglementEligibilityHelper.EstEligibleRappBancaire` (ni son complément logique)
  pour détecter `MV_Type IN (0,4)` — test direct sur `Type`, pas de logique dérivée (cf. Contexte).
- Ne pas modifier le comportement par défaut de `GetReglements`/`GetDistinctReglements` pour les
  appelants existants (`App.tsx`, `RapprochementBancaire.tsx`) — changement strictement opt-in via
  le nouveau paramètre.
- Ne pas toucher à `ReglementEligibilityHelper` (TASK-021) ni à la règle d'écriture comptable
  `MV_Type=4` traité comme 3 (TASK-053) — ces règles vivent dans d'autres périmètres (rapprochement
  bancaire, écriture comptable) et restent inchangées.
- Aucun changement de schéma, aucune DLL impliquée — modification de logique de filtrage uniquement.
- Respecter la Clean Architecture (Domain ← Application ← Infrastructure/API).

## Risques / dépendances

- **Risque principal identifié et neutralisé par le scope opt-in (étape 2)** : sans paramètre de
  scope, un changement global du comportement `IsPointe` dans `ReglementService.GetReglements`
  affecterait aussi `App.tsx` (mode Rapprochement, `pointe='non'`) et `RapprochementBancaire.tsx`
  (`pointe=false&eligibleRappBancaire=true`), rendant les espèces/type "Autre" non pointés visibles
  dans des écrans de rapprochement bancaire où ils sont normalement exclus (TASK-021). Vérifier que
  l'implémentation Gemini respecte bien le opt-in avant validation VERIFY.
- Vérifier qu'aucun autre appelant de l'endpoint `GetReglements` (liste des règlements, App.tsx) ne
  soit affecté par le changement de logique backend — le changement de comportement doit être
  scopé à l'usage réel du paramètre `pointe` par `ApercuComptabilisation.tsx` uniquement.

## Checklist VALIDATION (à remplir dans VERIFY/)

- [x] Build back + front OK (0 erreur)
- [x] Filtre « Rapproché » verrouillé sur Oui (aucune interaction utilisateur possible pour le
      changer — select retiré ou désactivé)
- [x] Règlements `MV_Type IN (0,4)` (Espèce, Autre) toujours inclus dans les résultats de l'écran
      comptabilisation, quel que soit leur état `IsPointe`
- [x] Règlements `MV_Type IN (1,2,3)` non rapprochés bien exclus (comportement Oui strict préservé
      pour Chèque/Traite/Virement)
- [x] Non-régression confirmée sur `App.tsx` (mode Rapprochement, `pointe='non'`) : espèces et type
      « Autre » toujours exclus comme avant cette TASK
- [x] Non-régression confirmée sur `RapprochementBancaire.tsx` (`pointe=false`) : espèces et type
      « Autre » toujours exclus comme avant cette TASK
- [x] Aucune régression sur les autres appelants de `GetReglements`/paramètre `pointe`
- [x] Confirmation que `ReglementEligibilityHelper.EstEligibleRappBancaire` n'a pas été utilisé
      (directement ou par négation) pour détecter `MV_Type IN (0,4)` — test direct sur `Type` requis
- [x] Aucune duplication de la logique de détection `MV_Type IN (0,4)`
