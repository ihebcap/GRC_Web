# TASK-053 — Écriture comptable règlement client : spec complète des 4 champs (espèce / hors espèce)

- **Priorité** : 🔴 Bloquant (écritures comptables réelles)
- **Domaine** : SQL (vue GRC) + Backend (Infrastructure) / Comptabilisation
- **Statut** : TODO
- **Absorbe** : **TASK-052** (libellé hors espèce) — sa règle de repli « mode de règlement seul »
  n'existe plus, remplacée ici par le mot `Versement` porté par la vue. TASK-052 ne doit pas être
  archivée en DONE : elle est reprise en totalité par cette TASK.
- **Dépend de** : TASK-036 (pièce/DocNumero), TASK-038 (pièce forcée), TASK-039 (découpage `#`),
  TASK-049 (libellé espèce), TASK-050 (lettrage)

## Contexte

Spec PO du 2026-07-15, arrêtée après échange question/réponse et vérification systématique en base
(`GR_GOCOM` / `DESKTOP-2VCUE93`). Elle **redéfinit les 4 champs** de l'écriture comptable et, pour la
première fois, les **différencie par mode** (espèce / hors espèce). Aucun champ n'était jusqu'ici
différencié : c'est le changement structurel de cette TASK.

### Spec PO (verbatim)

```
Mode Espèce
Libellé   : ESP + N° Facture ; si la facture n'a pas pu être identifiée -> ESP seul
Référence : N° BL
N° Pièce  : Numéro de règlement sans RC
N° Facture: N° Facture

Mode Hors Espèce
Libellé   : le libellé saisi par le magasin ; si vide -> le mot « Versement »
Référence : N° BL Origine
N° Pièce  : Code Banque
N° Facture: vide
```

### Décisions PO prises pendant l'échange (toutes tracées)

1. **N° de facture** = `RT_AFFECTATION.MV_Id` → `RT_ECHEANCE.DO_Numero`, filtré `DO_Type = 6`.
   Écarté : l'extraction depuis `MV_Libelle` (parsing de chaîne, fragile).
2. **Placement** : la logique va **dans la vue** `vw_ReglementsAComptabiliser`, pas dans le C#.
   Cohérent avec la décision `MV_Piece` (la vue est la source de vérité). Le C# devient passe-plat.
3. **`MV_Piece` est bien le code banque** (confirmé PO).
4. **`MV_Type = 4` est traité EXACTEMENT comme `MV_Type = 3`**. Seuls les types 0, 3 et 4 existent
   (vérifié). La règle devient donc binaire : `MV_Type = 0` = espèce, tout le reste = hors espèce.
5. **Troncature** aux longueurs Sage, assumée par le PO (voir « Troncature » ci-dessous).
6. **Multi-factures** (5 règlements espèce ont 2 à 6 factures affectées) : on retient la
   **première affectation** (`AF_Id` croissant).
7. **`DocNumero1/2`** : leur raison d'être est de porter `MV_Reference` quand elle contient
   plusieurs documents séparés par `#` (ex. `RBB17032601` = 14 documents `FI…`). Pour l'espèce,
   `MV_Reference` est vide dans 21 791 cas sur 22 421 → les deux zones sont libres.

## État actuel (à remplacer)

| Champ | Source actuelle | Différenciation par mode |
|---|---|---|
| Libellé | `MV_Libelle`, repli « mode seul » calculé en C# (TASK-052) | aucune |
| Référence | `MvReferenceHelper.FirstDoc(MV_Reference)` | aucune |
| N° Pièce | `MV_Piece` (passe-plat, TASK-038) | `MV_Type <> 3` dans la vue |
| N° Facture | `DocNumero1/2` = `MV_Reference` découpé au `#` | aucune |

## Objectif

### Vue (livrée : `SQL_005_TASK-053_LibelleEcriture.sql`, à appliquer par le PO)

