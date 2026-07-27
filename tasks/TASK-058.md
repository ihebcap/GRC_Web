# TASK-058 — `vMetaRecouvrementBL` : table persistée pour le recouvrement par BL (fix durable perf)

- **Priorité** : 🔴 Bloquant (Metabase inutilisable en l'état : ~3-4 min par exécution)
- **Domaine** : Performance / Architecture (SQL Server, base `GR_GOCOM`, hors GRC_WEB)
- **Statut** : TODO (cadrage — pas de SQL avant validation PO explicite)
- **Dépend de** : [TASK-056](TASK-056.md) (porte l'algorithme métier — FIFO, agrégation BL — à
  reproduire ici) ; remplace la piste [TASK-057](TASK-057.md) (écran GRC_WEB, abandonnée)

## Contexte

Incident constaté le 2026-07-16 en appliquant `SQL_007_TASK-056_RecouvrementBL_Perf.sql` : la vue
corrigée s'exécute en ~3-4 min (225 734 ms CPU), avec un profiler montrant 66 322 374 lectures
logiques sur `F_DOCLIGNE` (2 388 scans) et 6 996 220 sur `RT_ECHEANCE` (4 543 scans) — cf. section
« Incident — temps d'exécution » de `TASK-056.md`.

**Cause structurelle, pas un manque d'index** : la CTE `Documents` (qui embarque `BL`/`FA_BL`, donc
`F_DOCLIGNE`) est référencée deux fois dans la vue (`SELECT` final + `JOIN` de `ReglementAlloc`).
SQL Server ne matérialise jamais une CTE référencée plusieurs fois : l'optimiseur choisit un plan en
boucle imbriquée qui recalcule tout le sous-arbre `Documents` une fois par ligne consommée côté
`ReglementAlloc`. Combiné à `RT_ECHEANCE.DO_Numero` non indexable (Msg 1919, type LOB hérité), le
coût explose avec le volume réel de données. Une vue SQL pure — même bien écrite, même indexée — ne
peut pas éliminer ce recalcul : les CTE ne sont ni des tables temporaires ni des vues indexées, et la
logique (UNION ALL, `ROW_NUMBER`, `NOT EXISTS`, fenêtrage) est de toute façon inéligible à une vue
indexée SQL Server (restrictions : pas d'UNION, pas d'OUTER JOIN, pas de sous-requêtes, pas de
fonctions de fenêtrage).

Décision PO 2026-07-16 : arrêter de patcher la vue, cadrer une solution à base de **table
persistée** (le calcul FIFO/agrégation tourne une fois en batch, pas à chaque clic Metabase).

## Problème constaté

- Le modèle « tout recalculé à la volée dans une vue » ne peut pas tenir la charge réelle : un
  utilisateur Metabase qui clique sur un filtre redéclenche l'intégralité du recalcul FIFO sur tout
  l'historique.
- Aucun contournement SQL pur (index, réécriture de jointure, `OPTION (RECOMPILE)`) ne peut
  supprimer la ré-évaluation d'une CTE multi-référencée dans un plan en boucle imbriquée — seule une
  matérialisation physique (table réelle) le peut.
- `RT_ECHEANCE.DO_Numero` reste non indexable en l'état (limite serveur, pas contournable sans
  modification de schéma déjà écartée faute d'accord PO explicite, cf. TASK-056.md).

## Objectif

Produire un **cadrage écrit** (pas de SQL à ce stade) permettant au PO de trancher le go avant toute
implémentation :

1. **Forme de la table persistée** : quelles colonnes (a minima l'équivalent de la sortie actuelle
   de `vMetaRecouvrementBL` : `DO_Piece`, `DO_Date`, `DO_Tiers`, `NbClients`, `DE_No`, `DO_TotalTTC`,
   `TotalReglement`, `Solde`, `Controle`), quelle clé, quels index — pour que la vue finale (ou
   Metabase directement) ne fasse plus qu'une lecture simple.
