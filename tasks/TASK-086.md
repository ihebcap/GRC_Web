# TASK-086 — Modification de règlement (Date, Client, Montant, Banque, Référence) + historique

- **Priorité** : 🟠 Nouveau fonctionnel (demande PO, réunion 2026-09-28)
- **Domaine** : Backend (API + Infrastructure) + Front (liste des règlements) + SQL (nouvelle table)
- **Statut** : TODO
- **Dépend de** : —

## Contexte

Remarques PO en réunion (2026-09-28), consolidées :

- Modification d'un règlement existant sur 5 champs : **Date, Client, Montant, Banque, Référence**.
- Garde commune actée par le PO : *« le règlement ne doit pas être comptabilisé, ne doit pas être
  affecté, ne doit pas être annulé »* — identique en substance à la garde de TASK-085 (annulation).
- Le rapprochement bancaire (remarque PO séparée) **n'aura pas de mécanisme de forçage/tolérance
  d'écart dédié** : quand l'utilisateur sélectionne une ligne de relevé et un règlement de montant
  différent, le geste attendu est de **corriger le montant du règlement via cette TASK** pour qu'il
  corresponde à la ligne de relevé — pas d'accepter un écart au niveau du rapprochement lui-même.
  Cette TASK absorbe donc ce besoin, il n'y a pas de TASK séparée pour le "forçage de montant".
- Traçabilité demandée explicitement : une table d'historique des modifications de règlement,
  **avant/après, utilisateur, date** — granularité actée avec le PO : **1 ligne par modification
  globale** (valeurs avant/après en JSON ou colonnes larges), pas 1 ligne par champ modifié.

Inspection réelle (code source `Tresorerie.Core`/`Tresorerie.Dapper` + décompilation IL Mono.Cecil
du binaire livré, deux sources croisées, confiance maximale) — résultat par champ :

### Date
`ReglementClient.ChangeDate(DateTime newDate)` — méthode publique déjà exploitée dans ce projet
(TASK-031/034). Lève si le règlement a « subi un rapprochement bancaire » (bloque déjà pointé). Un
bypass de la garde d'affectation existe déjà dans le code (`ReleveBancaireRepository.cs:868-882`,
`SetDateBypassAffectation`) pour un besoin précis de rapprochement — **ne pas réutiliser ce bypass
ici** : cette TASK doit se limiter aux règlements **non affectés**, donc `ChangeDate` standard
suffit, sans contournement.

### Référence
`ReglementClient.Reference` — setter **public** direct. Simple, mais alimente
`EcritureComptable.Reference`/`DocNumero1/2` via `vw_ReglementsAComptabiliser` **au moment de la
comptabilisation** (TASK-036) — sans effet rétroactif si le règlement est déjà comptabilisé, ce qui
est cohérent avec la garde commune (non comptabilisé) actée ci-dessus.

### Banque
`ReglementClient.BanqueNo` — setter **public** direct. Aucune garde métier native pour ce champ
(contrairement à `ChangeDate`) — la garde commune (non comptabilisé/non affecté/non annulé) de cette
TASK est donc la seule protection, à appliquer explicitement côté GRC_WEB avant toute écriture.

### Client
**Aucune voie DLL native.** Dump exhaustif confirmé (19 méthodes publiques + 90 propriétés de
`ReglementClient`, décompilation IL du binaire livré) : `ClientNo`/`ClientCode`/`ClientIntitule`
existent comme propriétés mais leurs setters sont **`private`** (assignables uniquement au
constructeur). Aucune méthode `ChangeClient`/`ChangeTiers` sur `ReglementClient` ni sur
`CaisseManager` (40 méthodes `ReglementClient*` passées en revue) ni sur `TiersErpHelper` (gère
uniquement les fiches clients ERP, pas les règlements de trésorerie).

**Décision PO actée (2026-09-28)** : dans le contexte client de ce déploiement, un règlement à
modifier n'est **jamais affecté** (condition déjà garantie par la garde commune). Le PO a validé le
**contournement par réflexion** sur les 3 setters privés (`set_ClientNo(int)`,
`set_ClientCode(string)`, `set_ClientIntitule(string)`), **à la condition explicite que le contrôle
non-comptabilisé/non-affecté/non-annulé soit vérifié par le code applicatif AVANT toute
modification** (Date/Client/Montant/Banque/Référence confondus) — puisque la DLL ne fournit aucune
garde native pour ce champ précis, la garde applicative en amont en tient lieu.

