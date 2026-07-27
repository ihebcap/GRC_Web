# TASK-052 — Libellé écriture compta : hors espèce → colonne MV_Libelle (repli si vide)

- **Priorité** : 🟠 Majeur
- **Domaine** : Backend (Infrastructure) / Comptabilisation
- **Statut** : TODO — **⚠️ BLOQUÉE tant que le PO n'a pas confirmé la colonne vue (voir Risques)**
- **Dépend de** : TASK-049 (livrée — même point d'injection `AppliquerChampsVue`)

## Contexte

Demande PO (2026-07-15), en complément symétrique de TASK-049 (qui traite le cas **espèce**,
`MV_Type = 0`) : piloter aussi le **libellé de l'écriture comptable** pour les règlements
**hors espèce** (`MV_Type ≠ 0`) à partir de la vue `vw_ReglementsAComptabiliser`.

Règle demandée par le PO :
- Prendre la colonne **`mv_libelle`** de la vue.
- Si cette colonne est **vide/NULL** → conserver le libellé actuellement généré
  (mode de règlement + intitulé client — logique existante, inchangée depuis TASK-036).

État actuel du code (post TASK-049), [ReglementService.cs:574-576](../GRC.Infrastructure/Services/ReglementService.cs#L574-L576) :
```csharp
var libelle = (viewRow.MV_Type == 0 && !string.IsNullOrWhiteSpace(viewRow.LibelleEspece))
    ? viewRow.LibelleEspece.Trim()
    : libelleParDefaut;
```
→ Pour tout `MV_Type ≠ 0`, le libellé est **aujourd'hui toujours** `libelleParDefaut` (mode +
intitulé client), sans aucune lecture de colonne vue. C'est ce chemin `else` qu'il faut faire
dépendre de `MV_Libelle`.

## Problème constaté

Le libellé « hors espèce » est figé côté code et ignore toute valeur `MV_Libelle` pourtant
disponible en base pour ces types de règlement.

## Objectif

Pour `MV_Type ≠ 0` :
- **`MV_Libelle` non vide/non NULL** → libellé écriture = `MV_Libelle.Trim()`.
- **`MV_Libelle` vide/NULL** → repli sur le libellé actuel (mode + intitulé client).
- **Jamais d'écriture avec libellé vide** (même garantie que TASK-049).
- **`MV_Type = 0` (espèce)** : **strictement inchangé** (logique TASK-049, non touchée).

## ⚠️ Risques / dépendances — À LEVER AVANT TOUT DEV

1. **La vue actuelle n'expose pas de `MV_Libelle` brut, non filtré par type.**
   Le seul champ « libellé » actuellement exposé par `vw_ReglementsAComptabiliser` est
   `LibelleEspece`, défini (TASK-049) comme :
   ```sql
   CASE WHEN MV_Type = 0 THEN MV_Libelle ELSE '' END AS LibelleEspece
   ```
   → Pour tout `MV_Type ≠ 0`, `LibelleEspece` vaut **systématiquement `''`**. Il ne peut donc
   **pas** servir de source pour cette tâche : il faut une colonne dédiée exposant `MV_Libelle`
   **sans ce filtre de type**.
2. **La vue est FIGÉE et fournie par le PO** (cf. TASK-036/TASK-049) — GRC_WEB n'a pas la main
   dessus. **Avant tout développement**, il faut que le PO :
   - ajoute la colonne demandée à la vue (ex. `MV_Libelle` brut, ou un nom dédié type
     `LibelleHorsEspece` pour éviter toute ambiguïté avec `LibelleEspece`) ;
   - confirme le **nom exact** de la colonne à consommer côté repository (le message PO dit
     « mv_libelle » en minuscule — à vérifier si c'est littéralement la colonne source de
     `RT_MOUVEMENT` exposée telle quelle, ou un nouvel alias à définir).
3. **Tant que ce point n'est pas confirmé, cette TASK reste bloquante** — aucune ligne de code
   ne doit être écrite contre un nom de colonne supposé.

## Fichiers concernés

- `GRC.Infrastructure/Repositories/ReglementComptaViewRepository.cs`
  — ajouter la propriété (ex. `MV_Libelle` / `string?`) à `ReglementComptaViewRow` (l.13-22)
  et la colonne correspondante au `SELECT` de `GetByMvIds` (l.44-46).
- `GRC.Infrastructure/Services/ReglementService.cs`
  — `AppliquerChampsVue` (l.561-583), branche `else` du calcul de `libelle` (l.574-576).

## Étapes d'implémentation

1. **PO** : confirmer/livrer la colonne vue exposant `MV_Libelle` sans filtre de type, figer
   le nom exact.
2. **Repository** : étendre `ReglementComptaViewRow` + le `SELECT` avec la nouvelle colonne.
3. **`AppliquerChampsVue`** : étendre le calcul du libellé, ex. :
   ```csharp
   var libelle = viewRow.MV_Type == 0
       ? (!string.IsNullOrWhiteSpace(viewRow.LibelleEspece) ? viewRow.LibelleEspece.Trim() : libelleParDefaut)
       : (!string.IsNullOrWhiteSpace(viewRow.MV_Libelle)    ? viewRow.MV_Libelle.Trim()    : libelleParDefaut);
   ```
4. **Point unique** : `AppliquerChampsVue` est déjà appelé par l'aperçu (`ApercuComptabilisation`)
   **et** par la compta réelle (`Comptabiliser`) — un seul changement suffit, aucune duplication.

## Contraintes

- Ne rien changer pour `MV_Type = 0` (non-régression TASK-049).
- Aucun bypass de règle de sécurité ni de DLL métier GRC ; pas de modif des DLL Sage.
- Lecture de la vue GRC uniquement — aucun `UPDATE` SQL brut.
- Respecter la Clean Architecture (Domain ← Application ← Infrastructure/API).

## Checklist VALIDATION (à remplir dans VERIFY/)

- [ ] Nom de colonne vue confirmé par le PO **avant** développement (pas de nom supposé)
- [ ] Build OK
- [ ] `ReglementComptaViewRow` + `SELECT` remontent la nouvelle colonne `MV_Libelle`
- [ ] `MV_Type ≠ 0` + `MV_Libelle` non vide → libellé écriture = `MV_Libelle`
- [ ] `MV_Type ≠ 0` + `MV_Libelle` vide/NULL → repli mode + intitulé (jamais vide)
- [ ] `MV_Type = 0` → comportement TASK-049 strictement inchangé
- [ ] Vérifié identique sur aperçu ET compta réelle (point unique `AppliquerChampsVue`)
- [ ] Cohérent avec l'architecture ; aucun bypass DLL

---

## ⛔ ABSORBÉE PAR TASK-053 (2026-07-15)

Cette TASK a été implémentée puis **dépassée avant clôture** par la spec complète du PO
(TASK-053). Sa règle de repli — « libellé = mode de règlement seul » — n'existe plus : le repli
est désormais le mot `Versement`, calculé **dans la vue**.

Elle n'est **pas** archivée en DONE : la comportement qu'elle décrit n'a jamais tourné en
production, l'archiver écrirait une fausse ligne au CHANGELOG. Son VERIFY a été supprimé.

Ce qu'elle apportait est repris en totalité par TASK-053, y compris la réparation de la rupture
`LibelleEspece` (colonne retirée de la vue → `Invalid column name`).
