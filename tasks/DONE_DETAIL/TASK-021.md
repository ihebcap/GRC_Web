# TASK-021 — Rapprochement bancaire : restreindre les règlements éligibles (type / état remis)

- **Priorité** : 🔴 Majeur (produit de **faux rapprochements** — appariement espèce ↔ ligne bancaire)
- **Domaine** : Métier / justesse comptable
- **Statut** : TODO
- **Dépend de** : — (indépendant ; interagit avec l'auto-rapprochement TASK-012 et l'affichage `/reglements`)

## Contexte
Diagnostic terrain (relevé BCP, user 186). Le relevé affichait 6 lignes lettrées (A→F) mais la grille GRC n'en montrait que 2. Investigation base (`GR_GOCOM`) :

| Repère | MV_Id | Pointé | MV_Type | Nature | MV_Remis | Montant |
|--------|-------|--------|---------|--------|----------|---------|
| A | 12045 | non | 3 | Virement | 0 | 9340 |
| B | 9765 | non | 3 | Virement | 0 | 3592 |
| C | 1706 | non | **0** | **Espèce** | 0 | 40000 |
| D | 4707 | non | **0** | **Espèce** | 0 | 9350 |
| E | 3820 | non | **0** | **Espèce** | 0 | 8400 |
| F | 3390 | non | **0** | **Espèce** | 0 | 1000 |

Aucun n'est pointé. C-F sont des règlements **espèce** appariés par erreur à des lignes bancaires. Cause : l'auto-rapprochement matche sur le **montant seul** (comportement voulu pour le montant, cf. TODO) mais **ne filtre pas le type ni l'état remis** du règlement. Il réserve donc des espèces (et potentiellement chèques/traites non remis, type « Autre ») sur des encaissements bancaires → faux rapprochements + lignes relevé réservées « orphelines » (contrepartie invisible dans la grille bancaire).

> Les montants C-F sont des **données de test** (confirmé PO) — pas de contrepartie bancaire réelle à retrouver, pas de data-fix demandé.