2. **Mécanisme de rafraîchissement** — à trancher avec le PO, options non exclusives :
   - **Job planifié** (SQL Agent) recalculant tout ou partie à intervalle fixe (ex. toutes les
     5-15 min) — simple, mais fraîcheur = délai du job.
   - **Déclenché par écriture** (trigger sur `RT_MOUVEMENT` à l'insertion d'un versement, ou sur
     `F_DOCLIGNE`/`F_DOCENTETE` à la clôture d'un BL/facture) — fraîcheur quasi temps réel, mais
     complexité et risque de ralentir la saisie commerciale (tables ERP partagées, cf. contrainte
     déjà actée en TASK-056 sur les index).
   - **Recalcul à la demande** (procédure stockée appelée manuellement ou par un bouton) — le moins
     automatique, écarté si Metabase doit rester self-service pour les dépôts.
3. **Portée du recalcul** : full rebuild (simple, mais coûteux si rejoué souvent vu le volume) vs
   incrémental (ne retraiter que les BL/règlements touchés depuis le dernier passage — nécessite un
   critère de detection des lignes changées, ex. `MV_ID`/`DO_Piece` modifiés depuis `MAX(déjà connu)`).
4. **Tolérance de fraîcheur métier** : combien de temps de décalage entre un versement réel saisi et
   son apparition dans le recouvrement est acceptable pour les dépôts et pour `n.salim` — **à obtenir
   du PO**, ce n'est pas une donnée technique déductible du code.
5. **Migration de `vMetaRecouvrementBL`** : garder le même nom de vue (pas de reconfiguration
   Metabase) en la redéfinissant comme une lecture simple de la table persistée + jointures légères
   (`F_COMPTET`, `F_DEPOT`) pour les libellés toujours à jour, ou pointer Metabase directement sur la
   table — à trancher selon l'impact sur les dashboards existants.
6. **Sécurité/périmètre par dépôt** : `account`/`dep` ont été retirés de la vue actuelle à la demande
   du PO (cf. TASK-056.md, risque signalé sur le sandbox Metabase potentiellement basé sur
   `A_EMAIL`) — si la table persistée réintroduit un filtre par dépôt, coordonner avec ce point pour
   ne pas dupliquer ou contredire la décision prise.

## Décision PO — 2026-07-16 (mécanisme + fraîcheur tranchés)

- **Mécanisme de rafraîchissement retenu : job planifié (SQL Agent)**, toutes les 15-30 min.
  PO a explicitement écarté l'option « bouton Metabase » (« on peut faire un bouton sur metabase ?
  je pense que non ») — confirmé : Metabase n'a aucun mécanisme natif pour déclencher un recalcul
  côté SQL Server depuis un bouton/dashboard (son "refresh" ne fait que relire la table telle
  qu'elle est à l'instant T). Le trigger sur écriture (option 2 du cadrage) est donc également
  écarté de fait — un job planifié suffit à la tolérance retenue et évite tout risque de ralentir
  la saisie commerciale sur les tables ERP partagées.
- **Tolérance de fraîcheur retenue : 15-30 min.** Cohérente avec la fréquence de job ci-dessus —
  pas besoin d'un mécanisme temps réel (trigger) pour ce niveau de tolérance.
- Points 1 (forme de table/index), 3 (portée du recalcul : full vs incrémental), 5 (migration de
  `vMetaRecouvrementBL`) et 6 (sécurité/périmètre dépôt) **restent ouverts** — à trancher avant
  passage en TASK(s) d'implémentation SQL.

## Fichiers concernés

`SQL_008_TASK-058_TablePersistee.sql` — **proposition rédigée 2026-07-16, PAS ENCORE APPLIQUÉE EN
BASE** (attend validation PO explicite, cf. Contraintes). Contenu :
1. Tables physiques jumelles `MetaRecouvrementBL_A`/`_B` (mêmes colonnes/types que la sortie
   actuelle de la vue, vérifiés en base : `DO_Piece varchar(13)`, `DO_Tiers varchar(17)`,
   `CT_Intitule varchar(69)`, `DO_TotalTTC/TotalReglement/Solde numeric(24,6)`, `DE_No int`), PK sur
   `DO_Piece`, index secondaires sur `DE_No` et `Solde` (colonnes filtrées côté Metabase).
