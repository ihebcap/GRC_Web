# TASK-103 — Comptabilisation : les règlements annulés ne sont jamais proposés (écran Comptabilisation)

- **Priorité** : 🟠 Majeur
- **Domaine** : Correction front (1 ligne) + vérification backend **sans code**
- **Statut** : TODO
- **Dépend de** : —
- **Lot « règlements annulés »** : TASK-098 (rapprochement) · TASK-103 (comptabilisation) · TASK-104 (liste) · TASK-105 (annulation interdite si réservé/pointé)
- **Mise en prod** : front seul, aucun script SQL, aucune config. Retour arrière = redéployer le front précédent.
- **Références de ligne** : état du dépôt au commit `12f2dc0` (2026-09-30). Si un fichier a bougé (autre TASK fusionnée avant), se repérer par le **nom de la fonction**, pas par le numéro.

## Contexte
Règle PO (2026-09-30) : **l'annulation d'un règlement vaut suppression.** Un règlement annulé n'est
visible que dans la liste des règlements (avec un flag, TASK-104). Il n'est **jamais proposé** pour la
comptabilisation, ni pour le rapprochement (TASK-098). Le PO **ne teste pas avant la mise en production** :
les preuves sont produites par le worker sur la base de **test** et figurent dans le VERIFY.