## Problème constaté
- `ReleveBancaireController.GenererPropositions` (auto-rapprochement) charge les règlements non pointés de la banque **sans filtre de type/remis** ([ReleveBancaireController.cs:110-124](../GRC.API/Controllers/ReleveBancaireController.cs#L110-L124)) → propose des espèces / chèques non remis / type « Autre ».
- Conséquence : appariements comptablement faux (une ligne bancaire ne peut correspondre qu'à un encaissement réellement passé en banque).

## Objectif — règle d'éligibilité unique
Un règlement GRC est **éligible au rapprochement bancaire** si et seulement si :

```
Éligible(r) =
      MV_Type == 3                              // Virement
   OR ( MV_Type IN (1, 2) AND MV_Remis == 2 )   // Chèque / Traite REMIS en banque
```

**Exclus** dans tous les cas : Espèce (`MV_Type = 0`), « Autre » (`MV_Type = 4`), et Chèque/Traite **non remis** (`MV_Remis ≠ 2`).

Cette règle unique s'applique **à la fois** à l'auto-rapprochement **et** à la grille GRC affichée (pour que le lettrage manuel, contraint par ce qui est affiché, ne puisse pas non plus apparier un règlement inéligible).

## Fichiers concernés
- `GRC.API/Controllers/ReleveBancaireController.cs` (auto-rapprochement — `GenererPropositions`)
- `GRC.Infrastructure/Services/ReglementService.cs` (`GetReglements` — grille GRC affichée)
- (option) un helper partagé pour ne définir la règle **qu'une seule fois** (éviter la dérive entre les deux points d'application)

## Étapes d'implémentation

### 1. Vérifier le mapping du DTO `ReglementClient`
Confirmer que le DTO expose bien les champs mouvement nécessaires :
- `MV_Type` → probablement `reg.Type` (⚠️ à vérifier : le commentaire `// Ordre Extrait` sur `(int)reg.Type == 3` dans [ReleveBancaireRepository.cs:220](../GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs#L220) sème le doute ; valider que `reg.Type` vaut bien `MV_Type`).
- `MV_Remis` → probablement `reg.IsRemis` (int). ⚠️ Le code actuel teste `r.IsRemis > 0` ([ReglementService.cs:96](../GRC.Infrastructure/Services/ReglementService.cs#L96)) ; la règle demande **`== 2`** (remis en banque), pas `> 0`.

**Si l'un des deux champs n'est pas exposé de façon fiable par le DTO** : récupérer `MV_Type` / `MV_Remis` par une requête d'appoint sur `RT_MOUVEMENT` pour les `MV_Id` chargés (même motif chunké que le dictionnaire de réservations, cf. TASK-018), puis filtrer. Ne **pas** modifier la DLL.

### 2. Centraliser la règle d'éligibilité
Créer un prédicat unique (helper) `EstEligibleRappBancaire(mvType, mvRemis)` implémentant la règle de l'Objectif, et l'utiliser aux deux endroits.

### 3. Appliquer à l'auto-rapprochement
Dans `GenererPropositions`, après le chargement/filtre existant (non pointés + banque), ajouter le filtre d'éligibilité **avant** `CalculerPropositions` ([ReleveBancaireController.cs:115-126](../GRC.API/Controllers/ReleveBancaireController.cs#L115-L126)).

### 4. Appliquer à la grille GRC affichée
Dans `GetReglements`, restreindre la liste renvoyée aux règlements éligibles, pour que la grille bancaire n'affiche que Virement + Chèque/Traite remis. Ainsi le lettrage manuel est naturellement contraint.
> ⚠️ Vérifier le comportement actuel avant/après : aujourd'hui les espèces semblent déjà absentes de la grille (exclusion incidente), mais les **chèques/traites non remis** et le **type « Autre »** ne le sont probablement pas — c'est cette partie que la règle explicite doit fermer. Ne pas régresser l'affichage des Virements/Chèques-Traites remis légitimes.

## Contraintes
- **Aucune modification des DLL `Tresorerie.*`** — filtrage dans la couche service/API après `GetAll`. Lecture seule, aucune écriture base.
- **Règle définie une seule fois** (helper partagé) : l'auto-rapprochement et l'affichage doivent utiliser exactement le même prédicat — pas de divergence.
- `MV_Remis == 2` strict (remis en banque) — ne pas retomber sur `> 0`.
- Respect Clean Architecture (Domain ← Application ← Infrastructure/API).
- Ne pas toucher au matching **montant 1=1** (voulu) : on ajoute seulement un filtre d'**éligibilité amont**, on ne change pas l'algorithme de correspondance.

## Risques / dépendances
- Vérifier la sémantique exacte de `MV_Remis` (0 = non remis … 2 = remis) et de `MV_Type` (0 Espèce, 1 Chèque, 2 Traite, 3 Virement, 4 Autre) — valeurs confirmées PO, mais s'assurer que le DTO les remonte sans transformation.
- Interaction avec le filtre `banqueNos` existant (`r.BanqueNo`) : ne pas le retirer ; la règle d'éligibilité s'**ajoute**.
- Les réservations orphelines actuelles (C-F) sont du test → hors périmètre (aucun nettoyage demandé).

## Checklist VALIDATION (à remplir dans VERIFY/)
- [ ] Build OK
- [ ] Espèce (`MV_Type=0`) : jamais proposé par l'auto-rapprochement ni affiché dans la grille GRC
- [ ] Type « Autre » (`MV_Type=4`) : idem exclu
- [ ] Chèque/Traite **non remis** (`MV_Remis ≠ 2`) : exclus
- [ ] Chèque/Traite **remis** (`MV_Remis = 2`) : éligibles (proposés + affichés)
- [ ] Virement (`MV_Type=3`) : éligible
- [ ] Auto-rapprochement **et** grille GRC utilisent la **même** règle (helper unique)
- [ ] Le cas C-F (espèce ↔ ligne bancaire) ne peut plus se produire
- [ ] Aucune modif DLL ; lecture seule ; Clean Architecture respectée

## Note — sujet connexe distinct (à cadrer séparément si voulu)
Indépendamment de ce bug, `SauvegarderValidationAsync` (Phase 2) pointe le règlement GRC mais **ne marque jamais la ligne relevé** comme finalisée ([ReleveBancaireRepository.cs:166-231](../GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs#L166-L231)) : une ligne relevé validée garde son `Lettrage`/`MV_ID` et **réapparaît lettrée** au rechargement (son règlement pointé étant, lui, exclu par `pointe=false`). Ce n'était **pas** la cause du cas C-F (non pointés), mais reste un vrai défaut → **cadré dans TASK-022** (colonne `DateValidation` sur `RAPP_ReleveBancaire_Ligne` + exclusion des lignes finalisées).
