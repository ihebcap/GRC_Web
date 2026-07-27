# TASK-060 — Génération d'un règlement client "versement" depuis une ligne de relevé bancaire, mode fixé, rapproché via l'auto-rapprochement existant

- **Priorité** : 🟠 Nouveau fonctionnel (demande PO)
- **Domaine** : Backend (API + Infrastructure) + Front (`RapprochementBancaire.tsx` existant)
- **Dépend de** : **TASK-059** (mécanisme d'appel direct `ReglementCreate` partagé, mapping des 36
  paramètres). Aucune dépendance sur TASK-037 pour la génération elle-même (cf. découplage ci-dessous) —
  TASK-037 reste utilisé tel quel, sans modification, pour le rapprochement qui suit. Aucune dépendance
  de livraison sur **TASK-054** (retirée, remplacée par TASK-059/060) — son analyse DLL (pré-contrôle
  `HasEntityActionRestriction`) est réutilisée telle quelle, archivée dans `TASK-054.md`.

## Objectif

**Pas un nouvel écran** : bouton **« Générer règlement »** sur l'écran existant de rapprochement
bancaire (`RapprochementBancaire.tsx`), pour une ligne de relevé non rapprochée. L'utilisateur
**recherche le client** (non connu depuis la ligne) et **choisit uniquement la caisse** (restreinte à
celles affectées à son profil) ; il **saisit `MV_Reference`** (seul champ libre de ce flux). Tout le
reste est figé ou dérivé de la ligne de relevé :

| Champ | Valeur |
|---|---|
| Mode de règlement | **Constante `ModeNo = 12`** (Versement) — confirmé PO 2026-07-16 |
| Montant | Montant de la ligne de relevé — jamais ressaisi |
| Date | Date du relevé (`ligne.DateOperation`) |
| `MV_Reference` | **Saisie utilisateur** (seul champ libre du formulaire) |
| Affectation | **Aucune** — pas de facture liée (règlement "versement" pur) |

Le système génère un règlement "versement" **sans affectation sur facture**.

## ⚠️ Changement d'architecture (2026-07-16) — même bypass que TASK-059

### Pourquoi

