# RAPPORT DE VÉRIFICATION — TASK-107

- **Tâche** : TASK-107 — Lenteur écran Règlement espèce : grille de 30 000 lignes, payload 10,7 Mo, tri
- **Date** : 2026-10-01 (3ᵉ révision — corrections post-rejet PO)
- **Statut** : ⚠️ EN RÉVISION — deux corrections appliquées, voir checklist section 6
- **Auteur** : Antigravity (Pair Programming)

---

## 1. Synthèse des corrections apportées au 3ᵉ passage (post-rejet PO)

Les points 2 à 5 restent levés (tri sur 8 colonnes, mesures 30 000 lignes, log build, scénarios recette).

### Point bloquant A — Identifiants en clair dans le dépôt (CORRIGÉ)

`harness_task107/Program.cs` contenait précédemment :
- Ligne 15 : identifiants SQL en dur dans la chaîne de connexion.
- Ligne 54 : `"Admin"` en clair comme mot de passe Trésorerie.

**Corrections apportées :**

1. Les trois valeurs sensibles (`ConnString`, `TresoUser`, `TresoPwd`) sont désormais lues exclusivement depuis les variables d'environnement :
   ```powershell
   $env:HARNESS_CONN_STRING = "Server=...;Database=...;User Id=...;Password=...;TrustServerCertificate=True"
   $env:HARNESS_TRESO_USER  = "..."
   $env:HARNESS_TRESO_PWD   = "..."
   dotnet run --project harness_task107
   ```
   Le programme se termine avec `Environment.Exit(2)` et un message explicite si une variable est absente.

2. `harness_task107/` a été ajouté au fichier `.gitignore` (section *Harnais de validation*) pour empêcher tout commit accidentel du dossier.

### Point bloquant B — Garde-fou SQL « …au moment de l'écriture » non prouvé (LIMITE ARCHITECTURALE DOCUMENTÉE)

**Contexte :** Le test 4 de l'ancienne version du harnais exécutait un `SELECT EC_Solde` directement depuis le harnais, pas depuis le service. Il prouvait uniquement que la colonne existe en base, pas que `ReglementGenerationService` renvoie le message `"Facture déjà soldée ou introuvable en base au moment de l'écriture."`.

**Analyse de la contrainte architecturale :**

`GenererReglementsEspece()` fonctionne en deux temps :
1. **Chargement** (`IEcheanceRepository.GetAll()` + `.Where(e => e.Solde > 0)`) → construit `echeancesOuvertes`.
2. **Boucle par échéance** → contrôle de garde-fou SQL (`SELECT EC_Solde`, ligne ~206 du service) → si `EC_Solde ≤ 0`, renvoie le message TASK-107.

Pour déclencher le garde-fou de l'étape 2 depuis l'extérieur, il faudrait qu'une échéance soit **vue comme ouverte** lors de l'étape 1, mais **soldée en base** au moment du `SELECT` de l'étape 2. Ceci est impossible à simuler via un harnais externe car :
- Si `EC_Solde = 0` avant l'appel → `GetAll()` filtre la facture → elle est absente de `echeancesOuvertes` → le service renvoie le message de la **ligne ~197** (« Facture introuvable ou déjà soldée. »), pas celui de la **ligne ~210**.
- L'appel est synchrone et mono-thread : il n'y a aucune fenêtre pour insérer un UPDATE concurrent entre les étapes 1 et 2 depuis l'extérieur.

**Ce qui reste prouvé :**
- Le code du garde-fou (lignes 202-222 du service) est présent et correct (revue de code).
- La requête SQL utilisée (`SELECT EC_Solde FROM [RT_ECHEANCE] WHERE [EC_Id] = @EcheanceNo`) est fonctionnelle sur la base cible (vérification isolée dans le harnais, sans déclarer PASS/FAIL).
- `Distinct()` est prouvé (test 3, 7/9 PASS restants).

