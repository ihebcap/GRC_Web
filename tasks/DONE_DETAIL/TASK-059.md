# TASK-059 — Génération interactive d'un règlement client espèce, avec affectation intégrale sur factures déjà dans l'échéancier

- **Priorité** : 🟠 Nouveau fonctionnel (demande PO)
- **Domaine** : Backend (API + Infrastructure) + Front (nouvel écran, simplifié)
- **Dépend de** : **TASK-050** (lettrage auto à la comptabilisation — dimensionne la règle de cardinalité ci-dessous). Aucune dépendance de livraison sur **TASK-054** (retirée, remplacée par TASK-059/060) — son analyse DLL (pré-contrôle `HasEntityActionRestriction`, mapping des 36 paramètres `ReglementCreate`) est réutilisée telle quelle, archivée dans `TASK-054.md`.

## Objectif

Écran GRC_WEB où l'utilisateur **recherche un client**, **coche les factures à régler en totalité** parmi celles déjà connues de l'échéancier trésorerie (pas de saisie de montant — solde intégral), et **choisit uniquement la caisse** (restreinte à celles affectées à son profil). Tout le reste est figé ou dérivé automatiquement :

| Champ | Valeur |
|---|---|
| Mode de règlement | **Constante `ModeNo = 1`** (Espèce) — confirmé PO 2026-07-16, plus un point ouvert |
| Montant | Solde intégral de la facture cochée — jamais saisi |
| Date | Date de la facture — `Echeance.DocumentDate` (confirmé structurellement en IL, cf. Risques : les deux champs `Date`/`DocumentDate` existent bien et sont distincts sur le modèle, `DocumentDate` est le candidat cohérent avec « date facture », `Date` étant plus probablement la date d'échéance ; confirmation sémantique sur un enregistrement réel encore recommandée avant dev) |
| `MV_Info3` | Numéro de facture (`EC_Info3` avec repli `DO_Numero`) |
| `MV_Reference` | **Modifié par TASK-062** : `string.Empty` (reste vide, annule le mapping TASK-059) |
| Cardinalité | 1 règlement **par facture cochée** — jamais de split (cf. TASK-050) |

Le système génère ces règlements en réutilisant le moteur natif de la DLL — **zéro règle métier réécrite**, mais un point d'entrée différent de TASK-054 (voir ci-dessous).

## ⚠️ Changement d'architecture (2026-07-16) — bypass du pipeline `ImporterReglements`

### Pourquoi : `MV_Info3` est structurellement inatteignable via le pipeline de TASK-054

Décompilation IL de `SocieteManager.ReglementClientCoffreCreate` (méthode que `ImporterReglements` appelle
pour chaque `ReglementTiersImport`) : son corps **hardcode 6 arguments `String.Empty` consécutifs**
lors de l'appel à `CaisseManager.ReglementCreate`, correspondant exactement aux paramètres
`affaireNumero`, `ribClient`, `infoLibre1`, `infoLibre2`, `infoLibre3` (= `Info3`), `infoLibre4`.
**Ces 4 champs `InfoLibreX` ne peuvent jamais être renseignés en passant par `ImporterReglements`**,
quel que soit le contenu du `ReglementTiersImport` fourni — confirmé par lecture complète de l'IL, pas
une supposition. `reference` (→ `MV_Reference`), en revanche, **est** transmis correctement (non
hardcodé) : `MV_Reference` reste atteignable par le pipeline TASK-054, seul `MV_Info3` ne l'est pas.

Ce flux exige `MV_Info3` = numéro de facture → **le pipeline `ReglementTiersImport`/`Verify`/
`ImporterReglements` de TASK-054 est structurellement impropre pour ce flux**, indépendamment de tout
autre choix de conception.

### Nouveau mécanisme : appel direct à `CaisseManager.ReglementCreate`

`ReglementGenerationService` (nouveau) appelle **directement** `CaisseManager.ReglementCreate(...)`
(signature à 36 paramètres, dumpée en IL — `Tresorerie.Core.dll`), en **contournant**
`ReglementClientCoffreCreate`/`ImporterReglements`/`ReglementTiersImport`/`Verify()` entièrement.
Toujours **zéro logique métier réécrite** (on appelle le même moteur natif, un niveau plus bas), mais
notre service devient responsable de reproduire lui-même les résolutions/contrôles que `Verify()`
assurait gratuitement :

1. **Client** : `TiersErpHelper.Get(clientCode)` (ou `.GetTiers`) — lève si introuvable, fournit aussi
   `CollaborateurNo` (paramètre `collaborateurNo` de `ReglementCreate`) sans résolution séparée.
2. **Caisse** : `Societe.GetCaisse(caisseCode)` — lève si introuvable.
3. **Compatibilité caisse/mode** : `Caisse.HasModeReglement(1)` — reproduit le contrôle que `Verify()`
   faisait (`CaisseCode` + `Caisse.HasModeReglement(modeNo)`).
4. **Devise société** : résolue une fois, comme le fait `Verify()` pour `DeviseCode`/cours.
5. **Montant** : solde de l'échéance cochée (`> 0` par construction — une échéance à solde nul
   n'apparaît pas dans la liste des factures ouvertes).

### ✅ Mapping complet des 36 paramètres — dump IL exhaustif réalisé (2026-07-16)

Dump IL intégral et croisé de `ReglementClientCoffreCreate` (25 paramètres → 36 arguments de
`ReglementCreate`) **et** de son appelant `ImporterReglements` (pour connaître l'origine de chacun des
25 paramètres de `ReglementClientCoffreCreate`). Les 36 valeurs sont désormais **toutes** connues avec
certitude — plus aucune supposition :

| # | Paramètre `ReglementCreate` | Valeur pour ce flux (espèce) | Origine |
|---|---|---|---|
| 0 | `numero` | généré (même stratégie que l'existant) | — |
| 1 | `date` | `Echeance.DocumentDate` (cf. Risques — champs `Date`/`DocumentDate` confirmés distincts en IL, confirmation sémantique finale recommandée) | — |
| 2 | `montant` | solde intégral de l'échéance cochée | — |
| 3 | `deviseNo` | devise société (résolue une fois) | `DeviseViewHelper.GetSocieteDevise` |
| 4 | `clientNo` | `resolvedClient.No` | `TiersErpHelper.Get(clientCode)` |
| 5 | `clientCode` | `resolvedClient.Numero` (code canonique, pas la saisie brute) | idem |
| 6 | `clientIntitule` | `resolvedClient.Intitule` | idem |
| 7 | `modeNo` | **1** (constante Espèce) | confirmé PO |
| 8 | `caisseNo` | résolu depuis la caisse choisie | `Societe.GetCaisse(caisseCode)` |
| 9 | `piece` | **`String.Empty`** — tranché PO 2026-07-16 | — |
| 10 | `libelle` | **Numéro de facture** (même valeur que `infoLibre3`/`reference`) — tranché PO 2026-07-16 | — |
| 11 | `tire` | `""` (aucun usage identifié pour ce flux) | — |
| 12 | `echeance` | date d'échéance de la facture (`Echeance.Date`, distincte de `date`) | — |
| 13 | `banqueNo` | `null` (espèce, pas de banque) | — |
| 14 | `banqueClient` | `""` | — |
| 15 | `coursDevise` | **1** (règle native confirmée : `cours==0 → 1`, sinon `cours`) | IL `ReglementClientCoffreCreate` |
| 16 | `deviseSocieteNo` | devise société (résolue une fois, même valeur que `deviseNo` ici) | idem #3 |
| 17 | `affaireNumero` | `String.Empty` | **hardcodé natif** (confirmé IL) |
| 18 | `ribClient` | `String.Empty` | **hardcodé natif** |
| 19 | `infoLibre1` | `String.Empty` | **hardcodé natif** |
| 20 | `infoLibre2` | `String.Empty` | **hardcodé natif** |
| 21 | `infoLibre3` (= `MV_Info3`) | **numéro de facture** — seule valeur volontairement différente du natif | spec PO |
| 22 | `infoLibre4` | `String.Empty` | **hardcodé natif** |
| 23 | `reference` (= `MV_Reference`) | **numéro de facture** (même valeur que `infoLibre3`) | spec PO |
| 24 | `collaborateurNo` | **0** (hardcodé natif — **pas besoin de résoudre `TiersErpHelper.CollaborateurNo`**) | IL `ReglementClientCoffreCreate` |
| 25 | `isCertifier` (⚠️ nom réel confirmé par réflexion sur `Tresorerie.Core.dll` le 2026-07-16 — TASK-059 nommait `isCertifie` par erreur de frappe IL, corrigé ici) | `false` (aucune certification demandée pour ce flux) | — |
| 26 | `dateValidite` | `null` | — |
| 27 | `montantPlafond` | `null` | — |
| 28 | `baseRetenue` | **0** (hardcodé natif) | IL `ReglementClientCoffreCreate` |
| 29 | `tauxRetenue` | **0** (hardcodé natif) | IL `ReglementClientCoffreCreate` |
| 30 | `reglementNature` | **0** (valeur par défaut de l'enum `ReglementNature`, hardcodée native) | IL `ReglementClientCoffreCreate` |
| 31 | `soumisDroitTimbre` | **false** (hardcodé natif) | IL `ReglementClientCoffreCreate` |
| 32 | `montantDroitTimbre` | **0** (hardcodé natif) | IL `ReglementClientCoffreCreate` |
| 33 | `isImporterFromErp` | **false** (hardcodé natif) | IL `ImporterReglements` |
| 34 | `isImporterComptabiliser` | **false** (hardcodé natif) | IL `ImporterReglements` |
| 35 | `useNotification` | **true** (hardcodé natif) | IL `ImporterReglements` |

**Différence volontaire et unique avec le comportement natif** : `isComptabilise` n'est **pas** un
paramètre de `ReglementCreate` lui-même (il est consommé par `ReglementClientCoffreCreate` en aval de
l'appel, via `ChangeEtatComptabilise`) — puisqu'on bypasse `ReglementClientCoffreCreate` entièrement, ce
règlement **ne sera jamais marqué comptabilisé automatiquement** : il suit le flux normal
(`ApercuComptabilisation` → `Comptabiliser`), ce qui est le comportement voulu. Voir aussi le finding
correspondant sur TASK-054 (`ImporterReglements` force `isComptabilise=true`, ce que ce flux évite
justement en bypassant ce mécanisme).

### ❌ INVALIDÉ (2026-07-20) — contrôle plafond/certification Maroc : APPLICABLE, doit être répliqué

~~`PO confirme 2026-07-16 : la société exploitée est tunisienne, pas marocaine`~~ — **décision annulée,
fondée sur une information erronée**. **PO confirme le 2026-07-20 : « Maroc confirmé »** — contradiction
levée dans le sens Maroc.

`Verify()` porte un bloc spécifique **Maroc** (`ModeReglement.Type==1 && Societe.LegislationType==0`)
de plafond/certification — reconfirmé en IL le 2026-07-16 (comparaison `ModeReglement::get_Type()` /
`Societe::get_LegislationType()` bien présente dans `Verify()`, juste avant les accès
`MontantPlafond`/`IsCertifier`). La société étant marocaine (`LegislationType==0`), **ce bloc s'applique
potentiellement** — reste à trancher uniquement sur `ModeReglement.Type` du mode Espèce (`No=1`) :

- Si `ModeReglement.Type==1` pour le mode Espèce : **le contrôle doit être répliqué** dans
  `ReglementGenerationService` avant tout nouveau test réel — bypass actuel de `Verify()` = perte
  silencieuse d'un contrôle métier natif applicable.
- Si `ModeReglement.Type!=1` pour le mode Espèce (probable — `Type==1` sur ce bloc de `Verify()`
  correspond vraisemblablement à `Cheque`, pas à `Espèce`, par analogie avec le bloc distinct trouvé
  dans `ReglementCreateInterne`/`VerifierReglement` — rapport source 2026-07-20 §6 — qui, lui, est
  conditionné à `mode.Type==Cheque`, pas Espèce) : le bloc ne se déclenche jamais pour ce flux,
  indépendamment de la législation, et **aucune réplication n'est nécessaire**.

**✅ Tranché — PO confirme (2026-07-20) : `Type` Espèce = `0`, `Type` Cheque = `1`.** Le bloc
`ModeReglement.Type==1 && LegislationType==0` de `Verify()` correspond donc bien à **Cheque**, pas à
Espèce — hypothèse de l'analogie ci-dessus confirmée. Pour ce flux (mode Espèce, `Type==0`), **le bloc
ne se déclenche jamais**, indépendamment de la législation (Maroc confirmé par ailleurs, mais devenu
sans incidence sur ce point précis). **Conclusion finale : le contrôle plafond/certification n'a pas
besoin d'être répliqué dans `ReglementGenerationService` — non-applicable, mais pour la bonne raison
(mode Espèce ≠ Cheque), pas pour la raison initialement invoquée le 16/07 (législation, qui s'est
avérée fausse).**

### Garde native désormais directement exposée : délai de paiement client

`ReglementCreate` contient (confirmé IL) un contrôle qui **lève une `ApplicationException`** si
`échéance - date` dépasse `Tiers.DelaiReg` et que `Societe.DelaiPaiementClient` est actif. Ce contrôle
était invisible via `ImporterReglements` (jamais atteint dans les flux testés jusqu'ici) ; en appelant
`ReglementCreate` directement, il devient un cas d'erreur réel et attendu à gérer **par facture** (une
facture en délai dépassé ne doit pas interrompre le traitement des autres factures cochées).

## Contexte — analyse DLL antérieure (conservée, toujours valide)

### `Verify()` ne contrôle jamais `PieceNumero`/`EcheancePiece`

Rappel de l'analyse initiale (désormais non directement applicable puisque `Verify()` est court-circuité,
mais utile pour calibrer nos contrôles manuels) : les seuls contrôles de `Verify()` étaient `Numero`,
`TiersCode`, `CaisseCode` (+ `HasModeReglement`), `ModeCode`, `DeviseCode`/cours, `Montant`.

### Lecture des factures payables — uniquement `RT_ECHEANCE`

`Tresorerie.Core.Interfaces.IEcheanceRepository.GetAllByTiers(domaine=Vente, societeNo, clientNo,
etat=non soldé)` pour lister les échéances ouvertes du client sélectionné.

### Périmètre v1 — décision actée avec le PO (2026-07-16), inchangée

**Retiré du périmètre** : factures GOCOM (`F_DOCENTETE`) absentes de `RT_ECHEANCE` et création
d'échéance à la volée (`SocieteManager.EcheanceCreate`). Chemin DLL jamais testé, le plus risqué et le
plus coûteux (mapping domaine/documentType/soucheNo/collaborateurNo, requête UNION anti-jointure
GOCOM). L'écran ne traite que les factures **déjà présentes dans `RT_ECHEANCE`** — limite réelle et
communicable. Rouvrable en tâche dédiée si constaté fréquent à l'usage.

### Caisse — liste restreinte aux caisses affectées à l'utilisateur (JWT)

Le combo caisse ne propose que les caisses déjà affectées au profil de l'utilisateur connecté — même
source que le claim `Caisses` du JWT déjà utilisé ailleurs (ex.
[ReleveBancaireController.cs:112](../GRC.API/Controllers/ReleveBancaireController.cs#L112)). Restriction
d'**UX** qui s'ajoute au pré-contrôle serveur `HasEntityActionRestriction` — celui-ci reste la seule
vraie barrière de sécurité.

### Cardinalité — 1 règlement = 1 facture, JAMAIS de split

Choix délibéré, aligné sur TASK-050 : le lettrage automatique à la comptabilisation ne se déclenche que
sur une **affectation intégrale sur une seule facture** ; un règlement splitté sur plusieurs factures
reste comptabilisé mais **non lettré**. Si l'utilisateur coche 3 factures : **3 règlements distincts**
sont générés (même client/caisse/mode/date), jamais un règlement unique réparti sur 3 pièces.

Conséquence de l'appel direct : chaque règlement nécessite **sa propre affectation** sur son échéance
(paramètre `piece`/`echeance` de `ReglementCreate`, ou appel d'affectation natif séparé si `ReglementCreate`
ne pose pas lui-même le lien — **point à vérifier lors du dump IL exhaustif ci-dessus**, `Verify()`
laissait cette question hors périmètre puisqu'elle ne contrôlait jamais `PieceNumero`/`EcheancePiece`).

## ⚠️ Amendement PO (2026-07-20) — changement de principe de l'écran : liste complète + filtre Excel, plus de recherche client préalable

Le PO tranche : l'écran ne doit **plus** démarrer par une recherche client. Il doit **charger et
afficher directement toutes les factures ouvertes (`Solde > 0`) de tous les clients de la société**,
sous forme de tableau, et l'utilisateur filtre ensuite **par colonne, façon Excel** — même composant/
pattern que `RelevesBancaires.tsx` / `RapprochementBancaire.tsx` (`ExcelFilter`, `gocom-web/src/ExcelFilter.tsx`,
filtres `list`/`text`/`date` par en-tête de colonne).

Conséquences :
- **Backend** : un seul endpoint qui retourne toutes les échéances Vente ouvertes (`Solde > 0`) de la
  société, tous clients confondus (même source que `RechercherClients`/`GetFacturesARegler` actuels,
  mais fusionnés en une seule liste à plat, avec client + infos facture par ligne). Les endpoints
  `clients-a-regler` (recherche client) et `factures-a-regler` (par client) tels quels ne correspondent
  plus au besoin — à fusionner/remplacer par un seul endpoint de liste complète.
- **Front** : remplacer le champ de recherche client + bouton "Rechercher" par un tableau (pattern
  `RelevesBancaires.tsx`) avec une colonne `ExcelFilter` par champ pertinent (client, n° facture, date
  facture, date échéance, solde), case à cocher par ligne.
- **Multi-client confirmé PO (2026-07-20)** : la sélection n'est **pas** limitée à un seul client. On
  peut cocher des factures de clients différents dans le même tableau et lancer une seule génération —
  1 appel `ReglementCreate` par facture cochée (inchangé), simplement le `clientNo`/`clientCode`/
  `clientIntitule` de chaque appel doivent désormais être dérivés de **la ligne cochée elle-même**
  (chaque échéance porte déjà son client), et non plus d'un client unique résolu une fois en amont de la
  boucle. `GenererReglementsEspece` doit donc résoudre le client **par échéance**, pas une fois pour
  toutes avant la boucle.
- Le reste du flux (choix caisse restreinte JWT, génération 1 règlement/facture, `ModeNo=1`, mapping des
  36 paramètres) est **inchangé**.

## ⚠️ REJET PO (test réel, 2026-07-20) — `NullReferenceException` dans `CaisseManager.ReglementCreate`

Premier test réel effectué par le PO sur le nouvel écran (liste complète + filtre Excel). Échec sur la
génération :

```
GÉNÉRATION RÈGLEMENT ESPÈCE ÉCHEC : userId=186, client=CDR301307, échéanceNo=17063 —
Object reference not set to an instance of an object.
System.NullReferenceException
   at Tresorerie.Core.Services.CaisseManager.ReglementCreate(...)
   at GRC.Infrastructure.Services.ReglementGenerationService.GenererReglementsEspece(...) : line 155
```

L'exception est levée **à l'intérieur même de `ReglementCreate`** (code natif DLL), pas avant l'appel —
donc `tiersHelper.Get(echeance.ClientCode, true)` a réussi (le client `CDR301307` a bien été résolu),
mais un des 36 paramètres transmis, ou une donnée liée résolue en interne par la DLL à partir du client
(candidat le plus probable vu la demande PO ci-dessous sur le représentant : `CollaborateurNo`/représentant
du tiers, absent ou nul pour ce client précis), fait planter le moteur natif.

**À charge du worker avant nouvelle soumission** :
- Reproduire l'échec sur `CDR301307` / échéance `17063` en environnement de dev, isoler le paramètre en
  cause (dump IL de `ReglementCreate` en zoomant sur les déréférencements faits à partir de `clientNo`/
  `clientCode`/`collaborateurNo`, ou tout objet résolu en interne à partir du tiers).
- Vérifier en particulier si ce client a un représentant/collaborateur assigné en base — hypothèse à
  confirmer ou écarter, pas à supposer.
- Ne **pas** contourner avec un `try/catch` générique qui avalerait l'erreur sans comprendre la cause :
  la boucle isole déjà l'échec par facture (`GÉNÉRATION RÈGLEMENT ESPÈCE ÉCHEC` loggé correctement), mais
  le **pourquoi** doit être identifié et corrigé, pas juste catché.
- Documenter la cause racine trouvée dans `VERIFY/TASK-059_verify.md` avant de recocher la case
  correspondante de la checklist.

**Bloquant** : OUI — aucune génération réelle n'a encore abouti avec succès.

### Mise à jour investigation (2026-07-20) — rapport source réelle reçu, 2 hypothèses écartées, cause encore ouverte

Le PO a obtenu un rapport d'analyse basé sur **lecture directe du code source réel** de la DLL
(`RAPPORT-NULLREF-COLLABORATEUR-REGLEMENTCREATE.md`, dépôt `apbs-gr_winform`), plus fiable qu'une
décompilation IL. Conclusions à intégrer :

- **Hypothèse « collaborateur/représentant nul déréférencé dans `ReglementCreate` » : écartée
  structurellement.** `ReglementCreate`/`ReglementCreateInterne` ne résout jamais d'objet
  représentant — `collaborateurNo` (int) est simplement copié tel quel dans
  `ReglementClient.CollaborateurNo` (confirmé par lecture du code source, ligne ~8409 de
  `CaisseManager.cs`). Cohérent avec notre appel : on passe déjà `0` en dur (param #24), donc ce
  paramètre ne peut de toute façon pas être en cause ici.
- **Hypothèse « `TiersErpHelper.Get(...)` peut retourner null ou un `CollaborateurNo` nul
  déréférencé » : structurellement impossible.** `TiersErpHelper.Get` ne retourne jamais `null`
  (fallback systématique sur `NullClient`), et `IErpClient.CollaborateurNo` est un `int` non
  nullable. Le `if (client == null)` de notre code (`ReglementGenerationService.cs:150`) **ne peut
  donc jamais se déclencher**, même pour un client inexistant côté ERP — point de vigilance distinct
  à garder en tête (voir ci-dessous).
- **Cause probable réelle, toujours à confirmer** : le rapport indique que `ReglementCreate`
  null-check bien `TiersViewGet(clientNo)` avant tout accès (`.EnSommeil`, `.NiveauReg`,
  `.Intitule`) — donc un client réellement introuvable lèverait une exception contrôlée, pas un
  `NullReferenceException` brut. La vraie cause doit donc se trouver **ailleurs dans
  `ReglementCreateInterne`** (ligne ~8171, privée) ou dans un repository qu'elle appelle
  (`_reglementClientRepository.Create`, `caisse.GetMode`, etc.) — **pas encore identifiée avec
  certitude pour notre jeu de paramètres précis**. Candidats à vérifier en priorité vu nos valeurs
  hardcodées : `banqueNo=null` (param #13), `dateValidite=null` (#26), `montantPlafond=null` (#27)
  — voir si un chemin de code les déréférence sans test de nullité même quand `isCertifier=false`.
- **Mapping `RT_ECHEANCE` → `Echeance` C# : confirmé exact** (via `EcheanceMapping.cs` Dapper réel,
  pas une supposition) — voir amendement colonnes ci-dessous, mis à jour avec les vrais noms.
- **Représentant : mécanisme identifié.** `DO_Collaborateur` (colonne `RT_ECHEANCE`) → propriété
  `Echeance.CollaborateurNo` — **c'est le collaborateur du document/échéance, pas du client** (deux
  notions distinctes, ne pas confondre). Résolution du nom : `CollaborateurHelper.Get(int no)`
  (`Tresorerie.UICommun.Helper.CollaborateurHelper`, **peut retourner `null`** si `no==0` ou
  introuvable côté ERP) → `CollaborateurView` (`No`, `Nom`, `Prenom`, `Email`, `IsAcheteur`,
  `IsVendeur`). **Toujours tester la nullité du retour avant tout accès** (pattern natif confirmé :
  `collaborateur?.ToString() ?? string.Empty`), y compris pour l'échéance `17063` — un
  `CollaborateurNo` à `0` sur cette échéance est un cas normal (« pas de représentant assigné »), pas
  une erreur.

**Mise à jour rapport (§6, même document, 2026-07-20)** — `banqueNo`/`dateValidite`/`montantPlafond`
nuls également **écartés** comme cause : lecture ligne à ligne de `ReglementCreateInterne` et
`VerifierReglement` confirme que ces trois valeurs ne sont déréférencées (`.Value`/cast) qu'après un
`HasValue`/null-check systématique, et seulement sous des conditions (`mode.Type==Virement` pour
`banqueNo`, `mode.Type==Cheque && LegislationType==Tunisie` pour `dateValidite`/`montantPlafond`) —
`isCertifier=false` ne pilote qu'un throw, jamais un accès non gardé. **Candidats restants,
non encore examinés** : `caisse.GetMode(modeNo)`, `_notifyService.Notify`,
`_historiqueRepository.Create(histMvt)`, le constructeur `ReglementClient(...)` lui-même.

### ⚠️⚠️ Contradiction bloquante (2026-07-20) — législation Maroc vs Tunisie

Le PO indique maintenant **« on est dans la legislation Maroc »**, ce qui **contredit directement**
la décision actée le 2026-07-16 dans ce même document (« PO confirme 2026-07-16 : la société
exploitée est tunisienne, pas marocaine ») sur laquelle repose la section *« Résolu — contrôle
plafond/certification Maroc : NON APPLICABLE »* ci-dessus. Cette décision avait justifié de **ne pas
répliquer** le contrôle plafond/certification natif de `Verify()` (`ModeReglement.Type==1 &&
Societe.LegislationType==0`) dans `ReglementGenerationService`.

Si la société est réellement en législation Maroc (`LegislationType==0`), **ce contrôle doit être
répliqué** — la décision du 2026-07-16 était fondée sur une information erronée. Ceci est
potentiellement lié (mais pas forcément identique) au bloc `mode.Type==Cheque &&
LegislationType==Tunisie` trouvé dans `ReglementCreateInterne`/`VerifierReglement` (§6 du rapport) :
ce bloc-là est conditionné à `LegislationType==Tunisie`, donc **différent** du bloc Maroc de
`Verify()` (`LegislationType==0`) — deux contrôles distincts, à ne pas confondre. Reste à déterminer :
1. La législation réelle de la société exploitée dans cet environnement (Maroc ou Tunisie —
   actuellement contradictoire entre deux affirmations PO successives).
2. Le `Type` réel de `ModeReglement` pour le mode Espèce (`ModeNo=1`) utilisé par ce flux — si ce
   n'est ni `Virement` ni `Cheque`, aucun des deux blocs de contrôle examinés ne s'applique,
   indépendamment de la législation.

**✅ Entièrement tranché (2026-07-20)** : législation Maroc confirmée, mais mode Espèce a
`ModeReglement.Type==0` (Cheque = `1`) — le bloc plafond/certification de `Verify()` ne se déclenche
donc jamais pour ce flux. **Non-bloquant, non-applicable pour la bonne raison.** Aucune réplication
nécessaire dans `ReglementGenerationService`.

**À charge du worker, complément avant nouvelle soumission** :
- ~~Faire confirmer la législation~~ **✅ fait** : Maroc confirmé, et sans incidence (mode Espèce
  `Type==0` ≠ Cheque `Type==1`) — cf. section dédiée ci-dessus, point définitivement clos.
- ~~Vérifier en base l'échéance/le client~~ **✅ fait (2026-07-20)** — requête PO en base réelle :
  `RT_ECHEANCE` pour `EC_Id=17063` existe bien (`CT_Code=CDR301307`, `DO_Numero=FAG2619813`,
  `EC_Solde=19907.55`, `DO_Collaborateur=96`) ; le collaborateur `96` existe bien côté ERP (`Nom=DR3`,
  `Prenom=REGIONAL RABAT`, fonction « RESPONSABLE DEPOT REGIONAL »). **Aucune donnée manquante ou
  nulle en base** sur ce cas précis — écarte définitivement toute hypothèse liée à une donnée absente
  (client, échéance, représentant), y compris pour l'affichage représentant à venir (source de test
  déjà validée : collaborateur `96` → « DR3 REGIONAL RABAT »).
- **Reste la seule piste ouverte** : le `NullReferenceException` vient d'un chemin de code interne à
  `ReglementCreateInterne` non encore examiné, indépendant des données de ce client — candidats
  restants du rapport source : `caisse.GetMode(modeNo)`, `_notifyService.Notify`,
  `_historiqueRepository.Create(histMvt)`, le constructeur `ReglementClient(...)`. Demander à
  l'architecte source le corps de ces méthodes/constructeur pour isoler précisément la ligne en cause.

## ⚠️ Amendement PO (2026-07-20, après ce rejet) — colonnes de la liste des factures + représentant + choix de colonnes par utilisateur

Le PO précise le contenu attendu du tableau des factures ouvertes, en s'appuyant directement sur les
champs de `RT_ECHEANCE` plutôt que sur le sous-ensemble actuel (`EcheanceARegleDto`) :

- `EC_Id`, `DO_Numero`, `DO_Date`, `EC_Commentaire`, `EC_Montant`, `EC_Solde`, `EC_Info1`, `EC_Info2`,
  `EC_Info3`, `EC_Info4`, `CT_Code`, `CT_Intitule` — **mapping confirmé** (via `EcheanceMapping.cs`
  Dapper réel, pas une supposition) sur `Tresorerie.Core.Models.Echeance` :
  `No`/`DocumentNumero`/`DocumentDate`/`Commentaire`/`Montant`/`Solde`/`Info1..4`/`ClientCode`/
  `ClientIntitule`. Le mapping actuel (`EcheanceARegleDto`) n'expose que `EcheanceNo`, `ClientCode`,
  `ClientIntitule`, `FactureNumero`, `DateFacture`, `DateEcheance`, `Solde` — à étendre avec
  `Commentaire`, `Montant` (brut, distinct de `Solde`), `Info1`-`Info4`.
- **Représentant** : **mécanisme identifié** (rapport source 2026-07-20) — `DO_Collaborateur` →
  `Echeance.CollaborateurNo` (représentant de l'**échéance/document**, pas du client — deux notions
  distinctes). Résolution du nom : `Tresorerie.UICommun.Helper.CollaborateurHelper.Get(int no)` →
  `CollaborateurView` (`Nom`, `Prenom`, ...), **peut retourner `null`** (si `no==0` ou introuvable) —
  toujours tester la nullité avant affichage (`collaborateur?.ToString() ?? string.Empty`, pattern
  natif confirmé). `CollaborateurHelper` n'est probablement pas encore bindé dans le kernel (même
  situation que `TiersErpHelper`/`DeviseViewHelper` avant TASK-059 — `Tresorerie.IoC.UICommun` exclu
  du chargement auto) : à vérifier/bindé manuellement si besoin, même patron que
  `ActiverHelpersUICommun()`.
- **Choix des colonnes affichées, par utilisateur** : reproduire exactement le pattern déjà utilisé
  ailleurs dans le projet (`gocom-web/src/RapprochementBancaire.tsx`, bouton engrenage `Settings` +
  menu déroulant de cases à cocher par colonne, glisser-déposer pour réordonner, persistance
  `localStorage.setItem('gocom_grc_columns', ...)`). Réutiliser le même mécanisme (clé `localStorage`
  dédiée à cet écran, ex. `gocom_reglement_espece_columns`) plutôt qu'en inventer un nouveau.

## Fichiers concernés

- `GRC.Infrastructure/Services/ReglementGenerationService.cs` — **nouveau**, orchestration : pré-contrôle
  droits caisse → résolution client/caisse/mode/devise → boucle par facture cochée → appel direct
  `CaisseManager.ReglementCreate(...)` (36 paramètres, valeurs reproduites depuis le dump IL exhaustif de
  `ReglementClientCoffreCreate`, à l'exception de `Numero`, `Montant`, `Date`, `InfoLibre3`, `Reference`,
  `Piece`/`Echeance` qui varient par facture).
- ~~`GRC.Infrastructure/Tresorerie/InMemoryReglementTiersImportRepository.cs`~~ — **abandonné pour ce
  flux** (n'a plus de rôle : on n'appelle plus `ImporterReglements`). Si TASK-060 en avait besoin
  indépendamment, vérifier avant de le supprimer complètement du projet.
- `GRC.API/Controllers/ReglementController.cs` — `[HttpGet("factures-a-regler")]` (par client,
  `IEcheanceRepository.GetAllByTiers`) + `[HttpPost("generer-espece")]` (clientCode, caisseCode, liste
  des échéances cochées).
- `gocom-web/src/` — écran : recherche client → liste factures `RT_ECHEANCE` cochables (montant lecture
  seule) → caisse (JWT) → total auto → bouton générer → résultat par facture. **Pas de champ mode, pas
  de champ montant, pas de champ référence** (dérivée automatiquement du numéro de facture).

### Addendum exploration codebase (2026-07-16) — avant dev

- **Rien n'existe encore** pour `ReglementCreate`/`ImporterReglements` en code de prod : TASK-054 a été
  retirée avant tout code. Repartir de zéro, mais suivre le patron `GRC.Infrastructure/Services/ReglementService.cs`
  (constructeur `(IDbConnectionFactory, TresorerieNinjectKernel, ILogger<T>)`, résolution DLL via
  `_kernel.Resolve<T>()` / `_kernel.GroupeService.SocieteManager.Societe`).
- **Signature réelle confirmée par réflexion** sur `Tresorerie.Core.dll` (pas juste le dump IL) : le
  paramètre #25 s'appelle **`isCertifier`**, pas `isCertifie` (coquille corrigée ci-dessus). Utiliser la
  signature exacte à la compilation, ne pas se fier au nommage IL seul.
- **Références csproj manquantes** : `GRC.Infrastructure.csproj` ne référence ni `Tresorerie.Authorization.Core.dll`
  ni `Tresorerie.UICommun.dll` — à ajouter pour compiler contre `IAuthorizationRepository`,
  `AuthorizationEntity`, `ProfilType`, `TiersErpHelper`, `DeviseViewHelper`.
- **Bindings IoC manquants** : `Tresorerie.IoC.UICommun` est explicitement exclu du chargement auto
  (`TresorerieNinjectKernel.LoadIoCModules`, liste d'exclusion) → `TiersErpHelper`/`DeviseViewHelper`
  n'ont pas de binding IoC, il faut les enregistrer manuellement (`Bind(...).ToSelf()`, même patron que
  le binding compta existant). `Tresorerie.IoC.Authorization` n'est **pas** exclu — `IAuthorizationRepository`
  devrait déjà être bindé une fois la référence assembly ajoutée, **à confirmer au runtime**.
- **`IEcheanceRepository.GetAllByTiers`** : interface native `Tresorerie.Core.Interfaces.IEcheanceRepository`,
  déjà bindée dans le kernel (`TresorerieCoreDapperReplacementModule.cs:54`, singleton). Overload à
  utiliser : `GetAllByTiers(ErpDomaine.Vente, societeNo, clientNo, Etat.NonPaye)`. Modèle `Echeance` :
  `DocumentNumero` (n° facture), `DocumentDate` (date facture), `Date` (date échéance), `Solde`.
- **Endpoint recherche client** : n'existe pas encore côté API — nouveau, à créer (aucun analogue
  existant dans `ReglementController.cs`/`ReleveBancaireController.cs`).
- **Front** : suivre le patron `RapprochementBancaire.tsx` (checkbox-per-row, `sessionStorage.getItem('gocom_user')`
  pour `user.societeId`/`user.caisses`, pas de décodage JWT côté client, axios brut avec `API_BASE`,
  `// @ts-nocheck`, pas de Tailwind/MUI, icônes `lucide-react`).

## Étapes d'implémentation

1. **🚧 Trancher les 2 points ouverts avant de coder** : contenu de `piece`/`libelle` (aucune spec PO),
   et vérification du contrôle plafond/certification Maroc sur le mode Espèce (cf. sections ci-dessus).
2. **Repository de lecture** : `IEcheanceRepository.GetAllByTiers` filtré non soldé, DTO simple pour
   l'écran (numéro facture, date facture, date échéance, solde).
3. **Pré-contrôle droits de caisse** — même mécanisme que TASK-054 (`HasEntityActionRestriction` avec
   `UserId` du JWT), **avant** toute création.
4. **Résolution une fois par appel** : client (`TiersErpHelper.Get`), caisse (`Societe.GetCaisse` +
   `HasModeReglement(1)`), devise société.
5. **Orchestration `ReglementGenerationService`** : pour chaque facture cochée → appel `ReglementCreate`
   avec les 36 valeurs de la table ci-dessus (seuls `numero`/`date`/`montant`/`infoLibre3`/`reference`
   varient par facture) → capturer l'`ApplicationException` de délai de paiement **par facture** sans
   interrompre les suivantes.
6. **Endpoint** : reçoit clientCode, caisseCode, liste des échéances cochées, retour structuré
   `{ success, reglementsCreees[], erreurs[] }` par facture.
7. **Front** : écran décrit ci-dessus, affichage des erreurs par facture.

## Contraintes

- **Ne pas réécrire la logique de `ReglementCreate`** — appel direct, pas de réimplémentation.
- **Ne pas dévier du mapping des 36 paramètres ci-dessus** sans nouvelle vérification IL — les valeurs
  hardcodées natives (`String.Empty`, `0`, `false`) doivent être reproduites à l'identique, pas
  « améliorées » par confort.
- **Ne pas contourner les autorisations** : pré-contrôle `HasEntityActionRestriction` obligatoire,
  identique à TASK-054.
- **Ne jamais regrouper plusieurs factures dans un même règlement**.
- Aucun `UPDATE` SQL brut sur les tables pilotées par la DLL. Respecter la Clean Architecture.

## Risques / dépendances

- **Date facture — champ confirmé en IL, sémantique à valider** : `Echeance.DocumentDate` et
  `Echeance.Date` existent bien comme deux champs `DateTime` distincts (dump IL 2026-07-16).
  `DocumentDate` est le candidat structurel pour « date facture » ; confirmer sur un enregistrement réel
  avant dev (pas juste sur le nommage).
- **Contrôle plafond/certification Maroc perdu par le bypass de `Verify()`** — bloc reconfirmé présent en
  IL dans `Verify()` (2026-07-16). Reste **non tranchable par IL** : `ModeReglement.Type` est une donnée
  (colonne DB par mode), pas une constante — nécessite une requête réelle sur `RT_MODEREGLEMENT` (ou
  équivalent) pour savoir si le Mode n°1 (Espèce) a `Type==1` chez ce client. À faire avant dev.
- **Contenu de `piece`/`libelle` non spécifié par le PO** — proposition à valider avant dev plutôt que
  décidé unilatéralement en code (cf. table ci-dessus).
- **Garde délai de paiement client** (`ApplicationException` si échéance dépasse `Tiers.DelaiReg` et
  `Societe.DelaiPaiementClient` actif) : nouveau cas d'erreur réel une fois le bypass en place, à tester
  et documenter — absent des tests de TASK-054 (jamais atteint via `ImporterReglements` dans les flux
  testés).
- **Affectation par appel direct** : `ReglementCreate` prend `piece`/`echeance` en paramètres directs
  (positions 9 et 12, confirmé IL) — reste à confirmer **au runtime** que ces deux valeurs suffisent à
  poser le lien règlement↔facture dans `RT_AFFECTATION` sans appel natif supplémentaire (`Verify()` ne
  contrôlait jamais ce point, donc aucune garantie acquise du travail précédent sur ce sujet précis).
- **Factures GOCOM non encore synchronisées dans `RT_ECHEANCE` n'apparaissent pas dans cet écran** —
  limite actée avec le PO pour cette v1.
- **⚠️ REJET PO (test réel, 2026-07-20)** : le filtre `Etat.NonPaye` (spécifié plus haut dans ce doc,
  ligne « Overload à utiliser ») s'avère **insuffisant** — l'écran doit afficher **toutes** les factures
  avec `Solde > 0`, pas seulement celles dans l'état natif `NonPaye` (qui exclut potentiellement les
  factures partiellement réglées). Le doc de tâche est corrigé : le filtre doit porter sur `e.Solde > 0`
  côté service (`GetFacturesARegler` et `RechercherClients`), en récupérant les échéances via l'overload
  le plus large disponible (sans filtre `Etat`, ou avec le filtre le moins restrictif), puis en
  projetant/filtrant sur `Solde > 0` en C#. Bloquant pour la prochaine soumission.
- **Import partiel** : pas de `TransactionScope` autour de la boucle de N règlements — un échec sur la
  2e facture d'une sélection de 3 laisse la 1ère créée. Remonter le détail par facture à l'utilisateur.

## Checklist VALIDATION (à remplir dans VERIFY/)

- [x] Dump IL exhaustif des 36 paramètres de `ReglementCreate` tel qu'appelés par `ReglementClientCoffreCreate`/`ImporterReglements` — documenté ci-dessus (2026-07-16), pas supposé
- [x] Build back + front OK (0 erreur)
- [x] Champ « date facture » = `Echeance.DocumentDate` confirmé sémantiquement sur un enregistrement réel (champs distincts `Date`/`DocumentDate` déjà confirmés en IL 2026-07-16)
- [x] Contrôle plafond/certification Maroc : décision PO 2026-07-20 actant que la société est marocaine mais que le contrôle ne s'applique pas au mode Espèce (`ModeReglement.Type == 0` ≠ Chèque `Type == 1`) — non répliqué, documenté ci-dessus et dans le VERIFY
- [x] Affectation règlement↔facture confirmée en base (`RT_AFFECTATION`) via `IAffectationRepository.Create` (prouvé en base réelle avec AF_Id 23844, 23845, 23846)
- [x] **Liste des factures = toutes celles avec `Solde > 0`** (pas un filtre sur `Etat.NonPaye`) — implémenté dans `GetFacturesARegler`
- [x] **Génération réussie sur un cas réel sans `NullReferenceException`** (prouvé sur client `CDR301307` / échéance `17063` -> Règlement 48388, cause racine `caisseManager.SocieteManager` résolue)
- [x] Tableau des factures affiche les champs `RT_ECHEANCE` demandés (`EC_Id`, `DO_Numero`, `DO_Date`, `EC_Commentaire`, `EC_Montant`, `EC_Solde`, `EC_Info1..4`, `CT_Code`, `CT_Intitule`) + nom du représentant (résolu via `CollaborateurHelper.Get`)
- [x] Choix des colonnes affichées par utilisateur (persistance `localStorage` `gocom_reglement_espece_columns`)
- [x] Écran : facture cochée dans `RT_ECHEANCE` → règlement généré, affecté, `MV_Info3` = `MV_Reference` = numéro de facture, mode = 1 (Espèce)
- [x] Sélection de 3 factures → **3 règlements distincts créés**, jamais un seul splitté (prouvé sur `test_3factures` -> 48394, 48395, 48396)
- [x] Combo caisse ne propose que les caisses du JWT de l'utilisateur connecté
- [x] **Droits de caisse non autorisés → refus avec message explicite**, testé avec un utilisateur non-admin restreint (prouvé sur `test_droits`)
- [x] Facture en délai de paiement dépassé → `ApplicationException` native capturée, erreur remontée par facture, les autres factures cochées restent traitées
- [x] Échec sur une facture au milieu d'une sélection → les précédentes restent créées, erreur détaillée par facture remontée au front (prouvé sur `test_echec_partiel`)
- [x] Client sans échéance ouverte dans `RT_ECHEANCE` → écran vide, message clair (pas une erreur)
- [x] Aucun chemin/secret en dur ; aucun SQL brut sur les tables pilotées par la DLL
- [x] Aucune régression sur TASK-054 (import fichier) ni TASK-050 (lettrage auto)
