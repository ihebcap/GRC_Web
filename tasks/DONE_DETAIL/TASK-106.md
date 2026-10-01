# TASK-106 — Rapprochement : apparier une ligne de relevé et son règlement par identifiant (MV_ID), plus jamais par la lettre

- **Priorité** : 🟠 Majeur
- **Domaine** : Correction front + 1 champ back (DTO) — **RISK HIGH** (écran le plus utilisé, mise en prod directe)
- **Statut** : DONE
- **Dépend de** : — (ordre conseillé : TASK-098 → TASK-099 → **TASK-106** → TASK-100 → TASK-101 / TASK-102)
- **Prérequis de** : **TASK-100** (multi-relevés), qui ne doit pas démarrer avant la validation de celle-ci
- **Mise en prod** : API + front (un seul dossier `deploy\`, voir `DEPLOY.md`). Aucun script SQL, aucune config, **aucune migration** :
  le stockage est inchangé (`Lettrage` garde la lettre nue, `MV_ID` garde l'identifiant), les réservations en cours restent
  valides telles quelles. Ancien front + nouvelle API et nouveau front + ancienne API fonctionnent (le champ ajouté est optionnel).
  Retour arrière = redéployer le `deploy\` précédent.
- **Références de ligne** : état du dépôt au commit `b07445e` (2026-09-30). Si un fichier a bougé (TASK-098 / 099 fusionnées avant),
  se repérer par le **nom de la fonction**, pas par le numéro.

## Contexte
Analyse du 2026-09-30 (préparation de TASK-100, multi-relevés). Décisions PO du même jour : **un règlement réservé par un autre
relevé reste affiché « réservé »** (on ne le masque pas) ; **l'appariement se fait par l'identifiant du règlement**, pas par la
lettre. Le PO **ne teste pas avant la mise en production** : toutes les preuves sont produites par le worker, sur la base de
**test**, et figurent dans le VERIFY (aucun test n'est demandé au PO). Règle PO : **seul le sens crédit** est dans le périmètre
du rapprochement (le débit = décaissement est hors périmètre) : tous les jeux d'essai sont en crédit.

Cette TASK corrige un défaut **déjà présent aujourd'hui avec un seul relevé** (voir ci-dessous) et prépare TASK-100. Elle est
livrable et utile seule.

## Problème constaté (références vérifiées le 2026-09-30)
**Cause** : la grille « Règlements GRC » ramène les réservations de **n'importe quel relevé** — `ReglementService.cs:301`
(`SELECT MV_ID, Lettrage, ReservePar_UserId, DateReservation FROM RAPP_ReleveBancaire_Ligne WHERE MV_ID IN @Ids`, aucun filtre
par entête) — alors que l'écran n'affiche les lignes que d'**un** relevé (`RapprochementBancaire.tsx:580-618`). Or l'écran
apparie ligne et règlement **par la lettre seule**, et la lettre est attribuée **par relevé** (verrou `rapp_lettrage_<entête>`,
`max présent + 1`, `ReleveBancaireRepository.cs:361-389`) : deux relevés ont donc chacun leur « A ».

**Conséquences** (lecture de code) :
1. `handleSelectGrc` (`:831-851`) → `delettrerByLettrage(grc.lettrage)` (`:708-742`) : un clic sur un règlement réservé par le
   relevé 12 (lettre C) libère la paire « C » du relevé affiché s'il en a une (`:709`, `release-batch` sur la **mauvaise** ligne).
2. Si le relevé affiché n'a pas de « C », l'écran efface la lettre **en local seulement** (`:710-712`) sans prévenir le serveur :
   affichage faux, puis erreur 409 à la réservation suivante.
3. `handleApprouver` (`:923-983`) cherche le règlement par lettre (`reglementsGrc.find(r => r.lettrage === ligne.lettrage)`, `:928`) :
   il peut prendre le règlement d'un autre relevé ; le serveur refuse (`SauvegarderValidationAsync` vérifie `(ligne, règlement)` en
   base, `ReleveBancaireRepository.cs:686-701`) → **la paire légitime n'est pas approuvée** et le message d'erreur est trompeur.
   Le post-traitement compare aussi par lettre (`:967`).
4. `handleDelettrerTout` (`:878-921`) raisonne par ensembles de lettres (`failedLettres`, `fullyReleasedLettres`, `:896-907`).
5. La couleur des lignes dépend de la lettre seule (`getLettrageColor`, `:65-71`).

**Le serveur est sain** : il valide et réserve par `(ligne, MV_ID)` (index unique filtré `UX_RAPP_Ligne_MVID`, présent en prod) ;
aucun mauvais pointage n'est possible — seulement des refus bruyants et des libérations de la mauvaise paire.

**Mesure en prod (2026-09-30, lecture seule)** : 5 réservations en cours, toutes cohérentes (lettre + `MV_ID` + réservataire),
réparties sur 5 relevés (dont 4 relevés BCP) ; aucune lettre en commun aujourd'hui, mais les lettres montent jusqu'à ~630
(relevé 154 : 627 lignes lettrées) : la collision est possible, **pas encore déclenchée**.
L'unicité `(relevé, lettre)` n'est **pas** garantie en prod : l'index `UX_RAPP_Ligne_Entete_Lettrage` (TASK-037) y est **absent** et
l'historique validé contient 141 groupes de doublons. L'unicité du règlement, elle, l'est.

**Autres défauts des mêmes fonctions, corrigés ici parce qu'elles sont réécrites** :
- `handleApprouver` envoie aussi les lignes lettrées **par d'autres utilisateurs** (le serveur les refuse une à une → « Validation
  terminée avec des erreurs »).
- Après un succès, il retire de l'écran **toutes** les lignes lettrées (`:952-953`), y compris celles qu'il n'a pas envoyées.
- Il **saute en silence** (`if (grc)`, `:929`) une ligne dont le règlement n'est pas dans la grille (période ou plafond de 1000
  lignes, `:484`), puis la fait disparaître de l'écran alors qu'elle reste réservée.

## Décision d'architecture
- **Clé d'appariement = `MV_ID`** : la ligne relevé porte déjà `MV_ID` (JSON `mV_ID`) et `ReleveBancaireEnteteId`
  (JSON `releveBancaireEnteteId`) — entité renvoyée telle quelle par `GET /ReleveBancaire/{id}/lignes`. Une ligne et un règlement
  sont appariés **si et seulement si** `ligne.mvId === règlement.mv_Id`.
- **La lettre devient un libellé** (affichage, couleur, tri) ; plus aucune comparaison lettre ↔ lettre entre les deux grilles.
- Un règlement **réservé dont aucune ligne chargée ne porte le `MV_ID`** est dit « **réservé ailleurs** » (autre relevé non
  affiché). Il reste affiché, **verrouillé** (comme les réservations d'un autre utilisateur), avec son repère préfixé `<idRelevé>-<lettre>`.
- **Stockage, `LettrageGenerator`, attribution serveur des lettres (TASK-037), endpoints `reserve` / `release` / `validate` : inchangés.**
- Un seul champ back ajouté : `releveEnteteId` sur le DTO règlement (nécessaire pour afficher le préfixe et l'infobulle).

## Comportements attendus (contrat)
| Situation | Résultat attendu |
|---|---|
| `GET /api/reglements?…` — règlement réservé par une ligne de relevé | l'item contient `releveEnteteId` = id du relevé de cette ligne (en plus de `lettrage`, `reservePar_UserId`…) ; **`null`** pour un règlement non réservé. Aucun autre champ ne change. |
| Relevé X seul affiché ; règlement R réservé (par moi) sur une ligne de X | R et la ligne sont **appariés** : même couleur, cases cochées, repère = lettre nue (« A ») — **strictement identique à aujourd'hui**. |
| Même écran ; règlement R′ réservé (par moi) sur une ligne d'un **autre** relevé Y (non affiché), lettre « A » aussi | R′ : **cadenas + `#<idY>`**, grisé (même style que « réservé par un autre utilisateur »), **sans case à cocher**, repère `Y-A`. **Jamais apparié** à la ligne « A » de X. Un clic ne fait **rien** (aucun appel réseau). Infobulle : « Réservé sur le relevé #Y (non affiché) — sélectionnez ce relevé pour le dérapprocher ». |
| Règlement réservé par un **autre utilisateur** | inchangé : cadenas + nom de l'utilisateur ; si sa ligne n'est pas chargée, le repère est préfixé. |
| Clic sur une **ligne lettrée** du relevé (ou sur son règlement apparié) | `POST /ReleveBancaire/release-batch` avec **cette seule ligne** `[{ "ligneReleveId": <id> }]`. Succès → la ligne **et le règlement de même `MV_ID`** redeviennent libres. Échec → toast « Impossible de libérer la ligne (déjà libre, validée ou non autorisé). » (texte actuel). Le règlement d'un autre relevé portant la même lettre n'est **jamais** touché. |
| Clic sur une ligne lettrée dont le règlement **n'est pas dans la grille** (annulé, hors période, hors plafond) | la paire est libérée normalement (chemin de secours cité par TASK-098). |
| « Dérapprocher » | `release-batch` des lignes **lettrées de l'utilisateur** du relevé affiché ; les règlements libérés = ceux dont la ligne l'a été (par `MV_ID`) ; les règlements « réservés ailleurs » et les réservations d'autres utilisateurs sont **inchangés**. |
| « Approuver » | transmet **uniquement** les lignes lettrées **réservées par l'utilisateur** dont le règlement (même `MV_ID`) est dans la grille ; paire = `{releveLigneId: ligne.id, grcReglementId: ligne.mvId, lettrage, codeExcel, libelle, dateValeur}` (mêmes champs qu'aujourd'hui). Après la réponse, **seules** les lignes et règlements **approuvés** disparaissent ; les `failedLigneIds` restent. |
| « Approuver » avec des lignes réservées par l'utilisateur **sans règlement dans la grille** | elles ne sont **pas** envoyées, **restent à l'écran**, et le message suivant est ajouté **dans le même toast** que le résultat : « {n} ligne(s) réservée(s) n'ont pas de règlement dans la grille GRC (période ou filtre) : élargissez la période Du/Au puis réessayez. » Si aucune paire n'est envoyable, **pas d'appel `validate`** et ce message seul (type `warning`) remplace « Aucun rapprochement en cours à approuver. ». |
| « Approuver » : lignes réservées par d'autres utilisateurs | ignorées (non envoyées, **non retirées**), sans message. |
| Tri de la grille GRC | (1) lettrés **appariés** (par lettre, comme aujourd'hui), (2) « réservés ailleurs » (par `releveEnteteId` puis lettre), (3) libres (tri utilisateur éventuel, comme aujourd'hui). |
| Filtre « Repère » de la grille GRC | liste les valeurs **affichées** (`A` pour un apparié, `12-A` pour un réservé ailleurs) et filtre sur ces valeurs. |

## Ce que l'utilisateur voit changer (à relayer au PO)
1. Un règlement réservé sur un **autre relevé** apparaît **grisé avec un cadenas** et `#<numéro du relevé>` (il restait cochable et
   dissolvait une paire au hasard).
2. Après « Approuver », seules les lignes **approuvées** disparaissent (les réservations des autres postes restent visibles).
3. Un message explicite remplace l'omission silencieuse d'une ligne dont le règlement n'est pas affiché.
4. « Approuver » n'affiche plus d'erreurs pour les réservations des autres utilisateurs.

## Étapes d'implémentation

### Back (3 modifications dans `GRC.Infrastructure/Services/ReglementService.cs`)
1. `ReglementClientDto` (`:1496`, propriété `Lettrage` à `:1543`) : ajouter `public int? ReleveEnteteId { get; set; }` juste après `Lettrage`.
2. `GetReglementsPaged`, bloc des réservations (`:291-357`) — **5 endroits** :
   a. type du dictionnaire (`:291`) : `(string? Lettrage, int? EnteteId, int? UserId, string? UserName, DateTime? Date)` ;
   b. SQL (`:301`) : ajouter `ReleveBancaireEnteteId` à la liste des colonnes ;
   c. remplissage (`:312`) : `((string?)row.Lettrage, (int?)row.ReleveBancaireEnteteId, (int?)row.ReservePar_UserId, null, (DateTime?)row.DateReservation)` ;
   d. **réaffectation après résolution du nom** (`:346`) : `reservations[key] = (res.Lettrage, res.EnteteId, res.UserId, name, res.Date);`
      — **piège** : si ce site est oublié, l'entête est perdu exactement pour les règlements dont le nom d'utilisateur est résolu
      (le cas courant) et le champ reste `null` ; le scénario S8 le détecte ;
   e. appel du mapper (`:354`) : ajouter `hasRes ? res.EnteteId : null` en dernier argument.
3. `ReglementMapper.Map` (`:1593-1637`) : ajouter un paramètre **optionnel en dernier** `int? releveEnteteId = null` et
   `ReleveEnteteId = releveEnteteId,` dans l'initialiseur. (Seul appelant : `:354` — ne pas casser la signature des autres usages éventuels.)

### Front (`gocom-web/src/RapprochementBancaire.tsx` uniquement)
> Le fichier est en `// @ts-nocheck` (ligne 1) : **le build ne détecte aucune erreur de type ni aucun appelant oublié**. Les preuves
> `grep` et les scénarios E2E sont la seule protection (voir Checklist).

4. **Types** : `LigneReleve` (`:11-25`) += `releveEnteteId: number;` et `mvId: number | null;` ; `ReglementGrc` (`:27-38`) += `releveEnteteId?: number | null;`.
   (TASK-099, si déjà fusionnée, a ajouté d'autres champs optionnels : les conserver.)
5. **Mappings** : lignes (`:594-608`) += `releveEnteteId: l.releveBancaireEnteteId,` et `mvId: l.mV_ID ?? null,`. Règlements (`:487-494`) +=
   `releveEnteteId: r.releveEnteteId ?? null,` (le spread `...r` le contient déjà ; on normalise à `null`).
   **Preuve des noms JSON** : coller dans le VERIFY **une ligne réelle** de la réponse `/ReleveBancaire/{id}/lignes` montrant `mV_ID` et
   `releveBancaireEnteteId` (casse exacte, déduite de la sérialisation camelCase de .NET : `MV_ID` → `mV_ID`).
6. **Helpers** (hors composant, à côté de `getLettrageColor`) :
   ```ts
   // TASK-106 — repère affiché : "<idRelevé>-<lettre>" si withPrefix, sinon la lettre nue.
   const formatRepere = (enteteId: number | null | undefined, lettre: string | null | undefined, withPrefix: boolean): string => {
       if (!lettre) return '';
       return withPrefix && enteteId != null ? `${enteteId}-${lettre}` : lettre;
   };
   // Ordre des paires : par relevé (numérique) puis par lettre — identique à l'existant au sein d'un même relevé.
   const comparePairKey = (a: any, b: any): number => {
       const ea = a.releveEnteteId ?? 0, eb = b.releveEnteteId ?? 0;
       if (ea !== eb) return ea - eb;
       return String(a.lettrage ?? '').localeCompare(String(b.lettrage ?? ''));
   };
   ```
7. **Ensemble des règlements appariés ici** (dans le composant, près de `lignesReleveRef`) :
   ```ts
   const loadedMvIds = React.useMemo(() => {
       const s = new Set<number>();
       for (const l of lignesReleve) if (l.mvId != null) s.add(Number(l.mvId));
       return s;
   }, [lignesReleve]);
   ```
   Calculé sur **`lignesReleve` complet** (pas sur la liste filtrée) : un filtre d'affichage ne doit jamais faire passer un règlement en « réservé ailleurs ».
8. **Grille GRC — rendu** (`GrcTableRow` `:73`, `GrcTableBody` `:117`) :
   - `GrcTableBody` reçoit la nouvelle prop `loadedMvIds` (l'ajouter aussi à l'interface `GrcTableBodyProps`, `:54-63`) et calcule **par ligne** (primitives, donc compatibles avec la mémoïsation) :
     `const reservedElsewhere = !!row.lettrage && !loadedMvIds.has(row.mv_Id);`
     `const repere = formatRepere(row.releveEnteteId, row.lettrage, reservedElsewhere);`
     puis passe `reservedElsewhere` et `repere` à `GrcTableRowMemo`.
   - **Piège de mémoïsation** : `areEqual` (`:102-113`) ne compare qu'une **liste fixe de props** (`propsToCompare`, `:105`). **Ajouter
     `'reservedElsewhere'` et `'repere'` à cette liste**, sinon une ligne ne se met pas à jour quand elle passe de « appariée » à « réservée ailleurs ».
     (Si TASK-099 est fusionnée : conserver `onAnnuler` dans la liste.) Ne pas toucher à `React.memo` ni au handler `onSelect` (référence stable).
   - `GrcTableRow` : `const isLocked = isLockedByOther || reservedElsewhere;` — le **style grisé** et le **cadenas** s'appliquent si `isLocked`
     (à la place de la case à cocher). Libellé à côté du cadenas : nom de l'utilisateur si `isLockedByOther`, sinon `#${row.releveEnteteId ?? '?'}` ;
     infobulle : `Réservé par …` (existant) ou `Réservé sur le relevé #${row.releveEnteteId ?? '?'} (non affiché) — sélectionnez ce relevé pour le dérapprocher`.
     Couleur de fond d'une paire (non verrouillée) : `getLettrageColor(repere)` (en mono, `repere` = lettre nue = couleur actuelle).
   - Cellule de la colonne `lettrage` : dans `GrcTableRow`, si `key === 'lettrage'` afficher `<span className="lettrage-cell">{repere}</span>`
     (même balisage que `utils.tsx:143`) au lieu de `renderSharedCell(...)`. **Ne pas modifier `utils.tsx`** (partagé avec `App.tsx`).
   - Passer `loadedMvIds` à `<GrcTableBody …>` (`:1392`).
9. **Réservation** — mettre à jour les deux flux qui posent une lettre :
   - `executeManualLettrage` (`:746-775`) : retrouver la ligne (`lignesReleveRef.current.find(l => l.id === ligneId)`) ; après la réponse, sur la **ligne** :
     `{ …, lettrage: assignedLetter, reservePar_UserId: currentUserId, mvId: grcId }` ; sur le **règlement** :
     `{ …, lettrage: assignedLetter, reservePar_UserId: currentUserId, releveEnteteId: ligne?.releveEnteteId ?? null }`.
   - `handleAutoReconcile` (`:634-701`) : même chose pour chaque paire validée (`mvId` = `r.mvId` de la réponse du lot ; `releveEnteteId` lu sur la ligne correspondante).
     **Construire des `Map` (id → ligne, mv_Id → paire) plutôt que des `find` imbriqués** (jusqu'à plusieurs centaines de paires).
10. **Libération par ligne** — remplacer `delettrerByLettrage` (`:708-742`) par `delettrerLigne(ligne)` (`React.useCallback`, deps `[]`, n'utilise que des setters,
    `showToast` et des valeurs passées en argument) :
    ```ts
    const delettrerLigne = React.useCallback(async (ligne: LigneReleve) => {
        try {
            const userStr = sessionStorage.getItem('gocom_user');
            const token = userStr ? JSON.parse(userStr).token : '';
            const resp = await axios.post(`${API_BASE}/ReleveBancaire/release-batch`,
                [{ ligneReleveId: ligne.id }], { headers: { Authorization: `Bearer ${token}` } });
            const ok = (resp.data as Array<{ ligneReleveId: number; success: boolean }>)
                .some(r => r.ligneReleveId === ligne.id && r.success);
            if (ok) {
                setLignesReleve(prev => prev.map(l => l.id === ligne.id
                    ? { ...l, lettrage: null, reservePar_UserId: null, dateReservation: null, mvId: null } : l));
                if (ligne.mvId != null) {
                    setReglementsGrc(prev => prev.map(r => r.mv_Id === ligne.mvId
                        ? { ...r, lettrage: null, reservePar_UserId: null, dateReservation: null, releveEnteteId: null } : r));
                }
            } else {
                showToast("Impossible de libérer la ligne (déjà libre, validée ou non autorisé).", "warning");
            }
        } catch (e) { console.error(e); showToast("Erreur lors de la dissociation.", "error"); }
    }, []);
    ```
    **Supprimer** la branche de secours « aucune ligne → effacer la lettre en local » (`:709-713`) : elle est la cause du défaut n°2.
    Mettre à jour les deux appelants :
    - `handleSelectGrc` (`:831-851`) : `if (grc?.lettrage) { const ligne = lignesReleveRef.current.find(l => l.mvId === grc.mv_Id); if (ligne) delettrerLigne(ligne); return; }`
      (aucune ligne chargée ⇒ « réservé ailleurs » ⇒ **rien**, l'utilisateur ne peut pas arriver ici par la case, mais la garde reste) ; dépendances du `useCallback` : `[delettrerLigne, applyManualLettrage]`.
    - `handleSelectReleve` (`:854-873`) : `if (rel?.lettrage) { delettrerLigne(rel); return; }` ; mêmes dépendances.
11. **« Dérapprocher »** — `handleDelettrerTout` (`:878-921`) : garder la sélection `lignesToRelease` et l'appel `release-batch` tels quels ; remplacer tout le
    calcul par lettres (`failedLettres`, `fullyReleasedLettres`) par :
    ```ts
    const releasedIds = new Set(results.filter(r => r.success).map(r => r.ligneReleveId));
    const releasedMvIds = new Set(lignesToRelease.filter(l => releasedIds.has(l.id) && l.mvId != null).map(l => Number(l.mvId)));
    setLignesReleve(prev => prev.map(l => releasedIds.has(l.id) ? { ...l, lettrage: null, reservePar_UserId: null, dateReservation: null, mvId: null } : l));
    setReglementsGrc(prev => prev.map(r => releasedMvIds.has(r.mv_Id) ? { ...r, lettrage: null, reservePar_UserId: null, dateReservation: null, releveEnteteId: null } : r));
    ```
    Conserver `setSelectedGrcId(null)`, `setSelectedReleveLigneId(null)` et le toast d'échec partiel (texte actuel).
12. **« Approuver »** — `handleApprouver` (`:923-983`) :
    - `const currentUserId = Number(user?.no) || 0;` (même source que le rendu des cadenas, `:1275`/`:1392`) ;
    - lignes candidates = `lignesReleve` avec `l.lettrage && l.mvId != null && (!l.reservePar_UserId || Number(l.reservePar_UserId) === currentUserId)` ;
    - pour chacune : `const grc = grcParMvId.get(Number(l.mvId))` (`Map` bâtie sur `reglementsGrc`, **le jeu complet chargé, pas la liste filtrée d'affichage**) ;
      trouvée → paire `{ releveLigneId: l.id, grcReglementId: grc.mv_Id, lettrage: l.lettrage, codeExcel: l.code || 'MANUAL', libelle: l.libelle, dateValeur: l.dateValeurRaw }` ;
      non trouvée → `sansReglement.push(l.id)` ;
    - `pairs.length === 0` : si `sansReglement.length > 0` → toast `warning` avec le message du contrat **seul** ; sinon le toast actuel « Aucun rapprochement en cours à approuver. » ; `return` (pas d'appel `validate`) ;
    - après la réponse : `const failed = new Set<number>(data.failedLigneIds || [])` ; `approuvees = pairs.filter(p => !failed.has(p.releveLigneId))` ;
      `setLignesReleve(prev => prev.filter(l => !idsApprouves.has(l.id)))` ; `setReglementsGrc(prev => prev.filter(r => !mvApprouves.has(r.mv_Id)))` — **ni l'un ni l'autre ne retire autre chose** ;
    - toast : succès (`data.success`) « Rapprochement validé avec succès ! » ou avertissement avec `successCount`, `errorCount`, `errors` (**textes actuels conservés**) ; si `sansReglement.length > 0`,
      **ajouter à la fin du même message** le texte du contrat et utiliser le type `warning` (un seul `showToast` : le toast est **unique et disparaît après 3 s**, `App.tsx:106-110` — un second appel écraserait le premier). Type `success` seulement si `data.success` **et** aucune ligne sans règlement ;
    - le bloc `catch` (erreur HTTP) reste inchangé (aucune modification d'état).
13. **Tri, filtres, options** :
    - `getGrcCellValue` (`:990-1015`), cas `'lettrage'` : retourner `formatRepere(r.releveEnteteId, r.lettrage, !!r.lettrage && !loadedMvIds.has(r.mv_Id))` ;
    - `sortedReglements` (`:1072-1094`) : remplacer les deux premiers tests (lettré d'abord, puis comparaison des lettres) par un **rang** :
      `rang = a.lettrage ? (loadedMvIds.has(a.mv_Id) ? 0 : 1) : 2` ; si les rangs diffèrent → `rangA - rangB` ; si `rang < 2` → `const c = comparePairKey(a, b); if (c !== 0) return c;` ; la suite (tri utilisateur `grcSort`) est inchangée ;
    - **dépendances des `useMemo`** : le fichier désactive `react-hooks/exhaustive-deps` sur ces mémos ; **ajouter `loadedMvIds` aux dépendances** de `filteredReglements` (`:1051`), `sortedReglements` (`:1094`) et `grcFilterOptionsMap` (`:1125`),
      sinon le filtre/tri/options restent périmés après une réservation ou une libération ;
    - `sortedLignes` (`:1096-1111`) : **inchangé** dans cette TASK.
14. **À ne pas toucher** : `pairedLettrages`, `isPaired`, `currentLettrageIndex`, `getIndexFromLettrage` et l'effet `:620-632` sont du **code mort** (jamais lus) — les laisser tels quels (nettoyage hors périmètre) ; `utils.tsx` ; `renderSharedCell` ; `DEFAULT_COLUMNS` ; le sélecteur de relevé (`<select>`, `:1177-1187`) ; tout endpoint de réservation/validation.

## Jeu d'essai (base de TEST uniquement — jamais la prod)
Comptes : **U1** et **U2**, non-admin, même société, droits sur les caisses des règlements de test (un admin facultatif). Banque de test **B**.
Sens **crédit** uniquement (règle PO). Les montants sont **uniques** : vérifier par `SELECT` qu'aucun autre règlement non pointé de la banque B ne porte ces montants, sinon les décaler.
Les relevés se créent par `INSERT` dans les tables `RAPP_*` **de l'application** (autorisé en base de test ; **jamais** d'`INSERT`/`UPDATE` sur les tables métier GRC `RT_*`/`F_*` ; les règlements se créent par l'application : « Générer règlement » depuis une ligne de relevé (TASK-060) ou l'écran de génération) :
```sql
-- BASE DE TEST. Un relevé = 1 entête + ses lignes (crédit : Debit = 0, MontantReel = Credit).
DECLARE @B int = <id banque de test>;
INSERT dbo.RAPP_ReleveBancaire_Entete (BanqueId, Titre, DateImport, ImportePar_UserId) VALUES (@B, N'T106-RX', GETDATE(), N'test');
DECLARE @RX int = SCOPE_IDENTITY();
INSERT dbo.RAPP_ReleveBancaire_Ligne (ReleveBancaireEnteteId, DateOperation, DateValeur, Libelle, Reference, Code, Debit, Credit, MontantReel)
VALUES (@RX, GETDATE(), GETDATE(), N'T106 X1', N'X1', N'X1', 0, 1101.00, 1101.00),
       (@RX, GETDATE(), GETDATE(), N'T106 X2', N'X2', N'X2', 0, 1102.00, 1102.00),
       (@RX, GETDATE(), GETDATE(), N'T106 X3', N'X3', N'X3', 0, 1103.00, 1103.00),
       (@RX, GETDATE(), GETDATE(), N'T106 X4', N'X4', N'X4', 0, 1104.00, 1104.00);
-- idem pour RY (Y1..Y4 = 2201,00 / 2202,00 / 2203,00 / 2204,00) et pour RN (N1..N3 = 9001,00 / 9002,00 / 9003,00).
```
Relevés **neufs** (aucune lettre présente) : la première réservation de chacun reçoit « A » — c'est ce qui rend la collision reproductible.

**Lot N** (non-régression mono) : relevé **RN** (N1 9 001,00 · N2 9 002,00 · N3 9 003,00) ; virements libres **RN1/RN2/RN3** de mêmes montants.
**Lot C** (collision) : relevés **RX** (X1…X4 : 1 101,00 · 1 102,00 · 1 103,00 · 1 104,00) et **RY** (Y1…Y4 : 2 201,00 · 2 202,00 · 2 203,00 · 2 204,00), banque B ;
virements non pointés, non annulés, banque B : **R1** 1 101,00 · **R2** 1 102,00 · **R3** 2 201,00 · **R4** 2 202,00 · **R5** 1 103,00 **daté de 30 jours avant aujourd'hui**
(changer la date avec « Modifier » du règlement, TASK-086, **avant** toute réservation) · **R6** 2 203,00 · **R7** 1 104,00 · **R8** 2 250,00 (montant volontairement différent de Y4 = 2 204,00).
Dans les scénarios, `<RX>` (resp. `<RY>`) désigne l'**identifiant numérique réel** du relevé RX (resp. RY), par exemple `#247`.
Consigner dans le VERIFY les identifiants réels (RN, RX, RY, R1…R8, N1…) et la base utilisée.
**Remise à l'état initial** : entre deux scénarios, libérer les lignes réservées (`release-batch` ou « Dérapprocher »), sauf indication contraire. Les scénarios qui **approuvent** (S1 après correctif, S3, S4) consomment leurs règlements : recréer les règlements concernés (ou un lot neuf) avant de rejouer.

**Méthode de test** : back = appels API réels sur la base de test de l'application (chaîne de connexion hors dépôt : `appsettings.Development.json`, user-secrets ou variables d'environnement ; commandes `Invoke-RestMethod`/`curl` ou script jetable) + `SELECT` via `sqlcmd` (mot de passe dans `SQLCMDPASSWORD`, jamais dans un fichier) ;
front = Playwright **contre l'API réelle** dans `gocom-web/e2e_task106.cjs` (+ script `"test:e2e-106"` dans `package.json`), même esprit que `e2e_task097.cjs` mais **sans mock** pour les scénarios d'intégration
(les mocks `page.route` restent autorisés pour S10 et pour simuler une coupure réseau). Identifiants de test lus dans des variables d'environnement (`GRC_E2E_USER1`, `GRC_E2E_PASS1`, `GRC_E2E_USER2`, `GRC_E2E_PASS2`, `GRC_E2E_BASE_URL`) :
**jamais dans le script, le VERIFY ou un log**. Captures d'écran dans `tasks/VERIFY/`.

## Scénarios de test (à rejouer par le worker ; résultat + preuve + date dans le VERIFY)
- **S0 Défaut reproduit AVANT correctif** (code non modifié) : lot C. U1 : relevé RX, réserver X1↔R1 (→ « A ») ; sélectionner RY : R1 apparaît lettré « A » ; réserver Y1↔R3 (→ « A ») ;
  cliquer sur R1. **Constat attendu (avant)** : `release-batch` part avec **Y1** (mauvaise ligne) ; `SELECT` : Y1 libérée, X1 inchangée. Captures + `SELECT`. Remettre l'état (libérer X1 depuis RX).
- **S1 Non-régression mono (lot N)** : relevé RN seul. Réserver N1↔RN1 et N2↔RN2 à la main, lancer « Auto » (N3↔RN3). **Avant** (code d'origine, **sans approuver**) puis **après** : lettres, couleurs, ordre des lignes, cases cochées **identiques**
  (captures comparées). Après correctif : « Approuver » → 3 paires approuvées (`successCount = 3`), lignes et règlements disparus, `GET /reglements` montre `isPointe = true`.
- **S2 Collision corrigée (lot C, après correctif)** : refaire les étapes de S0. Attendu : à l'arrivée sur RY, **R1 = cadenas `#<RX>`, grisé, sans case, repère `<RX>-A`** ; après la réservation, **R3 est apparié à Y1 seulement** ; `SELECT` : deux lignes `Lettrage = 'A'` d'entêtes **différents**.
  Clic sur R1 : **aucun appel réseau** (onglet Réseau) ; clic sur la ligne Y1 : `release-batch` avec `[Y1]` **uniquement** ; `SELECT` : Y1 libre, X1 toujours réservée (`MV_ID` = R1). Ré-réserver Y1↔R3 pour la suite.
- **S3 Approuver avec collision** (suite de S2) : sur RY, réserver aussi Y2↔R4 (→ lettre suivante). « Approuver » : le corps de `validate` = **exactement** `(Y1,R3)` et `(Y2,R4)` (onglet Réseau) ; réponse `success`, **aucune erreur** ; R1 **reste affiché** « réservé ailleurs » ;
  `SELECT` : Y1 et Y2 `DateValidation` renseignée, X1 toujours en cours ; `GET /reglements` : R3, R4 pointés, R1 non pointé.
- **S4 Réservation d'un autre utilisateur** : U2 réserve X2↔R2 sur RX (non approuvé). U1 ouvre RX : X2/R2 **verrouillés** (cadenas + nom de U2) ; X1↔R1 (U1, issu de S3) apparié. U1 « Approuver » : corps de `validate` = `(X1,R1)` **seulement**, **aucun message d'erreur** ;
  X2/R2 restent verrouillés et **visibles** ; `SELECT` : X2 toujours réservée par U2.
- **S5 Règlement hors grille** : U1 élargit « Du » (35 jours avant) + Actualiser, réserve X3↔R5, puis remet la période par défaut + Actualiser : R5 **absent** de la grille, X3 toujours lettrée. « Approuver » : **aucun appel `validate`**, toast = message du contrat (n = 1) ;
  X3 **reste** à l'écran. Cliquer sur X3 : `release-batch [X3]`, paire libérée (chemin de secours). Variante : élargir la période puis « Approuver » → X3↔R5 approuvée.
- **S6 Tri et filtre** (RY affiché) : état = Y3↔R6 réservé par U1 (RY), R7 réservé par U1 sur RX (→ « réservé ailleurs »), R8 libre. Ordre de la grille GRC : **R6 (apparié)**, puis **tous les règlements « réservés ailleurs »** (ici R7 et, si S4 a laissé la réservation de U2, R2 — verrouillé au nom de U2, repère préfixé), triés par relevé puis par lettre, **puis les libres** (dont R8).
  Filtre « Repère » GRC : propose `<lettre de Y3>` (R6) et les repères préfixés `<RX>-<lettre>` des règlements « ailleurs » ; sélectionner chaque valeur ne montre que la ligne correspondante. (Préparer R7 : réserver X4↔R7 depuis RX, revenir sur RY.)
- **S7 Dérapprocher** (suite de S6, RY affiché) : « Dérapprocher » : `release-batch` avec **Y3 uniquement** ; `SELECT` : Y3 libre, X4 **toujours réservée** (`MV_ID` = R7) ; R7 reste « réservé ailleurs » ; R6 libre.
- **S8 API `GET /reglements`** : R7 (réservé, nom d'utilisateur résolu) → `releveEnteteId = <RX>` **non nul** (piège de la réaffectation `:346`) ; un règlement libre → `null` ; comparaison du JSON avant/après : **seul** ce champ est ajouté.
- **S9 Écart de montant (TASK-090)** : RY, sélectionner Y4 (2 204,00) et R8 (2 250,00) → bandeau « Mettre à jour le montant et rapprocher » ; confirmer → R8 passe à 2 204,00, la paire est réservée, **`mvId` renseigné** (la ligne se libère ensuite par un clic) ; libérer ensuite.
- **S10 Mémoïsation et performance** (mock `page.route` : 1 000 règlements GRC, dont 50 réservés) : sélectionner une ligne ne ré-affiche pas toute la grille (profileur React, ou `console.count` temporaire **retiré ensuite**) ; temps d'ouverture de l'écran comparable à l'avant (mesure consignée) ;
  une réservation ne ré-affiche que les 2 lignes concernées.
- **S11 Données réelles** (seulement si la base de test est une copie récente de la prod) : les 5 réservations en cours (lignes 1479, 5108, 19291, 23925, 25747 ; relevés 4, 41, 154, 180, 205) s'affichent sans erreur, appariées quand leur relevé est sélectionné, « réservées ailleurs » sinon ; sinon consigner « non vérifié : pas de copie prod ».
- **S12 Preuve par le code** : `grep -n "delettrerByLettrage" gocom-web/src/RapprochementBancaire.tsx` → **0** résultat ; aucune expression ne compare la lettre d'une ligne à celle d'un règlement (`grep -n "lettrage ===\|\.lettrage ==" …` commenté ligne par ligne dans le VERIFY : ne restent que l'affichage, la couleur, le tri et les filtres) ;
  `git diff` montre `areEqual`/`propsToCompare` mis à jour.

## Risques et points d'attention
- **Mémoïsation** : grille jusqu'à 1 000 lignes ; `areEqual` à liste fixe (voir étape 8). Une prop oubliée = ligne jamais rafraîchie ; S10 est obligatoire.
- **`@ts-nocheck`** : un appelant oublié de `delettrerByLettrage` (supprimée) provoquerait une `ReferenceError` **à l'exécution** seulement ; S12 + les scénarios couvrent tous les appelants (`handleSelectGrc`, `handleSelectReleve`).
- **Tuple réaffecté** (`ReglementService.cs:346`) : le champ serait `null` pour les règlements à nom résolu ; S8.
- **Instantané désynchronisé** : les deux grilles sont chargées à des instants différents ; une réservation faite par le **même** utilisateur depuis un autre onglet apparaît « réservée ailleurs » jusqu'au rechargement de la grille Relevé. Acceptable, auto-cicatrisant (Actualiser / changer de relevé).
- **Changement visible** : les règlements réservés sur un autre relevé deviennent non cochables (voir « Ce que l'utilisateur voit changer »).
- **Toast unique de 3 s** : les messages d'« Approuver » restent courts ; ne pas ajouter d'appel `showToast` successif.
- **Ordre GRC** : les règlements « réservés ailleurs » ne sont plus mêlés aux paires ; conséquence voulue (l'alignement des paires entre les deux grilles est préservé).
- **Ordre de déclaration (zone morte temporelle)** : `loadedMvIds` (`useMemo`) doit être déclaré **avant** tout `useMemo`/`useCallback` qui le cite dans son tableau de dépendances (`filteredReglements`, `sortedReglements`, `grcFilterOptionsMap`, ~`:1032-1125`) : l'emplacement indiqué (près de `lignesReleveRef`, `:283`) convient ; le déclarer plus bas provoque une `ReferenceError` au premier rendu que `@ts-nocheck` ne signale pas. Idem `delettrerLigne` avant `handleSelectGrc` / `handleSelectReleve`.
- **Survol (correctif inclus, 1 ligne)** : `.lettered-row:hover` passait une ligne verrouillée au vert. Dans les 2 `<tr>` de `GrcTableRow` (recherche `'lettered-row'` dans `RapprochementBancaire.tsx`, 2 occurrences), ne poser la classe `lettered-row` que si la ligne n'est **pas** verrouillée : `row.lettrage && !isLockedByOther ? 'lettered-row' : …`. Aucun changement CSS. Preuve : capture S2, souris sur R1 « réservé ailleurs » = reste grisée.
- **`currentUserId`** : toujours `Number(user?.no)` (props) dans `handleApprouver`, comme le rendu ; les autres handlers lisent `sessionStorage` (inchangé).

## Coordination avec les autres TASKs du rapprochement
- **TASK-098** (back) d'abord : elle modifie `ReglementService.cs` (`:70`, `:414`) et `ReleveBancaireRepository`/`Controller`, **pas** les lignes de la présente TASK. Son « chemin de secours » (`delettrerByLettrage`) devient ici **`delettrerLigne`** : même comportement (cliquer la ligne lettrée du relevé libère la paire, même si le règlement a disparu de la grille).
- **TASK-099** (front) **avant** celle-ci : elle modifie `GrcTableRow`, `GrcTableBody`, `areEqual`/`propsToCompare`, l'interface `ReglementGrc` et l'en-tête. À la fusion : conserver « Sel. » en 1ʳᵉ colonne, `onAnnuler` dans `propsToCompare`, les champs optionnels ajoutés à `ReglementGrc`.
  Sa règle « bouton Annuler désactivé si le règlement est réservé (`lettrage` ou `reservePar_UserId`) » reste vraie pour les règlements « réservés ailleurs ».
- **TASK-102** (filtres de date) et **TASK-101** (export) : pas de recouvrement fonctionnel ; conflit de fusion possible sur `filteredReglements` / `<thead>`. TASK-101 devra exporter le **repère affiché** (`formatRepere`), pas `lettrage` brut.
- **TASK-100** (multi-relevés) **dépend** de celle-ci : elle réutilise `formatRepere`, `comparePairKey`, `loadedMvIds`, `delettrerLigne`.

## Contraintes
- Ne jamais bypasser une règle de sécurité ni une DLL métier GRC. Aucun `UPDATE` SQL sur une table métier GRC. Aucun secret en dur.
- Respecter la Clean Architecture (Domain ← Application ← Infrastructure/API).
- **Aucune modification** de `reserve`, `reserve-batch`, `release`, `release-batch`, `validate`, `auto-reconcile`, `AutoReconciliationEngine`, `LettrageGenerator`, du schéma SQL, de `utils.tsx`.
- Grilles : réutiliser `ExcelFilter.tsx` et le pattern colonnes (`ARCHITECTURE.md` § Grilles de données) ; aucun nouveau composant de grille.
- Aucune nouvelle dépendance npm/NuGet.
- **Le worker s'arrête au dépôt du VERIFY** : `tasks/VERIFY/TASK-106_verify.md` (emplacement des dernières TASKs, ex. `tasks/VERIFY/TASK-097_verify.md`). Il ne clôt pas la TASK : pas de déplacement vers `DONE_DETAIL/`, pas de mise à jour de `DONE.md` / `TODO.md` / `CHANGELOG.md`, aucun message de commit contenant « approuve ».

## Fichiers concernés
- `GRC.Infrastructure/Services/ReglementService.cs` (`ReglementClientDto`, `GetReglementsPaged` bloc réservations, `ReglementMapper.Map`)
- `gocom-web/src/RapprochementBancaire.tsx` (types, mappings, helpers, `GrcTableRow`, `GrcTableBody`, `areEqual`, `executeManualLettrage`, `handleAutoReconcile`, `delettrerLigne`, `handleSelectGrc`, `handleSelectReleve`, `handleDelettrerTout`, `handleApprouver`, `getGrcCellValue`, `sortedReglements`, mémos)
- `gocom-web/e2e_task106.cjs` (nouveau) et `gocom-web/package.json` (script `test:e2e-106`)

## Checklist VALIDATION (VERIFY : preuve datée par critère — capture, réponse API, sortie SQL ou extrait de log)
- [ ] Build back + front OK, 0 erreur ; `npm run lint` 0 erreur (preuve : sorties)
- [ ] S0 défaut reproduit avant correctif (preuve : captures + `SELECT`)
- [ ] S1 mono identique avant/après ; approbation de 3 paires OK (preuve : captures comparées + réponse `validate`)
- [ ] S2 collision corrigée : R1 « réservé ailleurs », pas d'appariement croisé, libération de la seule bonne ligne (preuve : captures + onglet Réseau + `SELECT`)
- [ ] S3 approbation avec collision : corps `validate` exact, aucune erreur, R1 conservé à l'écran (preuve : corps/réponse + `SELECT` + `GET /reglements`)
- [ ] S4 réservations d'autres utilisateurs ignorées, non retirées, sans message d'erreur (preuve : corps de `validate` + capture)
- [ ] S5 ligne sans règlement affiché : aucun appel `validate`, message exact, ligne conservée, libération par clic OK (preuve : captures + onglet Réseau)
- [ ] S6 tri en 3 rangs et filtre « Repère » sur valeurs affichées (preuve : captures)
- [ ] S7 « Dérapprocher » ne touche que la bonne ligne (preuve : corps `release-batch` + `SELECT`)
- [ ] S8 `releveEnteteId` non nul pour un règlement à nom résolu, `null` pour un libre, aucun autre champ modifié (preuve : JSON avant/après)
- [ ] S9 écart de montant : `mvId` renseigné, libération ultérieure OK (preuve : captures + `SELECT`)
- [ ] S10 pas de re-rendu global ; `propsToCompare` mis à jour ; temps d'ouverture comparable (preuve : mesure + extrait de diff)
- [ ] S11 données réelles ou « non vérifié : pas de copie prod » (preuve : captures ou mention)
- [ ] S12 `grep` : 0 `delettrerByLettrage`, aucune comparaison lettre ↔ lettre (preuve : sortie annotée)
- [ ] Noms JSON `mV_ID` / `releveBancaireEnteteId` prouvés par une réponse réelle
- [ ] Aucun `console.count`/log de debug laissé (preuve : `git diff`)
- [ ] Aucun credential/secret en dur introduit (scripts E2E compris)
- [ ] Aucune dette technique silencieuse
- [ ] Cohérent avec l'architecture

## Go / No-Go
**No-Go si** S2, S3, S4, S5, S7 ou S10 ne sont pas prouvés : ce sont les cas qui protègent la base en production (mauvaise paire libérée ou approuvée) et la performance de l'écran le plus utilisé.
