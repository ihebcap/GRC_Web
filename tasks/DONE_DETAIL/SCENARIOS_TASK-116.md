# Scénarios de Test et Recette — TASK-116

**Titre** : Affichage Dépôt & Caisse paramétrée, interrupteur de filtrage par caisse, bandeau de répartition & alertes  
**Écran** : Génération des règlements espèces (Navigation latérale `currentView === 'reglement-espece'`, `App.tsx` — composant `ReglementGenerationEspece.tsx`)  
**Date** : 2026-10-01  
**Environnement de test** : Serveur `DESKTOP-2VCUE93`, Base `GR_GOCOM` / ERP `GOCOM`  

---

## 1. Prérequis & Environnement

1. Application Web GRC démarrée (port dev local ou port mock 3516 lors des tests E2E Playwright).
2. Utilisateur connecté ayant au moins une caisse affectée dans son profil (ex. `Admin` ou utilisateur caisse).
3. Présence de factures ouvertes (avec solde > 0) dans `RT_ECHEANCE`.
4. Tables de référence Sage / GRC accessibles : `GOCOM.dbo.FG_DEPOTFACTURATION`, `GOCOM.dbo.F_DEPOT`, `GR_GOCOM.dbo.RT_CAISSE`.

---

## 2. Scénario Nominal (Happy Path)

### Étapes :
1. Accéder au menu **Règlement espèce** via la barre latérale.
2. Observer la grille des factures ouvertes :
   - Les colonnes **Dépôt** et **Caisse paramétrée** sont affichées dans la table (visibilité par défaut).
   - Les factures affichent leur intitulé de dépôt issu de `EC_Info1` et le code de la caisse paramétrée (exemples : caisse `XDR2` avec tooltip `"X-REGIONAL NADOR"` ou caisses réelles de test `CR`, `CD`).
3. Sélectionner la caisse dans la liste déroulante des caisses (ex. `XDR2`).
4. Constater que l'interrupteur **« Filtrer sur les dépôts de cette caisse »** devient interactif (activable).
5. Activer l'interrupteur :
   - La grille se restreint immédiatement aux seules factures rattachées aux dépôts de la caisse choisie.
   - Le compteur d'en-tête indique le nombre filtré (ex. `Factures ouvertes (6000 / 30000)`).
6. Cocher 2 factures affichées.
7. Constater l'apparition du bandeau de répartition des factures cochées.
8. Cliquer sur **Générer (2)**.
9. Dans la boîte de dialogue de confirmation, vérifier qu'aucun avertissement d'écart de caisse n'apparaît puisque toutes les factures cochées correspondent à la caisse sélectionnée.
10. Confirmer : les règlements sont générés avec succès.

---

## 3. Scénarios des Cas Limites (Cas 1 à 16)

### Cas 1 : Facture avec champ Info1 vide ou NULL
- **Donnée** : Facture dont l'échéance a `EC_Info1` vide, null ou composé uniquement d'espaces.
- **Rendu dans le code** :
  - Colonne « Dépôt » affiche `'—'` (tiret cadratin).
  - Colonne « Caisse paramétrée » affiche le texte `'Non paramétré'` en couleur ambre `#b45309`, avec pour infobulle (`title`) : `"Aucune caisse paramétrée pour ce dépôt : choisissez la caisse à la main"`.
  - En cas d'activation du filtre par caisse, cette facture est masquée (non comptée dans la caisse choisie).

### Cas 2 : Sensibilité à la casse et espaces superflus dans l'intitulé de dépôt
- **Donnée** : `EC_Info1` contient des espaces superflus et une casse différente (ex. `'   dr2 depot regional nador   '`).
- **Rendu dans le code** :
  - La normalisation `(s ?? "").Trim()` combinée à la clé insensible à la casse `StringComparer.OrdinalIgnoreCase` résout correctement le dépôt vers `'XDR2'`.
  - Colonne « Caisse paramétrée » affiche `'XDR2'` avec pour infobulle son intitulé (`caisseIntitule`, ex. `"X-REGIONAL NADOR"`).

### Cas 3 : Dépôt absent du paramétrage Sage ou mode non-espèces (`MR_Id <> 1`)
- **Donnée** :
  - Volet 1 : `EC_Info1` porte un intitulé absent de `FG_DEPOTFACTURATION` (ex. `'DEPOT NON EXISTANT'`).
  - Volet 2 : `EC_Info1` porte un dépôt rattaché dans `FG_DEPOTFACTURATION` mais avec `MR_Id <> 1` (ex. chèque ou virement, non-espèces).