| Colonne | Espèce (`MV_Type = 0`) | Hors espèce (3 et 4) |
|---|---|---|
| `LibelleEcriture` *(nouvelle)* | `'ESP ' + FactureNumero` ; `ESP` seul si aucune facture | libellé saisi ; `Versement` si vide/NULL |
| `ReferenceCompta` | `mv_info3` (le BL) | `mv_reference` |
| `MV_Piece` | `replace(MV_Numero,'RC','')` | code banque `MV_Piece`, tronqué à 13 |
| `FactureNumero` *(nouvelle)* | `RT_ECHEANCE.DO_Numero` (`DO_Type = 6`, `TOP 1` par `AF_Id`) | (non utilisée) |

Corrections embarquées par la vue :
- `LibelleEcritre` (sic) était **cassée** : `'ESP ' + MV_Reference`, or `MV_Reference` est **vide**
  sur l'espèce (le BL est dans `MV_Info3`) → elle valait `"ESP "` sur 21 868 des 22 421 règlements
  espèce, sans jamais le n° de facture. Renommée `LibelleEcriture` au passage (colonne neuve, non
  encore consommée → renommage sans impact).
- `OUTER APPLY … TOP 1` : préserve le contrat **1 ligne par `MV_ID`** malgré le 1-N de
  `RT_AFFECTATION` (sans quoi `GetByMvIds` garderait silencieusement la dernière ligne).

### Code C#

- **Repository** : `ReglementComptaViewRow` + `SELECT` exposent `LibelleEcriture`,
  `ReferenceCompta`, `FactureNumero`. `MV_Libelle` n'est plus consommée.
- **`AppliquerChampsVue`** : `Libelle` et `Reference` deviennent de **purs passe-plats**.
  - Le repli disparaît du C# (il est dans la vue) → `ChargerIntitulesModes` et le paramètre `modes`
    deviennent **morts** : à supprimer (leur seul usage était ce repli).
  - `MvReferenceHelper.FirstDoc` **saute** : la vue fait déjà l'extraction dans `ReferenceCompta`.
    ⚠️ Le garder tronquerait la valeur déjà calculée par la vue.
- **`DocNumero1/2`** — nouvelle règle, factorisée (3 sites appellent aujourd'hui `SplitDocNumeros` :
  l.353, l.598, l.727) :
  - **Espèce avec facture** : `DocNumero1` = `FactureNumero`, `DocNumero2` = `MV_Reference`.
    ⚠️ En espèce, `MV_Reference` n'est **pas** un BL (le BL est dans `mv_info3` → `ReferenceCompta`)
    mais une **référence bancaire** (`B0021729-2026010909541589`, `2026010810070172`, parfois un nom
    comme `BAHIJ`). On la relègue en zone 2 plutôt que de l'écraser → **aucune perte**. Les 607
    règlements concernés n'ont qu'**un seul** document (25 car. max) : la zone 2 suffit.
  - **Espèce sans facture** (23 lignes) et **hors espèce** : `SplitDocNumeros(MV_Reference)`,
    **inchangé** (TASK-036/039). Les 7 259 BL du hors espèce ne sont **pas** écrasés.

## Troncature — décision PO, avec ses limites

Les colonnes Sage sont de largeur fixe ; les sources sont en `nvarchar(max)`.

| Champ écriture | Max Sage | Lignes qui débordent | Traitement |
|---|---|---|---|
| `EC_Piece` | 13 | 1 189 (type 3) | **tronqué** à 13 |
| `EC_Intitule` | 69 | 536 | **tronqué** à 69 |
| `EC_Reference` | 17 | 23 | tronqué — **sans perte** : l'info complète est dans `DocNumero1/2` |
| `DocNumero1`+`2` | 69+69 = 138 | 1 (139 car.) | 1 document abandonné (`RBB17032601`) — comportement TASK-039 |

