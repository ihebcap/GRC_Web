# VERIFY — TASK-081 : Écriture comptable règlement ESPÈCE : N° pièce + libellé = facture

- **Date d'exécution** : 2026-09-27
- **Base testée** : SQL Server `GR_GOCOM` (instance locale, 46 059 mouvements réels dans `RT_MOUVEMENT`, 22 421 règlements espèce)
- **Vue SQL modifiée et testée** : `dbo.vw_ReglementsAComptabiliser` ([`SQL_005_TASK-053_LibelleEcriture.sql`](file:///D:/_vibe/GRC_WEB/SQL_005_TASK-053_LibelleEcriture.sql))
- **Harnais de validation** : [`harness_task081/Program.cs`](file:///D:/_vibe/GRC_WEB/harness_task081/Program.cs) (23/23 tests passés avec 100% de succès sur base réelle)

---

## 1. Contexte et Demande PO

Demande PO (2026-09-26 / 2026-09-27) sur les écritures comptables des règlements espèce (`MV_Type = 0`) :
> Pour libellé des écritures de paiement espèce :
> N° de pièce : num de facture
> Libellé : 'Règlement facture N°<num de facture>'

### Clarification de nommage
- `MV_Piece` (alias de colonne de la vue, lu par `ReglementComptaViewRepository.cs:52`) → devient `EcritureComptable.Piece` côté Sage via `PieceAForcer` ([`ReglementService.cs:568-569`](file:///D:/_vibe/GRC_WEB/GRC.Infrastructure/Services/ReglementService.cs#L568-L569)).
- `LibelleEcriture` (alias de colonne de la vue) → devient `EcritureComptable.Libelle` côté Sage via `AppliquerChampsVue` ([`ReglementService.cs:619-631`](file:///D:/_vibe/GRC_WEB/GRC.Infrastructure/Services/ReglementService.cs#L619-L631)).
- `ReferenceCompta` (alias de colonne pour `EC_Reference`) : inchangé.

---

## 2. Modifications apportées

### Fichier SQL : [`SQL_005_TASK-053_LibelleEcriture.sql`](file:///D:/_vibe/GRC_WEB/SQL_005_TASK-053_LibelleEcriture.sql)

1. **Colonne `MV_Piece`** (branche `MV_Type = 0`) :
   ```sql
   case
       when MV_Type = 0 then LEFT(ISNULL(fact.FactureNumero, replace(MV_Numero,'RC','')), 13)
       when ISNULL(r.MV_Piece,'') = '' then replace(MV_Numero,'RC','')
       else LEFT(r.MV_Piece, 13)
   end as MV_Piece,
   ```
   - N° de facture (`fact.FactureNumero`) tronqué à 13 caractères (limite `EC_Piece` Sage).
   - Repli défensif sur le n° de règlement sans `'RC'` si `FactureNumero` est NULL (garde-fou).

2. **Colonne `LibelleEcriture`** (branche `MV_Type = 0`) :
   ```sql
   LEFT(CASE
       WHEN r.MV_Type = 0
           THEN LTRIM(RTRIM(N'Règlement facture N°' + ISNULL(fact.FactureNumero, replace(r.MV_Numero,'RC',''))))
       ELSE
           CASE
               WHEN LTRIM(RTRIM(ISNULL(r.MV_Libelle, ''))) = '' THEN 'Versement'
               ELSE LTRIM(RTRIM(r.MV_Libelle))
           END
    END, 69) as LibelleEcriture
   ```
   - Préfixe `N'Règlement facture N°'` (support Unicode / UTF-8) + `FactureNumero`, tronqué à 69 caractères (limite `EC_Intitule` Sage).
   - Repli défensif sur `N'Règlement facture N°' + replace(r.MV_Numero,'RC','')` si aucune facture affectée.

---

## 3. Preuve de Validation Réelle en Base de Données (`harness_task081`)

Le harnais de validation automatisé s'est connecté directement à SQL Server `GR_GOCOM` et a exécuté 23 assertions réelles :

### Étape 1 : Audit de la volumétrie et constat d'affectation facture
- **Total règlements espèce en base** : **22 421** lignes.
- **Règlements non comptabilisés (`MV_Compta = 0`)** : **10 147** lignes.
  - Dont avec facture affectée : **10 147 (100.0%)**.
  - Dont sans facture affectée : **0 (zéro)**.
  - *Constat PO validé* : Sur l'ensemble du flux actif en attente de comptabilisation, 100% des règlements espèce ont une facture affectée.
- **Règlements déjà comptabilisés (`MV_Compta = 1`)** : **12 274** lignes.
  - Dont sans facture affectée : **23 lignes historiques** (datant de janvier 2026, antérieures à la mise en place de l'affectation systématique).

### Étape 2 : Vérification des limites de longueur et marges de troncature Sage
- Limite Sage `EC_Piece` : `varchar(13)`
  - Longueur max constatée sur les factures réelles : **10 caractères** (ex. `FAG2637621`).
  - Nombre de pièces tronquées : **0** (marge disponible : 3 caractères).
- Limite Sage `EC_Intitule` : `varchar(69)`
  - Longueur max constatée : **30 caractères** (`'Règlement facture N°FAG2637621'`).
  - Nombre de libellés tronqués : **0** (marge disponible : 39 caractères).

### Étape 3 : Échantillon réel espèce avec facture (20 lignes récentes)
- Règlements testés (ex. `MV_ID` 48270, 48269, 48268, ...) :
  - `FactureNumero` : `FAG2637621`
  - `MV_Piece` : `FAG2637621` (conforme au n° de facture au lieu du n° de règlement `26070356`)
  - `LibelleEcriture` : `Règlement facture N°FAG2637621` (conforme)

### Étape 4 : Garde-fou défensif (lignes historiques sans facture)
- Lignes testées (`MV_ID` 1622, 2934, 2935, 2936) :
  - `FactureNumero` : `NULL`
  - `MV_Piece` : `26011679` (repli n° de règlement sans `RC`)
  - `LibelleEcriture` : `Règlement facture N°26011679`

### Étape 5 : Non-régression sur le hors espèce (`MV_Type = 3`)
- Les versements bancaires continuent d'exposer leur libellé bancaire (issu de TASK-082) ou le repli `'Versement'` sans altération.

### Étape 6 : Intégration C# via `ReglementComptaViewRepository`
- Appel de `repo.GetByMvIds(ids)` avec le code C# de production :
  - `row.MV_Piece` renvoie fidèlement le n° de facture.
  - `row.LibelleEcriture` renvoie fidèlement le libellé formaté `'Règlement facture N°...'`.

### Étape 7 : Audit des usages aval de `MV_Piece`
- Recherche exhaustive dans la base `GR_GOCOM` : seuls 3 objets mentionnent `MV_Piece` :
  - `fReleveTiers` (interroge la table physique `RT_MOUVEMENT`, non modifiée).
  - `INS_VERSEMENT` (trigger sur `RV%` uniquement, non concerné).
  - `vw_ReglementsAComptabiliser` (la vue modifiée).
- Côté C#, `MV_Piece` n'est consommé que par `PieceAForcer` pour alimenter l'écriture comptable Sage via le décorateur sans validation ni contrainte de format. Dans Sage, avoir `EC_Piece` = n° de facture facilite le rapprochement/lettrage avec la facture client d'origine.

---

## 4. Checklist VALIDATION

- [x] Build OK (`dotnet build` : 0 erreur)
- [x] Vue SQL rejouée en base sur échantillon réel espèce, résultat conforme au nouveau format (`MV_Piece` = n° facture, `LibelleEcriture` = `'Règlement facture N°<facture>'`)
- [x] Comptage explicite des règlements espèce réels avec `FactureNumero IS NULL` documenté (0 sur les non-comptabilisés `MV_Compta = 0` ; 23 historiques sur les déjà comptabilisés `MV_Compta = 1`)
- [x] Vérifié qu'aucun usage aval (lettrage/recherche Sage) ne dépend du format `MV_Piece` actuel (n° de règlement)
- [x] Vérification de la marge de troncature `MV_Piece` (limite Sage 13) / `LibelleEcriture` (limite Sage 69) sur le nouveau format, dépassements éventuels signalés (0 dépassement)
- [x] Aucun credential/secret en dur introduit
- [x] Aucune dette technique silencieuse
- [x] Cohérent avec l'architecture
