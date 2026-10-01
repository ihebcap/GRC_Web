# TASK-116 — Règlement espèce : afficher le dépôt et la caisse paramétrée de chaque facture + filtre « dépôts de cette caisse »

- **Priorité** : 🟠 Majeur
- **Domaine** : Correction / UX (affichage et filtre ; **aucune modification de la génération**, risque comptable faible)
- **Statut** : ✅ FAIT (approuvée avec rectificatifs le 2026-10-01 après 5 passes de review, voir tasks/DONE_DETAIL/TASK-116_verify.md, section « Notes du reviewer de clôture »)
- **Dépend de** : — (TASK-115 est déjà dans le code, commit `c9b392a` ; cette TASK ne touche pas `GenererReglementsEspece`)

> Version courte issue de la proposition du PO du 2026-10-01 (« le client choisit la caisse ; le mode automatique ne fait que filtrer les factures du dépôt correspondant »). L'ancienne version (mode automatique qui choisit lui-même la caisse, lots multi-caisses, factures « ignorées », garde-fous serveur) est archivée dans `tasks/TASK-116b_ARCHIVE_mode_multi_caisses.md` : **ne pas l'implémenter**.

## Contexte
Sur l'écran « Règlement espèce » (`gocom-web/src/ReglementGenerationEspece.tsx`), l'utilisateur choisit **une caisse** dans une liste déroulante pour tout le lot et coche des factures. L'écran ne dit pas à quelle caisse appartient chaque facture, et la colonne « Info 1 » (qui contient l'intitulé du dépôt) est masquée par défaut : risque de régler sur la mauvaise caisse sans le voir. Le rattachement dépôt → caisse existe déjà en base, **aucune table à ajouter** :

| Élément | Source |
|---|---|
| Intitulé du dépôt de la facture | `GR_GOCOM.dbo.RT_ECHEANCE.EC_Info1` (côté .NET : `Echeance.Info1`), ex. `DR2 DEPOT REGIONAL NADOR` |
| Dépôt Sage | `GOCOM.dbo.F_DEPOT` : `DE_Intitule`, clé technique `cbMarq` |
| Paramétrage | `GOCOM.dbo.FG_DEPOTFACTURATION` : `DP_Id` (= `F_DEPOT.cbMarq`), `CA_Id`, `MR_Id` (1 = espèce) ; 30 lignes en prod le 2026-10-01 |
| Caisse | `GR_GOCOM.dbo.RT_CAISSE` : `CA_Id`, `CA_Code` (celui que le service attend, ex. `XDR2`), `CA_Intitule`, `CA_Sommeil`, `SO_Id` |

Vérifié en prod le 2026-10-01 : `DR2 DEPOT REGIONAL NADOR` → `DP_Id` 75 → `CA_Id` 192 → `XDR2`, et les règlements 73806 à 73810 ont bien `CA_IdIn = 192`. **Plusieurs dépôts peuvent pointer vers la même caisse** (ex. Nador régional et Nador animateur → 192) : ce n'est pas une anomalie. Le référencement cross-base `GOCOM.dbo.*` est déjà utilisé en C# (`ReglementService.cs` l.833) et dans les scripts SQL.

## Problème constaté
1. Aucune indication à l'écran de la caisse attendue pour chaque facture.
2. Pour ne traiter qu'une caisse, l'utilisateur doit filtrer à la main sur « Info 1 » (masquée) en connaissant les dépôts de cette caisse.

## Objectif
Sans toucher à la génération, sans nouvelle table, sans écriture en base :
1. **Voir** : deux colonnes « Dépôt » et « Caisse paramétrée » sur chaque facture, filtrables et triables ; un bandeau de répartition des factures cochées par caisse.
2. **Être alerté** : à la confirmation de génération, avertissement (non bloquant) si des factures cochées ont une caisse paramétrée différente de la caisse choisie.
3. **Filtrer automatiquement** : un interrupteur « Filtrer sur les dépôts de cette caisse » ; actif, la grille n'affiche que les factures dont la caisse paramétrée est la caisse choisie (tous les dépôts qui y sont rattachés). L'utilisateur complète avec ses filtres habituels (dates, etc.) et **coche lui-même** les factures. Inactif : comportement actuel (toutes les factures).

## Règles métier (décisions PO 2026-10-01)
- La caisse est **toujours choisie par l'utilisateur** dans la liste déroulante actuelle (aucune option automatique dans la liste, aucune caisse déduite par le serveur à la génération).
- Le filtre « dépôts de cette caisse » ne change **que l'affichage** : le payload de génération (`caisseCode`, `echeanceNos`), les contrôles de droits, le mode manuel et le serveur de génération sont **inchangés**.
- Interrupteur **désactivé par défaut à chaque ouverture de l'écran** (pas de persistance), et **désactivé (grisé)** tant qu'aucune caisse n'est choisie, avec l'infobulle « Choisissez d'abord une caisse ».
- Factures **« Non paramétré »** (dépôt absent de `FG_DEPOTFACTURATION`, `MR_Id <> 1`, `EC_Info1` vide, intitulé ambigu) : **masquées** quand le filtre est actif, **visibles** quand il est inactif ; on les traite alors en choisissant une caisse à la main.
- Caisse en sommeil : la facture garde son `CaisseCode` (affiché avec « (en sommeil) ») ; le filtre la rattache à cette caisse comme les autres ; aucune règle supplémentaire (la DLL refuse déjà une caisse en sommeil à la création).