**Ce qui nécessiterait un refactoring pour être testable :**
- Extraire `IEcheanceRepository` comme dépendance injectable dans `ReglementGenerationService` (actuellement résolu via le kernel Ninject).
- Écrire un test d'intégration avec un mock retournant une échéance ouverte pendant que la BD présente `EC_Solde = 0`.

**Décision :** La case ☑ « Garde-fou SQL `Solde > 0` prouvé par exécution » est **DÉCOCHÉE** pour le sous-point « ligne ~210 ». Le garde-fou existe dans le code mais son déclenchement end-to-end ne peut pas être démontré par le harnais actuel sans injection de dépendance.

---

## 2. Preuves d'exécution du Garde-fou serveur (Banc réel `harness_task107` contre `GR_GOCOM`)

### Commande exécutée
```powershell
$env:HARNESS_CONN_STRING = "Server=DESKTOP-2VCUE93;Database=GR_GOCOM;..."   # valeur réelle non commitée
$env:HARNESS_TRESO_USER  = "..."
$env:HARNESS_TRESO_PWD   = "..."
dotnet run --project harness_task107
```

### Log d'exécution réel (Sortie console)
```text
===================================================================================
   HARNESS VALIDATION TASK-107 — Garde-fou serveur Solde > 0 et Déduplication
===================================================================================

[INFO] Initialisation kernel Trésorerie (thread STA)...
[INFO] Kernel Trésorerie initialisé avec succès. Societe = GOCOM

--- 1. VÉRIFICATION PRÉALABLE DES DONNÉES EN BASE SQL ---
[PASS] Trouvé une facture déjà soldée en base
[PASS] Trouvé une facture ouverte en base
[INFO] Nombre total de mouvements avant test : 46184

--- 2. TEST GARDE-FOU : Facture déjà soldée (EC_Id=2) ---
[PASS] Résultat renvoyé avec exactement 1 élément
[PASS] Échec confirmé (Success == false)
[PASS] Aucun numéro de règlement attribué (ReglementNo == null)
[PASS] Message d'erreur explicite signalant que la facture est déjà soldée
[PASS] Vérification SQL : 0 règlement créé en base

--- 3. TEST DÉDUPLICATION : echeanceNo en double dans la liste demandée [2, 2] ---
[PASS] La liste en retour ne contient qu'un seul élément (déduplication effective via Distinct())
[PASS] Vérification SQL : aucun règlement créé lors du test déduplication

--- 4. TEST GARDE-FOU SQL — Limite architecturale documentée ---
[SKIP] Impossible de déclencher le garde-fou « ...au moment de l'écriture » (ligne ~210 du service)
       depuis l'extérieur sans injection de dépendance sur IEcheanceRepository.
       Voir commentaire dans le harnais et section VERIFY pour le détail.
       La case ☑ du VERIFY est DÉCOCHÉE pour ce sous-point.
[INFO] SELECT EC_Solde direct sur EC_Id=2 → 0 (attendu ≤ 0 : True)

===================================================================================
   RÉSULTATS HARNESS TASK-107 : 9 PASSÉ(S), 0 ÉCHOUÉ(S)
===================================================================================
```

> **Note :** Le score est 9/9 PASS (le test 4 ne contribue plus au compteur, conformément à la décision ci-dessus). Le message `[SKIP]` indique honnêtement la limite, sans comptabiliser ni PASS ni FAIL fictif.

---

## 3. Log de compilation Backend (`dotnet build GRC.API`)

### Commande exécutée
```powershell
dotnet build GRC.API/GRC.API.csproj -c Release
```

### Extrait du log de build
```text
  Tous les projets sont à jour pour la restauration.
  GRC.Domain -> D:\_vibe\GRC_WEB\GRC.Domain\bin\Release\net10.0\GRC.Domain.dll
  GRC.Application -> D:\_vibe\GRC_WEB\GRC.Application\bin\Release\net10.0\GRC.Application.dll
  GRC.Infrastructure -> D:\_vibe\GRC_WEB\GRC.Infrastructure\bin\Release\net10.0-windows\GRC.Infrastructure.dll
  GRC.API -> D:\_vibe\GRC_WEB\GRC.API\bin\Release\net10.0-windows\GRC.API.dll

    60 Avertissement(s)
    0 Erreur(s)

Temps écoulé 00:00:35.88
```

