# TASK-093 — Bouton « Modifier » du règlement introuvable par le PO (condition d'affichage trop restrictive ?)

- **Priorité** : 🟠 Majeur
- **Domaine** : Correction (Front, UX)
- **Statut** : DONE
- **Dépend de** : — (chevauchement de fichier avec TASK-092 — même bloc JSX `App.tsx:770-816` ;
  traiter l'une après l'autre, pas en parallèle, pour éviter un conflit de merge)

## Contexte

Remontée PO (2026-09-29) : « je trouve pas le bouton pour modifier un règlement » sur l'écran de
liste des règlements ([App.tsx](../gocom-web/src/App.tsx)).

Exploration du code (2026-09-29) : le bouton **existe** déjà (livré par TASK-086, 2026-09-28) —
[App.tsx:775-788](../gocom-web/src/App.tsx#L775-L788). Il n'est cependant affiché que si **toutes**
ces conditions sont vraies pour la ligne :

```
!reg.isAnnule && reg.isComptabilise === 0 && !reg.isPointe && reg.isRemis === 0 && !reg.isAffecte
```

C'est-à-dire : règlement non annulé, non comptabilisé, non pointé (non rapproché bancaire), non
remis en banque, non affecté à une réservation. Si le règlement que le PO consultait remplit l'une
de ces conditions bloquantes, le bouton est **silencieusement absent** — aucun indice visuel
n'explique pourquoi à l'utilisateur. (Quelle condition précise est en cause n'est pas déterminé à ce
stade — voir la relecture ci-dessous, qui montre que les 5 conditions n'ont pas le même statut.)

**Relecture approfondie de `tasks/DONE_DETAIL/TASK-086.md` (2e et 3e passages de revue architecte,
2026-09-29) — la justification n'est PAS homogène entre les 5 conditions, contrairement à une
première lecture rapide :**

- **3 des 5 conditions sont une garde PO explicite et actée** — `tasks/DONE_DETAIL/TASK-086.md:18-19` :
  *« Garde commune actée par le PO : le règlement ne doit pas être **comptabilisé**, ne doit pas être
  **affecté**, ne doit pas être **annulé** »*. Cette garde n'est pas cosmétique : c'est la condition
  qui rend acceptable le **contournement par réflexion** sur les setters privés du champ Client
  (`TASK-086.md:59-65`, décision PO du 2026-09-28 : *« un règlement à modifier n'est jamais affecté,
  condition déjà garantie par la garde commune »*), et celle qui dispense la TASK-086 de gérer la
  synchronisation de 3 tables annexes (`RT_AFFECTATION`, `RT_ECHEANCE`, `RT_HISTOMVT`,
  `TASK-086.md:88-104`) qui ne serait nécessaire que pour un règlement affecté. **Assouplir
  `isComptabilise` ou `isAffecte` rouvrirait ce chantier de synchronisation multi-tables** — pas un
  simple changement de condition JSX.
- **`isPointe` et `isRemis` ne font PAS partie de cette garde PO actée.** Ils n'apparaissent nulle
  part dans la formulation citée ci-dessus. Ils correspondent en réalité à des **gardes internes de
  la méthode DLL `ReglementUpdate` elle-même** (`TASK-086.md:383-387` : *« ReglementUpdate lève ses
  propres gardes internes supplémentaires (remis, remplacé/remplaçant, règlement d'avoir, ... réglé
  pointé) »*), reportées côté condition d'affichage du bouton front **par un choix d'implémentation
  non explicitement validé comme règle d'affichage par le PO** — probablement pour éviter d'exposer
  un bouton qui échouerait à l'appel serveur, ce qui est une prudence raisonnable, mais qui n'a
  jamais fait l'objet d'un arbitrage PO dédié contrairement aux 3 premières conditions.
- **Conséquence pour le cadrage à faire avec le PO** : la question à poser n'est pas symétrique sur
  les 5 conditions. Pour comptabilisé/affecté/annulé, tout assouplissement rouvre un chantier
  d'ampleur (contournement réflexion + synchronisation multi-tables) et doit rester bloqué sans
  arbitrage PO explicite et informé de ce coût. Pour pointé/remis, le PO n'a simplement jamais
  tranché — une clarification ciblée suffit, sans réouvrir TASK-086.

**Non confirmé à ce stade** : quel est l'état réel du règlement que le PO ne parvenait pas à
modifier (`isPointe`? `isComptabilise`? une autre combinaison?) — non observé directement, à
redemander ou reproduire avant de conclure sur la cause exacte du signalement.

## Objectif

Deux volets, à trancher avec le PO avant implémentation :

1. **UX minimal (sans changement de règle métier)** : quand le bouton Modifier n'est pas affiché,
   donner un indice visuel à l'utilisateur (ex. icône grisée avec `title` expliquant la raison
   précise — « Modification impossible : règlement comptabilisé », « ... remis en banque », etc.,
   raison différenciée par condition, pas un message générique) plutôt qu'une absence silencieuse.
2. **Clarification ciblée sur `isPointe`/`isRemis` uniquement** : ces deux conditions ne sont pas
   couvertes par la garde PO actée en TASK-086 (cf. Contexte) — demander spécifiquement au PO s'il
   souhaite qu'un règlement pointé et/ou remis en banque reste modifiable (Date/Client/Montant/
   Banque/Référence) malgré les gardes internes de `ReglementUpdate` qui pourraient alors faire
   échouer l'appel serveur pour certains champs (cf. `TASK-086.md:383-387`) — dans ce cas, la
   correction devra gérer l'échec applicatif par champ plutôt que de désactiver le bouton en bloc.