⚠️ **Dérogation à documenter explicitement dans le VERIFY** (contournement DLL fermée par réflexion
sur setters privés, hors du chemin métier prévu par l'éditeur) — à l'instar de la dérogation déjà
actée pour l'`UPDATE` SQL direct sur `EC_SoldeDevise` en TASK-059. Ne pas la banaliser à d'autres
champs/cas au-delà de ce qui est décrit ici sans nouvel arbitrage PO.

### Montant — 3 tables impactées, pas seulement `RT_MOUVEMENT`

Le PO a soupçonné à raison qu'une table annexe à `RT_MOUVEMENT` était concernée. Confirmé par
inspection IL (SQL brut décompilé des repositories réels `Tresorerie.Dapper`/`Tresorerie.DAL`) :

**`RT_MOUVEMENT`** (le règlement lui-même) — colonnes confirmées par le mapping réel :
- `MV_Montant`, `MV_Solde`, `MV_SoldeReplace` (nom réel — **pas** `MV_SoldeRemplace`), `MV_MtDevise`,
  `MV_SoldeDevise`.
- **`MV_Etat`** (soldé/non soldé) — recalculé par `VerifySoldeManager.UpdateSoldeReglementClient` en
  même temps que `MV_Solde` (`UPDATE [RT_MOUVEMENT] SET [MV_Solde]=@Solde,[MV_Etat]=@Etat`) — à ne
  pas oublier, ce n'est pas qu'un recalcul de solde numérique.

**`RT_AFFECTATION`** (lien facture ↔ règlement) — **confirmé nécessaire** :
- `AF_Montant`/`AF_MtDevise` de la ou des lignes liées (`WHERE MV_Id = reglementNo`) doivent être
  ajustées en cohérence, sous peine d'incohérence montant réglé ≠ somme affectée.
- **Non-problème pour cette TASK précise** : la garde commune (règlement non affecté) exclut de fait
  ce cas — s'il n'y a aucune ligne `RT_AFFECTATION` liée, rien à synchroniser ici. **Documenter
  cette dépendance dans le code** (why non-obvious) pour qu'une future extension de la TASK à des
  règlements affectés ne l'oublie pas.

**`RT_ECHEANCE`** (échéance) — même raisonnement : recalcul via `VerifySoldeManager.UpdateSoldeEcheance`
nécessaire seulement si affecté ; **hors périmètre par construction** grâce à la garde commune
(non affecté). Ne pas implémenter ce recalcul dans cette TASK — le documenter comme non applicable
tant que la garde tient.

## Objectif

Un endpoint et un écran de modification permettant de corriger Date/Client/Montant/Banque/Référence
d'un règlement **non comptabilisé, non affecté, non annulé**, avec :
1. Écriture cohérente sur `RT_MOUVEMENT` (les 5-6 champs concernés selon le champ modifié).
2. Historisation systématique (1 ligne par modification, avant/après/utilisateur/date) dans une
   nouvelle table.

## Fichiers concernés

- Nouveau script SQL `SQL_009_TASK-086_HistoriqueModificationReglement.sql` — création de la table
  d'historique (schéma GRC, pas une table pilotée par la DLL Trésorerie).
- `GRC.Infrastructure/Services/ReglementService.cs` — nouvelle méthode
  `ModifierReglement(int reglementNo, ReglementModificationDto dto, int userId)`.
- `GRC.Infrastructure/Tresorerie/...` — point d'accès réflexion pour le champ Client (isolé dans une
  méthode dédiée clairement nommée et commentée, ex. `ForcerClientReglement`, pas dispersé inline).
- `GRC.API/Controllers/ReglementController.cs` — nouvel endpoint `[HttpPut("{id}")]` ou
  `[HttpPost("{id}/modifier")]`, avec contrôle de droits caisse (pattern TASK-069).
- `gocom-web/src/App.tsx` (ou composant liste des règlements) — bouton/modal « Modifier » par ligne,
  formulaire des 5 champs, dont un sélecteur client réutilisant la recherche client existante
  (`TiersErpHelper`/cache, pattern déjà en place pour la génération de règlement, TASK-064).

## Étapes d'implémentation

1. **Garde commune, vérifiée AVANT toute modification, quel que soit le champ** :
   `IsComptabilise == EtatComptabilise.NonComptabilise`, `GetAffectations().Any() == false`,
   `IsAnnule == false`. Centraliser ce contrôle dans une seule méthode/garde réutilisée par
   TASK-085 si possible (éviter la duplication de logique entre annulation et modification).
2. **Table d'historique** (`GRC_ReglementModificationHistorique` ou nom similaire, à définir) :
   colonnes `Id`, `ReglementNo`, `UserId`, `DateModification`, et les valeurs avant/après — 1 ligne
   par appel de modification (pas 1 ligne par champ), stockage large (colonnes nullable par champ
   `AncienMontant`/`NouveauMontant`, `AncienneDate`/`NouvelleDate`, etc., ou JSON — au choix
   d'implémentation, la contrainte est la granularité "1 ligne par modification", pas le format
   exact de stockage).
3. **Écriture des champs, par voie DLL** :
   - Date → `ChangeDate` (standard, sans le bypass `SetDateBypassAffectation` — la garde commune
     rend ce bypass inutile ici).
   - Référence → setter public direct.
   - Banque → setter public direct (`BanqueNo`).
   - Client → contournement réflexion sur les 3 setters privés (`ClientNo`/`ClientCode`/
     `ClientIntitule`), isolé et commenté comme dérogation DLL actée par le PO.
   - Montant → `UpdateMontant` si disponible pour ce cas, sinon écriture directe des 5 colonnes
     `RT_MOUVEMENT` confirmées (`MV_Montant`, `MV_Solde`, `MV_SoldeReplace`, `MV_MtDevise`,
     `MV_SoldeDevise`) **+ recalcul `MV_Etat`** — vérifier au dev laquelle des deux voies la DLL
     autorise réellement pour un règlement non affecté (ne pas supposer, tester).
