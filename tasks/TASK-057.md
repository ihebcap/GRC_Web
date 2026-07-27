# TASK-057 — Écran recouvrement BL dans GRC_WEB : évaluation (remplacement de `vMetaRecouvrementBL`/Metabase)

- **Statut** : ❌ **ABANDONNÉE (non retenue)** — décision PO 2026-07-16, voir « Clôture » en fin de fichier.
- **Priorité** : — (n'a jamais été développée)
- **Domaine** : Architecture / Backend (API+Infra) + Front
- **Dépend de** : [TASK-056](TASK-056.md) (seule TASK active sur ce sujet — le fix SQL est la
  solution définitive, pas un stopgap)

## Contexte

Suite à TASK-056 (correction de `vMetaRecouvrementBL`), question PO 2026-07-16 : plutôt que de
continuer à porter la logique de recouvrement par BL dans une vue SQL consommée par Metabase,
faut-il construire un écran dédié dans GRC_WEB ?

Argument déclencheur : en corrigeant TASK-056, une hypothèse de bug (`FA_BL`) s'est révélée fausse
**uniquement parce qu'elle reposait sur une lecture de SQL sans pouvoir l'exécuter/tester** — la
vue porte une logique métier non triviale (répartition FIFO d'un versement sur plusieurs BL,
agrégation multi-client, contrôle d'accès par dépôt) sans le filet de sécurité qu'offre le reste de
GRC_WEB (Clean Architecture, code C# testable, revue de code, VERIFY/checklist).

Décision PO : ne pas bloquer le correctif SQL (déjà livré, gratuit) sur cette question plus large —
traiter les deux en parallèle, cette TASK est une **évaluation**, pas encore un engagement de dev.

## Problème constaté

Le modèle actuel (vue SQL + sandbox Metabase) a trois limites structurelles :
1. **Logique métier non testable** : la répartition FIFO, l'agrégation multi-client, les règles
   d'exclusion (`FA_BL`, `FG_BlFacture`) vivent en SQL pur — pas d'unit test, pas de compilateur,
   erreurs découvertes seulement par diagnostic manuel en prod (cf. TASK-056).
2. **Contrôle d'accès hors du modèle applicatif** : le périmètre par dépôt et l'exception `n.salim`
   sont gérés par une liste d'exclusion d'emails codée en dur (`dep` CTE) + une configuration de
   sandbox Metabase externe au repo — aucune trace versionnée, aucun test, incohérent avec le
   modèle de claims JWT déjà en place dans GRC.API (cf. TASK-032 : `IsAdmin` bypass serveur).
3. **Pas de piste d'audit applicative** : Metabase n'enregistre pas qui a consulté quoi dans le
   contexte métier GRC ; un écran dédié pourrait s'appuyer sur le même Serilog que TASK-041.

## Objectif de cette TASK (évaluation, pas implémentation)

Produire un document de cadrage permettant au PO de décider **go/no-go** sur un écran dédié :

1. **Périmètre fonctionnel minimal** : lecture seule (liste BL + solde + statut recouvrement),
   filtrage par dépôt (claim JWT, à l'image de TASK-032), export éventuel (CSV/Excel) si Metabase
   sert aussi à ça aujourd'hui pour cet usage précis.
2. **Portage de la logique métier** : réécrire la répartition FIFO et l'agrégation multi-client en
   C# (Application/Domain), source de vérité unique remplaçant `r`/`BL`/`Documents` de la vue —
   avec tests unitaires sur les cas limites (versement multi-BL, BL multi-client, montant partiel).
3. **Estimation d'effort** : comparer au coût réel de TASK-054 (import Excel, nouvel écran complet)
   pour calibrer un ordre de grandeur (jours/semaines), pas une estimation en l'air.
4. **Ce qu'on perd** si on quitte Metabase pour ce rapport précis : pivots ad-hoc, graphiques,
   export self-service par les utilisateurs métier sans repasser par un ticket de dev — à trancher
   avec le PO si ces usages existent réellement sur ce rapport (par opposition aux autres dashboards
   Metabase, hors périmètre).
5. **Recommandation chiffrée** : construire l'écran, garder Metabase avec TASK-056 comme solution
   durable, ou une solution hybride (écran GRC_WEB pour le contrôle quotidien par dépôt + Metabase
   conservé pour l'analyse transverse/n.salim).

## Clôture — décision PO 2026-07-16

Fait générateur : les dépôts commerciaux **n'ont aucun accès à GRC_WEB** et resteront de toute
façon sur Metabase — TASK-056 (vue corrigée) est donc nécessaire pour eux quoi qu'il arrive.
Restait la question de `n.salim` : une fois TASK-056 appliqué, si son groupe Metabase n'a **aucun
sandbox** (donc voit déjà tous les BL), Metabase répond **entièrement** à son besoin, sans code
supplémentaire. Interrogé sur la vraie raison de vouloir malgré tout un écran dédié (outil unique,
migration future des dépôts vers GRC_WEB…), réponse PO : **aucune raison particulière — Metabase
corrigé (TASK-056) suffit aussi pour n.salim**.

**Conclusion : TASK-056 est la solution complète et définitive pour ce sujet.** Cette TASK est
abandonnée sans développement — à rouvrir uniquement si un besoin concret apparaît plus tard
(ex. accès GRC_WEB donné aux dépôts, ou action non disponible dans Metabase que n.salim réclame).

## Fichiers concernés

Aucun à ce stade — TASK d'évaluation. Si go, cette section sera reprise par la/les TASK
d'implémentation qui en découleront (API+Infra+Front, à découper séparément).

## Étapes d'implémentation

1. Lister les usages réels de `vMetaRecouvrementBL` dans Metabase aujourd'hui (dashboards,
   filtres, exports) — **à fournir par le PO**, non déductible du SQL seul.
2. Rédiger le cadrage (points 1 à 5 de l'Objectif) sous forme de note courte.
3. Soumettre au PO pour décision go/no-go.
4. Si go : découper en TASK d'implémentation distinctes (API, Front, migration des accès),
   dépendant de cette TASK.

## Contraintes

- Ne pas démarrer de développement avant validation explicite du cadrage par le PO.
- Si go : respecter la Clean Architecture (Domain ← Application ← Infrastructure/API), même
  modèle de droits que le reste de GRC_WEB (claims JWT, pas de logique d'accès en dur).
- Ne pas dupliquer indéfiniment la logique entre la vue SQL (TASK-056) et l'écran : si l'écran est
  construit, la vue devient obsolète pour cet usage et devrait être documentée comme telle (pas
  forcément supprimée si Metabase la réutilise ailleurs — à vérifier avant toute suppression).

## Checklist VALIDATION (à remplir dans VERIFY/)

- [ ] Usages réels de la vue dans Metabase recensés (PO)
- [ ] Note de cadrage rédigée (périmètre, portage logique, estimation, arbitrage Metabase)
- [ ] Décision PO explicite : go / no-go / hybride, tracée dans ce fichier ou en commentaire TODO
- [ ] Si go : TASK(s) d'implémentation créées et liées à cette TASK
