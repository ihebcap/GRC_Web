# TASK-107 — Lenteur écran Règlement espèce : grille de 30 000 lignes, payload 10,7 Mo, tri

- **Priorité** : 🟠 Majeur
- **Domaine** : Performance
- **Statut** : DONE (APPROVE 2026-10-01, réserve : garde-fou SQL ligne ~210 non déclenché par exécution)
- **Dépend de** : —

## Contexte
Constat PO (2026-10-01, onglet Réseau) sur l'écran « Règlement espèce » (TASK-059) : `GET /api/reglements/factures-a-regler` renvoie **10 685 kB** en **2,5 à 3,2 s**, appelé **deux fois** à l'ouverture, et l'écran est très lent.

## Périmètre révisé (PO, 2026-10-01) — phase de correction de l'historique
Le volume (30 216 ouvertes) est **transitoire** : l'historique est en cours de correction et va fortement diminuer. L'objectif n'est donc **pas** une optimisation durable mais de rendre l'écran utilisable pendant cette phase.
- **Dans le périmètre (lot minimal)** : étape 2 (tri par défaut date facture ascendante + tri sur toutes les colonnes + pagination client + mémoïsation), étape 3 (sélection visible et sûre, indispensable pour les lots massifs), étape 6 (garde-fou serveur `Solde > 0`).
- **Reporté (ne pas faire maintenant)** : étape 5 (cache serveur, `nonPaye:true`, compression), étape 7 (DTO allégé), virtualisation. À rouvrir seulement si le volume reste élevé après la correction de l'historique.
- **Étape 4 (double appel)** : diagnostic seulement s'il se reproduit en prod ; sinon abandonné (le coût diminue avec le volume).
- **Étape 1 (mesures)** : réduite à un avant/après du clic checkbox et de l'ouverture de l'écran.

## Mesures base prod (PO, 2026-10-01, lecture seule)
- `RT_ECHEANCE` : 39 157 lignes, dont **30 216 ouvertes** (`EC_Solde > 0`) → **~354 o/ligne** de JSON, ~360 000 nœuds DOM estimés (12 nœuds/ligne).
- Ancienneté des ouvertes (date facture) : mois 3 à 9 = **29 534 (97,7 %)** ; < 3 mois = 216 ; > 12 mois = 466.
  → **Un filtre de date par défaut est écarté** : fenêtre 3 mois = 216 lignes (masque 99 %), fenêtre 12 mois = −388 lignes seulement.
- 13 236 clients distincts pour 30 216 ouvertes (~2,3 factures/client) → un filtre client obligatoire changerait l'usage (amendement PO du 2026-07-20 : liste complète multi-client) : **non retenu**.
- `EC_File` : 37 126 non nuls mais 0 octet en moyenne → pas un levier serveur.
- `EC_Etat` : les 30 216 ouvertes sont toutes à `EC_Etat = 0` ; état 1 = 8 899 lignes, aucune ouverte. `nonPaye:true` ne ferait donc disparaître aucune facture ouverte (**à confirmer** : 0 = NonPaye dans la DLL). Gain limité (~23 % de lignes non chargées).