4. **Écrire la ligne d'historique dans la même transaction** que la modification DLL — pas d'
   historisation orpheline si l'écriture DLL échoue, pas de modification silencieuse si
   l'historisation échoue.
5. **Front** : formulaire de modification avec les 5 champs pré-remplis, sélecteur client
   réutilisant la recherche existante (pas un nouveau composant, cf. `ARCHITECTURE.md` — pattern à
   respecter aussi pour la liste déroulante banque si une grille de sélection est utilisée).
6. **Message d'erreur explicite** si la garde commune échoue (comptabilisé/affecté/annulé),
   sur le modèle du panneau de messages TASK-055 — pas un rejet muet.

## Contraintes

- **Garde commune obligatoire et vérifiée côté serveur** (pas seulement côté front) avant toute
  écriture, quel que soit le champ modifié.
- Le contournement réflexion sur le champ Client est **une dérogation DLL actée par le PO**, limitée
  strictement au contexte où la garde commune est respectée (non affecté en particulier) — ne pas
  l'étendre à un règlement affecté sans nouvel arbitrage PO explicite et documenté.
- Aucun `UPDATE` SQL brut sur `RT_MOUVEMENT`/`RT_AFFECTATION`/`RT_ECHEANCE` en dehors de ce que la
  DLL expose, **sauf** pour le champ Montant si l'inspection dev confirme qu'aucune méthode DLL ne
  couvre les 5 colonnes en cohérence pour ce cas précis (à l'instar de la dérogation déjà actée en
  TASK-059 pour `EC_SoldeDevise`) — documenter ce choix dans le VERIFY si utilisé.
  Le PO valide alors si le forçage est acceptable en tenant compte que ceci reste un bypass DLL
  sur une table métier GRC — donc **signaler et attendre arbitrage PO explicite avant de coder ce
  chemin**, ne pas décider unilatéralement.
- Respecter le scoping caisses/société de l'utilisateur connecté (pattern TASK-069).
- Respecter la Clean Architecture (Domain ← Application ← Infrastructure/API).
- Si un écran de sélection/liste est introduit pour choisir la banque ou le client dans le
  formulaire de modification : respecter `ARCHITECTURE.md` § Grilles de données (pas de nouveau
  composant de filtre inventé).

## Risques / dépendances

- **Périmètre volontairement restreint aux règlements non affectés** : si un besoin futur émerge de
  modifier un règlement affecté, cette TASK ne le couvre pas (il faudrait alors synchroniser
  `RT_AFFECTATION`/`RT_ECHEANCE`, cf. section Montant ci-dessus) — nouvelle TASK à ouvrir le cas
  échéant, ne pas étendre celle-ci silencieusement.
- **Contournement réflexion sur le champ Client** : non supporté par l'éditeur de la DLL, cassera
  silencieusement si une montée de version renomme les champs internes — risque à surveiller à
  chaque mise à jour de `Tresorerie.Core.dll`.
- **Montant** : si la voie DLL native (`UpdateMontant`) s'avère insuffisante ou inexistante pour ce
  cas au moment du dev, la TASK est bloquée en attente d'arbitrage PO sur un éventuel `UPDATE` SQL
  direct dérogatoire (comme TASK-059) — ne pas trancher seul.

## Checklist VALIDATION (à remplir dans VERIFY/)

- [ ] Build back + front OK (0 erreur)
- [ ] Garde commune vérifiée côté serveur : règlement comptabilisé → refus ; affecté → refus ;
      annulé → refus ; message métier clair pour chaque cas
- [ ] Modification Date → `ChangeDate` natif, testé en base réelle
- [ ] Modification Référence → setter public, testé en base réelle
- [ ] Modification Banque → setter public, testé en base réelle
- [ ] Modification Client → contournement réflexion documenté comme dérogation dans le VERIFY,
      testé en base réelle, `RT_AFFECTATION` non concernée confirmée (règlement non affecté)
- [ ] Modification Montant → les 5 colonnes `RT_MOUVEMENT` + `MV_Etat` cohérents en base réelle après
      modification (`MV_Montant`, `MV_Solde`, `MV_SoldeReplace`, `MV_MtDevise`, `MV_SoldeDevise`,
      `MV_Etat`)
- [ ] Table d'historique : 1 ligne par modification créée, avant/après/utilisateur/date corrects,
      dans la même transaction que l'écriture DLL (test d'échec partiel : si l'écriture DLL échoue,
      aucune ligne d'historique orpheline)
- [ ] Contrôle de droits de caisse vérifié
- [ ] Aucun `UPDATE` SQL brut non documenté/non dérogé par le PO
- [ ] Cohérent avec ARCHITECTURE.md si un composant de sélection/liste est introduit
