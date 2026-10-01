# VERIFY — TASK-115 : tiers ERP chargés une seule fois par lot (génération règlement espèce)

- **Date** : 2026-10-01
- **Implémentation** : Claude, en worker de secours à la demande explicite du PO (« tu corriges directement »). **Point d'arrêt respecté** : aucun déplacement vers `DONE_DETAIL/`, aucune mise à jour de `DONE.md`/`CHANGELOG.md`, aucun commit. Clôture réservée à un reviewer qui n'a pas implémenté.
- **Fichier modifié** : `GRC.Infrastructure/Services/ReglementGenerationService.cs` (méthode `GenererReglementsEspece`, +35 lignes / −2). Aucun autre fichier de code.

## Cause racine (preuve)
| Élément | Preuve | Date / méthode |
|---|---|---|
| `Get(code, true)` relit tous les tiers à chaque appel | Décompilation `Tresorerie.UICommun.dll` (ilspycmd) : `Get(string, bool reload)` → `_erp.GetAllClients()` + reconstruction de `_clients` et `_dictionaryTierNumero` quand `reload = true` | 2026-10-01, agent d'analyse + relecture du synthétiseur |
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