**Pourquoi la troncature de `EC_Piece` est sans risque** (point instruit et tranché) : les `MV_Piece`
longs sont de la forme `B0022588-202605220841019000000` (code banque + horodatage) ; tronquer à 13
coupe l'horodatage discriminant et rend **211 lignes ambiguës entre elles** (jusqu'à 79 règlements
partageant `B0096542-2026`). **Mais ces 211 lignes sont TOUTES non rapprochées** (`MV_Point = 0`) :
les types 1/2/3 non rapprochés ne partent jamais en compta (règle métier, contrôle utilisateur).
**Vérifié en base : zéro collision entre lignes rapprochées.**

**Seule exception à la troncature** : si `MV_Piece` est **vide** (1 ligne, type 4), repli sur le
n° de règlement — garde-fou pour ne jamais écrire une pièce comptable vide.

## Fichiers concernés

- `SQL_005_TASK-053_LibelleEcriture.sql` *(livré)* — à appliquer sur `GR_GOCOM` par le PO.
- `GRC.Infrastructure/Repositories/ReglementComptaViewRepository.cs` — `ReglementComptaViewRow` + `SELECT`.
- `GRC.Infrastructure/Services/ReglementService.cs` — `AppliquerChampsVue` (l.561-589),
  `EcrireDocNumeros` (l.593-617), sites `SplitDocNumeros` (l.353, l.727),
  `ChargerIntitulesModes` (l.519-527, à supprimer), `EcritureApercuDto` (commentaires l.785-794).

## Étapes d'implémentation

1. **PO** : appliquer `SQL_005_TASK-053_LibelleEcriture.sql`.
2. **Repository** : `LibelleEcriture`, `ReferenceCompta`, `FactureNumero` dans la row + le `SELECT`.
   Conserver `MV_Type` et `MV_Reference` (nécessaires à la règle `DocNumero`).
3. **`AppliquerChampsVue`** : passe-plat ; retirer `modes`/`ChargerIntitulesModes` et `FirstDoc`.
4. **`CalculerDocNumeros(viewRow)`** : factoriser la règle espèce/hors espèce, appelée par les 3 sites.
5. **Point unique** : `AppliquerChampsVue` est appelé par l'aperçu **et** par la compta réelle → un
   seul changement, aucune duplication.

## Contraintes

- Aucun bypass des DLL métier GRC/Sage ; pas de modif des DLL.
- Lecture de vue uniquement ; le seul `UPDATE` brut reste celui, préexistant, de `DocNumero1/2`.
- Respecter la Clean Architecture (Domain ← Application ← Infrastructure/API).
- Ne jamais écrire un libellé vide, ni une pièce vide.

## Checklist VALIDATION (à remplir dans VERIFY/)

- [ ] Vue appliquée par le PO ; colonnes `LibelleEcriture` / `ReferenceCompta` / `FactureNumero` vérifiées **en base** (pas de nom supposé)
- [ ] Build OK
- [ ] Contrat « 1 ligne par `MV_ID` » préservé (46 056 lignes / 46 056 `MV_ID` distincts)
- [ ] Espèce + facture → libellé `ESP <facture>` ; espèce sans facture (23 lignes) → `ESP`
- [ ] Hors espèce + libellé saisi → libellé saisi ; hors espèce vide (1 950 lignes) → `Versement`
- [ ] Aucun libellé vide, aucune pièce vide, aucun dépassement (13 / 69 / 17) sur les 46 056 lignes
- [ ] `MV_Type = 4` (236 lignes) traité comme le type 3 sur les 4 champs
- [ ] Espèce : `DocNumero1` = facture, `DocNumero2` = BL — les 607 cas BL+facture sans perte
- [ ] Hors espèce : `DocNumero1/2` inchangés — les 7 259 BL non écrasés (non-régression TASK-036/039)
- [ ] `FirstDoc` retiré ; `ChargerIntitulesModes`/`modes` supprimés (code mort)
- [ ] Vérifié identique sur aperçu ET compta réelle (point unique `AppliquerChampsVue`)
- [ ] Cohérent avec l'architecture ; aucun bypass DLL
