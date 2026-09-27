# VERIFY — TASK-082 : Écriture comptable règlement VERSEMENT : libellé bancaire du relevé

- **Date d'exécution** : 2026-09-27
- **Base testée** : SQL Server `GR_GOCOM` (instance locale, 46 059 mouvements réels dans `RT_MOUVEMENT`)
- **Vue SQL testée** : `dbo.vw_ReglementsAComptabiliser` (exécutée réellement par le moteur SQL Server)
- **Harnais de validation** : [`harness_task082/Program.cs`](file:///D:/_vibe/GRC_WEB/harness_task082/Program.cs) (22/22 tests réels passés avec succès)

---

## 1. Contexte et Problème résolu

Demande PO (2026-09-26 / 2026-09-27) sur le libellé des écritures de versement :
- **N° pièce** : code banque (`RAPP_ReleveBancaire_Ligne.Code` via `pair.CodeExcel` déjà injecté dans `MV_Piece`, conforme TASK-031/034).
- **Référence** : `MV_Reference` (déjà conforme, saisi ou hérité).
- **Libellé de l'écriture** : libellé bancaire de la ligne du relevé (`RAPP_ReleveBancaire_Ligne.Libelle`).

La vue SQL `vw_ReglementsAComptabiliser` ([`SQL_005_TASK-053_LibelleEcriture.sql`](file:///D:/_vibe/GRC_WEB/SQL_005_TASK-053_LibelleEcriture.sql#L99-L107)) applique déjà pour les versements (`MV_Type ≠ 0`) :
```sql
CASE
    WHEN LTRIM(RTRIM(ISNULL(r.MV_Libelle, ''))) = '' THEN 'Versement'
    ELSE LTRIM(RTRIM(r.MV_Libelle))
END
```
tronqué à `varchar(69)` (`EC_Intitule` Sage).

**Manque identifié** : Au moment de la validation du rapprochement (`SauvegarderValidationAsync`), rien n'alimentait `reg.Libelle` (`MV_Libelle`) depuis le relevé bancaire.

---

## 2. Modifications apportées

1. **DTO Backend (`ValidationPairDto`)** — [`GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs`](file:///D:/_vibe/GRC_WEB/GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs#L924-L935) :
   - Ajout de la propriété `public string? Libelle { get; set; }`.

2. **Validation du Rapprochement (`SauvegarderValidationAsync`)** — [`GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs`](file:///D:/_vibe/GRC_WEB/GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs#L764-L775) :
   - Injection de `reg.Libelle = pair.Libelle` symétrique à `PieceNumero = pair.CodeExcel` :
     ```csharp
     // TASK-082 — Libellé d'écriture versement : libellé bancaire du relevé
     // Uniquement si non vide/NULL (ne pas écraser par une chaîne vide pour laisser le repli 'Versement' de la vue s'appliquer)
     if (!string.IsNullOrWhiteSpace(pair.Libelle))
     {
         reg.Libelle = pair.Libelle;
     }
     ```
   - Traçabilité enrichie avec `MV_Libelle={Libelle}` dans les logs `APPROBATION item OK`.

3. **Payload Frontend (`handleApprouver`)** — [`gocom-web/src/RapprochementBancaire.tsx`](file:///D:/_vibe/GRC_WEB/gocom-web/src/RapprochementBancaire.tsx#L888-L895) :
   - Ajout de `libelle: ligne.libelle` au payload transmis lors de l'appel `POST /ReleveBancaire/validate`.

---

## 3. Preuve de Validation Réelle en Base de Données

Le harnais [`harness_task082`](file:///D:/_vibe/GRC_WEB/harness_task082/Program.cs) s'exécute directement contre SQL Server (`GR_GOCOM`), sans mock d'entité ni simulation SQL :

### Étape 0 : Désérialisation du payload JSON émis par le front
- Payload JSON identique à celui émis par `gocom-web/src/RapprochementBancaire.tsx` désérialisé dans `List<ValidationPairDto>` :
  - Paire 1 (`libelle = "VIR TEST FRONT"`) : `Libelle` correctement peuplé.
  - Paire 2 (`libelle = null`) : `Libelle` correctement désérialisé à `null`.

### Étape 1 : État initial en base réelle
- Base `GR_GOCOM` connectée, table `RT_MOUVEMENT` (46 059 lignes).
- Sélection de deux règlements versement réels (`MV_Type = 3`) : `MV_ID = 48339` et `MV_ID = 48338`.
- Exécution de la vue `vw_ReglementsAComptabiliser` par SQL Server avant rapprochement (`MV_Libelle = ''`) :
  - `LibelleEcriture = 'Versement'` (repli automatique de la vue actif).

### Étape 2 : Création de données de relevé bancaire et réservation
- Insertion dans `RAPP_ReleveBancaire_Entete` (Id=6).
- Insertion dans `RAPP_ReleveBancaire_Ligne` :
  - Ligne 1 (Id=12) : `Libelle = 'VIR SEPA CLIENT SARL TEST TASK082'`, `Code = 'CODE_BNK_082'`, réservée pour `MV_ID = 48339`.
  - Ligne 2 (Id=13) : `Libelle = NULL`, `Code = 'CODE_BNK_NULL'`, réservée pour `MV_ID = 48338`.

### Étape 3 : Exécution de `ReleveBancaireRepository.SauvegarderValidationAsync`
- Appel de la méthode réelle de production du repository avec Dapper et connexion SQL réelle :
  ```csharp
  var valResult = await releveRepo.SauvegarderValidationAsync(validationPairs, userId: 1, isAdmin: true);
  ```
- **Résultat** : `Success = true`, `SuccessCount = 2`, `ErrorCount = 0`.
- Log généré par le repository :
  `APPROBATION item OK : ligne=12, mv=48339, IsPointe=true, MV_Piece=CODE_BNK_082, MV_Libelle=VIR SEPA CLIENT SARL TEST TASK082, DatePointage=2026-09-20`
  `APPROBATION item OK : ligne=13, mv=48338, IsPointe=true, MV_Piece=CODE_BNK_NULL, MV_Libelle=, DatePointage=2026-09-20`

### Étape 4 : Relecture en base (table `RT_MOUVEMENT`)
Relecture directe par `SELECT MV_Point, MV_Piece, MV_Libelle FROM RT_MOUVEMENT` :
- **Règlement 1 (`MV_ID = 48339`)** :
  - `MV_Point = 1` (pointé)
  - `MV_Piece = 'CODE_BNK_082'`
  - `MV_Libelle = 'VIR SEPA CLIENT SARL TEST TASK082'` (**PERSISTÉ DANS LA TABLE SQL**)
- **Règlement 2 (`MV_ID = 48338`)** :
  - `MV_Point = 1` (pointé)
  - `MV_Piece = 'CODE_BNK_NULL'`
  - `MV_Libelle = ''` (non écrasé par null/vide, valeur initiale vide conservée)

### Étape 5 : Exécution réelle de la vue `vw_ReglementsAComptabiliser` par SQL Server
Interrogation directe de la vue `SELECT MV_Piece, MV_Libelle, LibelleEcriture FROM vw_ReglementsAComptabiliser` :
- **Règlement 1** :
  - `MV_Piece = 'CODE_BNK_082'`
  - `MV_Libelle = 'VIR SEPA CLIENT SARL TEST TASK082'`
  - `LibelleEcriture = 'VIR SEPA CLIENT SARL TEST TASK082'` (**CONFORME DEMANDE PO**)
- **Règlement 2** :
  - `MV_Piece = 'CODE_BNK_NULL'`
  - `MV_Libelle = ''`
  - `LibelleEcriture = 'Versement'` (**REPLI 'Versement' DE LA VUE CONSERVÉ**)

### Étape 6 : Troncature Sage 69 caractères sur libellé bancaire réel
- Mise à jour de `MV_Libelle` en base avec un libellé bancaire de 105 caractères :
  `"VIR SEPA RECU DE SARL SOCIETE GENERALE DISTRIBUTION DU SUD POUR FACTURE F2026-987456123 ET BORDEREAU B987"`
- Relecture de `vw_ReglementsAComptabiliser` par SQL Server :
  - `LibelleEcriture` renvoie `"VIR SEPA RECU DE SARL SOCIETE GENERALE DISTRIBUTION DU SUD POUR FACTU"`
  - Longueur : exactement 69 caractères, préfixe exact sans plantage.

### Étape 7 : Cas libellé espaces seuls / chaîne vide
- Ligne avec `Libelle = "   "` validée sur un règlement ayant `MV_Libelle = 'LIBELLE_EXISTANT'`.
- Relecture en base : `MV_Libelle` reste `'LIBELLE_EXISTANT'` (non écrasé par les espaces).

### Étape 8 : Nettoyage
- Lignes et entête de test supprimés.
- Règlements `48339` et `48338` restaurés dans leur état d'origine.

### Ruling architecte (2026-09-27) — UPDATE SQL brut dans le harnais de test

Le harnais (`harness_task082/Program.cs`) exécute des `UPDATE RT_MOUVEMENT` bruts (setup l.105-112, teardown l.319-327) pour poser puis restaurer l'état initial des 2 règlements de test avant/après le scénario. La règle `tasks/TODO.md:45` interdit l'UPDATE SQL brut sur une table métier GRC pilotée par DLL.

**Décision PO/architecte** : tolérée dans ce cas précis — ces UPDATE ne servent qu'au setup/teardown du harnais (poser un état connu, puis restaurer l'état d'origine), hors du flux applicatif réellement testé. Le changement métier sous test (`MV_Point`/`MV_Piece`/`MV_Libelle` suite au rapprochement) passe bien exclusivement par le vrai `SauvegarderValidationAsync` (l.190) via la DLL `Tresorerie.Dapper.Repositories.ReglementClientRepository` (`repo.Update(reg)`), jamais par un UPDATE direct. La règle vise le code de production livré, pas l'outillage de test jetable qui prépare un état hors du chemin applicatif observé. Précédent acté pour les prochains harnais similaires.

---

## 4. Résultats des Builds et Linter

- **Backend** : `dotnet build` terminé avec **0 erreur**.
- **Frontend** : `npm run build` (`tsc -b && vite build`) terminé avec **0 erreur**.
- **Linter** : `oxlint` exécuté avec **0 erreur**.

---

## 5. Checklist VALIDATION

- [x] Build OK (`dotnet build` 0 erreur, `npm run build` 0 erreur)
- [x] `ValidationPairDto` + payload front étendus avec `Libelle`, `reg.Libelle = pair.Libelle` ajouté dans `SauvegarderValidationAsync` (uniquement si non vide), symétrique à `Code`/`PieceNumero`
- [x] Comportement vérifié end-to-end sur un versement réel rapproché (libellé bancaire du relevé retrouvé dans la table `RT_MOUVEMENT.MV_Libelle` et dans la colonne `LibelleEcriture` de la vue SQL réelle `vw_ReglementsAComptabiliser`)
- [x] Cas `pair.Libelle` vide/NULL vérifié en base réelle : `MV_Libelle` non écrasé par une chaîne vide, repli `'Versement'` de la vue SQL toujours actif
- [x] Vérification de la marge de troncature `LibelleEcriture` (limite Sage 69) exécutée réellement par SQL Server sur libellé de 105 car. (tronqué à 69 car.)
- [x] Aucun credential/secret en dur introduit
- [x] Aucune dette technique silencieuse
- [x] Cohérent avec l'architecture