---

## 4. Preuves d'exécution E2E Playwright (`gocom-web/e2e_task107.cjs`) sur 30 000 lignes

### Commande exécutée
```powershell
node gocom-web/e2e_task107.cjs
```

### Log complet de l'exécution Playwright
```text
Serveur mock démarré sur http://localhost:3507

=== 1. Connexion et navigation vers Règlement espèce ===
  [API] GET /api/reglements/factures-a-regler (appel n°1)
  Nombre d'appels GET factures-a-regler à l'ouverture : 1
  Factures visibles dans le DOM : 100 (taille de page par défaut 100)
  Nœuds DOM totaux : 1383 (au lieu de >350 000 sans pagination)

=== 2. Vérification du tri par défaut (Date facture, ascendant) ===
  En-tête Date facture : "DATE FACTURE ▲"
  Ligne 1 date : 01/01/2026, Ligne 2 date : 01/01/2026

=== 3. Vérification du tri cliquable sur TOUTES les 8 colonnes actives (asc / desc) ===
  [PASS] Date facture     ASC (▲) : Ligne 1 = "01/01/2026", Ligne 100 = "01/01/2026"
  [PASS] Date facture     DESC (▼) : Ligne 1 = "27/09/2026", Ligne 100 = "27/09/2026"
  [PASS] Date échéance    ASC (▲) : Ligne 1 = "01/01/2026", Ligne 100 = "01/01/2026"
  [PASS] Date échéance    DESC (▼) : Ligne 1 = "27/09/2026", Ligne 100 = "27/09/2026"
  [PASS] N° Facture       ASC (▲) : Ligne 1 = "FA26-00001", Ligne 100 = "FA26-00100"
  [PASS] N° Facture       DESC (▼) : Ligne 1 = "FA26-30000", Ligne 100 = "FA26-29901"
  [PASS] Code Client      ASC (▲) : Ligne 1 = "CL001", Ligne 100 = "CL001"
  [PASS] Code Client      DESC (▼) : Ligne 1 = "CL040", Ligne 100 = "CL040"
  [PASS] Intitulé Client  ASC (▲) : Ligne 1 = "CLIENT A 1", Ligne 100 = "CLIENT A 3"
  [PASS] Intitulé Client  DESC (▼) : Ligne 1 = "CLIENT Z 40", Ligne 100 = "CLIENT Z 38"
  [PASS] Montant          ASC (▲) : Ligne 1 = "100,00 MAD", Ligne 100 = "116,00 MAD"
  [PASS] Montant          DESC (▼) : Ligne 1 = "5 099,00 MAD", Ligne 100 = "5 083,00 MAD"
  [PASS] Solde            ASC (▲) : Ligne 1 = "100,00 MAD", Ligne 100 = "116,00 MAD"
  [PASS] Solde            DESC (▼) : Ligne 1 = "5 099,00 MAD", Ligne 100 = "5 083,00 MAD"
  [PASS] Représentant     ASC (▲) : Ligne 1 = "REP_1", Ligne 100 = "REP_1"
  [PASS] Représentant     DESC (▼) : Ligne 1 = "REP_5", Ligne 100 = "REP_5"

=== 4. Vérification de la pagination client ===
  Bandeau pagination : "Affichage 1 à 100 sur 30000 50 / page 100 / page 200 / page 500 / page"
  Lignes visibles après sélection 50/page : 50
  Indicateur de page : "2 / 600"

=== 4b. Mesure de réactivité unitaire (clic checkbox) ===
  Temps de réponse clic checkbox unitaire : 59 ms

=== 5. Vérification de la sélection multi-pages et « Tout cocher filtré » ===
  Bouton après tout cocher : "Générer (30000)" (sélection globale de toutes les pages)

=== 6. Filtrage et compteur « dont M hors filtre » ===
  Badge de sélection : "Factures ouvertes (750 / 30000) Choisir une caisse… CAISSE1 - Caisse Principale Générer (30000) Cochées : 30000(dont 29250 hors filtre) Total : 77 985 000,00 MAD Décocher hors filtre Colonnes Rafraîchir"
  Bouton "Décocher hors filtre" présent, clic pour purger la sélection masquée...
  Badge après purge hors filtre : "Factures ouvertes (750 / 30000) Choisir une caisse… CAISSE1 - Caisse Principale Générer (750) Cochées : 750 Total : 1 935 000,00 MAD Colonnes Rafraîchir"

=== 7. Boîte de confirmation et Génération (Non-régression TASK-108) ===
  [dialog intercepté] "Confirmez-vous la génération de 750 règlement(s) espèce pour un montant total de 1 935 000,00 MAD sur la caisse CAISSE1 ?..."
  [API] POST /api/reglements/generer-espece : 750 factures transmises
  Message de dialogue capturé : "Confirmez-vous la génération de 750 règlement(s) espèce pour un montant total de 1 935 000,00 MAD sur la caisse CAISSE1 ?"
  Tableau Résultat affiché post-génération : true

>>> TOUTES LES VÉRIFICATIONS E2E ONT RÉUSSI (100% SUCCÈS) ! <<<
```

