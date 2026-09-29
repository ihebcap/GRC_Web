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

**Approfondissement (2026-09-29, 2e et 3e passages de revue architecte)** — lecture complète de la
requête SQL sous-jacente et du mapping, en plus du contrôleur/service déjà cités :

- **La requête SQL réellement exécutée n'a AUCUN `ORDER BY`.** Vérifié dans le source décompilé de
  la DLL `Tresorerie.Dapper` (`D:\_vibe\_reference\GRC\app-12.3.2\decompiled\Dapper\Tresorerie.Dapper.Repositories\ReglementClientRepository.cs`,
  méthode `GetAll(int societeNo, DateTime dateDebut, DateTime dateFin, params int[] caissesNo)`,
  lignes 231-247 — c'est la surcharge appelée par `ReglementService.cs:61`). Le texte SQL de base
  (`QueryGetAllByCaissesAutorise`, ligne 20 du même fichier) est un simple `SELECT ... FROM
  [RT_MOUVEMENT] WHERE ...`, sans tri. **Ceci est un point bloquant pour toute correction qui
  pousserait la pagination en SQL (`OFFSET/FETCH`)** : sans `ORDER BY` explicite et stable (ex. sur
  `MV_Id`), l'ordre renvoyé par SQL Server pour une requête paginée n'est pas garanti — deux appels
  successifs peuvent renvoyer un ordre différent, ce qui provoquerait des **lignes dupliquées ou
  absentes entre deux pages consécutives** consultées par l'utilisateur. Toute pagination SQL doit
  donc obligatoirement s'accompagner d'un `ORDER BY` déterministe ajouté à la requête.
- **Le tri visuel actuel (`sortCol`/`sortDesc`) est en réalité un attrape-nigaud côté backend.** Le
  front envoie bien ces deux paramètres dans les query params (`App.tsx:475-476`,
  `buildParams`), mais la signature de `GetReglements` dans `ReglementController.cs:27-58` **ne les
  déclare pas du tout** — ASP.NET Core les ignore silencieusement. Le tri par colonne que
  l'utilisateur croit obtenir en cliquant sur un en-tête (`App.tsx:1310-1317`) ne peut donc reposer
  que sur l'ordre naturel non garanti de SQL Server, pas sur un vrai tri. C'est un bug fonctionnel
  préexistant, distinct de la lenteur, **mais toute correction qui pousse le tri/la pagination en
  SQL devra trancher explicitement** : soit câbler enfin `sortCol`/`sortDesc` jusqu'au SQL (gain
  fonctionnel réel), soit les laisser ignorés en le documentant clairement dans le VERIFY — ne pas
  laisser ce point de côté silencieusement une seconde fois.
- **Coût CPU additionnel, distinct du volume réseau** : `ReglementMapper.Map`
  (`ReglementService.cs:1496-1512`) mappe chaque `ReglementClient` vers `ReglementClientDto` par
  **réflexion non mise en cache** (`PropertyInfo.GetValue`/`SetValue` recalculés à chaque appel de
  `Map`, pour chaque propriété — la seule mise en cache faite est la liste des paires de propriétés
  au niveau statique, pas les accesseurs compilés). Sur un volume de plusieurs milliers de lignes,
  ce coût réflexif s'ajoute au temps DB et à la sérialisation JSON — à mesurer séparément à l'étape 2
  ci-dessous plutôt que de l'ignorer.
- **Le DTO exposé (`ReglementClientDto`, `ReglementService.cs:1380-1428`) fait ~35 propriétés
  raisonnables** (pas de champ verbeux type JSON imbriqué ou texte long) — la piste « trop de
  colonnes ramenées par ligne » est donc **peu probable** comme cause principale du poids ; ne pas y
  passer de temps disproportionné avant d'avoir mesuré le nombre de lignes réellement renvoyées.

