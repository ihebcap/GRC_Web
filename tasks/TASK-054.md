# TASK-054 — Import des règlements clients depuis un fichier Excel

## ⛔ RETIRÉE (décision PO, 2026-07-16) — remplacée par TASK-059 + TASK-060

**Cette tâche n'est plus développée.** Le besoin qu'elle couvrait (créer des règlements clients sans
passer par le WinForm) est désormais **entièrement pris en charge par les écrans de génération**
TASK-059 (règlement espèce avec affectation) et TASK-060 (règlement versement depuis relevé bancaire) —
plus adaptés à l'usage réel qu'un import de fichier. **Aucun import Excel ne sera construit.**

Le reste de ce document est **conservé à titre d'archive d'analyse**, pas comme spécification à
implémenter — il documente des découvertes IL réutilisées ailleurs :
- Le **bloquant d'autorisation** (`HasRestriction` évalue l'utilisateur technique du kernel, pas le JWT)
  et sa solution (`HasEntityActionRestriction` pré-contrôlé) — **appliqué tel quel dans TASK-059/060**.
- Le **mapping complet des 36 paramètres** de `CaisseManager.ReglementCreate` — **dumpé ici** et
  réutilisé comme référence par TASK-059/060.
- Le **finding `isComptabilise=true` forcé par `ImporterReglements`** — la raison structurelle pour
  laquelle un import via ce mécanisme DLL natif aurait été impropre de toute façon (règlements importés
  jamais réellement comptabilisés), indépendamment du choix produit de remplacer l'import par des écrans.

Ne pas rouvrir cette tâche sans un nouveau besoin PO explicite de bulk-import — dans ce cas, repartir du
mapping des 36 paramètres ci-dessous plutôt que de refaire l'analyse.

- **Priorité** : — (retirée)
- **Domaine** : Backend (API + Infrastructure) + Front (écran liste des règlements)
- **Dépend de** : —

## ⛔ Section suivante obsolète, conservée uniquement à titre d'historique de décision