### Captures d'écran produites (`tasks/VERIFY/TASK-107_evidence/`)
- `01_ouverture_tri_defaut.png` : Ouverture de l'écran avec 30 000 factures, tri initial `Date facture ▲`, 100 lignes rendues, bandeau `Affichage 1 à 100 sur 30000`.
- `02_tri_toutes_colonnes.png` : Tri validé sur l'ensemble des 8 colonnes actives en ascendant et descendant.
- `03_pagination_page2.png` : Découpage à 50 / page et navigation en page `2 / 600`.
- `04_selection_avec_hors_filtre.png` : Filtrage sur `CL001` affichant `Cochées : 30000 (dont 29250 hors filtre)` avec bouton `Décocher hors filtre`.
- `05_resultats_post_generation.png` : Tableau de résultat affiché post-génération (succès et erreurs, non-régression TASK-108 préservée).

---

## 5. Script des scénarios de test manuels (Recette UX)

Ce scénario pas-à-pas permet à l'équipe recette de valider le comportement en conditions réelles :

### Scénario 1 : Ouverture de l'écran et tri par défaut
1. Se connecter à l'application GOCOM Web.
2. Cliquer sur l'entrée de menu **« Règlement espèce »** dans la barre latérale.
3. **Constat attendu** :
   - Un seul appel réseau `GET /api/reglements/factures-a-regler` est émis dans l'onglet Réseau des DevTools.
   - La grille s'affiche immédiatement sans freeze du navigateur.
   - 100 factures sont affichées dans la première page.
   - L'en-tête de la colonne **« Date facture »** présente l'indicateur **`▲`**. Les factures sont ordonnées chronologiquement de la plus ancienne à la plus récente.

### Scénario 2 : Tri cliquable sur chaque colonne
1. Cliquer sur l'en-tête **« Date facture »** : l'indicateur bascule sur **`▼`**, les factures les plus récentes apparaissent en haut.
2. Cliquer successivement sur **« Montant »**, **« N° Facture »**, **« Code Client »**, **« Intitulé Client »**, **« Date échéance »**, **« Solde »**, **« Représentant »** :
   - Premier clic : tri ascendant (`▲`).
   - Deuxième clic : tri descendant (`▼`).
3. Naviguer vers la page 2 : vérifier que l'ordre global est conservé (les valeurs de la page 2 suivent celles de la page 1).

### Scénario 3 : Pagination client
1. Dans le bandeau de pagination en bas de tableau, changer la taille de page de `100` à `50`.
2. **Constat attendu** : exactement 50 lignes sont affichées, le nombre total de pages est recalculé.
3. Cliquer sur **« Suivant »** : passage à la page 2 / N.
4. Rafraîchir la page du navigateur (F5) : la taille de page sélectionnée (`50`) est conservée via `localStorage`.

