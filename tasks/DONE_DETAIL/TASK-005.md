# TASK-005 — Parseur Excel : dates au format numérique + montants sensibles à la culture

- **Priorité** : 🟠 Majeur
- **Domaine** : Correction
- **Statut** : TODO
- **Dépend de** : —

## Contexte
`ReleveBancaireImportService.ParserFichierExcel` (`GRC.Application/Services/ReleveBancaireImportService.cs`) lit chaque cellule via `row[col].ToString()` puis `DateTime.TryParse` / `decimal.TryParse` sans culture.

## Problème constaté
1. **Dates Excel numériques (serial date)** : la Phase 2 exige « conversion sécurisée des dates depuis le format numérique d'Excel ». ExcelDataReader peut renvoyer soit un `DateTime`, soit un `double` (serial). Dans le cas serial, `ToString()` produit un nombre que `DateTime.TryParse` rejette → **ligne silencieusement ignorée**.
2. **Montants** : `decimal.TryParse(row[col]?.ToString(), out ...)` sans `CultureInfo` explicite. En contexte FR (virgule) vs invariant (point), risque de montant erroné — **critique** car le rapprochement matche sur le montant exact.

## Objectif
Import fiable : toutes les lignes valides sont importées, dates et montants corrects quel que soit le format source.

## Fichiers concernés
- `GRC.Application/Services/ReleveBancaireImportService.cs`

## Étapes d'implémentation
1. Lire la valeur **typée** de la cellule (`row[col]` en `object`) : si `DateTime` → utiliser directement ; si numérique → `DateTime.FromOADate(double)` ; sinon `DateTime.TryParse` avec culture explicite.
2. Pour les montants : gérer `object` numérique direct (`Convert.ToDecimal`) et, en repli chaîne, `decimal.TryParse` avec la/les culture(s) attendue(s) (FR-fr et/ou InvariantCulture).
3. Ajouter des tests unitaires avec un Excel contenant dates serial + dates texte + montants virgule/point.

## Contraintes
- Ne pas perdre de ligne valide silencieusement (voir TASK-006).

## Checklist VALIDATION (à remplir dans VERIFY/)
- [ ] Build OK
- [ ] Test avec dates serial numériques → dates correctes
- [ ] Test montants virgule/point → valeurs correctes
- [ ] Aucune ligne valide ignorée
- [ ] Cohérent avec l'architecture