**Ce qui suit décrivait une étape intermédiaire (« requalification » vers un appel direct à
`ReglementCreate`, toujours sous forme d'import Excel) qui a elle-même été abandonnée** par la décision
finale de retrait ci-dessus (2026-07-16, confirmation PO explicite) : plus aucun import Excel — fichier
ou non — n'est développé pour ce besoin, qui est intégralement couvert par TASK-059/060.

**Ne pas exécuter les « Étapes d'implémentation », ne pas créer les fichiers listés dans « Fichiers
concernés », ne pas cocher la « Checklist VALIDATION » ci-dessous — ce ne sont plus des instructions de
build, seulement une trace de ce qui avait été envisagé avant le retrait définitif.** Seuls les
findings IL (mapping 36 paramètres, blocage autorisations, `isComptabilise=true`) restent valides et sont
réutilisés tels quels par TASK-059/060.

## Objectif

Permettre à un utilisateur d'importer des règlements clients en **déposant un fichier Excel** depuis l'écran liste des règlements, **sans passer par l'application WinForm**, en réutilisant le moteur d'import métier de la DLL et **en respectant les autorisations de caisse de l'utilisateur connecté**.

## Contexte — analyse des DLL (Mono.Cecil / IL, 2026-07-15)

### Le moteur d'import existe et est réutilisable

`Tresorerie.UICommun.Components.ReglementClientImportService`, derrière `IReglementClientImportService` (`libs/Tresorerie/Tresorerie.UICommun.dll`) :

```
int ImporterReglements(string source)                        ← cible de cette tâche
int ImporterReglementsCoffre(string source, int soucheNo)     ← variante avec souche, hors périmètre
```

`source` = **chemin d'un fichier sur disque**. Retour = **nombre de lignes importées**.

Flux réel de `ImporterReglements`, tracé intégralement en IL :

1. `IGroupeService.SocieteManager.Societe` + `DeviseViewHelper.GetSocieteDevise(societe)` → `ApplicationException("Devise société invalide!")` si absente.
2. `IReglementTiersImportRepository.GetAll(source)` → `IEnumerable<ReglementTiersImport>`.
3. **`Verify(...)` sur la totalité des lignes** — avant toute création (voir « Comportement de Verify » ci-dessous).
4. Boucle par ligne : `TiersErpHelper.Get(...)` → `IAuthorizationService.HasRestriction(new ReglementImporter(), type, caisseNo)` → `HasRestriction(new EcheanceImporterSolde(), type, caisseNo)` → **`SocieteManager.ReglementClientCoffreCreate(...)`** → `CaisseManager.SetSynchroniserReglementClient(...)`.

> Note : `ImporterReglements` (variante *sans* souche) appelle bien `ReglementClientCoffreCreate` — c'est le point d'entrée de création commun aux deux variantes. Ce n'est pas une erreur d'analyse : ne pas chercher une autre méthode « non-coffre », elle n'existe pas.

### `UICommun` est nécessaire, et ce n'est pas un problème

La création en base est dans `Tresorerie.Core` (déjà référencé par `GRC.Infrastructure`), mais **`Verify()` et la résolution des codes** (`TiersErpHelper`, `DeviseViewHelper`, `BanqueViewHelper`) sont dans `UICommun`. S'en passer = réécrire des contrôles métier GRC → **interdit par les règles projet**.

Vérifié : **aucun** de ces types ne dépend de WinForms ni de DevExpress (leurs champs/signatures ne référencent que `Core`, `Erp.ICore`, `Authorization.Core`). `UICommun` est un assembly fourre-tout mal nommé ; le chargement paresseux du .NET ne devrait donc rien tirer de DevExpress. **À confirmer au runtime en tout début de dev** (cf. Risques).

### ⚠️ BLOQUANT DE CONCEPTION — les autorisations de caisse de la DLL ne protègent PAS l'utilisateur web

C'est le point central de cette tâche. Chaîne tracée en IL :

```
AuthorizationService.HasRestriction(fonctionnalite, ProfilType, int? caisseNo)   → void, LÈVE si restreint
  └─ IGroupeService.SocieteManager.Utilisateur          ← utilisateur COURANT DU KERNEL
       └─ si Utilisateur.IsAdmin  → court-circuit, aucune restriction appliquée
  └─ caisses = (caisseNo == null) ? Societe.GetCaisses() : [ Societe.GetCaisse(caisseNo) ]
  └─ IAuthorizationRepository.HasEntityActionRestriction(userNo, entity, actionGuid, caisses, type) → bool
```

Or, dans GRC_WEB :

- Le kernel est authentifié **une seule fois au démarrage**, avec un **utilisateur technique** (`Tresorerie:UserGR`) — [TresorerieGroupInitializerService.cs:48](../GRC.Infrastructure/Tresorerie/TresorerieGroupInitializerService.cs#L48). `SocieteManager.Utilisateur` est donc un **état singleton de process**.
- Le login web est **totalement séparé** : `/api/auth/login` valide contre `P_UTILISATEUR`, lit les caisses dans `P_UTILISATEURCAISSE` et place `UserId` / `Caisses` / `IsAdmin` dans le JWT — [Program.cs:130-164](../GRC.API/Program.cs#L130-L164).
- `SocieteManager.set_Utilisateur` est **non public** → impossible de basculer l'utilisateur courant par requête (et le faire par réflexion serait de toute façon inacceptable : état partagé de process, API multi-utilisateurs concurrents).

**Conséquence : si on appelle `ImporterReglements` tel quel depuis l'API, `HasRestriction` évalue les droits de l'utilisateur technique `UserGR`, pas ceux de l'utilisateur connecté. Si `UserGR` est admin, TOUTES les restrictions de caisse sont silencieusement contournées.** L'exigence PO « garder les autorisations des caisses utilisateur » serait violée sans aucun message d'erreur.

**Solution retenue (obligatoire, cf. Étapes)** : pré-contrôler chaque ligne côté GRC_WEB en appelant **la règle de la DLL elle-même**, mais paramétrée avec le bon utilisateur :

```
IAuthorizationRepository.HasEntityActionRestriction(userNo, entity, actionGuid, caisses, type) : bool
```

Cette méthode (dans `Tresorerie.Authorization.Core`, **pas** dans `UICommun`) prend le `userNo` **explicitement**. On l'appelle avec le `UserId` du JWT et l'action `ReglementImporter`. **Ce n'est pas un bypass** : c'est le même repository, le même SQL et la même règle que ceux qu'exécute `AuthorizationService` — simplement avec l'utilisateur réel au lieu de l'utilisateur technique. Le `HasRestriction` interne de la DLL continue de s'exécuter derrière, en seconde barrière.

### 🚧 NOUVEAU BLOQUANT (2026-07-16, découvert en analysant TASK-059/060) — `isComptabilise=true` forcé, aucune écriture comptable réelle générée

Dump IL exhaustif de `ImporterReglements` → `ReglementClientCoffreCreate` (36 paramètres de
`CaisseManager.ReglementCreate`, capturés en totalité) : `ImporterReglements` appelle
`ReglementClientCoffreCreate(..., isComptabilise: true, ...)` — **littéral `ldc.i4.1`, pas dérivé du
fichier importé, pas conditionnel**. Dans `ReglementClientCoffreCreate` :

```
IL_00c1: ldarg.s isComptabilise
IL_00c3: brfalse.s IL_00d8
IL_00c5: ldloc.1                          // le ReglementClient créé
IL_00c6: ldc.i4.1                         // EtatComptabilite.Comptabilise (confirmé : enum = 1)
IL_00c7: callvirt ReglementClient::ChangeEtatComptabilise(EtatComptabilite)
IL_00cc: ldarg.0
IL_00cd: ldfld IReglementClientRepository::_reglementClientRepository
IL_00d2: ldloc.1
IL_00d3: callvirt IReglementClientRepository::Update(ReglementClient)
```

`ChangeEtatComptabilise` ne fait que `set_IsComptabilise(EtatComptabilite)` — **aucun appel à
`Comptabiliser`/`Generate`, aucune écriture `F_ECRITUREC` créée**. Conséquence : **tout règlement
importé via `ImporterReglements` est marqué comptabilisé en base dès sa création, sans qu'aucune
écriture comptable réelle ne soit jamais générée**, et sans erreur ni avertissement. Il disparaît
silencieusement du filtre « non comptabilisé » d'`ApercuComptabilisation` (TASK-045) pour toujours.

**⚠️ Décision PO requise avant tout code** — deux lectures possibles :
1. Usage prévu de cette API (règlements dont la comptabilisation est gérée par un autre canal) → à
   documenter explicitement comme le cas d'usage réel de l'import Excel.
2. Pas l'intention (règlements à comptabiliser normalement, via `ApercuComptabilisation`, après import)
   → `ImporterReglements`/`ImporterReglementsCoffre` sont **la mauvaise méthode DLL** pour ce besoin ;
   la tâche devrait alors, comme TASK-059/060, appeler `CaisseManager.ReglementCreate` directement avec
   `isComptabilise=false`, en répliquant manuellement les contrôles de `Verify()` (même mécanisme,
   cf. TASK-059).

Rien n'est encore codé sur cette tâche — aucune perte, mais **ne pas commencer le développement avant
que ce point soit tranché**.

### Comportement de `Verify()` — impact UX direct sur l'objectif

`Verify()` **lève une `ApplicationException` à la PREMIÈRE erreur rencontrée** : aucune agrégation (ni `StringBuilder`, ni liste d'erreurs — vérifié en IL). Messages, tous suffixés du n° d'enregistrement :

- `Le numéro est obligatoire! Enregistrement N[{0}]`
- `Le code client est obligatoire!` / `Code client invalide!`
- `Code caisse invalide!` / `Caisse invalide!`
- `Le mode règlement est obligatoire!` / `Mode règlement invalide!`
- `Caisse [{0}] n'accepte pas le mode règlement [{1}]! Enregistrement N[{2}]`
- `Devise invalide!` / `Format montant invalide!` / `Montant invalide!` / `Format cours invalide!`

Un fichier avec 20 erreurs ⇒ **20 allers-retours** pour l'utilisateur. C'est frontalement contraire à l'objectif « faciliter l'import » → d'où le pré-contrôle agrégé demandé en étape 4.

**Point rassurant** : `Verify()` s'exécute sur **toutes** les lignes **avant** la boucle de création. Une erreur de validation ⇒ **rien n'est créé**. Le risque d'import partiel ne concerne que les échecs *pendant* la création (voir Risques).

### Format de fichier attendu

`ReglementTiersCsvRepository` (seule implémentation de `IReglementTiersImportRepository`) lit du **CSV** via CsvHelper. Le mapping `ReglementTiersImportMap` reconnaît ces en-têtes (tolérant casse/accents) :

| Obligatoire (imposé par `Verify`) | Optionnel |
|---|---|
| `NUMERO`, `CLIENT` (ou `TIERS`), `MODE`, `CAISSE`, `MONTANT` (ou `SOLDE`), `DATE` | `LIBELLE`, `PIECE`, `ECHEANCE`, `DEVISE`, `COURS`, `TIRE`, `PAYEUR`, `BANQUE`, `BANQUECLIENT`, `BANQUETIERS`, `MABANQUE`, `PLAFOND`, `CERTIFIE`, `DATEVALIDITE`, `REFERENCE`, `SYNCHRONISER` |

`IReglementTiersImportRepository` n'a **qu'une seule méthode** (`GetAll(string source)`) → on branche notre propre lecteur Excel derrière, sans toucher au reste.

## ⛔⛔ NE PAS IMPLÉMENTER — sections ci-dessous archivées, tâche retirée (voir bandeau en tête de fichier)

Les sections « Fichiers concernés », « Étapes d'implémentation », « Contraintes », « Risques » et
« Checklist VALIDATION » ci-dessous décrivaient une étape intermédiaire, **abandonnée** par le retrait
définitif de la tâche (décision PO 2026-07-16). **Aucun de ces fichiers ne doit être créé, aucune de ces
étapes ne doit être exécutée.** Le besoin est couvert par TASK-059 (règlement espèce) et TASK-060
(règlement versement) — se référer à ces deux tâches pour tout développement actif. Contenu conservé
uniquement pour ne pas perdre la trace de l'analyse.

## Fichiers concernés (archive — ne pas implémenter)

- `GRC.Infrastructure/Tresorerie/ExcelReglementReader.cs` — **nouveau**, lecteur `.xlsx` → liste de DTO
  en mémoire (mêmes colonnes que le tableau « Format de fichier attendu » ci-dessous, pour rester
  cohérent avec le vocabulaire déjà documenté). **N'implémente plus `IReglementTiersImportRepository`**
  — ce n'est plus une interface de la DLL à satisfaire, juste un parseur maison.
- `GRC.Infrastructure/Services/ReglementGenerationService.cs` — **partagé avec TASK-059/060** : méthode
  dédiée pour ce flux, boucle par ligne du fichier → résolution client/caisse/mode (réplication manuelle
  de `Verify()`) → appel direct `CaisseManager.ReglementCreate` (mapping des 36 paramètres, cf. TASK-059).
- `GRC.Infrastructure/Tresorerie/TresorerieNinjectKernel.cs` — bindings manuels **réduits** : `TiersErpHelper`,
  `DeviseViewHelper` → `ToSelf()` (toujours dans `UICommun`, toujours nécessaires pour la résolution
  manuelle). **Plus besoin** de `IReglementClientImportService`/`ReglementClientImportService`/
  `IReglementTiersImportRepository` — ces types ne sont plus appelés du tout par cette tâche.
- `GRC.API/Controllers/ReglementController.cs` — nouvel endpoint `[HttpPost("import-excel")]` (upload multipart).
- `gocom-web/src/` — composant d'upload + restitution du résultat, dans l'écran liste des règlements.

## Étapes d'implémentation

1. **Valider le chargement de `UICommun` — EN PREMIER, avant tout autre dev.** Périmètre **réduit** par
   la requalification : seuls `TiersErpHelper`/`DeviseViewHelper` (résolution client/devise) sont
   nécessaires, plus `IReglementClientImportService`/`ReglementClientImportService`. Vérifier qu'aucune
   `FileNotFoundException` / conflit d'assembly ne survient **sur `dotnet publish`, pas sur `bin`**
   (leçon TASK-041/043). Si ça casse ici, toute la tâche est à réévaluer.
2. **Bindings IoC manuels** dans `TresorerieNinjectKernel` : `TiersErpHelper`, `DeviseViewHelper` →
   `ToSelf()` uniquement. Vérifier que `IAuthorizationService`/`IAuthorizationRepository` sont
   résolvables (modules `Authorization` chargés) — inchangé.
3. **Lecteur Excel** : `ExcelReglementReader` lit le `.xlsx` en mémoire et produit une liste de lignes,
   avec **les mêmes noms de colonnes que documentés** dans « Format de fichier attendu » ci-dessous (pas
   de raison de changer le vocabulaire déjà connu du PO/utilisateur, même si le format CSV natif de la
   DLL n'est plus le pivot).
4. **Pré-contrôle agrégé, AVANT toute création** — inchangé dans son principe, désormais **notre seul
   contrôle** puisque `Verify()` n'est plus appelé du tout (à répliquer manuellement, cf. TASK-059) :
   - **Droits de caisse (exigence PO, bloquant)** : pour chaque caisse distincte du fichier,
     `IAuthorizationRepository.HasEntityActionRestriction(jwtUserId, entity, ReglementImporter.Guid, caisses, type)`.
     Toute ligne sur une caisse non autorisée ⇒ **refus**, avec le n° de ligne et le code caisse.
   - **Contrôles de format** (colonnes manquantes, montant/date/cours non parsables) + **contrôles
     métier de `Verify()` répliqués** (client/caisse/mode résolvables, `Caisse.HasModeReglement`,
     montant > 0) : les **agréger tous** et les remonter en une seule réponse.
   - Si le pré-contrôle échoue ⇒ **ne créer aucun règlement**, retourner la liste complète des erreurs.
5. **Aucun fichier temporaire sur disque nécessaire** : l'upload est lu directement en mémoire par
   `ExcelReglementReader` (plus de `source` = chemin disque à satisfaire, puisqu'on n'appelle plus
   `ImporterReglements`).
6. **Boucle de création** : pour chaque ligne validée → appel direct `CaisseManager.ReglementCreate`
   (mapping des 36 paramètres identique à TASK-059, `isComptabilise` non positionné puisqu'absent de
   `ReglementCreate` lui-même — le règlement suit le flux normal de comptabilisation).
7. **Endpoint** : upload multipart, extraction `SocieteId`/`UserId`/`Caisses` du JWT selon le pattern
   existant ([ReglementController.cs:57-58](../GRC.API/Controllers/ReglementController.cs#L57-L58)).
   Retour structuré `{ success, nbImportes, erreurs[] }` par ligne (plus de valeur de retour DLL à
   relayer, on compte nous-mêmes les créations réussies).
8. **Front** : dépôt de fichier + affichage du résultat. En cas d'erreurs, **lister toutes les lignes
   fautives** (n° de ligne + message), pas seulement la première.

## Contraintes

- **Ne pas réécrire la logique de `ReglementCreate`** — appel direct, pas de réimplémentation. Les
  contrôles que `Verify()` assurait gratuitement (client/caisse/mode/montant) sont **répliqués
  manuellement**, pas réinventés différemment — même règle, même source (`TiersErpHelper`,
  `Societe.GetCaisse`, `Caisse.HasModeReglement`).
- **Ne pas contourner les autorisations** : le pré-contrôle utilise la méthode de la DLL (`HasEntityActionRestriction`) avec l'utilisateur du JWT. Ne jamais réécrire la requête SQL d'autorisation en dur. **C'est désormais la seule barrière** (plus de second contrôle natif via `ReglementClientCoffreCreate`, bypassé).
- **Ne pas réactiver le module `Tresorerie.IoC.UICommun`** en bloc.
- **Ne pas modifier `SocieteManager.Utilisateur` par réflexion** — état singleton partagé, API concurrente.
- **Ne pas dévier du mapping des 36 paramètres** `ReglementCreate` documenté dans TASK-059 sans nouvelle vérification IL.
- Aucun `UPDATE` SQL brut sur les tables pilotées par la DLL. Aucun secret ni chemin en dur.
- Respecter la Clean Architecture (Domain ← Application ← Infrastructure/API).

## Risques / dépendances

- **Chargement de `UICommun`** — risque réduit mais pas nul : seuls `TiersErpHelper`/`DeviseViewHelper`
  y sont désormais nécessaires (plus toute la chaîne `ReglementClientImportService`). Analyse statique
  rassurante (aucune dépendance DevExpress/WinForms sur ces deux types), mais c'est le terrain des
  régressions TASK-041/043. **Mitigation : étape 1 en premier, test sur `dotnet publish`.**
- **Import partiel** : pas de `TransactionScope` DLL englobant (on appelle `ReglementCreate` ligne par
  ligne nous-mêmes) → un échec en cours de boucle laisse les lignes précédentes créées. Ne **pas**
  ajouter de `TransactionScope` englobant sans validation explicite : sur 2 bases, ça bascule en MSDTC
  (cf. `compta-msdtc-lab-2machines`). **Mitigation retenue** : remonter le détail par ligne à l'utilisateur.
- **`Utilisateur.IsAdmin` du kernel** : si `Tresorerie:UserGR` est admin, la barrière interne de la DLL
  (celle que `ReglementCreate`/`ReglementCreateInterne` peut encore porter en interne) est inopérante —
  le pré-contrôle de l'étape 4 devient **la seule** protection réelle. Raison pour laquelle il est
  bloquant et non « nice to have ».
- **Conflit de version sur la lib de lecture Excel** : NPOI est déjà présent dans `libs/Tresorerie/` (`NPOI.Core.dll`, `NPOI.OOXML.dll`). **Ajouter un NuGet NPOI d'une autre version recréerait exactement le conflit Serilog 4.2 vs 2.10** (cf. `serilog-tresorerie-dll-conflit`). Réutiliser les DLL de `libs/Tresorerie/`, ou choisir une lib sans homonyme.
- **Contrôle plafond/certification Maroc de `Verify()`** (même risque que TASK-059) — perdu par le bypass, à vérifier si le mode utilisé le déclenche avant de considérer ce point clos.

## Checklist VALIDATION (archive — sans objet, tâche retirée, ne pas produire de VERIFY pour ce fichier)

- [x] **Décision PO tracée sur `isComptabilise=true`** (2026-07-16) — superseded : la tâche n'est plus requalifiée en appel direct `ReglementCreate`, elle est **retirée** (voir bandeau en tête de fichier)
- [ ] Build back + front OK (0 erreur)
- [ ] Module `Tresorerie.IoC.UICommun` toujours exclu du kernel (non requis par ce flux requalifié — `UICommun`/`ReglementClientImportService`/`ImporterReglements` ne sont plus appelés)
- [ ] **Import d'une ligne sur une caisse NON autorisée à l'utilisateur connecté → refusée, avec n° de ligne et code caisse** (test réel, avec un utilisateur non-admin restreint)
- [ ] **Le refus ci-dessus fonctionne même si `Tresorerie:UserGR` est admin** (c'est le cas nominal du bloquant identifié — à tester explicitement, pas à supposer)
- [ ] Fichier `.xlsx` valide → règlements créés en base (un `ReglementCreate` par ligne), `nbImportes` correct, visibles dans la liste des règlements, **non comptabilisés** (suivent le flux normal `ApercuComptabilisation`/`Comptabiliser`)
- [ ] Fichier avec plusieurs erreurs de format → **toutes** les erreurs remontées en une fois (pré-contrôle manuel), **aucun** règlement créé
- [ ] Fichier avec une erreur métier (ex. mode non accepté par la caisse) → message remonté avec le n° d'enregistrement, aucun règlement créé pour cette ligne, les autres lignes valides traitées
- [ ] Fichier temporaire supprimé après l'import (y compris en cas d'exception)
- [ ] Aucun chemin/secret en dur ; aucun SQL brut sur les tables pilotées par la DLL
- [ ] Aucune régression sur la comptabilisation (TASK-048) ni le lettrage (TASK-050)
- [ ] Mapping des 36 paramètres `ReglementCreate` conforme à celui dumpé pour TASK-059/060 (aucune déviation non revérifiée en IL)