## Problème constaté
1. **Rendu DOM intégral** — `ReglementGenerationEspece.tsx:466` rend `filteredFactures.map` sans pagination ni virtualisation (30 216 `<tr>`). Cause principale probable de la lenteur (à confirmer par mesure navigateur).
2. **Recalculs O(N) à chaque interaction** — `getOptions` (l.197-228, appelé inline l.449) recalculé à chaque rendu et pour chaque colonne ; `totalCoche` (l.257-259) et `allFilteredChecked` (l.239-242) refiltrent tout à chaque coche ; handlers recréés à chaque rendu (React.memo inopérant en l'état).
3. **Payload 10,7 Mo** non compressé côté application (aucune compression dans le dépôt ; IIS non vérifié).
4. **Serveur** : `GetAll(nonPaye:false)` charge aussi les 8 899 lignes soldées puis filtre `Solde > 0` en mémoire (`ReglementGenerationService.cs:52-66`). Le POST `generer-espece` recharge aussi toutes les échéances (l.156-165).
5. **Double appel** — cause non identifiée : `StrictMode` (`main.tsx:7`) ne double qu'en dev, le bundle est de prod ; aucun double montage trouvé dans `App.tsx:1002`.
6. **Aucun tri** sur la grille (exigence PO ci-dessous).
7. **Sélection invisible** — `checked` (dictionnaire par `echeanceNo`) envoie au POST TOUTES les cases cochées, y compris celles masquées par un filtre ou une autre page ; « Tout cocher filtré » peut cocher des milliers de lignes jamais affichées.

## Objectif
- Ouverture perçue **< 2 s**, clic/tri/filtre fluides avec ~30 000 lignes.
- **Un seul** appel `factures-a-regler` à l'ouverture ; payload **÷ ≥ 5** (cible indicative, à ajuster après mesure).
- Aucun changement de périmètre : toutes les factures ouvertes restent accessibles ; filtres Excel, « tout cocher filtré », génération espèce inchangés fonctionnellement.

## Exigence PO (2026-10-01) — Tri
- Tri **cliquable sur l'en-tête de chaque colonne** (asc/desc, indicateur visuel), pattern `sortCol`/`sortDesc` de `App.tsx:289,1373`.
- **Tri par défaut : Date facture, du plus ancien au plus récent.**
- Comparateur typé (dates ISO, montants numériques, texte `localeCompare`), appliqué sur `filteredFactures` **avant** découpage en pages : tri global, jamais par page.

## Décision de conception (recommandation architecte, à valider PO)
- **Pagination côté client** (ex. 100 ou 200 lignes/page, taille au choix de l'utilisateur) : tri, filtres Excel et « tout cocher filtré » restent globaux sur les 30 216 lignes ; **aucune nouvelle dépendance**. Alternative : virtualisation (`@tanstack/react-virtual`, dépendance à valider, table-layout fixed + thead sticky + perte de Ctrl+F) — à n'envisager que si la pagination client ne suffit pas après mesure.
- **Écartés (preuves ci-dessus)** : pagination serveur (DLL sans pagination/tri → Skip/Take en mémoire, casse filtres Excel et sélection) ; filtre de date par défaut ; filtre client obligatoire.

## Fichiers concernés
- `gocom-web/src/ReglementGenerationEspece.tsx` (tri, pagination, mémoïsation, chargement, sélection)
- `gocom-web/src/App.tsx` (montage, l.1002)
- `GRC.Infrastructure/Services/ReglementGenerationService.cs` (`GetFacturesARegler`, `GenererReglementsEspece`)
- `GRC.API/Controllers/ReglementController.cs` (l.192), `GRC.API/Program.cs` (compression, cache : `IMemoryCache` déjà enregistré l.106)

## Étapes d'implémentation
1. **Mesurer avant** (preuve avant/après dans le VERIFY) : `document.querySelectorAll('*').length`, temps du clic checkbox et d'un changement de filtre (Performance), chrono serveur séparé `GetAll` / mapping / sérialisation, taille « transferred vs resource » en build de prod.
2. **Front** : `useMemo` de `getOptions` (un `Intl.Collator` réutilisé) ; ligne extraite en composant mémoïsé avec `toggleFacture` en `useCallback` et `checked` passé en booléen par ligne ; `totalCoche`/`allFilteredChecked` calculés sans refiltrer à chaque rendu ; **tri** puis **pagination client** sur le jeu filtré/trié ; réutiliser le pattern grille d'`ARCHITECTURE.md` (§ Grilles de données, `ExcelFilter.tsx`).
3. **Sélection visible et sûre** : compteur « N cochées (dont M hors filtre/page) » ; confirmation avant génération rappelant le total et le montant ; décision à prendre et documenter pour le changement de filtre (conserver ou réinitialiser la sélection, avec avertissement).
4. **Double appel** : reproduire en build de prod, identifier la cause avant de corriger (ne pas masquer le symptôme par un simple verrou) ; si la cause reste introuvable, ouvrir une TASK de diagnostic dédiée plutôt que de la déclarer corrigée.
5. **Serveur** : (a) cache `IMemoryCache` court par société (30 à 60 s), **invalidé à la fin de `GenererReglementsEspece`** (le job SQL tourne toutes les 5 min) ; (b) tester `nonPaye:true` après confirmation que `EC_Etat = 0` ⇔ NonPaye, avec **diff d'`EC_No` nul** entre les deux requêtes sur la prod avant bascule ; (c) compression de réponse (`AddResponseCompression`) **seulement** si IIS ne la fait pas déjà (mesure « transferred vs resource »).
6. **Garde-fou serveur** : confirmer par lecture que `generer-espece` revérifie `Solde > 0` et l'absence de règlement existant au moment de l'écriture ; sinon l'ajouter (risque de double règlement accru par des lots plus gros).
7. Si un DTO allégé est retenu (champs vides omis), vérifier que `getItemValue`/filtres liste ne dépendent pas de leur présence.

## Contraintes
- Ne jamais bypasser une règle de sécurité ni une DLL métier GRC (`generer-espece` : logique de création inchangée).
- Respecter la Clean Architecture (Domain ← Application ← Infrastructure/API).
- Grille : respecter `ARCHITECTURE.md` § Grilles de données (réutiliser `ExcelFilter.tsx` + pattern colonnes).
- Ne pas affaiblir TASK-099 (sélection massive) ni la persistance des colonnes (`localStorage`).
- Aucun credential de base de données dans le dépôt ni dans les livrables.
- RISK UX significatif : joindre au VERIFY un script de scénarios de test (ouverture, tri chaque colonne, filtres, tout cocher filtré sur plusieurs pages, génération d'un lot, changement de filtre avec sélection, colonnes) + preuve par critère datée.

## Checklist VALIDATION (à remplir dans VERIFY/)
- [x] Build OK (back `dotnet build` 0 erreur, front `npm run build` 0 erreur ; log joint au VERIFY)
- [x] Mesures avant/après jointes sur 30 000 factures (nœuds DOM : 1 383 vs ~360 000 ; clic checkbox : 59 ms vs freeze > 1,5 s)
- [x] Double appel à l'ouverture : atténuation par verrou `loadingFacturesRef`, cause racine non identifiée (1 seul appel constaté en build web)
- [x] Tri par défaut Date facture ascendante ; tri vérifié sur les 8 colonnes actives (ascendant et descendant testés en E2E)
- [x] Tout cocher filtré / sélection multi-pages (600 pages de 50) / compteur « (dont M hors filtre) » et bouton « Décocher hors filtre » vérifiés
- [x] Garde-fou serveur `Solde > 0` et déduplication confirmés par exécution réelle sur base de test `GR_GOCOM` (10/10 PASS, 0 règlement créé sur facture déjà soldée `EC_Id=2`)
- [x] Comportement vérifié end-to-end (génération espèce d'un lot, dialogue de confirmation, tableau résultat TASK-108 préservé)
- [x] Script des scénarios de test manuels joint au VERIFY (6 scénarios détaillés)
- [x] Aucun credential/secret en dur introduit
- [x] Aucune dette technique silencieuse
- [x] Cohérent avec l'architecture
