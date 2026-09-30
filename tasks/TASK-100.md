# TASK-100 — Rapprochement : sélection de plusieurs relevés bancaires (combo à cases à cocher)

- **Priorité** : 🟠 Majeur
- **Domaine** : Front + Backend (auto-rapprochement) — **RISK HIGH**
- **Statut** : TODO
- **Dépend de** : —

## Contexte
Demande PO (2026-09-30) : aujourd'hui un seul relevé est sélectionnable (`<select>`,
`RapprochementBancaire.tsx:1177-1187`, état `selectedReleveId: number | ''`). Le PO veut en
sélectionner plusieurs via un combo à cases à cocher. Le composant local `CheckboxDropdown` existe
déjà (`ApercuComptabilisation.tsx`, compacté en TASK-095) : **le réutiliser / l'extraire, ne pas en
inventer un autre.**

## Problème constaté — 3 pièges (vérifiés dans le code) à traiter obligatoirement
1. **Collision de lettres.** La lettre de rapprochement est calculée **par relevé** côté serveur
   (applock `rapp_lettrage_<enteteId>`, `max présent + 1` filtré sur `ReleveBancaireEnteteId`).
   Avec 2 relevés, les deux auront une lettre « A ». Or le front apparie par la lettre seule :
   `pairedLettrages` (~l.1020), tri par lettre, dé-rapprochement par lettre (`delettrerByLettrage`),
   recalcul de `currentLettrageIndex`. → **fausses paires et dé-rapprochement du mauvais relevé.**
   La clé d'appariement doit devenir `(releveEnteteId, lettre)` côté front ; chaque ligne relevé
   porte son `enteteId`. La lettre reste attribuée par le serveur, par relevé (règle TASK-037).
