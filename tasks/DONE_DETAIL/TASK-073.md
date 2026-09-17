# TASK-073 — Aperçu comptabilisation : erreur de paramétrage avalée, affichée comme "Équilibré"

- **Priorité** : 🔴 Bloquant
- **Domaine** : Correction (Backend `ReglementService.ApercuComptabilisation` + Front `ApercuComptabilisation.tsx`)
- **Statut** : VERIFY déposé ([VERIFY/TASK-073_verify.md](VERIFY/TASK-073_verify.md)) — builds back et front 0 erreur. Renumérotée de TASK-071 à TASK-073 (collision avec `DONE_DETAIL/TASK-071.md`, tâche différente déjà close).
- **Dépend de** : — (même bug racine que [TASK-055](TASK-055.md) — erreurs métier avalées côté front — mais sur un chemin de code différent : l'**aperçu/simulation** avant clic sur "Comptabiliser", pas le résultat après comptabilisation réelle. Ne pas fusionner : fichiers/fonctions distincts, `handleSimuler`/`handleSimulerPreselection` vs `handleValider`.)

## Contexte

Constat PO 2026-09-17 sur l'écran d'aperçu de comptabilisation (`http://160.176.23.132:5505/`, filtre 01/08/2026-16/09/2026, 4 règlements « Rapproché : Oui ») : le tableau affiche pour chaque règlement (ex. RI LAOUAMRA 308266006, 8745,00) une sous-grille de détail (JOURNAL/COMPTE/CONTREPARTIE/TIERS/LIBELLÉ/SENS/DÉBIT/CRÉDIT/ÉCHÉANCE/PIÈCE) **entièrement vide**, un badge **"Équilibré"** malgré tout, et en bas un total **"Total Débit : 0,00 / Total Crédit : 0,00"** pour les 4 règlements sélectionnés — alors que chacun porte un montant réel non nul.

Analyse du code (pas supposée, lue) :

- **Backend** — [ReglementService.cs:776-907](../GRC.Infrastructure/Services/ReglementService.cs#L776-L907), méthode `ApercuComptabilisation`. Pour chaque règlement, `VerifierComptabilisable(societe, reg)` ([:837](../GRC.Infrastructure/Services/ReglementService.cs#L837), garde définie [:556-569](../GRC.Infrastructure/Services/ReglementService.cs#L556-L569)) lève une `InvalidOperationException` **de paramétrage** dans deux cas précis :
  1. la caisse d'origine du règlement (`reg.CaisseOrigine`) est introuvable/non paramétrée dans la société ;
  2. le mode de règlement n'est pas paramétré **pour cette caisse** (pas de compte général/contrepartie associés) — message enrichi TASK-067 avec l'intitulé du mode.
  Une exception de la DLL Sage dans `generator.Generate(...)` ([:850](../GRC.Infrastructure/Services/ReglementService.cs#L850)) est également possible (cause non énumérable, hors code de ce repo).
  Le `catch` ([:891-902](../GRC.Infrastructure/Services/ReglementService.cs#L891-902)) construit alors un objet **sans le champ `Ecritures`**, seulement `Erreur = ex.Message` — message métier clair, déjà loggé (`_logger.LogError`), mais le contrat de réponse diffère silencieusement du cas nominal ([:883-889](../GRC.Infrastructure/Services/ReglementService.cs#L883-889), qui inclut `Montant` + `Ecritures`).

- **Front** — `gocom-web/src/ApercuComptabilisation.tsx` :
  - `handleSimuler`/`handleSimulerPreselection` mappent `ecritures: ap.ecritures || []` (l.245, l.279) : l'absence du champ devient un tableau vide **sans jamais lire ni afficher `ap.erreur`**.
  - Les totaux ([l.305-308](../gocom-web/src/ApercuComptabilisation.tsx#L305-L308)) et l'état "équilibré"/"erreur" par ligne ([l.437-440](../gocom-web/src/ApercuComptabilisation.tsx#L437-L440)) sont recalculés par `.reduce`/`.some` sur `ecritures` — sur un tableau vide, `reduce` donne `0` et `.some` donne `false` **par définition**, donc `isBalanced = true` (aucune différence 0-0) et `hasRowError = false`. Le badge "Équilibré" est donc affiché **à tort** pour un règlement dont la génération d'écritures a en réalité échoué.

## Problème constaté

Une erreur de paramétrage comptable (caisse ou mode de règlement non paramétré côté DLL Sage) est totalement invisible pour l'utilisateur dans l'aperçu : pas de message, pas de badge d'erreur, au contraire un badge "Équilibré" trompeur. Rien n'empêche l'utilisateur de sélectionner ce règlement et de cliquer "Comptabiliser" en pensant que tout est en ordre.

## Objectif

Dans l'aperçu de comptabilisation, toute erreur de paramétrage (ou toute autre exception) remontée par le backend pour un règlement doit être **visible à l'écran**, avec le message métier exact (`ex.Message` — ex. « le mode de règlement n°18 (RELAIS) n'est pas paramétré pour la caisse n°3 »), et ce règlement ne doit **jamais** apparaître comme "Équilibré" ni entrer dans les totaux comme s'il avait des écritures.

## Fichiers concernés

- `GRC.Infrastructure/Services/ReglementService.cs` — `ApercuComptabilisation`, bloc `catch` [:891-902](../GRC.Infrastructure/Services/ReglementService.cs#L891-902).
- `GRC.API/Controllers/ReglementController.cs` — endpoint `POST apercu-comptabilisation` ([:153-181](../GRC.API/Controllers/ReglementController.cs#L153-181)), si le DTO de réponse doit être ajusté.
- `gocom-web/src/ApercuComptabilisation.tsx` — mapping `ap.ecritures || []` (l.245, l.279), calcul des totaux/badges (l.305-308, l.437-440).

## Étapes d'implémentation

1. **Backend** : dans le `catch` ([:891-902](../GRC.Infrastructure/Services/ReglementService.cs#L891-902)), renvoyer un contrat de réponse stable et explicite pour toute ligne en échec — `Ecritures: []` explicite (pas absent) **et** un flag dédié, par ex. `HasError: true` en plus de `Erreur`. Le cas nominal ([:883-889](../GRC.Infrastructure/Services/ReglementService.cs#L883-889)) doit inclure `HasError: false` en cohérence, pour que le front n'ait pas à déduire l'état d'erreur de l'absence d'un champ.
2. **Front** : lire `ap.erreur`/`ap.hasError` dans `handleSimuler`/`handleSimulerPreselection`. Si `hasError`, afficher le message dans la ligne du règlement concerné (même registre que TASK-055 : message métier lisible, pas de stack trace), avec un badge **erreur** (rouge), jamais "Équilibré".
3. Exclure les règlements en erreur du calcul `isBalanced`/`totalDebit`/`totalCredit` global (ou les traiter comme un cas à part, ne comptant ni pour équilibré ni pour déséquilibré silencieux) — décision d'affichage précise (badge dédié type "Non comptabilisable") à trancher avec le PO si ambigu, ne pas improviser une UX non validée.
4. **Bloquer "Comptabiliser"** pour les règlements marqués en erreur dans l'aperçu (les exclure de la sélection envoyée à `Comptabiliser`, ou désactiver le bouton tant qu'un règlement sélectionné est en erreur — à trancher avec le PO selon l'ergonomie voulue, cf. TASK-069 §5 qui documente déjà ce comportement « échec par règlement isolé » côté backend, à ne pas réinventer côté front).

## Contraintes

- Ne pas toucher à `VerifierComptabilisable` ni à la logique de génération d'écritures elle-même (`generator.Generate`) — le message métier existant est correct, il ne doit être **ni perdu ni modifié**, seulement transmis et affiché.
- Ne pas fusionner ce correctif avec TASK-055 : chemins de code distincts (`ApercuComptabilisation` en lecture seule vs `Comptabiliser` en écriture réelle), tables/DTO différents.
- Respecter `ARCHITECTURE.md` § Grilles de données si la sous-grille de détail est modifiée structurellement (peu probable ici — ajout d'un état d'erreur, pas un nouveau filtre/colonne).
- Ne pas exposer de stack trace .NET à l'écran — uniquement `ex.Message` (déjà un message métier français dans les deux cas connus de `VerifierComptabilisable`).

## Risques / dépendances

- Le message d'une exception DLL Sage brute (`generator.Generate`, hors `VerifierComptabilisable`) n'est pas garanti "propre" dans tous les cas (risque déjà noté et accepté en LAN fermé par TASK-055 § Risques) — même position à tenir ici, pas de nouveau chantier de sanitisation.
- Vérifier qu'aucun flux legitimé aujourd'hui (règlement avec `ecritures` vide pour une autre raison que l'erreur, si un tel cas existe) ne soit accidentellement reclassé "erreur" — à confirmer en lisant `IEcritureComptableGenerator.Generate` : retourne-t-il normalement une liste vide dans un cas métier valide ? Si oui, distinguer explicitement ce cas de l'erreur via le flag `HasError`, pas via `ecritures.Count == 0`.

## Checklist VALIDATION (à remplir dans VERIFY/)

- [ ] Build back OK (0 erreur)
- [ ] Build front OK (0 erreur)
- [ ] Test réel : règlement sur une caisse/mode non paramétré → message exact de `VerifierComptabilisable` affiché à l'écran dans l'aperçu, badge erreur (pas "Équilibré")
- [ ] Total Débit/Crédit du bandeau "Validation Globale" n'inclut pas les règlements en erreur comme s'ils étaient équilibrés à 0
- [ ] "Comptabiliser" n'entraîne pas la comptabilisation silencieuse d'un règlement affiché en erreur dans l'aperçu
- [ ] Non-régression : un règlement correctement paramétré affiche toujours ses écritures et son statut "Équilibré" comme avant
- [ ] Aucune stack trace .NET visible côté UI
- [ ] Cohérent avec TASK-069 (contrôle d'autorisation caisse sur ce même endpoint) — aucune régression sur le pré-contrôle `VerifierAutorisationCaisse`