**Non confirmé à ce stade** (à charge de Gemini avant de choisir une correction) :
- Le volume réel de lignes ramené par `repo.GetAll()` sur la fenêtre 30 jours du poste/société du PO
  au moment de la capture (nombre de caisses de l'utilisateur, ampleur du périmètre `caissesList`).
- La part respective, dans le temps de réponse total, du temps DB (`repo.GetAll`), du temps de
  mapping par réflexion (`ReglementMapper.Map`), du filtrage LINQ en mémoire, des requêtes
  complémentaires réservations/affectation (lignes 189-249), et de la sérialisation JSON finale.
- Si `pageSize` était à 50 ou à 10000 au moment de la capture du PO (à demander/reproduire).

## Problème constaté

Chargement de l'écran de liste des règlements perçu comme lent par l'utilisateur. Réponse HTTP de
`GET /api/reglements` mesurée à 7 119 kB pour un existant demandé sur 1 page.

## Objectif

Réduire drastiquement le poids et le temps de réponse de `GET /api/reglements` pour un usage
paginé normal (`pageSize` 10/25/50), sans changer le comportement fonctionnel des filtres actuels
(tous doivent continuer à produire le même résultat qu'aujourd'hui).

## Fichiers concernés

- `GRC.API/Controllers/ReglementController.cs` (`GetReglements`, lignes 26-79 — ne déclare pas
  `sortCol`/`sortDesc` malgré leur envoi par le front, cf. Contexte)
- `GRC.Infrastructure/Services/ReglementService.cs` (`GetReglements`, lignes 28-256 ; `ReglementMapper.Map`,
  lignes 1477-1513 — réflexion non compilée)
- `Tresorerie.Dapper.Repositories.ReglementClientRepository` (DLL externe, source de référence en
  lecture seule : `D:\_vibe\_reference\GRC\app-12.3.2\decompiled\Dapper\Tresorerie.Dapper.Repositories\ReglementClientRepository.cs`,
  méthode `GetAll(int, DateTime, DateTime, params int[])` lignes 231-247 — **aucun ORDER BY**, à
  connaître avant de décider d'un `OFFSET/FETCH`, ne pas modifier cette DLL directement)
- `gocom-web/src/App.tsx` (appel front, option `pageSize=10000`, params `sortCol`/`sortDesc` envoyés
  mais ignorés côté serveur)

## Étapes d'implémentation

1. Reproduire la lenteur (onglet réseau + mesure du temps de réponse serveur, pas seulement la
   taille) sur un poste avec un périmètre de caisses représentatif, `pageSize=50`, filtre date par
   défaut (30 jours).
2. Instrumenter/mesurer où va le temps, séparément : temps DB (`repo.GetAll`), temps de mapping par
   réflexion (`ReglementMapper.Map`), temps de filtrage LINQ en mémoire, requêtes complémentaires
   (réservations/affectation lignes 189-249), sérialisation JSON. Consigner le nombre de lignes
   réellement ramenées par `repo.GetAll()` avant tout filtre.
3. Documenter le diagnostic chiffré dans le VERIFY (nombre de lignes ramenées, taille moyenne par
   ligne, répartition du temps par étape) **avant** de choisir la correction — ne pas corriger à
   l'aveugle.
4. Corriger selon le diagnostic réel (pistes possibles, à valider par les mesures, pas à appliquer
   par défaut) :
   - pousser la pagination et les filtres compatibles au niveau SQL plutôt qu'en mémoire — **si
     cette piste est retenue, ajouter obligatoirement un `ORDER BY` déterministe** (ex. `MV_Id`) à la
     requête, faute de quoi la pagination SQL devient incorrecte (cf. Contexte) ;
   - si le tri est poussé en SQL, décider explicitement du sort de `sortCol`/`sortDesc` (les câbler
     enfin bout en bout, ou documenter pourquoi ils restent ignorés) plutôt que de laisser la
     confusion actuelle ;
   - remplacer la réflexion de `ReglementMapper.Map` par un mapping direct (propriété à propriété)
     ou des delegates compilés si le diagnostic montre que cette étape pèse significativement ;
   - plafonner ou avertir sur l'option `pageSize=10000` si elle s'avère être la cause dans le cas
     remonté par le PO.
5. Vérifier qu'aucun filtre actuel ne change de résultat après correction (tester au moins un
   filtre par type : liste, plage, date), et qu'une pagination sur plusieurs pages consécutives ne
   produit ni doublon ni ligne manquante (test spécifique si un `ORDER BY` est ajouté).

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
- [ ] Diagnostic chiffré du poids/temps AVANT correction documenté (méthode + date), avec
      répartition par étape (DB / mapping / filtrage / requêtes complémentaires / sérialisation)
- [ ] Poids de la réponse `GET /api/reglements` mesuré APRÈS correction sur le même scénario que la
      capture PO, avec comparaison chiffrée avant/après
- [ ] Si pagination poussée en SQL : `ORDER BY` déterministe ajouté et vérifié — deux appels
      consécutifs sur les pages 1 et 2 ne renvoient aucun règlement en double ni aucun règlement
      manquant
- [ ] Sort de `sortCol`/`sortDesc` explicitement tranché et documenté (câblé bout en bout, ou
      ignoré avec justification écrite — pas de silence sur ce point)
- [ ] Tous les filtres existants revérifiés (résultat identique avant/après, au moins un cas par
      type de filtre : liste, plage montant/solde, date, booléen)
- [ ] Aucune régression sur les autres écrans consommant `GET /api/reglements`
- [ ] Aucune dette technique silencieuse
- [ ] Cohérent avec l'architecture (pas de bypass DLL métier)
