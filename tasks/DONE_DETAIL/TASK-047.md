# TASK-047 — Investiguer l'échec DLL Sage `NullReferenceException` sur l'aperçu compta (règlement 43168)

- **Priorité** : 🟡 Fiabilité (non bloquant : échec isolé par règlement, le lot continue ; mais un règlement ne peut ni être prévisualisé ni comptabilisé tant que la cause tient)
- **Domaine** : Backend / DLL Trésorerie
- **Dépend de** : TASK-036 / TASK-038 (chaîne `PieceAForcer` → `Generate`), TASK-046 (aperçu parallélisé — gestion d'erreur par règlement à conserver)

## Contexte
Log prod `grc-20260710.log` (run aperçu 16:06, userId=193, 8 511 règlements) : **1 seul échec** sur les 8 511 :

```
2026-07-10 16:08:08.513 [ERR] APERÇU COMPTA ÉCHEC : reglementId=43168 — erreur DLL Sage : Object reference not set to an instance of an object.
System.NullReferenceException:
   at Tresorerie.ApplicationServices.Comptabilite.EcritureComptableGeneratorReglement.Generate(ReglementClient reglement, Nullable`1 date, String numeroPiece)
   at GRC.Infrastructure.Services.ReglementService.ApercuComptabilisation(...)
```

Données connues de la ligne fautive (log) : `reglementId=43168`, `pièceForcée=1751364355`, `date=2026-06-16`, `montant=7695.00`, **`mode=18`**.

L'exception est levée **à l'intérieur de la DLL** (`Generate`), pas dans notre code. C'est donc une **donnée du règlement 43168** (ou de son mode/contexte) que la DLL ne sait pas traiter — probablement un champ attendu `null` (compte, journal, tiers, mode de règlement mal paramétré…).

Piste n°1 : **`mode=18`** est atypique dans l'échantillon (la grande majorité = 15/19). À vérifier : ce que représente le mode 18 et s'il lui manque un paramétrage comptable (compte/journal) côté Sage.

## Objectif
**Diagnostiquer** la cause racine du NRE dans `Generate` pour le règlement 43168 (et par extension pour tout règlement du même profil), puis **décider** : correction de donnée/paramétrage côté GRC/Sage, ou garde applicative en amont de `Generate` (message clair « règlement non comptabilisable : … » au lieu d'un NRE opaque).

## Étape 0 — Diagnostic (bloquant avant tout correctif)
1. Inspecter le règlement `MV_ID=43168` en base : mode (`MV_ModeReglt`=18 ?), type, compte général/tiers, journal, présence dans la vue `vw_ReglementsAComptabiliser`, `MV_Piece`.
2. Identifier ce que la DLL déréférence : comparer 43168 à un règlement **mode 18 qui passe** (s'il en existe un OK dans le log) vs un autre mode. Isoler le champ manquant.
3. Confirmer si le problème est **spécifique à 43168** (donnée corrompue/incomplète) ou **systématique au mode 18** (paramétrage comptable absent) → détermine la nature du correctif.

## Fichiers concernés
- `GRC.Infrastructure/Services/ReglementService.cs` : `ApercuComptabilisation` [l.511](../GRC.Infrastructure/Services/ReglementService.cs#L511) et `Comptabiliser` [l.292](../GRC.Infrastructure/Services/ReglementService.cs#L292) (le même `Generate` y est appelé → même risque à la compta réelle).
- Vue `vw_ReglementsAComptabiliser` (paramétrage `MV_Piece`/champs) — côté SQL PO.
- **DLL `Tresorerie.*` : NON modifiable** (binaire métier hérité) — le correctif est en amont (donnée/paramétrage) ou en garde applicative.

## Contraintes
- **Ne pas modifier la DLL** ni contourner `Generate`.
- Si garde applicative : elle **détecte et explique**, elle ne **fabrique pas** l'écriture à la place de la DLL (pas de bypass métier).
- Aperçu et compta réelle doivent rester **cohérents** : la même garde s'applique aux deux points d'appel (point de vérité unique, cf. TASK-038).
- Ne pas régresser la gestion d'erreur par règlement de TASK-046 (un règlement KO n'arrête pas le lot).

## Risques / dépendances
- Le règlement 43168 échoue **aussi à la comptabilisation réelle** (même appel `Generate`) : tant que non résolu, il restera non comptabilisable → à signaler au PO.
- Si c'est un paramétrage de mode manquant, l'impact dépasse 43168 (tous les règlements du même mode/profil).

## Checklist VALIDATION — APPROVE 2026-07-14 (voir CHANGELOG.md / DONE.md)
- [x] Cause racine identifiée (champ null déréférencé par `Generate` + pourquoi il est null sur 43168)
- [x] Portée établie : spécifique à 43168 vs systématique au mode 18 / à un profil → systématique (couple caisse/mode)
- [x] Correctif décidé et appliqué (donnée/paramétrage GRC-Sage **ou** garde applicative en amont de `Generate`)
- [x] Si garde : message explicite, appliquée **aux deux** points d'appel (aperçu + compta), aucun bypass DLL
- [x] 43168 : soit comptabilisable, soit refusé proprement avec message clair (plus de NRE opaque)
- [x] Gestion d'erreur par règlement (TASK-046) non régressée
- [x] Build back OK