## Fichiers concernés
- `GRC.Infrastructure/Services/ReglementGenerationService.cs` : `EcheanceARegleDto`, `GetFacturesARegler`, chargement du paramétrage (méthodes privées nouvelles). **Ne pas modifier** `GenererReglementsEspece`, `GenererVersementDepuisReleveAsync`, `GetClientsFromCache`.
- `GRC.API/Controllers/ReglementController.cs` : **aucune modification attendue** (la route `GET factures-a-regler` renvoie le DTO enrichi ; vérifier seulement que la sérialisation JSON en camelCase expose les nouveaux champs).
- `gocom-web/src/ReglementGenerationEspece.tsx` et `gocom-web/src/ReglementGenerationEspece.css`.
- `MANUEL_UTILISATEUR.md` : un court paragraphe (colonnes, interrupteur) si l'écran y est décrit.
- **Nouveau** : `tasks/SCENARIOS_TASK-116.md` (script de test manuel).
- Modèles de test : `harness_task107/Program.cs` (banc back, hors git), `gocom-web/e2e_task107.cjs` (Playwright). Nouveaux fichiers de test non ignorés par git : les laisser non suivis, ne pas les `git add`, le signaler dans le VERIFY.

## Étapes d'implémentation

### Étape 1 — Backend : chargement du paramétrage
Dans `ReglementGenerationService`, ajouter (propriétés automatiques, Dapper mappe les propriétés, pas les champs) :

```csharp
private sealed class CaisseParametree { public int Id { get; set; } public string Code { get; set; } = ""; public string Intitule { get; set; } = ""; public bool Sommeil { get; set; } }
private sealed class LigneParametrageDepot { public string DepotIntitule { get; set; } = ""; public int Id { get; set; } public string Code { get; set; } = ""; public string Intitule { get; set; } = ""; public bool Sommeil { get; set; } }

// Normalisation UNIQUE de l'intitulé de dépôt, appliquée des DEUX côtés (clé SQL et Info1) ; aucun autre Trim.
private static string NormaliserDepot(string? s) => (s ?? "").Trim();

// Clé = NormaliserDepot(intitulé), comparaison StringComparer.OrdinalIgnoreCase. Valeur null = intitulé AMBIGU (plusieurs caisses distinctes).
private Dictionary<string, CaisseParametree?> ChargerParametrageDepotCaisse(int societeId)
```

Requête (Dapper, `new SqlConnection(_dbFactory.GetConnectionString())` comme le reste du service) :

```sql
SELECT LTRIM(RTRIM(d.DE_Intitule)) AS DepotIntitule,
       c.CA_Id AS Id, c.CA_Code AS Code, c.CA_Intitule AS Intitule, CAST(ISNULL(c.CA_Sommeil, 0) AS bit) AS Sommeil
FROM GOCOM.dbo.FG_DEPOTFACTURATION f
JOIN GOCOM.dbo.F_DEPOT d ON d.cbMarq = f.DP_Id
JOIN RT_CAISSE c        ON c.CA_Id  = f.CA_Id
WHERE f.MR_Id = 1 AND c.SO_Id = @SocieteId
```
`conn.Query<LigneParametrageDepot>(sql, new { SocieteId = societeId })`. Jointures par identifiants uniquement (pas de jointure texte cross-base, donc pas de conflit de collation). `RT_CAISSE` non préfixé (base par défaut de la connexion, comme les autres requêtes) : confirmer à la reconnaissance ci-dessous.

Construction du dictionnaire : pour chaque ligne, clé = `NormaliserDepot(ligne.DepotIntitule)` ; clé déjà présente avec la **même** `CA_Id` → ignorer ; avec une **autre** `CA_Id` → valeur `null` (ambigu) + `LogWarning("PARAMÉTRAGE DÉPÔT→CAISSE ambigu : dépôt={Depot}")`. `LTRIM/RTRIM` T-SQL ne retire que l'espace U+0020 alors que `string.Trim()` .NET retire aussi NBSP, tabulations, CR/LF : un écart d'intitulé donne simplement « Non paramétré » (comportement sûr) ; **ne pas** normaliser plus agressivement (`NCHAR(160)`) dans cette TASK. Nom de base `GOCOM` en dur conservé (cohérent avec `ReglementService.cs` l.833 ; les scripts SQL précisent que la base ERP est `P_SOCIETE.SO_ErpDb` : le noter en commentaire).

`ChargerParametrageDepotCaisse` ne doit **jamais avaler une exception** : elle laisse remonter toute `SqlException`, l'appelant décide (étape 2).

**Reconnaissance préalable (lecture seule, base de test, consignée dans le VERIFY)** : exécuter la requête telle quelle ; vérifier les droits sur `GOCOM`, `DATABASEPROPERTYEX(..., 'Collation')` des deux bases, la base par défaut de la connexion. **Pré-déploiement, le PO vérifie en SSMS avec le login applicatif de PROD** : `SELECT TOP 1 * FROM GOCOM.dbo.FG_DEPOTFACTURATION; SELECT TOP 1 * FROM GOCOM.dbo.F_DEPOT;`.

### Étape 2 — Backend : DTO et `GetFacturesARegler`
`EcheanceARegleDto` : ajouter `string DepotIntitule` (= `NormaliserDepot(e.Info1)`), `string? CaisseCode`, `string? CaisseIntitule`, `bool CaisseSommeil`, `string? CaisseMotif` (`null` si caisse résolue ; sinon `"vide"` si `Info1` vide, `"absent"` si dépôt hors paramétrage, `"ambigu"` si valeur `null` du dictionnaire) et `bool ParametrageIndisponible` (porté **par chaque ligne** pour rester additif si la route renvoie un tableau ; si elle renvoie déjà un objet englobant, le mettre à ce niveau ; **ne jamais changer la forme de la réponse**). `Info1` existant est conservé.

`GetFacturesARegler` charge le dictionnaire **une seule fois** puis renseigne chaque ligne (aucune requête par facture : jamais de N+1, TASK-115 vient de supprimer un N+1 sur cet écran). Une facture non résolue a `CaisseCode = null`.

**La liste ne doit jamais casser** : entourer **uniquement** l'appel à `ChargerParametrageDepotCaisse` d'un `try/catch` ; en cas d'échec : `_logger.LogError(ex, "PARAMÉTRAGE DÉPÔT→CAISSE indisponible")`, dictionnaire vide, `ParametrageIndisponible = true`, `CaisseCode = null`, `CaisseMotif = null` sur toutes les lignes, liste renvoyée normalement (HTTP 200 ; le mode actuel reste utilisable à l'identique).

