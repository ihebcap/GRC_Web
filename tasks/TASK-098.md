# TASK-098 — Rapprochement : un règlement annulé n'est jamais affiché ni rapprochable (grille GRC, auto-rapprochement, réservation, validation)

- **Priorité** : 🟠 Majeur
- **Domaine** : Correction back (1 règle d'éligibilité + 3 gardes). **Front : aucune modification.**
- **Statut** : TODO
- **Dépend de** : —
- **Lot « règlements annulés »** : TASK-098 (rapprochement) · TASK-103 (comptabilisation) · TASK-104 (liste) · TASK-105 (annulation interdite si réservé/pointé)
- **Mise en prod** : aucun script SQL, aucune config, aucun changement de schéma ; **API seule** (le front n'est pas touché). Retour arrière = redéployer l'API précédente.
- **Références de ligne** : état du dépôt au commit `12f2dc0` (2026-09-30). Si un fichier a bougé (autre TASK fusionnée avant), se repérer par le **nom de la fonction**, pas par le numéro.

## Contexte
Règle PO (2026-09-30) : **l'annulation d'un règlement vaut suppression.** Un règlement annulé
(`MV_Annule = 1`) n'apparaît **que dans la liste des règlements**, avec un flag (TASK-104). Il n'est
**jamais proposé** : ni dans l'écran Rapprochement (cette TASK), ni dans la comptabilisation (TASK-103).

La demande initiale (« 1 ligne front ») ne suffisait pas : un annulé est aussi éligible à
l'auto-rapprochement, à la réservation et (indirectement) à la validation. Le PO **ne teste pas avant la
mise en production** : toutes les preuves sont produites par le worker, sur la base de **test**, et
figurent dans le VERIFY (aucun test n'est demandé au PO).

## Problèmes constatés (références vérifiées le 2026-09-30)
1. **Grille GRC** : `RapprochementBancaire.tsx:484` appelle `/reglements?...&pointe=false&eligibleRappBancaire=true`
   sans `annule` ; `ReglementService.cs:132-135` ne filtre que si `annule` est fourni ;
   `ReglementEligibilityHelper.cs:7-12` (`EstEligibleRappBancaire`) ne regarde que `mvType` et `mvRemis`.
2. **Auto-rapprochement** : `ReleveBancaireController.cs:165-169` (`GenererPropositions`, `POST auto-reconcile`)
   relit les règlements côté serveur et ne filtre pas `IsAnnule` : un annulé de montant unique peut être
   proposé (le moteur strict apparie tout montant unique des deux côtés).
3. **Réservation unitaire** : `ReleveBancaireRepository.cs:331-423` (`ReserverLigneAsync`) ne contrôle que
   l'autorisation de caisse (`:334-338`, **non-admin seulement**). Contrôleur `ReleveBancaireController.cs:235-284`.
4. **Réservation en lot** : `ReleveBancaireRepository.cs:432-545` (`ReserverLignesBatchAsync`), même défaut.
   Contrôleur `:289-325`.
5. **Validation** : `ReleveBancaireRepository.cs:665-813` (`SauvegarderValidationAsync`) ; la boucle `:716-790`
   ne teste que `IsPointe` (`:726`). Un annulé n'est refusé qu'**indirectement** par `SetDateBypassAffectation`
   (`:870`), et seulement si une date d'opération existe et que le règlement n'est pas comptabilisé.

**Pourquoi des gardes back malgré le filtre de la grille** : (a) **course** — un autre poste annule le
règlement entre le chargement de la grille et la réservation ; (b) appel API direct ; (c) l'auto-rapprochement
relit les règlements côté serveur sans passer par la grille.

## Comportements attendus (contrat)
| Entrée | Résultat attendu |
|---|---|
| `GET /reglements?...&eligibleRappBancaire=true` (un annulé existe dans le périmètre) | l'annulé est **absent** de `items` (et de `totalItems`), même sans paramètre `annule` |
| `POST /ReleveBancaire/auto-reconcile` | un annulé n'est **jamais** dans les propositions |
| `POST /ReleveBancaire/reserve` avec un `mvId` annulé | **HTTP 409**, corps `{ "message": "Le règlement n°<mvId> est annulé : il ne peut pas être rapproché." }` ; aucune ligne modifiée ; aucun verrou pris |
| `POST /ReleveBancaire/reserve-batch` dont un `mvId` annulé | HTTP 200 ; l'élément annulé : `success = false` ; **les autres éléments sont réservés normalement**, avec des lettres **consécutives sans trou** |
| `POST /ReleveBancaire/validate` avec une paire dont le règlement est annulé | HTTP 200, `errorCount ≥ 1`, `errors[]` contient « Erreur sur la paire (Ligne: …, Reglement: …) : Le règlement … est annulé … » ; `IsPointe` inchangé ; la ligne n'est **pas** marquée validée |

Le 409 est **voulu** : c'est le seul statut dont le front affiche le `message` serveur
(`RapprochementBancaire.tsx:766-767` ; tout autre statut donne le texte générique « Erreur lors de la
réservation »). En lot, le front compte l'élément en « conflit ignoré » (`:671-677`, `:692-694`) : suffisant,
pas de champ à ajouter au DTO.

## Décision d'architecture
La règle vit **côté serveur, en un seul endroit** : « éligible au rapprochement » inclut « non annulé ».
Aucun `&annule=false` n'est ajouté côté front : une règle unique, non contournable par un client.
La signature de l'helper reste sans dépendance à la DLL (`int` / `bool`).

## Étapes d'implémentation
1. **Helper** — `ReglementEligibilityHelper.EstEligibleRappBancaire(int mvType, int mvRemis, bool isAnnule)` :
   `!isAnnule && (mvType == 3 || ((mvType == 1 || mvType == 2) && mvRemis == 2))`. **Supprimer l'ancienne
   signature** (les erreurs de compilation révèlent tout appelant oublié). Trois appels, à passer `r.IsAnnule` :
   `ReglementService.cs:70`, `ReglementService.cs:414`, `ReleveBancaireController.cs:168`.
   (`:414` = `GetDistinctReglements`, non appelé avec ce drapeau par le front aujourd'hui : adapté quand même
   pour que la règle reste uniforme.)
2. **Lecture des annulés — un seul SELECT groupé** dans `ReleveBancaireRepository` : méthode privée
   `GetMvIdsAnnulesAsync(SqlConnection, IEnumerable<int>)` = `SELECT MV_Id FROM dbo.RT_MOUVEMENT WHERE MV_Id IN @Ids AND MV_Annule = 1`
   (Dapper, paramétré, lecture seule, par paquets de 2000 comme `ReglementService.cs:305`). Appelée après le
   pré-contrôle d'autorisation, et **pour les admins aussi**. **Piège transaction** : la connexion est ouverte
   (`:340-342` unitaire, `:448-450` lot) puis la transaction démarre aussitôt (`:343`, `:451`) ; soit on lit **avant**
   `BeginTransaction`, soit on passe le paramètre `transaction` à Dapper (comme le fait déjà le reste du code, ex. `:349-350`) —
   sinon SqlClient lève « la commande doit avoir une transaction ». Ne pas boucler sur `repo.Get(mvId)` : une
   lecture DLL par élément dégraderait le gain de TASK-066.
   **Preuve d'équivalence obligatoire** : sur 1 annulé et 1 non annulé, `MV_Annule = 1` ⇔ `reg.IsAnnule` (DLL).
3. **Réservation unitaire** (`ReserverLigneAsync`) : si le `mvId` est annulé → lever une **exception dédiée**
   (`ReglementAnnuleException`, petite classe dans `ReleveBancaireRepository.cs` près des DTO ; ne pas utiliser
   `InvalidOperationException` générique, qui masquerait d'autres erreurs) avec le message du tableau.
   Journaliser en Warning : `RÉSERVATION refusée (règlement annulé) : ligne=…, mv=…`. Aucun verrou, aucun UPDATE.
   Contrôleur `ReserveLigne` : ajouter `catch (ReglementAnnuleException ex)` **avant** le `catch (Exception)` →
   `return StatusCode(409, new { message = ex.Message })`.
4. **Réservation en lot** (`ReserverLignesBatchAsync`) : calculer l'ensemble des annulés une seule fois pour tous
   les `items`. Dans la boucle `foreach (var item in items)` (`:502`), **tout en premier**, avant le calcul de la
   lettre (`:510`) : si `MvId` annulé → ajouter `Success = false` (comme `:506`), journaliser, `continue`.
   Ainsi aucune lettre n'est consommée (`maxIndexParEntete` n'avance qu'en cas de succès, `:528`).
5. **Validation** (`SauvegarderValidationAsync`) : juste après la garde `IsPointe` (`:726-729`), **avant** toute
   affectation de date (`:731`) : `if (reg.IsAnnule) throw new InvalidOperationException($"Le règlement {reg.No} est annulé et ne peut pas être rapproché.");`
   L'exception est captée par le `catch` par élément (`:781-789`) : erreur + `FailedLigneIds`.
6. **Front : aucune modification.** Vérifier seulement (a) qu'aucun annulé ne s'affiche dans la grille,
   (b) que le message 409 s'affiche lors d'une réservation manuelle refusée.
7. **État des lieux facultatif (lecture seule)** — voir « Cas historiques ».

## Cas historiques (annulés déjà réservés avant ces règles)
Avant TASK-105, rien n'empêchait d'annuler un règlement déjà réservé. Un tel règlement disparaîtra de la grille
alors que sa ligne de relevé reste lettrée. **Chemin de secours** : cliquer sur la ligne lettrée du relevé
libère la paire (`delettrerByLettrage`, `RapprochementBancaire.tsx:708`, indépendant de la grille GRC) — mais
**seul le réservataire** peut libérer, et **pas une ligne déjà validée** (`UPDATE … WHERE ReservePar_UserId=@UserId AND DateValidation IS NULL` :
`ReleveBancaireRepository.cs:608` pour `release-batch` utilisé par le front, `:555` pour `release`).
Comptage à consigner dans le VERIFY (ou « non vérifié : pas d'accès à la base ») — **ne bloque pas la clôture** :
```sql
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SELECT l.Id, l.ReleveBancaireEnteteId, l.Lettrage, l.ReservePar_UserId, l.DateValidation, m.MV_Id, m.MV_Type, m.MV_Point
FROM dbo.RAPP_ReleveBancaire_Ligne l
JOIN dbo.RT_MOUVEMENT m ON m.MV_Id = l.MV_ID
WHERE m.MV_Annule = 1;
```
**Aucun UPDATE de correction.** Si le résultat est > 0 : le signaler au PO avec la liste (validé / non validé).

## Jeu d'essai (base de TEST uniquement)
Créer les annulés **via l'application** (bouton « Annuler », TASK-085/096) — jamais par UPDATE SQL. En pratique un
annulé du périmètre du rapprochement est un **virement** (type 3) : le bouton « Annuler » n'est proposé que si
`isRemis = 0` (`App.tsx:829`), alors que chèques et traites ne sont éligibles que remis (`isRemis = 2`).
- Banque de test B, cinq lignes de relevé **libres en crédit** L1…L5 (règle PO : seul le sens crédit est dans le périmètre), de montants M1…M5 tous **différents** (chaque montant unique des deux côtés).
- Virements non pointés sur B : **R1** (M1, libre), **R2** (M2, **annulé**), **R3** (M3, libre), **R4** (M4, libre, réservé au scénario S6).
- L5 (M5) sert au scénario S7 (aucun règlement libre de montant M5 n'est nécessaire).

## Scénarios de test (à rejouer par le worker ; résultats dans le VERIFY)
- **S1 Grille** : avec B sélectionnée, la grille contient R1, R3 et R4, **pas R2**. Avant correctif : R2 présent (à consigner).
- **S2 API éligibilité** : `GET /reglements?…&eligibleRappBancaire=true` → aucun `isAnnule = true` ; `totalItems` cohérent.
- **S3 Auto-rapprochement** : `auto-reconcile` → L1↔R1 proposée, **L2↔R2 jamais**. Non-régression (l'annulation est
  irréversible, on ne la « retire » pas) : créer un virement **R2'** non annulé de montant M2 ; `auto-reconcile` →
  L2↔R2' **est proposée** (preuve que l'annulé R2, de même montant, ne rend plus le montant ambigu).
- **S4 Réservation unitaire directe** sur R2 : 409 + message ; SELECT sur `RAPP_ReleveBancaire_Ligne` : L2 inchangée
  (`Lettrage`, `MV_ID` NULL).
- **S5 Lot** `[L1→R1, L2→R2]` : R1 `success=true` lettre « A » (ou la suivante libre), R2 `success=false` ; un second lot
  `[L3→R3]` reçoit la lettre **suivante sans trou**.
- **S6 Course** : ouvrir la grille (R4 visible), annuler R4 depuis la liste dans un autre onglet, puis réserver R4 (avec L4)
  depuis la grille périmée → 409 + message « annulé », rien de réservé.
- **S7 Validation directe** : préparer sur la base de TEST (tables `RAPP_*` de l'application, pas des tables métier GRC)
  la ligne L5 réservée par l'utilisateur de test avec `MV_ID` = R2 (annulé) et une lettre, puis `POST validate` →
  `errorCount ≥ 1`, R2 toujours non pointé, L5 toujours non validée. Remettre L5 à l'état libre ensuite (base de TEST).
- **S8 Admin et non-admin** : rejouer S4 et S5 avec un compte **admin** et un compte **non-admin** (droits caisse OK) :
  mêmes résultats. Libérer les lignes réservées (`release-batch`) entre deux rejeux pour repartir du même état.
- **S9 Non-régression moteur** : sur un relevé sans aucun annulé, l'ensemble des propositions est **identique**
  avant/après le correctif (comparer les listes de paires).

## Risques et points d'attention
- **Compilation** : la suppression de l'ancienne signature doit faire échouer le build si un appelant est oublié — c'est voulu.
- **Performance** : +1 SELECT groupé par appel de réservation/lot. Aucune lecture DLL supplémentaire par élément.
- **Course résiduelle** : une annulation survenant entre la garde et l'UPDATE conditionnel (quelques ms) reste possible ;
  acceptée, à mentionner dans le VERIFY (TASK-105 l'interdit ensuite dès que la ligne est réservée).
- **Journalisation** : messages en français, préfixes cohérents avec l'existant (`RÉSERVATION`, `APPROBATION`) — ils servent au diagnostic en prod.

## Coordination avec les autres TASKs du rapprochement
- **TASK-100 (multi-relevés)** modifie aussi `ReleveBancaireController.GenererPropositions` (union des lignes libres de
  plusieurs relevés) et `ReglementService.cs` (~`:291-354`, SELECT des réservations). **Ordre conseillé : TASK-098 d'abord**
  (petite, back seul). Si TASK-100 est fusionnée en premier, la version fusionnée de `GenererPropositions` doit
  **conserver** le filtre d'éligibilité avec `r.IsAnnule` (aucun annulé proposé) et **S3 est à rejouer** après fusion.
- TASK-101 (export) et TASK-102 (filtres de date) : aucun recouvrement (front ; la grille GRC est déjà filtrée côté serveur).

## Contraintes
- Ne jamais bypasser une règle de sécurité ni une DLL métier GRC. Aucun UPDATE SQL sur une table métier GRC.
- Respecter la Clean Architecture (Domain ← Application ← Infrastructure/API).
- **Aucun changement du moteur strict 1=1** (`AutoReconciliationEngine`) : on ne filtre que l'ensemble d'entrée.
- Ne pas ajouter de champ aux DTO de réponse, ne pas toucher au front, ne pas modifier `DEFAULT_COLUMNS`.

## Fichiers concernés
- `GRC.Application/Services/ReglementEligibilityHelper.cs`
- `GRC.Infrastructure/Services/ReglementService.cs` (2 appels : `:70`, `:414`)
- `GRC.API/Controllers/ReleveBancaireController.cs` (appel `:168` ; `catch` du 409 dans `ReserveLigne`)
- `GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs` (SELECT groupé, réservation unitaire + lot, validation `:726`, exception dédiée)
- `gocom-web/src/RapprochementBancaire.tsx` (**lecture seule**)

## Checklist VALIDATION (VERIFY : preuve datée par critère — capture, réponse API ou extrait de log)
- [ ] Build OK back + front, 0 erreur (preuve : sortie du build)
- [ ] S1 grille sans annulé, avec R1/R3 présents (preuve : capture + réponse API)
- [ ] S2 aucun `isAnnule = true` avec `eligibleRappBancaire=true` (preuve : réponse API)
- [ ] S3 aucune proposition pour l'annulé ; proposition normale conservée (preuve : réponses `auto-reconcile`)
- [ ] S4 409 + message exact ; ligne inchangée (preuve : réponse + SELECT avant/après)
- [ ] S5 lot : annulé refusé, autres réservés, lettres consécutives (preuve : réponse + SELECT)
- [ ] S6 course : refus après annulation dans un autre onglet (preuve : capture du message)
- [ ] S7 validation directe refusée, `IsPointe` inchangé (preuve : réponse + `GET /reglements`)
- [ ] S8 mêmes résultats en admin et non-admin (preuve : 2 jeux de réponses)
- [ ] S9 propositions identiques hors annulés (preuve : comparaison des listes)
- [ ] Équivalence `MV_Annule = 1` ⇔ `IsAnnule` prouvée sur 1 annulé et 1 non annulé
- [ ] Ancienne signature de l'helper supprimée (preuve : `git diff`)
- [ ] État des lieux SQL consigné avec le nombre de lignes, ou « non vérifié » + raison (facultatif)
- [ ] Aucun credential/secret en dur introduit
- [ ] Aucune dette technique silencieuse
- [ ] Cohérent avec l'architecture

## Go / No-Go
**No-Go si** S3, S4, S5, S7 ou S8 ne sont pas prouvés : ces cas sont ceux qui protègent la base en production.
