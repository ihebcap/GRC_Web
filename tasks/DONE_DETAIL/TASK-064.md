# TASK-064 — Modal "Générer un règlement (Versement)" : 400 non diagnostiqué, lenteur/gel de l'écran, jargon technique visible (retour PO post-livraison TASK-060)

- **Priorité** : 🟠 Corrections bloquantes UX sur écran déjà en production (TASK-060)
- **Domaine** : Front (`gocom-web/src/RapprochementBancaire.tsx`, modal génération versement) + Backend
  (`GRC.API/Program.cs` endpoint `/api/reference/clients`, `ReglementGenerationService.GetClients`) —
  diagnostic à confirmer avant de trancher la répartition front/back du fix perf
- **Statut** : TODO
- **Dépend de** : **TASK-060** (modal et endpoint existants, livrés et clôturés 2026-07-20 — cf.
  `DONE_DETAIL/TASK-060.md`)

## Contexte

Retour PO sur l'écran réel en production, 3 constats distincts sur la même modal (bouton « Générer
règlement » de `RapprochementBancaire.tsx`, ajoutée par TASK-060) :

1. `POST /api/ReleveBancaire/generer-reglement` renvoie **400 Bad Request** de façon répétée (logs
   console fournis par le PO, 3 occurrences identiques, aucun corps de réponse visible dans le extrait
   fourni).
2. **Lenteur énorme, écran complètement bloqué** lors de la sélection du client et de la caisse dans la
   modal.
3. Jargon technique visible par l'utilisateur final : libellé `MV_Reference` et mention `(12)` à côté de
   « Versement » — le PO demande de n'afficher que **« Versement »**, sans le code technique.

## Problème constaté

### 1. Erreur 400 — cause non identifiée, ne pas corriger à l'aveugle

