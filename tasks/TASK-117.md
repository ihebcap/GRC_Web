# TASK-117 — Génération règlement espèce : abandonner le lot au premier échec de chargement des tiers ERP

- **Priorité** : 🟠 Majeur
- **Domaine** : Correction / Performance
- **Statut** : TODO
- **Dépend de** : TASK-115 (clôturée), TASK-116 (clôturée)

## Contexte
`GenererReglementsEspece` (`GRC.Infrastructure/Services/ReglementGenerationService.cs`) charge les tiers ERP une seule fois par lot via `tiersHelper.Get(code, reload: !clientsCharges)` (TASK-115). Le drapeau `clientsCharges` n'est posé qu'après un premier appel réussi. Constat de la review de TASK-115 et des rejeux de TASK-116 sur la base de test (2026-10-01) : le chargement des 24 236 tiers (`Sage.v9.Dapper.TiersErpRepository.GetAll()`) a atteint le timeout SQL de 30 s à chaque facture ; cause non établie (en prod la même requête était mesurée à ~430 ms).

## Problème constaté
Si le premier chargement échoue (timeout, erreur SQL, doublon de numéro de tiers), l'exception est capturée par facture (`try/catch` de la boucle), `clientsCharges` reste faux et **chaque facture suivante relance un chargement complet puis attend de nouveau le timeout** : sur un lot de 30 000 factures, blocage théorique de plusieurs centaines d'heures de la requête HTTP, sans abandon possible. Comportement identique à celui d'avant TASK-115 (qui rechargeait à chaque facture) : non aggravé, mais sans garde-fou.

## Objectif
Si le chargement des tiers échoue, **abandonner le lot immédiatement** : les factures restantes sont marquées en échec rapide avec le message « Chargement des tiers ERP impossible : <cause courte> », sans relancer le chargement, et ce message est distingué de « Client introuvable ». Aucun règlement n'est créé pour ces factures. Un code client absent du dictionnaire (cas normal) garde son comportement actuel.

## Fichiers concernés
- `GRC.Infrastructure/Services/ReglementGenerationService.cs` (méthode `GenererReglementsEspece` uniquement).

## Étapes d'implémentation
1. Distinguer l'échec du chargement des tiers (premier `Get(code, true)` qui lève, `clientsCharges` encore faux) des autres exceptions par facture.
2. Sur cet échec : consigner une erreur (`LogError`) avec la cause, passer un drapeau `chargementTiersEchoue = true`, puis pour la facture courante et toutes les suivantes produire un résultat d'échec « Chargement des tiers ERP impossible » sans appeler `tiersHelper` ni `ReglementCreate`.
3. Conserver le garde-fou `EC_Solde`, l'isolation par facture pour les autres erreurs, le résumé de fin de lot (ajouter le nombre d'échecs de chargement).
4. Facultatif si trivial : propager l'annulation de la requête HTTP (`CancellationToken` / `RequestAborted`) pour arrêter la boucle quand le client se déconnecte.

## Contraintes
- Ne jamais bypasser une règle de sécurité ou une DLL métier GRC ; ne pas modifier `ReglementCreate` (36 paramètres) ni la logique d'autorisation.
- Ne pas appeler `tiersHelper.GetAll(...)` avant le premier `Get` (NullReferenceException prouvée, voir TASK-115).
- Tests sur la base de test uniquement (DESKTOP-2VCUE93), jamais sur la prod (172.16.0.205) ; identifiants par variables d'environnement.

## Checklist VALIDATION (à remplir dans VERIFY/)
- [ ] Build OK
- [ ] Simulation d'un échec de chargement (par exemple timeout court sur la base de test) : lot de N factures → échec rapide pour toutes, durée totale ≈ un seul timeout, 0 règlement créé, message distinct de « Client introuvable » (preuve : log)
- [ ] Lot nominal inchangé (mêmes règlements qu'avant)
- [ ] Aucun credential/secret en dur introduit
- [ ] Aucune dette technique silencieuse
- [ ] Cohérent avec l'architecture
