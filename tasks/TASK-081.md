# TASK-081 — Libellé écriture comptable règlement ESPÈCE : "Règlement facture N°<facture>"

- **Priorité** : 🟡 Mineur
- **Domaine** : Correction (SQL — vue de comptabilisation)
- **Statut** : TODO
- **Dépend de** : TASK-053 (livrée) — modifie la même vue `vw_ReglementsAComptabiliser`

## Contexte

Demande PO (2026-09-26) sur le libellé des écritures de règlement espèce, reçue sous cette forme :

> Pour libellé des écritures de paiement espèce
> N° de pièce : num de facture
> Libellé : 'Règlement facture N°<num de facture>'

La vue `vw_ReglementsAComptabiliser` ([SQL_005_TASK-053_LibelleEcriture.sql](../SQL_005_TASK-053_LibelleEcriture.sql), branche `MV_Type = 0` = espèce, livrée par TASK-053) calcule aujourd'hui :

- `EC_Piece` (l.61-65) : `MV_Numero` sans le préfixe `"RC"` — **le n° du règlement**, pas le n° de facture.
- `EC_Intitule` (l.99-101) : `'ESP ' + FactureNumero` (repli `'ESP'` seul si aucune facture affectée) — format différent de celui demandé.

Le n° de facture est déjà disponible dans la vue via `fact.FactureNumero` (OUTER APPLY l.120-127, résolu par `RT_AFFECTATION → RT_ECHEANCE.DO_Numero` filtré `DO_Type = 6`, 1ʳᵉ affectation par `AF_Id` croissant s'il y en a plusieurs — règle déjà actée par TASK-053, cf. commentaire l.117-119).

## Problème constaté

1. Le libellé actuel (`'ESP ' + facture`) ne correspond plus au format demandé par le PO (`'Règlement facture N°' + facture`).
2. Le "N° de pièce" demandé (n° de facture) est **différent** du champ `EC_Piece` actuel (n° de règlement). Changer `EC_Piece` pour y mettre le n° de facture est un changement de nature différente du simple format de libellé : `EC_Piece` sert aussi de clé de recherche/lettrage côté Sage — **vérifier avec le PO l'impact avant de le modifier**, ne pas le faire au passage sans validation explicite distincte de la demande de libellé.

## Objectif

- `EC_Intitule` (espèce) devient `'Règlement facture N°' + FactureNumero` (garder un repli explicite et documenté si `FactureNumero` est NULL — ex. `'Règlement facture N°'` seul, ou conserver `'ESP'` : à trancher avec le PO avant implémentation, ne pas improviser).
- `EC_Piece` (espèce) : **ne pas modifier dans cette tâche** sauf confirmation PO explicite que le n° de pièce doit bien devenir le n° de facture (et non plus le n° de règlement) — si confirmé, vérifier l'impact sur tout appariement/lettrage Sage qui s'appuierait sur le format actuel de `EC_Piece` avant de le changer.

## Fichiers concernés

- `SQL_005_TASK-053_LibelleEcriture.sql` — `ALTER VIEW vw_ReglementsAComptabiliser`, branche `MV_Type = 0` (l.61-65 pour la pièce si confirmé, l.99-101 pour le libellé).
- Aucun changement C# attendu si `ReglementService.cs` ne fait que lire les colonnes `EC_Piece`/`EC_Intitule` de la vue en passe-plat (`AppliquerChampsVue`, cf. TASK-053) — à confirmer en lisant le code avant de coder, pas à supposer.

## Étapes d'implémentation

1. Confirmer avec le PO le repli exact du libellé si `FactureNumero` est NULL (aucune affectation).
2. Confirmer avec le PO si `EC_Piece` doit changer (n° de facture au lieu du n° de règlement) ou si seule la demande de libellé est à traiter — **si le PO confirme le changement de `EC_Piece`**, vérifier l'usage de ce champ côté Sage (lettrage, recherche pièce) avant de modifier, et documenter l'impact dans le VERIFY.
3. Modifier la clause `LibelleEcriture` (l.99-101) de la vue en conséquence.
4. Rejouer la vue en base sur un échantillon de règlements espèce réels (avec et sans facture affectée) et comparer les résultats avant/après.
5. Vérifier la troncature `EC_Intitule varchar(69)` : `'Règlement facture N°'` + facture est plus long que `'ESP '` + facture — recalculer la marge disponible pour le numéro de facture et signaler si des factures réelles dépassent la longueur disponible (cf. discipline de troncature déjà actée par TASK-053, l.15-21 du fichier SQL).

## Contraintes

- Ne jamais bypasser une règle de sécurité ou une DLL métier GRC.
- Ne pas modifier `EC_Piece` sans confirmation PO explicite et documentée dans le VERIFY (cf. § Objectif).
- Respecter la discipline de troncature déjà actée par TASK-053 (documenter tout dépassement, ne pas le laisser silencieux).
- Ne pas toucher à la branche hors espèce de la vue (`MV_Type ≠ 0`) — objet de TASK-082.

## Checklist VALIDATION (à remplir dans VERIFY/)

- [ ] Build OK (si impact C#, sinon rejeu direct de la vue SQL en base)
- [ ] Vue SQL rejouée en base sur échantillon réel espèce (avec et sans facture affectée), résultat conforme au nouveau format
- [ ] Décision PO documentée sur le repli `FactureNumero` NULL
- [ ] Décision PO documentée sur `EC_Piece` (changé ou non, avec justification)
- [ ] Vérification de la marge de troncature `EC_Intitule varchar(69)` sur le nouveau format, dépassements éventuels signalés
- [ ] Aucun credential/secret en dur introduit
- [ ] Aucune dette technique silencieuse
- [ ] Cohérent avec l'architecture
