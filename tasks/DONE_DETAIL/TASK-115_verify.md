# VERIFY — TASK-115 : tiers ERP chargés une seule fois par lot (génération règlement espèce)

- **Date** : 2026-10-01
- **Implémentation** : Claude, en worker de secours à la demande explicite du PO (« tu corriges directement »). **Point d'arrêt respecté** : aucun déplacement vers `DONE_DETAIL/`, aucune mise à jour de `DONE.md`/`CHANGELOG.md`, Le code est commité localement (c9b392a, « en VERIFY », non poussé) ; ce n'est PAS une clôture. Clôture réservée à un reviewer qui n'a pas implémenté.
- **Fichier modifié** : `GRC.Infrastructure/Services/ReglementGenerationService.cs` (méthode `GenererReglementsEspece`, +35 lignes / −2). Aucun autre fichier de code.

## Cause racine (preuve)
| Élément | Preuve | Date / méthode |
|---|---|---|
| `Get(code, true)` relit tous les tiers à chaque appel | Décompilation `Tresorerie.UICommun.dll`, classe `Tresorerie.UICommun.Helper.TiersErpHelper` (et non l'homonyme `Tresorerie.UIConfiguration.Helper.TiersErpHelper`, dont `Get(string)` n'a pas de paramètre `reload`) (ilspycmd) : `Get(string, bool reload)` → `_erp.GetAllClients()` + reconstruction de `_clients` et `_dictionaryTierNumero` quand `reload = true` | 2026-10-01, agent d'analyse + relecture du synthétiseur |
| La requête observée en prod est bien celle-là | `sys.dm_exec_query_stats` prod : requête `F_COMPTET` `@Type_0..2`, 2 169 exécutions, 428 ms de moyenne, 24 344 lignes/exécution | 2026-10-01, résultat collé par le PO |
| Cohérence de volume | 24 499 clients dans le log « CACHE CLIENTS chargé » ; 1 822 règlements générés en octobre (`RC26100001` à `RC26101823`) | 2026-10-01, log + requête PO |
| Cadence observée | écart minimal 0,305 s entre deux règlements dans `grc-20261001.log` (557 règlements) | 2026-10-01, awk sur le log |

Le lien « 428 ms de requête ≈ 450 ms par règlement » reste une corroboration chiffrée, pas une mesure directe du temps par étape.

## Changement
1. `clientsCharges` / `clientsIntrouvables` / `Stopwatch` de lot déclarés avant le `foreach`.
2. `tiersHelper.Get(echeance.ClientCode, true)` → `Get(echeance.ClientCode, !clientsCharges)` ; drapeau posé après le premier appel réussi ; chargement paresseux (après le garde-fou `EC_Solde`).
3. `client == null` → `client == null || client.No <= 0` (le helper renvoie un `NullClient`, jamais `null`).
4. Logs : durée du chargement unique des tiers + résumé de fin de lot.

Non modifiés : `ReglementCreate` (36 paramètres), contrôle d'autorisation, garde-fou `EC_Solde`, isolation par facture, `GenererVersementDepuisReleveAsync`, `GetClientsFromCache`.

## Checklist VALIDATION (preuve par critère)
- [x] **Build OK** — `dotnet build GRC.Infrastructure/GRC.Infrastructure.csproj` le 2026-10-01 : 0 erreur, 0 avertissement.
- [ ] **Comportement vérifié end-to-end** — NON coché : pas d'accès à la base de test depuis cette session (accès SQL direct refusé par les permissions) et pas de lot réel exécuté. Protocole à exécuter par le reviewer/PO : lancer un lot de 100+ factures sur la base de test et comparer (a) l'intervalle entre deux lignes « GÉNÉRATION RÈGLEMENT ESPÈCE OK » avant/après (attendu ≤ 100 ms contre ~450 ms) ; (b) la ligne « FIN DE LOT » (moyenne ms/règlement) ; (c) que les clients et montants des règlements créés sont identiques à ceux d'un lot de référence généré avant correctif. Banc existant utilisable : `harness_task107` / `run_test114_via_api.ps1` (base de test uniquement, jamais en prod).
- [ ] **Gain réel chiffré** — NON coché : l'estimation (~450 → ~20-100 ms par règlement) est une hypothèse issue de l'analyse ; à confirmer par (a) ci-dessus.
- [x] **Équivalence de résolution du client** — le correctif utilise le cache natif du helper (mêmes 3 types Client/Autre/Salarié, même clé Numero sensible à la casse, même repli SQL unitaire) ; aucun dictionnaire maison, aucun `Trim`/`OrdinalIgnoreCase` ajouté. Preuve : lecture du code décompilé du helper, 2026-10-01. **Non testé par exécution** (cf. ci-dessus).
- [x] **Aucun credential/secret en dur introduit** — relecture du diff le 2026-10-01 : aucune chaîne de connexion ni secret ajouté.
- [x] **Aucune dette technique silencieuse** — limites consignées dans la TASK-115 (snapshot figé pendant le lot, pas d'abandon du lot si le chargement échoue, lot HTTP synchrone) ; suites explicitement hors périmètre (TASK-116 éventuelle après mesure).
- [x] **Cohérent avec l'architecture** — modification limitée à la couche Infrastructure, API publique et DTO inchangés.

## Écarts par rapport au workflow normal
- Une analyse en profondeur par 4 agents indépendants (décompilation DLL, coûts résiduels de la boucle, périmètre repo, équivalence) a précédé le correctif ; la revue adversariale à 3 lentilles prévue **n'a pas été exécutée** (relancement du workflow refusé par les permissions de la session). Le reviewer tiers est donc invité à contrôler en priorité : (1) équivalence de la résolution client (casse, espaces, sommeil, doublons de Numero) ; (2) le piège `GetAll` avant `Get` (commentaire dans le code) ; (3) le comportement quand le premier `Get(…, true)` lève une exception (le drapeau reste faux, chaque facture retente le rechargement, identique à l'existant).

