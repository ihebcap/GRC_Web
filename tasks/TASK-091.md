# TASK-091 — Lenteur de la liste des règlements (`GET /api/reglements`)

- **Priorité** : 🟠 Majeur
- **Domaine** : Performance (Backend)
- **Statut** : TODO
- **Dépend de** : —

## Contexte

Remontée PO (2026-09-29, capture DevTools à l'appui) : lenteur constatée sur l'écran de liste des
règlements (`gocom-web/src/App.tsx`). Dans l'onglet réseau fourni par le PO, la requête
`GET /api/reglements?societeId=1&caisses=&page=1&p...` pèse **7 119 kB**, largement l'appel le plus
lourd de la page (à comparer aux ~12 kB de `caisses`, ~4 kB de `distincts`, 0.2 kB de `historique`).

Le PO a initialement attribué la lenteur à la fonctionnalité d'historique des modifications
(TASK-086). **Exploration du code (2026-09-29) infirme ce lien** : `HistoriqueReglementModal.tsx`
n'appelle `GET /api/reglements/{no}/historique` qu'à l'ouverture manuelle du modal pour **un seul**
règlement (`useEffect` déclenché par `reglement.no`), jamais depuis la liste elle-même. La capture
réseau du PO confirme d'ailleurs cet appel à 0.2 kB, cohérent avec « pas de lien ». La lenteur vient
bien de l'appel `reglements`, indépendamment de TASK-086.

Cause probable identifiée par lecture de code, **à confirmer par Gemini avant de corriger** :
[ReglementController.cs:66-76](../GRC.API/Controllers/ReglementController.cs#L66-L76) et
[ReglementService.cs:28-189](../GRC.Infrastructure/Services/ReglementService.cs#L28-L189) —
`GetReglements` charge l'intégralité du périmètre (par défaut 30 jours glissants, `repo.GetAll(...)`
sur `ReglementClientRepository` de la DLL `Tresorerie.Dapper`), applique **tous les filtres dynamiques
en mémoire via LINQ-to-Objects** (client, numéro, pièce, référence, libellé, montant, plage
montant/solde, etc. — lignes 69 à 187), puis seulement **après tout ça** pagine avec
`.Skip((page-1)*pageSize).Take(pageSize)` ([ReglementController.cs:76](../GRC.API/Controllers/ReglementController.cs#L76)).
Le front propose aussi une option `pageSize=10000` (« Tout », `App.tsx:1360`) qui aggraverait
mécaniquement ce problème si sélectionnée.

**Non confirmé à ce stade** (à charge de Gemini avant de choisir une correction) :
- Le volume réel de lignes ramené par `repo.GetAll()` sur la fenêtre 30 jours du poste/société du PO
  au moment de la capture (nombre de caisses de l'utilisateur, ampleur du périmètre `caissesList`).
- Si le poids vient du nombre de lignes, du nombre de colonnes par ligne (la DLL `Tresorerie` peut
  ramener des champs non utilisés par le front), ou des requêtes complémentaires
  (réservations/affectation, lignes 189+ non lues en détail dans le cadrage de cette tâche).
- Si `pageSize` était à 50 ou à 10000 au moment de la capture du PO (à demander/reproduire).

## Problème constaté

Chargement de l'écran de liste des règlements perçu comme lent par l'utilisateur. Réponse HTTP de
`GET /api/reglements` mesurée à 7 119 kB pour un existant demandé sur 1 page.

## Objectif

Réduire drastiquement le poids et le temps de réponse de `GET /api/reglements` pour un usage
paginé normal (`pageSize` 10/25/50), sans changer le comportement fonctionnel des filtres actuels
(tous doivent continuer à produire le même résultat qu'aujourd'hui).

## Fichiers concernés

- `GRC.API/Controllers/ReglementController.cs` (`GetReglements`, lignes 26-79)
- `GRC.Infrastructure/Services/ReglementService.cs` (`GetReglements`, lignes 28-189+)
- `gocom-web/src/App.tsx` (appel front, option `pageSize=10000`)

## Étapes d'implémentation

1. Reproduire la lenteur (onglet réseau + mesure du temps de réponse serveur, pas seulement la
   taille) sur un poste avec un périmètre de caisses représentatif, `pageSize=50`, filtre date par
   défaut (30 jours).
2. Instrumenter/mesurer où va le temps : temps DB (`repo.GetAll`), temps de filtrage LINQ en
   mémoire, requêtes complémentaires (réservations/affectation lignes 189+), sérialisation JSON.
3. Documenter le diagnostic chiffré dans le VERIFY (nombre de lignes ramenées, taille moyenne par
   ligne, répartition du temps) **avant** de choisir la correction — ne pas corriger à l'aveugle.
4. Corriger selon le diagnostic réel (pistes possibles, à valider par les mesures, pas à appliquer
   par défaut) : pousser la pagination et les filtres compatibles au niveau SQL plutôt qu'en
   mémoire ; réduire les colonnes ramenées par la DLL si elle permet une projection partielle ;
   plafonner ou avertir sur l'option `pageSize=10000` si elle s'avère être la cause dans le cas
   remonté par le PO.
5. Vérifier qu'aucun filtre actuel ne change de résultat après correction (tester au moins un
   filtre par type : liste, plage, date).

## Contraintes

- Ne pas modifier le comportement des filtres actuels (résultat identique avant/après).
- Ne pas bypasser les règles métier portées par la DLL `Tresorerie.Dapper.Repositories.ReglementClientRepository` —
  si la correction touche la requête SQL sous-jacente, vérifier qu'elle reste cohérente avec ce que
  la DLL garantit aujourd'hui (pas de contournement direct de la DLL par SQL brut sans validation PO,
  cf. interdictions `tasks/TODO.md:47`).
- Si la correction nécessite de changer le contrat de l'API (pagination réellement poussée en SQL),
  vérifier tous les appelants front de `GET /api/reglements` (`App.tsx`, `RapprochementBancaire.tsx`,
  `ApercuComptabilisation.tsx`, `ReglementGenerationEspece.tsx` si concerné) pour non-régression.

## Risques / dépendances

- Si le poids vient de la DLL Tresorerie elle-même (pas du code GRC_WEB), la marge de correction
  peut être limitée sans modifier la DLL — signaler ce cas plutôt que de forcer une solution côté
  GRC_WEB seul.

## Checklist VALIDATION (à remplir dans VERIFY/)

- [ ] Build back OK (0 erreur)
- [ ] Diagnostic chiffré du poids/temps AVANT correction documenté (méthode + date)
- [ ] Poids de la réponse `GET /api/reglements` mesuré APRÈS correction sur le même scénario que la
      capture PO, avec comparaison chiffrée avant/après
- [ ] Tous les filtres existants revérifiés (résultat identique avant/après, au moins un cas par
      type de filtre : liste, plage montant/solde, date, booléen)
- [ ] Aucune régression sur les autres écrans consommant `GET /api/reglements`
- [ ] Aucune dette technique silencieuse
- [ ] Cohérent avec l'architecture (pas de bypass DLL métier)
