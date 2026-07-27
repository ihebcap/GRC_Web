# TASK-049 — Libellé écriture compta : espèce → colonne LibelleEspece

- **Priorité** : 🟠 Majeur
- **Domaine** : Backend (Infrastructure) / Comptabilisation
- **Statut** : TODO
- **Dépend de** : TASK-036 (livrée)

## Contexte
Exigence PO : le **libellé de l'écriture comptable** générée à la comptabilisation des
règlements clients doit dépendre du type de règlement.

Aujourd'hui, `AppliquerChampsVue` pose le **même** libellé pour tous les types :
`libellé = mode de règlement + " " + intitulé client` (voir
`GRC.Infrastructure/Services/ReglementService.cs:466`).

Nouvelle règle :
- **Mode espèce (`MV_Type = 0`)** → libellé = colonne **`LibelleEspece`** de la vue
  (`LibelleEspece = CASE WHEN MV_Type = 0 THEN MV_Libelle ELSE '' END`).
- **Tous les autres types** → **inchangé** (mode + intitulé client).

## Décisions PO (actées)
- ✅ **Critère espèce = `MV_Type = 0`** uniquement (aligné sur la vue : c'est le même
  critère que `LibelleEspece` et que `MV_Piece = mv_info3`).
- ✅ **Repli si `LibelleEspece` vide/NULL** (cas `MV_Type = 0`) : retomber sur le libellé
  actuel (mode + intitulé client). **Aucune écriture avec libellé vide.**

## Vue SQL (déjà mise à jour côté PO)
La vue `vw_ReglementsAComptabiliser` expose désormais **2 colonnes supplémentaires** utiles
ici : `MV_Type` et `LibelleEspece`.
```sql
        r.MV_Type,
        CASE WHEN MV_Type = 0 THEN MV_Libelle ELSE '' END AS LibelleEspece
```
> Rappel : `MV_Piece` de la vue vaut déjà `CASE WHEN MV_Type = 0 THEN mv_info3 ELSE MV_Piece END`
> — la logique espèce ↔ `MV_Type = 0` est cohérente de bout en bout.

## Fichiers concernés
- `GRC.Infrastructure/Repositories/ReglementComptaViewRepository.cs`
  - Ajouter `MV_Type` (int) et `LibelleEspece` (string?) à `ReglementComptaViewRow`.
  - Ajouter ces 2 colonnes au `SELECT` (l.41-43).
- `GRC.Infrastructure/Services/ReglementService.cs`
  - `AppliquerChampsVue` (l.457-474) : brancher le libellé selon `MV_Type`.

## Étapes d'implémentation
1. **Repository** : étendre `ReglementComptaViewRow` (`MV_Type`, `LibelleEspece`) et le
   `SELECT` de `GetByMvIds`.
2. **`AppliquerChampsVue`** : calculer le libellé ainsi :
   ```
   libelleParDefaut = (mode + " " + ClientIntitule).Trim()   // logique existante
   libelle = (viewRow.MV_Type == 0 && !string.IsNullOrWhiteSpace(viewRow.LibelleEspece))
                 ? viewRow.LibelleEspece.Trim()
                 : libelleParDefaut
   ```
   `Reference` et `DocNumero1/2` : **inchangés**.
3. **Point unique** : `AppliquerChampsVue` est déjà appelé par l'aperçu
   (`ApercuComptabilisation`, l.605) **et** par la compta réelle (`Comptabiliser`) → un seul
   changement suffit, aperçu et réel restent cohérents. Ne PAS dupliquer la logique.

## Contraintes
- Ne rien changer pour les types ≠ 0 (non-régression sur le libellé rapproché).
- Aucun bypass DLL, pas de modif des DLL Sage. Lecture de la vue GRC uniquement.
- Respecter la Clean Architecture (Domain ← Application ← Infrastructure/API).

## Checklist VALIDATION (à remplir dans VERIFY/)
- [ ] Build OK
- [ ] `ReglementComptaViewRow` + `SELECT` remontent `MV_Type` et `LibelleEspece`
- [ ] Espèce (`MV_Type = 0`) + `LibelleEspece` non vide → libellé écriture = `LibelleEspece`
- [ ] Espèce (`MV_Type = 0`) + `LibelleEspece` vide → repli mode + intitulé (jamais vide)
- [ ] Type ≠ 0 → libellé inchangé (mode + intitulé client)
- [ ] Vérifié identique sur aperçu ET compta réelle (point unique `AppliquerChampsVue`)
- [ ] Cohérent avec l'architecture ; aucun bypass DLL
