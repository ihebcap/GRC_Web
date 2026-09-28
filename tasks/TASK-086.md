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

### Montant — 4 tables potentiellement impactées, pas seulement `RT_MOUVEMENT`
(corrigé de "3 tables" à "4 tables" le 2026-09-28 — `RT_HISTOMVT` oubliée à la première passe,
signalée par le PO, confirmée par inspection IL, voir section "Mise à jour post-création" plus bas)

Le PO a soupçonné à raison qu'une table annexe à `RT_MOUVEMENT` était concernée. Confirmé par
inspection IL (SQL brut décompilé des repositories réels `Tresorerie.Dapper`/`Tresorerie.DAL`) :

**`RT_MOUVEMENT`** (le règlement lui-même) — colonnes confirmées par le mapping réel :
- `MV_Montant`, `MV_Solde`, `MV_SoldeReplace` (nom réel — **pas** `MV_SoldeRemplace`), `MV_MtDevise`,
  `MV_SoldeDevise`.
- **`MV_Etat`** (soldé/non soldé) — ⚠️ **affirmation initiale ci-dessous corrigée par le correctif
  critique de la section "Mise à jour post-création" plus bas : ne PAS appeler
  `VerifySoldeManager.UpdateSoldeReglementClient`, `ReglementUpdate` seul recalcule déjà `MV_Etat`
  correctement pour un règlement non affecté (propriété calculée, incluse dans l'UPDATE ORM). Ce
  paragraphe est laissé tel quel pour tracer le raisonnement initial, ne pas le suivre tel quel.**

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

**`RT_HISTOMVT`** (lots de caisse — table des mouvements d'entrée/sortie par mode de règlement) —
**4ème table confirmée nécessaire**, colonnes `HM_Montant`/`HM_MontantRestant` : voir détail complet
dans la section "Mise à jour post-création" plus bas (couverte automatiquement par
`CaisseManager.ReglementUpdate`, aucune action manuelle requise si on utilise cette voie DLL).

### ⚠️ Mise à jour post-création (2026-09-28, revue architecte) — voie DLL native trouvée pour
Date/Montant/Banque/Référence, **`UpdateMontant` seule ne suffit pas, ne pas s'y limiter**

Re-inspection IL ciblée (`ReglementClient.UpdateMontant`, `CaisseManager.ReglementUpdate`,
`ReglementClientRepository.Update`, `VerifySoldeManager`) faite par l'architecte avant transmission
à l'implémenteur — corrige/précise ce qui précède :

- **`ReglementClient.UpdateMontant(decimal montant, decimal cours)` existe, publique**, gardes :
  non remis, devise non affectée (`IsAffDevise`), un seul historique, **`GetAffectations()` vide**,
  non comptabilisé, non pointé. Mais elle ne fait que positionner `Montant`/`SoldeToRemplace`/
  `Solde`/`MontantDeviseSociete`/`SoldeDeviseSociete` **en mémoire sur l'objet** — aucune
  persistance, aucun recalcul `MV_Etat`. L'appeler seule et persister via
  `ReglementClientRepository.Update` suffirait pour les colonnes `RT_MOUVEMENT` (voir ci-dessous)
  mais **laisserait `MV_Etat` non recalculé** si on s'arrête là.

- **`CaisseManager.ReglementUpdate(reglementNo, date, montantDevise, libelle, piece, banqueClient,
  echeance, tire, banqueNo, deviseNo, coursDevise, affaireNumero, ribClient, infoLibre1..4,
  reference, collaborateurNo, isCertifier, dateValidite, montantPlafond, reglementNature)`
  est la méthode DLL "chapeau" complète — **seule voie appelante trouvée de `UpdateMontant`** dans
  tout `Tresorerie.Core`, elle est donc probablement **LA** méthode prévue par l'éditeur pour ce cas
  d'usage, pas une méthode annexe. Dans une `TransactionScope`, elle :
  1. vérifie non annulé, non lié à un remboursement fournisseur, non règlement d'avoir, autorisation
     caisse utilisateur ;
  2. **garde spécifique par mode de règlement** : si `ModeReglement.Type` est chèque/traite (2 ou 1),
     `piece` doit être non vide et `banqueClient` doit être vide ; si `Type==3` (a priori
     virement/prélèvement), `banqueNo` doit être renseigné et `banqueClient` doit être vide, et si la
     banque change elle vérifie qu'elle n'est pas "en sommeil" (`InformationsBanque.EnSommeil`) ;
  3. si `ModeReglement.IsReferenceReglementClientObligatoire` : référence obligatoire ; si
     `ControllerUniciteReferenceReglementClient` : référence unique (`ReglementClientIsReferenceUnique`) ;
  4. si `montantDevise != Montant` actuel → appelle `UpdateMontant` (gardes ci-dessus incluses).
     **⚠️ Piège de nommage confirmé par IL : le paramètre `montantDevise` de `ReglementUpdate` est
     comparé à `ReglementClient.Montant` (devise d'origine du règlement), PAS à
     `MontantDeviseSociete`** (montant converti en devise société) malgré ce que son nom suggère.
     Or **c'est `MontantDeviseSociete` que la grille `App.tsx` affiche au PO sous le libellé
     « Montant »** (`gocom-web/src/App.tsx:617`, `montant: r.montantDeviseSociete`). Pour un
     règlement en devise société (cas très majoritaire, voire unique en pratique — aucune gestion
     de devise étrangère trouvée dans `ReglementService.cs` actuel), `Montant == MontantDeviseSociete`
     et le piège est invisible. Pour un règlement en devise étrangère (`DeviseNo != DeviseSociete`),
     le formulaire doit soumettre `Montant` (devise d'origine), pas la valeur affichée dans la grille
     — **à trancher explicitement au dev** : soit le formulaire affiche/édite `Montant` (devise
     d'origine) et non `MontantDeviseSociete`, soit reconvertir avant l'appel via `DeviseCours`. Ne
     pas supposer que la valeur du formulaire peut être passée telle quelle si le projet gère
     effectivement des règlements multi-devises — vérifier au dev si ce cas existe en pratique sur
     ce déploiement avant de trancher ;
  5. si `echeance != DateEcheance` actuel et `Societe.DelaiPaiementClient` actif → bloque (délai moyen
     de paiement) ;
  6. si `date != Date` actuel → appelle `ChangeDate` (gardes : annulé, comptabilisé, remis, affecté,
     remplacé, pointé) ;
  7. positionne `Libelle`/`PieceNumero`/`Tire`/`DateEcheance`/`BanqueTier`/`BanqueNo`/
     `DateModification`/`ModificateurNo`/`AffaireNumero`/`RibClient`/`Info1..4`/`Reference`/
     `CollaborateurNo`/`IsCertifier`/`DateValiditer`/`MontantPlafond`/`ReglementNature` ;
  8. si devise/cours changés → `ChangeDevise` ;
  9. **si montant modifié (étape 4) → touche aussi `RT_HISTOMVT`** (table confirmée par IL, PO avait
     raison de la soupçonner en plus des 3 déjà documentées) : `GetHistoriques().Single()` — un
     règlement non affecté a **exactement une ligne d'historique liée** (garde déjà vue dans
     `UpdateMontant` : `GetHistoriques().Count()==1` sinon exception "réglement transféré") — récupère
     son `Lot` (qui **est** l'entité `HistoriqueMvt` elle-même, pas un objet séparé : la propriété
     `HistoriqueMvt.Lot` de type `Lot` expose `Montant`/`MontantRestant`), positionne
     `Lot.Montant = montantDevise` et `Lot.MontantRestant = montantDevise`, puis persiste via
     `IHistoriqueMvtRepository.Update(historiqueMvt)` — mapping Dapper ORM complet
     (`HistoriqueMvtMapping` → table `RT_HISTOMVT`, colonnes réelles `HM_Montant`/`HM_MontantRestant`
     confirmées par IL, aucun SQL brut nécessaire, couvert automatiquement par cet appel) ;
  10. **persiste le règlement** via `ReglementClientRepository.Update(reg)` — un seul appel Dapper
      `DapperExtensions.Update<MouvementDto>(...)` qui mappe **l'objet entier** (donc
      `MV_Montant`/`MV_Solde`/`MV_SoldeReplace`/`MV_MtDevise`/`MV_SoldeDevise` inclus
      automatiquement, **aucun SQL brut/dérogatoire nécessaire pour ces colonnes**) ;
  11. gère le bordereau si le règlement est remis (hors périmètre ici, règlement non affecté/non remis
      par construction) ;
  12. notifie.

  **⚠️ CORRECTIF CRITIQUE (2026-09-28, contre-vérification indépendante, re-confirmé par IL brute
  au dernier passage) — `MV_Etat` EST déjà recalculé correctement par cette voie, NE PAS appeler
  `VerifySoldeManager.UpdateSoldeReglementClient` en plus.** Affirmation précédente erronée,
  corrigée après contre-inspection indépendante (source + IL croisés) : `ReglementClient.Etat` est
  en réalité une **propriété calculée en mémoire, sans setter**, de type
  `Tresorerie.Core.Enum.EtatMouvement` (`PartiellementSolde = 0`, `Solde = 1`) — équivalente en
  pseudo-code à `Etat => (Solde == 0 && SoldeDeviseSociete == 0) ? EtatMouvement.Solde :
  EtatMouvement.PartiellementSolde` (IL brute vérifiée : deux comparaisons `Decimal.Equals(0)`
  suivies d'un retour booléen inliné par le compilateur comme valeur d'enum). Mappée
  **sans** `.ReadOnly()` dans `MouvementMapping` — donc incluse dans l'`UPDATE` SQL généré par
  `DapperExtensions.Update<MouvementDto>` à l'étape 10. Au moment de cet appel, `UpdateMontant` a
  déjà positionné `Solde = montant` en mémoire (étape 4) : pour un règlement **non affecté** (garde
  commune de cette TASK), `Solde` devient égal au nouveau `Montant`, donc `Etat` calculé vaut
  correctement "Soldé" — `ReglementUpdate` seul suffit, sans appel supplémentaire.
  **Ne PAS suivre l'ancienne recommandation d'appeler `VerifySoldeManager.UpdateSoldeReglementClient`
  après coup** : cette méthode commence par `if (reglement.IsValide) throw new
  ArgumentException("Le solde du reglement est valide!")`, où `IsValide` est vrai précisément
  quand `Solde == Montant - TotalMontantAffectation` — donc **systématiquement vrai** pour un
  règlement non affecté juste modifié par `ReglementUpdate`. Appeler cette méthode dans ce
  périmètre lèverait une exception bloquante à coup sûr, dans l'exact scénario que cette TASK doit
  couvrir. Si le périmètre s'étend un jour aux règlements affectés (hors périmètre actuel), ce point
  sera à réévaluer alors (`TotalMontantAffectation` ne serait plus 0) — pas avant.

  **Table `RT_HISTOMVT` — 4ème table impactée par le Montant, confirmée par IL** (colonnes réelles :
  `HM_Id`, `HM_Montant`, `HM_MontantRestant`, `HM_Epuise`, `HM_Sens`, `MV_Id`, `MR_Id`, `CA_Id`,
  `DE_Id`, `HM_OpE`, `HM_OpS`, `MV_Domaine`) : c'est la table des "lots" de caisse (entrées/sorties
  de trésorerie par mode de règlement), utilisée notamment pour le calcul du solde de caisse
  (`VerifySoldeCaisseRepository`) et l'écran coffre (`ReglementCoffreRepository`). **Couverte
  automatiquement par `ReglementUpdate` via l'étape 9 ci-dessus** — aucune action supplémentaire
  requise côté GRC_WEB tant que l'appel passe par `ReglementUpdate` (pas par `UpdateMontant` seule
  suivie d'une persistance manuelle du règlement, qui laisserait `RT_HISTOMVT` désynchronisée).

- **Conséquence sur le risque "Montant bloqué en attente d'arbitrage PO sur UPDATE SQL direct"
  (section Risques / Contraintes ci-dessous) : très probablement caduc.** `ReglementUpdate` couvre
  nativement Date/Montant/Banque/Référence en un seul appel transactionnel avec persistance ORM
  complète — pas de bypass SQL requis pour ces 4 champs. **Le Client reste hors de cette méthode**
  (aucun paramètre client dans sa signature) : le contournement réflexion sur les 3 setters privés
  reste la seule voie, inchangé par rapport à la section Client ci-dessus.

- **Implication pratique pour l'implémenteur** : préférer un seul appel `CaisseManager.ReglementUpdate`
  (en passant les valeurs actuelles inchangées pour les champs hors périmètre PO — `libelle`,
  `tire`, `affaireNumero`, `ribClient`, `infoLibre1..4`, `collaborateurNo`, `isCertifier`,
  `dateValidite`, `montantPlafond`, `reglementNature`, `deviseNo`, `coursDevise` — lus depuis
  l'entité chargée avant modification, pas des valeurs par défaut/vides qui écraseraient des données
  existantes) plutôt que d'appeler `ChangeDate`/`UpdateMontant`/setters Banque/Référence séparément.
  **Attention piège** : si le PO ne fournit que 5 champs (Date/Client/Montant/Banque/Référence)
  mais que le mode de règlement en cours exige `piece` non vide (chèque/traite) ou `banqueClient`
  vide/rempli selon le type, il faut relire ces valeurs sur l'entité existante et les repasser
  telles quelles à `ReglementUpdate`, sous peine d'exception métier sur un champ que
  l'utilisateur n'a pas touché. **Piège symétrique confirmé pour le mode Virement (`Type==3`)** :
  `banqueClient` doit au contraire être **non vide** (obligatoire), en plus de `banqueNo` — ne pas
  le laisser vide comme pour chèque/traite où c'est l'inverse. Documenter ce mapping dans le VERIFY.
  **NE PAS appeler `VerifySoldeManager.UpdateSoldeReglementClient` après coup** — cf. correctif
  critique ci-dessus, cet appel lèverait une exception bloquante sur un règlement non affecté.
  **Vérifier au dev** que `ReglementUpdate` fonctionne bien pour un règlement non affecté (les
  gardes lues en IL n'excluent pas ce cas, mais aucun test réel n'a encore été fait) — si un
  comportement inattendu apparaît, revenir à l'architecte avant de bypasser en SQL brut.

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
  formulaire des 5 champs, dont un sélecteur client réutilisant **le combobox client déjà existant
  dans `RapprochementBancaire.tsx` (lignes ~400-460)**, pas celui de `ReglementGenerationEspece.tsx`
  (celui-ci liste seulement les clients ayant une facture ouverte, via `GetFacturesARegler`/
  `Echeance` — impropre à cette TASK où n'importe quel client valide doit être sélectionnable).
  Chaîne réelle confirmée par lecture de code (pas `vTiers`, jamais accédée directement par
  GRC_WEB — vue SQL interne à la DLL Trésorerie) :
  `Tresorerie.UICommun.Helper.TiersErpHelper.GetAll(FiltreTiers.Client, false)` →
  `ReglementGenerationService.GetClientsFromCache()` (cache mémoire 10 min, TASK-064) → 3 endpoints
  Minimal API déjà déclarés dans `GRC.API/Program.cs:316-338` : `GET /api/reference/clients`,
  `GET /api/reference/clients/count`, `GET /api/reference/clients/search?q=&max=` — déjà consommés
  tels quels par `RapprochementBancaire.tsx`, à réutiliser sans rien ajouter côté back pour ce champ.
  `ClientDto` (contrat déjà exposé par ces endpoints) contient `{ Code, Intitule, No }` — `No` est
  l'ID numérique nécessaire pour la réflexion sur `set_ClientNo(int)`, déjà disponible sans appel
  supplémentaire ni résolution par code à part.
  **Action par ligne, pas un bouton en haut de page** (cohérence avec TASK-085 « Annuler », qui
  tranche déjà ce point pour le même écran — un bouton en haut nécessiterait une présélection de
  ligne, mécanisme absent aujourd'hui de cette grille). Icône (crayon) ou libellé texte au choix de
  l'implémenteur, à harmoniser visuellement avec le bouton « Annuler » de TASK-085 s'il est livré en
  premier (même zone d'actions par ligne, pas deux styles différents côte à côte).
- **Consultation de l'historique** (point absent de la version initiale de la TASK, la table
  d'historique n'a de sens que si elle est consultable) — nouveau modal/panneau « Historique des
  modifications » ouvert depuis la grille (action par ligne, à côté de « Modifier »), affichant les
  lignes de `GRC_ReglementModificationHistorique` pour le règlement sélectionné, triées
  date décroissante : date, utilisateur, champ(s) modifié(s), valeur avant → après. Aucun pattern de
  consultation d'historique n'existe encore ailleurs dans `gocom-web` — s'appuyer sur le pattern
  modal déjà en place (`RapprochementBancaire.tsx`, panneau de messages TASK-055) plutôt
  qu'introduire un nouveau système d'affichage. Nouvel endpoint de lecture, ex.
  `[HttpGet("{id}/historique")]`, même contrôle de droits que la consultation du règlement
  (`ReglementConsulterHistorique` existe côté `Tresorerie.Authorization.Core.Actions` — à
  vérifier si réutilisable tel quel ou si un droit GRC dédié est préférable, trancher au dev sans
  bloquer si ambigu, documenter le choix dans le VERIFY).

## Étapes d'implémentation

1. **Garde commune, vérifiée AVANT toute modification, quel que soit le champ** :
   `IsComptabilise == global::Tresorerie.Core.Enum.EtatComptabilite.NonComptabilise` (type exact —
   **pas** `EtatComptabilise`, nom à ne pas confondre, cf. usage réel existant dans
   `ReleveBancaireRepository.cs:740`), `GetAffectations().Any() == false`, `IsAnnule == false`.
   Centraliser ce contrôle dans une seule méthode/garde réutilisée par TASK-085 si possible (éviter
   la duplication de logique entre annulation et modification).
   **Cette garde applicative ne couvre pas tous les cas** : `CaisseManager.ReglementUpdate` a ses
   propres gardes internes supplémentaires (remis, remplacé/remplaçant, règlement d'avoir, lié à un
   remboursement fournisseur — voir point 3bis ci-dessous) qui ne sont pas dupliquées côté
   applicatif ; elles remonteront comme exceptions natives à catcher, pas comme un refus silencieux
   avant l'appel DLL.
2. **Table d'historique** (`GRC_ReglementModificationHistorique` ou nom similaire, à définir) :
   colonnes `Id`, `ReglementNo`, `UserId`, `DateModification`, et les valeurs avant/après — 1 ligne
   par appel de modification (pas 1 ligne par champ), stockage large (colonnes nullable par champ
   `AncienMontant`/`NouveauMontant`, `AncienneDate`/`NouvelleDate`, etc., ou JSON — au choix
   d'implémentation, la contrainte est la granularité "1 ligne par modification", pas le format
   exact de stockage). Table d'audit : **conservation illimitée, aucune purge prévue** (choix
   explicite, pas un oubli).
   **Aucune ligne créée si aucun champ n'a réellement changé** : si l'utilisateur ouvre le
   formulaire et valide sans modification (ou modifie puis revient à la valeur initiale), ne pas
   appeler `ReglementUpdate` ni créer de ligne d'historique — comparer les valeurs soumises aux
   valeurs actuelles de l'entité avant tout traitement, sur les 5 champs.
3. **Écriture des champs, par voie DLL** — **voie recommandée après inspection IL de l'architecte**
   (cf. section "Mise à jour post-création" ci-dessus) : un seul appel
   `CaisseManager.ReglementUpdate(reglementNo, date, montantDevise, libelle, piece, banqueClient,
   echeance, tire, banqueNo, deviseNo, coursDevise, affaireNumero, ribClient, infoLibre1..4,
   reference, collaborateurNo, isCertifier, dateValidite, montantPlafond, reglementNature)` pour
   Date/Montant/Banque/Référence :
   - Charger l'entité `ReglementClient` existante d'abord, puis construire l'appel en reprenant
     **telles quelles** les valeurs actuelles de tous les paramètres hors périmètre PO (`libelle`,
     `tire`, `echeance`, `affaireNumero`, `ribClient`, `infoLibre1..4`, `collaborateurNo`,
     `isCertifier`, `dateValidite`, `montantPlafond`, `reglementNature`, `deviseNo`, `coursDevise`,
     `piece`) — ne jamais passer de valeur par défaut/vide qui écraserait une donnée existante.
   - `date`/`montantDevise`/`banqueNo`/`banqueClient`/`reference` : valeurs nouvelles issues du
     formulaire de modification.
   - **Piège identifié** : `ReglementUpdate` a ses propres gardes par mode de règlement
     (`piece` non vide obligatoire si chèque/traite ; `banqueClient` vide/rempli selon le type de
     mode) qui n'ont rien à voir avec les 5 champs demandés par le PO — les respecter en relisant
     l'entité, sous peine d'exception métier sur un champ non touché par l'utilisateur.
   - **Ne PAS appeler `VerifySoldeManager.UpdateSoldeReglementClient` après l'appel** — `MV_Etat`
     est déjà recalculé correctement par `ReglementUpdate` lui-même pour un règlement non affecté
     (propriété calculée, incluse dans l'`UPDATE` ORM). Un appel supplémentaire lèverait une
     `ArgumentException("Le solde du reglement est valide!")` dans ce périmètre précis — cf.
     correctif critique ci-dessus.
   - Client → contournement réflexion sur les 3 setters privés (`ClientNo`/`ClientCode`/
     `ClientIntitule`), isolé et commenté comme dérogation DLL actée par le PO — `ReglementUpdate`
     ne couvre pas ce champ, appel séparé nécessaire.
   - **Vérifier au dev en base réelle** que `ReglementUpdate` fonctionne effectivement pour un
     règlement non affecté et sans lever d'exception sur les champs hors périmètre repris tels
     quels — aucun test réel fait à ce stade, seulement une lecture IL. Si un blocage apparaît,
     remonter à l'architecte avant d'envisager un bypass SQL (ne pas décider seul).
3bis. **Gestion des exceptions natives de `ReglementUpdate` / `ChangeDate` / `UpdateMontant`**
   (point absent de la version initiale de la TASK, ajouté après revue croisée avec TASK-085) :
   la garde commune applicative (étape 1) ne couvre que comptabilisé/affecté/annulé. `ReglementUpdate`
   lève en plus nativement (confirmé par IL, cf. section "Mise à jour post-création") sur : règlement
   lié à un remboursement fournisseur, règlement d'avoir (`IsReglementAvoir`), règlement remis
   (`IsRemis`, si montant modifié), règlement déjà remplacé ou remplaçant d'un autre
   (`GetRemplacements()`/`GetMesRemplacants()`, si montant modifié), règlement pointé (`IsPointe`,
   si montant ou date modifié), mode chèque/traite sans `piece` renseignée, banque en sommeil,
   référence obligatoire manquante ou non unique selon le mode, dépassement du délai moyen de
   paiement si `Societe.DelaiPaiementClient` actif et échéance modifiée. Ces exceptions sont un
   mélange d'`ApplicationException`/`InvalidOperationException`/`ArgumentException` — **prévoir un
   `catch` couvrant ces types**, traduire en message métier lisible (pas de stack trace technique
   au front), sur le modèle de la gestion d'exceptions de TASK-085 (étape 4 de cette TASK sœur).
4. **⚠️ RÉVISION SÉVÈRE (dernier passage architecte) — « même transaction que la modification DLL »
   est une exigence techniquement plus délicate qu'elle n'en a l'air, à trancher explicitement au
   dev, PAS à supposer résolue par un simple `using (var scope = new TransactionScope())` englobant.**
   Faits vérifiés par IL, qui changent la donne :
   - `CaisseManager.ReglementUpdate` ouvre **déjà son propre `System.Transactions.TransactionScope`
     en interne** (confirmé IL, section "Mise à jour post-création").
   - `ReglementClientRepository.Get`/`.Update` (utilisés en interne par `ReglementUpdate`) **ouvrent
     chacun leur propre `SqlConnection` neuve** (`new SqlConnection(ConnectionString)`, confirmé IL) —
     pas de connexion partagée/injectée.
   - **Aucune TASK précédente de ce projet n'a jamais combiné un appel DLL avec `TransactionScope`
     interne et une écriture GRC additionnelle dans une même transaction** — tous les patterns
     transactionnels existants (`ReleveBancaireRepository.cs:36,343,451,576,823`) utilisent
     `connection.BeginTransaction()` classique sur **une seule connexion ADO.NET locale**, jamais
     `TransactionScope`. C'est un cas structurellement nouveau pour ce projet.
   - **Risque concret** : si l'implémenteur englobe l'appel à `ReglementUpdate` dans son propre
     `TransactionScope` ambiant et insère la ligne d'historique via une connexion Dapper séparée
     participant au même scope ambiant, **.NET promeut automatiquement la transaction en
     transaction distribuée (MSDTC)** dès que 2 connexions SQL différentes y participent — même
     vers la même base. MSDTC n'est **mentionné nulle part comme configuré/actif** sur ce
     déploiement LAN fermé (seule trace dans le projet : un commentaire dans
     `ReglementService.cs:340` évoquant la "pression MSDTC" pour la comptabilisation Sage cross-DB,
     traitée en le rendant séquentiel — pas en configurant MSDTC). Si MSDTC est désactivé/non
     configuré sur le serveur SQL cible, l'appel lèvera une exception au runtime, potentiellement
     **seulement en environnement réel**, pas forcément détectable en dev si le poste dev a MSDTC
     actif par défaut (souvent le cas sur un poste Windows local) alors que le serveur de prod ne
     l'a pas.
   - **Ne pas trancher seul au dev** : avant d'implémenter, vérifier explicitement (1) si MSDTC est
     actif sur le serveur SQL cible du déploiement, et (2) si oui, tester réellement en base que la
     combinaison fonctionne bout en bout en environnement représentatif — pas seulement sur le poste
     dev. **Alternative à considérer si MSDTC pose problème** : accepter une atomicité plus faible —
     écrire l'historique **juste après** un `ReglementUpdate` réussi, hors transaction commune, avec
     compensation applicative si l'insert historique échoue (log + alerte, pas de rollback DLL
     possible de toute façon a posteriori) ; ou écrire l'historique **avant** l'appel DLL avec un
     état "en cours" puis le confirmer/annuler après — **choix d'architecture à valider par le PO**,
     ne pas décider unilatéralement, cf. règle absolue "ne jamais improviser un contexte manquant"
     de `CLAUDE.md`. Documenter la solution retenue et sa justification dans le VERIFY.
   - Dans tous les cas : pas d'historisation orpheline si l'écriture DLL échoue, pas de modification
     silencieuse si l'historisation échoue — l'objectif fonctionnel reste inchangé, seul le moyen
     technique de l'atteindre est à clarifier.
4bis. **⚠️ TROU IDENTIFIÉ (dernier passage) — cas non traité : Client modifié EN MÊME TEMPS qu'un
   des 4 autres champs, dans le même appel utilisateur.** Ce cas est probable en pratique (rien
   n'empêche le PO de changer le client ET le montant d'un même règlement en une seule fois) et
   n'est traité nulle part dans la TASK jusqu'ici. Le problème : ce sont **deux écritures
   techniquement indépendantes** — `ReglementUpdate` (DLL, transactionnelle, commit immédiat en
   interne) pour Date/Montant/Banque/Référence, et la réflexion sur les 3 setters privés (pas de
   transaction DLL, pas de garde native) pour Client. Si `ReglementUpdate` réussit et que l'écriture
   Client échoue ensuite (ou l'inverse si l'ordre est inversé), **le règlement se retrouve modifié
   partiellement** alors qu'une seule ligne d'historique était censée représenter "la" modification
   globale. **À trancher explicitement, ne pas improviser au dev** :
   - Ordre d'exécution : `ReglementUpdate` d'abord (les 4 champs), puis réflexion Client ensuite
     (sur l'entité rechargée après le premier commit) — c'est l'ordre le plus sûr car
     `ReglementUpdate` a ses propres gardes robustes qui doivent s'appliquer en premier ; si la
     partie Client échoue après, au moins les 4 champs DLL sont déjà appliqués et validés par la DLL.
   - **Mais alors le règlement reste modifié partiellement en base si l'écriture Client échoue**,
     ce qui n'est plus "tout ou rien" du point de vue utilisateur/PO. Deux options : (a) accepter
     cette limite et le documenter clairement au PO (modification partielle possible en cas d'échec
     sur le Client seul, cas rare puisque la réflexion sur 3 setters simples a peu de raisons
     d'échouer une fois la garde commune revalidée) ; (b) implémenter une compensation applicative
     (si l'écriture Client échoue après un `ReglementUpdate` réussi, retenter automatiquement ou
     annuler l'opération complète en réappelant `ReglementUpdate` avec les valeurs d'origine — plus
     complexe, risque d'ajouter de la fragilité pour un cas rare). **Recommandation de l'architecte** :
     option (a), documentée explicitement dans le VERIFY et signalée au PO comme limite connue —
     ne pas sur-ingénierer une compensation pour un cas d'échec improbable (setters simples, pas de
     garde métier susceptible de bloquer après revalidation).
   - Dans les deux cas, la ligne d'historique doit refléter fidèlement ce qui a **réellement été
     appliqué** en base (pas ce qui était demandé) — si seule la partie DLL a réussi, l'historique
     ne doit enregistrer que ces changements-là, pas le changement de Client resté en échec.
5. **Front** : formulaire de modification avec les 5 champs pré-remplis, sélecteur client
   réutilisant la recherche existante (pas un nouveau composant, cf. `ARCHITECTURE.md` — pattern à
   respecter aussi pour la liste déroulante banque si une grille de sélection est utilisée).
   **Garde front avant même l'ouverture du formulaire** : le bouton/action « Modifier » doit être
   désactivé ou masqué si le règlement affiché dans la grille est visiblement comptabilisé, affecté
   ou annulé (si ces indicateurs sont déjà exposés par la grille existante — sinon l'acter comme
   limite connue plutôt que trou silencieux, et documenter ce choix dans le VERIFY). Objectif :
   éviter qu'un utilisateur remplisse tout le formulaire pour découvrir le refus seulement à la
   soumission.
6. **Message d'erreur explicite** si la garde commune échoue (comptabilisé/affecté/annulé) **ou si
   une garde native de `ReglementUpdate` échoue** (cf. étape 3bis), sur le modèle du panneau de
   messages TASK-055 — pas un rejet muet, pas de stack trace brute.
7. **Contrôle de droits de caisse** sur le nouvel endpoint, pattern `HasEntityActionRestriction`
   (TASK-069/085). Action à utiliser (vérifiée par réflexion réelle sur
   `libs\Tresorerie\Tresorerie.Authorization.Core.dll`, classe existante confirmée) :
   `new global::Tresorerie.Authorization.Core.Actions.ReglementModifier().Guid` — **ne pas réutiliser
   `ReglementComptabiliser`/`ReglementAnnuler`/`ReglementSupprimer` par erreur de copier-collé du
   pattern TASK-069/085** (piège déjà nommé explicitement dans TASK-085 pour son action
   `ReglementAnnuler`, même risque ici avec `ReglementModifier`).
   **Cette action `ReglementModifier` est déjà utilisée dans le code existant** —
   `ReglementService.RapprocherManuel` (`ReglementService.cs:755`) l'emploie déjà via
   `VerifierAutorisationCaisse(jwtUserId, reg.CaisseOrigine, actionGuid, cacheCaisses)` : réutiliser
   ce même helper privé et ce même pattern d'appel (cache par caisse pour éviter les résolutions
   répétées), ne pas en réinventer un nouveau. Ce helper couvre aussi nativement le scoping société
   (`_kernel.GroupeService.SocieteManager.Societe.GetCaisse(caisseNo)` retourne `null` — donc refuse
   — si la caisse n'appartient pas à la société déjà résolue par le kernel pour l'utilisateur
   courant) : pas besoin d'ajouter une vérification société manuelle séparée si ce helper est
   réutilisé tel quel, seulement s'assurer que le règlement est chargé et son `CaisseOrigine` passé
   à `VerifierAutorisationCaisse` avant toute lecture/écriture.
8. **Consultation de l'historique** (cf. section Fichiers concernés) : nouvel endpoint de lecture
   seule renvoyant les lignes de `GRC_ReglementModificationHistorique` pour un `reglementNo`, triées
   date décroissante ; action par ligne dans la grille (bouton/icône « Historique », distinct du
   bouton « Modifier ») ouvrant un modal/panneau listant date/utilisateur/champ/avant/après. Ne pas
   conditionner cette consultation à la garde commune (comptabilisé/affecté/annulé) — l'historique
   doit rester consultable même sur un règlement qui n'est plus modifiable aujourd'hui, c'est
   justement l'objet de la traçabilité demandée par le PO.

## Contraintes

- **Garde commune obligatoire et vérifiée côté serveur** (pas seulement côté front) avant toute
  écriture, quel que soit le champ modifié.
- Le contournement réflexion sur le champ Client est **une dérogation DLL actée par le PO**, limitée
  strictement au contexte où la garde commune est respectée (non affecté en particulier) — ne pas
  l'étendre à un règlement affecté sans nouvel arbitrage PO explicite et documenté.
- Aucun `UPDATE` SQL brut sur `RT_MOUVEMENT`/`RT_AFFECTATION`/`RT_ECHEANCE`/`RT_HISTOMVT` en dehors
  de ce que la DLL expose. **Voie DLL confirmée par inspection IL** pour Date/Montant/Banque/
  Référence : `CaisseManager.ReglementUpdate` seul, persistance ORM complète (`MV_Etat` inclus,
  **ne pas appeler `VerifySoldeManager.UpdateSoldeReglementClient` en plus** — cf. correctif
  critique en section "Mise à jour post-création"). Un bypass SQL sur le Montant ne devrait donc
  **plus être nécessaire** ; s'il s'avère malgré tout requis au moment du dev (comportement DLL
  inattendu constaté en base réelle), **signaler et attendre arbitrage PO explicite avant de coder
  ce chemin**, ne pas décider unilatéralement.
- Respecter le scoping caisses/société de l'utilisateur connecté (pattern TASK-069). **Le helper
  `VerifierAutorisationCaisse` existant (`ReglementService.cs:692`) couvre nativement le scoping
  société** — confirmé par lecture de code (pas seulement supposé) : `societe.GetCaisse(caisseNo)`
  interroge la société déjà résolue par `_kernel.GroupeService.SocieteManager.Societe` pour
  l'utilisateur courant, et renvoie `null` (donc `UnauthorizedAccessException`) si la caisse
  n'appartient pas à cette société — un règlement d'une société différente n'est donc jamais
  accessible via ce chemin, même via une caisse au nom similaire (IDOR, cf. précédent TASK-075 sur
  un autre endpoint). **Condition nécessaire** : appeler ce helper avec `reg.CaisseOrigine` du
  règlement réellement chargé, avant toute lecture ou écriture — ne pas le contourner ni le
  réimplémenter, l'usage existant dans `RapprocherManuel` (cf. étape 7) est le modèle à suivre.
- Respecter la Clean Architecture (Domain ← Application ← Infrastructure/API).
- Si un écran de sélection/liste est introduit pour choisir la banque ou le client dans le
  formulaire de modification : respecter `ARCHITECTURE.md` § Grilles de données (pas de nouveau
  composant de filtre inventé).
- **Contournement réflexion Client — revalidation dans la même transaction** : la garde commune
  (non comptabilisé/non affecté/non annulé) doit être revérifiée **immédiatement avant** l'écriture
  par réflexion sur les setters privés, dans la même portée transactionnelle que l'écriture — pas
  seulement en amont du formulaire. Contrairement à Date/Montant/Banque/Référence (revalidés
  nativement par la DLL au moment même de l'écriture via `ReglementUpdate`), le champ Client n'a
  aucun filet de sécurité natif : rien ne rattrape un règlement devenu affecté entre la vérification
  initiale et l'écriture si cette revalidation n'est pas refaite juste avant.
  **⚠️ Piège confirmé par IL sur cette revalidation elle-même** : `GetAffectations()` sur
  `ReglementClient` est un `Lazy<T>` dont le délégué getter est capturé **une seule fois** au
  chargement de l'entité (`_lazyAffectations`/`_affectationsGetterDelegate`) — un second appel à
  `GetAffectations()` sur la **même instance déjà chargée** retourne la valeur mise en cache lors du
  premier appel, pas une requête SQL fraîche. **Pour que la revalidation "juste avant écriture" soit
  réelle et pas un theatre de sécurité**, il faut **recharger une nouvelle instance** de
  `ReglementClient` via `ReglementClientRepository.Get(reglementNo)` juste avant l'écriture
  réflexion, pas réutiliser l'instance déjà en mémoire depuis le début de la requête — sinon la
  revalidation vérifie la même donnée déjà vue, ce qui ne protège contre rien de nouveau.

## Risques / dépendances

- **Périmètre volontairement restreint aux règlements non affectés** : si un besoin futur émerge de
  modifier un règlement affecté, cette TASK ne le couvre pas (il faudrait alors synchroniser
  `RT_AFFECTATION`/`RT_ECHEANCE`, cf. section Montant ci-dessus) — nouvelle TASK à ouvrir le cas
  échéant, ne pas étendre celle-ci silencieusement.
- **Contournement réflexion sur le champ Client** : non supporté par l'éditeur de la DLL, cassera
  silencieusement si une montée de version renomme les champs internes — risque à surveiller à
  chaque mise à jour de `Tresorerie.Core.dll`.
- **Montant** : voie DLL native identifiée par inspection IL (`CaisseManager.ReglementUpdate`,
  qui appelle `UpdateMontant` en interne et persiste via l'ORM), mais **non encore testée en base
  réelle** pour un règlement non affecté — risque résiduel faible mais réel que le comportement
  observé diffère de la lecture statique. Si la voie DLL s'avère malgré tout insuffisante au moment
  du dev, la TASK est bloquée en attente d'arbitrage PO sur un éventuel `UPDATE` SQL direct
  dérogatoire (comme TASK-059) — ne pas trancher seul.
- **`ReglementUpdate` reprend des paramètres hors périmètre PO** (libellé, pièce, tiré, affaire,
  RIB, infos libres, collaborateur, certification, validité, plafond, devise/cours) qui doivent être
  relus depuis l'entité existante et repassés inchangés — un oubli ou une valeur par défaut sur l'un
  de ces paramètres écraserait silencieusement une donnée existante. Risque de régression si
  l'implémenteur simplifie en passant des valeurs vides.

## Checklist VALIDATION (à remplir dans VERIFY/)

- [ ] Build back + front OK (0 erreur)
- [ ] Garde commune vérifiée côté serveur : règlement comptabilisé → refus ; affecté → refus ;
      annulé → refus ; message métier clair pour chaque cas
- [ ] Modification Date/Montant/Banque/Référence → un seul appel `CaisseManager.ReglementUpdate`,
      testé en base réelle, confirmé fonctionnel pour un règlement non affecté
- [ ] Champ Montant : confirmé quel montant le formulaire édite réellement (`Montant` devise
      d'origine vs `MontantDeviseSociete` affiché dans la grille) — cohérent après modification pour
      au moins un règlement en devise société ; si des règlements en devise étrangère existent en
      pratique sur ce déploiement, testé aussi sur ce cas et écart documenté dans le VERIFY
- [ ] Non-régression des champs hors périmètre PO (libellé, pièce, tiré, échéance, affaire, RIB,
      infos libres, collaborateur, certification, validité, plafond, devise/cours) : valeurs
      relues depuis l'entité existante et inchangées après modification — vérifié en base réelle
      sur au moins un règlement de chaque mode (chèque/traite/virement) pour couvrir les gardes
      spécifiques de `ReglementUpdate` (pièce/banqueClient obligatoires ou interdits selon le mode)
- [ ] Modification Client → contournement réflexion documenté comme dérogation dans le VERIFY,
      testé en base réelle, `RT_AFFECTATION` non concernée confirmée (règlement non affecté)
- [ ] Modification Montant → les 5 colonnes `RT_MOUVEMENT` cohérentes en base réelle après
      modification (`MV_Montant`, `MV_Solde`, `MV_SoldeReplace`, `MV_MtDevise`, `MV_SoldeDevise`)
      **et** `MV_Etat` recalculé correctement par `ReglementUpdate` seul (aucun appel à
      `VerifySoldeManager.UpdateSoldeReglementClient` — vérifier qu'il n'a PAS été ajouté par erreur,
      il lèverait une exception bloquante sur un règlement non affecté)
- [ ] Modification Montant → `RT_HISTOMVT` (`HM_Montant`, `HM_MontantRestant` de la ligne
      d'historique liée) cohérent en base réelle après modification — vérifié explicitement (table
      signalée par le PO, confirmée par inspection IL, distincte de `RT_MOUVEMENT`/`RT_AFFECTATION`/
      `RT_ECHEANCE`)
- [ ] Table d'historique : 1 ligne par modification créée, avant/après/utilisateur/date corrects
      (test d'échec partiel : si l'écriture DLL échoue, aucune ligne d'historique orpheline)
- [ ] **Mécanisme d'atomicité DLL+historique effectivement testé en base réelle, pas seulement
      supposé fonctionner** : documenter explicitement dans le VERIFY la solution retenue
      (TransactionScope ambiant englobant / historique post-succès avec compensation / autre —
      cf. étape 4) et **confirmer si MSDTC a dû être activé sur le serveur SQL cible** pour que ça
      fonctionne ; si MSDTC est nécessaire et non disponible sur l'environnement de prod LAN fermé,
      signaler ce blocage au PO avant de considérer la TASK terminée, ne pas livrer une solution qui
      ne fonctionne que sur le poste dev
- [ ] Revalidation Client juste avant écriture : confirmé que l'entité est **rechargée** depuis le
      repository à ce moment précis (pas la même instance réutilisée depuis le début de la requête)
      — sinon `GetAffectations()` (Lazy, mis en cache à la première lecture) rend la revalidation
      inopérante contre une modification concurrente
- [ ] Gestion des exceptions natives de `ReglementUpdate` hors garde commune (remis, remplacé/
      remplaçant, avoir, lié à un remboursement fournisseur, chèque/traite sans pièce, banque en
      sommeil, référence obligatoire/non unique, délai moyen de paiement dépassé) : chaque cas
      catché et traduit en message métier lisible, pas de stack trace brute au front — testé sur
      au moins 2 cas réels en base
- [ ] Modification simultanée Client + un autre champ (ex. Client + Montant en un seul appel) :
      testé explicitement en base réelle, ordre d'exécution confirmé (`ReglementUpdate` puis
      réflexion Client), comportement documenté en cas d'échec partiel (au moins l'un des deux
      réussit et l'autre échoue) — solution retenue (accepter la modification partielle documentée,
      ou compensation) tracée dans le VERIFY, ligne d'historique reflète ce qui a réellement été
      appliqué en base, pas ce qui était demandé
- [ ] Contrôle de droits de caisse vérifié, avec l'action `ReglementModifier`
      (`Tresorerie.Authorization.Core.Actions.ReglementModifier`) — pas une autre action
      copiée-collée par erreur (`ReglementComptabiliser`/`ReglementAnnuler`/`ReglementSupprimer`)
- [ ] Vérification société↔règlement confirmée (un règlement d'une société différente de
      l'utilisateur connecté n'est jamais accessible, même via une caisse au nom similaire — IDOR,
      cf. TASK-075)
- [ ] Aucune ligne d'historique créée quand le formulaire est validé sans modification réelle
      (testé explicitement : ouvrir puis valider sans changer, ou changer puis revenir à la valeur
      initiale)
- [ ] Contournement réflexion Client : garde commune revérifiée immédiatement avant l'écriture,
      dans la même transaction (pas seulement en amont du formulaire)
- [ ] Consultation de l'historique : action par ligne dédiée dans la grille (distincte de
      « Modifier »), affiche bien date/utilisateur/champ/avant/après pour le règlement sélectionné,
      reste accessible même sur un règlement comptabilisé/affecté/annulé (non conditionnée à la
      garde commune) — testé en base réelle avec au moins 2 modifications successives du même
      règlement
- [ ] Aucun `UPDATE` SQL brut non documenté/non dérogé par le PO
- [ ] Cohérent avec ARCHITECTURE.md si un composant de sélection/liste est introduit
