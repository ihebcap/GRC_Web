# TASK-045 — Filtre d'éligibilité rapprochement appliqué à tort à la liste des règlements et à la comptabilisation

- **Priorité** : 🔴 Fonctionnel majeur (règlements manquants à l'écran → comptabilisation incomplète)
- **Domaine** : Backend (Infrastructure/API) + Front (1 appel)
- **Dépend de** : —

## Contexte

Écart constaté en prod (instance `172.16.0.205`, base `GR_GOCOM`, user applicatif `n.salim`) :
- **WinForm** : **30 712** règlements (déjà bornés aux caisses autorisées de n.salim).
- **Web GRC** : **7 479** règlements, mêmes caisses.

Le périmètre caisses est **écarté** (les 30 712 sont déjà dans les caisses autorisées de n.salim). L'écart provient uniquement du **filtre d'éligibilité au rapprochement bancaire** :

```
Virement (MV_Type=3)          → toujours éligible
Chèque/Traite (MV_Type=1|2)   → éligible seulement si remis en banque (MV_Remis=2)
```

Ce filtre est porté par `ReglementEligibilityHelper.EstEligibleRappBancaire` — [GRC.Application/Services/ReglementEligibilityHelper.cs:7](../GRC.Application/Services/ReglementEligibilityHelper.cs#L7).

### Règle métier (cadrée avec le PO)

- **Liste des règlements** et **écran de comptabilisation** → doivent afficher **TOUS les modes** de règlement (espèces, chèque, traite, virement, remis ou non).
- **Écran de rapprochement** uniquement → applique le filtre d'éligibilité ci-dessus.

### Cause racine

Les **trois** écrans consomment le même endpoint `GET /api/reglements` :
- Liste — [gocom-web/src/App.tsx:307](../gocom-web/src/App.tsx#L307)
- Comptabilisation — [gocom-web/src/ApercuComptabilisation.tsx:207](../gocom-web/src/ApercuComptabilisation.tsx#L207)
- Rapprochement — [gocom-web/src/RapprochementBancaire.tsx:346](../gocom-web/src/RapprochementBancaire.tsx#L346)

Or `ReglementService` applique le filtre **sans condition** :
- `GetReglements` — [GRC.Infrastructure/Services/ReglementService.cs:62](../GRC.Infrastructure/Services/ReglementService.cs#L62)
- `GetDistinctReglements` (dropdowns de la liste) — [GRC.Infrastructure/Services/ReglementService.cs:273](../GRC.Infrastructure/Services/ReglementService.cs#L273)

→ La liste et la compta subissent à tort le filtre du rapprochement.

## Objectif

Rendre le filtre d'éligibilité **conditionnel** : appliqué **uniquement** pour l'écran de rapprochement, jamais pour la liste ni la comptabilisation.

## Fichiers concernés

- `GRC.API/Controllers/ReglementController.cs` — endpoint `GetReglements` (+ `GetDistinctReglements`).
- `GRC.Infrastructure/Services/ReglementService.cs` — `GetReglements` (l.62), `GetDistinctReglements` (l.273).
- `gocom-web/src/RapprochementBancaire.tsx` — seul appel à passer le flag (l.346).

## Étapes d'implémentation

1. **Backend — paramètre de flux**
   - Ajouter un paramètre de requête `eligibleRappBancaire` (bool, **défaut `false`**) sur `GetReglements` — [ReglementController.cs:25](../GRC.API/Controllers/ReglementController.cs#L25) — et le transmettre au service.
   - Idem pour `GetDistinctReglements` si les dropdowns du rapprochement doivent rester filtrés (à défaut, le laisser à `false` — les dropdowns de la liste doivent montrer tous les modes).
2. **Service — filtre conditionnel**
   - Dans `GetReglements`, n'exécuter le `Where(... EstEligibleRappBancaire ...)` **que si** `eligibleRappBancaire == true` — [ReglementService.cs:62](../GRC.Infrastructure/Services/ReglementService.cs#L62).
   - Même traitement dans `GetDistinctReglements` — [ReglementService.cs:273](../GRC.Infrastructure/Services/ReglementService.cs#L273).
3. **Front — un seul appelant filtre**
   - Ajouter `&eligibleRappBancaire=true` à l'URL de l'écran rapprochement — [RapprochementBancaire.tsx:346](../gocom-web/src/RapprochementBancaire.tsx#L346).
   - **Ne rien changer** dans `App.tsx` (liste) ni `ApercuComptabilisation.tsx` (compta) → défaut `false` → tous les modes.

## Contraintes

- **Ne pas supprimer** `EstEligibleRappBancaire` ni modifier sa règle — elle reste correcte, seule son **application** devient conditionnelle.
- Défaut `false` : tout appelant qui n'envoie pas le flag (dont les intégrations existantes) obtient la liste complète — comportement conforme à la règle métier.
- Respecter la Clean Architecture (Domain ← Application ← Infrastructure/API).
- Pas d'`UPDATE` SQL brut, pas de bypass DLL métier.

## Risques / dépendances

- **Volume** : sans filtre, la liste peut renvoyer beaucoup plus de lignes (30 k+). La pagination back existe déjà (`Skip/Take`, [ReglementController.cs:71](../GRC.API/Controllers/ReglementController.cs#L71)), mais le chargement mémoire `GetAll` + filtres LINQ reste **intégral avant pagination** → surveiller le temps de réponse. Lien possible avec TASK-008 (pagination SQL) et TASK-015 (distincts en base).
- Vérifier que l'écran de comptabilisation, qui filtre déjà `isComptabilise === 0` côté front ([ApercuComptabilisation.tsx:221](../gocom-web/src/ApercuComptabilisation.tsx#L221)), se comporte correctement avec le volume complet.

## Checklist VALIDATION (à remplir dans VERIFY/)

- [ ] Build back OK (0 erreur) et build front OK
- [ ] Liste des règlements : affiche tous les modes (espèces/chèque/traite/virement, remis ou non) — nombre aligné sur WinForm à caisses/dates égales
- [ ] Écran comptabilisation : mêmes règlements que la liste (tous modes) hors déjà comptabilisés
- [ ] Écran rapprochement : inchangé — seuls Virement + Chèque/Traite remis (MV_Remis=2) apparaissent
- [ ] `GetDistinctReglements` : dropdowns de la liste montrent tous les modes
- [ ] Paramètre `eligibleRappBancaire` : défaut `false`, `true` seulement depuis l'écran rapprochement
- [ ] Contrôle chiffré : à caisses/dates identiques, écart WinForm ↔ Web résorbé