Même constat IL que TASK-059 : `ReglementClientCoffreCreate` (appelé par `ImporterReglements`) hardcode
`String.Empty` sur `affaireNumero`/`ribClient`/`infoLibre1-4`. Ce flux ne requiert pas `MV_Info3`
(réservé à l'espèce), donc cette limite précise ne le bloquait pas en soi — **mais la simplification
actée avec le PO le 2026-07-16** (« on peut figer le mode aussi pour le versement », caisse seule
choisie, `MV_Reference` saisi manuellement) aligne ce flux sur le même mécanisme direct que TASK-059
par cohérence et parce que le pipeline fichier (`ReglementTiersImport`) n'apporte plus rien ici : aucun
fichier, aucune ligne à mapper, un seul règlement généré à la fois depuis un formulaire minimal.
**Décision** : `ReglementGenerationService` (partagé avec TASK-059) expose une seconde méthode qui
appelle **directement** `CaisseManager.ReglementCreate(...)`, avec les mêmes contrôles manuels
(client/caisse/mode/devise) que TASK-059 — cf. ce fichier pour le détail du mécanisme, non dupliqué ici.

### ✅ Mapping des 36 paramètres — partagé avec TASK-059, dump IL réalisé (2026-07-16)

Même dump IL exhaustif que TASK-059 (`ReglementClientCoffreCreate` → `ReglementCreate`, 36/36 paramètres
connus avec certitude). Différences avec le mapping espèce de TASK-059 :

| # | Paramètre | Valeur pour ce flux (versement) | Différence vs. TASK-059 |
|---|---|---|---|
| 7 | `modeNo` | **12** (Versement) | mode différent |
| 13 | `banqueNo` | `ligne.BanqueId` (transmis par le front) | espèce = `null` |
| 21 | `infoLibre3` | `String.Empty` (**hardcodé natif, inchangé**) | espèce = numéro de facture |
| 23 | `reference` | **saisie utilisateur** (`MV_Reference`) | espèce = numéro de facture |
| 9, 12 | `piece` / `echeance` | ⚠️ pas d'affectation → valeurs neutres probables `""`/`default(DateTime)` (à confirmer par un test réel, cf. Risques) | espèce = pièce/échéance de la facture |

Tous les autres paramètres (17-20, 22, 24-35 : `affaireNumero`, `ribClient`, `infoLibre1/2/4`,
`collaborateurNo=0`, `baseRetenue=0`, `tauxRetenue=0`, `reglementNature=0`, `soumisDroitTimbre=false`,
`montantDroitTimbre=0`, `isImporterFromErp=false`, `isImporterComptabiliser=false`,
`useNotification=true`, `coursDevise=1`) sont **identiques à TASK-059** — cf. ce fichier pour le détail,
non dupliqué ici. Même remarque sur `isComptabilise` : n'étant pas un paramètre de `ReglementCreate`
lui-même, ce règlement suit le flux normal de comptabilisation (pas de marquage automatique).

## Décision de simplification actée avec le PO (2026-07-16)

**Découplage génération / rapprochement.** Version précédente de cette tâche prévoyait un bouclage
automatique dans le même geste (générer le règlement **puis** appeler `ReserverLigneAsync`
immédiatement), ce qui exigeait de résoudre un point technique non trivial : retrouver le `MV_ID` du
règlement tout juste créé. **Ce point est retiré du périmètre** : le règlement est généré avec le
**même montant** que la ligne de relevé, et c'est **le moteur d'auto-rapprochement déjà en production**
(`AutoReconciliationEngine.CalculerPropositions`, match par montant, cf.
`ReleveBancaireController.GenererPropositions`) qui le proposera au rapprochement au prochain passage —
**aucun nouveau code de rapprochement à écrire**. L'utilisateur valide ensuite comme il le fait déjà
pour tout règlement existant (réservation/validation TASK-037, strictement inchangé).

Avec l'appel direct à `ReglementCreate`, ce découplage reste **valable et même simplifié** : l'appel
retourne (ou permet de retrouver) le règlement créé sans avoir besoin de relire `ImporterReglements`
(qui ne renvoyait qu'un compte) — mais on **choisit délibérément de ne pas exploiter ça** pour créer un
bouclage automatique : la décision PO du découplage tient indépendamment de cette possibilité technique
nouvelle, elle reste actée pour la simplicité d'usage (l'utilisateur valide un règlement comme un autre).

## Contexte — analyse DLL antérieure (conservée, toujours valide)

### Banque — aucun mapping à construire, confirmé par le code existant

[ReleveBancaireController.cs:127](../GRC.API/Controllers/ReleveBancaireController.cs#L127) compare déjà
`r.BanqueNo == request.BanqueId` — `RAPP_ReleveBancaire_Entete.BanqueId` **est** déjà le `BanqueNo`
Trésorerie, sans table de correspondance à créer. `BanqueNo` (paramètre de `ReglementCreate`) = ce
`BanqueId` de la ligne de relevé, transmis par le front.

### Client non connu depuis la ligne — recherche explicite obligatoire

Une ligne de relevé donne montant/date/libellé/banque, jamais de client GOCOM résolu. L'écran doit
exposer une recherche client explicite avant de pouvoir générer quoi que ce soit. Erreur de sélection =
erreur de saisie utilisateur, aucune garde technique possible au-delà de la validation d'existence du
code (`TiersErpHelper.Get`).

### Caisse — liste restreinte aux caisses affectées à l'utilisateur (JWT)

Identique à TASK-059 : le combo caisse ne propose que les caisses du profil de l'utilisateur connecté
(claim `Caisses` du JWT). Restriction d'UX, le pré-contrôle serveur reste la seule barrière réelle.

## ⚠️ Exigences complémentaires (PO, 2026-07-20) — avant dev

- **Numérotation de règlement** : utiliser le **compteur officiel de l'application**
  (`SocieteManager.GetNumeroPieceCourante(EntityNumerotation.ReglementClient, ...)`), **pas** un numéro
  maison — même correction que TASK-059 round 3, à appliquer nativement ici dès la 1ère version, pas
  après un REJECT. Le paramètre `numero` (#0 de `ReglementCreate`) doit être résolu via cet appel, comme
  pour le flux espèce.
- **Banque** : vigilance particulière sur `banqueNo` (paramètre #13) — déjà documenté ci-dessus
  (`ligne.BanqueId` = `BanqueNo` Trésorerie, aucun mapping supplémentaire), mais **à revérifier sur un
  cas réel** avant de considérer ce point acquis : confirmer que la banque enregistrée sur le règlement
  généré correspond exactement à la banque de la ligne de relevé source (pas de décalage/valeur par
  défaut silencieuse).
- **Rafraîchissement automatique de la liste des règlements** : le bloc « liste des règlements » en bas
  de l'écran `RapprochementBancaire.tsx` doit se **rafraîchir automatiquement** après une génération
  réussie, pour afficher immédiatement le nouveau règlement — sans que l'utilisateur ait à recharger la
  page ou relancer une action manuelle. Ajouter l'appel de rafraîchissement (même fonction que celle déjà
  utilisée pour charger la liste au montage/filtre) dans le callback de succès du bouton « Générer
  règlement ».
- **Expérience utilisateur** : feedback clair et immédiat à chaque étape (génération en cours, succès
  avec numéro de règlement affiché, erreur explicite si échec) — même standard que les autres écrans du
  projet (toasts, pas d'`alert()` bloquant). Le worker doit tester le parcours complet manuellement
  (recherche client → caisse → référence → génération → apparition dans la liste) avant de soumettre le
  VERIFY, pas uniquement valider l'appel API isolément.

## Fichiers concernés

- `GRC.Infrastructure/Services/ReglementGenerationService.cs` — méthode dédiée
  `GenererVersementDepuisReleve(...)` (partage le mécanisme d'appel direct `ReglementCreate` de
  TASK-059, pas de duplication de code si les deux tâches se chevauchent en dev). Aucun appel à
  `ReserverLigneAsync` ni lookup de `MV_ID`.
- `GRC.API/Controllers/ReleveBancaireController.cs` — nouvel endpoint `[HttpPost("generer-reglement")]` :
  reçoit `clientCode`, `caisseCode`, `mvReference` (saisie utilisateur), `montant`, `dateOperation`,
  `banqueId` (déduits de la ligne côté front) → crée le règlement → retourne le résultat. **Ne touche
  pas** `RAPP_ReleveBancaire_Ligne`.
- `gocom-web/src/RapprochementBancaire.tsx` — bouton **« Générer règlement »** sur les lignes non
  rapprochées : recherche client + caisse (JWT) + champ `MV_Reference` → génère → message de
  confirmation invitant à relancer l'auto-rapprochement (geste déjà existant sur cet écran).

## Étapes d'implémentation

1. **Pré-contrôle droits de caisse** — même mécanisme que TASK-054, avant tout appel DLL.
2. **Résolution client/caisse/devise** — mêmes helpers manuels que TASK-059 (`TiersErpHelper.Get`,
   `Societe.GetCaisse` + `HasModeReglement(12)`).
3. **Appel direct `ReglementCreate`** : valeurs de la table ci-dessus (`numero` généré, `date` =
   `ligne.DateOperation`, `montant` = montant de la ligne, `modeNo` = 12, `banqueNo` = `ligne.BanqueId`,
   `reference` = saisie utilisateur, `piece`/`echeance` = valeurs neutres — **à confirmer par un test
   réel** avant de figer le code, pas uniquement par supposition).
4. **Endpoint** : retourne `{ success, erreurs[] }`. Pas de lien avec la ligne de relevé au niveau base —
   le rapprochement se fait ensuite via le flux auto-rapprochement existant, inchangé.
5. **Front** : bouton → formulaire (client, caisse, `MV_Reference`) → génère → message invitant à
   relancer l'auto-rapprochement pour voir la proposition de rapprochement apparaître.

## Contraintes

- **Ne pas réécrire la logique de `ReglementCreate`** — appel direct, pas de réimplémentation.
- **Ne pas dévier du mapping des 36 paramètres** (cf. table ci-dessus et TASK-059) sans nouvelle
  vérification IL.
- **Ne pas contourner les autorisations** — pré-contrôle `HasEntityActionRestriction` obligatoire.
- **Ne pas modifier `ReserverLigneAsync`/`SauvegarderValidationAsync`/le verrou `sp_getapplock` de
  TASK-037** — cette tâche ne touche pas au rapprochement, seulement à la génération.
- Aucun `UPDATE` SQL brut sur les tables pilotées par la DLL. Respecter la Clean Architecture.

## Risques / dépendances

- **`piece`/`echeance` en l'absence d'affectation** : valeur neutre probable `""`/`default(DateTime)`
  (par analogie avec une ligne CSV TASK-054 sans pièce, jamais contrôlée par `Verify()`) — **non
  confirmée par un test réel**, à valider avant de considérer ce point clos.
- **Délai entre génération et rapprochement** : le règlement généré n'est **pas** automatiquement
  marqué rapproché — l'utilisateur doit relancer l'auto-rapprochement (geste déjà existant, pas
  nouveau). Si le PO attend un bouclage 100% immédiat en usage réel, ce choix de simplification devra
  être révisé.
- **Client mal sélectionné par l'utilisateur** : aucune garde technique possible au-delà de l'existence
  du code client — erreur de saisie, à documenter côté formation utilisateur.
- Dépendance dure à TASK-059 pour le mécanisme d'appel direct partagé — coordonner l'ordre de merge si
  développées en parallèle.

## Checklist VALIDATION (à remplir dans VERIFY/)

- [x] Dump IL exhaustif des 36 paramètres de `ReglementCreate` — partagé avec TASK-059, documenté (2026-07-16)
- [ ] Build back + front OK (0 erreur)
- [ ] Client existant + caisse autorisée + `MV_Reference` saisi → règlement créé (mode = 12, `MV_Date` =
      date du relevé, aucune affectation, aucune erreur)
- [ ] Valeurs neutres de `piece`/`echeance` confirmées sans effet de bord (pas d'affectation fantôme créée)
- [ ] Le règlement généré **apparaît ensuite dans les propositions d'auto-rapprochement**
      (`POST /auto-reconcile`) grâce au montant identique à la ligne source
- [ ] **Droits de caisse non autorisés → refus**, testé avec un utilisateur non-admin restreint, y
      compris si `Tresorerie:UserGR` est admin
- [ ] Combo caisse ne propose que les caisses du JWT de l'utilisateur connecté
- [ ] Aucune régression sur le rapprochement manuel existant (réservation/validation/libération,
      TASK-037) — cette tâche n'y touche pas
- [ ] Aucun chemin/secret en dur ; aucun SQL brut sur les tables pilotées par la DLL
- [ ] Numéro de règlement issu du compteur officiel (`GetNumeroPieceCourante`), prouvé en base
      (`MV_Numero` au format applicatif, pas un identifiant maison)
- [ ] Banque du règlement généré confirmée identique à la banque de la ligne de relevé source, testé sur
      un cas réel en base
- [ ] Liste des règlements en bas de `RapprochementBancaire.tsx` se rafraîchit automatiquement après
      génération réussie, sans action manuelle de l'utilisateur — testé visuellement
- [ ] Parcours complet testé manuellement de bout en bout (pas uniquement l'appel API isolé) : recherche
      client → caisse restreinte JWT → référence → génération → feedback succès/erreur → apparition dans
      la liste