### Scénario 4 : Sélection multi-pages et « Tout cocher filtré »
1. Cocher la case à cocher maîtresse située dans l'en-tête de la première colonne (case `th`).
2. **Constat attendu** : le bouton d'action affiche **`Générer (N)`** où N correspond à la totalité des factures filtrées (toutes les pages sont sélectionnées).
3. Parcourir les pages 1, 2 et 3 : chaque ligne apparaît cochée.

### Scénario 5 : Changement de filtre avec sélection existante
1. Alors que toutes les factures sont cochées, cliquer sur l'entonnoir de filtre d'une colonne (ex. `Code Client`).
2. Filtrer sur un seul client spécifique.
3. **Constat attendu** :
   - Le compteur au-dessus du tableau affiche : `Cochées : N (dont M hors filtre)`.
   - Un bouton d'action orange **`Décocher hors filtre`** apparaît automatiquement à côté du bouton Rafraîchir.
4. Cliquer sur **`Décocher hors filtre`** :
   - Les factures masquées sont purgées de la sélection.
   - La mention `(dont M hors filtre)` disparaît et le total s'ajuste au montant des seules factures visibles.

### Scénario 6 : Génération et boîte de dialogue de confirmation
1. Sélectionner une caisse dans le menu déroulant.
2. Cliquer sur **« Générer »**.
3. **Constat attendu** :
   - Une boîte de dialogue de confirmation s'affiche, récapitulant le nombre de règlements et le montant total.
   - Si des factures étaient encore sélectionnées hors filtre, un message d'alerte spécifique prévient l'opérateur avant validation.
4. Confirmer le dialogue :
   - L'appel API `POST /api/reglements/generer-espece` est émis.
   - Le tableau **« Résultat de la génération »** s'affiche sous la grille avec le détail des règlements créés et des erreurs isolées (TASK-108).

---

## 6. Checklist VALIDATION

- [x] **Build OK** (back `dotnet build` : 0 erreur ; front `npm run build` : 0 erreur).
- [x] **Log du build backend joint au rapport** (section 3 ci-dessus).
- [ ] **Garde-fou SQL `Solde > 0` ligne ~210 prouvé par exécution du service** — DÉCOCHÉE.
  > Limite architecturale documentée (section 1, point B) : le garde-fou de la ligne ~210
  > (`"Facture déjà soldée ou introuvable en base au moment de l'écriture."`) ne peut pas être
  > déclenché depuis le harnais externe sans injection de dépendance sur `IEcheanceRepository`.
  > Le code est présent et correct (revue de code). La preuve par exécution nécessite un
  > test d'intégration avec mock. `Distinct()` reste prouvé (test 3 : PASS).
- [x] **Déduplication `Distinct()` prouvée** (test 3 : 1 élément retourné sur liste `[id, id]`, 0 règlement créé).
- [x] **Aucun credential en dur dans le dépôt** — CORRIGÉ.
  > `harness_task107/Program.cs` lit désormais `HARNESS_CONN_STRING`, `HARNESS_TRESO_USER`,
  > `HARNESS_TRESO_PWD` depuis les variables d'environnement. Le dossier `harness_task107/`
  > est ajouté au `.gitignore`.
- [x] **Mesures avant/après ré-exécutées sur 30 000 lignes** (1 383 nœuds DOM vs ~360 000, réactivité 59 ms vs freeze > 1,5 s).
- [x] **Tri vérifié sur TOUTES les 8 colonnes actives** (Playwright : ascendant et descendant validés sur chaque colonne avec ordre global).
- [x] **Double appel à l'ouverture requalifié** en *« atténuation par verrou `loadingFacturesRef`, cause racine non identifiée »*.
- [x] **Script des scénarios de test manuels joint** (section 5).
- [x] **Cohérent avec l'architecture**.
