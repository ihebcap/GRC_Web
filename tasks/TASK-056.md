# TASK-056 — `vMetaRecouvrementBL` : correction du suivi de recouvrement par BL + lenteur Metabase

- **Priorité** : 🔴 Bloquant (chiffres de recouvrement faux communiqués aux dépôts)
- **Domaine** : SQL (vue GOCOM/Metabase) + Performance
- **Statut** : TODO
- **Dépend de** : —
- **Portée** : Solution SQL définitive pour les 2 bugs de recouvrement ([TASK-057](TASK-057.md)
  — écran dédié GRC_WEB — **abandonnée**, cf. sa clôture). Le volet performance, lui, **n'est pas
  résolu par cette TASK** : incident constaté le 2026-07-16 (~3-4 min d'exécution malgré les index),
  cause structurelle (CTE non matérialisées), fix durable cadré séparément par
  [TASK-058](TASK-058.md) (table persistée). Voir « Incident — temps d'exécution » plus bas.

## Contexte

Demande PO du 2026-07-16, hors périmètre GRC_WEB (vue `[dbo].[vMetaRecouvrementBL]` sur la base
`GR_GOCOM`, consommée par Metabase — pas de code applicatif GRC_WEB touché). Cadrage métier :

- Un BL peut être **éclaté sur plusieurs factures**, potentiellement de **clients différents**.
- Chaque facture issue du BL est réglée en **espèce**.
- Le dépôt régional saisit ensuite le **versement réel** (remise en banque) correspondant, en
  renseignant dans `MV_Reference` **un ou plusieurs numéros de BL séparés par `#`**.
- Chaque dépôt doit voir **son propre recouvrement, par BL d'origine** ; seul l'utilisateur
  `n.salim` doit voir **tous les BL** tous dépôts confondus.
- Constat PO : **lenteur énorme sur Metabase**.

Tracé pendant l'analyse (échange PO 2026-07-16) :
1. Répartition d'un versement multi-BL (`#`) : **au prorata de la date, le BL le plus ancien soldé
   en premier** (FIFO par date de BL).
2. Périmètre par dépôt dans Metabase : **déjà géré comme dans une autre application du PO**, par
   filtrage sandbox sur une colonne (client/dépôt). ⚠️ **Révisé le 2026-07-16** (incident perf, cf.
   plus bas) : le CTE `account`/`dep` et les colonnes `A_EMAIL`/`ID_UserBhub`/`DE_Intitule` ont été
   **retirés de la vue à la demande du PO** — le périmètre par dépôt repose désormais **entièrement**
   sur la configuration du sandbox Metabase, sans aucun filet côté SQL.
3. Granularité de restitution d'un BL éclaté sur plusieurs clients : **une ligne par BL** (agrégée),
   pas une ligne par fragment client.
4. Ajout d'index non-clustered **autorisé** par le PO sur les tables GOCOM concernées.

## Problèmes constatés (2 bugs confirmés en base + 2 causes de lenteur, 1 hypothèse invalidée)

### Bug 1 — le séparateur `#` n'est jamais exploité (bloquant, silencieux)

```sql
r AS (
    SELECT MV_Reference AS NumeroBL, SUM(MV_Montant) AS TotalReglement
    FROM zvMeta_ReglementBL
    GROUP BY MV_Reference
)
...
LEFT JOIN r ON d.DO_Piece = r.NumeroBL
```

`MV_Reference` peut valoir `"BL001#BL002#BL003"`. Le `GROUP BY` traite cette chaîne comme une seule
clé, puis le `JOIN` fait un **match exact de chaîne** contre `DO_Piece` (un numéro de BL unitaire).
Un versement qui règle plusieurs BL ne matche **jamais** un BL individuel → `TotalReglement = 0`
pour tout BL réglé via un versement groupé, alors qu'il est réellement soldé. C'est exactement le
cas d'usage central de la demande.

### Bug 2 — un BL éclaté sur plusieurs clients est compté en double (bloquant, silencieux)

```sql
BL AS (
    SELECT DL_PieceBL, SUM(dl_montantttc) AS DO_TotalTTC, DE_No, CT_Num AS DO_Tiers, DL_DateBL AS DO_Date
    FROM GOCOM.dbo.F_DOCLIGNE l
    ...
    GROUP BY DL_PieceBL, DE_No, CT_Num, DL_DateBL   -- CT_Num dans la clé
)
```

Un même `DL_PieceBL` éclaté sur 3 clients produit **3 lignes** (une par client), chacune avec sa
fraction du TTC. Le `LEFT JOIN r ON d.DO_Piece = r.NumeroBL` (un seul total par numéro de BL) se
retrouve joint **identiquement aux 3 lignes** : si le BL est réglé à 900, Metabase affiche 900 sur
chacune des 3 lignes client → recouvrement compté 3× dès qu'on additionne dans un tableau de bord,
solde faux sur chaque fragment (TTC-fragment comparé au règlement-total).
**Décision PO : restitution au grain BL** (agrégée, client retiré de la clé de regroupement).

### Hypothèse de bug sur `FA_BL` — testée en base, INVALIDÉE

Une lecture initiale avait fait suspecter que `FA_BL` comparait `l.DO_Piece` (numéro de facture) à
`f.DO_Piece` (supposé numéro de BL), rendant le `NOT EXISTS` inopérant. **Diagnostic PO 2026-07-16 :**

| Version testée | BL exclus |
|---|---|
| `DO_Piece` vs `DO_Piece` (code d'origine) | **3012** |
| `DL_PieceBL` vs `DO_Piece` (variante proposée) | **0** |

La version d'origine exclut bien 3012 BL, la variante proposée n'exclut rien : l'hypothèse était
fausse (elle reposait sur une mauvaise lecture de la sémantique de `DO_Type IN (6,7)` dans
`F_DOCLIGNE`/`F_DOCENTETE` — vraisemblablement des types facture/avoir, cohérent avec la convention
documentée dans `SQL_005` où `RT_ECHEANCE.DO_Type = 6` = facture). **`FA_BL` est laissée strictement
inchangée.** Retenu comme illustration : ne pas modifier une logique métier sur une hypothèse de
lecture de code seule, sans confirmation par la donnée réelle.

### Cause de lenteur 1 — `FG_DOCENTETE_SAUV` scannée sans aucun filtre

```sql
SELECT f.DO_Piece, f.DO_Date, f.DO_Tiers, f.DE_No, f.DO_TotalTTC
FROM GOCOM.dbo.FG_DOCENTETE_SAUV f
```

Aucun `WHERE` : **tout l'historique archivé**, tous dépôts et toutes sociétés confondus, est
remonté à **chaque exécution de la vue**, alors que les deux autres branches du `UNION ALL` sont
filtrées par `EXISTS (account)`. Coût direct, et incohérence de périmètre (des documents hors
`R_ID(4,5)` peuvent apparaître avec `DE_Intitule = 'AUTRE'`).

### Cause de lenteur 2 — CTE réévaluées, pas d'index dédiés

`account` (avec `STRING_SPLIT`/`CROSS APPLY`) est référencée 4 fois ; SQL Server ne matérialise pas
les CTE automatiquement. Combiné à l'absence d'index sur les colonnes de jointure/filtre
(`DL_PieceBL`, `DO_Type`+`DE_No`, `DO_NumFC`, `MV_Domaine`+`MV_Reference`), le plan d'exécution
recalcule des sous-arbres coûteux plusieurs fois par appel — critique pour un outil interactif
comme Metabase où la vue est interrogée à chaque clic, sans cache.

### Risque additionnel identifié — fan-out `RT_ECHEANCE`

```sql
LEFT JOIN RT_ECHEANCE e ON e.DO_Numero = d.DO_Piece
```

Si une pièce a plusieurs échéances, cette jointure **duplique les lignes** en sortie (utilisé
seulement pour `Solde` des documents TTC négatif — avoirs). Remplacé par un agrégat scalaire
(`OUTER APPLY SUM(EC_Solde)`) pour préserver le contrat 1 ligne par document.

## Objectif

1. Le recouvrement par BL reflète la **réalité des versements multi-BL** (répartition FIFO par date
   de BL, versement le plus ancien soldé en premier).
2. Un BL éclaté sur plusieurs clients apparaît **une seule fois**, agrégé, avec un indicateur
   `NbClients` en cas de multi-client (pas de perte d'information, pas de double comptage).
3. `FG_DOCENTETE_SAUV` est filtrée au même périmètre dépôt que les deux autres branches.
4. Temps de réponse Metabase mesurable en net retrait (à chiffrer par le PO après application,
   comme pratiqué sur TASK-046).
5. ~~Aucun changement de périmètre par dépôt~~ — **révisé** : `account`/`dep` retirés de la vue
   (décision PO 2026-07-16), le sandbox Metabase devient l'unique mécanisme de restriction par
   dépôt. À vérifier par le PO : si le sandbox filtre sur `A_EMAIL` (colonne désormais absente de
   la vue), il ne filtre plus rien.

## Fichiers concernés

- `SQL_007_TASK-056_RecouvrementBL_Perf.sql` *(livré)* — à appliquer sur `GR_GOCOM` par le PO,
  en 3 temps : diagnostic (lecture seule) → index (idempotents) → `ALTER VIEW`.

## Étapes d'implémentation

1. **PO** : exécuter la section « 0. Diagnostic » du script (lecture seule) et lire les compteurs
   (règlements multi-BL, BL multi-client, unicité `MV_Numero`) — **déjà fait le 2026-07-16** :
   14 règlements multi-BL, 0 BL multi-client actuellement, `MV_Numero` bien unique (7567/7567).
2. **PO** : appliquer la section « 1. Index » (idempotente, `IF NOT EXISTS`).
3. **PO** : appliquer l'`ALTER VIEW` (section « 2 »).
4. **PO** : rejouer un dashboard Metabase représentatif, comparer temps de réponse avant/après et
   vérifier sur 2-3 BL connus (dont un multi-`#` et un multi-client) que `TotalReglement`/`Solde`
   sont désormais corrects.

## Contraintes

- Lecture/écriture de vue et index uniquement — **aucun `UPDATE`/`DELETE`** sur les tables GOCOM.
- Les index ciblent des tables ERP (Sage) partagées : à valider avec l'admin GOCOM pour l'impact
  sur les écritures concurrentes (saisie commerciale continue) avant application en heures pleines.
- ⚠️ Le périmètre par dépôt (`account`/`dep`) **a été retiré de la vue** (décision PO 2026-07-16,
  cf. « Incident — temps d'exécution ») : ce n'est plus une contrainte respectée mais un changement
  assumé — le sandbox Metabase est désormais la seule barrière, à vérifier par le PO avant mise en
  production (voir risque signalé).

## Incident d'application — index impossibles sur 2 colonnes (Msg 1919)

À l'application de la section 1, SQL Server a rejeté 2 des 6 index :

```
Msg 1919 — La colonne 'MV_Reference' dans la table 'RT_MOUVEMENT' n'est pas d'un type
           valide lui permettant d'être utilisée en tant que colonne clé dans un index.
Msg 1919 — La colonne 'DO_Numero' dans la table 'RT_ECHEANCE' n'est pas d'un type
           valide lui permettant d'être utilisée en tant que colonne clé dans un index.
```

Cause probable : type LOB hérité (`text`/`ntext`) sur ces deux colonnes — SQL Server interdit
**tout index en clé** sur ce type, indépendamment de la longueur réelle des valeurs stockées.
Diagnostic (e) ajouté au script pour confirmer le type exact ; si c'est bien `text`/`ntext`, même
un `INCLUDE` est impossible (contrairement à `varchar(max)`/`nvarchar(max)`, indexables en `INCLUDE`
mais jamais en clé).

**Correctifs appliqués (sans attendre le diagnostic, réversibles/sans risque) :**
- `IX_RTMOUVEMENT_Domaine_Reference_Perf` → remplacé par `IX_RTMOUVEMENT_Domaine_Perf` sur
  `MV_Domaine` seul (`MV_Reference` retirée de la clé **et** de l'`INCLUDE` par prudence).
- `IX_RTECHEANCE_DONumero_Perf` → **retiré**, aucun index de repli possible sur `RT_ECHEANCE`
  sans connaître son type exact.
- Le `OUTER APPLY` vers `RT_ECHEANCE` (section 2, calcul de `Solde` pour les avoirs) est restreint
  à `d.DO_TotalTTC < 0` : ce lookup non indexable ne s'exécute plus que pour les avoirs, pas pour
  chaque ligne de `Documents`.

**Incident additionnel (Msg 1911)** : `BanqueCode` retirée de l'`INCLUDE` de `IX_RTMOUVEMENT_Domaine_Perf`
— cette colonne n'existe pas sur `RT_MOUVEMENT`, elle provient en réalité de `vReglementsClients`
(jointe sans préfixe de table dans `zvMeta_ReglementBL`, d'où l'ambiguïté à la lecture du SQL seul).

**Contournement possible mais NON appliqué** (nécessite un accord PO explicite, plus invasif
qu'un simple index) : ajouter une colonne calculée persistée (`CAST(MV_Reference AS varchar(500))
PERSISTED`) et l'indexer — c'est une modification de schéma sur une table ERP partagée, pas un
simple `CREATE INDEX`. À évaluer seulement si la lenteur résiduelle sur `zvMeta_ReglementBL` ou
sur le calcul du solde des avoirs reste bloquante après application du reste du lot.

## Incident — temps d'exécution ~3-4 min malgré les index (2026-07-16)

Après application des index (section 1) et de la vue (section 2), le PO rapporte un temps
d'exécution mesuré à ~3-4 min (225 734 ms CPU) et un profiler édifiant :

| Table | Nb scans | Lectures logiques |
|---|---|---|
| `F_DOCLIGNE` | 2 388 | **66 322 374** |
| `RT_ECHEANCE` | 4 543 | **6 996 220** |
| `F_COMPTET` | 0 (agrégat) | 23 299 |
| autres tables | — | < 50 000 chacune |

**Diagnostic** : les index seuls ne pouvaient pas suffire. `Documents` (qui embarque `BL`/`FA_BL`,
donc `F_DOCLIGNE`) est référencée **deux fois** dans la vue — une fois dans le `SELECT` final, une
fois dans le `JOIN` de `ReglementAlloc` (répartition FIFO). Une CTE SQL Server n'est **jamais
matérialisée automatiquement** : combiné à l'absence d'index utilisable sur `RT_ECHEANCE.DO_Numero`
(Msg 1919, incident précédent) et au volume de `F_DOCLIGNE`, l'optimiseur choisit un plan en boucle
imbriquée qui **recalcule tout le sous-arbre `Documents` (donc rescanne `F_DOCLIGNE`) une fois par
ligne consommée côté `ReglementAlloc`**. C'est une limite structurelle de l'approche « tout en une
vue », pas un oubli d'index.

**Décision PO** : ne pas patcher davantage cette vue en pur SQL — cadrer une solution durable à
base de table persistée (calcul batch au lieu de recalcul live à chaque clic Metabase), suivie
séparément en **[TASK-058](TASK-058.md)**.

### Simplification appliquée en parallèle : retrait de `account`/`dep`

Décision PO 2026-07-16 (« je retire tout ce qui est user ») : le CTE `account` (accès par dépôt
via `ID_Eclate`/`a_valise`) et `dep` (libellé dépôt) sont **retirés intégralement** de la vue —
plus de filtre `EXISTS(account)` dans `BL`/`FA_BL`/`DocumentsRaw`, plus de colonnes `A_EMAIL`,
`ID_UserBhub`, `DE_Intitule` en sortie.

⚠️ **Risque signalé deux fois au PO avant application, confirmé malgré tout** : le sandbox Metabase
restreint généralement les lignes en filtrant sur une **colonne de la vue** correspondant à
l'utilisateur connecté — très probablement `A_EMAIL` ici. Si c'est le cas, ce n'est pas seulement
« le filet SQL redondant » qui saute : c'est **le mécanisme de sécurité Metabase lui-même** qui n'a
plus de colonne sur laquelle s'appuyer → tous les dépôts verraient tous les BL, quelle que soit la
config sandbox. Le PO n'a pas confirmé le mécanisme exact du sandbox (question posée, réponse :
retrait demandé quand même). **À vérifier impérativement côté Metabase avant mise en production** :
si le sandbox référence `A_EMAIL`/`ID_UserBhub`/`DE_Intitule`, il doit être reconfiguré ou ces
colonnes réintroduites.

### 2e mesure (après retrait account/dep) — F_DOCLIGNE résolu, RT_ECHEANCE explose

Contrairement à l'attente initiale, le retrait d'`account`/`dep` a eu un effet massif et positif sur
`F_DOCLIGNE` : le `EXISTS(account)` corrélé forçait apparemment un plan en boucle imbriquée sur
cette table, indépendamment du problème de double-référence de `Documents`.

| Table | Avant (v2, account présent) | Après (v2, account retiré) |
|---|---|---|
| `F_DOCLIGNE` | 2 388 scans / 66 322 374 lectures | **36 scans / 117 440 lectures** ✅ |
| `RT_ECHEANCE` | 4 543 scans / 6 996 220 lectures | **19 521 scans / 30 062 340 lectures** ❌ |

`RT_ECHEANCE` explose en contrepartie : en supprimant le filtre dépôt, `Documents` remonte
désormais tous les dépôts confondus → beaucoup plus de lignes `DO_TotalTTC < 0` (avoirs) → le
`OUTER APPLY` corrélé (un scan complet de `RT_ECHEANCE`, non indexable, Msg 1919, par ligne
appelante) s'exécute beaucoup plus souvent. C'est désormais le seul poste dominant (~30M sur
~30,2M lectures totales).

**Correctif appliqué (SQL_007 v3)** : `OUTER APPLY` corrélé remplacé par un `LEFT JOIN` sur une
sous-requête pré-agrégée (`GROUP BY DO_Numero`) — `RT_ECHEANCE` n'est plus scannée qu'**une seule
fois au total**, quel que soit le nombre de lignes de `Documents`, au lieu d'une fois par ligne.
Aucun changement de schéma, aucun DDL supplémentaire : pur correctif de requête, à revalider par le
PO (temps d'exécution + résultats identiques sur les BL de test).

## Nouvelle règle métier — dépôts facturants uniquement (décision PO 2026-07-16)

Demande PO : n'afficher que les BL/factures des dépôts présents dans
`GOCOM.dbo.FG_DEPOTFACTURATION`. Jointure non triviale, donnée par le PO (non déductible du
schéma) : `FG_DEPOTFACTURATION.DP_Id` se rapproche de `F_DEPOT` via **`F_DEPOT.cbMarq`** —
une colonne normalement technique/réplication chez Sage, ici réutilisée comme clé de
rapprochement.

**Vérifié en base** (`sqlcmd`, lecture seule, creds de `GRC.API/appsettings.json`) :
- `FG_DEPOTFACTURATION` contient 30 lignes → 30 dépôts sur 213 dans `F_DEPOT` matchent
  (essentiellement les dépôts "REGIONAL"/"OPERATIONS"/"ANIMATEUR"/"CENTRAL", cohérent avec
  l'idée de "dépôts facturants" vs dépôts techniques/inactifs).
- Impact réel mesuré sur `F_DOCLIGNE` (type 6/7, `DL_PieceBL <> ''`) : **704 lignes sur 27 359
  (2,6%)** appartiennent à un dépôt hors de ce périmètre.

**Fix appliqué (SQL_007 v4)** : nouveau CTE `DepotsFacturation` (jointure `F_DEPOT`/
`FG_DEPOTFACTURATION` via `cbMarq`/`DP_Id`), rattaché en `INNER JOIN` (pas en `EXISTS` corrélé,
pour rester sargable et ne pas reproduire le coût du CTE `account` retiré plus haut) sur `BL` et
les 2 branches `DocumentsRaw` qui portent un `DE_No` réel (`FG_DOCENTETE_SAUV`, `F_DOCENTETE`) ;
la 3e branche (issue de `BL`) hérite du filtre automatiquement. `FA_BL` (liste d'exclusion
"déjà facturé") volontairement **non filtrée** par dépôt : son rôle est de détecter qu'un BL a
été facturé quelque part, indépendamment du périmètre d'affichage.

## Bug 3 — facture éclatée d'un BL déjà archivé comptée en double (confirmé en base, 2026-07-16)

Signalé par le PO : `F_DOCENTETE.DO_Coord03` porte le **numéro du BL d'origine** quand une facture
est issue de l'éclatement d'un BL (ex. `FAG2619796.DO_Coord03 = 'BLG2601262'`). Si ce BL d'origine
existe déjà dans `FG_DOCENTETE_SAUV`, la facture éclatée **ne doit pas** apparaître en plus — sinon
le même BL est compté deux fois : une fois via `FG_DOCENTETE_SAUV` (total du BL), une fois par
facture éclatée (part de chaque client). Le dédoublonnage existant (par `DO_Piece`, bug 5 du lot v1)
ne détectait pas ce cas car les deux lignes ont des `DO_Piece` différents (`BLG2601262` ≠
`FAG2619796`).

**Vérifié en base** (`sqlcmd`, lecture seule) :
- 22 294 factures `F_DOCENTETE` (type 6/7) ont un `DO_Coord03` renseigné ; **22 293** pointent vers
  un BL qui existe déjà dans `FG_DOCENTETE_SAUV`.
- Dans le périmètre des 30 dépôts facturants et après les filtres déjà en place (`FG_BlFacture`,
  `FA_BL`), **51 factures** sont concernées, actuellement affichées en double.
- Exemple vérifié : `BLG2601262` = 940 021,25 → éclaté en 47 factures de 19 879,88 chacune → sans
  le correctif, ~940K est compté une 2e fois dans la vue.

**Fix appliqué (SQL_007 v5)** : `NOT EXISTS (SELECT 1 FROM FG_DOCENTETE_SAUV s WHERE s.DO_Piece =
f.DO_Coord03)` ajouté à la branche `F_DOCENTETE` de `DocumentsRaw`. Pas de nouvel index requis :
`FG_DOCENTETE_SAUV` ne fait que 1 328 lignes → hash anti-join bon marché, contrairement au CTE
`account` (des millions de lignes côté build) qui avait causé l'incident perf plus haut.

## Précision PO 2026-07-16 — retrait complet du filtre dépôt en SQL (v6 → v7)

Clarification PO en 2 temps après tests demandés en base :

**1er temps (v6)** : `FG_DOCENTETE_SAUV` (BL archivés) — toutes les lignes doivent sortir sans
filtre dépôt, `DE_No` reste exposé en sortie pour que le filtrage par dépôt se fasse **côté
reporting** (Metabase), pas figé dans la vue.

**2e temps (v7)** — PO : « pas uniquement BL sauv même les factures je dois connaitre leur dépôt » :
même traitement étendu à **`F_DOCENTETE`** (factures type 6/7). Question posée sur la 3e source
(`BL` reconstruit depuis `F_DOCLIGNE`) → réponse PO : **même traitement partout**. Résultat : **plus
aucun filtre dépôt en SQL dans la vue**, sur aucune des 3 branches — le filtre `FG_DEPOTFACTURATION`
(v4) est intégralement retiré, `DE_No` exposé sur toutes les lignes, le périmètre par dépôt devient
**entièrement** une responsabilité du reporting (Metabase).

**Vérifié en base avant application (`sqlcmd`, lecture seule)** :
- `FG_DOCENTETE_SAUV` : 1 328 lignes, `DE_No` jamais `NULL`, 18 dépôts distincts — tous déjà dans
  les 30 dépôts facturants (0 impact volume).
- `F_DOCENTETE` type 6/7 : 37 365 lignes, `DE_No` jamais `NULL`, **172 dépôts distincts** — ici le
  filtre avait un impact réel (23 697 lignes dans le périmètre des 30 dépôts vs 37 365 sans filtre).
  Sur les 23 697 dans le périmètre : 22 242 déjà exclues via `FG_BlFacture`, 1 103 via `FA_BL`,
  22 293 via `DO_Coord03` (chevauchement massif, cohérent) → 457 factures autonomes dans ce
  sous-ensemble ; le retrait du filtre dépôt ajoute en plus toutes les factures des 142 dépôts
  restants qui passent les mêmes exclusions.
- `BL` (F_DOCLIGNE reconstruit) : impact déjà mesuré en v4 — 704/27 359 lignes (2,6%) hors des 30
  dépôts facturants, désormais réintégrées.

**Fix appliqué (SQL_007 v7)** : `INNER JOIN DepotsFacturation` retiré des 3 branches de
`DocumentsRaw`/`BL`. CTE `DepotsFacturation` devenue inutile → **supprimée** de la vue.

⚠️ **Cohérence à noter avec la « Nouvelle règle métier » plus haut (v4)** : cette section documente
une décision **depuis révisée** — le filtre `FG_DEPOTFACTURATION` a été ajouté (v4) puis retiré
(v7) le même jour, à la demande du PO. Conservé dans ce fichier pour l'historique, mais **v7 est
l'état final appliqué**.

**Justification PO du retrait** : « `FG_DEPOTFACTURATION` pas de souci parce que l'application qui
traite l'éclatement gère très bien les dépôts » — l'application source qui crée les factures
éclatées assigne `DE_No` de façon fiable par construction ; pas besoin d'un filtre SQL
supplémentaire pour garantir la qualité de cette donnée, `DE_No` brut est exploitable tel quel côté
reporting.

## Points ouverts restants (non vérifiables depuis ce poste)

- **`RT_ECHEANCE`** : le remplacement par `SUM(EC_Solde)` (au lieu d'un `TOP 1` arbitraire) suppose
  que le solde d'un avoir est la somme de ses échéances ; à confirmer si `RT_ECHEANCE` porte une
  autre sémantique (ex. échéances mutuellement exclusives).
- **Représentation du client sur un BL multi-client** : `CT_Intitule` affichera un client
  "représentatif" (le premier par ordre `CT_Num`) quand `NbClients > 1` — accepté comme purement
  indicatif puisque la visibilité demandée est au grain BL, pas client. Non observable aujourd'hui
  (0 cas en base, diagnostic (b)), mais le correctif reste appliqué en garde-fou.

## Points validés en base le 2026-07-16 (diagnostic PO)

- 14 règlements référencent plusieurs BL via `#` → impact réel du bug 1, confirmé.
- 0 BL actuellement éclaté sur plusieurs clients → bug 2 non observé en pratique aujourd'hui,
  correctif conservé en prévention (le flux métier décrit l'autorise explicitement).
- `MV_Numero` unique sur les 7567 lignes de `zvMeta_ReglementBL` → hypothèse de partition FIFO valide.
- Hypothèse de bug sur `FA_BL` **invalidée** (3012 exclusions en version d'origine vs 0 sur la
  variante proposée) → `FA_BL` non modifiée.

## Checklist VALIDATION (à remplir dans VERIFY/)

- [ ] Diagnostic PO exécuté et lu (3 compteurs) avant application
- [ ] Index appliqués sans erreur, impact écriture jugé acceptable par l'admin GOCOM
- [ ] `ALTER VIEW` appliqué sans erreur
- [ ] BL de test réglé via versement multi-`#` : `TotalReglement` non nul, réparti FIFO par date
- [ ] BL de test multi-client : une seule ligne en sortie, `NbClients > 1`, solde correct
- [ ] Aucune régression sur un BL simple (1 versement, 1 client) : mêmes valeurs qu'avant
- [ ] Temps de réponse Metabase mesuré avant/après — **connu à date : toujours ~3-4 min**, gain
      réel attendu uniquement après TASK-058
- [ ] Sandbox Metabase vérifié fonctionnel malgré le retrait de `A_EMAIL`/`ID_UserBhub`/
      `DE_Intitule` (risque signalé, non confirmé par le PO) — périmètre par dépôt toujours
      effectif pour les autres users, `n.salim` toujours hors sandbox
- [ ] Cohérent avec l'architecture ; aucun bypass DLL ; aucun `UPDATE` sur table métier GOCOM
- [ ] Filtre `DepotsFacturation` validé : seuls les 30 dépôts de `FG_DEPOTFACTURATION` apparaissent
      dans la vue, aucun dépôt hors périmètre visible
- [ ] Bug 3 (`DO_Coord03`) validé : BL de test `BLG2601262` (ou équivalent) apparaît **une seule
      fois**, plus de doublon via ses factures éclatées
- [ ] Aucun filtre dépôt en SQL validé (v7) : `FG_DOCENTETE_SAUV`, `F_DOCENTETE` et `BL`
      (F_DOCLIGNE) sortent toutes leurs lignes sans restriction, `DE_No` exploitable comme
      filtre côté Metabase sur les 3 sources
- [ ] Filtrage par dépôt reconfiguré côté Metabase (report du filtre SQL v4 retiré) —
      **bloquant fonctionnel si non fait avant mise en prod** : sans filtre reporting, tous
      les dépôts verraient tous les BL/factures de tous les dépôts