Le extrait fourni par le PO montre uniquement l'erreur console (`AxiosError: Request failed with status
code 400`), **sans le corps JSON de la réponse** (`{ success:false, erreur:"..." }` — cf.
[ReleveBancaireController.cs:292-307](../GRC.API/Controllers/ReleveBancaireController.cs#L292-L307) et
[ReglementGenerationService.cs:311-329](../GRC.Infrastructure/Services/ReglementGenerationService.cs#L311-L329),
qui lèvent `InvalidOperationException` avec message explicite dans plusieurs cas : ligne introuvable,
ligne déjà lettrée, crédit ≤ 0, caisse introuvable, caisse sans mode 12, client introuvable, droits caisse
insuffisants). Le front affiche déjà ce message via toast
([RapprochementBancaire.tsx:451-454](../gocom-web/src/RapprochementBancaire.tsx#L451-L454)) — **le
message exact n'a pas été fourni**, donc pas de correction possible sans le reproduire.

**Hypothèse à vérifier en priorité** (cf. point 2) : le gel de l'écran pendant la sélection client peut
provoquer une sélection de client erronée (option cliquée après un re-rendu tardif de la liste) ou un
double-submit — à confirmer ou infirmer avant toute autre piste.

### 2. Gel de l'écran — cause probable identifiée par lecture du code

- [Program.cs:299-302](../GRC.API/Program.cs#L299-L302) : `GET /api/reference/clients` appelle
  `ReglementGenerationService.GetClients()` →
  [ReglementGenerationService.cs:433-441](../GRC.Infrastructure/Services/ReglementGenerationService.cs#L433-L441)
  →`tiersHelper.GetAll(FiltreTiers.Client, false)` : **charge la totalité des clients ERP en un seul
  appel, aucune pagination, aucun cache serveur.** Sur une base GOCOM avec plusieurs milliers de clients,
  cet appel est lui-même lent.
- Côté front, [RapprochementBancaire.tsx:354-394](../gocom-web/src/RapprochementBancaire.tsx#L354-L394) :
  la liste complète est chargée une fois en mémoire (`clients`), puis **`filteredClients` est recalculé à
  chaque frappe** sur l'ensemble de la liste, et
  [RapprochementBancaire.tsx:1238-1253](../gocom-web/src/RapprochementBancaire.tsx#L1238-L1253) **rend
  un `<select>` natif avec la totalité des résultats filtrés, sans limite** (`size={4}` mais tous les
  `<option>` sont bien créés dans le DOM). Avec plusieurs milliers de clients, chaque frappe déclenche un
  re-rendu de milliers de nœuds DOM → **thread JS bloqué**, ce qui explique aussi la sensation de blocage
  sur la sélection caisse juste après (le thread reste occupé, la caisse n'est pas elle-même lente à
  charger — `userCaissesOptions` est une liste courte, restreinte au JWT).

**Cause racine probable unique** : liste client non bornée, ni côté API ni côté rendu — pas un problème
de caisse en soi.

### 3. Jargon technique affiché à l'utilisateur

- [RapprochementBancaire.tsx:1222](../gocom-web/src/RapprochementBancaire.tsx#L1222) :
  `* Mode de règlement : <strong>Versement (12)</strong> (fixé)` → le PO ne veut voir que « Versement ».
- [RapprochementBancaire.tsx:1278](../gocom-web/src/RapprochementBancaire.tsx#L1278) : libellé de champ
  `Référence (MV_Reference)` → le nom de colonne technique ne doit pas apparaître, garder seulement
  « Référence ».
- Titre modal [RapprochementBancaire.tsx:1202](../gocom-web/src/RapprochementBancaire.tsx#L1202)
  `Générer un règlement (Versement)` — à vérifier avec le PO si le mot « Versement » seul suffit aussi ici
  (cohérent avec la demande, mais pas explicitement mentionné pour ce libellé précis — confirmer avant de
  toucher le titre).

## Objectif

1. Endpoint `generer-reglement` : diagnostiquer et corriger la cause réelle du 400 (pas de correctif sans
   avoir reproduit et lu le message d'erreur exact renvoyé par l'API).
2. Sélection client : remplacer les deux éléments actuels (champ recherche + `<select>` liste) par **un
   combobox unique** (champ texte avec suggestions), recherche simultanée sur code **et** intitulé,
   **résultats bornés** (ex. limiter l'affichage aux N premiers résultats, N à définir avec le PO, ex.
   20-50) pour éliminer le gel. Évaluer si la liste complète doit encore être chargée en une fois côté
   front ou si une recherche côté serveur (endpoint paramétré par terme de recherche) est nécessaire selon
   le volume réel de clients en base (à mesurer, pas supposé).
3. Retirer tout le jargon technique visible (`(12)`, `MV_Reference`) des libellés utilisateur listés
   ci-dessus.

## Fichiers concernés

- `gocom-web/src/RapprochementBancaire.tsx` — modal génération versement : recherche/sélection client,
  libellés.
- `GRC.API/Program.cs` — endpoint `GET /api/reference/clients` (à revoir si recherche serveur retenue).
- `GRC.Infrastructure/Services/ReglementGenerationService.cs` — `GetClients()` (idem).
- `GRC.API/Controllers/ReleveBancaireController.cs` /
  `GRC.Infrastructure/Services/ReglementGenerationService.cs` (`GenererVersementDepuisReleveAsync`) —
  selon cause réelle du 400 une fois diagnostiquée.

## Étapes d'implémentation

1. **Reproduire le 400** : capturer le corps de réponse exact (`erreur`) via les logs serveur (déjà
   loggés, cf. `_logger.LogError` à la ligne 306 du controller) ou l'onglet réseau du navigateur.
   Documenter la cause précise dans le VERIFY avant tout correctif. Vérifier en particulier si elle est
   corrélée au gel de l'écran (point 2).
2. **Mesurer le volume réel de clients** (`SELECT COUNT(*)` équivalent côté ERP ou taille de la réponse
   `/api/reference/clients`) pour choisir entre : (a) borner le rendu front uniquement si le volume reste
   raisonnable, ou (b) ajouter une recherche paramétrée côté serveur si le volume est trop élevé pour être
   chargé en une fois. Ne pas décider à l'aveugle.
3. **Remplacer les deux éléments (input + select) par un combobox unique** : un seul champ de saisie,
   liste de suggestions affichée en overlay/dropdown (pas un `<select>` natif à liste complète), recherche
   sur code + intitulé, résultats bornés, sélection au clic ou clavier, code + intitulé affichés dans
   chaque suggestion (cohérent avec l'existant).
4. **Nettoyer les libellés techniques** : `(12)` et `MV_Reference` retirés de l'affichage utilisateur
   (garder les noms de champs techniques uniquement dans le code/variables, pas dans le JSX visible).
5. **Test end-to-end réel** : parcours complet (ouverture modal → recherche client par code → recherche
   par intitulé → sélection caisse → génération) sans gel perceptible, avant soumission du VERIFY.

## Contraintes

- Ne pas modifier `ReserverLigneAsync`/le rapprochement — cette tâche ne touche que la génération de
  règlement et sa modal.
- Ne pas introduire de nouvelle dépendance externe (pas de librairie combobox tierce) sauf si le PO
  valide explicitement — préférer un composant local simple, cohérent avec le style déjà en place dans le
  projet (pas de `react-select`/`downshift` constaté ailleurs dans `gocom-web/src`).
- Respecter la Clean Architecture (Domain ← Application ← Infrastructure/API).
- Aucun `UPDATE`/`SELECT` SQL brut hors DLL métier.

## Risques / dépendances

- **Cause du 400 non confirmée** : risque de corriger un symptôme (perf) sans traiter la cause réelle si
  elles sont indépendantes — à vérifier explicitement en étape 1 avant de clore la tâche sur ce point.
- **Volume clients non mesuré** : le choix entre filtrage front et recherche serveur dépend d'une donnée
  non encore connue — ne pas décider avant l'étape 2.
- **Libellé du titre modal** (« Générer un règlement (Versement) ») : périmètre ambigu, à confirmer avec
  le PO avant de le modifier (cf. point 3 ci-dessus).

## Checklist VALIDATION (à remplir dans VERIFY/)

- [ ] Cause exacte du 400 reproduite et documentée (message d'erreur réel, pas une supposition)
- [ ] 400 corrigé, testé en base réelle sur le cas qui échouait précédemment
- [ ] Volume réel de clients mesuré et documenté dans le VERIFY
- [ ] Sélection client remplacée par un combobox unique (un seul champ), recherche par code **et**
      intitulé fonctionnelle, résultats bornés
- [ ] Plus de gel de l'écran constaté à l'usage (client et caisse), testé manuellement sur un jeu de
      données représentatif du volume réel
- [ ] Libellés `(12)` et `MV_Reference` retirés de l'affichage utilisateur
- [ ] Build back + front OK (0 erreur)
- [ ] Aucune régression sur la génération de règlement elle-même (mapping des 36 paramètres, droits
      caisse, numérotation officielle — hérités de TASK-060, non touchés par cette tâche)
- [ ] Parcours complet testé manuellement de bout en bout avant soumission du VERIFY
