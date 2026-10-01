# TASK-116 — Règlement espèce : caisse paramétrée par dépôt, visible sur l'écran + mode « caisse automatique »

- **Priorité** : 🟠 Majeur
- **Domaine** : Correction / UX — **RISK HIGH** (une mauvaise caisse = faute comptable ; mise en production **directe** prévue par le PO, sans recette manuelle de sa part)
- **Statut** : TODO
- **Dépend de** : TASK-115 — **DÉJÀ IMPLÉMENTÉE dans le working tree** (`GRC.Infrastructure/Services/ReglementGenerationService.cs`, non committée, VERIFY déposé). Partir de cet état : ne pas la réimplémenter, ne pas la défaire, **ne jamais exécuter `git checkout` / `reset` / `stash` / `restore` sur ce fichier**. Vérification au démarrage : la variable `clientsCharges` doit exister dans `GenererReglementsEspece` ; sinon **STOP et signaler au PO**. L'ordre de commit (TASK-115 d'abord) relève du reviewer, pas de l'implémenteur.

> **Repères** : les numéros de ligne cités dans cette TASK sont **approximatifs** (ils bougent avec TASK-115) ; se fier aux noms de fonctions / symboles / JSX.

> **Règle d'or** : en mode automatique, **jamais de repli ni de choix arbitraire de caisse** : dans le doute, la facture est « Ignorée » (ou en erreur), jamais réglée sur une caisse non vue par l'utilisateur.
>
> **Résumé** : (1) l'écran affiche Dépôt + Caisse paramétrée par facture ; (2) nouvelle option « Caisse paramétrée (automatique) » dans la liste déroulante, jamais par défaut ; (3) le serveur résout la caisse par facture (EC_Info1 → F_DEPOT → FG_DEPOTFACTURATION → RT_CAISSE), regroupe par caisse, contrôle l'autorisation par caisse ; (4) non paramétré / ambigu / sommeil = « Ignorée » (ni succès ni échec) ; (5) le serveur refuse toute facture dont la caisse a changé depuis l'affichage confirmé ; (6) le mode manuel reste strictement identique ; (7) aucune table ajoutée, lecture seule du paramétrage ; (8) preuves datées exigées (§ 8, § 11), pilote et requête de contrôle (§ 9) ; (9) le point d'arrêt de l'implémenteur est le dépôt du VERIFY (§ 7).

> **Lecture obligatoire avant de coder** : § 2 (règles métier), § 4 (backend), § 5 (frontend), § 6 (cas limites), § 7 (contraintes et séparation implémentation/clôture), § 8 (tests). Le § 9 est destiné **au PO / reviewer** (exploitation, hors périmètre de code, sauf la requête de contrôle à tester par l'implémenteur). Le PO ne testera pas : **c'est l'implémenteur qui doit tout prouver par exécution sur la base de test** (§ 8) et le reviewer qui doit refuser tout VERIFY sans preuve.

---

## 1. Contexte

Sur l'écran « Règlement espèce » (`gocom-web/src/ReglementGenerationEspece.tsx`), l'utilisateur choisit **une seule caisse pour tout le lot** (liste déroulante des caisses), sans que l'écran lui dise à quelle caisse chaque facture appartient. La colonne « Info 1 » (qui contient l'intitulé du dépôt) existe mais est masquée par défaut (`ALL_COLUMNS`, entrée `info1`).

Le rattachement dépôt → caisse existe déjà en base (décision PO 2026-10-01), **aucune table à ajouter** :

| Élément | Source | Remarque |
|---|---|---|
| Intitulé du dépôt de la facture | `GR_GOCOM.dbo.RT_ECHEANCE.EC_Info1` (côté .NET : `Echeance.Info1`) | ex. `DR2 DEPOT REGIONAL NADOR` |
| Dépôt Sage | `GOCOM.dbo.F_DEPOT` : `DE_Intitule`, clé technique `cbMarq` | |
| Paramétrage | `GOCOM.dbo.FG_DEPOTFACTURATION` : `DP_Id` (= `F_DEPOT.cbMarq`), `CA_Id`, `MR_Id` (1 = espèce), `DF_RegleRemise` | 30 lignes en prod le 2026-10-01, `MR_Id = 1` partout |
| Caisse | `GR_GOCOM.dbo.RT_CAISSE` : `CA_Id`, `CA_Code`, `CA_Intitule`, `CA_Sommeil`, `SO_Id` | le service attend le **`CA_Code`** (ex. `XDR2`) |

