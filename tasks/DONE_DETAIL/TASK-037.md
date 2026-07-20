# TASK-037 — Unicité de la lettre de rapprochement (allocation serveur calculée + garde-fou base + remédiation)

- **Priorité** : 🔴 Majeur (justesse du rapprochement + concurrence multi-postes)
- **Domaine** : Backend / DB / Front
- **Dépend de** : TASK-016 (réservation persistée), TASK-017 (front consommant reserve)

## Contexte
Bug remonté par le PO (session admin) : quand **deux utilisateurs travaillent sur le même relevé** et réservent chacun une ligne, ils peuvent obtenir **la même lettre** (« repère »). Résultat : des **doublons de lettrage**, et — plus grave — un **rapprochement faux** à l'approbation (voir ci-dessous).

Cause racine (chaîne reconstituée) :
- La lettre est un **compteur séquentiel calculé côté navigateur**, propre à chaque session. Au chargement : `currentLettrageIndex = maxIndex + 1` sur les lettrages déjà en base ([RapprochementBancaire.tsx:420-429](../gocom-web/src/RapprochementBancaire.tsx#L420)).
- La lettre est générée localement (`getLettrageFromIndex`) puis **envoyée telle quelle** au serveur (`executeManualLettrage` [RapprochementBancaire.tsx:530](../gocom-web/src/RapprochementBancaire.tsx#L530) ; boucle auto `handleAutoReconcile` [RapprochementBancaire.tsx:460-474](../gocom-web/src/RapprochementBancaire.tsx#L460)).
- Le endpoint `/reserve` **fait confiance** à `request.Lettrage` et l'écrit sans contrôle ([ReleveBancaireController.cs:169-187](../GRC.API/Controllers/ReleveBancaireController.cs#L169), [ReleveBancaireRepository.cs:213-231](../GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs#L213)).
- En base, l'unique index ne porte que sur `MV_ID` ([SQL_002_TASK-016_Reservation.sql:7](../SQL_002_TASK-016_Reservation.sql#L7)) — **rien** sur `Lettrage`.

Deux clients ouvrant le même relevé « vierge » partent tous deux à `A` → chacun réserve une ligne différente → **deux paires portent `A`**.

### Pourquoi c'est grave : la lettre est PORTEUSE pour l'approbation
La lettre n'est **pas** poussée dans GRC (à la validation le règlement reçoit `ExtraitNum`/`Info1`/`PieceNumero = CodeExcel`, `DatePointage`, `IsPointe` — [ReleveBancaireRepository.cs:330-337](../GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs#L330)). **Mais** l'approbation **reconstruit les paires en matchant sur la lettre** :
```js
const grc = reglementsGrc.find(r => r.lettrage === ligne.lettrage);   // RapprochementBancaire.tsx:646
```
Si deux lignes partagent `A`, le `.find` renvoie **le premier** règlement portant `A` → risque de **pointer le mauvais règlement en GRC**. L'unicité de la lettre par relevé est donc une **condition de justesse comptable**, pas un confort d'affichage.

## Objectif
Faire de l'attribution de la lettre une **valeur calculée côté serveur** (pas un index/identité/compteur DB), scellée par un garde-fou base, et **nettoyer les doublons déjà créés** avant de poser la contrainte.

1. **Remédiation** des doublons `(ReleveBancaireEnteteId, Lettrage)` existants (renumérotation).
2. **Garde-fou base** : index UNIQUE filtré `(ReleveBancaireEnteteId, Lettrage)` — **simple dernier rempart**, il ne distribue aucune lettre.
3. **Allocation serveur calculée** : `/reserve` **ignore** la lettre proposée par le client, calcule la prochaine lettre libre du relevé **à partir des lettres réellement présentes**, de façon sérialisée par relevé, et **renvoie la lettre attribuée**.
4. **Client** : adopte la lettre du retour au lieu de son compteur local (manuel + auto).

### Décision d'ordonnancement (impérative)
La remédiation (étape 1) **doit précéder** la création de l'index unique (étape 2) : sinon la création échoue sur les doublons existants. Ordre : **1 → 2 → 3 → 4**.

### Décisions actées avec le PO
- **Pas de colonne compteur / séquence / identité DB** pour la lettre : elle reste une valeur métier `A, B, C…` **calculée** à partir des lettres présentes.
- On **conserve** un index UNIQUE en base **uniquement comme filet** (si un doublon passait malgré tout, l'écriture échoue au lieu de corrompre).

## Fichiers concernés
- **Migration SQL** (nouveau fichier, convention repo `SQL_00X_TASK-037_*.sql`) : remédiation + index unique.
- `GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs` : `ReserverLigneAsync` (calcul + verrou + retour lettre).
- `GRC.API/Controllers/ReleveBancaireController.cs` : `ReserveRequest` (`Lettrage` optionnel/ignoré), retour de la lettre attribuée.
- `gocom-web/src/RapprochementBancaire.tsx` : `executeManualLettrage`, `handleAutoReconcile` — utiliser la lettre du retour.
- `GRC.Application/Services/LettrageGenerator.cs` : réutilisé tel quel (index ↔ lettre, base 26).

## Étapes d'implémentation

### 1. Remédiation des doublons (AVANT l'index)
- Détecter les groupes `(ReleveBancaireEnteteId, Lettrage)` avec `Lettrage IS NOT NULL` et `COUNT(*) > 1`.
- Pour chaque groupe : garder **une** ligne, **renuméroter** les autres avec des lettres neuves du relevé (au-delà de la lettre max existante de l'entête), en réutilisant l'algo base 26 de `LettrageGenerator`.
- La paire est portée par la **ligne** (`Id` relevé + `MV_ID` GRC sur la même ligne) : renuméroter la lettre d'une ligne **ne casse pas** l'appariement stocké. Journaliser chaque renumérotation (`Id`, entête, ancienne → nouvelle lettre).
- ⚠️ Vérifier avant exécution qu'aucun **rapprochement en cours non validé** ne serait rendu incohérent côté front après renumérotation (la lettre y sert de clé de matching) : la remédiation vise les données **persistées** ; prévenir les utilisateurs actifs / la lancer hors session.

### 2. Garde-fou base — index unique filtré
```sql
CREATE UNIQUE INDEX UX_RAPP_Ligne_Entete_Lettrage
    ON dbo.RAPP_ReleveBancaire_Ligne (ReleveBancaireEnteteId, Lettrage)
    WHERE Lettrage IS NOT NULL;
```
(L'index non-unique `IX_RAPP_Ligne_Lettrage` existant peut rester. **Aucune** colonne ajoutée.)

### 3. Allocation serveur calculée et sérialisée (dans `ReserverLigneAsync`)
Transaction, avec verrou applicatif **par relevé** le temps du calcul + écriture (empêche deux réservations concurrentes de lire le même « max ») :
1. Dériver `@enteteId` depuis la ligne.
2. `EXEC sp_getapplock @Resource = 'rapp_lettrage_' + CAST(@enteteId AS varchar), @LockMode='Exclusive', @LockOwner='Transaction';`
3. `SELECT` des lettres présentes du relevé → calcul de la **prochaine libre** en C# (`LettrageGenerator`, base 26).
4. **UPDATE conditionnel** de la ligne (structure inchangée, lettre = valeur serveur) :
   ```sql
   UPDATE dbo.RAPP_ReleveBancaire_Ligne
   SET Lettrage=@lettreServeur, MV_ID=@mvId, ReservePar_UserId=@uid, DateReservation=GETDATE()
   OUTPUT INSERTED.*
   WHERE Id=@ligneReleveId AND Lettrage IS NULL
     AND NOT EXISTS (SELECT 1 FROM dbo.RAPP_ReleveBancaire_Ligne x WHERE x.MV_ID=@mvId);
   ```
5. `rowcount = 0` → rollback → **409**. `rowcount = 1` → commit, renvoyer la ligne (avec `Lettrage`).
- **Batch auto-réconciliation** : la boucle front appelle `/reserve` par paire ; chaque appel calcule/verrouille atomiquement → lettres distinctes garanties. Pas d'endpoint batch requis.
- L'index unique (étape 2) reste le filet ultime si le verrou était contourné par un futur chemin de code.

### 4. Front — adopter la lettre serveur
- `executeManualLettrage` : ne plus envoyer de lettre (ou l'ignorer côté API) ; à la réponse `200`, poser **`response.data.lettrage`** sur les 2 grilles au lieu de `nextLetter`. `currentLettrageIndex` cesse d'être la source de vérité.
- `handleAutoReconcile` : ne plus pré-générer `localLettrage` ; pour chaque réservation réussie, appliquer la lettre renvoyée (matcher par `Id` de ligne / `MV_ID`).
- `ReserveRequest.Lettrage` : **optionnel/ignoré** côté serveur.

## Contraintes
- **Aucun bypass DLL GRC** : la base GRC n'est pas touchée par ce lot (lettre = repère applicatif).
- `reserve`/remédiation = opérations sur `RAPP_ReleveBancaire_*` **uniquement** (tables applicatives).
- **Atomicité obligatoire** : calcul + write sous verrou dans une transaction ; pas de check-then-act.
- **Pas de compteur/séquence/identité DB** pour la lettre (décision PO).
- Respect Clean Architecture : Domain ← Application ← Infrastructure/API.
- Aucune régression de l'algo auto (`AutoReconciliationEngine`) ni du délettrage (`release`).
- Réutiliser `LettrageGenerator` (pas de 2ᵉ implémentation base 26).

## Risques / dépendances
- **Ordre 1→2 impératif** : créer l'index avant la remédiation ferait échouer la migration.
- **Remédiation vs sessions actives** : la lettre sert de clé de matching côté front pour l'approbation → lancer la remédiation **hors session** ou après avoir vidé les rapprochements en cours, pour ne pas déplacer une lettre sous les pieds d'un utilisateur en train d'approuver.
- Comportement de **reprise** : le calcul repart de la lettre max présente ; une lettre libérée (délettrage) peut être **réattribuée** (pas de gap) — cohérent avec l'ancienne logique client. À confirmer si un « no-reuse » strict est souhaité.
- **Durcissement optionnel (hors périmètre, à noter)** : à terme, faire construire les paires d'approbation par `MV_ID` (stocké sur la ligne réservée) plutôt que par la lettre côté front, pour supprimer définitivement la dépendance fonctionnelle à la lettre. Non requis une fois l'unicité garantie.

## Checklist VALIDATION (à remplir dans VERIFY/)
- [ ] Build OK (API + front)
- [ ] Migration : doublons `(EnteteId, Lettrage)` remédiés **avant** création de l'index (log des renumérotations)
- [ ] Index unique `UX_RAPP_Ligne_Entete_Lettrage` créé sans erreur ; **aucune** colonne compteur ajoutée
- [ ] `reserve` : lettre **calculée serveur** sous verrou par relevé et **renvoyée** ; lettre proposée par le client ignorée
- [ ] Deux réservations concurrentes sur le même relevé → **lettres distinctes** (test 2 sessions / 2 users)
- [ ] Auto-réconciliation d'un lot : toutes les paires obtiennent des lettres uniques
- [ ] Front : les 2 grilles affichent la lettre du retour (manuel + auto)
- [ ] `release` (délettrage) inchangé et fonctionnel
- [ ] Aucun `UPDATE` brut sur une table métier GRC ; aucune écriture de la lettre dans GRC
- [ ] Cohérent avec l'architecture ; `LettrageGenerator` réutilisé (pas de duplication)