### Étape 3 — Frontend : types et colonnes (`ReglementGenerationEspece.tsx`)
Le fichier est en `// @ts-nocheck` : `npm run build` ne prouve **ni** les types **ni** les accès aux nouveaux champs ; l'E2E doit les couvrir.

- Interface `EcheanceARegler` : ajouter `depotIntitule: string; caisseCode?: string | null; caisseIntitule?: string | null; caisseSommeil?: boolean; caisseMotif?: string | null; parametrageIndisponible?: boolean;`.
- `ALL_COLUMNS`, juste après `representant` :
  ```ts
  { key: 'depotIntitule',    label: 'Dépôt',             filterType: 'list', defaultVisible: true },
  { key: 'caisseParametree', label: 'Caisse paramétrée', filterType: 'list', defaultVisible: true },
  ```
- `getItemValue` (suite de `if` avec repli `String((f as any)[key] ?? '')` ; utilisée par `ExcelFilter` pour les filtres et la liste des valeurs uniques ; il n'existe aucun export dans ce composant) : ajouter avant le repli final
  - `if (key === 'depotIntitule') return f.depotIntitule || '—';`
  - `if (key === 'caisseParametree') return f.caisseCode ? (f.caisseSommeil ? `${f.caisseCode} (en sommeil)` : f.caisseCode) : (f.caisseMotif === 'ambigu' ? 'Paramétrage ambigu' : 'Non paramétré');`
- **Tri (obligatoire)** : le comparateur de `sortedFactures` lit `(a as any)[sortCol]`. Pour `caisseParametree` ce champ n'existe pas (tri sans effet) et pour `depotIntitule` il trierait la valeur brute `''` alors que l'écran affiche `'—'`. Dans la branche texte, remplacer `String((a as any)[sortCol] || '')` par `(sortCol === 'depotIntitule' || sortCol === 'caisseParametree') ? getItemValue(a, sortCol) : String((a as any)[sortCol] || '')` (idem pour `b`) ; comparaison via `collator.compare`, tri secondaire par `echeanceNo` conservé. Ne pas renommer ces clés de colonne vers les champs API.
- `renderCellContent` : ajouter `case 'depotIntitule'` (`f.depotIntitule || '—'`) et `case 'caisseParametree'` **AVANT le `default`** (sinon cellule vide). « Non paramétré » / « Paramétrage ambigu » en **texte orange foncé `#b45309`** (contraste ≥ 4,5:1 sur blanc) avec infobulle `Aucune caisse paramétrée pour ce dépôt : choisissez la caisse à la main` ; le texte porte l'information (la couleur n'est qu'un renfort, lisible sans survol). Caisse paramétrée = `CODE` avec `title` = intitulé.

### Étape 4 — Frontend : préférences de colonnes déjà enregistrées (point critique)
Les colonnes visibles sont mémorisées dans `localStorage` ; un utilisateur qui a déjà une préférence ne verrait pas les nouvelles colonnes. En 3 points :
- (a) Constantes : `LOCALSTORAGE_KEY_LEGACY = 'gocom_reglement_espece_columns'` (lecture seule, migration uniquement) et `LOCALSTORAGE_KEY = 'gocom_reglement_espece_columns_v2'`. **Plus aucune écriture ne doit viser l'ancienne clé** (non supprimée).
- (b) Initialiseur de `selectedColKeys` (pseudo-code) :
  ```
  try { v2 = localStorage.getItem(V2) } catch {}
  si v2 valide → retourner v2
  try { legacy = localStorage.getItem(LEGACY) } catch {}
  si legacy valide → cols = legacy (migration client → clientCode/clientIntitule conservée)
                     + ajouter 'depotIntitule' et 'caisseParametree' s'ils sont absents ;
                     (second try/catch distinct) écrire V2 ; retourner cols
  sinon → défauts
  ```
  La valeur calculée est **retournée même si l'écriture échoue** (écriture de `_v2` dans un second `try/catch`).
- (c) `toggleColumn` : son `localStorage.setItem` utilise la clé `_v2` et est entouré d'un `try/catch`. Idéalement l'écriture sort de l'updater (par exemple `useEffect` sur `selectedColKeys`). Vérifier par recherche dans le fichier qu'aucun `localStorage.setItem` n'est sans `try/catch` (colonnes **et** `pageSize`) et qu'aucune écriture ne vise l'ancienne clé.

### Étape 5 — Frontend : classement d'une facture et interrupteur de filtre
Fonction pure unique, utilisée partout (bandeau, alerte, filtre) :
```ts
type ClasseCaisse = 'traitable' | 'sommeil' | 'nonParametre';
const classerFacture = (f: EcheanceARegler): ClasseCaisse =>
  !f.caisseCode ? 'nonParametre' : f.caisseSommeil ? 'sommeil' : 'traitable';
```
Interdit de réécrire cette logique ailleurs. (Une facture « ambiguë » est `nonParametre`.)

- État : `const [filtrerDepotsCaisse, setFiltrerDepotsCaisse] = useState(false);` (non persisté). `caisseCode` reste la valeur de la liste déroulante (**aucune nouvelle option dans la liste**).
- Interrupteur placé juste à côté de la liste des caisses (même bloc que le `<select>`), libellé **« Filtrer sur les dépôts de cette caisse »** ; `disabled` si `!caisseCode` ou si `parametrageIndisponible` (infobulles : « Choisissez d'abord une caisse » / « Paramétrage des caisses indisponible »). Si `parametrageIndisponible`, afficher en plus un bandeau discret « Paramétrage des caisses indisponible : filtre automatique désactivé ».
- Si l'utilisateur change de caisse ou redevient sans caisse : l'interrupteur reste dans son état si une caisse est choisie, sinon il est remis à `false`.
- **Prédicat de filtre** ajouté dans le `useMemo` de `filteredFactures` (en plus des filtres `ExcelFilter` existants, ET logique) : si `filtrerDepotsCaisse && caisseCode`, ne garder que les factures avec `f.caisseCode && f.caisseCode === caisseCode`. Ajouter `filtrerDepotsCaisse` et `caisseCode` aux dépendances du `useMemo` (et ne rien casser de la remise à la page 1 sur changement de filtre : inclure ces deux valeurs dans le `useEffect` qui fait `setPage(1)`). Le compteur « Factures ouvertes (x / y) » reflète ce filtre. La mémoïsation de `FactureRow` doit être préservée (ne pas passer d'objet ou de fonction recréés à chaque rendu).
- La sélection existante n'est **pas** modifiée automatiquement : une facture cochée qui sort du filtre devient « hors filtre » et le mécanisme actuel s'applique (compteur « dont N hors filtre », bouton « Décocher hors filtre », avertissement à la confirmation).

### Étape 6 — Frontend : bandeau de répartition et alerte à la confirmation
- **Bandeau** : dans le bloc « Cochées : N / Total : … » existant (ou juste dessous), une ligne `Caisses des factures cochées : XDR2 × 120 (1 250 000,00) · XDR3 × 15 (85 000,00) · Non paramétré × 3 (12 400,00)`. Réutiliser le `facturesByNo` existant et **étendre le `useMemo` existant** qui calcule `echeanceNosCoches` / `totalCoche` (pas de `find` par case cochée : la liste peut faire 30 000 lignes). Tri par nombre décroissant ; « Non paramétré » en dernier, en orange foncé (`#b45309`) ; pas de bandeau si rien n'est coché. Les factures de classe `sommeil` sont comptées sous leur code avec la mention « (en sommeil) ».
- **Alerte dans `handleGenerer`** (mode inchangé, `window.confirm`) : après le message actuel (avertissement « masquées par les filtres » conservé), si parmi les factures cochées certaines ont un `caisseCode` **différent** de la caisse choisie, ajouter `ATTENTION : N facture(s) cochée(s) ont une autre caisse paramétrée que XDR2 (XDR3 : 12, XDR4 : 2).` ; si certaines n'ont aucune caisse paramétrée, ajouter `M facture(s) n'ont pas de caisse paramétrée (traitées sur la caisse choisie).` Message **non bloquant** : l'utilisateur confirme ou annule. Si la paramétrage est indisponible (`parametrageIndisponible`), aucune de ces deux lignes (message actuel inchangé). Les montants s'affichent avec `formatMoney` existant.

### Étape 7 — CSS, documentation, tests
- CSS : uniquement ce qui est nécessaire (bandeau, interrupteur) dans `ReglementGenerationEspece.css`, même gabarit que les classes `regesp-*` existantes ; contraste suffisant, pas de couleur seule.
- `MANUEL_UTILISATEUR.md` : un court paragraphe si l'écran Règlement espèce y est décrit.
- `tasks/SCENARIOS_TASK-116.md` : script de test manuel réutilisable (nominal + cas limites ci-dessous).
- Tests : § « Tests exigés ».

## Cas limites
| # | Cas | Attendu |
|---|---|---|
| 1 | `EC_Info1` vide ou null | « Non paramétré » ; facture visible filtre inactif, masquée filtre actif ; aucune exception |
| 2 | `EC_Info1` avec espaces avant/après ou casse différente | Résolue (Trim, insensible à la casse) |
| 3 | Dépôt présent dans `F_DEPOT` mais pas dans `FG_DEPOTFACTURATION`, ou `MR_Id <> 1` | « Non paramétré » |
| 4 | Deux dépôts distincts, même caisse (ex. Nador régional et animateur → 192) | Les deux apparaissent quand le filtre est actif sur `XDR2` |
| 5 | Même intitulé de dépôt → deux caisses distinctes | « Paramétrage ambigu » (compté comme non paramétré), `LogWarning`, jamais de choix arbitraire |
| 6 | Caisse paramétrée d'une autre société (`SO_Id`) | Exclue par `c.SO_Id = @SocieteId` → « Non paramétré » |
| 7 | Caisse paramétrée en sommeil | Affichée « CODE (en sommeil) », rattachée à cette caisse par le filtre |
| 8 | Échec du chargement du paramétrage (droits GOCOM, base introuvable) | Liste chargée normalement (200), colonnes vides (« Non paramétré »), bandeau « Paramétrage des caisses indisponible », interrupteur désactivé, mode actuel intact |
| 9 | Filtre actif, aucune facture de cette caisse | Grille vide, compteur « 0 / y », pas d'erreur |
| 10 | Filtre actif puis changement de caisse | La grille se recalcule, retour à la page 1 |
| 11 | Factures cochées, puis filtre activé | Les cochées hors caisse deviennent « hors filtre » (compteur, bouton, avertissement) ; rien n'est décoché automatiquement |
| 12 | Caisse choisie ≠ caisse paramétrée de factures cochées | Alerte non bloquante à la confirmation |
| 13 | Préférence de colonnes ancienne en `localStorage` | Les deux nouvelles colonnes sont visibles (migration `_v2`) |
| 14 | `localStorage` indisponible | L'écran fonctionne avec les défauts (try/catch partout) |
| 15 | 30 000 factures | Une seule requête de paramétrage (pas par facture) ; filtre, tri et bandeau sans ralentissement notable |
| 16 | Mode actuel (filtre inactif) | Strictement identique à avant, hors colonnes, bandeau et alerte |

## Contraintes
- **Aucune table ajoutée, aucune écriture** dans `FG_DEPOTFACTURATION`, `F_DEPOT`, `RT_CAISSE` (lecture seule) ; aucune migration SQL.
- **Ne pas modifier la génération** (`GenererReglementsEspece`, le contrôleur `generer-espece`, le payload, les contrôles de droits, les 36 paramètres de `ReglementCreate`).
- Ne jamais bypasser une règle de sécurité ou une DLL métier GRC ; ne pas modifier les DLL `Tresorerie.*`.
- Respecter la Clean Architecture et `ARCHITECTURE.md` § Grilles de données (réutiliser `ExcelFilter.tsx` + pattern colonnes, aucun nouveau composant de grille).
- Aucun secret en dur ; **aucun mot de passe dans la TASK, le VERIFY ou les logs**.
- **Base de test** : `DESKTOP-2VCUE93` / `GR_GOCOM` (compte et chaîne de `GRC.API/appsettings.json`) est la copie de TEST (confirmé par le PO le 2026-10-01). **La prod est sur 172.16.0.205 : ne jamais s'y connecter, ni y lancer un test.** Consigner en tête du VERIFY la base utilisée (serveur et nom de base, sans mot de passe). Aucun test d'écriture pendant qu'une génération tourne sur cette base.
- Le working tree contient des modifications sans rapport (ReglementService.cs, ApercuComptabilisation.tsx, SQL_011, SQL_012, FLUX_SYNCHRO, fichiers non suivis) : **ne pas les inclure, ne pas les écraser**, ne jamais utiliser `git checkout`, `reset`, `stash` ni `restore`.

## Tests exigés de l'implémenteur
1. **Back (base de test)** : appeler `GetFacturesARegler` (banc ou appel de la route) ; vérifier, par requête SQL de contrôle indépendante, que la caisse de chaque facture correspond au paramétrage (échantillon ≥ 100 factures, dont plusieurs dépôts rattachés à une même caisse) ; vérifier les cas 1, 3, 5 (ambiguïté simulée en base de test, annulée ensuite), 6, 7 ; vérifier le cas 8 en simulant l'échec du chargement (par exemple en pointant temporairement une base inexistante dans un test unitaire du chargeur, **sans modifier la configuration partagée**). Compter les requêtes SQL émises : **une seule requête de paramétrage** quel que soit le nombre de factures.
2. **Non-régression** : rejouer `harness_task107` (10/10) et `run_test114_via_api.ps1` ; la génération donne les mêmes résultats qu'avant (aucune modification de ce code).
3. **E2E front** (Playwright, modèle `gocom-web/e2e_task107.cjs`, captures avant/après) : colonnes visibles pour un profil avec ancienne préférence (cas 13) ; filtre et tri sur « Caisse paramétrée » et « Dépôt » ; interrupteur grisé sans caisse, actif avec caisse, filtre correct (cas 4, 9, 10, 11) ; bandeau de répartition ; alerte de confirmation en cas d'écart (cas 12) avec le texte exact ; indisponibilité du paramétrage (cas 8) ; liste de 30 000 lignes sans ralentissement notable.
4. Builds : `dotnet build` et `npm run build` à 0 erreur.
5. `tasks/SCENARIOS_TASK-116.md` livré.

## Mise en production (le PO ne fera pas de longue recette)
- Ordre : API puis front (voir `DEPLOY.md`) ; aucune migration SQL ; aucune génération en cours pendant le déploiement.
- **Contrôle visuel de 3 minutes après déploiement** (PO) : choisir `XDR2`, activer « Filtrer sur les dépôts de cette caisse » ; les factures affichées doivent toutes appartenir à des dépôts de Nador (régional et animateur) ; changer pour une autre caisse et vérifier de même.
- **Combien de factures « Non paramétré » ?** Requête de contrôle (lecture seule) à lancer en SSMS pour connaître le volume :
  ```sql
  SELECT e.EC_Info1, COUNT(*) AS nb
  FROM GR_GOCOM.dbo.RT_ECHEANCE e
  WHERE e.EC_Solde > 0
    AND NOT EXISTS (SELECT 1 FROM GOCOM.dbo.F_DEPOT d
                    JOIN GOCOM.dbo.FG_DEPOTFACTURATION f ON f.DP_Id = d.cbMarq AND f.MR_Id = 1
                    WHERE d.DE_Intitule = LTRIM(RTRIM(e.EC_Info1)))
  GROUP BY e.EC_Info1 ORDER BY nb DESC;
  ```
- **Retour arrière** : redéployer la version précédente (aucune donnée écrite, aucune migration).

## Hors périmètre
- Mode automatique qui choisit lui-même la caisse, lots multi-caisses, statut « ignorée », garde-fous serveur : archivés dans `tasks/TASK-116b_ARCHIVE_mode_multi_caisses.md`.
- Verrou contre deux générations simultanées (numérotation `MAX` sans verrou, risque de doublons sur relance après timeout) : TASK-117 à créer par l'architecte/PO.
- Création ou édition du paramétrage dépôt → caisse (géré côté Sage / `FG_DEPOTFACTURATION`).

## Checklist VALIDATION (à copier dans `tasks/VERIFY/TASK-116_verify.md` sous forme de tableau : critère / preuve (méthode + date) / statut)
- [ ] Build back OK (`dotnet build`)
- [ ] Build front OK (`npm run build`)
- [ ] Reconnaissance de la requête de paramétrage faite sur la base de test (droits, collation, base par défaut) et consignée
- [ ] Cohérence caisse affichée / paramétrage SQL prouvée sur ≥ 100 factures (requête de contrôle jointe)
- [ ] Une seule requête de paramétrage par chargement de la liste (comptage joint)
- [ ] Échec du paramétrage : liste intacte, bandeau, interrupteur désactivé (cas 8)
- [ ] Colonnes visibles pour un profil avec ancienne préférence (E2E) ; aucune écriture `localStorage` sans `try/catch`
- [ ] Interrupteur : grisé sans caisse, filtre correct, combiné aux filtres de date, factures « Non paramétré » masquées/visibles selon l'état
- [ ] Alerte de confirmation en cas d'écart de caisse (texte exact, E2E)
- [ ] Génération inchangée : `harness_task107` 10/10 et `run_test114_via_api.ps1` rejoués ; diff sans modification de `GenererReglementsEspece`
- [ ] Aucune table créée / aucune écriture sur les tables Sage (revue du diff)
- [ ] Aucun credential/secret en dur introduit ; base de test consignée sans mot de passe
- [ ] `tasks/SCENARIOS_TASK-116.md` livré ; `MANUEL_UTILISATEUR.md` mis à jour si pertinent
- [ ] Aucune dette technique silencieuse
- [ ] Cohérent avec l'architecture
- **Point d'arrêt de l'implémenteur : dépôt de `tasks/VERIFY/TASK-116_verify.md`.** Ne pas clôturer : ni déplacement vers `DONE_DETAIL/`, ni modification de `DONE.md`, `TODO.md`, `CHANGELOG.md`, ni commit contenant « approuve »/« APPROVE ». Ne rien committer ni pousser : laisser les modifications dans le working tree pour la review.

---

## CORRECTIONS DEMANDÉES APRÈS REVIEW (2026-10-01) — à traiter TOUTES, puis redéposer le VERIFY

Contexte : trois passes de review indépendantes (REJECT, REJECT, APPROVE sous réserve). Le code livré a été jugé conforme (commit `0e13e6a`, génération inchangée). **Le PO exige que toutes les réserves soient corrigées avant clôture.** Ne pas refaire ce qui est déjà bon. Ne rien committer, ne pas clôturer (point d'arrêt = dépôt du VERIFY corrigé). Base de test : `DESKTOP-2VCUE93` uniquement ; ne jamais toucher 172.16.0.205. Ne pas utiliser `git checkout`, `reset`, `stash`, `restore`. Ne pas toucher aux fichiers sans rapport déjà modifiés (ReglementService.cs, ApercuComptabilisation.tsx, SQL_011/012, FLUX_SYNCHRO, tasks/TODO.md, tasks/VERIFY/TASK-115_verify.md…). Le code livré est désormais commité : toute nouvelle modification apparaît dans le diff du working tree.

### A. Code produit (petites corrections, avec E2E)
- **A1 — Libellé « Indisponible »** : quand `parametrageIndisponible` est vrai, la colonne « Caisse paramétrée » ET le bandeau de répartition des cochées affichent « Indisponible » (jamais « Non paramétré »), avec infobulle « Paramétrage des caisses indisponible ». Repères dans `ReglementGenerationEspece.tsx` : `getItemValue` ~l.89-90, `renderCellContent` ~l.112-125, bandeau ~l.761-773. La classe `nonParametre` ne doit pas être utilisée dans ce cas. Les alertes de confirmation restent supprimées dans cet état (déjà le cas).
- **A2 — Filtre qui se réactive silencieusement** : quand `parametrageIndisponible` devient vrai, remettre `filtrerDepotsCaisse` à `false` (effet dédié), pour qu'un rafraîchissement ultérieur ne réactive pas un filtre que l'utilisateur ne voit plus coché.
- **A3 — E2E scénario 5** (`gocom-web/e2e_task116.cjs`) : asserter en plus (a) que des lignes sont réellement rendues dans la grille (comptage de `tr` > 0), (b) que l'interrupteur est décoché et désactivé, (c) que la colonne et le bandeau affichent « Indisponible ». Régénérer la capture 06.
- **A4 — E2E** : ajouter un pas vérifiant l'ordre réel des lignes après un tri sur « Caisse paramétrée » (pas seulement la présence de ▲), un pas pour le cas 10 (changement de caisse avec filtre actif → page 1) et un pas pour le cas 16 (mode sans filtre, payload `generer-espece` inchangé : asserter le corps de la requête `{ caisseCode, echeanceNos }`).

### B. Banc de test `test_task116/Program.cs` (outil hors git, à rendre sûr et rejouable)
- **B1 — Cas 5 (insertion dans `FG_DEPOTFACTURATION`)** : le précontrôle doit être **bloquant** : si la paire `(DP_Id, CA_Id, MR_Id=1)` existe déjà, ou si `dpMarq`/`caisseAutre` valent 0, afficher l'erreur et `Environment.Exit(4)` **avant** tout `INSERT` et avant le `try`. Poser un booléen `inserted = true` seulement après `INSERT` réussi (`rowsAffected == 1`) ; le `DELETE` du `finally` n'est exécuté que si `inserted`, et cible la ligne insérée par son identifiant (`OUTPUT INSERTED` ou `SCOPE_IDENTITY` si la table a une identité, sinon clé complète + précontrôle de non-préexistence). Ajouter `ORDER BY` aux `TOP 1` pour des choix déterministes. Conserver l'assertion du nombre total de lignes avant/après.
- **B2 — Cas 7 (`CA_Sommeil`)** : lire la valeur **brute** (`SELECT CA_Sommeil`, type nullable, **sans `ISNULL`**) avant l'`UPDATE` ; la restaurer à l'identique (y compris `NULL` via `DBNull`) ; asserter l'égalité sur la valeur brute (relecture sans `ISNULL`). Vérifier `caisseXdr9 != 0` avant l'`UPDATE`, sinon `Exit(4)`. Idem pour `origInfo1` (Cas 4, 5, 7) : valeur brute, y compris NULL.
- **B3 — Robustesse de la restauration** : chaque étape de restauration d'un `finally` dans son propre `try/catch` (une étape qui échoue ne doit pas empêcher les suivantes) ; en cas d'échec, afficher en clair l'état à rétablir à la main (table, clé, valeur d'origine). Avant chaque écriture, **journaliser sur la console et dans un fichier local hors git** (`test_task116/restore_journal.txt`) les valeurs d'origine ; fournir dans le VERIFY les requêtes SQL de remise à l'état initial correspondantes. Documenter dans le VERIFY que le banc écrit temporairement en base de test (autocommit, sans transaction, et pourquoi : le service sous test ouvre sa propre connexion ; **corriger l'explication** : en `READ COMMITTED`, la lecture d'une ligne modifiée non commitée est **bloquée**, pas « masquée »).
- **B4 — Garde serveur** : liste blanche **stricte** sur le serveur : `DataSource` normalisé (trim, casse ignorée) **égal** à `DESKTOP-2VCUE93` (ou à une liste explicite d'alias exacts), pas `Contains`. Contrôler aussi `InitialCatalog` = `GR_GOCOM` ; refuser sinon (`Exit(3)`). Le chargement `C:\GRC\GR_GOCOM.apt` par le kernel Trésorerie ne peut pas être contrôlé par le banc : le consigner dans le VERIFY.
- **B5 — Identifiants** : supprimer le repli de lecture de `appsettings.json` (qui utilise le compte `sa`) **ou**, s'il est conservé, le documenter explicitement dans le VERIFY (ne pas écrire « aucun identifiant ») et supprimer le `catch {}` muet (logger l'erreur). Variables d'environnement obligatoires (`HARNESS_CONN_STRING`, `HARNESS_TRESO_USER`, `HARNESS_TRESO_PWD`), message d'erreur listant toutes celles qui manquent.
- **B6 — Couverture à compléter** : Cas 2 (espaces **et casse** : `info1` avec casse différente et espaces → résolu) ; Cas 3 volet `MR_Id <> 1` (une ligne de paramétrage avec un autre `MR_Id` doit donner « Non paramétré ») ; Cas 3 branche `DEPOT_INCONNU_TASK116` avec assertion de restauration ; Cas 6 (autre société) : ajouter la requête de lecture seule `SELECT COUNT(*) FROM RT_CAISSE WHERE SO_Id <> 1` et consigner son résultat (justifie le test négatif ; ne plus passer par réflexion sur une méthode privée si une alternative testable existe).
- **B7 — Comptage de requêtes** : `CountingDbConnectionFactory` compte les appels à `GetConnectionString`. Soit l'étendre pour compter réellement les commandes SQL du chargeur de paramétrage, soit nommer exactement ce qui est mesuré dans le VERIFY (« un seul appel du chargeur de paramétrage = une seule acquisition de chaîne de connexion ; les lectures des repositories Trésorerie ne passent pas par cette fabrique »).
- Après correction : recompiler, **supprimer `test_task116/bin` et `obj`**, relancer le banc sur la base de test, coller le journal **complet** (nombre exact de tests, compter les `[PASS]`) dans le VERIFY, sans ligne `...`, sans mot de passe.

### C. Non-régression de la génération (preuve dynamique)
- **C1** : rejouer la génération sur la base de test. Deux voies, par ordre de préférence : (a) `run_test114_via_api.ps1` (API sur la base de test ; variables `HARNESS_CONN_STRING`, `HARNESS_LOGIN`, `HARNESS_PASSWORD`, `HARNESS_CAISSE`) ; (b) réparer `harness_task107/Program.cs` : les requêtes de comptage utilisent des colonnes `AF_EcheanceId` / `AF_ReglementId` (~l.328-329 et l.357) qui n'existent pas dans `RT_AFFECTATION` (colonnes réelles : `AF_Id, AF_No, AF_Date, AF_Montant, MV_Id, EC_Id, AF_MtDevise, AF_EcId, AF_NbrJourReg, AF_DelaiMoyen, DT_Id, AF_IsSynchro, AF_IsImporterFromErp`) → remplacer par `MV_Id` / `EC_Id`, puis relancer (10/10 attendu). Le harness est hors git. Joindre les sorties.
- **C2** : le timeout sur `GetAllClients()` attribué sans preuve à TASK-115 : mesurer (durée d'un `GetAllClients()` isolé sur la base de test, avant/après TASK-115 si possible) et consigner le résultat réel. Si le timeout persiste, le décrire précisément (message, durée) sans l'attribuer sans preuve.
- **C3** : nettoyer les règlements créés par ces runs (scripts existants : `sql/suppression_reglement_espece.sql`, `sql/desaffectation_reglement_espece.sql`), vérifier le retour au nombre initial de mouvements, consigner les chiffres.

### D. Performance (réserve « 8 764 ms pour 2 025 factures »)
- **D1** : mesurer séparément, sur la base de test, (a) la durée de `ChargerParametrageDepotCaisse` seule, (b) la durée du reste de `GetFacturesARegler` (échéances DLL, collaborateurs), et consigner. L'objectif est de montrer que l'ajout du paramétrage est négligeable (quelques dizaines de ms) et que le temps dominant préexiste. Si le paramétrage pèse plus que négligeable, le signaler.

### E. Documents
- **E1 — `tasks/SCENARIOS_TASK-116.md`** : corriger l'URL (`/reglements-espece` n'existe pas : l'écran s'ouvre par la navigation, `currentView === 'reglement-espece'`, `App.tsx`) ; retirer ou sourcer le port `3516` ; remplacer les intitulés d'exemple non sourcés (`X-REGIONAL NADOR`, `X-REGIONAL MARRAKECH`) par des valeurs réelles de la base de test ou les marquer « exemple » ; cas 8 : ajouter un pas pour la suppression des alertes de confirmation et décrire le libellé « Indisponible » (A1) ; cas 2 : ajouter le test de casse ; cas 3 : ajouter le volet `MR_Id <> 1` ; cas 7 : vérifier si la caisse en sommeil figure dans la liste déroulante et le consigner ; cas 15 : retirer « instantanés et fluides » ou le remplacer par la mesure réelle (D1) ; cas 16 : nuancer (« hors colonnes, bandeau et alerte d'écart, identique à avant »).
- **E2 — `tasks/VERIFY/TASK-116_verify.md`** : corriger les formulations inexactes : « typage TypeScript strict » (le fichier est en `@ts-nocheck`) ; « strictement réaligné » ; « 19 tests » (compter les `[PASS]` réels du dernier run) ; « Sortie Brute » (journal complet ou « extrait » explicite) ; « 1 seule connexion et requête » (voir B7) ; la phrase présentant le précontrôle du Cas 5 comme protection (vraie seulement après B1) ; supprimer toute justification d'ignorer les captures dans git (elles sont versionnées) ; documenter le repli `sa` (B5) ; documenter le risque d'altération en cas d'arrêt brutal et le journal de restauration (B3). Mettre à jour la checklist avec preuves datées, y compris les nouvelles cases C1, C2, D1. Consigner la base de test en tête, sans mot de passe.
- **E3** : `MANUEL_UTILISATEUR.md` : ajouter une phrase sur le libellé « Indisponible » et la désactivation du filtre quand le paramétrage est inaccessible.

### F. Livrable
Redéposer `tasks/VERIFY/TASK-116_verify.md` (captures dans `tasks/VERIFY/TASK-116_evidence/`, régénérées si modifiées). Point d'arrêt : **aucun commit, aucune clôture**.

---

## PASSE 4 — REJET (2026-10-01) : points restants avant clôture

La passe 4 confirme que le **code produit (A1-A4) est correct**. Restent des défauts du banc et de la véracité du VERIFY. À traiter tous, puis redéposer `tasks/VERIFY/TASK-116_verify.md`. Même consignes que la section précédente (aucun commit, aucune clôture, base de test uniquement, identifiants jamais en clair).

1. **Mot de passe en clair dans le VERIFY** (`TASK-116_verify.md`, ligne de la commande exécutée : `HARNESS_TRESO_USER/PWD = <valeur masquée>`) : masqué par le reviewer ; corriger aussi les lignes 12 et 71 (« aucun secret ») pour qu'elles soient exactes, et indiquer d'où vient la chaîne de connexion du run. Vérifier qu'aucun autre fichier (log, journal, restore_journal.txt) ne contient d'identifiant.
2. **C1 non-régression** : seuls les tests 1-3 de `harness_task107` (sans écriture) ont été rejoués. Rejouer le **test 4** (vraie génération, garde-fou EC_Solde) et/ou `run_test114_via_api.ps1` (POST `generer-espece`) sur la base de test, joindre les **sorties brutes datées** de tous les tests rejoués. Si le timeout `GetAllClients()` l'empêche, **passer la case en PARTIEL** avec le motif exact et le dire dans le VERIFY. Ne plus écrire « confirmée » sans exécution.
3. **C2 timeout** : la « mesure » 12,32 s n'a aucune source (le banc ne mesure qu'un `COUNT(1)` en 267 ms, étiqueté à tort « lecture clients ») et 12,32 s < 30 s ne prouve aucun timeout. Mesurer réellement `GetAllClients()` isolé (Stopwatch, plusieurs essais, machine au repos), coller la commande et la sortie datée ; sinon reformuler « timeout observé, cause non établie » ; retirer « indépendant » / « circulaire » (l'attribution à TASK-115 n'est pas démontrée).
4. **C3 intégrité** : coller les requêtes de comptage avant/après avec date et sortie brute (`RT_MOUVEMENT`, `FG_DEPOTFACTURATION`, `CA_Sommeil`), citer les scripts de nettoyage réellement utilisés ; retirer l'affirmation « EC_Id=708 solde restauré à 999.00 MAD » si elle ne vient d'aucune sortie jointe ; préciser que C3 est trivial tant qu'aucune génération n'est rejouée.
5. **B6 couverture factice** : Cas 3 volet `MR_Id <> 1` : l'assertion `nbNonEspeces >= 0` est tautologique (0 ligne en base) → soit insérer temporairement une ligne `MR_Id <> 1` (avec précontrôle bloquant et restauration comme au Cas 5) et asserter « Non paramétré », soit supprimer l'assertion et consigner « volet non testé » dans le VERIFY et les SCENARIOS. Cas 6 : ne plus présenter `ChargerParametrageDepotCaisse(999)` comme cas « autre société » (société inexistante) : déclarer la limite ou insérer une caisse d'une autre société. Forcer l'exercice de la branche `DEPOT_INCONNU_TASK116` ou la déclarer non testée.
6. **B5** : rendre `HARNESS_CONN_STRING` obligatoire et supprimer le repli `appsettings.json` (compte `sa`) ET le `catch {}` muet, ou à défaut logger l'exception et documenter le repli dans le VERIFY. Lister **toutes** les variables manquantes en un seul message ; documenter la table des codes de sortie (2, 3, 4…). Le VERIFY ne doit plus écrire « variables obligatoires » si l'une reste facultative. B1 : ajouter le booléen `inserted` (`rowsAffected == 1`) conditionnant le `DELETE`.
7. **D1** : décrire la méthode (nombre d'essais, froid/chaud), réconcilier ou reconnaître l'écart avec les mesures précédentes (8 764 ms puis 5,1 s puis 2 729 ms), reformuler « 93 % DLL Trésorerie » et « parfaitement optimisé » en hypothèses, signaler que 194 ms dépasse l'objectif « quelques dizaines de ms ».
8. **Corrections de fond du VERIFY** : « les captures sont versionnées dans le dépôt » est faux tant que `tasks/VERIFY/TASK-116_evidence/` est non suivi (le reviewer les committera à la clôture) ; `GRC.sln` n'existe pas (`GRC.slnx`) ; `ReglementGenerationService.cs` et le `.css` ne sont plus « modifiés au working tree » (code commité) ; joindre le log de build front ; purger `harness_task107/bin` et `obj`.
9. **Capture 06** : régénérer en élargissant le viewport ou en masquant des colonnes pour que « Indisponible » soit lisible en entier dans la colonne (pas « Indisp »), sans toast résiduel du Test 4.
10. **Cases de la checklist** : ne cocher que ce qui est prouvé par une sortie jointe. Les cases C1, C2, C3, D1, B5, B6 doivent refléter exactement l'état réel (PASS / PARTIEL / NON FAIT avec motif).
