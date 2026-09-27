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

**Précision de nommage (relecture 2026-09-27) — à ne pas confondre** : le fichier `SQL_005_TASK-053_LibelleEcriture.sql` utilise en commentaire les noms `EC_Piece`/`EC_Reference`/`EC_Intitule` pour désigner les colonnes **cibles côté Sage** (table `F_ECRITUREC`, avec leurs longueurs `varchar(13)`/`varchar(17)`/`varchar(69)`). Ce ne sont **pas** les noms de colonnes réellement exposés par la vue `vw_ReglementsAComptabiliser`. Les vrais alias de colonnes de la vue, lus par [ReglementComptaViewRepository.cs:52-55](../GRC.Infrastructure/Repositories/ReglementComptaViewRepository.cs#L52-L55), sont :
- `MV_Piece` (alias de colonne, calculé l.61-65 de la vue) → devient `EcritureComptable.Piece` côté Sage via `PieceAForcer` ([ReglementService.cs:568-569](../GRC.Infrastructure/Services/ReglementService.cs#L568-L569) : `viewRow?.MV_Piece`).
- `LibelleEcriture` (alias de colonne, calculé l.99-107) → devient `EcritureComptable.Libelle` via `AppliquerChampsVue` ([ReglementService.cs:619-631](../GRC.Infrastructure/Services/ReglementService.cs#L619-L631), passe-plat pur, `e.Libelle = viewRow.LibelleEcriture.Trim()`).
- `ReferenceCompta` (alias de colonne, calculé l.80-82) → devient `EcritureComptable.Reference` via le même passe-plat. **Non concerné par cette tâche.**

Toute modification à faire dans cette tâche porte donc sur les colonnes `MV_Piece` et `LibelleEcriture` de la vue (les noms `EC_*` ne doivent apparaître que dans les commentaires expliquant la contrainte de longueur Sage, jamais comme nom de colonne à écrire dans le SQL).

La vue ([SQL_005_TASK-053_LibelleEcriture.sql](../SQL_005_TASK-053_LibelleEcriture.sql), branche `MV_Type = 0` = espèce, livrée par TASK-053) calcule aujourd'hui :

- Colonne `MV_Piece` (l.61-65) : `replace(MV_Numero,'RC','')` — **le n° du règlement**, pas le n° de facture.
- Colonne `LibelleEcriture` (l.99-101) : `'ESP ' + FactureNumero` (repli `'ESP'` seul si aucune facture affectée) — format différent de celui demandé.

Le n° de facture est déjà disponible dans la vue via `fact.FactureNumero` (OUTER APPLY l.120-127, résolu par `RT_AFFECTATION → RT_ECHEANCE.DO_Numero` filtré `DO_Type = 6`, 1ʳᵉ affectation par `AF_Id` croissant s'il y en a plusieurs — règle déjà actée par TASK-053, cf. commentaire l.117-119).

**Décisions PO (2026-09-27)** :
- La colonne `MV_Piece` (espèce) doit bien changer : n° de facture au lieu du n° de règlement — confirmé explicitement.
- Repli sans facture affectée : **cas non existant en pratique** ("tous les règlements espèce sont affectés sur des factures") — garder malgré tout un garde-fou défensif dans la vue (ne jamais écrire une pièce/un libellé vide si le postulat se révélait faux sur une ligne isolée), mais sans complexifier la règle métier pour un cas qui n'arrive pas.

## Problème constaté

1. Le libellé actuel (`'ESP ' + facture`) ne correspond plus au format demandé par le PO (`'Règlement facture N°' + facture`).
2. Le "N° de pièce" demandé (n° de facture) est **différent** de la colonne `MV_Piece` actuelle de la vue (n° de règlement) — **changement confirmé par le PO**. Cette valeur devient directement `EcritureComptable.Piece` (via `PieceAForcer`, passe-plat sans transformation) : elle sert aussi de pièce Sage sur laquelle un lettrage/une recherche aval peut s'appuyer — vérifier qu'aucun usage existant ne dépend du format actuel (n° de règlement) avant de livrer, et le signaler dans le VERIFY si un tel usage est trouvé.

## Objectif

- Colonne `LibelleEcriture` (espèce) devient `'Règlement facture N°' + FactureNumero`.
- Colonne `MV_Piece` (espèce) devient `FactureNumero` (n° de facture) au lieu du n° de règlement — confirmé PO.
- Repli si `FactureNumero` est NULL (cas considéré inexistant en prod, à ne pas complexifier) : garder le n° de règlement en garde-fou plutôt que d'écrire une pièce vide.
- **Si, malgré la confirmation PO, l'étape de rejeu (§ Étapes d'implémentation, point 4) trouve un ou plusieurs règlements espèce réels sans facture affectée** : ne pas trancher seul — arrêter et signaler ce constat au PO avant de livrer (l'hypothèse « tous les espèces sont affectés » est un postulat métier du PO, pas un fait vérifié en base au moment de la rédaction de cette tâche).

## Fichiers concernés

- `SQL_005_TASK-053_LibelleEcriture.sql` — `ALTER VIEW vw_ReglementsAComptabiliser`, branche `MV_Type = 0` : colonne `MV_Piece` (l.61-65), colonne `LibelleEcriture` (l.99-101).
- Aucun changement C# attendu : `PieceAForcer` ([ReglementService.cs:568-569](../GRC.Infrastructure/Services/ReglementService.cs#L568-L569)) et `AppliquerChampsVue` ([ReglementService.cs:619-631](../GRC.Infrastructure/Services/ReglementService.cs#L619-L631)) sont un passe-plat pur — à confirmer en relisant ces deux méthodes avant de coder, pas à supposer.

## Étapes d'implémentation

1. Vérifier en base qu'aucun usage/outil aval (lettrage, recherche pièce Sage) ne s'appuie sur le format actuel de la colonne `MV_Piece` (n° de règlement) pour les règlements espèce déjà comptabilisés — signaler dans le VERIFY si un tel usage existe, avant de livrer.
2. Modifier la colonne `MV_Piece` (l.61-65, branche `MV_Type = 0`) : `FactureNumero` au lieu de `replace(MV_Numero,'RC','')`, avec repli sur le n° de règlement uniquement si `FactureNumero` est NULL (garde-fou défensif, cas considéré inexistant en prod).
3. Modifier la colonne `LibelleEcriture` (l.99-101) : `'Règlement facture N°' + FactureNumero`, même repli défensif si `FactureNumero` est NULL.
4. Rejouer la vue en base sur l'ensemble (ou un large échantillon représentatif) des règlements espèce réels et vérifier explicitement combien ont `FactureNumero IS NULL` — si ce nombre est > 0, ne pas trancher seul le comportement à adopter : signaler au PO (cf. § Objectif, dernier point) avant de livrer.
5. Comparer les résultats avant/après sur cet échantillon.
6. Vérifier la troncature `MV_Piece` (limite Sage `varchar(13)`, cf. commentaire `EC_Piece` du fichier SQL) et `LibelleEcriture` (limite Sage `varchar(69)`, cf. commentaire `EC_Intitule`) sur le nouveau format (`'Règlement facture N°'` + facture est plus long que `'ESP '` + facture) — signaler si des factures réelles dépassent la longueur disponible (cf. discipline de troncature déjà actée par TASK-053, l.15-21 du fichier SQL).

## Contraintes

- Ne jamais bypasser une règle de sécurité ou une DLL métier GRC.
- Respecter la discipline de troncature déjà actée par TASK-053 (documenter tout dépassement, ne pas le laisser silencieux).
- Ne pas toucher à la branche hors espèce de la vue (`MV_Type ≠ 0`) — objet de TASK-082.
- Ne pas utiliser les noms `EC_Piece`/`EC_Intitule` comme noms de colonnes SQL à écrire — ce sont des noms de colonnes Sage cible (commentaires uniquement) ; les vrais alias de colonnes de la vue sont `MV_Piece` et `LibelleEcriture` (cf. § Contexte).

## Checklist VALIDATION (à remplir dans VERIFY/)

- [ ] Build OK (si impact C#, sinon rejeu direct de la vue SQL en base)
- [ ] Vue SQL rejouée en base sur échantillon réel espèce, résultat conforme au nouveau format (`MV_Piece` = n° facture, `LibelleEcriture` = `'Règlement facture N°<facture>'`)
- [ ] Comptage explicite des règlements espèce réels avec `FactureNumero IS NULL` documenté (0 attendu ; si > 0, décision PO documentée avant livraison)
- [ ] Vérifié qu'aucun usage aval (lettrage/recherche Sage) ne dépend du format `MV_Piece` actuel (n° de règlement)
- [ ] Vérification de la marge de troncature `MV_Piece` (limite Sage 13) / `LibelleEcriture` (limite Sage 69) sur le nouveau format, dépassements éventuels signalés
- [ ] Aucun credential/secret en dur introduit
- [ ] Aucune dette technique silencieuse
- [ ] Cohérent avec l'architecture
