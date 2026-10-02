# TASK-119 — Comptabilisation : afficher clairement à l'utilisateur ce qui n'est pas passé

- **Priorité** : 🟠 Majeur
- **Domaine** : Correction (UX)
- **Statut** : TODO
- **Dépend de** : — (indépendante de TASK-118 ; le message 409 de TASK-118 s'affichera dans le même panneau)
- **Ordre avec TASK-120** : zones disjointes (TASK-120 = `handleSimuler`, filtres, tableau vide ; TASK-119 = `handleValider`, panneau de résultat, `App.tsx`, back). TASK-120 est plus urgente (comptabilisation hors du mode choisi) et passe en premier. **Les numéros de ligne de `ApercuComptabilisation.tsx` cités ci-dessous datent d'avant TASK-120 et vont bouger : repérer par NOM** (`handleValider`, `resultPanel`, bloc « Panneau persistant des messages métier », `onValidated`).

## En une phrase
Quand une comptabilisation ne passe pas pour certains règlements, l'utilisateur doit voir, **sur un écran qui reste affiché**, un message **compréhensible** qui dit quel règlement n'est pas passé, pourquoi, et quoi faire ; il refera l'opération à la main (décision PO du 2026-10-02 : pas de nouvelle tentative automatique).

## Contexte (faits vérifiés)
1. **Le panneau de détail disparaît dès qu'il y a au moins un succès.** `handleValider` (`gocom-web/src/ApercuComptabilisation.tsx:234-279`) alimente `resultPanel` (l. 248) puis, si `successCount > 0`, appelle `onValidated()` (l. 263-267). Dans `App.tsx`, `handleComptabilisationValidated` (l. 672-679) fait `setCurrentView('reglements')` : le composant `ApercuComptabilisation` est démonté (rendu conditionnel `currentView === 'comptabilisation'`, l. 1015-1016) et **son état `resultPanel` est perdu**. Il ne reste que les toasts, qui disparaissent après **3 s** (`App.tsx:116-120`) ; le dernier toast affiché dit « N erreur(s) rencontrée(s) — voir le détail ci-dessous », alors que **ce détail n'existe plus**. Les 50 échecs du 2026-10-02 (27 + 23) n'ont donc été vus que 3 s, noyés dans un lot de plusieurs milliers.
2. **Message d'échec illisible.** `ReglementService.cs:600` : `errors.Add($"Erreur sur le règlement {id}: {ex.Message}")`. Pour la collision de numéro d'écriture, `ex.Message` est le texte SQL brut : « Violation de la contrainte UNIQUE KEY « IEC_ECNO ». Impossible d'insérer une clé en double dans l'objet « dbo.F_ECRITUREC ». Valeur de clé dupliquée : (514751). L'instruction a été arrêtée. » : incompréhensible pour un utilisateur, sans consigne, et identifie le règlement par son numéro interne.
3. **Avertissements de lettrage : une ligne par règlement, et fausses.** `ReglementService.cs:569-570` ajoute « Règlement {id} comptabilisé, non lettré (affectation partielle ou exercice clôturé). » pour **chaque** règlement dont `LettrerAsync` renvoie `false`. Or la DLL renvoie `false` **toujours** (bug de valeur de retour, voir TASK-118 « Constats connexes » point 2) : 3 453 lignes identiques dans le log du 2026-10-02 12:20. Et pour le verrou de journal tenu par la compta (cas normal), `l. 572-577` ajoute une ligne par règlement (1 709 lignes) avec le texte brut de l'exception.
4. Le panneau actuel (`ApercuComptabilisation.tsx:479-507`) est une zone de 220 px défilante avec les erreurs en rouge puis les avertissements en orange : bon format, mais jamais alimenté de façon exploitable.

## Problème constaté
L'utilisateur ne voit pas, ou ne comprend pas, les règlements qui n'ont pas été comptabilisés, et ne sait pas qu'il doit les relancer.

## Objectif
1. Le résultat d'une comptabilisation reste **visible après le retour à la liste** tant que l'utilisateur ne l'a pas fermé.
2. Les messages sont **en français courant**, identifient le règlement par des repères que l'utilisateur connaît (numéro, client, facture), et disent **quoi faire**.
3. Les avertissements de lettrage sont **regroupés** (une ligne par cause, avec le nombre), jamais une ligne par règlement.
4. Aucune information fausse affichée.

## Contrat de comportement

### Messages (texte exact)
`{libelle}` = `[{Numero}] {ClientIntitule} — facture {FactureNumero}` (si `FactureNumero` est vide : `pièce {MV_Piece}` ; si la ligne de la vue est absente : `règlement {id}`). Les valeurs viennent de `reg.Numero`, `reg.ClientIntitule` et `ReglementComptaViewRow` (`FactureNumero`, `MV_Piece`), déjà chargés dans `Comptabiliser`.

| Cas | Zone | Message exact |
|---|---|---|
| Collision de numéro d'écriture (`SqlException` n° 2627 ou 2601 dont le message contient `IEC_ECNO`) | erreur (rouge), **une ligne par règlement** | `Règlement {libelle} non comptabilisé : une autre écriture a été saisie en même temps dans Sage (collision de numéro). Rien n'a été enregistré pour ce règlement : relancez sa comptabilisation.` |
| Toute autre erreur de comptabilisation | erreur (rouge) | **Inchangé** : `Erreur sur le règlement {id}: {message}` |
| Journal Sage verrouillé pendant le lettrage (`InvalidOperationException` levée par `ThrowIfJournalIsUsed`) | avertissement (orange), **une ligne par journal** | `Journal [{code}] verrouillé dans Sage (utilisé par la compta) : {N} règlement(s) comptabilisé(s) mais non lettré(s). Relancez « Lettrer par période » quand la compta a libéré le journal.` |
| `LettrerAsync` renvoie `false` sans exception | avertissement (orange), **une seule ligne** pour tout le lot | `Lettrage automatique non confirmé pour {N} règlement(s) comptabilisé(s). Vérifiez le lettrage dans Sage ou lancez « Lettrer par période ».` |
| Autre exception de lettrage | avertissement (orange) | **Inchangé** : `Règlement {id} comptabilisé, mais lettrage échoué : {message}` |
| DocNumero non écrits | avertissement (orange) | **Inchangé** |

- Détection du journal verrouillé : `ex is InvalidOperationException` **et** `ex.StackTrace` contient `ThrowIfJournalIsUsed` (plus robuste que le texte, qui vient d'un fichier de ressources) ; le `{code}` est extrait du texte entre crochets (`\[(.+?)\]`), repli : chaîne vide → `Journal verrouillé dans Sage …` sans code.
- Les compteurs (`successCount`, `errorCount`) et les noms de champs de la réponse (`errors`, `docNumeroWarnings`, `lettrageWarnings`) **ne changent pas** ; seul le contenu des tableaux change (`lettrageWarnings` passe de N lignes à quelques lignes).
- Ordre d'affichage (inchangé) : erreurs puis avertissements ; parmi les avertissements : journal verrouillé, lettrage non confirmé, autres lettrage, DocNumero.
- Les logs serveur restent **inchangés** (le texte technique complet y reste, c'est là qu'on le cherche).

### Écran
- Le résultat (erreurs + avertissements + une ligne de synthèse `{successCount} règlement(s) comptabilisé(s), {errorCount} en erreur`) s'affiche dans un **bandeau en haut de la liste des règlements** après le retour, avec le bouton « Fermer ✕ ». Il reste jusqu'à fermeture ou prochaine comptabilisation.
- Le même composant (même rendu rouge/orange) sert au panneau actuel de l'écran d'aperçu, qui continue d'exister quand l'utilisateur ne quitte pas l'écran (erreur HTTP, 409 de TASK-118, aucun succès).
- Aucun bandeau quand il n'y a ni erreur ni avertissement (comportement actuel).
- Le toast d'erreur reste tel quel (3 s) : le bandeau fait foi.

## Fichiers concernés
- `GRC.Infrastructure/Services/ReglementService.cs` — méthode `Comptabiliser` (l. 436-613) : construction des messages ; nouvelles fonctions privées `EstCollisionEcNo`, `EstJournalVerrouille`, `LibelleReglement`.
- `gocom-web/src/ComptaResultPanel.tsx` (nouveau) — composant d'affichage extrait de `ApercuComptabilisation.tsx:479-507`.
- `gocom-web/src/ApercuComptabilisation.tsx` — utiliser le composant ; transmettre le résultat via un nouveau prop `onResult` ; synthèse.
- `gocom-web/src/App.tsx` — état `comptaResult`, prop `onResult`, bandeau en haut de la vue `reglements`.

## Étapes d'implémentation
1. **Back — libellé** : au début de la boucle, déclarer `string libelle = $"règlement {id}";` **avant** le `try` (l. 490-492) pour qu'il soit lisible dans le `catch` (l. 595) ; le mettre à jour une fois `reg` et `viewRow` connus (après l. 510) avec le format du contrat.
2. **Back — collision** : `private static bool EstCollisionEcNo(Exception ex)` : parcourt `ex`, ses `InnerException` et les `AggregateException.InnerExceptions` ; vrai si un `System.Data.SqlClient.SqlException` a `Number` ∈ {2627, 2601} **et** `Message` contient `IEC_ECNO` (les deux conditions). Dans le `catch` final (l. 595-601) : si vrai, `errors.Add(<message exact de collision>)` ; sinon la ligne actuelle. `errorCount++` et le `LogError` (texte technique complet) sont **inchangés**.
3. **Back — lettrage** (l. 552-577) :
   - déclarer avant la boucle : `var lettrageNonConfirme = 0; var journauxVerrouilles = new Dictionary<string,int>();` ;
   - `lettre == false` : `lettrageNonConfirme++` **au lieu** de `lettrageWarnings.Add(...)` (l. 569-570) ;
   - `catch (Exception exLettrage)` : si `EstJournalVerrouille(exLettrage, out var code)` → incrémenter `journauxVerrouilles[code]` et **ne pas** ajouter de ligne ; sinon conserver la ligne actuelle. Le `LogWarning` (l. 574) reste **inchangé**.
   - après la boucle, avant le `return` (l. 604) : ajouter à `lettrageWarnings` d'abord une ligne par journal verrouillé, puis, si `lettrageNonConfirme > 0`, la ligne unique (messages exacts du contrat).
4. **Front — composant** : extraire le JSX des l. 479-507 de `ApercuComptabilisation.tsx` dans `ComptaResultPanel.tsx` (props : `errors`, `warnings`, `summary?: string`, `onClose`). Rendu **identique** (mêmes styles, mêmes icônes, `maxHeight: 220px`, défilement). Ajouter, au-dessus des lignes, `summary` en gras s'il est fourni.
5. **Front — remontée du résultat** : dans `handleValider`, après `setResultPanel(...)` (l. 248), appeler un nouveau prop optionnel `onResult?.({ errors, warnings, summary })` **avant** `onValidated()` (l. 266). Dans `App.tsx` : `const [comptaResult, setComptaResult] = useState<{errors:string[];warnings:string[];summary:string}|null>(null)` ; passer `onResult={setComptaResult}` à `ApercuComptabilisation` (l. 1016) ; rendre `<ComptaResultPanel … onClose={() => setComptaResult(null)} />` en haut de la vue `reglements` (le worker repère le point d'insertion dans le rendu de la liste ; **ne rien changer d'autre** dans cette vue). `onResult` n'est appelé que si `errors.length > 0 || warnings.length > 0`, sinon `setComptaResult(null)`.
6. **Front — état** : ne pas effacer `comptaResult` dans `handleComptabilisationValidated` (sinon le bandeau disparaît aussitôt) ; l'état vit dans `Dashboard` (`App.tsx:285`, composant démonté à la déconnexion : il disparaît tout seul) ; il est remplacé au prochain appel `onResult`.

## Contraintes
- Ne jamais bypasser une règle de sécurité ou une DLL métier GRC ; ne pas modifier la DLL ; ne pas changer la logique de comptabilisation, de lettrage ni les compteurs.
- **Pas de nouvelle tentative automatique** (décision PO).
- Ne pas modifier les noms de champs de la réponse HTTP ni l'ordre erreurs/avertissements.
- Respecter le design existant (mêmes couleurs, `AlertCircle`, styles du panneau actuel) ; pas de nouveau composant inventé hors l'extraction décrite.
- Tests uniquement sur la base de TEST (DESKTOP-2VCUE93), jamais en prod ; identifiants par variables d'environnement.

## Jeu d'essai (base de test)
- 12 règlements espèce non comptabilisés `R1..R12`, journaux non verrouillés.
- **Collision** : un job PowerShell en arrière-plan insère toutes les ~20 ms dans `F_ECRITUREC` de la base de test une ligne factice (`EC_No = MAX(EC_No)+1`, `EC_Intitule = 'TASK119_TEST'`) pendant la comptabilisation, **nettoyée à la fin** (`DELETE … WHERE EC_Intitule = 'TASK119_TEST'`). Au moins une collision doit survenir ; sinon augmenter la fréquence ou la taille du lot.
- **Journal verrouillé** : lire `sp_helptext CB_IsRecordLock` sur la base de test pour identifier la table de verrous Sage, y poser un verrou sur le mouvement du journal VENTES de la période (`F_JMOUV`), puis le retirer en fin de test (ou ouvrir réellement le journal dans Sage sur le poste de test).

## Scénarios (action → résultat attendu → preuve)
- **S1 — nominal.** Comptabiliser `R1..R12` sans perturbation. → comptabilisés ; **une seule** ligne orange « Lettrage automatique non confirmé pour 12 règlement(s)… » (et non 12 lignes), aucune ligne rouge. *Preuve* : capture du bandeau + réponse JSON (`lettrageWarnings.length = 1`).
- **S2 — collision.** Avec le perturbateur. → pour chaque règlement touché : une ligne rouge **exacte** du contrat, avec `[Numero] Client — facture …` ; compteurs `errorCount` inchangés ; le règlement reste non comptabilisé et se comptabilise normalement à la relance. *Preuve* : capture, réponse, relance OK.
- **S3 — retour à la liste.** Lot mixte succès + échecs lancé depuis la sélection de la liste. → après le retour à la liste, le **bandeau reste affiché** avec les lignes ; « Fermer ✕ » le retire ; il ne réapparaît pas tout seul. *Preuve* : captures avant/après fermeture.
- **S4 — journal verrouillé.** Journal VENTES verrouillé pendant le lot. → **une seule** ligne orange `Journal [VENTES] verrouillé dans Sage … {N} règlement(s) … non lettré(s)…` (N = nombre réel), pas N lignes ; le log serveur contient toujours les exceptions détaillées. *Preuve* : capture, réponse, extrait de log.
- **S5 — autres erreurs inchangées.** Règlement d'un exercice clôturé ou sans compte (erreur connue) → ligne rouge au format actuel `Erreur sur le règlement {id}: …`. *Preuve* : capture.
- **S6 — aucun problème.** Lot sans erreur ni avertissement exploitable (lettrage confirmé quand le bug DLL sera corrigé ; d'ici là, vérifier que seule la ligne unique du S1 apparaît) → pas de bandeau d'erreur. *Preuve* : capture.
- **S7 — 409 de TASK-118.** (À jouer si TASK-118 est déployée.) Un second appel pendant une comptabilisation → message de refus affiché dans le panneau de l'écran d'aperçu, écran non quitté. *Preuve* : capture.
- **S8 — non-régression.** `successCount`, `errorCount`, `errors`, `docNumeroWarnings` et les noms de champs identiques avant/après sur un même lot ; panneau de l'écran d'aperçu visuellement identique à l'ancien. *Preuve* : comparaison de réponses + captures.

## Risques et parades
| Risque | Parade |
|---|---|
| Un faux positif « collision » masque une autre contrainte unique | Double condition : numéro 2627/2601 **et** nom `IEC_ECNO` dans le message (étape 2) ; autres erreurs inchangées (S5). |
| Message « lettrage non confirmé » pris pour une erreur | Texte volontairement neutre (« non confirmé », pas « échoué ») ; disparaîtra de lui-même quand la valeur de retour de la DLL sera fiabilisée (TASK à ouvrir). |
| Bandeau qui reste affiché trop longtemps | Fermeture manuelle ; l'état disparaît à la déconnexion (`Dashboard` démonté) et est remplacé à la prochaine comptabilisation. |
| Détection du journal verrouillé par `StackTrace` | Repli : sans correspondance, la ligne actuelle par règlement est conservée (rien n'est perdu) ; test S4. |
| Régression du panneau de l'écran d'aperçu | Extraction à rendu identique ; S8. |

## Mise en production
Back et front ensemble (le front lit les mêmes champs ; un front ancien avec le nouveau back affiche simplement les nouveaux textes dans l'ancien panneau). Aucune migration, aucune configuration. Retour arrière : redéployer le build précédent.

## Idées notées (ne pas faire ici)
- Nouvelle tentative automatique sur collision `IEC_ECNO` : **écartée par le PO le 2026-10-02**.
- Garder les règlements en échec présélectionnés pour une relance en un clic.
- Réduire le bruit des logs (1 709 exceptions complètes pour un même verrou de journal) et ne plus relettrer chaque règlement tant que le journal reste verrouillé : voir TASK-118 « Constats connexes » point 1.

## Checklist VALIDATION (à remplir dans VERIFY/)
Pour chaque case : date + méthode + preuve (capture, réponse, log) ; case non cochée = raison écrite.
- [ ] Build OK (back + front)
- [ ] S1 : une seule ligne de lettrage non confirmé
- [ ] S2 : message de collision exact, règlement relançable
- [ ] S3 : bandeau persistant après retour à la liste, fermable
- [ ] S4 : une ligne par journal verrouillé
- [ ] S5 : autres erreurs inchangées
- [ ] S6 : pas de bandeau sans problème
- [ ] S7 : message 409 affiché (si TASK-118 déployée)
- [ ] S8 : champs et compteurs inchangés, panneau identique
- [ ] Perturbateur et verrou de test nettoyés
- [ ] Aucun credential/secret en dur introduit
- [ ] Aucune dette technique silencieuse
- [ ] Cohérent avec l'architecture

## Go / No-Go
- **Go** : S1 à S6 et S8 verts avec preuves ; compteurs et noms de champs inchangés.
- **No-Go** : le bandeau disparaît après le retour à la liste, ou un message affiche encore le texte SQL brut pour une collision `IEC_ECNO`, ou une ligne de lettrage par règlement réapparaît.