- **Rendu dans le code** :
  - La jointure SQL filtrant strictement sur `f.MR_Id = 1`, les dépôts hors espèces ou inconnus ne sont pas chargés (`CaisseCode = null`, `CaisseMotif = "absent"`).
  - Colonne « Dépôt » affiche l'intitulé brut.
  - Colonne « Caisse paramétrée » affiche le texte `'Non paramétré'` en couleur ambre `#b45309`, avec pour infobulle (`title`) : `"Aucune caisse paramétrée pour ce dépôt : choisissez la caisse à la main"`.

### Cas 4 : Multi-dépôts rattachés à une même caisse
- **Donnée** : Caisse `XDR2` ayant pour dépôts rattachés `DR2 DEPOT REGIONAL NADOR` et `DR2 DEPOT ANIMATEUR NADOR`.
- **Rendu dans le code** :
  - Les deux dépôts affichent `'XDR2'` en caisse paramétrée avec infobulle `"X-REGIONAL NADOR"`.
  - Quand la caisse `XDR2` est choisie et le filtre activé, les factures de ces **deux** dépôts distincts sont affichées dans la liste.

### Cas 5 : Dépôt ambigu (conflit de paramétrage)
- **Donnée** : Un même intitulé de dépôt rattaché à deux caisses distinctes dans `FG_DEPOTFACTURATION`.
- **Rendu dans le code** :
  - L'API détecte le doublon lors du chargement, consigne un `LogWarning("PARAMÉTRAGE DÉPÔT→CAISSE ambigu : dépôt={Depot}")` et affecte `null` (aucun choix arbitraire, motif `'ambigu'`).
  - Colonne « Caisse paramétrée » affiche le texte `'Paramétrage ambigu'` (et non `'Non paramétré'`) en couleur ambre `#b45309`, avec pour infobulle (`title`) : `"Aucune caisse paramétrée pour ce dépôt : choisissez la caisse à la main"`.

### Cas 6 : Caisse paramétrée appartenant à une autre société (`SO_Id <> @SocieteId`)
- **Donnée** : Dépôt configuré sur une caisse dont le `SO_Id` est différent de la société courante (vérifié en base : 0 caisse trouvée avec `SO_Id <> 1`).
- **Rendu dans le code** :
  - La jointure SQL `WHERE c.SO_Id = @SocieteId` ignore cette caisse (`CaisseMotif = "absent"`, `CaisseCode = null`).
  - Colonne « Caisse paramétrée » affiche `'Non paramétré'` en couleur ambre `#b45309` avec pour infobulle (`title`) : `"Aucune caisse paramétrée pour ce dépôt : choisissez la caisse à la main"`.

### Cas 7 : Caisse paramétrée en sommeil (`CA_Sommeil = 1`)
- **Donnée** : Dépôt dont la caisse a `CA_Sommeil = 1` dans `RT_CAISSE`.
- **Rendu dans le code** :
  - Colonne « Caisse paramétrée » affiche le texte brut `'XDR9 (en sommeil)'` dans un `<span>` standard (sans badge CSS), avec pour infobulle l'intitulé de la caisse (`caisseIntitule`, ex. `"X-REGIONAL MARRAKECH"`).
  - Présence dans le menu déroulant : la liste déroulante des caisses reflète les caisses autorisées de l'utilisateur. Si une caisse en sommeil y est présente et sélectionnée, le filtre regroupe bien ces factures.

### Cas 8 : Indisponibilité du paramétrage (erreur SQL / droits / base)
- **Donnée** : Rupture d'accès aux tables Sage `FG_DEPOTFACTURATION` / `F_DEPOT` (droits, réseau ou base introuvable).
- **Rendu dans le code** :
  - L'API intercepte l'erreur dans un bloc try/catch, logge l'erreur via `_logger.LogError` et renvoie les factures normalement avec le drapeau `parametrageIndisponible = true`.
  - La liste des factures se charge normalement (HTTP 200) : la totalité des factures est affichée (ex. `30000 / 30000` en E2E, 2025 factures réelles).
  - L'effet dédié remet `filtrerDepotsCaisse` à `false` automatiquement dès que `parametrageIndisponible` devient vrai : aucune facture n'est masquée.
  - Colonne « Caisse paramétrée » ET bandeau de répartition affichent **`'Indisponible'`** (et jamais `'Non paramétré'`), avec infobulle `"Paramétrage des caisses indisponible"`.
  - Un bandeau discret d'information jaune s'affiche au-dessus de la grille : `'Paramétrage des caisses indisponible : filtre automatique désactivé'`.
  - L'interrupteur est désactivé (grisé) avec infobulle explicative `'Paramétrage des caisses indisponible'`.
  - **Suppression des alertes** : en mode indisponible, les avertissements de divergence de caisse sont neutralisés lors de la confirmation de génération (`!parametrageIndisponible`).
  - L'opérateur peut continuer à générer des règlements comme avant (mode dégradé robuste).

