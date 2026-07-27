# TASK-036 — Numérotation pièce + champs compta depuis une vue SQL GRC

- **Priorité** : 🟠 Majeur
- **Domaine** : Architecture
- **Statut** : APPROVE (2026-07-14, après 1 REJECT — voir CHANGELOG)
- **Dépend de** : TASK-035

## Contexte
Exigence client : maîtriser certains champs des écritures de règlement client au lieu des
valeurs par défaut Sage :
- **Date d'imputation** : **toujours `MV_Date`** (= `reglement.Date`), tous types confondus.
- **N° de pièce** : **`MV_Piece`** du règlement (le journal **caisse/espèce** garde le
  **compteur Sage** — seul point restant à reconfirmer client).
- **N° Facture, Référence, Libellé** : valeurs métier fournies par GRC via une vue SQL.

Mappings confirmés PO :
- `MV_ID` = **clé unique** du règlement en base (= `reglement.No`) → clé de jointure vue.
- `MV_Piece` = **pièce** (→ `EcritureComptable.NumeroPiece`).
- `MV_Numero` = **compteur interne** du règlement (info, **pas** la pièce).
- `MV_Date`   → `EcritureComptable.Date` (via le paramètre `date` de `Generate`).

Champs compta **dérivés** (pas des colonnes distinctes de la vue) :
- `EcritureComptable.Reference` = **1er n° de document** de `MV_Reference` (token avant le 1er `#` = `FirstDoc`).
- `EcritureComptable.Libelle`   = **mode de règlement + intitulé client** (concaténation ; intitulé = `ClientIntitule` de la vue).
- **DocNumero1 / DocNumero2** (2 **nouvelles colonnes compta**, 69 car.) = `MV_Reference` **découpé au `#`** (jamais couper un n° BL).

## Investigation DLL (acquise — NE PAS refaire)
- `ComptabilizerReglement.Comptabiliser(reg, ecritures)` **n'écrase QUE `ErpNo` et
  `NumeroPiece`** (via `IErpComptaService.GetNextNumero`, groupé par journal/période).
  → `Reference`, `Libelle`, `NumeroDocument` **NE sont PAS réécrits**.
- `GetNextNumero` (Sage) ne reçoit que `(journalCode, exercice, période)` — pas le règlement.
- Mapping : **`MV_Piece` ↔ `ReglementClient.PieceNumero`**, `MV_Numero` ↔ `ReglementClient.Numero`.
- Champs cibles sur `EcritureComptable` : `Libelle`, `Reference`, `NumeroDocument`,
  `NumeroPiece`, `TiersNumero`, `PieceTresorerie`.

## Vue SQL GRC (FIGÉE — fournie par le PO)
**Nom : `vw_ReglementsAComptabiliser`**.
Source : `RT_MOUVEMENT` (`MV_Domaine = 0`, `MV_Compta = 0`, `MV_Point = 1`). `MV_Reference`
est **multi-valué** (réfs BL séparées par `#`, ex. `BLG2600096#BLG2600100#…`).
**1 ligne par `MV_ID`** (pas de `STRING_SPLIT` en sortie — `MV_Reference` renvoyé tel quel).
Lookup par `MV_ID` (= `reglement.No`).

**Résolution de l'intitulé client** : à partir du **1er document** de `MV_Reference`
(avant le 1er `#`), recherche en cascade sur une source unifiée `Documents`, par priorité :
1. `GOCOM.dbo.FG_DOCENTETE_SAUV` (documents sauvegardés)
2. `GOCOM.dbo.F_DOCENTETE` (`DO_Type IN (3,6,7)`)
3. `GOCOM.dbo.F_DOCLIGNE` (`DO_Type IN (3,6,7)`, tiers = `CT_Num`)

`ROW_NUMBER() OVER (PARTITION BY DO_Piece ORDER BY Prio)` garde la source prioritaire.
Jointure `F_COMPTET` sur `CT_Num = DO_Tiers` → `CT_Intitule`. Fallback si document
introuvable dans les 3 sources : `COALESCE(cpt.CT_Intitule, r.CT_Intitule)`.

⚠️ Base **GOCOM** (Sage) qualifiée explicitement (`GOCOM.dbo.`) — cross-DB assumé côté vue.

