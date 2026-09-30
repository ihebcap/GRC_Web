# TASK-100 — Rapprochement : sélection de plusieurs relevés bancaires (traités comme un seul relevé par l'utilisateur)

- **Priorité** : 🟠 Majeur
- **Domaine** : Front + Back (chargement des lignes, auto-rapprochement, verrous) — **RISK HIGH** (écran le plus utilisé, mise en prod directe)
- **Statut** : TODO
- **Dépend de** : **TASK-106** (prérequis dur : appariement par identifiant, `formatRepere`, `comparePairKey`, `loadedMvIds`, `delettrerLigne`).
  Ordre conseillé : TASK-098 → TASK-099 → TASK-106 → **TASK-100** → TASK-101 / TASK-102.
- **Mise en prod** : API **et** front ensemble (un seul dossier `deploy\`, voir `DEPLOY.md`). **Ne jamais déployer le front seul** : il appelle le nouvel endpoint
  `POST /api/ReleveBancaire/lignes`. Ancien front + nouvelle API fonctionne (l'ancien champ mono-relevé et l'ancien endpoint restent acceptés). Aucun script SQL, aucune config,
  aucune migration. Retour arrière = redéployer le `deploy\` précédent.
- **Références de ligne** : état du dépôt au commit `b07445e` (2026-09-30), **avant** TASK-098/099/106. Elles bougeront ; se repérer par le **nom de la fonction**, pas par le numéro.

## Contexte
Demande PO (2026-09-30) : sélectionner **plusieurs relevés** à la fois. Décision PO : **pour l'utilisateur, plusieurs relevés se traitent comme un seul relevé** — une seule grille Relevé (union),
une seule grille GRC ; Auto / Approuver / Dérapprocher / Générer règlement agissent sur l'ensemble ; aucune notion de « relevé courant ». L'identifiant du relevé n'est qu'un point technique : il est
ajouté **devant la lettre** (`12-A`, `15-A`) pour rendre le repère unique.

Décisions PO du 2026-09-30 :
1. Un règlement réservé par un relevé non sélectionné **reste affiché « réservé »** (traité par TASK-106).
2. **Pas de plafond de volume.** À la place, la règle existante est gardée : le combo **ne liste que les relevés qui ont encore au moins une ligne crédit non approuvée** (un relevé 100 % approuvé disparaît).
3. Appariement par **identifiant du règlement** et non par la lettre (TASK-106, prérequis).
4. **Seul le sens crédit** est dans le périmètre (le débit = décaissement est hors périmètre) : aucune ligne débit n'est chargée, listée, comptée, proposée ni réservée.

Le PO **ne teste pas avant la mise en production** : toutes les preuves sont produites par le worker, sur la base de **test**, et figurent dans le VERIFY (aucun test n'est demandé au PO).

## Problèmes constatés (références vérifiées le 2026-09-30)
1. **Un seul relevé** : état `selectedReleveId: number | ''` (`RapprochementBancaire.tsx:226`), `<select>` (`:1177-1187`), chargement des lignes mono-requête (`:580-618`, jeton `fetchLignesReleveSeqRef`, TASK-079),
   `handleAutoReconcile` (`:634-701`) n'envoie qu'un `releveBancaireEnteteId`.
2. **Collision de lettres** : la lettre est calculée **par relevé** (`ReleveBancaireRepository.cs:361-389`) : deux relevés ont chacun un « A ». Corrigée **dans le principe** par TASK-106 (appariement par `MV_ID`) ; ici on rend le repère **lisible** (préfixe) et on évite les collisions d'affichage (couleur, tri, filtre).
3. **Auto-rapprochement** : `POST /ReleveBancaire/auto-reconcile` (`ReleveBancaireController.cs:128-180`) lit un seul relevé. Lancé relevé par relevé, **le même règlement peut être proposé à deux lignes de deux relevés** (le moteur exige l'unicité du montant des deux côtés, mais seulement **dans l'ensemble qu'on lui donne**).
4. **Contrôle d'accès absent** : contrairement à `GetEntetes` / `GetLignes` / `GetEtatRapprochement` (TASK-075), **`auto-reconcile` ne contrôle pas la société** (`:128-180` : aucun appel à `VerifierAutorisation…`). Il faut **l'ajouter** (et non « le conserver »), pour chaque relevé demandé.
5. **Les lignes débit sont chargées puis masquées** : `GetAllLignesExcelAsync` (`ReleveBancaireRepository.cs:133-147`) renvoie **toutes** les lignes non approuvées, débit compris ; les débits n'étant jamais approuvés, ils s'accumulent (prod 2026-09-30 : BCP **8 417** lignes non approuvées dont **1 582** en crédit ; 5 banques **12 778** dont **3 103**) et l'écran les masque (`credit > 0`, `:1055`).
   Avec plusieurs relevés, le nouvel endpoint ne doit lire que le crédit.
6. **Verrous multi-relevés** : `ReserverLignesBatchAsync` (`:432-545`) et `LibererLignesBatchAsync` (`:568-649`) prennent **un verrou par relevé distinct** (`sp_getapplock`) dans l'ordre d'un dictionnaire (`:463-465`, `:588-589`) — **non trié** : avec plusieurs relevés dans un même lot, deux utilisateurs peuvent s'interbloquer (le code refuse alors tout le lot, sans corruption).
7. **Course entre relevés sur un même règlement** : les verrous sont **par relevé** ; deux utilisateurs qui réservent le même règlement depuis deux relevés différents ne se sérialisent pas. La base de prod est en **`READ_COMMITTED_SNAPSHOT`** (vérifié le 2026-09-30) : le test `NOT EXISTS (… MV_ID=@MvId)` ne voit pas la réservation non validée de l'autre transaction ; c'est l'index unique `UX_RAPP_Ligne_MVID` qui tranche en levant une exception SQL (2601) — aujourd'hui **non interceptée** : `catch (Exception) { Rollback; throw; }` → **tout le lot échoue en erreur 500** au lieu d'un simple conflit sur la paire.
8. **La liste des relevés n'est relue qu'au changement de banque** (`:540-578`) : après « Approuver », un relevé devenu 100 % approuvé reste dans le combo jusqu'au rechargement.

## Décision d'architecture
- **Une seule requête** pour charger les lignes de N relevés : `POST /api/ReleveBancaire/lignes` (corps JSON, pas de liste dans l'URL). Un contrôle d'accès groupé, une lecture cohérente, un seul jeton de séquence, **tout ou rien** : jamais d'union partielle affichée
  (Auto et Approuver agissent sur l'union). Mesuré en prod : un mois de relevés quotidiens = 20 à 47 relevés par banque ; N requêtes parallèles seraient inutilement lourdes.
- **L'auto-rapprochement tourne sur l'union des lignes libres en crédit** des relevés sélectionnés (1=1 strict **préservé sur l'union**). **Le moteur n'est pas modifié**, seulement son jeu d'entrée. Conséquence **voulue** : si deux relevés ont une ligne de même montant, **aucune des deux** n'est proposée
  (mesure prod du 2026-09-30, 5 banques cumulées, en prenant les N derniers relevés de chaque banque : N = 3 → 71 → 70 propositions ; N = 10 → 98 → 91 ; tous les relevés → 215 → 152 ; les lignes perdues sont des montants ronds ambigus : 90 000,00 ; 60 000,00 ; 32 000,00).
- **Aucun `enteteId` dans les propositions** : `reserve-batch` retrouve déjà l'entête de chaque ligne en base (`ReleveBancaireRepository.cs:455-460`) et prend ses verrous lui-même. Aucun DTO de proposition, de réservation ni de libération ne change.
- **Stockage inchangé** (`Lettrage` garde la lettre nue). Le préfixe est **composé côté front**.
- **Affichage** : préfixe `<idRelevé>-` visible **seulement si > 1 relevé sélectionné** (ou pour un règlement « réservé ailleurs », TASK-106). Avec 1 seul relevé l'écran est **strictement identique** à aujourd'hui (lettre nue, pas de colonne « Relevé »).
- **Composant de sélection** : `CheckboxDropdown` (aujourd'hui local à `ApercuComptabilisation.tsx`, compacté en TASK-095) est **extrait** dans un fichier partagé **sans changer son rendu** ; on n'en invente pas un autre.

## Comportements attendus (contrat)

### API
| Appel | Résultat attendu |
|---|---|
| `POST /api/ReleveBancaire/lignes` corps `{ "releveBancaireEnteteIds": [12, 15] }` | **200** : tableau des lignes des relevés demandés **avec `Credit > 0` et `DateValidation IS NULL`**, triées `DateOperation` croissante puis `Id` ; même forme JSON que `GET /{id}/lignes` (dont `releveBancaireEnteteId`, `mV_ID`, `reservePar_UserName`). Aucune ligne débit, aucune ligne approuvée. |
| idem, liste `null` ou vide | **400**, corps `{ "message": "Aucun relevé sélectionné." }` |
| idem, un identifiant ≤ 0 | **400**, `{ "message": "Identifiant de relevé invalide." }` |
| idem, plus de 1 000 identifiants distincts | **400**, `{ "message": "Trop de relevés demandés (maximum 1000)." }` (garde technique de l'API — **pas** un plafond côté utilisateur) |
| idem, **un** identifiant inexistant ou d'une autre société | **403** (`Forbid()`, comme les GET existants), **aucune donnée renvoyée** pour les autres |
| idem, sans claim `SocieteId` | **401** |
| `POST /ReleveBancaire/auto-reconcile` corps `{ "releveBancaireEnteteIds": [12, 15], "banqueId": B, "dateDebut": …, "dateFin": … }` | propositions calculées sur l'**union des lignes libres en crédit** (`Lettrage` vide) des relevés ; **même forme de réponse qu'aujourd'hui** (`ligneReleveId`, `reglementGrcId`, `montant`, `lettragePropose`) ; un même règlement n'apparaît **jamais deux fois** |
| idem, ancien corps `{ "releveBancaireEnteteId": 12, … }` | accepté, **résultat identique** à `{ "releveBancaireEnteteIds": [12] }` ; si les deux champs sont fournis : union, sans doublon |
| idem, aucun relevé / identifiant ≤ 0 / > 1 000 | **400** avec les mêmes messages que ci-dessus |
| idem, un relevé inexistant ou d'une autre société | **403**, **avant** toute lecture de données |
| idem, relevés de **banques différentes** | **400**, `{ "message": "Les relevés sélectionnés n'appartiennent pas tous à la même banque." }` |
| idem, `banqueId` renseigné (> 0) différent de la banque des relevés | **400**, `{ "message": "Les relevés sélectionnés n'appartiennent pas à la banque demandée." }` |
| `POST reserve-batch` / `release-batch` couvrant plusieurs relevés | verrous pris dans l'**ordre croissant d'identifiant de relevé** (journal : `RÉSERVATION LOT : verrous entêtes pris dans l'ordre 12,15`) ; lettres **par relevé**, consécutives sans trou |
| `POST reserve-batch` : une paire déclenche l'exception d'unicité (2601/2627) | cette paire : `success = false` ; **les autres paires sont réservées normalement** ; HTTP 200 ; lettres consécutives sans trou |
| `POST reserve` (unitaire) : exception d'unicité | **409** `{ "message": "Ligne ou règlement déjà réservé.", "detail": … }` (le contrôleur gère déjà le retour `null`) |
| `GET /ReleveBancaire/{id}/lignes`, `GET /ReleveBancaire?banqueId=…&nonRapprochesSeulement=true` | **inchangés** (compatibilité) |

### Écran
| Situation | Résultat attendu |
|---|---|
| Sélection d'une banque | combo = relevés ayant ≥ 1 ligne crédit non approuvée ; **seul le plus récent est coché** (comme aujourd'hui) ; grilles chargées pour ce relevé |
| Cocher / décocher des relevés | grille Relevé = **union** des lignes crédit non approuvées des relevés cochés, **une seule requête** ; le dernier choix de l'utilisateur est **toujours** ce qui est affiché (jamais un ancien lot) |
| Échec du chargement (403, 500, réseau) | grille Relevé **vidée**, toast `error` : « Accès refusé à l'un des relevés sélectionnés. » (403) ou « Impossible de charger les lignes des relevés sélectionnés. » (autres) ; **jamais** de lignes périmées ni partielles |
| > 1 relevé coché | colonne **« Relevé »** visible (libellé `titre (#id)`, filtre liste sur l'id, tri) ; repère `12-A` sur les **deux** grilles ; filtre « Repère » liste ces valeurs préfixées |
| 1 seul relevé coché | **identique à aujourd'hui** : pas de colonne « Relevé », lettre nue |
| « Auto » | requête avec `releveBancaireEnteteIds` = relevés cochés ; même toast qu'aujourd'hui ; lettres attribuées **par relevé** par le serveur |
| « Approuver », « Dérapprocher » | agissent sur **toutes** les lignes chargées (union) — règles de TASK-106 inchangées |
| « Générer règlement » (ligne) | inchangé (par `ligneReleveId`) |
| Décocher un relevé qui contient mes réservations en cours | elles **restent réservées en base** ; leurs règlements passent en « **réservés ailleurs** » (cadenas `#id`) ; les recocher les réapparie (par `MV_ID`) |
| Après « Approuver » ayant approuvé au moins une ligne | la liste des relevés est **relue** : un relevé devenu 100 % approuvé **disparaît du combo** et de la sélection, sans rechargement |
| Plus aucun relevé à rapprocher pour la banque | message « Aucun relevé à rapprocher pour cette banque. » (+ bouton d'import existant) |
| Changement de banque | sélection remise à zéro puis relevé le plus récent coché ; lignes, sélections, filtres « Repère » / « Relevé » remis à zéro |
| Changement de sélection | `selectedGrcId`, `selectedReleveLigneId`, `pendingReservation` remis à `null` ; filtres « Repère » (deux grilles) et « Relevé » remis à zéro |

## Étapes d'implémentation

### Back
1. **Repository** (`GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs`), nouvelles méthodes publiques :
   - `Task<List<int>> VerifierAutorisationReleveEntetesAsync(IReadOnlyCollection<int> enteteIds, int societeId)` : **une** requête
     `SELECT e.Id, e.BanqueId FROM dbo.RAPP_ReleveBancaire_Entete e INNER JOIN dbo.vBanque b ON b.No = e.BanqueId WHERE e.Id IN @Ids AND b.SocieteNo = @SocieteNo` (Dapper, paramétrée, `IN @Ids` — 1 000 identifiants maximum, sous la limite de 2 100 paramètres) ;
     si le nombre d'identifiants distincts retrouvés ≠ celui demandé → journal Warning `AUTORISATION RELEVÉS refusée : entêtes={Ids} hors du périmètre société societeId={SocieteId}` puis `throw new UnauthorizedAccessException("Vous n'êtes pas autorisé à accéder à l'un des relevés demandés.")` ;
     sinon retourne les identifiants de **banque distincts**. Même esprit que `VerifierAutorisationReleveEnteteAsync` (`:245-268`, à **conserver tel quel**).
   - `Task<List<ReleveBancaireLigne>> GetLignesCreditNonValideesAsync(IReadOnlyCollection<int> enteteIds)` : même projection que `GetAllLignesExcelAsync` (`:133-147`, jointure `P_UTILISATEUR` pour `ReservePar_UserName`) avec
     `WHERE l.ReleveBancaireEnteteId IN @EnteteIds AND l.DateValidation IS NULL AND l.Credit > 0 ORDER BY l.DateOperation ASC, l.Id ASC`. **Ne pas modifier `GetAllLignesExcelAsync`** (utilisée par `GET /{id}/lignes`).
2. **Verrous triés** : dans `ReserverLignesBatchAsync` (`var entetesDistincts = enteteParLigne.Values.Distinct().ToList();`, `:463`) et `LibererLignesBatchAsync` (`:588`), ajouter `.OrderBy(x => x)` et un journal Information
   `RÉSERVATION LOT : verrous entêtes pris dans l'ordre {Entetes}` (resp. `LIBÉRATION LOT : …`) — c'est la **preuve** de l'ordre (scénario S6). Ne rien changer d'autre à ces méthodes (TASK-098 y ajoute le contrôle « annulé » : conserver).
3. **Exception d'unicité** (`System.Data.SqlClient.SqlException`, déjà importé : `using System.Data.SqlClient;`, numéros **2601** et **2627**) :
   - `ReserverLignesBatchAsync`, dans la boucle `foreach (var item in items)` : entourer **uniquement** l'appel `QuerySingleOrDefaultAsync` du `UPDATE` conditionnel par
     `try { result = await … } catch (SqlException ex) when (ex.Number == 2601 || ex.Number == 2627) { _logger.LogInformation("RÉSERVATION LOT : conflit d'unicité sur MV_ID (réservé entre-temps par une autre transaction) ligne={LigneReleveId}, mv={MvId}", …); result = null; }`
     → le code existant traite `result == null` comme un conflit (`Success = false`, lettre **non consommée**) ;
   - `ReserverLigneAsync` : ajouter **avant** le `catch (System.Exception ex)` un `catch (SqlException ex) when (ex.Number == 2601 || ex.Number == 2627)` qui journalise (Information, même préfixe `RÉSERVATION`), fait `transaction.Rollback();` et `return null;` (le contrôleur renvoie alors le 409 existant) ;
   - **Hypothèse à prouver (scénario S7)** : après cette erreur (sévérité 14, `XACT_ABORT` désactivé par défaut) la transaction reste utilisable et les paires suivantes du lot sont bien réservées et validées (`COMMIT`). **Si le lot entier échoue quand même, ne pas improviser : arrêter et signaler dans le VERIFY** (cause probable : `XACT_ABORT` activé au niveau du serveur).
4. **Contrôleur** (`GRC.API/Controllers/ReleveBancaireController.cs`) :
   - nouvelle classe `LignesReleveRequest { public List<int>? ReleveBancaireEnteteIds { get; set; } }` et `AutoReconcileRequest` (`:453-459`) += `public List<int>? ReleveBancaireEnteteIds { get; set; }` (le champ mono-relevé `ReleveBancaireEnteteId` **reste**) ;
   - nouvel endpoint `[HttpPost("lignes")] GetLignesMulti(...)` : `401` sans `SocieteId` ; liste dédoublonnée ; `400` (messages du contrat) si vide / ≤ 0 / > 1 000 ; `VerifierAutorisationReleveEntetesAsync` puis `GetLignesCreditNonValideesAsync` ; `catch (UnauthorizedAccessException)` → journal Warning `LIGNES refusé (autorisation) : societeId={SocieteId}, entêtes={Ids}` + `return Forbid();` ; `return Ok(lignes)` ;
   - `GenererPropositions` (`:128-180`) — **début de méthode uniquement** : construire la liste dédoublonnée (`ReleveBancaireEnteteIds` ∪ `ReleveBancaireEnteteId` si > 0) ; `400` (mêmes messages) ; `VerifierAutorisationReleveEntetesAsync` (→ `Forbid()` + journal Warning) ;
     contrôles de banque (`400` : plusieurs banques ; `BanqueId` > 0 différent) ; `var toutesLesLignes = await _releveRepository.GetLignesCreditNonValideesAsync(ids);` **à la place** de `GetAllLignesExcelAsync(request.ReleveBancaireEnteteId)` (`:133`).
     **Tout le reste est conservé tel quel** : `lignesExcel` = lignes sans lettre ; calcul de `startIndex` ; lecture des règlements (filtres `!IsPointe`, banque `request.BanqueId`, éligibilité — **y compris le filtre « annulé » ajouté par TASK-098**) ; appel `_reconciliationEngine.CalculerPropositions(...)` ; forme de la réponse.
     Sémantique de `request.BanqueId` **inchangée** pour le filtre des règlements (`null`/`0` = toutes banques, comme aujourd'hui).
   - journaux (français, préfixes cohérents) : entrée `AUTO-RAPPROCHEMENT entrée : societeId={SocieteId}, entêtes={Ids}, banqueId={BanqueId}, période={Debut:yyyy-MM-dd}→{Fin:yyyy-MM-dd}` ; sortie `AUTO-RAPPROCHEMENT sortie : {NbLignesLibres} ligne(s) libre(s), {NbReglements} règlement(s) candidat(s), {NbPropositions} proposition(s)`.
     Ils servent au diagnostic en prod (le PO ne teste pas).
   - **`AutoReconciliationEngine`, `LettrageGenerator`, `ReglementEligibilityHelper` : aucune modification.**

### Front
> `RapprochementBancaire.tsx` est en `// @ts-nocheck` (ligne 1) : le build **ne détecte ni erreur de type ni appelant oublié** ; les `grep` du VERIFY et les scénarios E2E sont la seule protection.

5. **Extraire `CheckboxDropdown`** (`ApercuComptabilisation.tsx`, définition `:64-153`) :
   - nouveau `gocom-web/src/CheckboxDropdown.tsx` : le composant **copié à l'identique** (mêmes classes CSS `apercu-dropdown*`, même balisage, mêmes libellés « Rechercher… », « (TOUT SÉLECTIONNER) », « Aucun élément », « Tous sélectionnés », « N sélectionnés ») avec `import './CheckboxDropdown.css'` et **une seule extension** : prop optionnelle `disabled?: boolean` (défaut `false` ⇒ rendu inchangé) — si `true`, le clic n'ouvre pas le panneau, `opacity: 0.6`, `cursor: not-allowed` ;
   - nouveau `CheckboxDropdown.css` : y **déplacer tel quel** le bloc « `/* CheckboxDropdown compacté pour ApercuComptabilisation */` » de `ApercuComptabilisation.css` (de la ligne 112 à la fin du fichier, règles `.apercu-dropdown*`) ; le **retirer** de `ApercuComptabilisation.css` ;
   - `ApercuComptabilisation.tsx` : supprimer la définition locale, `import { CheckboxDropdown } from './CheckboxDropdown';`, retirer les imports devenus inutiles (`npm run lint` à 0 erreur) ;
   - **preuve** : captures de l'écran « Comptabilisation » **avant / après** identiques (barre de filtres, panneau ouvert, recherche, « Tout sélectionner ») ;
   - `ARCHITECTURE.md` : ajouter un court paragraphe « Sélecteur à cases à cocher » (3 lignes) : toute liste déroulante multi-sélection **réutilise `CheckboxDropdown.tsx`** ; interdit d'en inventer un autre (même esprit que § Grilles de données).
6. **État** : remplacer `selectedReleveId` / `setSelectedReleveEnteteId` par `selectedReleveIds: number[]` / `setSelectedReleveIds` (init `[]`) ; ajouter
   `const selectedReleveIdsKey = [...selectedReleveIds].sort((a, b) => a - b).join(',');` (clé stable des effets) ; `const showPrefix = selectedReleveIds.length > 1;` ;
   `selectedBanqueIdRef` (synchronisé à chaque rendu, comme les autres refs) ;
   `const releveLabels = React.useMemo(() => { const m: Record<number, string> = {}; releves.forEach(r => { m[r.id] = `${r.titre} (#${r.id})`; }); return m; }, [releves]);`
   (libellé de repli : `Relevé #${id}`).
7. **Chargement de la liste des relevés** (effet sur `[selectedBanqueId]`, `:540-578`) : sans banque → `setSelectedReleveIds([])` ; avec banque → `[]` pendant le chargement puis **`[res.data[0].id]`** s'il existe, sinon `[]` ; le reste (jetons `fetchRelevesSeqRef` / `fetchLignesReleveSeqRef`, `isFetchingRelevesRef`) **inchangé**.
   Dans ce même effet, **remettre à zéro** les filtres « Repère » (deux grilles) et « Relevé » et les sélections `selectedGrcId` / `selectedReleveLigneId` / `pendingReservation`, comme à l'étape 8 (un changement de banque vide la sélection : l'effet de l'étape 8 s'exécute aussi, mais ne pas compter uniquement sur lui).
8. **Chargement des lignes** (effet `:580-618`, dépendance `[selectedReleveIdsKey]`) : même structure, avec le **même jeton de séquence unique** :
   ```ts
   const seq = ++fetchLignesReleveSeqRef.current;
   setSelectedGrcId(null); setSelectedReleveLigneId(null); setPendingReservation(null);
   setReleveFilters(prev => { const { lettrage, releveEnteteId, ...rest } = prev; return rest; });
   setGrcFilters(prev => { const { lettrage, ...rest } = prev; return rest; });
   if (selectedReleveIds.length === 0) { setLignesReleve([]); if (!isFetchingRelevesRef.current) setLoadingReleve(false); return; }
   setLoadingReleve(true);
   axios.post(`${API_BASE}/ReleveBancaire/lignes`, { releveBancaireEnteteIds: [...selectedReleveIds].sort((a, b) => a - b) })
     .then(res => { if (seq !== fetchLignesReleveSeqRef.current) return; setLignesReleve(res.data.map(/* mapping existant + releveEnteteId + mvId (TASK-106) */)); })
     .catch(err => { if (seq !== fetchLignesReleveSeqRef.current) return; console.error(err); setLignesReleve([]);
         showToast(err.response?.status === 403 ? "Accès refusé à l'un des relevés sélectionnés." : "Impossible de charger les lignes des relevés sélectionnés.", 'error'); })
     .finally(() => { if (seq === fetchLignesReleveSeqRef.current) setLoadingReleve(false); });
   ```
   (Éviter de recréer les objets de filtres quand rien ne change, pour ne pas provoquer de rendus inutiles : retourner `prev` si les clés sont absentes.)
9. **Combo** (`<select>` du relevé, `:1177-1187`) → `<CheckboxDropdown options={releves.map(r => ({ value: String(r.id), label: `#${r.id} · ${r.titre} - ${new Date(r.dateImport).toLocaleDateString()}` }))} selectedValues={selectedReleveIds.map(String)} onChange={vals => setSelectedReleveIds(vals.map(Number))} placeholder="Relevé associé…" disabled={!selectedBanqueId} />`.
   Le `#id` en tête de libellé sert à **décoder le préfixe** des repères (`12-A`). Les deux autres `<select>` (banque, filtre « Non rapprochés / Rapprochés / Tous ») restent des `<select>`.
10. **Auto** — `handleAutoReconcile` : garde `selectedReleveIds.length === 0` → toast `warning` « Veuillez sélectionner un relevé bancaire. » (texte actuel) ; corps de la requête : `releveBancaireEnteteIds: selectedReleveIds` (à la place de `releveBancaireEnteteId`), `banqueId`, `dateDebut`, `dateFin` inchangés ; **le reste de la fonction est celui de TASK-106** (la lettre utilisée est celle renvoyée par `reserve-batch`, jamais `lettragePropose`).
11. **Relecture de la liste après « Approuver »** : nouvelle fonction `refreshReleves` (`React.useCallback`, deps `[]`) :
    ```ts
    const refreshReleves = React.useCallback(() => {
        const banque = selectedBanqueIdRef.current;
        if (!banque || isFetchingRelevesRef.current) return;          // pas pendant un chargement de banque
        const seq = ++refreshRelevesSeqRef.current;                   // compteur DÉDIÉ (ne pas toucher fetchRelevesSeqRef)
        axios.get(`${API_BASE}/ReleveBancaire?banqueId=${banque}&nonRapprochesSeulement=true`)
            .then(res => {
                if (seq !== refreshRelevesSeqRef.current || banque !== selectedBanqueIdRef.current) return;
                const liste = res.data || [];
                setReleves(liste);
                setSelectedReleveIds(prev => { const next = prev.filter(id => liste.some((r: any) => r.id === id)); return next.length === prev.length ? prev : next; });
            })
            .catch(err => console.error(err));
    }, []);
    ```
    (`refreshRelevesSeqRef` = nouveau `useRef(0)`.) L'appeler à la fin de `handleApprouver` **si au moins une paire a été approuvée**. Ne jamais modifier la sélection autrement (pas de re-sélection automatique).
    Dans le rendu, remplacer le texte de l'état vide (`:1228-1236`) « Aucun relevé importé pour cette banque. » par **« Aucun relevé à rapprocher pour cette banque. »** (le bouton « Aller à l'import de relevé » est conservé).
12. **Repère préfixé** (s'appuie sur `formatRepere` de TASK-106) :
    - `GrcTableBody` reçoit la prop `showPrefix` (l'ajouter à `GrcTableBodyProps`) et calcule `repere = formatRepere(row.releveEnteteId, row.lettrage, showPrefix || reservedElsewhere)` ; **la ligne ne reçoit que `repere` et `reservedElsewhere`** (déjà dans `propsToCompare`, TASK-106) : **ne pas passer `showPrefix` à `GrcTableRow`** ; quand `showPrefix` change, le corps se re-rend et seules les lignes dont `repere` a changé sont ré-affichées ;
    - `ReleveTableBody` reçoit `showPrefix`, `showReleveCol`, `releveLabels` (objet) ; il calcule par ligne `repere = formatRepere(row.releveEnteteId, row.lettrage, showPrefix)` et `releveLabel` et les passe à `ReleveTableRow` (`React.memo` à comparaison superficielle : les props primitives suffisent) ;
    - `ReleveTableRow` : afficher `{repere}` dans la cellule `lettrage-cell` (à la place de `{row.lettrage}`) ; fond de ligne lettrée `getLettrageColor(repere)` (en mono = lettre nue = couleur actuelle ; en multi, `12-A` et `15-A` n'ont **pas** la même couleur de base) ; si `showReleveCol`, ajouter une cellule `<td title={releveLabel}>{releveLabel}</td>` **juste après la case « Sel. »** ;
    - `getGrcCellValue` (cas `'lettrage'`, déjà adapté par TASK-106) : utiliser `formatRepere(r.releveEnteteId, r.lettrage, showPrefix || (!!r.lettrage && !loadedMvIds.has(r.mv_Id)))`.
13. **Colonne « Relevé »** (seulement si `selectedReleveIds.length > 1`) : dans l'en-tête de la grille Relevé, après « Sel. » :
    `<th><span onClick={() => handleReleveSort('releveEnteteId')} style={{cursor:'pointer'}}>Relevé {renderSortIcon(releveSort, 'releveEnteteId')}</span><ExcelFilter columnKey="releveEnteteId" filterType="list" options={getReleveFilterOptions('releveEnteteId')} selectedValues={releveFilters['releveEnteteId']?.value || []} onChange={(val) => setReleveFilters(prev => ({...prev, releveEnteteId: {type: 'list', value: val}}))} /></th>`
    (mode `list`, **réutiliser `ExcelFilter`**, conformément à `ARCHITECTURE.md` § Grilles de données). Le tri par cette colonne utilise le comparateur numérique générique existant.
14. **Filtres, options et tri sur l'union** (grille Relevé) :
    - `filteredLignes` : pour la clé `'lettrage'`, comparer la **valeur affichée** `formatRepere(l.releveEnteteId, l.lettrage, showPrefix)` (et non `String(l.lettrage)`) ; la clé `'releveEnteteId'` fonctionne avec le code générique (`String(l.releveEnteteId)`) ;
    - `releveFilterOptionsMap` : clé `'lettrage'` → valeurs **affichées** uniques, triées avec `comparePairKey` sur les couples distincts `(releveEnteteId, lettrage)` ; nouvelle clé `'releveEnteteId'` → `{ value: String(id), label: releveLabels[id] ?? 'Relevé #'+id }` triées par id ;
    - `sortedLignes` : remplacer `String(a.lettrage).localeCompare(String(b.lettrage))` par `comparePairKey(a, b)` (les lettrés d'abord, comme aujourd'hui) ; pour un tri utilisateur sur la colonne `'lettrage'`, utiliser aussi `comparePairKey` (sens inversé si `desc`) ; `sortedReglements` : déjà traité par TASK-106 (rangs + `comparePairKey`) ;
    - **dépendances des `useMemo`** : ajouter `showPrefix` (et `releveLabels` pour les options) aux dépendances de `filteredLignes`, `sortedLignes`, `releveFilterOptionsMap`, `filteredReglements`, `sortedReglements`, `grcFilterOptionsMap` — les `eslint-disable react-hooks/exhaustive-deps` du fichier **masquent** l'oubli ; sans cela les filtres restent périmés quand on passe de 1 à 2 relevés.
15. **Ne pas toucher** : `AutoReconciliationEngine`, `utils.tsx`, `DEFAULT_COLUMNS`, le code mort (`pairedLettrages`, `isPaired`, `currentLettrageIndex`, `getIndexFromLettrage`), la logique de réservation/validation hors ce qui est décrit, `GET /{id}/lignes`.

## Jeu d'essai (base de TEST uniquement — jamais la prod)
Même cadre que TASK-106 (comptes **U1**, **U2** non-admin de la même société ; `INSERT` dans les tables `RAPP_*` de l'application autorisé en base de test ; règlements créés **par l'application**, jamais d'écriture sur les tables métier GRC). **Crédit uniquement** (sauf les lignes débit volontaires ci-dessous, qui servent à prouver leur exclusion).
Vérifier par `SELECT` que les montants ci-dessous sont **absents** des règlements non pointés de la banque de test B (sinon les décaler). La base de test doit avoir **`READ_COMMITTED_SNAPSHOT` = ON** comme la prod (`SELECT is_read_committed_snapshot_on FROM sys.databases WHERE name = DB_NAME()`). Sinon, l'activer **sur la base de TEST uniquement, jamais sur la prod** (`ALTER DATABASE <test> SET READ_COMMITTED_SNAPSHOT ON WITH ROLLBACK IMMEDIATE`, hors des heures d'usage de la base de test) et le consigner : sans RCSI la requête attendrait la transaction concurrente et verrait sa réservation — aucune exception d'unicité, donc S7 ne prouverait rien.
Gabarit d'insertion (ligne **crédit** : `Debit = 0`, `MontantReel = Credit` ; ligne **débit** : `Credit = 0`, `MontantReel = Debit`) — voir le script de TASK-106.

Relevés **neufs** de la banque B (aucune lettre présente : la première réservation de chacun reçoit « A ») :
- **RA** : A1 3 001,00 · A2 3 002,00 · A3 3 003,00 (aucun règlement) · A4 4 000,00 · **Ad** = **débit** 500,00
- **RB** : B1 3 004,00 · B2 3 005,00 · B3 4 000,00 (**même montant que A4**)
- **RC** : C1 **crédit** 6 001,00 **approuvée** (`DateValidation = GETDATE()` posée par le script de test) + **Cd** = **débit** 700,00 non approuvé → RC **n'est pas listé** (100 % approuvé côté crédit)
- **RE** : E1 5 001,00 · E2 5 002,00
- **RD** : relevé d'une **autre banque B2 de la même société** : D1 3 001,00
- **Autre société** : identifiant d'un relevé d'une autre société si la base de test en contient ; **sinon** un identifiant inexistant (ex. 99999999) — consigner lequel.

Virements non pointés, non annulés, banque B : **G1** 3 001,00 · **G2** 3 002,00 · **G3** 3 004,00 · **G4** 3 005,00 · **G5** 4 000,00 (**seul** règlement de ce montant) · **G6** 5 001,00 · **G7** 5 002,00.
Propositions attendues du moteur : **{RA}** → A1↔G1, A2↔G2, **A4↔G5** ; **{RB}** → B1↔G3, B2↔G4, **B3↔G5** (G5 proposé aux deux : c'est le piège) ; **{RA, RB}** → A1↔G1, A2↔G2, B1↔G3, B2↔G4 **uniquement** (4 ; ni A4, ni B3, ni G5).
Dans les scénarios, `<RA>` / `<RB>` désignent l'**identifiant numérique réel** des relevés RA / RB (ex. `#247`).
Consigner dans le VERIFY les identifiants réels (RA, RB, RC, RD, RE, lignes, G1…G7) et la base utilisée.
**Remise à l'état initial** : entre deux scénarios, libérer les lignes réservées (`release-batch` ou « Dérapprocher »), sauf indication contraire. Les scénarios qui **approuvent** (S13, S14) consomment leurs règlements : **recréer un lot neuf** (mêmes montants, nouveaux relevés/règlements) avant S15, S16, S17, S18 si besoin.

**Méthode de test** : comme TASK-106 — API réelle + `SELECT` via `sqlcmd` (mot de passe dans `SQLCMDPASSWORD`, jamais écrit) ; front = Playwright **contre l'API réelle** dans `gocom-web/e2e_task100.cjs` (+ script `"test:e2e-100"`), identifiants lus dans les variables d'environnement `GRC_E2E_*` (jamais dans le script ni le VERIFY) ;
`page.route` autorisé **uniquement** pour simuler des délais/erreurs réseau (S9, S10) et pour l'ordre des identifiants 9 / 12 (S16). Captures dans `tasks/VERIFY/`. Un script jetable de test (PowerShell/`curl`) est admis pour l'API ; ne jamais y écrire de secret.

## Scénarios de test (à rejouer par le worker ; résultat + preuve + date dans le VERIFY)
**API**
- **S1 Lignes groupées** : `POST /lignes` avec `[RA, RB, RC]` → **7** lignes (A1…A4, B1…B3) ; **ni Ad (débit), ni C1 (approuvée), ni Cd (débit)** ; `releveBancaireEnteteId` ∈ {RA, RB} ; ordre `DateOperation`, `Id` ; `COUNT(*)` SQL identique (`… IN (RA,RB,RC) AND DateValidation IS NULL AND Credit > 0`). Comparaison : l'**ancien** `GET /{RA}/lignes` renvoie **5** lignes (dont Ad) — inchangé.
- **S2 Erreurs** : corps `[]` / `null` → 400 + message exact ; `[0]` → 400 ; 1 001 identifiants → 400 ; `[RA, <autre société ou inexistant>]` → **403** et **aucune donnée** ; sans jeton → 401 ; même batterie pour `auto-reconcile`. `auto-reconcile` `[RA, RD]` (banques différentes) → 400 + message ; `[RA]` avec `banqueId` = B2 → 400 + message.
- **S3 Auto sur l'union** : `auto-reconcile` `[RA, RB]` → **exactement** A1↔G1, A2↔G2, B1↔G3, B2↔G4 ; **jamais G5** ; `[RA]` → 3 propositions dont A4↔G5 ; `[RB]` → 3 dont B3↔G5 ; ancien corps `{releveBancaireEnteteId: RA}` = `[RA]` (même JSON) ; les deux champs `{releveBancaireEnteteId: RA, releveBancaireEnteteIds: [RA, RB]}` → union sans doublon.
- **S4 Non-régression du moteur** : pour `[RA]`, la liste de propositions (y compris `lettragePropose`) est **identique** à celle de l'ancienne version (comparer les deux JSON) ; le 403 est nouveau et voulu (l'ancien code répondait 200 à un relevé d'une autre société).
- **S5 Réservation par lot multi-relevés** : `reserve-batch` avec `[B1→G3, A1→G1]` (RB **avant** RA dans le corps) → les deux `success = true`, lettre « A » **pour chacun** ; `SELECT` : A1 et B1 `Lettrage = 'A'`, entêtes différents. Un second lot `[A2→G2, B2→G4]` → « B » et « B » (consécutives, sans trou).
- **S6 Ordre des verrous** : le journal de S5 contient `RÉSERVATION LOT : verrous entêtes pris dans l'ordre <RA>,<RB>` (**croissant**, alors que le corps commençait par RB) ; idem `LIBÉRATION LOT` avec `release-batch` sur les 4 lignes (preuve : extrait du journal). Consigner que le tri est **dans le code** (`git diff`).
- **S7 Conflit d'unicité inter-relevés (base en RCSI)** : préparer deux lignes libres de **deux relevés différents** (A3 et B3) et un règlement libre (G5). Session SQL **A** : `BEGIN TRAN; UPDATE dbo.RAPP_ReleveBancaire_Ligne SET MV_ID=<G5>, Lettrage='Z', ReservePar_UserId=<id de U2>, DateReservation=GETDATE() WHERE Id=<A3>; WAITFOR DELAY '00:00:08'; COMMIT;` (lancée en arrière-plan, p. ex. `sqlcmd -Q`).
  Pendant ces 8 secondes, appeler `reserve-batch` avec `[B3→G5, B1→G3]` (U1) : la requête **attend** la fin de A puis répond **HTTP 200** avec **B3 `success = false`** et **B1 `success = true`** (lettre « A » ou la suivante libre **sans trou**) ; `SELECT` : B1 réservée, B3 libre, A3 réservée par A ; journal : `conflit d'unicité sur MV_ID`.
  Rejouer avec l'appel **unitaire** `POST /reserve` `{ligneReleveId: B3, mvId: G5}` → **409** `Ligne ou règlement déjà réservé.`. **Avant correctif** (à consigner, sur le code d'origine) : erreur **500** et lot entier annulé. Si la base de test n'est pas en RCSI, l'activer d'abord (voir « Jeu d'essai ») puis **rejouer** ; ne jamais conclure sur une base sans RCSI. Remettre ensuite A3 à l'état libre.
**Écran** (Playwright, API réelle)
- **S8 Non-régression mono** : un seul relevé (RA) : combo = 1 case cochée ; **pas** de colonne « Relevé » ; lettres nues ; réservation manuelle, Auto, « Dérapprocher », « Approuver » comme avant (captures avant/après comparées pour l'affichage ; approbation consignée) ; compteur « n élément(s) affiché(s) » = lignes **crédit**.
- **S9 Sélections rapides** : avec `page.route` qui **retarde de 3 s** la réponse de `POST /lignes` pour `[RA]` seulement, cocher RA puis RB aussitôt : après **toutes** les réponses, la grille = lignes de RA **et** RB (jamais RA seul) ; puis décocher RB pendant un chargement retardé : affichage final = RA seul. Aucun lot périmé ne réapparaît (preuve : assertions Playwright + captures).
- **S10 Échec de chargement** : `page.route` renvoie **500** puis **403** pour `POST /lignes` : grille Relevé vidée, toast `error` au texte exact (403 : « Accès refusé… », autre : « Impossible de charger… »), aucune ligne périmée ; le retour à une sélection valide recharge normalement.
- **S11 Manuel sur 2 relevés** (RA + RB cochés) : réserver A1↔G1 et B1↔G3 → repères **`<RA>-A`** et **`<RB>-A`** sur les **deux** grilles, fonds de couleur calculés sur le **repère préfixé** (aide visuelle à 15 teintes : deux repères peuvent coïncider par hasard — le consigner si c'est le cas avec les identifiants du test) ; aucune fausse paire ; cliquer A1 → `release-batch [A1]` seul, B1/G3 intacts (`SELECT`). Ne cocher ensuite que RA : lettre nue « A » sur A1 ; **G3 = cadenas `#<RB>`, repère `<RB>-A`** (réservé ailleurs, TASK-106).
- **S12 Auto sur 2 relevés** (RA + RB, tout libre) : « Auto » → toast « 4 correspondance(s) » ; **A4/B3 restent libres**, G5 n'est attribué à personne ; repères `<RA>-A`, `<RA>-B`, `<RB>-A`, `<RB>-B` ; `SELECT` cohérent. **Dérapprocher** : `release-batch` des 4 lignes ; tout est libre ; `SELECT` de preuve.
- **S13 Approuver sur l'union** : Auto (RA + RB) puis « Approuver » : corps de `validate` = **4 paires** (2 de RA, 2 de RB) ; `successCount = 4` ; les 4 lignes et 4 règlements disparaissent ; **RA (A3, A4) et RB (B3) restent dans le combo**. Variante **échec partiel** : réserver A2↔G2, B2↔G4, **pointer G2 par ailleurs** (écran Liste, mode Rapprocher) **sans recharger la grille GRC du Rapprochement**, « Approuver » → B2↔G4 approuvée, **A2 reste** (réponse `failedLigneIds = [A2]`), RA reste listé ; message d'erreur dans le toast.
- **S14 Un relevé 100 % approuvé disparaît** : sélectionner RE ; Auto (E1↔G6, E2↔G7) puis « Approuver » : RE **disparaît du combo sans rechargement** et de la sélection ; RC n'a **jamais** été listé (100 % approuvé + débit seul) ; si RE était le seul sélectionné : grille Relevé vide, pas de message d'erreur ; si plus aucun relevé n'est listé : message « Aucun relevé à rapprocher pour cette banque. ».
- **S15 Décocher avec des réservations en cours** (lot neuf si S13 a consommé G1…G4) : RA + RB avec A1↔G1 (RA) et B1↔G3 (RB) réservés par U1 ; décocher RB : les lignes de RB disparaissent, **G3 = « réservé ailleurs »** (cadenas `#<RB>`, clic sans effet), `SELECT` : B1 **toujours réservée** ; recocher RB : la paire B1/G3 est **de nouveau appariée**.
- **S16 Colonne « Relevé », filtres, ordre** (lot neuf si besoin) : avec 2 relevés, colonne « Relevé » présente (libellés `titre (#id)`) ; filtre liste par relevé OK ; filtre « Repère » liste les valeurs préfixées ; filtres « Repère »/« Relevé » **remis à zéro** quand la sélection change ; avec 1 relevé la colonne disparaît. **Ordre** (mocks `page.route` de `GET /ReleveBancaire`, `POST /ReleveBancaire/lignes` et `GET /reglements` : deux relevés d'identifiants **9** et **12**, chacun avec une paire de lettre « A ») : `9-A` **avant** `12-A` sur les deux grilles (un tri texte donnerait l'inverse).
- **S17 Changement de banque** : passer de B à B2 puis revenir : sélection remise à zéro, **seul** le relevé le plus récent de la banque est coché, lignes / sélections / filtres remis à zéro ; aucune ligne de l'ancienne banque affichée.
- **S18 Générer règlement (union)** (lot neuf si besoin) : RA + RB cochés, ligne A3 (aucun règlement) → « Générer règlement » : le corps de la requête contient `ligneReleveId = A3.id` ; après création, la grille GRC est rechargée ; « Auto » propose alors A3↔<nouveau règlement>.
- **S19 Combo** : recherche, « (TOUT SÉLECTIONNER) », libellés (« N sélectionnés », « Tous sélectionnés », libellé seul pour 1 relevé **quand la liste en contient plusieurs** — avec une seule option dans la liste le composant affiche « Tous sélectionnés » : comportement existant du composant, accepté — et `#id · titre - date` dans le panneau), panneau **non rogné** dans la barre d'outils (capture), désactivé sans banque. Écran **Comptabilisation identique avant/après** l'extraction (captures de la barre de filtres, panneau ouvert).
- **S20 Volume et performance (aucun plafond)** : si la base de test est une copie récente de la prod : cocher **tous** les relevés de la banque la plus chargée (BCP : 47 relevés, 1 582 lignes crédit au 2026-09-30) ; sinon générer par script ≥ 30 relevés × 200 lignes. Mesurer et consigner : durée de `POST /lignes`, taille de la réponse **comparée** à l'ancien chargement (`GET /{id}/lignes` pour chaque relevé, débits compris — en prod ≈ ÷ 5 pour BCP), temps d'affichage, durée d'« Auto » et du `reserve-batch`, fluidité de la sélection d'une ligne (mémoïsation, comme TASK-106 S10).
- **S21 Preuve par le code** : `grep -n "selectedReleveId\b\|setSelectedReleveEnteteId" gocom-web/src/RapprochementBancaire.tsx` → **0** résultat ; `git diff` : `AutoReconciliationEngine.cs` **non modifié** ; `GetAllLignesExcelAsync` non modifiée ; aucune dépendance ajoutée ; `CheckboxDropdown.css` = bloc déplacé à l'identique.

## Risques et points d'attention
- **Fusion avec TASK-098** : elle ajoute dans `GenererPropositions` le filtre « annulé » (helper `EstEligibleRappBancaire(…, r.IsAnnule)`) et, dans `ReserverLigneAsync` / `ReserverLignesBatchAsync`, un SELECT groupé + `ReglementAnnuleException`. **Les conserver** ; après fusion, rejouer les scénarios **S3 et S5 de TASK-098** (à ne pas confondre avec S3 et S5 de la présente TASK).
- **Course 2601 sous RCSI** : le comportement de la transaction après l'erreur est une **hypothèse** à prouver (S7) ; ne pas livrer sans cette preuve.
- **Jeton de séquence** : un seul pour toutes les lectures de lignes ; `refreshReleves` a son compteur dédié **et** vérifie la banque au retour (un « Approuver » lancé juste avant un changement de banque ne doit pas écraser la liste de la nouvelle banque).
- **`@ts-nocheck` et mémos** : dépendances `showPrefix` / `releveLabels` / `loadedMvIds` (voir étape 14) ; une omission ne se voit qu'à l'exécution (S16).
- **Toast unique de 3 s** (`App.tsx:106-110`) : pas de `showToast` successifs ; messages courts.
- **Ordre de déclaration (zone morte temporelle)** : `selectedReleveIds`, `selectedReleveIdsKey`, `showPrefix`, `releveLabels` et `selectedBanqueIdRef` sont déclarés **au début du composant** (près de `:226`/`:283`), avant tout effet, mémo ou callback qui les cite (les tableaux de dépendances sont évalués au rendu, dans l'ordre) ; un ordre inverse donne une `ReferenceError` que `@ts-nocheck` masque. `refreshReleves` est déclaré avant `handleApprouver`.
- **Union ⇒ moins de propositions automatiques** (voulu, mesuré : −1 pour 3 relevés, −7 pour 10, −63 pour tous sur 215) : à expliquer au PO, pas à « corriger » (le moteur strict 1=1 reste intouché).
- **Lignes déjà réservées** : le moteur ne retire pas de ses candidats les règlements déjà réservés ; un conflit à la réservation s'affiche « conflits ignorés » (comportement existant, non aggravé).
- **Déploiement** : API + front **ensemble** ; ne jamais le front seul.
- **Réservations en attente anciennes** (une datait du 2026-07-21 en prod) : elles restent valides ; elles apparaissent « réservées ailleurs » tant que leur relevé n'est pas coché (TASK-106).

## Hors périmètre / points connus (à ne pas traiter ici)
- **Période GRC par défaut = 7 jours** (`dateDebut`, `RapprochementBancaire.tsx:252-263`) : en cochant des relevés plus anciens, « Auto » ne trouve de règlement que dans la période Du/Au affichée (BCP : 19 règlements sur 7 jours, 600 sur 90). **Inchangé** ; question PO ouverte inscrite au TODO (caler « Du » sur le relevé coché le plus ancien ?).
- **Plafond** : aucun (décision PO).
- **Sens débit** : hors périmètre (décision PO).
- **Index `UX_RAPP_Ligne_Entete_Lettrage` (TASK-037) absent en prod** et 141 groupes de doublons (relevé, lettre) dans l'historique validé : à cadrer séparément ; cette TASK n'en dépend plus (appariement par identifiant).
- **Contrôle de société absent** sur `reserve` / `reserve-batch` / `release` / `validate` / `generer-reglement` (ils reposent sur les droits de caisse et le réservataire) : constat à part, non traité ici.

## Coordination avec les autres TASKs du rapprochement
- **TASK-106 d'abord** (prérequis dur). **TASK-098** (back) et **TASK-099** (front) **avant** : voir ci-dessus et TASK-106.
- **TASK-101 (export)** : doit exporter le **repère affiché** (`formatRepere`) et la colonne « Relevé » quand elle est visible (> 1 relevé) — jamais la lettre nue en multi-relevés.
- **TASK-102 (filtres de date)** : touche les mêmes blocs `filteredLignes` / `filteredReglements` et les en-têtes ; conflit de fusion possible, sans impact fonctionnel. Conserver, à la fusion, les cas `'lettrage'` et `'releveEnteteId'`.

## Contraintes
- Ne jamais bypasser une règle de sécurité ni une DLL métier GRC. **Le contrôle de société est appliqué à chaque relevé demandé** (nouveau pour `auto-reconcile`, conservé pour les GET).
- Respecter la Clean Architecture. Aucun secret en dur (scripts E2E compris). Aucune nouvelle dépendance.
- **Le worker s'arrête au dépôt du VERIFY** : `tasks/VERIFY/TASK-100_verify.md` (emplacement des dernières TASKs, ex. `tasks/VERIFY/TASK-097_verify.md`). Il ne clôt pas la TASK : pas de déplacement vers `DONE_DETAIL/`, pas de mise à jour de `DONE.md` / `TODO.md` / `CHANGELOG.md`, aucun message de commit contenant « approuve ».
- **Le moteur strict 1=1 n'est pas modifié** (écart acté au TODO) : seul son jeu d'entrée change.
- **Aucune ligne débit** n'est chargée, listée, comptée, proposée ni réservée par les nouveaux chemins.
- Grilles : réutiliser `ExcelFilter.tsx` et le pattern colonnes (`ARCHITECTURE.md` § Grilles de données) ; composant de sélection : **extraire** `CheckboxDropdown`, ne pas en inventer un autre.
- Le stockage (`Lettrage`, `MV_ID`) et les endpoints `reserve`, `release`, `validate`, `generer-reglement` ne changent pas (hors gestion de l'exception d'unicité et tri des verrous décrits).

## Fichiers concernés
- `GRC.API/Controllers/ReleveBancaireController.cs` (`LignesReleveRequest`, `POST lignes`, `AutoReconcileRequest`, `GenererPropositions` — début de méthode)
- `GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs` (2 méthodes nouvelles, tri des verrous ×2, exception d'unicité ×2, journaux)
- `gocom-web/src/RapprochementBancaire.tsx` (état, effets, combo, `handleAutoReconcile`, `refreshReleves`, `handleApprouver` — appel de relecture, repère préfixé, colonne « Relevé », filtres/tri/mémos, état vide)
- `gocom-web/src/CheckboxDropdown.tsx` et `gocom-web/src/CheckboxDropdown.css` (nouveaux), `gocom-web/src/ApercuComptabilisation.tsx` et `.css` (retrait du composant et du bloc CSS déplacé)
- `gocom-web/e2e_task100.cjs` (nouveau) et `gocom-web/package.json` (script `test:e2e-100`)
- `ARCHITECTURE.md` (paragraphe « Sélecteur à cases à cocher »)

## Checklist VALIDATION (VERIFY : preuve datée par critère — capture, réponse API, sortie SQL ou extrait de journal)
- [ ] Build back + front OK, 0 erreur ; `npm run lint` 0 erreur (preuve : sorties)
- [ ] S1 lignes groupées : crédit seul, non approuvées, ordre, comptage SQL (preuve : réponse + `COUNT(*)`)
- [ ] S2 erreurs 400 / 401 / **403 sans donnée** / banques différentes, pour `lignes` **et** `auto-reconcile` (preuve : la réponse de chaque cas)
- [ ] S3 auto sur l'union exacte, G5 jamais proposé, rétro-compatibilité de l'ancien corps (preuve : réponses)
- [ ] S4 propositions mono identiques avant/après (preuve : comparaison de JSON)
- [ ] S5 lot multi-relevés : lettres par relevé, consécutives (preuve : réponse + `SELECT`)
- [ ] S6 verrous pris en ordre croissant (preuve : extrait de journal + `git diff`)
- [ ] S7 conflit d'unicité : paire refusée, autres réservées, 409 en unitaire ; RCSI = ON (preuve : réponses + `SELECT` + valeur du réglage + journal)
- [ ] S8 mono identique à l'existant, sans colonne « Relevé » (preuve : captures avant/après)
- [ ] S9 sélections rapides : jamais de lot périmé (preuve : assertions + captures)
- [ ] S10 échec de chargement : grille vidée, messages exacts (preuve : captures)
- [ ] S11 repères préfixés distincts, aucune fausse paire, libération de la seule bonne ligne (preuve : captures + corps `release-batch` + `SELECT`)
- [ ] S12 auto + dérapprocher sur l'union (preuve : toast, `SELECT`)
- [ ] S13 approuver sur l'union (4 paires) + échec partiel (preuve : corps/réponse `validate` + captures)
- [ ] S14 un relevé 100 % approuvé disparaît du combo sans rechargement ; RC jamais listé (preuve : captures)
- [ ] S15 décocher/recocher avec réservations en cours (preuve : captures + `SELECT`)
- [ ] S16 colonne « Relevé », filtres remis à zéro, ordre `9-A` avant `12-A` (preuve : captures)
- [ ] S17 changement de banque (preuve : captures)
- [ ] S18 « Générer règlement » depuis l'union (preuve : corps de requête + capture)
- [ ] S19 combo + écran Comptabilisation identique avant/après (preuve : captures comparées)
- [ ] S20 volume/performance mesurés, aucun plafond, charge ≈ ÷ 5 (preuve : mesures chiffrées)
- [ ] S21 `grep` : plus de `selectedReleveId` ; moteur et `GetAllLignesExcelAsync` non modifiés (preuve : sorties + `git diff`)
- [ ] Rejeu des scénarios S3 et S5 de TASK-098 après fusion (ou « TASK-098 non encore fusionnée »)
- [ ] Aucun `console.count`/log de debug laissé ; aucun secret en dur (scripts compris) (preuve : `git diff`)
- [ ] Aucune dette technique silencieuse
- [ ] Cohérent avec l'architecture

## Go / No-Go
**No-Go si** S2 (403 et banques), S3, S6, S7, S9, S10, S11, S13 ou S15 ne sont pas prouvés : ce sont les cas qui protègent la base en production (mauvaise paire, accès hors société, lot perdu) et la cohérence de ce que l'utilisateur voit avant d'approuver.
