# TASK-081 — Écriture comptable règlement ESPÈCE : N° pièce + libellé = facture

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

**Décisions PO (2026-09-27)** :
- `EC_Piece` (espèce) doit bien changer : n° de facture au lieu du n° de règlement — confirmé explicitement.
- Repli sans facture affectée : **cas non existant en pratique** ("tous les règlements espèce sont affectés sur des factures") — garder malgré tout un garde-fou défensif dans la vue (ne jamais écrire une pièce/un libellé vide si le postulat se révélait faux sur une ligne isolée), mais sans complexifier la règle métier pour un cas qui n'arrive pas.

## Problème constaté

1. Le libellé actuel (`'ESP ' + facture`) ne correspond plus au format demandé par le PO (`'Règlement facture N°' + facture`).
2. Le "N° de pièce" demandé (n° de facture) est **différent** du champ `EC_Piece` actuel (n° de règlement) — **changement confirmé par le PO**. `EC_Piece` sert aussi de clé de recherche/lettrage côté Sage : vérifier qu'aucun usage existant ne s'appuie sur le format actuel (n° de règlement) avant de livrer, et le signaler dans le VERIFY si un tel usage est trouvé.

## Objectif

- `EC_Intitule` (espèce) devient `'Règlement facture N°' + FactureNumero`.
- `EC_Piece` (espèce) devient `FactureNumero` (n° de facture) au lieu du n° de règlement — confirmé PO.
- Repli si `FactureNumero` est NULL (cas considéré inexistant en prod, à ne pas complexifier) : garder le n° de règlement en garde-fou plutôt que d'écrire une pièce vide.

## Fichiers concernés

- `SQL_005_TASK-053_LibelleEcriture.sql` — `ALTER VIEW vw_ReglementsAComptabiliser`, branche `MV_Type = 0` (l.61-65 pour la pièce, l.99-101 pour le libellé).
- Aucun changement C# attendu si `ReglementService.cs` ne fait que lire les colonnes `EC_Piece`/`EC_Intitule` de la vue en passe-plat (`AppliquerChampsVue`, cf. TASK-053) — à confirmer en lisant le code avant de coder, pas à supposer.

## Étapes d'implémentation

1. Vérifier en base qu'aucun usage/outil aval (lettrage, recherche pièce Sage) ne s'appuie sur le format actuel de `EC_Piece` (n° de règlement) pour les règlements espèce déjà comptabilisés — signaler dans le VERIFY si un tel usage existe, avant de livrer.
2. Modifier la clause `MV_Piece` (l.61-65, branche `MV_Type = 0`) : `FactureNumero` au lieu de `replace(MV_Numero,'RC','')`, avec repli sur le n° de règlement uniquement si `FactureNumero` est NULL (garde-fou défensif, cas considéré inexistant en prod).
3. Modifier la clause `LibelleEcriture` (l.99-101) : `'Règlement facture N°' + FactureNumero`, même repli défensif si `FactureNumero` est NULL.
4. Rejouer la vue en base sur un échantillon de règlements espèce réels et comparer les résultats avant/après (le PO confirme que tous les règlements espèce ont une facture affectée — vérifier que cette hypothèse est bien vraie sur l'échantillon testé).
5. Vérifier la troncature `EC_Piece varchar(13)` et `EC_Intitule varchar(69)` sur le nouveau format (`'Règlement facture N°'` + facture est plus long que `'ESP '` + facture) — signaler si des factures réelles dépassent la longueur disponible (cf. discipline de troncature déjà actée par TASK-053, l.15-21 du fichier SQL).

## Contraintes

- Ne jamais bypasser une règle de sécurité ou une DLL métier GRC.
- Respecter la discipline de troncature déjà actée par TASK-053 (documenter tout dépassement, ne pas le laisser silencieux).
- Ne pas toucher à la branche hors espèce de la vue (`MV_Type ≠ 0`) — objet de TASK-082.

## Checklist VALIDATION (à remplir dans VERIFY/)

- [ ] Build OK (si impact C#, sinon rejeu direct de la vue SQL en base)
- [ ] Vue SQL rejouée en base sur échantillon réel espèce, résultat conforme au nouveau format (`EC_Piece` = n° facture, `EC_Intitule` = `'Règlement facture N°<facture>'`)
- [ ] Vérifié qu'aucun usage aval (lettrage/recherche Sage) ne dépend du format `EC_Piece` actuel (n° de règlement)
- [ ] Vérification de la marge de troncature `EC_Piece varchar(13)` / `EC_Intitule varchar(69)` sur le nouveau format, dépassements éventuels signalés
- [ ] Aucun credential/secret en dur introduit
- [ ] Aucune dette technique silencieuse
- [ ] Cohérent avec l'architecture