```sql
WITH Documents AS (
    -- priorité 1 : documents sauvegardés
    SELECT DO_Piece, DO_Tiers, 1 AS Prio FROM GOCOM.dbo.FG_DOCENTETE_SAUV
    UNION ALL
    -- priorité 2 : documents Sage courants (BL ou FAG, peu importe)
    SELECT DO_Piece, DO_Tiers, 2 AS Prio FROM GOCOM.dbo.F_DOCENTETE
    WHERE DO_Type IN (3,6,7)
    UNION ALL
    -- priorité 3 : lignes de document (tiers = CT_Num)
    SELECT DO_Piece, CT_Num, 3 AS Prio FROM GOCOM.dbo.F_DOCLIGNE
    WHERE DO_Type IN (3,6,7)
),
DocParPiece AS (
    -- 1 seule ligne par DO_Piece, en gardant la source prioritaire
    SELECT DO_Piece, DO_Tiers,
           ROW_NUMBER() OVER (PARTITION BY DO_Piece ORDER BY Prio) AS rn
    FROM Documents
)
SELECT  r.MV_ID, r.MV_Numero, r.MV_Piece, r.MR_ID, r.MV_Type,
        r.MV_Reference, r.MV_Montant, r.MV_Point, r.MV_Date,
        COALESCE(cpt.CT_Intitule, r.CT_Intitule) AS ClientIntitule
FROM    RT_MOUVEMENT r
CROSS APPLY (
    SELECT SUBSTRING(r.MV_Reference, 1,
                     CHARINDEX('#', r.MV_Reference + '#') - 1) AS FirstDoc
) d
LEFT JOIN DocParPiece doc ON doc.DO_Piece = d.FirstDoc AND doc.rn = 1
LEFT JOIN GOCOM.dbo.F_COMPTET cpt ON cpt.CT_Num = doc.DO_Tiers
WHERE   r.MV_Domaine = 0 AND r.MV_Compta = 0 AND r.MV_Point = 1;
```

