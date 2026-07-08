# CHANGELOG — Rapprochement Bancaire

## 2026-07-08 — Validation rapprochement : dates du règlement sur la date opération du relevé (TASK-034)

### Métier / justesse comptable
- À la validation d'une paire, les dates du règlement client sont désormais calées sur la **date opération** de la ligne relevé (`RAPP_ReleveBancaire_Ligne.DateOperation`) **au lieu de la date valeur** :
  - **date rapprochement** (`DatePointage`) : toujours posée (marqueur, non comptable) ;
  - **date règlement** (`MV_Date`, via `ChangeDate`) : **uniquement si `MV_Compta = 0`** ;
  - **date échéance** (`MV_DateEcheance`) : **nouveau**, **uniquement si `MV_Compta = 0`**.
- Un règlement **comptabilisé** conserve `MV_Date` **et** `MV_DateEcheance` d'origine ; seule `MV_DatePointage` est mise à jour. La garde comptable est étendue à l'échéance.

### Architecture / sûreté
- **Source lue côté serveur** : `DateOperation` récupérée dans `RAPP_ReleveBancaire_Ligne` par `ReleveLigneId`, en réutilisant la requête de re-check de réservation ([ReleveBancaireRepository.cs:274](../GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs#L274)) — plus aucune date de rapprochement issue du payload client. Champ `DateOperation` ajouté à `ValidationPairDto` (rempli serveur) ; le front n'a pas changé.
- Ordre `reg.ChangeDate(...)` **avant** `reg.IsPointe = true` conservé (invariant TASK-031). Écriture via DLL `repo.Update` uniquement ; le seul SQL est un `SELECT` sur la table applicative `RAPP_ReleveBancaire_Ligne`.
- **Hors périmètre** (inchangé) : flux `POST /api/rapprochement` (`RapprocherManuel`), rapprochement manuel sans relevé.

### Revue
- Validé après **test réel du PO** (« testé et ça marche »). Point de vigilance persistance `MV_DateEcheance` levé au cadrage : le comportement observé confirme l'écriture attendue via `repo.Update`.

## 2026-07-08 — Validation rapprochement : n° pièce + date règlement alignés (TASK-031)

### Métier / justesse comptable
- À la validation d'une paire, le règlement client reçoit désormais aussi **`MV_Piece = MV_ExtraitNum`** (= `CodeExcel`) **sans garde de type** (retrait du `if reg.Type == 3`) et **`MV_Date = DateValeur`** — cette dernière **uniquement si le règlement n'est pas comptabilisé** (`MV_Compta = 0`). Un règlement comptabilisé conserve sa `MV_Date` d'origine (cœur de la sécurité comptable).
- Remplace le **job SQL WinForm de rattrapage** (`UPDATE m SET MV_Piece = MV_ExtraitNum … WHERE mv_type=3 …`) : plus aucun rattrapage manuel après validation web.
- Écriture exclusivement via la DLL `Tresorerie` (`repo.Update`), aucun `UPDATE` SQL brut sur `rt_mouvement`.

### Correction (1er passage REJETÉ)
- **Bug bloquant corrigé** : `reg.ChangeDate(...)` était appelé **après** `reg.IsPointe = true`. Or `ChangeDate` lève `InvalidOperationException` (« Le règlement a subi un rapprochement bancaire ! ») dès que le règlement est pointé → **toutes** les paires non comptabilisées partaient en échec (Succès: 0). Ordre corrigé : `ChangeDate` appelé **avant** `IsPointe = true` (setter `reg.Date` privé → méthode métier `ChangeDate`).
- `ChangeDate` peut légitimement lever pour un règlement annulé/remis/affecté/remplacé : ces paires partent en échec propre via le `try/catch` existant — comportement métier attendu.

### Revue
- Validé après test réel d'une paire non comptabilisée qui passe (SuccessCount++) : `MV_Piece`/`MV_Date` alignés, `ChangeDate` appelé avec `IsPointe` encore `false`. Bloc `UPDATE RAPP_ReleveBancaire_Ligne SET DateValidation` (TASK-022) inchangé.

## 2026-07-07 — Compte administrateur : accès à tous les règlements (TASK-032)

### Droits / périmètre de données
- Un compte **administrateur** (`P_UTILISATEUR.UT_Admin = 1`) voit désormais **tous les règlements**, sans restriction de caisse — au lieu des seules caisses qui lui sont affectées (`P_UTILISATEURCAISSE`).
- Le login remonte le statut : `SELECT UT_Admin` → claim JWT **`IsAdmin`** + champ `isAdmin` dans la réponse. Front : badge **ADMIN** et label « Toutes caisses », sélecteurs de caisses proposant l'intégralité des caisses.

### Architecture / sûreté
- **Bypass décidé côté serveur uniquement** : le claim `IsAdmin` (issu de la base au login) pilote le périmètre ; le front n'a qu'un affichage cosmétique, aucun flag admin n'est accepté depuis le client.
- Résolution en Infrastructure (`ReglementService`) : si admin, `caissesList` est réécrit par `SELECT CA_Id FROM RT_CAISSE WHERE SO_Id = @SocieteId` (scope société). Appliqué à `GetReglements`, `GetDistinctReglements`, et `/api/reference/modes` (cohérence des filtres). **Lecture seule stricte** (que des `SELECT`), aucune écriture, DLL métier non contournée.
- Le **chunking >20 caisses** existant absorbe les 213 caisses (pas d'erreur SQL 8003). Non-admins : chemin strictement inchangé.
- **Périmètre « toutes sociétés » différé** : base mono-société (GOCOM) ; l'admin voit déjà tout via toutes les caisses de la société. Agrégation multi-société à ouvrir si une 2ᵉ société est créée.
- Note déploiement : `PAYX` (login pré-rempli) a `UT_Admin=0` → non-admin. Le comportement admin se teste avec le compte `Admin` ; rendre `PAYX` admin serait un changement de **donnée** (`UPDATE`), hors code.

### Revue
- VERIFY conforme fourni. Validation prononcée sur **vérification directe du code** + **builds ré-exécutés** : API `dotnet build` = 0 erreur, front `tsc --noEmit` = 0 erreur.

## 2026-07-07 — Écran d'interrogation d'un relevé + affichage Débit/Crédit (TASK-027, TASK-028)

### UX / consultation de l'état d'un relevé
- L'état d'un relevé bancaire s'affiche désormais **Débit / Crédit** (deux colonnes alignées à droite, format bancaire) au lieu d'une colonne « Montant » unique ambiguë — chaque ligne ne renseigne que la colonne correspondant à son sens. (TASK-027)
- La **ligne dépliable** (child grid) est remplacée par un **écran séparé d'interrogation** : clic sur le nom du relevé → écran plein (`ReleveInterrogation`) avec en-tête relevé + bouton **Retour**. Cohérent avec le reste de l'appli. (TASK-028)
- Cet écran dispose des **filtres type Excel par colonne** (composant `ExcelFilter` réutilisé) : Date Op., Libellé, Débit, Crédit, Code, Statut, Réservé par, Règlement GRC. Compteur « N traitées · M non traitées » et filtre statut conservés.

### Architecture / sûreté
- **Backend** (TASK-027) : ajout de la seule propriété `Debit` à `LigneEtatRapprochementDto` ([ReleveBancaireRepository.cs:377](../GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs#L377)). Le SQL fait déjà `SELECT l.*` → hydratation Dapper automatique. **Aucune modification SQL ni de schéma**, `Debit`/`Credit`/`MontantReel` existant déjà en base.
- **Frontend** (TASK-028) : navigation par **état local** (`selectedReleve`), aligné sur le pattern `currentView` d'`App.tsx` — **aucune librairie de routing ni dépendance nouvelle**. `ExcelFilter` réutilisé tel quel ; mécanisme de filtrage repris du pattern `RapprochementBancaire` (état `filters` + `filteredLignes` memo). Child grid dépliable (`expandedReleveId`) supprimé.
- **Lecture seule stricte** : aucune action de rapprochement depuis cet écran.

> Note review : soumises en `Statut: DONE` **sans fichier VERIFY** conforme au template (checklists cochées dans les TASK). Validation prononcée sur **vérification directe du code** — `Debit` présent au DTO, interface front `debit`, colonnes Débit/Crédit ([RelevesBancaires.tsx:167-168](../gocom-web/src/RelevesBancaires.tsx#L167-L168)), composant `ReleveInterrogation` + `selectedReleve` + `ExcelFilter` par colonne, plus de `expandedReleveId`. Build non ré-exécuté dans cette revue. Rappel worker : fournir un VERIFY conforme.

## 2026-07-07 — Déroulant relevés de l'écran rapprochement : masquer les relevés soldés (TASK-026)

### UX / pertinence
- Sur l'écran de **rapprochement**, le déroulant « Relevé associé… » ne propose plus que les relevés ayant **encore au moins une ligne encaissement à rapprocher**. Un relevé dont toutes les lignes crédit sont validées disparaît du choix (filtrage d'affichage, aucune donnée supprimée).
- Critère « à rapprocher » = `DateValidation IS NULL` **et** `Credit > 0` : les lignes seulement **réservées** (non encore validées) comptent → le relevé reste listé tant qu'une réservation n'est pas finalisée (réservation ≠ rapprochement).

### Architecture / sûreté
- Endpoint `GET /api/relevebancaire?banqueId=` **partagé** avec l'écran « Gestion des Relevés Bancaires » (TASK-025). Le filtre est **opt-in** : nouveau paramètre `nonRapprochesSeulement` (défaut `false` → comportement inchangé). Le `EXISTS` est gardé par `@NonRapprochesSeulement = 0 OR EXISTS(...)`. Seul `RapprochementBancaire.tsx` passe `nonRapprochesSeulement=true` ; `RelevesBancaires.tsx` reste sans le flag et continue de lister **tous** les relevés → aucune régression de la consultation d'état.
- Lecture seule (SELECT), **aucune modification de schéma**, aucune DLL métier touchée. Méthode `GetEtatRapprochementAsync` (TASK-024) non impactée. Clean Architecture respectée (flag en paramètre, pas de SQL au front).

> Note review : soumis en `Statut: DONE` **sans fichier VERIFY** conforme au template. Validation prononcée sur **vérification directe du code** — `GetEntetesByBanqueAsync(int, bool=false)` + `EXISTS` gardé conformes ([ReleveBancaireRepository.cs:95](../GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs#L95)), `[FromQuery] bool nonRapprochesSeulement = false` sur `GetEntetes`, `nonRapprochesSeulement=true` côté rapprochement ([RapprochementBancaire.tsx:361](../gocom-web/src/RapprochementBancaire.tsx#L361)), `RelevesBancaires.tsx:184` sans flag. Build non ré-exécuté dans cette revue. Rappel worker : fournir un VERIFY conforme.

## 2026-07-07 — Consultation de l'état d'un relevé depuis « Gestion des Relevés Bancaires » (TASK-025)

### Fonctionnel / suivi
- Dans l'écran **« Gestion des Relevés Bancaires »** (`RelevesBancaires.tsx`), chaque relevé est désormais **cliquable** : un panneau accordéon s'ouvre sous la ligne et affiche l'état de rapprochement de **toutes** ses lignes (consomme `GET /api/relevebancaire/{id}/etat`, TASK-024).
- Par ligne : statut en badge (**Validé** / **Réservé** / **Non traité**), réservataire (nom + date) pour les lignes réservées, et le **règlement GRC** lié (numéro, date, **caisse en libellé**, client) pour les lignes traitées.
- **Filtre Traité / Non traité** + compteurs (« N traitées · M non traitées ») en tête du panneau — répond au besoin PO « savoir ce qui reste ».

### Architecture / sûreté
- **Lecture seule stricte** : aucun appel d'écriture (`reserve`/`release`/`validate`) depuis cet écran. Additif : import et liste des relevés inchangés.
- Libellé caisse résolu côté front via `/reference/caisses` (map indexée par `c.id` = `CA_Id`, alignée sur `App.tsx`) — cohérent avec la grille principale.

> Note review : soumis en `Statut: DONE` sans fichier VERIFY (aucun des deux passages n'a fourni de rapport conforme au template). **1er passage REJETÉ** — la map caisses était indexée par `c.no` (champ inexistant dans la réponse `/reference/caisses`), le libellé caisse ne s'affichait jamais. Corrigé (`c.id`). Validation prononcée sur vérification directe du code + **build front confirmé** (`tsc -b && vite build` OK, 0 erreur). Rappel worker : fournir un VERIFY conforme.

## 2026-07-07 — Endpoint « État de rapprochement d'un relevé » (TASK-024)

### Fonctionnel / suivi
- Nouvel endpoint **lecture seule** `GET /api/relevebancaire/{id}/etat` : renvoie **toutes** les lignes d'un relevé (validées comprises) avec un **statut** dérivé — `NonRapproche` / `Reserve` (rapprochée, en attente de validation) / `Valide` (pointée en GRC). Répond au besoin PO « savoir quelles lignes sont traitées et lesquelles ne le sont pas encore ».
- Pour chaque ligne réservée : nom du **réservataire** (jointure `P_UTILISATEUR`, réutilise TASK-023). Pour chaque ligne rapprochée : **détails du règlement GRC** lié (numéro, date, caisse, client), récupérés via la DLL `ReglementClientRepository.Get` — y compris pour les règlements déjà pointés.

### Architecture / sûreté
- Méthode **distincte** `GetEtatRapprochementAsync` : ne modifie **pas** `GetAllLignesExcelAsync` ni son filtre `DateValidation IS NULL` — l'espace de travail continue de masquer les lignes validées (TASK-022 intacte).
- **Lecture seule stricte** : aucune écriture (`Get` uniquement, jamais `Update`). Respect TASK-020 : SELECT Dapper fermé **avant** la boucle DLL, jamais deux connexions simultanées → aucune promotion MSDTC. Enrichissement en Infrastructure exposé via `LigneEtatRapprochementDto`. Clean Architecture respectée.
- Perf : `Get` par `MV_ID` distinct (N appels) — acceptable pour une consultation ; chargement groupé prévu en évolution si un relevé devient très volumineux (noté, non requis).
- Consommé côté front par TASK-025 (écran « Gestion des Relevés Bancaires »).

> Note review : le VERIFY soumis ne suivait pas le template (copie de la TASK avec cases cochées, sans BUILD/FICHIERS/DIFF). Validation prononcée sur **vérification directe du code** (conforme à la TASK) + **compilation confirmée** (les 6 erreurs de build observées sont des verrous de fichier `MSB302x` dus au process `GRC.API` en cours d'exécution, aucune erreur `CSxxxx`). Rappel worker : fournir un VERIFY conforme au template.

## 2026-07-07 — Marquage des lignes relevé validées / pushées en GRC (TASK-022)

### Métier / justesse de l'état de rapprochement
- Une ligne relevé réellement pointée en GRC (Phase 2 « Approuver ») ne **réapparaît plus** dans l'espace de travail. Symétrie rétablie avec l'exclusion `pointe=false` côté GRC (TASK-019) : après validation, la paire disparaît des **deux** grilles et ne revient pas au refresh.
- Nouvelle colonne `DateValidation DATETIME NULL` sur `RAPP_ReleveBancaire_Ligne` (marqueur + audit, cohérent avec `DateReservation`). `NULL` = en cours, renseignée = finalisée. (`SQL_003_TASK-022_ValidationLigne.sql`, avec backfill des lignes dont le règlement est déjà pointé)

### Pose du statut (Phase 2)
- `SauvegarderValidationAsync` collecte les `ReleveLigneId` **réellement pointés** puis, **après** la boucle DLL, marque en un seul `UPDATE … SET DateValidation = GETDATE() WHERE Id IN @Ids` sur une connexion ouverte après fermeture de la connexion DLL. Respect TASK-020 : pas de `TransactionScope`, jamais deux connexions simultanées, aucune promotion MSDTC. Une paire en **échec** DLL reste « en cours » (non marquée). L'échec éventuel de l'`UPDATE` groupé est remonté (pas d'état incohérent silencieux).

### Lecture / garde
- `GetAllLignesExcelAsync` filtre `DateValidation IS NULL` → exclut les lignes finalisées de la grille relevé **et** de l'auto-rapprochement (même méthode consommée par le contrôleur).
- `LibererLigneAsync` refuse une ligne finalisée (`AND DateValidation IS NULL`).
- `Lettrage`/`MV_ID` **conservés** à la validation (audit + garde d'unicité `NOT EXISTS(MV_ID)` de `reserve` intacte). Table applicative `RAPP_ReleveBancaire_Ligne` : `UPDATE` SQL direct autorisé, aucune écriture GRC hors pointage DLL. Clean Architecture respectée.

## 2026-07-07 — Éligibilité des règlements au rapprochement bancaire (TASK-021)

### Métier / justesse comptable
- Un règlement n'est **éligible au rapprochement bancaire** que s'il s'agit d'un **Virement** (`MV_Type=3`) ou d'un **Chèque/Traite remis en banque** (`MV_Type∈{1,2}` **et** `MV_Remis=2`). Espèce (`MV_Type=0`), « Autre » (`MV_Type=4`) et Chèque/Traite **non remis** (`MV_Remis≠2`) sont exclus. Ferme le cas des faux appariements espèce↔ligne bancaire (diagnostic terrain BCP, lignes C-F).
- Règle **définie une seule fois** dans `ReglementEligibilityHelper.EstEligibleRappBancaire` (couche Application) et appliquée aux **deux** points d'entrée pour éviter toute dérive :
  - auto-rapprochement `ReleveBancaireController.GenererPropositions` (filtre amont, avant `CalculerPropositions`) ;
  - grille GRC `ReglementService.GetReglements` (+ `GetDistinctReglements` pour les listes de filtres).
- `MV_Remis == 2` **strict** (remis en banque) — pas de retombée sur `> 0`. Le filtre d'affichage `isRemis` existant (`> 0`) est inchangé et distinct de la règle d'éligibilité.
- Lecture seule, aucune écriture base, **aucune modification des DLL `Tresorerie.*`** (filtrage post-`GetAll`). Clean Architecture respectée (helper en Application, consommé par Infrastructure/API). Build OK, 0 erreur.

## 2026-07-07 — Correction 500 sur `validate` : suppression de la promotion MSDTC (TASK-020)

### Métier / validation (Phase 2)
- `POST /ReleveBancaire/validate` ne plante plus en **500**. Cause : `SauvegarderValidationAsync` ouvrait deux connexions SQL (check réservation + connexion DLL) dans un même `TransactionScope`, provoquant une promotion en transaction distribuée **non supportée** par `System.Data.SqlClient` sous .NET 10.
- Suppression du `TransactionScope`. Le re-check de réservation (`ReservePar_UserId`) se fait désormais en une passe sur une connexion **fermée avant** la boucle de pointage DLL — jamais deux connexions ouvertes simultanément.
- Pointage aligné sur `RapprocherManuel` : un seul `ReglementClientRepository`, traitement **par item** (`ValidationResultDto { Success, SuccessCount, ErrorCount, Errors, FailedLigneIds }`). Un échec sur une paire n'empêche pas les autres.

### Front
- L'écran affiche le **vrai** message d'erreur renvoyé par l'API (fin de l'`alert` générique).
- Les paires réellement validées sont retirées des grilles ; les paires en échec (réservation volée/libérée incluse) restent visibles, identifiées via `FailedLigneIds` (plus de parsing de texte fragile).

## 2026-07-07 — Filtre « Non rapprochés » : session + épinglage (TASK-019)

### UX / rapprochement
- Le filtre du haut (« Non rapprochés » / « Rapprochés en cours » / « Tous ») porte désormais **exclusivement sur le lettrage de session** — plus aucune référence à `isPointe` dans le filtre client.
- En mode « Non rapprochés », les paires **lettrées en session ne disparaissent plus** : elles restent visibles et sont **épinglées en haut** des deux grilles (GRC + Relevé), au-dessus du backlog non lettré, pour relecture avant « Approuver ».

### Chargement / bonne couche
- La liste GRC ne charge que les règlements **non pointés** via le paramètre `pointe=false` de `/reglements` (exclusion du pointé final au niveau **requête DB**, pas dans le filtre — aucune modif backend, paramètre préexistant).

## 2026-07-07 — Câblage front de la réservation (TASK-017)

### Métier / concurrence
- Chaque appariement/dissociation passe par `reserve`/`release` : l'état de rapprochement **survit au refresh** et reflète la base, plus le seul state de session.
- Lignes réservées par un autre utilisateur **visibles mais verrouillées** (cadenas + « réservé par X »), non sélectionnables ; seul le réservataire peut dissocier.
- Filtre « Non rapproché » recalculé sur l'état réel (Lettrage/MV_ID en base).
- `currentUserId` dérivé de `user.no` (et non `.id`/`.userId`) → les réservations propres ne se verrouillent plus après refresh.

### Validation (Phase 2)
- La date valeur de la ligne relevé est désormais transmise (ISO brut, sans reformatage `toLocaleDateString`) et posée sur `reg.DatePointage` par la DLL GRC, aligné sur `RapprocherManuel`. `ExtraitNum` reste `ligne.code` (= numéro d'extrait).

## 2026-07-07 — Réservation persistée du rapprochement (TASK-016)

### Métier / concurrence
- Rapprochement en **2 phases** : réservation persistée dans `RAPP_ReleveBancaire_Ligne` (Phase 1) puis pointage GRC via DLL au « Approuver » (Phase 2). La base GRC n'est plus jamais touchée avant validation. (TASK-016)
- Endpoint `reserve` **atomique** (`UPDATE … OUTPUT INSERTED.* WHERE Lettrage IS NULL AND NOT EXISTS(MV_ID)`) → protège contre la double-réservation multi-postes ; renvoie `409` + réservataire en cas de conflit. Endpoint `release` réservé au réservataire.
- `validate` refactoré en Phase 2 seule, avec re-vérification `ReservePar_UserId` avant l'appel DLL (rejet si volée/libérée).

### Base de données
- Colonnes `ReservePar_UserId` + `DateReservation` sur `RAPP_ReleveBancaire_Ligne` (audit : qui réserve/pointe et quand) + index unique filtré `UX_RAPP_Ligne_MVID` (un règlement réservé au plus une fois). (`SQL_002_TASK-016_Reservation.sql`)

### API
- `/reglements` remonte désormais l'état de réservation par règlement via un DTO **plat en camelCase** (`ReglementClientDto`), sans rupture du contrat existant des grilles.

## 2026-07-07 — Lot de corrections (11 tâches validées)

### Sécurité
- Suppression de tous les identifiants SQL en dur (`sa`/`1234`) ; connexion via `IDbConnectionFactory` + `appsettings`/User Secrets/env. (TASK-001)
- CORS restreint (`RestrictedCors`, origines depuis `Cors:AllowedOrigins`) en remplacement de `AllowAnyOrigin`. (TASK-003)

### Métier / justesse comptable
- Validation d'un rapprochement exclusivement via la DLL GRC (`ReglementClientRepository.Update`), enveloppée dans un `TransactionScope`, avec garde anti-double-pointage (`IsPointe`). Suppression de l'`UPDATE [dbo].[RT_MOUVEMENT]` SQL brut. (TASK-004)
- Auto-Rapprochement rendu fonctionnel de bout en bout : relevé réellement sélectionné, chargement des vrais règlements non pointés (montant `MontantDeviseSociete`), propositions appliquées aux deux grilles. (TASK-012)
- Reprise de l'index de lettrage (backend + front) : plus de collision au 2ᵉ passage, `AA` correct après `Z`. (TASK-007, TASK-013)

### Import Excel
- Dates serial gérées (`DateTime.FromOADate`), montants parsés en Invariant puis fr-FR. (TASK-005)
- Lignes rejetées comptées et remontées à l'utilisateur (`LignesRejetees`), fin des catch silencieux. (TASK-006)

### Performance
- Requêtes règlements (`/api/reglements`, `/distincts`) bornées à la période réelle au lieu de charger `2000→2030`. (TASK-008-A)

### Architecture / déploiement
- Logique métier sortie de `Program.cs` vers `ReglementController`/`ReglementService` (DI), suppression du hack de réflexion sur `_kernel`. (TASK-009)
- URL de l'API configurable au déploiement (`config.js`) ; plus de `localhost:5044` en dur dans le frontend. (TASK-011)

- Garde d'accès sur l'API : `FallbackPolicy = RequireAuthenticatedUser` (tout endpoint protégé par défaut) + `[Authorize]` sur les contrôleurs ; seul `/api/auth/login` reste `AllowAnonymous`. Ferme l'écriture GRC anonyme sur `/relevebancaire/validate`. (TASK-002 — corrigée après un 1er rejet)