## Problème constaté (références vérifiées le 2026-09-30)
L'écran Comptabilisation **propose aujourd'hui des règlements annulés** :
1. `handleSimuler` (`ApercuComptabilisation.tsx:199-253`) appelle `GET /reglements` (`:205-217`) sans `annule`.
   Le filtre `isComptabilise === 0` (`:219`) ne les écarte pas (un annulé n'est pas comptabilisé).
2. Avec `includeEspeceEtAutreSiPointeFiltre: true` (`:211`), les règlements de type 0 (Espèce) et 4 (Autre) sont
   **toujours inclus, pointés ou non** (`ReglementService.cs:106-115`) : tout annulé Espèce/Autre de la période
   est donc proposé. (Un annulé de type Virement/Chèque n'y figure que s'il est pointé.)
3. Ils sont envoyés à l'aperçu (`:228`), qui les affiche « Non comptabilisable » : c'est la garde TASK-088
   (`ReglementService.cs:721-725`, appelée en `:1391` pour l'aperçu et `:503` pour la compta réelle) qui les arrête
   **après coup**. Elle reste un filet de sécurité (rien de faux n'est écrit), mais un annulé n'a pas à être proposé.
   *Symptôme secondaire, pas la raison d'être de la TASK* : leur présence désactive « Comptabiliser » pour tout le
   lot (`ApercuComptabilisation.tsx:302-305` et `:616`).

La sélection venue de la liste (`handleSimulerPreselection`, `:257`) est couverte par TASK-104 (les annulés y sont
masqués en mode Comptabiliser) : `PreselectionItem` ne porte pas `isAnnule`, le filtre n'a pas sa place ici.

## Comportements attendus (contrat)
| Situation | Résultat attendu |
|---|---|
| Écran Comptabilisation, période contenant un annulé (Espèce ou Autre) | l'annulé **n'apparaît pas** dans l'aperçu (ni en « Non comptabilisable ») |
| Même période, autres règlements comptabilisables | aperçu inchangé pour eux ; bouton « Comptabiliser » **actif** |
| Période ne contenant que des annulés | toast « Aucun règlement à comptabiliser pour ces critères. » (`:222`), aucun appel à l'aperçu |
| `POST /reglements/apercu-comptabilisation` avec l'id d'un annulé (appel direct) | élément renvoyé avec `hasError = true`, `erreur` = « Règlement non comptabilisable : le règlement n°… est annulé. » (**inchangé**, TASK-088) |
| `POST /reglements/comptabiliser` avec l'id d'un annulé (appel direct) | `successCount = 0`, `errorCount = 1`, `errors[0]` = « Erreur sur le règlement <id>: Règlement non comptabilisable : le règlement n°… est annulé. » ; le règlement reste `isComptabilise = 0` (**inchangé**). Attention : `success` vaut `true` même avec des erreurs (`ReglementService.cs:589`) — ne pas s'y fier, lire `successCount`/`errorCount` |

## Étapes d'implémentation
1. `handleSimuler` : ajouter `annule: false` aux `params` du `GET /reglements` (`:206-216`). Paramètre déjà supporté
   (`ReglementController.cs:45`, converti en booléen `ReglementService.cs:132-135`) ; même mécanique que
   `App.tsx:557`. Ne rien changer d'autre dans cette fonction.
   *Choix assumé* : paramètre explicite plutôt que règle serveur, car cet écran n'a pas de drapeau d'éligibilité
   dédié (le coupler à `includeEspeceEtAutreSiPointeFiltre` serait implicite) et l'opposabilité est déjà assurée côté
   serveur par TASK-088.
2. **Vérification sans code** des deux dernières lignes du tableau (appels API directs). Si le comportement diffère,
   **le signaler** dans le VERIFY et ne pas corriger sans accord.

## Jeu d'essai (base de TEST uniquement)
Créer les annulés **via l'application** (bouton « Annuler ») — jamais par UPDATE SQL. Sur une période P (caisses de
l'utilisateur de test) :
- **A1** : règlement **Espèce annulé** ; **A2** : règlement **Autre annulé** (si un mode de type 4 existe, sinon A1 seul) ;
- **N1** : règlement Espèce non annulé, non comptabilisé ; **N2** : virement pointé, non annulé, non comptabilisé.

## Scénarios de test (à rejouer par le worker)
- **S1 Avant correctif** : aperçu de P → A1 (et A2) en « Non comptabilisable », bouton « Comptabiliser » grisé
  (à consigner : c'est la preuve du défaut).
- **S2 Après correctif** : aperçu de P → seuls N1 et N2 ; A1/A2 absents ; bouton actif ; compteur de simulation =
  nombre de règlements non annulés.
- **S3 Compta réelle non-régression** : comptabiliser N1 et N2 depuis cet aperçu → succès (`successCount = 2`), écritures
  générées comme avant (aucun changement de comportement pour les règlements normaux). Choisir des règlements dont l'aperçu
  est **sans erreur** avant le correctif. **Test irréversible** (pas de décomptabilisation) : n'utiliser que des règlements de
  test dédiés, sur la base de TEST.
- **S4 Période uniquement annulés** : restreindre les dates/caisses pour ne garder que A1 → toast « Aucun règlement à
  comptabiliser… ».
- **S5 API directe** (token de test) : aperçu puis comptabilisation avec `[A1]` → réponses du tableau ci-dessus ;
  `GET /reglements` montre A1 toujours `isComptabilise = 0`.

## Risques et points d'attention
- Aucun changement backend : le risque se limite à l'écran. Vérifier que le filtre « Rapproché = Oui » (TASK-087) et
  le filtre de dates (TASK-080) fonctionnent comme avant (S3).
- Ne pas modifier le contrat `HasError` / blocage global (TASK-073) : si une erreur **légitime** survient (mode non
  paramétré), le blocage du lot reste voulu.

## Contraintes
- Ne pas retirer ni modifier la garde TASK-088 (`VerifierComptabilisable`).
- Ne jamais bypasser une règle de sécurité ou une DLL métier GRC.
- Ne pas modifier le backend (aucun code attendu dans cette TASK).

## Fichiers concernés
- `gocom-web/src/ApercuComptabilisation.tsx` (`handleSimuler`)
- `GRC.Infrastructure/Services/ReglementService.cs` (**lecture seule** : `:721`, `:503`, `:1391`)

## Checklist VALIDATION (VERIFY : preuve datée par critère — capture, réponse API ou extrait de log)
- [ ] Build front OK, 0 erreur (preuve : sortie du build)
- [ ] S1 défaut reproduit avant correctif (preuve : capture de l'aperçu avec A1 « Non comptabilisable » et bouton grisé)
- [ ] S2 après correctif : A1/A2 absents, bouton actif (preuve : capture)
- [ ] S3 comptabilisation de N1/N2 inchangée (preuve : réponse `comptabiliser`)
- [ ] S4 toast « Aucun règlement à comptabiliser… » (preuve : capture)
- [ ] S5 API directe : refus « annulé », `isComptabilise` toujours 0 (preuve : 2 réponses + `GET /reglements`)
- [ ] Le diff ne contient **que** l'ajout de `annule: false` (preuve : `git diff`)
- [ ] Aucun credential/secret en dur introduit
- [ ] Aucune dette technique silencieuse
- [ ] Cohérent avec l'architecture

## Go / No-Go
**No-Go si** S3 ou S5 ne sont pas prouvés : ils garantissent que la comptabilisation normale n'est pas affectée.