### Références BL → DocNumero1 / DocNumero2 (69 car.)
`MV_Reference` (réfs concaténées) est réparti sur **DocNumero1** et **DocNumero2**,
**69 car. chacune**. Découpage **au séparateur `#` uniquement — jamais couper un n° BL**
(algo en **C#**) :
```
tokens = MV_Reference.Split('#')
DocNumero1 = "" ; DocNumero2 = ""
pour chaque token :
    si len(DocNumero1 + token + '#') <= 69 → DocNumero1 += token+'#'
    sinon si len(DocNumero2 + token + '#') <= 69 → DocNumero2 += token+'#'
    sinon → TRONQUER (token abandonné, pas d'erreur ni blocage)
```

**Chemin d'écriture** : `DocNumero1`/`DocNumero2` sont **2 colonnes nouvelles**, non mappées
par la DLL (`EcritureComptable` n'a qu'un `NumeroDocument`). → alimentation par **UPDATE
post-comptabilisation**, keyé sur l'`EcNo`/id de l'écriture générée.

## Objectif
À la comptabilisation, chaque écriture porte :
- **NumeroPiece** = `MV_Piece` (cas rapproché) ; compteur Sage sinon (caisse — à confirmer).
- **Libelle** = **mode de règlement + espace + intitulé client** (`ClientIntitule` de la vue).
- **Reference** = **1er n° de document** de `MV_Reference` (token avant le 1er `#`).
- **DocNumero1 / DocNumero2** = `MV_Reference` découpé au `#` (UPDATE post-compta).
- **Date** = **`MV_Date`** (`reglement.Date`) pour **tous** les types, via `Generate(reg, reg.Date, …)`.

## Stratégie d'injection (deux voies, selon écrasement)
1. **Champs NON écrasés** (`Reference`, `Libelle`) :
   après `generator.Generate(reg, …)` et **avant** `comptabilizer.Comptabiliser`,
   surcharger ces propriétés sur chaque `EcritureComptable` à partir de la vue (lookup par
   `MV_ID`) : `Reference` = 1er doc ; `Libelle` = mode + `ClientIntitule`. Pas de décorateur.
   Les colonnes `DocNumero1`/`DocNumero2` (non mappées par la DLL) sont posées par
   **UPDATE post-compta** (voir section BL).
2. **NumeroPiece** (écrasé par le comptabilizer) : **décorateur `IErpComptaService`**
   (délègue tout sauf `GetNextNumero`). `ReglementService.Comptabiliser` boucle par
   règlement → pousser le contexte (pièce = `MV_Piece`, + journal/mode pour l'aiguillage)
   avant l'appel ; le décorateur renvoie `MV_Piece` pour les modes rapprochés, et **délègue
   au compteur Sage** pour la caisse.
3. **Date** : passer `Generate(reg, reg.Date, …)` pour forcer `MV_Date` sur tous les types.
   ⚠️ Vérifié : `EcritureComptable.set_Date` n'a **aucun appelant** dans la génération → la
   date est pilotée par le paramètre `date` (via décomposition Jour/Mois/Année). **À valider
   sur un aperçu réel** que la date effective de l'écriture = `MV_Date`.

## Fichiers concernés
- Base GRC : **vue SQL `vw_ReglementsAComptabiliser`** (créée par le PO) — voir requête figée ci-dessus.
- `GRC.Infrastructure/…` : repository/lecture de la vue (Dapper, connexion GRC).
- `GRC.Infrastructure/Services/ReglementService.cs` : lookup vue + surcharge champs post-`Generate` + contexte pièce.
- Config IoC / kernel Ninject (**à localiser**) : binding décorateur `IErpComptaService`.
- `GRC.Infrastructure/…` : classe décorateur `IErpComptaService`.

## Étapes d'implémentation
1. Créer/valider la vue SQL (PO) et un accès lecture par `MV_ID` (batch/`IN`).
2. Dans `Comptabiliser` (et l'aperçu) : charger les lignes de vue pour le périmètre.
3. Après `Generate` : injecter `Reference`, `Libelle`, `NumeroDocument` sur les écritures.
4. Décorateur `GetNextNumero` : renvoyer `MV_Piece` (rapproché) / déléguer Sage (caisse),
   contexte par exécution (`AsyncLocal` — cf. `Parallel.ForEach`).
5. Aperçu (TASK-035) : refléter ces mêmes valeurs pour éviter l'écart aperçu ≠ réel.
6. Tests : espèce (date + compteur Sage), rapproché (MV_Piece + champs vue), unicité, décompta.
7. Fallback documenté : `UPDATE` post-compta sur la pièce si un cas résiste.

## Clarifications
- ✅ **Pièce = `MV_Piece`** (`MV_Numero` = compteur interne, pas la pièce).
- ✅ **`Reference`** = 1er n° de document de `MV_Reference` ; **`Libelle`** = mode + intitulé client.
- ✅ **`DocNumero1`/`DocNumero2`** = `MV_Reference` découpé au `#` (les 2 colonnes nommées).
- ✅ **Date = `MV_Date` pour tous les types**.
- ✅ **Journal caisse garde le compteur Sage** : **non** — TASK-038 (2026-07-10) a retiré l'exception
  espèce ; `MV_Piece` forcé partout pour tout règlement présent dans la vue, repli Sage seulement si absent.
- ✅ **Réfs BL** : 2 colonnes nouvelles de 69 car., découpage au `#` (jamais couper un BL),
  alimentées par **UPDATE post-comptabilisation** (colonnes non mappées par la DLL).
- ✅ **Intitulé client** : résolu via cascade `FG_DOCENTETE_SAUV → F_DOCENTETE → F_DOCLIGNE`
  (`DO_Type IN (3,6,7)`), jointure `F_COMPTET`, fallback `RT_MOUVEMENT.CT_Intitule`. Requête figée.
- ✅ **Source des champs compta** : tous **dérivés** (pas de colonnes distinctes) — `Reference`
  = 1er doc, `Libelle` = mode + intitulé, `DocNumero1`/`DocNumero2` = `MV_Reference` split `#`.
- ✅ **Débordement > 2×69 car.** : **tronquer** (les réfs BL au-delà de DocNumero1+DocNumero2
  sont abandonnées — pas d'erreur, pas de blocage compta).
- ✅ **Format `Libelle`** : `mode de règlement` + **espace** + `intitulé client`.

## Contraintes
- Ne jamais bypasser une règle de sécurité ou une DLL métier GRC ; pas de modif des DLL.
- Interception via IoC (décorateur) ; injection des autres champs via l'objet écriture.
- Lecture de la **vue GRC** = OK ; `UPDATE` brut sur table compta = **dernier recours** documenté.
- Respecter la Clean Architecture (Domain ← Application ← Infrastructure/API).

## Checklist VALIDATION (à remplir dans VERIFY/)
- [x] Build OK
- [x] Date effective de l'écriture = MV_Date (tous types) — validé sur aperçu réel ET sur compta réelle
- [x] Rapproché : pièce = MV_Piece pour tous les types/modes présents dans la vue, y compris caisse/espèce
      (exception espèce initiale retirée par TASK-038, 2026-07-10) ; repli compteur Sage seulement si absent de la vue
- [x] Reference = 1er doc de MV_Reference ; Libelle = mode + intitulé client
- [x] DocNumero1/DocNumero2 = MV_Reference découpé au # (jamais couper un BL), via UPDATE post-compta — rejoué en
      run live avec succès le 2026-07-14 (règlement 48053)
- [x] Champs non réécrits par le comptabilizer (vérifié) ; pièce forcée effective
- [x] Pas de collision de pièce ; cohérence partie double (même pièce toutes lignes)
- [~] Décomptabilisation testée — **différé par décision PO (2026-07-14), non bloquant** ; opération native
      Sage/Trésorerie non exposée par GRC_WEB, non testable depuis ce code
- [x] Aucun bypass DLL ; UPDATE brut absent (ou justifié/documenté) — UPDATE limité à DocNumero1/2 (colonnes
      custom non gérées par la DLL), demandé par le PO
- [x] Cohérent avec l'architecture
