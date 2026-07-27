# TASK-039 — Écran simulation/comptabilisation : filtrer les caisses sur celles autorisées à l'utilisateur

- **Priorité** : 🟡 UX / Cohérence droits
- **Domaine** : Front
- **Dépend de** : —

## Contexte
Sur l'écran de simulation de comptabilisation ([ApercuComptabilisation.tsx](../gocom-web/src/ApercuComptabilisation.tsx)), le **fetch des règlements** est déjà borné aux caisses autorisées de l'utilisateur (`user.caisses`, [l.177](../gocom-web/src/ApercuComptabilisation.tsx#L177)). En revanche, **la liste déroulante de sélection de caisse affiche TOUTES les caisses** de la société :

```js
// ApercuComptabilisation.tsx:253-254 — aucun filtre sur user.caisses
const caisseOptions = useMemo(() => {
  return Object.entries(caissesMap).map(([id, obj]) => ({ value: id, label: ... }));
}, [caissesMap]);
```

`caissesMap` contient toutes les caisses ; `user.caisses` (typé `number[]`, [l.14](../gocom-web/src/ApercuComptabilisation.tsx#L14)) est la liste autorisée (dérivée de la claim JWT `Caisses`). C'est incohérent avec le reste de l'appli : la **liste des règlements** ([ReglementController.cs:55-56](../GRC.API/Controllers/ReglementController.cs#L55)) et le **rapprochement** ([ReleveBancaireController.cs:109-110](../GRC.API/Controllers/ReleveBancaireController.cs#L109)) filtrent déjà sur les caisses autorisées.

## Objectif
Aligner le filtre caisse de la simulation sur le comportement des autres écrans : la déroulante ne propose **que** les caisses autorisées à l'utilisateur.

## Fichiers concernés
- `gocom-web/src/ApercuComptabilisation.tsx` : `caisseOptions` [l.253-255](../gocom-web/src/ApercuComptabilisation.tsx#L253).

## Étapes d'implémentation
1. Filtrer les options sur `user.caisses` :
   ```js
   const caisseOptions = useMemo(() => {
     return Object.entries(caissesMap)
       .filter(([id]) => user.caisses.includes(Number(id)))
       .map(([id, obj]: [string, any]) => ({ value: id, label: obj ? `${obj.code} - ${obj.intitule}` : id }));
   }, [caissesMap, user.caisses]);
   ```
2. Vérifier le typage : clés de `caissesMap` = `string`, `user.caisses` = `number[]` → conversion `Number(id)` requise.

## Contraintes
- **Front uniquement** : le back filtre déjà via la claim JWT `Caisses` — ne rien changer côté API.
- Ne pas dupliquer la logique de droits : s'appuyer sur `user.caisses` déjà fourni au composant.

## Risques / dépendances
- Faible. Vérifier qu'un utilisateur **admin** (toutes caisses) reçoit bien toutes ses caisses dans `user.caisses` (sinon la déroulante se viderait à tort pour l'admin — à confirmer selon la façon dont `user.caisses` est peuplé pour un admin).

## Checklist VALIDATION (à remplir dans VERIFY/)
- [ ] Build front OK
- [ ] Utilisateur non-admin : la déroulante caisse ne liste que ses caisses autorisées
- [ ] Utilisateur admin : la déroulante liste bien toutes ses caisses
- [ ] Aucune régression du fetch (les données restaient déjà bornées à `user.caisses`)
