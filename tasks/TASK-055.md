# TASK-055 — Remonter à l'utilisateur les messages d'erreur/avertissement de la comptabilisation

- **Priorité** : 🟠 UX / exploitabilité (demande PO 2026-07-15)
- **Domaine** : Front (`ApercuComptabilisation.tsx`) — appoint mineur possible côté API
- **Dépend de** : rien (le back renvoie déjà l'information nécessaire)

## Contexte

Constat PO sur run réel du 2026-07-15 (règlement 47660) : la DLL Sage a levé deux messages métier **parfaitement actionnables** par l'utilisateur…

```
COMPTABILISATION ÉCHEC : reglementId=47660 — Le journal [CRA] est en cours d'utilisation !
COMPTABILISATION : règlement 47660 comptabilisé mais lettrage échoué
  → Le journal [VENTES] est en cours d'utilisation !
```

…mais **l'utilisateur n'a vu que « 1 erreurs rencontrées »**. Le message « le journal X est en cours d'utilisation » lui dit exactement quoi faire (fermer le journal dans Sage, réessayer) ; sans lui, il est bloqué et appelle le support.

**Le back n'est pas en cause.** `ReglementService.Comptabiliser` remonte déjà tout :
- [ReglementService.cs:424](../GRC.Infrastructure/Services/ReglementService.cs#L424) — `errors.Add($"Erreur sur le règlement {id}: {ex.Message}")`
- [ReglementService.cs:400](../GRC.Infrastructure/Services/ReglementService.cs#L400) — `lettrageWarnings.Add(...)` (TASK-050)
- [ReglementService.cs:415](../GRC.Infrastructure/Services/ReglementService.cs#L415) — `docNumeroWarnings.Add(...)` (TASK-036)
- Payload retourné : `{ success, successCount, errorCount, errors[], docNumeroWarnings[], lettrageWarnings[] }` ([ReglementService.cs:428-436](../GRC.Infrastructure/Services/ReglementService.cs#L428-L436))

**Le front jette l'information.** [ApercuComptabilisation.tsx:304-326](../gocom-web/src/ApercuComptabilisation.tsx#L304-L326) :
- `errors[]` part dans `console.error` puis un toast générique `${errorCount} erreurs rencontrées` — **le message DLL n'est jamais affiché** ;
- `lettrageWarnings[]` et `docNumeroWarnings[]` **ne sont ni lus ni affichés** — un règlement comptabilisé mais non lettré passe totalement silencieux ;
- le `catch` affiche `'Erreur lors de la comptabilisation'` en ignorant le corps de la réponse `Problem(ex.Message)` du contrôleur ([ReglementController.cs:111](../GRC.API/Controllers/ReglementController.cs#L111)).

**Bug annexe, dans le périmètre** : `success` vaut `true` même quand `successCount=0, errorCount=1` (cas exact du log 15:53:01). Le front affiche alors **« Comptabilisation réussie pour 0 règlements ! » en toast vert** sur un lot 100 % en échec — message trompeur à corriger.

## Objectif

Après une comptabilisation, l'utilisateur voit **le texte exact des messages métier** renvoyés par le back (erreurs et avertissements), par règlement, sans avoir à ouvrir la console du navigateur.

## Fichiers concernés

- `gocom-web/src/ApercuComptabilisation.tsx` — `handleValider` ([:304-326](../gocom-web/src/ApercuComptabilisation.tsx#L304-L326)) : cœur de la tâche.
- `GRC.API/Controllers/ReglementController.cs` — **seulement si** le worker constate que `Problem(ex.Message)` n'est pas exploitable côté axios ; sinon **ne pas y toucher**.

## Étapes d'implémentation

1. **Ne plus perdre `errors[]`** : afficher le contenu de chaque entrée. Un toast par erreur est acceptable pour 1-2 erreurs, mais un lot peut en produire N → préférer un **panneau/zone de résultat persistant** sous les boutons (liste des messages, dismissable), ou une modale de récapitulatif. Le critère : **le message doit rester lisible après le fade du toast** (l'utilisateur doit pouvoir le recopier au support).
2. **Afficher `lettrageWarnings[]` et `docNumeroWarnings[]`** dans ce même panneau, en niveau *avertissement* (jaune) et non *erreur* : ces cas signifient « comptabilisé quand même » — la distinction est essentielle, cf. le commentaire [ReglementService.cs:375-377](../GRC.Infrastructure/Services/ReglementService.cs#L375-L377). Ne pas les fusionner avec `errors[]`.
3. **Corriger le message de succès trompeur** : ne parler de réussite que si `successCount > 0`. Cas `successCount=0 && errorCount>0` → message d'échec, pas de toast vert.
4. **Ne vider `apercus` / n'appeler `onValidated()`** que si au moins un règlement est passé — sinon l'utilisateur perd son aperçu alors que rien n'a été comptabilisé et qu'il doit réessayer après fermeture du journal Sage.
5. **`catch`** : exploiter le corps de réponse (`err.response?.data?.detail` pour un `ProblemDetails`) avant de retomber sur le message générique.

## Contraintes

- **Front uniquement** — aucune modification de la logique de comptabilisation, du décorateur pièce, du lettrage ou de la DLL. Le back a déjà tout ce qu'il faut ; le corriger serait hors sujet.
- Ne pas exposer la **stack trace** ni le type d'exception .NET à l'utilisateur : **seulement `ex.Message`**, qui est ici un message métier français exploitable (« Le journal [CRA] est en cours d'utilisation ! »). La stack reste dans les logs Serilog.
- Conserver le mécanisme `showToast` existant pour le résumé court ; le panneau détaillé s'ajoute, il ne remplace pas.
- Pas de refonte de l'écran ni de librairie UI supplémentaire.

## Risques / dépendances

- **Verbosité** : sur un lot de 50 règlements dont 50 en erreur, 50 toasts = écran noyé. D'où le panneau récapitulatif plutôt que N toasts.
- **Fuite d'information** : `ex.Message` des DLL Sage est métier dans les cas observés, mais rien ne le garantit pour toute exception (ex. `SqlException` → détails d'infrastructure). Risque jugé acceptable en LAN fermé, cohérent avec la position déjà tenue en TASK-036/050 (les warnings existants concatènent déjà `exDoc.Message`). **Ne pas ouvrir de chantier de sanitisation dans cette tâche** — le noter si le PO le demande plus tard.
- Aucune dépendance : ni TASK-053, ni TASK-054, ni TASK-051 ne touchent `handleValider`.

## Checklist VALIDATION (à remplir dans VERIFY/)

- [ ] Build front OK (0 erreur)
- [ ] Journal Sage ouvert dans l'ERP → comptabilisation → **le texte « Le journal [XXX] est en cours d'utilisation ! » est visible à l'écran**, avec le n° de règlement concerné
- [ ] Cas `successCount=0, errorCount=1` → **aucun toast vert de réussite**, message d'échec explicite
- [ ] Cas `successCount=0` → l'aperçu n'est pas vidé, l'utilisateur peut réessayer sans tout refaire
- [ ] Cas règlement comptabilisé + lettrage échoué → **avertissement jaune affiché** (`lettrageWarnings`), distinct d'une erreur, et compté en succès
- [ ] Cas `docNumeroWarnings` non vide → affiché au même niveau avertissement
- [ ] Lot mixte (succès + erreurs + warnings) → les trois catégories affichées, distinguables, message lisible après disparition du toast
- [ ] Erreur HTTP 500 (`Problem`) → message du corps de réponse affiché, pas seulement « Erreur lors de la comptabilisation »
- [ ] Aucune stack trace visible côté UI
- [ ] Aucune modification back (hors éventuel ajustement `Problem` justifié dans le VERIFY)
