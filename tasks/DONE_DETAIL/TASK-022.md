# TASK-022 — Marquer les lignes relevé validées (pushées en GRC) pour ne plus les afficher

- **Priorité** : 🟠 Majeur (une ligne réellement rapprochée en GRC réapparaît indéfiniment dans l'espace de travail)
- **Domaine** : Backend / DB — justesse de l'état de rapprochement
- **Statut** : TODO
- **Dépend de** : TASK-016 (réservation persistée), TASK-020 (validation sans `TransactionScope`), TASK-019 (grille GRC en `pointe=false`)

## Contexte
Modèle 2 phases (mémoire projet « rapprochement-reservation-2-phases ») : Phase 1 réserve la ligne relevé + le règlement GRC (`Lettrage`/`MV_ID` dans `RAPP_ReleveBancaire_Ligne`) ; Phase 2 (« Approuver ») pointe le règlement GRC via la DLL.

## Problème constaté
`SauvegarderValidationAsync` (Phase 2) pose `reg.IsPointe = true` sur le règlement GRC mais **ne touche jamais la ligne relevé** ([ReleveBancaireRepository.cs:166-231](../GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs#L166-L231)). La ligne relevé conserve `Lettrage`/`MV_ID` et **aucune notion de « finalisée »**.

Conséquence au rechargement :
- **Relevé** — `GetAllLignesExcelAsync` fait un `SELECT *` ([ReleveBancaireRepository.cs:106-114](../GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs#L106-L114)) → la ligne validée **réapparaît lettrée**, comme si le rapprochement était encore « en cours ».
- **GRC** — le règlement, désormais pointé, est **exclu** par `pointe=false` (TASK-019).

→ Asymétrie : une ligne relevé réellement rapprochée/pushée en GRC reste affichée sans contrepartie visible. Il manque, côté `RAPP_ReleveBancaire_Ligne`, l'équivalent du `IsPointe` du règlement.

## Objectif
Ajouter un **statut de validation** sur la ligne relevé, positionné lors du pointage Phase 2 réussi, et **exclure les lignes validées** de l'espace de travail (grille relevé + auto-rapprochement). Après « Approuver », la ligne disparaît des deux grilles et **ne revient pas** au refresh — symétrique avec `pointe=false` côté GRC.

## Fichiers concernés
- **Migration SQL** (nouveau script, ex. `SQL_003_TASK-022_ValidationLigne.sql`)
- `GRC.Domain/Entities/ReleveBancaireLigne.cs` (nouvelle propriété)
- `GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs` (pose du statut en Phase 2, exclusion à la lecture, garde sur release)

## Étapes d'implémentation

### 1. Migration — colonne de validation
Ajouter une colonne nullable servant à la fois de marqueur et d'audit :
```sql
ALTER TABLE dbo.RAPP_ReleveBancaire_Ligne
    ADD DateValidation DATETIME NULL;   -- NULL = en cours ; renseignée = pushée/pointée en GRC
```
> `DATETIME NULL` préféré à un simple `BIT` : sert de piste d'audit (quand la ligne a été finalisée), cohérent avec `DateReservation`.

### 2. Entité
Ajouter `public DateTime? DateValidation { get; set; }` sur `ReleveBancaireLigne`.

### 3. Poser le statut en Phase 2 (validation réussie uniquement)
Dans `SauvegarderValidationAsync`, **après** le pointage DLL réussi d'une paire (`repo.Update(reg)` → `SuccessCount++`), marquer la ligne relevé correspondante.
- Recommandé : **collecter les `ReleveLigneId` réellement pointés**, puis, **après** la boucle DLL, ouvrir **une** connexion et faire un seul `UPDATE … SET DateValidation = GETDATE() WHERE Id IN @Ids`.
- ⚠️ Respect **TASK-020** : pas de `TransactionScope`, jamais deux connexions ouvertes simultanément (l'`UPDATE` se fait sur une connexion ouverte **après** fermeture de la connexion DLL). Éviter toute promotion MSDTC.
- Ne marquer que les paires en succès (une paire en échec DLL reste « en cours »).

### 4. Exclure les lignes validées à la lecture
Dans `GetAllLignesExcelAsync`, ne remonter que les lignes non finalisées :
```sql
SELECT * FROM dbo.RAPP_ReleveBancaire_Ligne
WHERE ReleveBancaireEnteteId = @EnteteId AND DateValidation IS NULL
ORDER BY DateOperation ASC;
```
→ Impacte l'affichage relevé **et** l'auto-rapprochement (qui consomme la même méthode, [ReleveBancaireController.cs:83](../GRC.API/Controllers/ReleveBancaireController.cs#L83)) : les lignes finalisées ne sont plus proposées ni comptées dans la reprise d'index de lettrage — comportement voulu.

### 5. Garde sur la libération
`LibererLigneAsync` : ajouter `AND DateValidation IS NULL` au `WHERE` pour interdire de « dissocier » une ligne déjà finalisée ([ReleveBancaireRepository.cs:137-149](../GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs#L137-L149)). (Défensif : ces lignes ne s'afficheront plus, donc le cas ne devrait pas survenir depuis l'UI.)

### 6. (Optionnel) Backfill des lignes déjà pushées
Marquer les lignes existantes dont le règlement est **déjà pointé** :
```sql
UPDATE l SET l.DateValidation = GETDATE()
FROM dbo.RAPP_ReleveBancaire_Ligne l
JOIN dbo.RT_MOUVEMENT m ON m.MV_Id = l.MV_ID
WHERE l.MV_ID IS NOT NULL AND l.DateValidation IS NULL AND m.MV_Point = 1;
```
> Sur la base de test actuelle, aucune ligne C-F n'est concernée (règlements non pointés) — ce backfill ne vise que d'éventuelles paires réellement approuvées.

## Contraintes
- **Ne pas effacer** `Lettrage`/`MV_ID` lors de la validation : les conserver préserve (a) la piste d'audit et (b) la garde d'unicité `NOT EXISTS(MV_ID)` du `reserve` (empêche de re-réserver un règlement déjà pointé). On **ajoute** un marqueur, on ne nettoie pas.
- `RAPP_ReleveBancaire_Ligne` est une table applicative (pas pilotée par la DLL GRC) : `UPDATE` SQL direct autorisé — contrairement aux tables métier GRC.
- Aucune écriture sur une table GRC en dehors du pointage DLL déjà existant.
- **TASK-020** : aucune `TransactionScope`, pas de promotion MSDTC.
- Clean Architecture (Domain ← Application ← Infrastructure/API).

## Risques / dépendances
- Vérifier que la pose du `DateValidation` est atomique par rapport au succès DLL : une paire pointée en GRC **doit** finir marquée (sinon la ligne reviendrait). Si l'`UPDATE` groupé post-boucle échoue, remonter l'erreur (ne pas laisser un état incohérent silencieux).
- La reprise d'index de lettrage (`startIndex = max+1`) ne verra plus les lettres des lignes finalisées → réutilisation possible de lettres libérées : sans impact (les lignes finalisées ne s'affichent plus).
- Cohérence visuelle : après « Approuver », les deux grilles doivent se vider de la paire (relevé via `DateValidation`, GRC via `pointe=false`).

## Checklist VALIDATION (à remplir dans VERIFY/)
- [ ] Build OK + migration appliquée (colonne `DateValidation` présente)
- [ ] Après « Approuver » : la/les ligne(s) relevé validée(s) **disparaissent** de la grille relevé
- [ ] Après refresh : elles **ne réapparaissent pas** (état finalisé persistant)
- [ ] `Lettrage`/`MV_ID` de la ligne validée **conservés** en base (audit + garde d'unicité intacte)
- [ ] Une paire en **échec** de pointage reste « en cours » (non marquée)
- [ ] `release` refuse une ligne validée (`DateValidation` renseignée)
- [ ] Auto-rapprochement ne propose plus les lignes validées
- [ ] `validate` renvoie toujours `200` (aucune régression MSDTC/TASK-020)
- [ ] Symétrie confirmée : paire finalisée absente **des deux** grilles
