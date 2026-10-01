# TASK-115 — Génération règlement espèce : charger les tiers ERP une seule fois par lot (N+1 sur `TiersErpHelper.Get`)

- **Priorité** : 🟠 Majeur
- **Domaine** : Performance
- **Statut** : ✅ FAIT (approuvée sous réserve le 2026-10-02 sur décision du PO ; gain réel à mesurer au premier lot, voir tasks/DONE_DETAIL/TASK-115_verify.md)
- **Dépend de** : —

## Contexte
La génération de règlements espèce (`ReglementGenerationService.GenererReglementsEspece`, `GRC.Infrastructure/Services/ReglementGenerationService.cs`) traite ~0,45 s par facture. Un lot de 30 000 règlements représente ~4 h. Mesures du 2026-10-01 :
- log `grc-20261001.log` : 557 règlements, écart minimal entre deux règlements 305 ms ;
- prod 172.16.0.205, `sys.dm_exec_query_stats` : requête `SELECT [F_COMPTET].[cbMarq] AS [Id], [F_COMPTET].[CT_Num] AS [Numero], …` avec 3 paramètres `@Type_0..2` : **2 169 exécutions, 428 ms de moyenne, 24 344 lignes par exécution** (≈ les 24 499 clients du log « CACHE CLIENTS chargé ») ; 1 822 règlements générés en octobre, soit le même ordre de grandeur que le nombre d'exécutions.

## Problème constaté
Ligne ~229 : `tiersHelper.Get(echeance.ClientCode, true)` appelé **à chaque facture**. Décompilation (`Tresorerie.UICommun.dll`, `TiersErpHelper`) : `Get(string numero, bool reload)` avec `reload = true` relance `_erp.GetAllClients()` (tous les tiers Client + Autre + Salarié), reconstruit `_clients` et le dictionnaire `_dictionaryTierNumero`, puis cherche le code. Aucun cache : N factures = N relectures complètes de `F_COMPTET`. Avec `reload = false`, `Get` fait un lookup dans le dictionnaire déjà construit, puis un repli SQL unitaire (`GetClient(numero)`) si le code est absent, puis un `NullClient` (No = 0).

Second défaut, lié : le contrôle `if (client == null)` ne se déclenche jamais, `Get` ne renvoie pas `null` mais un `NullClient`. Un code client inconnu partait donc dans `ReglementCreate` avec `client.No = 0` et l'erreur remontait peu lisible.

## Objectif
- Charger les tiers ERP **une seule fois par lot** : passage de ~450 ms à ~20-100 ms par règlement attendu (hypothèse, non mesurée sans la base ; 10 000 règlements : ~1 h 15 → ~5-15 min).
- Résolution du client **strictement équivalente** à l'existant (mêmes tiers indexés, même casse, mêmes espaces, même repli).
- Message « Client introuvable (code) pour la facture X » effectif pour un code inconnu.
- Traces d'exploitation : durée du chargement des tiers et résumé de fin de lot (durée moyenne par règlement) pour mesurer le gain en prod.

## Fichiers concernés
- `GRC.Infrastructure/Services/ReglementGenerationService.cs` (méthode `GenererReglementsEspece` uniquement).

## Étapes d'implémentation
1. Avant le `foreach` des échéances : drapeau `clientsCharges = false`, compteur `clientsIntrouvables`, `Stopwatch` de lot.
2. Remplacer `tiersHelper.Get(echeance.ClientCode, true)` par `tiersHelper.Get(echeance.ClientCode, !clientsCharges)` ; poser `clientsCharges = true` après le premier appel réussi ; logger la durée de ce premier chargement. Le chargement est paresseux : il a lieu à la première facture qui passe le garde-fou `EC_Solde > 0`, donc un lot vide, refusé ou entièrement soldé ne le paie pas.
3. Remplacer le test `client == null` par `client == null || client.No <= 0` (NullClient) en conservant le message d'erreur existant.
4. En fin de lot, logger un résumé : demandées / succès / échecs / clients introuvables / durée totale / moyenne par règlement.
5. Ne **pas** toucher `GenererVersementDepuisReleveAsync` (un seul client par appel) ni `GetClientsFromCache`.

## Contraintes
- Ne jamais bypasser une règle de sécurité ou une DLL métier GRC : `ReglementCreate` (36 paramètres), contrôle d'autorisation, garde-fou `EC_Solde` et isolation par facture inchangés.
- **Ne jamais appeler `tiersHelper.GetAll(...)` avant le premier `Get` sur la même instance du helper** : le dictionnaire par Numero n'est construit que par `Get(…, true)`, un `Get(…, false)` sans lui lève une `NullReferenceException` (prouvé par décompilation).
- Pas de dictionnaire maison, pas de `FiltreTiers.Client`, pas de `Trim` ni de comparaison insensible à la casse : le helper indexe 3 types de tiers (Client, Autre, Salarié) avec une clé sensible à la casse ; toute « amélioration » élargirait la résolution par rapport à l'existant.
- Hors périmètre (TASK distincte après mesure) : agrégats `VerifySolde`, numérotation `MAX(MV_Numero)`, notifications `useNotification=true`, 2 `SqlConnection` par ligne (poolées). Pas de parallélisation : numérotation par `MAX` sans verrou et `SocieteManager` partagé.

## Risques et limites connus
- Snapshot figé pendant le lot : un client renommé en cours de lot garde l'ancien intitulé ; un client créé en cours de lot est retrouvé par le repli SQL unitaire.
- Si le chargement échoue (SQL, doublon de Numero), chaque facture échoue avec le message d'erreur correspondant (comportement identique à l'existant) : pas d'abandon du lot.
- Le lot de 30 000 reste une requête HTTP synchrone sans progression ni annulation : plusieurs dizaines de minutes même après correction (chantier distinct).
- Gain réel non mesuré sans lot réel (voir VERIFY).

## Checklist VALIDATION (à remplir dans VERIFY/)
- [ ] Build OK
- [ ] Comportement vérifié end-to-end (lot réel, avant/après)
- [ ] Aucun credential/secret en dur introduit
- [ ] Aucune dette technique silencieuse
- [ ] Cohérent avec l'architecture