2. `SYNONYM dbo.MetaRecouvrementBL_Live` pointant sur la table à jour — bascule atomique après
   chaque recalcul (motif "blue-green") : le job remplit toujours la table **inactive**, puis
   bascule le synonym en transaction courte. Metabase ne voit jamais une table à moitié remplie
   (contrairement à un `TRUNCATE`+`INSERT` sur une table unique, risqué si une connexion lit en
   `NOLOCK`).
3. `usp_RefreshMetaRecouvrementBL` : **full rebuild** à chaque run (pas d'incrémental — le calcul
   complet tient en ~3-4 min, largement dans le budget de 15 min entre deux runs). Reproduit
   exactement l'algorithme de `vMetaRecouvrementBL` v7 (SQL_007) — dupliqué une fois par branche
   A/B plutôt qu'en SQL dynamique, pour éviter tout risque d'échappement sur une requête de cette
   taille.
4. `vMetaRecouvrementBL` redéfinie comme une lecture simple du synonym — **même nom, mêmes
   colonnes** : aucune reconfiguration de la requête Metabase existante.
5. Job SQL Agent `GR_GOCOM - Refresh MetaRecouvrementBL`, planifié toutes les **15 min** (borne
   basse de la tolérance 15-30 min retenue par le PO, marge de sécurité si le calcul dépasse
   ponctuellement les ~3-4 min mesurés).

Cette proposition répond aux points 1 (forme de table), 3 (portée du recalcul = full) et 5
(migration de la vue) du cadrage ci-dessus — **à valider explicitement par le PO** avant
application. Le point 6 (sécurité/périmètre dépôt) n'est pas affecté : `DE_No` reste exposé sans
filtre, comme dans la vue actuelle.

## Étapes d'implémentation

1. Obtenir du PO la tolérance de fraîcheur acceptable (point 4) et le mécanisme de rafraîchissement
   préféré (point 2) — non déductibles du code.
2. Rédiger le cadrage complet (points 1 à 6 de l'Objectif) sous forme de note courte.
3. Soumettre au PO pour décision go/no-go sur la forme retenue.
4. Si go : découper en TASK(s) d'implémentation SQL (table + mécanisme de rafraîchissement +
   `ALTER VIEW` finale), avec le même mode opératoire section-par-section que SQL_007 (diagnostic →
   DDL → validation).

## Contraintes

- Ne pas démarrer de SQL avant validation explicite du cadrage par le PO (mêmes règles que
  TASK-057).
- Toute table/job/trigger touchant des tables ERP (Sage) partagées doit être validée avec l'admin
  GOCOM avant application (même règle que les index de TASK-056).
- Ne pas dupliquer indéfiniment la logique entre la table persistée et l'algorithme FIFO de
  TASK-056 : la table devient la source de vérité unique, l'algorithme actuel dans la vue est
  remplacé, pas copié à côté.
- Reproduire fidèlement l'algorithme validé en TASK-056 (FIFO par date de BL, agrégation au grain
  BL, dédoublonnage `Documents`, `FA_BL` inchangée) — pas une réécriture métier parallèle.

## Checklist VALIDATION (à remplir dans VERIFY/)

- [x] Tolérance de fraîcheur obtenue du PO — 15-30 min (2026-07-16)
- [x] Mécanisme de rafraîchissement tranché avec le PO — job planifié SQL Agent, bouton Metabase
      écarté (2026-07-16)
- [ ] Note de cadrage rédigée (forme de table, index, portée du recalcul, migration de la vue) —
      points 1, 3, 5, 6 encore ouverts
- [ ] Décision PO explicite : go / no-go / variante, tracée dans ce fichier
- [ ] Si go : TASK(s) d'implémentation créées et liées à cette TASK