2. **Auto-rapprochement.** `POST /ReleveBancaire/auto-reconcile` prend un seul
   `ReleveBancaireEnteteId` (`ReleveBancaireController.cs:~129, 455`). Lancé relevé par relevé, le
   même règlement pourrait être proposé à 2 relevés (l'unicité du montant n'est plus garantie sur
   l'union). → Le moteur doit tourner sur l'**union des lignes libres** des relevés sélectionnés
   (1=1 strict préservé, sur l'union) ; l'endpoint accepte une liste `ReleveBancaireEnteteIds` ;
   chaque proposition retourne l'`enteteId` de sa ligne pour que `reserve-batch` prenne son verrou
   par entête. **Le moteur lui-même n'est pas modifié**, seulement son jeu d'entrée.
   Rétro-compat : l'ancien champ mono-entête reste accepté.
3. **Race conditions.** Le chargement des lignes (`fetchLignesReleveSeqRef`, TASK-079) est
   mono-requête. Avec N relevés : N requêtes `/ReleveBancaire/{id}/lignes` en parallèle, invalidées
   ensemble par un compteur de séquence unique (un ancien lot n'est jamais appliqué).

## Décision PO (2026-09-30) — principe directeur
**Pour l'utilisateur, plusieurs relevés se traitent comme un seul relevé sur son écran.** Aucune
notion de « relevé courant » à gérer : une seule grille Relevé (union), une seule grille GRC, les
boutons Auto / Approuver / Dérapprocher / Générer règlement / Exporter agissent sur l'ensemble.
L'identifiant du relevé n'est qu'un **point technique** : il est ajouté **devant la lettre**
(repère affiché `<idRelevé>-<lettre>`, ex. `12-A`, `15-A`) pour rendre le repère unique, sans que
l'utilisateur ait à raisonner en relevés.

Arbitrage de conception (retenu, à respecter) :
- **Stockage inchangé** : la colonne `Lettrage` de `RAPP_ReleveBancaire_Ligne` garde la lettre nue
  (« A ») — pas de migration, pas de changement de `LettrageGenerator`, données existantes intactes,
  attribution serveur par relevé (TASK-037) inchangée.
- Le préfixe est **composé côté front** avec `enteteId` : la ligne relevé le porte déjà ; pour le
  règlement GRC, `ReglementService.cs:~301` lit déjà `Lettrage` dans la même table : **ajouter
  `ReleveBancaireEnteteId` à ce SELECT** et l'exposer dans le DTO (`releveEnteteId`).
- **Affichage** : préfixe visible seulement si **> 1 relevé** sélectionné ; avec 1 seul relevé
  l'écran reste strictement identique à aujourd'hui (lettre nue).
- La clé d'appariement interne est `(enteteId, lettre)` partout (`pairedLettrages`, tri,
  `delettrerByLettrage`, `currentLettrageIndex`, filtre « Repère »).

## Objectif
- Le combo « Relevé associé… » devient multi-sélection (cases à cocher + recherche + « Tout
  sélectionner »), libellé compact « 2 relevés » si > 1.
- Par défaut à la sélection de la banque : comportement actuel conservé (seul le 1er relevé est
  coché — évite de charger des milliers de lignes par surprise).
- Grille Relevé = union des lignes ; colonne **« Relevé »** (titre) + filtre liste ; filtres/tri
  existants opérationnels sur l'union.
- Colonne « Repère » des DEUX grilles affiche `12-A` (si > 1 relevé) ; le filtre « Repère » liste ces
  valeurs préfixées.
- Auto, Approuver, Dérapprocher, Générer règlement (par `LigneReleveId`), compteurs et export
  (TASK-101) fonctionnent sur l'union sans régression, sans que l'utilisateur choisisse un relevé.
- Aucun appariement possible en croisant deux relevés par la lettre.

## Fichiers concernés
- `gocom-web/src/RapprochementBancaire.tsx` (état, fetch lignes, `pairedLettrages`, tri,
  `handleAutoReconcile`, `handleDelettrerTout`, colonnes)
- `gocom-web/src/ApercuComptabilisation.tsx` (`CheckboxDropdown` — extraire dans un fichier partagé
  *sans changer son rendu*, ou l'importer)
- `GRC.API/Controllers/ReleveBancaireController.cs` (`AutoReconcileRequest`, `GenererPropositions`)
- `GRC.Infrastructure/Services/ReglementService.cs` (~l.291-354, SELECT réservations + `ReglementMapper` : ajout `releveEnteteId`) et DTO de proposition (ajout `enteteId`) — lecture avant modification

## Étapes d'implémentation
1. Lire `reserve-batch`, `release-batch`, `validate` : confirmer qu'ils portent l'entête par ligne
   (sinon l'ajouter au DTO). **Signaler dans le VERIFY toute hypothèse non confirmée.**
2. Extraire/réutiliser `CheckboxDropdown`.
3. `selectedReleveId` → `selectedReleveIds: number[]` ; fetch parallèle + agrégation, séquence unique.
4. Clé composite `(enteteId, lettrage)` partout où la lettre seule est comparée ; helper unique `formatRepere(enteteId, lettre, multi)` pour l'affichage.
5. Adapter `/auto-reconcile` (liste d'entêtes, union, `enteteId` dans la réponse).
6. Colonne « Relevé » + filtre liste.

## Scénarios de test obligatoires (RISK HIGH — le VERIFY doit les rejouer)
1. 1 relevé sélectionné : comportement identique à avant (non-régression).
2. 2 relevés, rapprochement manuel sur chacun : repères `12-A` et `15-A` distincts sur les deux grilles → aucune fausse paire ; avec 1 seul relevé, lettre nue « A ».
3. Auto sur 2 relevés : 1=1 sur l'union ; un même règlement jamais proposé deux fois.
4. Dérapprocher sur un relevé n'affecte pas l'autre.
5. Approuver avec des paires venant de 2 relevés.
6. Cocher/décocher rapidement : aucune donnée d'un ancien lot affichée.
7. Changement de banque : sélection remise à zéro.

## Contraintes
- Ne jamais bypasser une règle de sécurité ou une DLL métier GRC.
- Le contrôle IDOR par entête (TASK-075) reste appliqué à **chaque** entête demandé.
- Le moteur strict 1=1 n'est pas modifié (écart actée au TODO).
- Grilles : réutiliser `ExcelFilter.tsx` et le pattern colonnes.

## Checklist VALIDATION (à remplir dans VERIFY/, preuve datée par critère)
- [ ] Build OK (back + front, 0 erreur)
- [ ] 7 scénarios ci-dessus rejoués et documentés (résultat + date)
- [ ] Contrôle d'autorisation vérifié pour chaque entête (403 sur entête hors société)
- [ ] Aucun credential/secret en dur introduit
- [ ] Aucune dette technique silencieuse
- [ ] Cohérent avec l'architecture