### Cas 9 : Filtre actif sur une caisse sans aucune facture
- **Donnée** : Sélection d'une caisse dont aucun dépôt ne figure dans les factures ouvertes.
- **Rendu dans le code** :
  - La grille affiche 0 ligne avec le message `'Aucune facture ne correspond aux filtres appliqués.'`.
  - Le titre indique `'Factures ouvertes (0 / N)'`.
  - Aucun crash, aucune erreur JavaScript dans la console.

### Cas 10 : Changement dynamique de caisse avec filtre actif et réinitialisation de pagination
- **Donnée** : Filtre actif sur `XDR2`, grille navigant sur la page 2, puis changement de caisse vers `XDR3`.
- **Rendu dans le code** :
  - La grille se recalcule immédiatement pour afficher les factures de `XDR3`.
  - La pagination revient automatiquement à la **page 1** (contrôlé par l'effet de réinitialisation sur `caisseCode` et validé en E2E).

### Cas 11 : Factures cochées puis activation du filtre
- **Donnée** : L'utilisateur coche des factures de plusieurs dépôts/caisses, puis active l'interrupteur sur `XDR2`.
- **Rendu dans le code** :
  - Les factures cochées qui ne sont pas de la caisse `XDR2` sont masquées par le filtre, mais **restent cochées** (aucune perte de sélection).
  - L'indicateur affiche : `Cochées : X (dont Y hors filtre)`.
  - Un bouton d'action `Décocher hors filtre` apparaît pour permettre le nettoyage rapide si souhaité.

### Cas 12 : Alerte de confirmation en cas de divergence de caisse
- **Donnée** : Caisse sélectionnée = `XDR2`. Factures cochées = 2 sur `XDR2`, 2 sur `XDR3`, 1 `Non paramétré`.
- **Rendu dans le code** :
  - Clic sur Générer ouvre la boîte de dialogue standard `window.confirm` contenant les avertissements explicites :
    - `ATTENTION : 2 facture(s) cochée(s) ont une autre caisse paramétrée que XDR2 (XDR3 : 2).`
    - `1 facture(s) n'ont pas de caisse paramétrée (traitées sur la caisse choisie).`
  - L'alerte est informative et non bloquante : en cliquant OK, la génération s'exécute sur la caisse choisie.

### Cas 13 : Migration automatique des préférences de colonnes (localStorage legacy)
- **Donnée** : Profil utilisateur ayant une clé `gocom_reglement_espece_columns` enregistrée sans les nouvelles colonnes.
- **Rendu dans le code** :
  - L'application lit la clé legacy, injecte automatiquement `depotIntitule` et `caisseParametree`, et migre la préférence vers `gocom_reglement_espece_columns_v2`.
  - Les deux colonnes sont immédiatement visibles à l'écran dès la première connexion post-déploiement.

### Cas 14 : Résilience localStorage inaccessible
- **Donnée** : Mode navigation privée strict ou quota localStorage dépassé.
- **Rendu dans le code** :
  - Toutes les lectures et écritures de `localStorage` sont protégées par `try/catch`.
  - L'écran s'initialise avec les colonnes par défaut sans planter.

### Cas 15 : Performance sous volumétrie élevée
- **Donnée** : Société avec 30 000 factures mockées (E2E) ou 2 025 factures réelles de test.
- **Rendu dans le code** :
  - Côté serveur : `ChargerParametrageDepotCaisse(1)` s'exécute en **194 ms** pour la cartographie des dépôts, avec exactement 1 ouverture de connexion ADO.NET. Le temps global de `GetFacturesARegler(1)` s'élève à 2 729 ms pour 2 025 factures (dominé à 93% par les appels aux DLL Trésorerie `GetAll` et collaborateurs).
  - Côté client : le tri, le filtrage par interrupteur et le calcul du bandeau de répartition s'appuient sur la pagination locale (100 lignes par page) et la mémoïsation `useMemo`.

### Cas 16 : Mode actuel préservé (interrupteur inactif)
- **Donnée** : L'interrupteur « Filtrer sur les dépôts de cette caisse » reste désactivé.
- **Rendu dans le code** :
  - Hors présence informative des colonnes « Dépôt » / « Caisse paramétrée », du bandeau récapitulatif et de l'alerte préventive en cas d'écart, le comportement de sélection et le payload envoyé à l'API (`{ caisseCode, echeanceNos }`) sont strictement identiques à la version antérieure.