**Vérifié en prod le 2026-10-01** : `DR2 DEPOT REGIONAL NADOR` → `DP_Id` 75 → `CA_Id` 192 → `XDR2`, et les règlements 73806 à 73810 (générés par l'appli) ont bien `CA_IdIn = 192`. **Plusieurs dépôts peuvent pointer vers la même caisse** (ex. `DR2 DEPOT REGIONAL NADOR` et `DR2 DEPOT ANIMATEUR NADOR` → 192) : ce n'est pas une anomalie.

Le référencement cross-base `GOCOM.dbo.*` est déjà utilisé en C# (`ReglementService.cs` l.833) et dans les scripts SQL (`SQL_010`, `SQL_011`).

## Problème constaté

Sur l'écran Règlement espèce, une seule caisse est choisie pour tout le lot. L'écran n'indique pas la caisse paramétrée de chaque facture. La colonne Info 1 (dépôt) est masquée par défaut (`ALL_COLUMNS`). Sur un lot de 30 000 règlements, une mauvaise caisse est une faute comptable, et la mise en production est directe sans recette du PO.

## Objectif (mesurable)

- Les colonnes « Dépôt » et « Caisse paramétrée » sont visibles par facture ; « Non paramétré » est affiché quand il n'y a pas de caisse. `Info 1` reste masquée par défaut : « Dépôt » en est la vue calculée.
- En mode « Caisse paramétrée (automatique) », 0 règlement est créé sur une mauvaise caisse. Preuve : la requête du § 9.3 renvoie `NbReglementsControles` = nombre de règlements créés et aucune ligne d'anomalie.
- Les factures sans caisse, ambiguës ou en sommeil sont « Ignorées » et ne sont pas comptées comme erreurs.
- Le mode manuel reste le défaut, avec un comportement inchangé hors l'alerte de confirmation.

## Étapes d'implémentation (ordre à respecter)

1. DTO : ajouter la caisse et le dépôt à la ligne de facture et au résultat (§ 4.2).
2. Backend : `ChargerParametrageDepotCaisse` et `ResoudreCaisse`, une seule requête puis résolution en mémoire (§ 4.1).
3. Backend : extraire `TraiterFactures` de `GenererReglementsEspece` et créer `ContexteGeneration` (§ 4.3).
4. Backend : mode automatique, caisse résolue par facture, contrôle d'autorisation par caisse (§ 2.5, § 4.3).
5. Contrôleur : `factures-a-regler` et `generer-espece`, nouveaux champs de requête (§ 4.4).
6. Front : types et colonnes Dépôt et Caisse paramétrée (§ 5.1, § 5.2).
7. Front : migration des préférences de colonnes localStorage en v2 (§ 5.3).
8. Front : liste déroulante, bandeau récapitulatif et confirmations (§ 5.4 à 5.6).
9. Front : traitement de la réponse, tableau de résultats avec statut « Ignorée », et CSS (§ 5.7, § 5.8).
10. Documentation : `MANUEL_UTILISATEUR.md` et `ARCHITECTURE.md` (§ 3).
11. Rédiger `tasks/SCENARIOS_TASK-116.md`, le banc de test et l'e2e, exécuter les tests du § 8, puis **déposer le VERIFY et s'arrêter** (§ 7, § 11).

## 2. Décisions du PO (2026-10-01) et règles métier

1. **Visibilité** : chaque facture affiche son **Dépôt** et sa **Caisse paramétrée** (ou « Non paramétré »).
2. **Les deux modes coexistent** : le mode manuel actuel reste le défaut ; le mode « Caisse paramétrée (automatique) » est un **choix explicite** dans la liste déroulante (jamais activé par défaut).
3. **Facture sans caisse paramétrée** (décision PO confirmée) :

| Situation | Comportement |
|---|---|
| **Automatique**, dépôt absent de `FG_DEPOTFACTURATION` (ou `MR_Id <> 1`, ou `EC_Info1` vide) | **Aucun règlement créé.** La facture **reste dans la liste**. Dans le résultat : statut **« Ignorée »** (neutre, ni vert ni rouge), motif `Aucune caisse paramétrée pour le dépôt « X » (FG_DEPOTFACTURATION).` Ce n'est **pas un échec** : non comptée dans les erreurs. |
| **Automatique**, intitulé de dépôt **ambigu** (≥ 2 caisses différentes pour le même intitulé) | Même traitement que « non paramétré », motif `Dépôt « X » associé à plusieurs caisses (paramétrage ambigu).` + `LogWarning`. **Jamais de choix arbitraire.** |
| **Automatique**, caisse paramétrée **en sommeil** (`CA_Sommeil = 1`) | « Ignorée », motif `Caisse « XDR2 » en sommeil.` |
| **Manuel** | **Inchangé** : la facture est traitée sur la caisse choisie par l'utilisateur, quelle que soit la caisse paramétrée. C'est le moyen de traiter les factures « Non paramétré ». Seul ajout : alerte de confirmation (§ 5.6). |

4. **Pas de caisse par défaut ni de repli** en mode automatique : régler sur une mauvaise caisse est un risque comptable, ignorer ne coûte qu'un traitement manuel.
5. **Autorisation par caisse inchangée et obligatoire** pour chaque caisse résolue (`HasEntityActionRestriction` sur l'utilisateur JWT réel, `isAdmin` comme aujourd'hui).
6. **Les ignorées restent visibles et décochées** après génération (pour ne pas être re-soumises par erreur) ; les créées sont retirées de la liste (TASK-108, inchangé) ; les échecs restent cochés (TASK-108, inchangé).
7. **Dépendance à `EC_Info1` (risque connu)** : `EC_Info1` est posé à `DO_Coord01` par les procédures d'intégration, puis réécrit par l'intitulé du dépôt par le job « Planification Instantané » (8h-18h, lun-sam, **HYPOTHÈSE issue de l'analyse des jobs, non vérifiée par le code**) ou par `SQL_011` selon la version déployée. Une échéance fraîchement intégrée hors de ces plages peut porter une valeur qui n'est pas un dépôt. Le mode auto ne résout une caisse que si `EC_Info1` égale exactement un `DE_Intitule` paramétré, sinon la facture est « Ignorée » ; un garde-fou serveur complémentaire est défini en § 4.1 (contrôle du dépôt réel de la pièce). Le PO confirme avant mise en prod (consigné dans le VERIFY) que `EC_Info1` n'est jamais saisi à la main.
8. **Jamais de caisse non confirmée** : le mode automatique ne crée jamais un règlement sur une caisse que l'utilisateur n'a pas vue et confirmée. Le front transmet la caisse affichée pour chaque facture et le serveur refuse toute facture dont la caisse résolue a changé depuis l'affichage (§ 4.3 point 3b). Le mode manuel n'est pas concerné (la caisse choisie est explicite).

## 3. Fichiers concernés

- `GRC.Infrastructure/Services/ReglementGenerationService.cs`
- `GRC.API/Controllers/ReglementController.cs` (endpoints `factures-a-regler` et `generer-espece`, classe `GenererReglementsEspeceRequest`)
- `gocom-web/src/ReglementGenerationEspece.tsx`
- `gocom-web/src/ReglementGenerationEspece.css`
- `ARCHITECTURE.md` (§ Grilles de données : la clé `gocom_reglement_espece_columns_v2` est documentée comme **versionnage de la clé existante** ; remplacer les références de ligne `ReglementGenerationEspece.tsx:50-64` etc. par des noms de symboles ; l'écart avec la règle « une clé dédiée par écran » est justifié dans le VERIFY) et mention de la lecture cross-base `GOCOM` dans la couche Infrastructure (`ARCHITECTURE_PROJECT.md` si pertinent)
- `MANUEL_UTILISATEUR.md` (section Règlement espèce : nouvelle option, 2 nouvelles colonnes, statut « Ignorée »)
- **Nouveau** : `tasks/SCENARIOS_TASK-116.md` (script de test manuel réutilisable, format imposé § 8)
- **Nouveau (hors dépôt, `.gitignore`)** : banc de test sur base de test (modèle : `harness_task107/Program.cs`, `run_test114_via_api.ps1`) et `e2e_task116.cjs` (modèle : `e2e_task107.cjs`). Vérifier que ces fichiers sont bien ignorés par git.
- **Nouveau (base de test uniquement, jamais déployé)** : `sql/test/TASK116_jeu_donnees.sql` (avec bloc UNDO), voir § 7.
- À ne **pas** modifier : `GenererVersementDepuisReleveAsync`, `GetClientsFromCache`, les DLL Tresorerie.*, aucune table (lecture seule de `FG_DEPOTFACTURATION`, `F_DEPOT`, `RT_CAISSE`).

## 4. Spécification backend (détaillée)

### 4.1 Résolution dépôt → caisse (une requête, en mémoire ensuite)

Ajouter dans `ReglementGenerationService` un type privé et une méthode privée :

```csharp
// Propriétés automatiques (Dapper mappe les propriétés ; ne pas utiliser de champs publics)
private sealed class CaisseParametree { public int Id { get; set; } public string Code { get; set; } = ""; public string Intitule { get; set; } = ""; public bool Sommeil { get; set; } }

// Classe de ligne Dapper (la requête renvoie aussi le dépôt)
private sealed class LigneParametrageDepot { public string DepotIntitule { get; set; } = ""; public int Id { get; set; } public string Code { get; set; } = ""; public string Intitule { get; set; } = ""; public bool Sommeil { get; set; } }

// Normalisation UNIQUE des intitulés de dépôt (voir ci-dessous) :
private static string NormaliserDepot(string? s) => (s ?? "").Trim();

// Clé = NormaliserDepot(intitulé du dépôt), comparaison StringComparer.OrdinalIgnoreCase.
// Valeur null = intitulé AMBIGU (plusieurs caisses distinctes).
private Dictionary<string, CaisseParametree?> ChargerParametrageDepotCaisse(int societeId)
```

Requête (Dapper, `new SqlConnection(_dbFactory.GetConnectionString())`, comme le reste du service) :

```sql
SELECT LTRIM(RTRIM(d.DE_Intitule)) AS DepotIntitule,
       c.CA_Id AS Id, c.CA_Code AS Code, c.CA_Intitule AS Intitule, CAST(ISNULL(c.CA_Sommeil, 0) AS bit) AS Sommeil
FROM GOCOM.dbo.FG_DEPOTFACTURATION f
JOIN GOCOM.dbo.F_DEPOT d ON d.cbMarq = f.DP_Id
JOIN RT_CAISSE c        ON c.CA_Id  = f.CA_Id
WHERE f.MR_Id = 1 AND c.SO_Id = @SocieteId
```

Dapper : `conn.Query<LigneParametrageDepot>(sql, new { SocieteId = societeId })`. `RT_CAISSE` n'est pas préfixé (base de connexion par défaut, comme les autres requêtes du service) : **à confirmer** par la reconnaissance ci-dessous. Aucune jointure texte cross-base n'est faite dans cette requête (jointures par identifiants), donc pas de conflit de collation ici.

Construction du dictionnaire (`StringComparer.OrdinalIgnoreCase`) : pour chaque ligne, clé = `NormaliserDepot(ligne.DepotIntitule)` ; si la clé existe déjà avec la **même** `CA_Id` → ignorer (doublon sans conséquence) ; avec une **autre** `CA_Id` → mettre la valeur à `null` (ambigu) et `LogWarning("PARAMÉTRAGE DÉPÔT→CAISSE ambigu : dépôt={Depot}")`.

**Normalisation unique** : appliquer `NormaliserDepot` aux **DEUX** côtés : (a) à la clé `DepotIntitule` lue du SQL lors de la construction du dictionnaire, (b) à `info1` dans `ResoudreCaisse` et pour `DepotIntitule` du DTO (§ 4.2). Ne pas utiliser d'autre `Trim`. `LTRIM/RTRIM` T-SQL ne retire que l'espace U+0020, `string.Trim()` .NET retire aussi NBSP, tabulations et CR/LF : un intitulé avec NBSP de queue peut donc ne pas matcher ; les doubles espaces internes et les accents ne sont pas normalisés. **Tout écart donne « Ignorée » (comportement sûr, jamais une mauvaise caisse)** ; pas de normalisation plus agressive (`NCHAR(160)`) dans cette TASK.

**Défaillance du chargement** : `ChargerParametrageDepotCaisse` ne doit **JAMAIS avaler une exception** : elle laisse remonter toute `SqlException` ; les appelants décident (§ 4.2 et § 4.3). Nom de base `GOCOM` en dur conservé (cohérent avec `ReglementService.cs` l.833 ; les scripts SQL précisent que la base ERP est `P_SOCIETE.SO_ErpDb` : le documenter en commentaire). **Reconnaissance préalable (lecture seule, base de test, consignée dans le VERIFY)** : exécuter la requête telle quelle ; vérifier droits, `DATABASEPROPERTYEX(..., 'Collation')` des deux bases et la base par défaut de la connexion. **Pré-déploiement, le PO vérifie en SSMS avec le login applicatif de PROD** (celui de la chaîne de connexion de prod, pas le sien) : `SELECT TOP 1 * FROM GOCOM.dbo.FG_DEPOTFACTURATION; SELECT TOP 1 * FROM GOCOM.dbo.F_DEPOT;`.

**Caisse « dépense seule »** : pas de filtre sur `CA_Recette` (hors périmètre) ; une caisse paramétrée qui refuse le règlement échoue dans `ReglementCreate` et l'erreur est isolée par facture (garde-fou existant).

**Garde-fou sur le dépôt réel de la pièce (mode auto uniquement)** : `Echeance.DocumentNumero` existe (utilisé par le service). Après `ResoudreCaisse`, charger **EN UNE REQUÊTE PAR LOT** (jamais par facture, paramètre table ou lots d'identifiants) `SELECT e.DO_Piece, e.DO_Type, LTRIM(RTRIM(d.DE_Intitule)) AS DepotDoc FROM GOCOM.dbo.F_DOCENTETE e JOIN GOCOM.dbo.F_DEPOT d ON d.DE_No = e.DE_No WHERE e.DO_Domaine = 0 AND e.DO_Type IN (6, 7) AND e.DO_Piece IN (...)` (jointure analogue à `SQL_011`, qui joint `F_DOCENTETE` sur `DO_Domaine`/`DO_Type`/`DO_Piece`). Si `DepotDoc` (normalisé) ≠ `info1` (normalisé, insensible à la casse), si la pièce est introuvable ou renvoie plusieurs dépôts distincts → « Ignorée », motif `Dépôt de la pièce « {DepotDoc} » différent de l'Info 1 de l'échéance « {Info1} ».` + `LogWarning`. Les noms de colonnes `DE_No`, `DO_Type IN (6, 7)` et le lien `DO_Numero` ↔ `DO_Piece` sont **HYPOTHÈSES** à valider sur la base de test : si la jointure n'est pas réalisable de façon fiable, **STOP et signaler au PO** (ne pas inventer). Mode manuel non concerné.

Fonction de résolution d'une échéance :

```csharp
// retourne (caisse, motifIgnoree) ; caisse != null => OK ; sinon motifIgnoree explique pourquoi
private static (CaisseParametree? caisse, string? motif) ResoudreCaisse(Dictionary<string, CaisseParametree?> param, string? info1)
```
- `info1` null/vide après Trim → motif `Aucune caisse paramétrée : dépôt (Info 1) vide sur l'échéance.`
- clé absente → `Aucune caisse paramétrée pour le dépôt « {info1} » (FG_DEPOTFACTURATION).`
- valeur `null` → `Dépôt « {info1} » associé à plusieurs caisses (paramétrage ambigu).`
- `Sommeil` → `Caisse « {Code} » en sommeil.`

### 4.2 DTO

`EcheanceARegleDto` contient déjà `Info1` ; **garder** `DepotIntitule` (= `NormaliserDepot(e.Info1)`) comme valeur normalisée documentée (c'est elle que le front filtre/affiche). Ajouter `string DepotIntitule`, `string? CaisseCode`, `string? CaisseIntitule`, `bool CaisseSommeil`, `string? CaisseMotif` (`null` si caisse résolue ; sinon `"vide"` / `"absent"` / `"ambigu"` ; la caisse en sommeil garde `CaisseCode` renseigné et `CaisseSommeil = true`) et `bool ParametrageIndisponible` (porté **par chaque ligne** de `EcheanceARegleDto` pour rester additif si la route renvoie un tableau ; si elle renvoie déjà un objet englobant, le mettre à ce niveau ; ne jamais changer la forme de la réponse). `GetFacturesARegler` charge le dictionnaire **une fois** puis renseigne chaque ligne (aucune requête par facture ; jamais de N+1 — cf. TASK-115 qui supprime justement un N+1 sur cet écran). Une facture ambiguë ou non paramétrée a `CaisseCode = null` (le front affiche « Non paramétré », ou « Paramétrage ambigu » si `CaisseMotif = "ambigu"`).

**Défaillance du paramétrage (la liste ne doit jamais casser)** : dans `GetFacturesARegler`, entourer **UNIQUEMENT** l'appel à `ChargerParametrageDepotCaisse` d'un `try/catch` : en cas d'échec, `_logger.LogError(ex, "PARAMÉTRAGE DÉPÔT→CAISSE indisponible")`, dictionnaire vide, `ParametrageIndisponible = true`, `CaisseCode = null` et `CaisseMotif = null` sur toutes les lignes ; la liste est renvoyée normalement (HTTP 200, mode manuel intact). Le front, si `ParametrageIndisponible`, affiche un bandeau « Paramétrage des caisses indisponible » et désactive l'option « Caisse paramétrée (automatique) » (l'option manuelle reste utilisable).

`ReglementEspeceItemResultDto` : ajouter `string? CaisseCode` (caisse utilisée) et `bool Ignoree` (+ `Erreur` réutilisé comme motif). Une ignorée a `Success = false` **et** `Ignoree = true`.

### 4.3 Refonte de `GenererReglementsEspece`

Conserver **l'ancienne signature** (utilisée par `harness_task107/Program.cs`, appels nommés à 5 paramètres) et ajouter la nouvelle :

```csharp
public List<ReglementEspeceItemResultDto> GenererReglementsEspece(int jwtUserId, int societeId, string caisseCode, List<int> echeanceNos, bool isAdmin)
    => GenererReglementsEspece(jwtUserId, societeId, caisseCode, false, echeanceNos, isAdmin, null);

public List<ReglementEspeceItemResultDto> GenererReglementsEspece(int jwtUserId, int societeId, string? caisseCode, bool caisseAuto, List<int> echeanceNos, bool isAdmin, List<CaisseAttendueDto>? caissesAttendues)
```

**Aucun paramètre optionnel (valeur par défaut) sur la nouvelle surcharge** (un `bool caisseAuto = false` rendrait des appels ambigus, CS0121). L'ancienne signature reste appelable telle quelle par le banc (vérifier la **compilation** de `harness_task107`, à inclure dans la checklist) ; le wrapper manuel passe `false` / `null` et garde le comportement actuel si `caisseCode` est vide (`ArgumentNullException` via `GetCaisse`). Propriété .NET de sommeil de la DLL : `Caisse.EnSommeil` (et non `Sommeil`). `GetCaisses()` est mis en cache par la DLL pour la durée du processus : une caisse créée ou modifiée après le démarrage de l'API est vue par le SQL mais pas par `GetCaisse` → « Caisse introuvable » (résultat sûr, à documenter dans le VERIFY).

Structure imposée (ne pas dupliquer la logique de création, **extraire** la boucle existante) :

1. **Contexte partagé** : `private sealed class ContexteGeneration` (type **RÉFÉRENCE**, jamais `struct` ni `record` immuable), construit par une méthode privée `ConstruireContexte(societe, societeId)`, **appelée au plus une fois par appel et jamais par groupe**. Champs mutables partagés par tous les groupes : `int JwtUserId`, `Societe Societe`, `Devise Devise` (null → `InvalidOperationException("Devise société introuvable.")`), `Dictionary<int, Echeance> EcheancesOuvertes` (le `GetAll` d'échéances est lourd), `TiersHelper TiersHelper`, `bool ClientsCharges`, `int ClientsIntrouvables`, `Stopwatch Chrono` (démarré **une seule fois**, à l'entrée de `GenererReglementsEspece`, avant le chargement du contexte, jamais par groupe), `CaisseManager`, `VerifySoldeManager`, `AffectationRepo`, `SocieteManager`. **Interdit** : passer `ClientsCharges`, `ClientsIntrouvables` ou `Chrono` par valeur à `TraiterFactures`, les redéclarer en local ou les remettre à zéro par groupe ; `TraiterFactures` les lit et les modifie via `ctx` (sinon rechargement des ~24 500 tiers à chaque groupe).
2. **Mode manuel** (`caisseAuto = false`) : **comportement strictement identique à aujourd'hui**, dans le même ordre, exécuté **AVANT tout appel à `ConstruireContexte`** : `GetCaisse(caisseCode)` (null → `InvalidOperationException("Caisse introuvable : …")`), contrôle d'autorisation (`UnauthorizedAccessException` → le contrôleur répond 403), `HasModeReglement(1)`. Seulement ensuite : `ConstruireContexte` puis `TraiterFactures` sur toutes les échéances. Un non autorisé ou une caisse inconnue ne déclenche donc aucun `GetAll` ni lecture de devise, et la précédence des erreurs reste celle du code actuel. Les exceptions sont propagées comme aujourd'hui (pas de try/catch par groupe en manuel).
3. **Mode automatique** (`caisseAuto = true`, `caisseCode` ignoré). **Ordre normatif** : (i) charger le paramétrage (`ChargerParametrageDepotCaisse`) **AVANT tout traitement, SANS try/catch** : s'il échoue, lever `InvalidOperationException("Paramétrage dépôt→caisse indisponible : aucune facture traitée.")` ; aucun règlement n'est créé, aucun résultat « Ignorée » n'est fabriqué ; le contrôleur la traduit en `Problem` 500 existant. Un dictionnaire vide **mais chargé avec succès** est un cas normal (tout en « Ignorée ») ; (ii) `ConstruireContexte` dès l'entrée dans le mode (`EcheancesOuvertes` est nécessaire pour lire `Info1`), avant la résolution des caisses ; (iii) `Distinct()` ; (iv) pour chaque échéance dans l'ordre demandé : introuvable/soldée → Erreur, sinon résolution (3a/3b) ; (v) par groupe : `GetCaisse`, identité, `HasEntityActionRestriction`, `HasModeReglement(1)`, `TraiterFactures` (3d).
   a. pour chaque échéance : introuvable/soldée dans `EcheancesOuvertes` → erreur `Facture introuvable ou déjà soldée.` (**erreur**, pas « ignorée », comme aujourd'hui) ;
   b. sinon `ResoudreCaisse(param, echeance.Info1)` : non résolue → résultat **Ignorée** (motif § 4.1), et le compteur par (motif, dépôt) du récapitulatif de logs est alimenté à ce moment (point 5) ; puis garde-fou du dépôt réel de la pièce (§ 4.1). **Contrôle de cohérence avec l'affichage** (voir § 4.4 `CaissesAttendues`) : pour chaque échéance résolue, comparer `CaisseParametree.Code` (insensible à la casse) à la caisse attendue transmise (null/vide = affichée « Non paramétré »). Si elle diffère, ou si l'échéance n'a pas d'entrée dans `CaissesAttendues` → ne PAS écrire : résultat en **erreur** (`Ignoree = false`) `Paramétrage modifié depuis l'affichage (attendu {X|Non paramétré}, trouvé {Y}). Rechargez la liste.` + `LogWarning`. Une échéance affichée « Non paramétré » mais devenue paramétrée est aussi refusée (aucune caisse n'a été confirmée). Une échéance affichée paramétrée mais devenue non résolue reste « Ignorée » (motif § 4.1). Ce contrôle se fait **avant** le regroupement 3c et n'ouvre aucune requête SQL supplémentaire ;
   c. regrouper les résolues par **`CaisseParametree.Id`** (et non par `Code`, qui ne sert qu'à `GetCaisse`), ordre de première apparition ;
   d. pour chaque groupe, **toute la séquence est enveloppée dans un `try/catch (Exception ex)` PAR GROUPE** : `societe.GetCaisse(code)` (null → toutes les factures du groupe en **erreur** `Caisse introuvable : X`) ; **contrôle d'identité obligatoire** : si `caisse.No != CaisseParametree.Id` du groupe, toutes les factures du groupe passent en **erreur** `Paramétrage incohérent pour la caisse X.` + `LogWarning("PARAMÉTRAGE CAISSE incohérent : code={Code} attendu={IdAttendu} obtenu={IdObtenu}")`, aucun traitement, aucune exception, les autres groupes continuent (ce contrôle précède l'autorisation et `HasModeReglement(1)`) ; contrôle d'autorisation `HasEntityActionRestriction` (restreint → toutes les factures du groupe en **erreur** `Non autorisé sur la caisse X.` + `LogWarning` ; **ne pas lever d'exception**, les autres groupes continuent) ; `HasModeReglement(1)` faux → groupe en erreur `La caisse X n'accepte pas le mode de règlement Espèce.` ; sinon traiter le groupe avec la **boucle existante extraite** (méthode privée `private void TraiterFactures(ContexteGeneration ctx, Caisse caisse, string caisseCode, IEnumerable<int> echeanceNos, List<ReglementEspeceItemResultDto> resultats)` ; `jwtUserId` est lu dans `ctx.JwtUserId` pour les logs OK et ÉCHEC existants), qui renseigne `CaisseCode` sur chaque résultat. En cas d'exception sur le groupe (`ArgumentNullException` si code vide, `InvalidOperationException` si deux caisses ont le même code en majuscules, `HasEntityActionRestriction`/`HasModeReglement` qui lèvent, ou toute autre) : `LogError(ex, "GÉNÉRATION RÈGLEMENT ESPÈCE groupe caisse={Code} en échec")` et marquer en **erreur** uniquement les factures du groupe qui n'ont **pas encore de résultat** (message `Erreur technique sur la caisse X : {ex.Message}`) ; **ne jamais relancer** : les autres groupes continuent et le contrôleur ne renvoie pas 500 ; ne pas écraser les résultats déjà produits par `TraiterFactures` ;
   e. **recomposer les résultats dans l'ordre de la demande** : construire un `Dictionary<int, int>` échéance → position dans `distinctEcheanceNos`, trier dessus ; **assertion de test** : nombre de résultats = nombre d'échéances distinctes, chaque échéance produisant exactement un résultat (aucun perdu ni doublé par le regroupement). Le tri ne sert qu'à l'affichage (le front retrie par `echeanceNo`) ; en auto, l'ordre de **création** des règlements et la numérotation suivent les groupes par caisse, pas l'ordre de la demande.
4. Garde-fous de la boucle conservés tels quels : relecture SQL `EC_Solde > 0` avant écriture, `Remove` de l'échéance du dictionnaire, isolation `try/catch` par facture, `EC_SoldeDevise = 0`, un `ReglementCreate` par facture, jamais de split.
5. **Logs** (format existant `GÉNÉRATION RÈGLEMENT ESPÈCE …`). Au démarrage : `mode=auto|manuel`, nombre de factures demandées dédupliquées. Par groupe (auto) : `GROUPE caisse={Code} nb={N}`. **Fin de lot : UNE SEULE ligne**, émise par `GenererReglementsEspece` après le dernier groupe, jamais dans `TraiterFactures`, à partir de `ctx.ClientsIntrouvables` et `ctx.Chrono`. Compteurs calculés sur la liste `resultats` complète recomposée : `creees = Count(r => r.Success)` ; `ignorees = Count(r => r.Ignoree)` ; `echecs = Count(r => !r.Success && !r.Ignoree)` ; on a toujours `creees + ignorees + echecs = resultats.Count` (**remplace** l'ancien `resultats.Count - nbSucces`, qui compterait les ignorées comme échecs) ; `moyenne = Chrono.ElapsedMilliseconds / creees` (0 si `creees = 0`). Le champ `caisse=` devient : en manuel, le code de la caisse choisie ; en auto, `caisse=auto caisses={liste des codes distincts effectivement traités}`. Format cible : `GÉNÉRATION RÈGLEMENT ESPÈCE FIN DE LOT : userId={UserId}, mode={Mode}, caisse(s)={Caisses}, demandées={Demandees}, créées={Creees}, ignorées={Ignorees}, échecs={Echecs}, clients introuvables={Introuvables}, durée={Ms} ms, moyenne={Moyenne} ms/règlement créé.` **Puis, si ignorées > 0, une ligne `LogWarning` de récapitulatif** : `GÉNÉRATION RÈGLEMENT ESPÈCE ignorées par motif : non_paramétré=N1 ; ambigu=N2 ; sommeil=N3 ; détail dépôts (top 50 par volume décroissant) : 'DR9 …'=12 (non paramétré), … ; autres dépôts=K` (comptage par couple (motif, `DepotIntitule`) dans un dictionnaire alimenté en 3b ; ligne < 4 Ko pour 30 000 factures dont 100 dépôts non paramétrés). Les échecs sont récapitulés de la même façon, par message d'erreur, 20 messages distincts maximum. **Ne jamais logger** les numéros d'échéance ni la liste complète des factures (voir § 4.4).

### 4.4 Contrôleur (`ReglementController`)

- `GenererReglementsEspeceRequest` : `string? CaisseCode`, `bool CaisseAuto`, `List<int> EcheanceNos`, `List<CaisseAttendueDto>? CaissesAttendues` (`CaisseAttendueDto` = `int EcheanceNo`, `string? CaisseCode`).
- Validation (400, messages en français) : **`CaisseAuto = false`** : validation actuelle **à l'identique** (`CaisseCode` vide OU `EcheanceNos` vide → `caisseCode et echeanceNos (au moins une facture) sont obligatoires.`) ; `CaisseCode == "__AUTO__"` → 400 (`caisseCode invalide.`, garde-fou contre un bug front). **`CaisseAuto = true`** : `EcheanceNos` vide → `echeanceNos (au moins une facture) est obligatoire.` ; `CaissesAttendues` absent → `caissesAttendues est obligatoire en mode automatique.` ; `CaisseCode` est ignoré (jamais mélangé). Une entrée absente pour une échéance donnée n'est pas un 400 mais une erreur par facture (§ 4.3 point 3b).
- Log d'entrée (dans l'action `generer-espece`) : **remplacer** `string.Join(",", request.EcheanceNos)` (30 000 identifiants dans une ligne de log) par le **nombre** de factures et `mode=auto|manuel` (+ `caisse=` en manuel). Le scope `BeginScope` idem.
- Réponse **additive** (les clients existants lisent `success`, `reglementsCreees`, `erreurs`) :
  ```json
  { "success": true|false,
    "reglementsCreees": [ { "echeanceNo", "factureNumero", "success": true, "reglementNo", "reglementNumero", "caisseCode" } ],
    "ignorees": [ { "echeanceNo", "factureNumero", "motif" } ],
    "erreurs":  [ { "echeanceNo", "factureNumero", "erreur" } ] }
  ```
  `success = (erreurs.Count == 0)` : **les ignorées ne comptent pas comme erreurs**. `erreurs` = résultats `!Success && !Ignoree`. Champ additif optionnel `nbCreees` (int). Les entrées de `ignorees` et `erreurs` n'ont **pas** de `caisseCode` renvoyé.
- **Sémantique de `success`** : un lot 100 % ignoré renvoie 200 avec `success = true` et 0 créée : `success` ne signifie **pas** « au moins une créée » ; les clients lisent les listes. En mode auto, un lot dont tous les groupes sont non autorisés renvoie **200** avec `success = false` et N erreurs `Non autorisé sur la caisse X.` (jamais 403).
- Mapping d'exceptions : `UnauthorizedAccessException` → 403 en **manuel uniquement** ; en mode automatique aucune `UnauthorizedAccessException` n'est levée, il n'y a **jamais de 403**, et le message front 403 (§ 5.7) n'apparaît jamais en auto (les erreurs se lisent dans le tableau de résultats). En auto, le contrôleur ne renvoie `Problem`/500 que pour une erreur du contexte partagé avant la création du premier règlement (paramétrage indisponible, société, devise null, chargement des échéances) ; une exception sur un groupe devient des erreurs par facture dans la réponse 200. Le mode manuel garde le mapping actuel (403 / `Problem`). Autres exceptions : `Problem`.
- Taille du corps de requête : en auto, `caissesAttendues` ajoute environ 1 Mo pour 30 000 lignes ; vérifier la limite de corps Kestrel/IIS (test § 8).
- `GET factures-a-regler` : même route, DTO enrichi (champs additifs, y compris `ParametrageIndisponible`, § 4.2).
- Divulgation : la liste révèle à tout utilisateur la correspondance dépôt → caisse, y compris pour des caisses qu'il n'a pas le droit d'utiliser ; **accepté** (divulgation mineure, information de paramétrage), à mentionner dans le VERIFY.

### 4.5 Catalogue des messages (référence unique)

| Clé | Texte exact | Où |
|---|---|---|
| Ignorée dépôt vide | `Aucune caisse paramétrée : dépôt (Info 1) vide sur l'échéance.` | `ignorees[].motif` |
| Ignorée non paramétré | `Aucune caisse paramétrée pour le dépôt « X » (FG_DEPOTFACTURATION).` | idem |
| Ignorée ambigu | `Dépôt « X » associé à plusieurs caisses (paramétrage ambigu).` | idem |
| Ignorée sommeil | `Caisse « XDR2 » en sommeil.` | idem |
| Ignorée dépôt pièce | `Dépôt de la pièce « {DepotDoc} » différent de l'Info 1 de l'échéance « {Info1} ».` | idem |
| Erreur facture | `Facture introuvable ou déjà soldée.` | `erreurs[].erreur` |
| Erreur non autorisé (auto) | `Non autorisé sur la caisse X.` | idem (le manuel garde le 403 `Vous n'êtes pas autorisé à utiliser cette caisse.`) |
| Erreur mode règlement | `La caisse X n'accepte pas le mode de règlement Espèce.` | idem |
| Erreur caisse | `Caisse introuvable : X` / `Paramétrage incohérent pour la caisse X.` / `Erreur technique sur la caisse X : …` | idem |
| Erreur paramétrage modifié | `Paramétrage modifié depuis l'affichage (attendu …, trouvé …). Rechargez la liste.` | idem |

Mapping JSON → TS : `ignorees[].motif` → `ReglementResultatItem.motif` ; `erreurs[].erreur` → `erreur` ; un seul champ par donnée, le « Détail » du tableau affiche `motif` (ignorée) ou `erreur` (échec).

## 5. Spécification frontend (détaillée)

Fichier `gocom-web/src/ReglementGenerationEspece.tsx` (+ CSS). Réutiliser le pattern colonnes/`ExcelFilter` existant (ARCHITECTURE.md § Grilles de données) : **aucun nouveau composant de grille**.

### 5.1 Types
`EcheanceARegler` : ajouter `depotIntitule: string; caisseCode?: string | null; caisseIntitule?: string | null; caisseSommeil?: boolean; caisseMotif?: string | null; parametrageIndisponible?: boolean;`.
`ReglementResultatItem` : ajouter `ignoree?: boolean; caisseCode?: string; motif?: string;`. Le fichier est en `// @ts-nocheck` : `npm run build` ne prouve **ni** les types **ni** les accès aux nouveaux champs ; l'E2E doit les couvrir.

### 5.2 Colonnes
Dans `ALL_COLUMNS`, juste après `representant` :
```ts
{ key: 'depotIntitule',    label: 'Dépôt',             filterType: 'list', defaultVisible: true },
{ key: 'caisseParametree', label: 'Caisse paramétrée', filterType: 'list', defaultVisible: true },
```
`getItemValue` (suite de `if` avec repli `String((f as any)[key] ?? '')`, **pas** un `switch` ; utilisée par `ExcelFilter` pour les filtres et pour la liste des valeurs uniques ; **il n'existe aucun export dans ce composant : ne rien ajouter pour l'export**). Ajouter, avant le repli final :
- `if (key === 'depotIntitule') return f.depotIntitule || '—';`
- `if (key === 'caisseParametree') return f.caisseCode ? (f.caisseSommeil ? `${f.caisseCode} (en sommeil)` : f.caisseCode) : (f.caisseMotif === 'ambigu' ? 'Paramétrage ambigu' : 'Non paramétré');`

**TRI (obligatoire)** : le comparateur de `sortedFactures` (useMemo) lit `(a as any)[sortCol]`. Pour `caisseParametree` ce champ n'existe pas (le tri serait sans effet), et pour `depotIntitule` il trierait la valeur brute `''` alors que l'écran affiche `'—'`. Dans la branche texte (`else`), remplacer `String((a as any)[sortCol] || '')` par `(sortCol === 'depotIntitule' || sortCol === 'caisseParametree') ? getItemValue(a, sortCol) : String((a as any)[sortCol] || '')`, et idem pour `b`. Comparaison toujours via `collator.compare`, tri secondaire par `echeanceNo` conservé, aucun traitement spécial de `'—'` / `Non paramétré`. Perf acceptable (facultatif : précalculer dans un `useMemo` une `Map` echeanceNo → texte si le tri de 30 000 lignes est perceptiblement lent). **Ne pas renommer** les clés de colonne `depotIntitule` et `caisseParametree` vers les champs API `caisseCode`/`caisseIntitule`.

`renderCellContent` : ajouter `case 'depotIntitule'` (affiche `f.depotIntitule || '—'`) et `case 'caisseParametree'` **AVANT le `default`**, sinon la cellule s'affiche vide. « Non paramétré » / « Paramétrage ambigu » rendu en **texte orange foncé (#b45309, contraste ≥ 4,5:1 sur fond blanc) + infobulle** `Aucune caisse paramétrée pour ce dépôt : la facture sera ignorée en mode automatique` ; le texte porte l'information (la couleur n'est qu'un renfort), et le motif doit rester lisible **sans survol** (le libellé court dans la cellule suffit ; le détail complet est dans le tableau de résultats) ; caisse paramétrée = `CODE` avec `title` = intitulé.

### 5.3 Préférences de colonnes déjà enregistrées (point critique)
Les colonnes visibles sont mémorisées dans `localStorage` (`gocom_reglement_espece_columns`, initialiseur de `selectedColKeys`). Un utilisateur qui a déjà une préférence **ne verrait pas** les nouvelles colonnes. Implémentation imposée, en 3 points :

(a) **Constantes** : conserver `LOCALSTORAGE_KEY_LEGACY = 'gocom_reglement_espece_columns'` (lecture seule, utilisée uniquement pour la migration) et ajouter `LOCALSTORAGE_KEY = 'gocom_reglement_espece_columns_v2'`. **Plus aucune écriture ne doit viser l'ancienne clé** (qui n'est pas supprimée).

(b) **Initialiseur de `selectedColKeys`** (pseudo-code) :
```
try { v2 = localStorage.getItem(V2) } catch {}
si v2 valide → retourner v2
try { legacy = localStorage.getItem(LEGACY) } catch {}
si legacy valide → cols = legacy (migration client → clientCode/clientIntitule conservée) + ajouter 'depotIntitule' et 'caisseParametree' s'ils sont absents ; (second try/catch distinct) écrire V2 immédiatement ; retourner cols
sinon → défauts
```
La lecture et la migration se font dans un premier `try/catch` et la valeur calculée est **retournée même si l'écriture échoue** ; l'écriture de `_v2` est dans un second `try/catch` distinct, pour qu'un échec d'écriture n'annule pas la migration en mémoire. Les colonnes ajoutées le sont une seule fois (ensuite `_v2` existe : l'utilisateur peut les masquer durablement).

(c) **`toggleColumn`** : son `localStorage.setItem` utilise la constante `_v2` et est entouré d'un `try/catch` (`catch {}` silencieux ou `console.error`). Idéalement l'écriture sort de l'updater `setSelectedColKeys` (par exemple `useEffect` sur `selectedColKeys`) pour éviter un effet de bord dans l'updater. Vérifier par recherche dans le fichier que `localStorage.setItem` n'apparaît plus sans `try/catch` (colonnes **et** `pageSize`) et qu'aucune écriture ne vise l'ancienne clé.

### 5.4 Liste déroulante
Constante `const CAISSE_AUTO = '__AUTO__';`. L'option auto est la **2e `<option>`**, juste après « Choisir une caisse… » (`value=''`), avant les caisses autorisées : `<option value="__AUTO__">Caisse paramétrée (automatique)</option>`. Elle reste affichée même si la liste des caisses autorisées est vide : le serveur tranche (erreur `Non autorisé sur la caisse X.` par groupe). Elle est **désactivée** si `parametrageIndisponible` (§ 4.2). `const modeAuto = caisseCode === CAISSE_AUTO;`. La valeur par défaut reste `''` : **le mode automatique n'est jamais présélectionné**. Ne pas persister `__AUTO__` en `localStorage`. **`handleGenerer`, `peutGenerer` et tout message testent `modeAuto` EN PREMIER** : `__AUTO__` ne doit jamais être envoyé comme `caisseCode` ni affiché dans un message (`sur la caisse ${caisseCode}`).

### 5.5bis Classement unique d'une facture
Une seule fonction pure, dans `ReglementGenerationEspece.tsx`, sert partout (bandeau § 5.5, `peutGenerer` et messages § 5.6) :
```ts
type ClasseCaisse = 'traitable' | 'sommeil' | 'nonParametre';
const classerFacture = (f: EcheanceARegler): ClasseCaisse =>
  !f.caisseCode ? 'nonParametre' : f.caisseSommeil ? 'sommeil' : 'traitable';
```
Interdit de réécrire cette logique ailleurs. (Une facture « ambiguë » est `nonParametre` ; seul son libellé diffère, via `caisseMotif`.)

### 5.5 Récapitulatif des factures cochées (bandeau lisible)
Dans le bloc « Cochées : N / Total : … » existant, ajouter une ligne (ou un second bandeau juste dessous). **Réutiliser le `facturesByNo` existant** (ne pas créer de second `Map`) et **étendre le `useMemo` existant** qui calcule `echeanceNosCoches` / `totalCoche` pour produire aussi le récapitulatif par caisse (pas de `find` par case cochée : la liste peut faire 30 000 lignes). Ne pas passer d'objet ou de fonction recréés à `FactureRow` (mémoïsation à préserver).

`Caisses des factures cochées : XDR2 × 120 (1 250 000,00) · XDR3 × 15 (85 000,00) · Non paramétré × 3 (12 400,00)`

Montant = somme du `solde` des cochées du groupe (comme `totalCoche`), formaté par le `formatMoney` existant. Le bandeau ne regroupe par `caisseCode` que les factures `traitable`, triées par nombre décroissant. Les `sommeil` sont regroupées à part, en orange : `XDR2 (en sommeil) × 4 (…)`. Les `nonParametre` en dernier, en orange : `Non paramétré × 3 (…)`. Bandeau en `flex-wrap` ; au-delà de 5 caisses, afficher les 5 premières puis `… +N autres caisses`. Si aucune facture cochée : pas de bandeau.

### 5.6 Bouton « Générer » et confirmation
- `peutGenerer` : manuel = comme aujourd'hui ; automatique = `echeanceNosCoches.length > 0 && au moins une cochée avec classerFacture(f) === 'traitable' && !generating`. Le libellé du bouton en auto affiche le nombre de factures `traitable` (cohérent avec la confirmation) ; en manuel, inchangé.
- Payload : automatique → `{ caisseAuto: true, echeanceNos, caissesAttendues: [{ echeanceNo, caisseCode }] }`. On envoie **toutes** les cochées (y compris non paramétrées et en sommeil : le serveur reste la source de vérité et les renvoie en « ignorées »). `caissesAttendues` est construit depuis `factures` (via `facturesByNo`) avec `caisseCode` de la ligne (ou `null`), sur **exactement les mêmes cochées** que celles du récapitulatif : c'est la caisse que l'utilisateur a vue et confirmée. Manuel → `{ caisseCode, echeanceNos }` comme aujourd'hui. Les filtres de colonnes ne changent pas le comportement : seules les cochées sont envoyées (visibles ou masquées).
- Messages de confirmation (`window.confirm`, sans post-traitement du texte ; l'avertissement « masquées par les filtres » existant s'applique à l'identique et reste **en fin de message** ; les compteurs portent sur toutes les cochées) :
  - **Automatique** :
    ```
    Confirmez-vous la génération en mode « Caisse paramétrée » ?

    XDR2 : 120 règlement(s) — 1 250 000,00
    XDR3 : 15 règlement(s) — 85 000,00
    Total : 135 règlement(s) — 1 335 000,00

    4 facture(s) dont la caisse est en sommeil (XDR5 × 4) NE SERONT PAS traitées.
    3 facture(s) sans caisse paramétrée NE SERONT PAS traitées.
    (elles resteront dans la liste)
    ```
    Seules les `traitable` figurent dans les lignes « règlement(s) » et dans le Total. La ligne « sommeil » (avec le détail des codes) n'apparaît que si > 0 ; la ligne « sans caisse paramétrée » aussi. Si aucune facture `traitable`, le bouton est désactivé (pas de message). **Les chiffres du message doivent correspondre au résultat serveur.**
  - **Manuel** : message actuel, auquel on ajoute, si des cochées ont une **autre** caisse paramétrée que celle choisie : `ATTENTION : N facture(s) cochée(s) ont une autre caisse paramétrée (XDR3 : 12, XDR4 : 2).` et, si des cochées n'ont aucune caisse paramétrée : `M facture(s) n'ont pas de caisse paramétrée (traitées sur la caisse choisie).` Le décompte « autre caisse paramétrée » compte les `traitable` **et** les `sommeil` dont `caisseCode !== caisseCode choisi` (comparaison exacte, mêmes codes `CA_Code`), triés comme le bandeau ; il sert à avertir d'un écart de caisse, pas de ce qui sera ignoré (le manuel traite tout). Les `nonParametre` sont comptées séparément. Non bloquant : l'utilisateur garde la main.

### 5.7 Traitement de la réponse
- Lire `res.data.ignorees` (défaut `[]`) en plus de `reglementsCreees` / `erreurs` ; construire les lignes de résultat : créées `{success:true, caisseCode}`, ignorées `{success:false, ignoree:true, motif}`, erreurs `{success:false}` ; tri par `echeanceNo` (existant). Les lignes erreurs et ignorées n'ont pas de `caisseCode` renvoyé par le serveur.
- **Toasts** : le choix du toast ne lit **JAMAIS** `res.data.success` (remplacer le test `if (res.data?.success)` du traitement de réponse : `success` vaut `true` même quand des factures sont ignorées). Calculer `const nbCreees = reglementsCreees.length, nbIgnorees = ignorees.length, nbErreurs = erreurs.length;`. Toast `success` (« N règlement(s) généré(s) avec succès (1 par facture). ») **UNIQUEMENT** si `nbCreees > 0 && nbIgnorees === 0 && nbErreurs === 0`. Dans tous les autres cas, toast `warning` : `N règlement(s) créé(s), M ignorée(s) (sans caisse paramétrée), K en échec — voir le détail ci-dessous.` (omettre les compteurs à 0). Si `nbCreees === 0` : `0 règlement créé, M ignorée(s) (sans caisse paramétrée), K en échec — voir le détail ci-dessous.` ; jamais « généré(s) avec succès » quand `nbCreees = 0`. Si au moins une erreur contient `Paramétrage modifié depuis l'affichage`, ajouter au toast une invitation à recharger la liste.
- **Mise à jour locale** : (a) créées retirées de `factures` et de `checked` (code TASK-108 existant, inchangé) ; (b) échecs conservés dans la liste et cochés (inchangé, y compris les erreurs `Paramétrage modifié…`) ; (c) **NOUVEAU CODE** : ignorées conservées dans `factures` mais retirées de `checked` : `const ignoreeNos = new Set(ignorees.map(r => Number(r.echeanceNo))); setChecked(prev => { const next = {...prev}; for (const no of ignoreeNos) delete next[no]; return next; });`. Ce code s'exécute **même si** l'ensemble des créées est vide : ne pas le placer dans le `if (successEcheanceNos.size > 0)` existant.
- Statut 403 : message existant `Vous n'êtes pas autorisé à utiliser cette caisse.` (**manuel uniquement** ; jamais produit en auto, voir § 4.4).
- La colonne « Caisse paramétrée » et le bandeau de répartition restent affichés après génération (ils rappellent la situation des ignorées conservées dans la liste).

### 5.8 Tableau de résultats
Dériver un statut unique : `const statut = r.success ? 'ok' : r.ignoree ? 'ignoree' : 'ko'`. Quatre éléments en dépendent, **plus aucun ne dépend de `r.success` seul** : className `regesp-row-ok` / `regesp-row-ignoree` / `regesp-row-ko` ; badge `Créé` (CheckCircle2, vert) / `Ignorée` (`MinusCircle` de `lucide-react`, gris, à ajouter à l'import ; disponible dans la version installée, `CircleMinus` accepté aussi) / `Échec` (XCircle, rouge) ; N° règlement = `r.reglementNumero` si ok, sinon `—` ; « Détail » = `''` si ok, `r.motif` si ignorée, `r.erreur` si ko. Ajouter la colonne **« Caisse »** (après « N° Facture ») = `r.caisseCode` si présent, sinon `facturesByNo.get(Number(r.echeanceNo))?.caisseCode`, sinon `—` (le repli fonctionne pour les ignorées et les échecs, qui restent dans `factures` ; pour les créées, utiliser `r.caisseCode`, car elles en sont retirées).

CSS (valeurs imposées, contraste ≥ 4,5:1, statut porté par texte + icône, pas par la couleur seule) : `.regesp-badge-ignoree { background:#e5e7eb; color:#374151 }`, `.regesp-row-ignoree { background:#f9fafb; color:#4b5563 }`, même gabarit que `.regesp-badge-ok/-ko` existants, dans `ReglementGenerationEspece.css`. Orange « Non paramétré » : `#b45309`.

## 6. Cas limites à traiter explicitement

| # | Cas | Attendu |
|---|---|---|
| 1 | `EC_Info1` vide ou null | Ignorée (auto) / traitée sur la caisse choisie (manuel) ; pas d'exception |
| 2 | `EC_Info1` avec espaces avant/après ou casse différente | Résolue (`NormaliserDepot`, insensible à la casse). Scénarios de banc : espace de tête, espace de queue, casse différente → résolue ; tabulation, NBSP ou double espace interne → Ignorée, sans exception |
| 3 | Intitulé présent dans `F_DEPOT` mais pas dans `FG_DEPOTFACTURATION` | Non paramétré |
| 4 | `FG_DEPOTFACTURATION.MR_Id <> 1` | Non paramétré (la requête filtre `MR_Id = 1`) |
| 5 | Deux dépôts distincts, même caisse | Résolu normalement, un seul groupe |
| 6 | Même intitulé de dépôt → deux caisses | Ambigu → ignorée, LogWarning, jamais de choix arbitraire |
| 7 | Caisse paramétrée d'une autre société (`SO_Id`) | Exclue par le filtre `c.SO_Id = @SocieteId` → non paramétré |
| 8 | Caisse paramétrée en sommeil | Ignorée avec motif dédié ; en manuel : aucune modification, ne pas ajouter de contrôle de sommeil (la caisse choisie est traitée exactement comme aujourd'hui) |
| 9 | Caisse paramétrée non autorisée pour l'utilisateur (non admin) | Auto : factures du groupe en erreur `Non autorisé sur la caisse X.`, autres groupes traités, **aucune exception globale**, 200 même si tous les groupes sont refusés ; manuel : 403 comme aujourd'hui |
| 9bis | Exception technique sur un groupe (deux caisses de même code en casse ignorée, code vide, `GetCaisse` / `HasEntityActionRestriction` qui lèvent) | Auto : factures du groupe en erreur `Erreur technique sur la caisse X : …`, autres groupes traités, réponse 200, aucun 500 ; manuel : exceptions propagées comme aujourd'hui |
| 10 | Échéance introuvable/déjà soldée | Erreur (pas « ignorée »), message actuel |
| 11 | Échéance soldée entre le chargement et l'écriture | Garde-fou `EC_Solde` existant, message actuel (TASK-107/114) |
| 12 | Lot entièrement non paramétré en auto | Bouton désactivé ; si l'appel est forcé : 200 avec 0 créée, N ignorées, `success = true` (les ignorées ne sont pas des erreurs) ; le front affiche le toast `warning` de § 5.7, **jamais** le toast vert |
| 13 | Requête avec `caisseAuto = true` **et** `caisseCode` renseigné | `caisseCode` ignoré, jamais mélangé (à écrire dans le contrôleur) ; `caisseCode = "__AUTO__"` avec `caisseAuto = false` → 400 |
| 14 | Requête sans `caisseCode` et sans `caisseAuto` | 400 (message historique, § 4.4) ; auto sans `caissesAttendues` → 400 |
| 15 | Doublons dans `echeanceNos` | `Distinct()` existant |
| 16 | Utilisateur avec préférence de colonnes ancienne | Voit les 2 nouvelles colonnes (migration § 5.3) ; ancienne clé avec `['clientCode','montant']` → colonnes = ces deux + `depotIntitule` + `caisseParametree` |
| 16b | Utilisateur ancien : décocher une colonne, recharger la page | La colonne reste décochée, la clé `_v2` contient le choix, l'ancienne clé est inchangée |
| 17 | `localStorage` indisponible | L'écran fonctionne avec les défauts (try/catch partout, y compris `toggleColumn` et `pageSize`) |
| 18 | Lot de 30 000 factures | Aucune requête SQL par facture pour la résolution ; chargement de la liste sans régression de temps |
| 19 | Deux générations simultanées (relance d'un lot pendant que le premier tourne côté serveur) | **Hors périmètre TASK-116** : risque antérieur et inchangé (`EC_Solde` lu puis `ReglementCreate` sans verrou ; numérotation par `MAX`). **Consigne obligatoire au PO** : ne jamais relancer un lot tant qu'on n'a pas vérifié qu'il est terminé (message de résultat affiché, ou log de fin de lot du serveur). En cas de timeout navigateur, attendre le log de fin de lot, puis contrôler les doublons (requête § 9.3 et recherche de deux `RT_MOUVEMENT` sur le même `EC_Id`). Le mode automatique ne doit pas être utilisé pour plusieurs lots en parallèle. **Gemini ne doit PAS ajouter de verrou dans cette TASK.** |
| 20 | Paramétrage (`FG_DEPOTFACTURATION`) ou `EC_Info1` modifié entre l'affichage et la génération | Facture concernée en erreur `Paramétrage modifié depuis l'affichage…`, 0 mouvement créé pour elle, les autres factures du lot traitées normalement, aucune exception globale |
| 21 | Requête auto sans `caissesAttendues`, ou échéance absente de `caissesAttendues` | 400 (liste absente) ou erreur par facture (entrée manquante) |
| 22 | `GetCaisse(code)` retourne une caisse d'identité différente de `CA_Id` paramétré (kernel sur une autre société, code dupliqué) | Groupe entier en erreur `Paramétrage incohérent pour la caisse X.`, aucun `ReglementCreate`, aucun effet sur les autres groupes |
| 23 | `EC_Info1` (ex. `DO_Coord01` d'une échéance fraîchement intégrée hors plage du job) coïncide avec l'intitulé d'un AUTRE dépôt paramétré | Auto : Ignorée (garde-fou dépôt de la pièce, § 4.1), aucun règlement créé |
| 24 | Paramétrage inaccessible (table renommée / droit SELECT coupé en recette) | La liste se charge, bandeau « Paramétrage des caisses indisponible », mode manuel fonctionnel, auto désactivé ; un POST auto forcé renvoie une erreur et 0 règlement créé |
| 25 | Lot lancé sur 2 caisses ou plus | Un seul chargement des tiers ERP (une seule ligne de log), `clients introuvables` cumulé sur tous les groupes |

## 7. Contraintes

- **Aucune table ajoutée.** Aucune écriture par le **code applicatif** dans `FG_DEPOTFACTURATION`, `F_DEPOT`, `RT_CAISSE` (lecture seule). Aucun script de migration. **Exception de test** : en **BASE DE TEST uniquement**, un script annulable `sql/test/TASK116_jeu_donnees.sql` (avec bloc UNDO) peut insérer une 2e ligne `FG_DEPOTFACTURATION` (même `DP_Id`, autre `CA_Id`) pour créer l'ambiguïté du cas 6. Ce script n'est JAMAIS exécuté en production et n'est pas déployé.
- Ne jamais bypasser une règle de sécurité ou une DLL métier GRC : `HasEntityActionRestriction` appliqué à **chaque** caisse résolue ; aucun changement des 36 paramètres de `ReglementCreate`.
- Le mode manuel garde exactement ses comportements (messages, codes HTTP, ordre des contrôles) hors l'alerte de confirmation.
- Respecter la Clean Architecture et `ARCHITECTURE.md` § Grilles de données.
- Aucun secret en dur ; jamais d'exécution pendant une génération en cours.
- **Base de test** : avant toute exécution, identifier serveur + bases `GOCOM`/`GR_GOCOM` de test via la chaîne de connexion de `harness_task107` / `run_test114_via_api.ps1` (lue dans leur configuration, **jamais écrite dans la TASK ni dans le VERIFY**) et la consigner en tête du VERIFY. Si elle n'est pas identifiable sans ambiguïté, ou porte le même nom que la prod : **STOP et signaler** ; jamais de génération, écriture ou suppression sur la prod.
- **Interaction TASK-115** : la logique TASK-115 (`clientsCharges`, `clientsIntrouvables`, `Stopwatch`, logs de fin de lot) est **DÉPLACÉE telle quelle**, sans changement de comportement, dans `TraiterFactures` / `ContexteGeneration` ; ces trois éléments sont partagés par tous les groupes d'un même appel (un seul chargement des ~24 500 tiers par lot, pas un par caisse). Ne pas dupliquer ce chargement par groupe. `TiersErpHelper` serait lié par `Bind<...>().ToSelf()` dans `TresorerieNinjectKernel` (constat reviewer, **HYPOTHÈSE à vérifier**), donc transient : une instance par `Resolve`, jamais partagée entre requêtes ; le résoudre **UNE fois** dans le contexte, pas dans `TraiterFactures`.
- **Séparation implémentation / clôture** : le point d'arrêt de l'implémenteur est le dépôt de `VERIFY/TASK-116_verify.md`. **Interdit** : déplacer la TASK vers `DONE_DETAIL/`, modifier `DONE.md` / `TODO.md` / `CHANGELOG.md`, supprimer le VERIFY, committer ou pousser un message contenant « approuve » / « APPROVE ». La clôture est réservée à une review par un agent qui n'a pas implémenté. En cas de doute : STOP et signaler.
- Le VERIFY rappelle en tête, au PO, la consigne de non-relance d'un lot en cours (cas 19) et indique le risque de doublon comme **dette connue non traitée**.

## 8. Tests exigés de l'implémenteur (le PO ne testera pas)

Document `tasks/SCENARIOS_TASK-116.md` (script de test manuel réutilisable, nominal + cas limites § 6) **et** exécution réelle sur base de test, résultats consignés dans le VERIFY :

**Base de test** : voir § 7 (identification obligatoire, STOP si ambiguë). **Format imposé de `SCENARIOS_TASK-116.md`** : tableau `| ID (S116-01…) | Cas § 6 couvert | Pré-conditions | Étapes | Résultat attendu | Résultat observé | Date | Preuve |`, avec la matrice cas § 6 → scénario § 8 ci-dessous.

1. **Banc back (base de test)** *(cas 1, 3, 4, 5, 6, 8, 10, 12, 2, 7, 11, 20, 21, 22, 23)* : factures de ≥ 3 dépôts mappés sur ≥ 2 caisses + 1 dépôt non paramétré + 1 dépôt à intitulé ambigu (créé via `sql/test/TASK116_jeu_donnees.sql`, § 7) + 1 échéance soldée ; **ajouter explicitement** : `EC_Info1` avec espaces/casse différente (cas 2), caisse d'une autre `SO_Id` (cas 7), échéance soldée entre chargement et écriture (cas 11), `Info1` coïncidant avec un autre dépôt (cas 23), paramétrage ou `Info1` modifié après le chargement de la liste et avant l'appel (cas 20 : 0 mouvement pour elle et l'erreur attendue), auto sans `caissesAttendues` (cas 21), caisse d'identité différente (cas 22), et un `DEPOT_NON_RETROUVE` (intitulé avec espace insécable) qui doit sortir en **ligne d'anomalie** de la requête § 9.3 et non en 0 ligne. Mode auto : contrôle SQL que chaque `RT_MOUVEMENT.CA_IdIn` = caisse attendue (requête § 9.3 : `NbReglementsControles` = nombre de créées et aucune anomalie), 0 mouvement pour les ignorées, résultat `ignorees` conforme. **Logs** : la ligne de fin de lot est émise une seule fois, `créées + ignorées + échecs = demandées`, les ignorées ne sont pas comptées dans `échecs`, la ligne de récapitulatif des ignorées contient les bons compteurs par motif et par dépôt (< 4 Ko pour 30 000 factures dont 100 dépôts non paramétrés). **Résultats** : nombre de résultats = nombre d'échéances distinctes.
   - **Multi-caisses (cas 25)** : lot mixte XDR2 + autre caisse : **UNE seule** ligne de log « tiers ERP chargés » (rechargement de `F_COMPTET`) et `clients introuvables` du log de fin de lot cumulé sur tous les groupes.
   - **Ordre de contrôle (manuel)** : pour un non autorisé, une caisse introuvable et un mode Espèce refusé, vérifier (log ou compteur) qu'**aucun** `echeanceRepo.GetAll` n'a été exécuté.
2. **Autorisation et erreurs par groupe** *(cas 9, 9bis)* : utilisateur non admin restreint sur une des caisses → factures de ce groupe en erreur, autres groupes créés, aucune exception globale, réponse 200 ; un groupe dont `GetCaisse` (ou `HasEntityActionRestriction`) lève une exception → toutes ses factures en erreur, les autres groupes créés, pas de 500. **Aucun contournement** du contrôle.
3. **Non-régression manuel** : rejouer `harness_task107` (10/10, **compilation de l'ancienne signature incluse**) et `run_test114_via_api.ps1` ; mode manuel : mêmes résultats qu'avant.
4. **Contrat API** *(cas 13, 14, 15, 24)* : réponse JSON conforme au § 4.4 ; 400 sur requêtes invalides (dont auto sans `caissesAttendues`, `__AUTO__` avec `caisseAuto = false`) ; 403 en manuel non autorisé ; taille de corps acceptée avec `caissesAttendues` sur 30 000 lignes ; paramétrage inaccessible (cas 24).
5. **E2E front** *(cas 16, 16b, 17, 12)* (`e2e_task116.cjs`, Playwright, captures avant/après) : colonnes visibles pour un profil avec ancienne préférence ; décocher une colonne puis recharger (16b) ; filtre/tri sur « Caisse paramétrée » et sur « Dépôt », croissant et décroissant (l'ordre des lignes doit changer et suivre le libellé affiché) ; bandeau de répartition ; 5 cochées dont 2 en sommeil → bandeau et confirmation montrent 3 règlements et 2 factures non traitées en sommeil, résultat serveur = 3 créés + 2 ignorées ; messages de confirmation (manuel avec écart, auto avec non paramétrées) ; lot 100 % ignoré → toast `warning`, pas de toast vert ; tableau de résultats avec statut « Ignorée » (lignes grises, motif dans Détail, `—` dans N° règlement) ; après génération mixte, les ignorées ne sont plus cochées (le compteur de cochées égale le nombre d'échecs) et sont conservées dans la liste ; liste avec paramétrage indisponible.
6. **Perf** *(cas 18)* : méthode imposée : trace SQL (Profiler ou Extended Events) ou log de commandes EF/Dapper sur la base de test. Fournir le nombre de requêtes de résolution caisse/dépôt pour N=100 puis N=30 000. Seuil : nombre **constant** (≤ 3, indépendant de N) ; temps de chargement de la liste ≤ temps avant + 10 %, mesures avant et après jointes.
7. **Retour arrière** : jouer la séquence complète du § 9.4 (désaffectation puis suppression, avec `@DateDu` / `@DateAu` = NULL) sur au moins 2 règlements créés en mode automatique, avec preuve datée (aperçus, nombre de lignes, soldes avant/après).

Le cas 19 est hors périmètre : aucun test. Les builds (`dotnet build`, `npm run build`) figurent dans la checklist § 11.

## 9. Mise en production directe — filets de sécurité (rien à tester côté PO)

*Section destinée au PO / reviewer (exploitation, hors périmètre de code), sauf la requête 9.3, la séquence 9.4 et le message PO, à tester par l'implémenteur.*

### 9.1 Ordre de déploiement
TASK-115 (déjà déployable) puis TASK-116, API + front (voir `DEPLOY.md`). Aucune migration SQL. **Aucune génération en cours** pendant le déploiement.

### 9.2 Pilote OBLIGATOIRE avant tout lot > 100 factures
*(Cette exigence remplace la version « 5 factures d'un seul dépôt, recommandée » : un seul couple dépôt → caisse ne détecte pas un mauvais mapping parmi ~30 dépôts. Elle est **à confirmer par le PO** si celui-ci souhaite l'alléger.)*
- (a) Avant le pilote, le PO (ou le métier) remplit un **tableau de vérité INDÉPENDANT du paramétrage** : colonnes `dépôt (EC_Info1)` | `caisse attendue (CA_Code)` pour les ~30 dépôts, établi à la main depuis le métier (ex. `DR2 DEPOT REGIONAL NADOR` → `XDR2`), **et non copié depuis `FG_DEPOTFACTURATION`**.
- (b) **Avant la génération** : `SELECT MAX(MV_Id) AS MaxAvant FROM GR_GOCOM.dbo.RT_MOUVEMENT;` et noter la valeur.
- (c) Pilote : cocher **1 facture par dépôt paramétré** (≈ 30 factures, un seul clic), mode automatique, lire la confirmation (nombre de caisses, de non paramétrées), générer.
- (d) Exécuter la requête 9.3 avec `@MaxAvant`. Le lot est valide **UNIQUEMENT** si `NbReglementsControles` = nombre de règlements créés annoncé par l'écran **ET** `NbOK` = `NbReglementsControles`, **ET** (complétude) factures cochées = créés + ignorées + erreurs. Un résultat sans anomalie avec `NbReglementsControles = 0` ou différent du nombre annoncé signifie **NON CONTRÔLÉ** : ne pas lancer de gros lot.
- (e) Comparer, dépôt par dépôt, la caisse réellement obtenue (`RT_MOUVEMENT.CA_IdIn` → `RT_CAISSE.CA_Code`) au tableau de vérité (seconde requête non circulaire ci-dessous) ; tout écart = arrêt, retrait des règlements du pilote selon § 9.4, aucun lot.
- (f) La preuve (tableau coché + résultats 9.3) est jointe au VERIFY. Ne pas utiliser le mode auto hors des heures du job de réécriture d'`EC_Info1` (§ 2.7) tant que le garde-fou « dépôt de la pièce » (§ 4.1) n'est pas livré et prouvé.
- (g) Avant la release, le PO exécute un `SELECT COUNT(*)` des échéances ouvertes dont `LTRIM(RTRIM(EC_Info1))` n'a aucune correspondance dans `LTRIM(RTRIM(F_DEPOT.DE_Intitule))`, pour chiffrer les factures qui seront ignorées de façon inattendue.

### 9.3 Requête de contrôle (lecture seule, à lancer après chaque lot en mode automatique)
**À tester par l'implémenteur sur la base de test AVANT de la donner au PO** (le PO la lancera seul en prod ; elle ne doit pas lever d'erreur de collation 468).
```sql
DECLARE @MaxAvant INT = 0;   -- OBLIGATOIRE : MAX(MV_Id) relevé AVANT le lot (plus de date en dur)
WITH L AS (
  SELECT DISTINCT m.MV_Id, m.MV_Numero, m.CA_IdIn, LTRIM(RTRIM(e.EC_Info1)) AS depot
  FROM GR_GOCOM.dbo.RT_MOUVEMENT m
  JOIN GR_GOCOM.dbo.RT_AFFECTATION a ON a.MV_Id = m.MV_Id
  JOIN GR_GOCOM.dbo.RT_ECHEANCE e    ON e.EC_Id = a.EC_Id
  WHERE m.MV_Id > @MaxAvant AND m.MV_Domaine = 0 AND m.MV_Type = 0),
R AS (
  SELECT L.*, COUNT(DISTINCT f.CA_Id) AS nbCaissesParam, MIN(f.CA_Id) AS caisseParam, COUNT(f.DP_Id) AS nbParam
  FROM L
  LEFT JOIN GOCOM.dbo.F_DEPOT d ON LTRIM(RTRIM(d.DE_Intitule)) COLLATE DATABASE_DEFAULT = L.depot COLLATE DATABASE_DEFAULT
  LEFT JOIN GOCOM.dbo.FG_DEPOTFACTURATION f ON f.DP_Id = d.cbMarq AND f.MR_Id = 1
  GROUP BY L.MV_Id, L.MV_Numero, L.CA_IdIn, L.depot),
S AS (
  SELECT *, CASE WHEN nbParam = 0 THEN 'DEPOT_NON_RETROUVE'
                 WHEN nbCaissesParam > 1 THEN 'PLUSIEURS_CAISSES'
                 WHEN CA_IdIn <> caisseParam THEN 'CAISSE_DIFFERENTE'
                 ELSE 'OK' END AS statut FROM R)
SELECT MV_Id, MV_Numero, depot, CA_IdIn AS caisse_du_reglement, caisseParam AS caisse_parametree, statut
FROM S WHERE statut <> 'OK'
UNION ALL
SELECT 0, 'SYNTHESE', 'NbReglementsControles=' + CAST(COUNT(*) AS varchar(10)) + ' NbOK=' + CAST(SUM(CASE WHEN statut = 'OK' THEN 1 ELSE 0 END) AS varchar(10)), NULL, NULL, NULL FROM S;
-- Une seule requête : lignes d'anomalie + ligne SYNTHESE toujours présente.
```
Si la base est multi-société, filtrer aussi sur `SO_Id` (règlement et caisse). Cette requête repose sur `EC_Info1` (même clé que le code) : elle ne détecte **pas** un `Info1` erroné. **Seconde requête, non circulaire** (à valider par l'implémenteur sur la base de test ; liens `RT_ECHEANCE` → pièce → dépôt = **HYPOTHÈSE**, voir `SQL_011` pour la jointure `F_DOCENTETE`) : pour les règlements du pilote, lister `EC_Info1`, le dépôt réel de la pièce (`F_DOCENTETE.DE_No` → `F_DEPOT`) et le `CA_Code` réel (`RT_CAISSE`) pour comparaison au tableau de vérité 9.2(a) ; la jointure de contrôle passe par `F_DOCENTETE.DE_No` → `F_DEPOT.cbMarq` → `FG_DEPOTFACTURATION`, indépendamment de `EC_Info1`. Un résultat « 0 anomalie » seul ne suffit jamais (voir 9.2(d)).

(En mode manuel avec écart assumé par l'utilisateur, `CAISSE_DIFFERENTE` est normal : ne contrôler que les lots lancés en automatique.)

### 9.4 Retour arrière
- **Fonctionnel** : choisir le mode manuel dans la liste déroulante (le défaut). Le mode automatique n'est jamais actif sans choix explicite.
- **Règlements créés par erreur, non comptabilisés** : chaque règlement créé par l'appli porte une affectation (`affectationRepo.Create`). `sql/suppression_reglement_espece.sql` le classe donc en `AFFECTE` et refuse de le supprimer tant qu'il est affecté. **Il faut exécuter les deux scripts dans cet ordre** :
  1. Sauvegarde de `GR_GOCOM` obligatoire.
  2. Dans les DEUX scripts, renseigner `@SocieteNo` (le défaut est 1, à vérifier), `@MvId` (ou la liste ciblée), `@DateDu = NULL` et `@DateAu = NULL`. Les bornes par défaut 20260101 / 20260731 portent sur `MV_Date`, qui est la date de FACTURE et non la date de création, et restent actives même avec `@MvId` : sans les mettre à NULL, l'aperçu peut afficher 0 ligne.
  3. `sql/desaffectation_reglement_espece.sql` : `@Apply = 0` (aperçu : nombre d'affectations, absence de blocage), puis `@Apply = 1`. Cela rétablit `EC_Solde` / `EC_SoldeDevise` de la facture et journalise dans `LOG_DESAFFECTATION_SQL`.
  4. `sql/suppression_reglement_espece.sql` : mêmes paramètres, `@Apply = 0` puis `@Apply = 1` (sauvegarde `BAK_MV_*` / `BAK_HM_*`, bloc UNDO).
  5. Contrôler que `EC_Solde`, `EC_Etat` et `EC_SoldeDevise` des factures sont revenus à leur valeur d'avant génération.
- **Message à transmettre au PO pour le pilote** : « les retirer en deux temps : d'abord `desaffectation_reglement_espece.sql`, puis `suppression_reglement_espece.sql`, dans les deux cas avec `@MvId` renseigné, `@DateDu` et `@DateAu` à NULL, en aperçu (`@Apply = 0`) puis en application (`@Apply = 1`), après sauvegarde de `GR_GOCOM` ».
- **Code** : redéploiement de la version précédente (aucune migration à défaire).
- L'implémenteur joue cette séquence complète sur la base de test (scénario 7 du § 8) avant toute mise en prod.

## 10. Hors périmètre
- Verrou serveur contre deux générations simultanées (proposition : `SemaphoreSlim(1,1)` statique, `Wait(0)` non bloquant, `Release` dans un `finally`, réponse 409 « Une génération est déjà en cours », message front adapté), découpage du lot / progression / annulation / timeout (lot HTTP synchrone) : **TASK distincte (TASK-117, RISK HIGH, à créer par l'architecte/PO, pas par l'implémenteur)** avant toute montée en charge au-delà de la pratique actuelle.
- Le déploiement de TASK-115 précède TASK-116 ; si TASK-115 n'est pas committée au moment du dépôt du VERIFY, le signaler explicitement dans le VERIFY.
- Création ou édition du paramétrage dépôt → caisse (il reste géré côté Sage/`FG_DEPOTFACTURATION`).
- Optimisation des autres coûts de la boucle (agrégats `VerifySolde`, numérotation, notifications) : TASK-116 bis éventuelle après mesure sur les logs de fin de lot.

## 11. Checklist VALIDATION (à copier dans VERIFY/ sous forme de tableau)

**Aucune case cochée sans preuve datée (méthode + date) ; une case non cochée documente pourquoi.** Format : `| Critère | Preuve attendue (fichier, capture, log, SQL) | Date AAAA-MM-JJ | Cas § 6 couvert |`.

- [ ] Base de test identifiée et consignée en tête du VERIFY (§ 7) ; TASK-115 : état du working tree/commit mentionné
- [ ] Build back OK (`dotnet build`) et compilation de `harness_task107` (ancienne signature) OK
- [ ] Build front OK (`npm run build`) — ne prouve pas le typage (`@ts-nocheck`), l'E2E le couvre
- [ ] Scénarios 1 à 7 du § 8 exécutés sur base de test, résultats et logs joints
- [ ] Requête de contrôle § 9.3 testée sur la base de test : `NbReglementsControles` = nombre de créées, aucune anomalie après lot automatique multi-caisses (preuve SQL jointe) ; cas `DEPOT_NON_RETROUVE` sorti en anomalie
- [ ] Pilote 1 facture par dépôt : tableau de vérité dépôt → caisse rempli par le métier, 0 écart (preuve jointe) — **avant tout lot > 100 factures**
- [ ] Autorisation par caisse prouvée en mode automatique (utilisateur non admin restreint)
- [ ] Statut « Ignorée » vérifié bout en bout (API + écran), ignorées non comptées en erreurs, factures conservées dans la liste et décochées ; lot 100 % ignoré : toast `warning`, pas de toast vert
- [ ] Log de fin de lot émis une seule fois par appel ; en auto avec ignorées, créées + ignorées + échecs = demandées ; les ignorées ne sont pas comptées dans échecs ; log de récapitulatif des ignorées par motif et par dépôt vérifié (extrait de log joint, date et méthode)
- [ ] Un seul chargement des tiers ERP sur un lot multi-caisses ; aucun `GetAll` en cas de non autorisé / caisse introuvable / mode Espèce refusé (manuel)
- [ ] Mode manuel inchangé (`harness_task107` 10/10 + `run_test114_via_api.ps1` rejoués)
- [ ] Préférence de colonnes ancienne : nouvelles colonnes visibles (E2E) ; `grep gocom_reglement_espece_columns` : l'ancienne clé n'apparaît qu'en lecture dans l'initialiseur ; cas 16b joué ; aucun `localStorage.setItem` sans `try/catch`
- [ ] Aucune requête SQL par facture pour la résolution (compte de requêtes joint, constant ≤ 3)
- [ ] Séquence de retour arrière (désaffectation puis suppression) jouée sur ≥ 2 règlements auto, soldes avant/après joints
- [ ] Aucune table créée / aucune écriture applicative sur les tables Sage (revue du diff) ; `sql/test/TASK116_jeu_donnees.sql` non déployé
- [ ] Aucun credential/secret en dur introduit
- [ ] `tasks/SCENARIOS_TASK-116.md` livré (format § 8) ; `MANUEL_UTILISATEUR.md` et `ARCHITECTURE.md` mis à jour (écart clé `_v2` justifié)
- [ ] Test unitaire de `ResoudreCaisse` (6 cas : vide, absente, ambigu, sommeil, casse/espaces, OK) si un projet de tests existe, sinon le signaler
- [ ] Confirmation PO consignée : `EC_Info1` jamais saisi à la main (§ 2.7) ; rappel de la consigne de non-relance (cas 19)
- [ ] Aucune dette technique silencieuse
- [ ] Cohérent avec l'architecture
- [ ] **Arrêt au dépôt du VERIFY** : aucune clôture, aucun commit « approuve » (§ 7)

## Historique de revue

- 2026-10-01 : revue adversariale (architecte), 50 constats traités (29 confirmés dont 2 bloquants : requête de contrôle § 9.3 et retour arrière § 9.4 ; 21 mineurs).
- Points majeurs : `ContexteGeneration` par référence et ordre des contrôles manuel ; try/catch par groupe et contrôle d'identité de caisse ; `caissesAttendues` (caisse confirmée = caisse utilisée) ; paramétrage indisponible sans casser la liste.
- Front : classement unique des factures (`classerFacture`), toasts indépendants de `success`, migration `localStorage` v2 complète, tri sur colonnes calculées, statut « Ignorée » en trois états.
- Exploitation : pilote 1 facture par dépôt avec tableau de vérité indépendant, retour arrière en deux scripts, consigne de non-relance (TASK-117 à créer pour le verrou).
- Restent à confirmer par le PO : pilote obligatoire (§ 9.2) et dépôt réel de la pièce (§ 4.1, hypothèses de schéma `F_DOCENTETE`).