## Risques résiduels
- Gain non mesuré (cf. ci-dessus).
- Un client renommé en cours de lot garde l'ancien intitulé dans ce lot ; un client créé en cours de lot est retrouvé par le repli SQL unitaire.
- Reste lent après correctif (hypothèse) : agrégats `VerifySolde`, numérotation `MAX(MV_Numero)`, notifications ; à mesurer sur les logs de fin de lot avant toute TASK-116.
- Deux générations HTTP simultanées restent à éviter (numérotation par `MAX` sans verrou), hors périmètre.


---

## Notes du reviewer de clôture (2026-10-02) — APPROVE SOUS RÉSERVE, décision du PO

Review indépendante en 3 lentilles (équivalence de résolution des clients, périmètre/build, honnêteté des preuves) : 3 × APPROVE, aucun bloquant. Clôture prononcée sur décision explicite du PO (« on clôture tout »).

### Rectificatifs
1. **Commit `c9b392a`** : il contient, en plus du correctif, la suppression de 6 fichiers sans rapport déjà préparée par le PO dans l'index (`tasks/TASK-099, 100, 101, 102, 105, 106`) ; ce sont des doublons périmés présents dans `tasks/DONE_DETAIL/`, aucune information n'est perdue. Le message du commit ne les mentionne pas.
2. **Cohérence de volume** : 24 344 lignes par exécution (stats SQL de prod) contre 24 499 clients dans le log (écart de 155 lignes, filtre ou périmètre différent) ; 2 169 exécutions contre 1 822 règlements (347 exécutions de plus, probablement d'autres appelants de `Get(code, true)` comme la génération de versement). Les chiffres des stats SQL de prod proviennent de relevés du PO, non rejouables hors base.
3. **Gain réel non mesuré** : aucune ligne « tiers ERP chargés » ni « FIN DE LOT » n'existe dans le log fourni ; le gain annoncé (~450 ms → ~20-100 ms par règlement) reste une hypothèse. Mesure à faire au premier lot réel : l'écart médian entre deux lignes « GÉNÉRATION RÈGLEMENT ESPÈCE OK » doit passer de ~0,46 s à moins de 0,1 s, avec la ligne « FIN DE LOT » présente.
4. **Comportement en cas d'échec du chargement des tiers** : si le premier `Get(code, true)` échoue (timeout, SQL), `clientsCharges` reste faux et chaque facture suivante relance un chargement complet. Identique à l'existant avant TASK-115, mais sans garde-fou. Sur la base de test, ce chargement a atteint le timeout SQL de 30 s à chaque facture lors des rejeux de TASK-116 (cause non établie ; en prod la même requête était mesurée à ~430 ms). **TASK-117** ouverte pour abandonner le lot au premier échec de chargement.
5. **Namespace** : la classe décompilée est `Tresorerie.UICommun.Helper.TiersErpHelper` (et non l'homonyme `Tresorerie.UIConfiguration.Helper.TiersErpHelper`, dont `Get(string)` n'a pas de paramètre `reload`).
6. **Snapshot figé** : pendant un lot, un client renommé garde l'ancien intitulé ; un client créé est retrouvé par le repli SQL unitaire.

---

## Mesure en production (2026-10-02) — réserve « gain non mesuré » LEVÉE

Log de production du 2026-10-02 après déploiement (API redémarrée à 01:19:31) :
- Lot de 1 règlement (XDR2, 01:20:50) : tiers ERP chargés une seule fois en **946 ms**, ligne « FIN DE LOT » présente (durée 1 494 ms au total).
- Lot de XDR3 (01:21:36) : tiers ERP chargés une seule fois en **424 ms**, puis règlements 76268 à 76404 (**136 règlements en 8,0 s, soit ~59 ms par règlement**), numéros `RC26102980` à `RC26103115` sans trou, aucune erreur dans l'extrait.
- Référence avant correctif (log du 2026-10-01) : ~460 ms par règlement (médiane), écart minimal 305 ms.
- **Gain mesuré : ~8×** (460 ms → ~59 ms par règlement) ; projection pour 30 000 règlements : ~3 h 50 → ~30 min. Limite : extrait de log partiel (la ligne « FIN DE LOT » du lot XDR3 n'était pas encore émise au moment de la capture). Le comportement en cas d'échec du chargement des tiers reste à durcir (TASK-117).
- Note de log : la ligne « entrée » du contrôleur écrit encore la liste complète des identifiants d'échéances (plusieurs milliers de numéros par ligne) ; à raccourcir (nombre seulement) dans une TASK de suivi.
