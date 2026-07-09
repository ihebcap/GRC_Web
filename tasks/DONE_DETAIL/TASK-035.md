# TASK-035 — Écran de comptabilisation des règlements clients

- **Priorité** : 🟠 Majeur
- **Domaine** : Architecture (Back+Front)
- **Statut** : TODO
- **Dépend de** : — (mais TASK-036 dépend de celle-ci)

## Contexte
Besoin PO : un **nouvel écran dédié** à la comptabilisation des règlements clients
(distinct du rapprochement). L'utilisateur filtre un périmètre, **prévisualise les
écritures comptables** qui seront injectées, puis **lance la comptabilisation**.

Les briques back existent déjà et sont réutilisées :
- `ReglementController.ApercuComptabilisation` (`POST /reglements/apercu-comptabilisation`)
  → appelle `ReglementService.ApercuComptabilisation` → `generator.Generate(reg, null, null)`.
- `ReglementController.Comptabiliser` (`POST /reglements/comptabiliser`)
  → `ReglementService.Comptabiliser` (boucle par règlement, `Parallel.ForEach`).

## Problème constaté
Il n'existe pas d'écran pour : sélectionner un périmètre → voir l'aperçu débit/crédit /
comptes généraux / libellé / montants → comptabiliser. L'aperçu actuel renvoie les objets
`EcritureComptable` bruts, non formatés pour un affichage lisible.

## Objectif
Écran opérationnel permettant :
1. **Filtres de sélection** :
   - Intervalle de dates (début / fin)
   - Mode(s) de règlement (multi-sélection)
   - Caisse(s) (multi-sélection)
   - Rapproché : Oui / Non
2. **Aperçu** des écritures (lecture seule) avant comptabilisation, colonnes :
   - Compte général (`CompteGeneral`) + contrepartie (`ContrePartieCompteG`)
   - Tiers (`TiersNumero`), Journal (`CodeJournal`)
   - Libellé (`Libelle`), Sens (`Sens` : Débit=0 / Crédit=1)
   - Montant débit / crédit (`MontantDebit` / `MontantCredit`)
   - Date comptable (`Date`), Échéance (`Echeance`), n° pièce (`NumeroPiece`)
3. **Bouton Comptabiliser** sur le périmètre validé + compte-rendu (succès / erreurs).

## Mécanisme comptable (compris — à ne pas ré-investiguer)
Chaîne : `ReglementClient` → `IEcritureComptableGenerator<ReglementClient>` (=
`EcritureComptableGeneratorReglement`).`Generate(reg, date?, numeroPiece?)` →
`IEnumerable<EcritureComptable>` (partie double) → `IComptabilizer<ReglementClient>`
(= `ComptabilizerReglement`).`Comptabiliser(reg, ecritures)` injecte en compta.

**Date comptable** : par défaut = **date opération** (`reglement.Date`). L'échéance
(`DateEcheance`) et la date de valeur (`DatePointage`) sont portées dans des champs
annexes de l'écriture (`Echeance`, `DateRapprochement`), pas comme date d'imputation.
Le paramètre `date` de `Generate` permet de forcer la date si besoin (non requis ici).

**⚠️ Piège aperçu / pièce** : `ComptabilizerReglement` **écrase** `NumeroPiece` avec le
compteur Sage à la comptabilisation réelle → le n° affiché dans l'aperçu peut différer du
n° final. Voir **TASK-036** (forçage pièce = MV_Piece). En attendant TASK-036, l'aperçu
doit signaler que le n° de pièce est indicatif.

## Fichiers concernés
- `GRC.API/Controllers/ReglementController.cs` (endpoints existants — vérifier suffisance)
- `GRC.Infrastructure/Services/ReglementService.cs` (`ApercuComptabilisation`, `Comptabiliser`)
- `gocom-web/src/` (nouvel écran React + routage + appels API)
- DTO d'aperçu lisible (à créer côté back ou mapping côté front)

## Étapes d'implémentation
1. Définir/valider le DTO d'aperçu (champs listés ci-dessus) — mapper `EcritureComptable`.
2. Confirmer que l'endpoint aperçu accepte le **périmètre par filtres** (et pas seulement
   une liste d'IDs) — sinon ajouter la résolution périmètre → IDs (réutiliser la logique
   de filtrage de `GetReglements`).
3. Front : écran filtres (dates, modes, caisses, rapproché) → tableau d'aperçu → bouton
   Comptabiliser → toast/compte-rendu.
4. Gérer les cas d'erreur (règlement déjà comptabilisé, générateur qui lève).

## Contraintes
- Ne jamais bypasser une règle de sécurité ou une DLL métier GRC.
- Respecter la Clean Architecture (Domain ← Application ← Infrastructure/API).
- Aucun `UPDATE` SQL brut sur une table métier GRC pilotée par DLL.

## Checklist VALIDATION (à remplir dans VERIFY/)
- [ ] Build OK
- [ ] Comportement vérifié end-to-end (filtre → aperçu → comptabilisation sur jeu de test)
- [ ] Aucun credential/secret en dur introduit
- [ ] Aucune dette technique silencieuse
- [ ] Cohérent avec l'architecture