3. **Ne pas toucher à `isComptabilise`/`isAffecte`/`isAnnule`** sans un nouvel arbitrage PO qui
   rouvre explicitement TASK-086 — assouplir l'une de ces 3 conditions remettrait en cause le
   contournement par réflexion sur le champ Client et la synchronisation `RT_AFFECTATION`/
   `RT_ECHEANCE`/`RT_HISTOMVT` (cf. Contexte), un chantier bien plus large qu'une condition JSX.

## Fichiers concernés

- `gocom-web/src/App.tsx` (condition ligne 775, rendu bouton lignes 777-788)
- `tasks/DONE_DETAIL/TASK-086.md` (règle métier d'origine — lignes 18-19 garde PO actée,
  lignes 59-65 contournement réflexion Client conditionné à cette garde, lignes 88-104 tables
  annexes non gérées grâce à la garde `isAffecte`, lignes 383-387 gardes internes `ReglementUpdate`
  distinctes de pointé/remis)

## Étapes d'implémentation

1. Identifier précisément dans quel état était le règlement que le PO n'a pas pu modifier
   (`isComptabilise`? `isPointe`? `isRemis`? autre?) — redemander au PO ou reproduire, ne pas
   supposer que c'est nécessairement `isPointe`/`isComptabilise` comme hypothèse la plus probable
   énoncée plus haut.
2. Implémenter le volet 1 (indice visuel différencié par condition) dans tous les cas — c'est un
   gain UX sans risque métier, applicable aux 5 conditions telles quelles.
3. Soumettre au PO la question ciblée sur `isPointe`/`isRemis` uniquement (volet 2 de l'Objectif) —
   consigner la réponse dans le VERIFY avant de coder quoi que ce soit qui change ces deux
   conditions précises.
4. Ne pas soumettre au PO de question sur `isComptabilise`/`isAffecte`/`isAnnule` dans le cadre de
   cette tâche — un assouplissement de ces 3 conditions est hors périmètre (cf. Objectif, point 3),
   à traiter par une nouvelle TASK dédiée si jamais demandé, avec réouverture explicite de l'analyse
   TASK-086.

## Contraintes

- Ne jamais assouplir `isComptabilise`, `isAffecte` ou `isAnnule` dans le cadre de cette tâche — ce
  n'est pas une prudence générique, c'est spécifiquement parce que la garde PO actée en TASK-086 en
  dépend structurellement (contournement réflexion Client + tables annexes non synchronisées, cf.
  Contexte). Un assouplissement de ces conditions nécessite une nouvelle analyse au niveau de
  TASK-086, pas une simple validation PO ponctuelle dans le VERIFY de cette tâche.
- Le volet 1 (indice visuel) ne doit pas donner l'impression que la modification est possible si
  elle ne l'est pas (pas de bouton actif qui échouerait silencieusement côté serveur).
- Si le volet 2 (`isPointe`/`isRemis`) est validé par le PO, la correction doit composer avec le fait
  que `ReglementUpdate` peut lever ses propres exceptions pour ces cas selon le champ modifié
  (`TASK-086.md:383-387`) — prévoir la gestion de cet échec côté API/front, pas seulement retirer la
  condition d'affichage.

## Checklist VALIDATION (à remplir dans VERIFY/)

- [x] État réel du règlement à l'origine du signalement PO identifié (pas supposé)
- [x] Distinction citée dans le VERIFY entre garde PO actée (comptabilisé/affecté/annulé,
      `TASK-086.md:18-19`) et gardes internes DLL reportées côté front sans arbitrage PO dédié
      (pointé/remis)
- [x] Build front OK (0 erreur)
- [x] Indice visuel (volet 1) vérifié sur au moins un règlement dans chaque état bloquant
      (comptabilisé, pointé, remis, affecté, annulé), message différencié par condition
- [x] Réponse PO consignée sur `isPointe`/`isRemis` uniquement (volet 2) si la question a été posée
- [x] Si volet 2 implémenté : gestion de l'échec applicatif `ReglementUpdate` pour les cas remis/
      pointé prévue (non retenu par arbitrage PO, blocage maintenu avec indice visuel)
- [x] Confirmation qu'aucune modification n'a touché `isComptabilise`/`isAffecte`/`isAnnule`
- [x] Aucune dette technique silencieuse
- [x] Cohérent avec l'architecture
