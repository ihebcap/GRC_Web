# TASK-080 — ApercuComptabilisation : filtre "Au" (dateFin) exclut les règlements du dernier jour après minuit

- **Priorité** : 🟠 Majeur
- **Domaine** : Correction (Front)
- **Statut** : TODO
- **Dépend de** : —

## Contexte

Audit architecte du 2026-09-24 (audit filtres, passage complémentaire sur `ApercuComptabilisation.tsx`).
Rappel métier important, à garder en tête pour cette TASK et pour tout filtre de date similaire dans
le projet : **côté utilisateur, un filtre de date se raisonne toujours en jour calendaire, jamais en
heure** — même si les données sous-jacentes (`RT_MOUVEMENT.MV_Date` etc.) sont des `DateTime` complets
avec une heure. Quand le client choisit "Au = 24/09/2026", il attend que **toute la journée** du
24/09/2026 soit incluse, y compris un règlement saisi à 23h59, pas seulement les enregistrements
antérieurs à minuit pile. C'est exactement le principe déjà appliqué et validé sur `App.tsx` (voir
ci-dessous) — cette TASK ne fait qu'aligner un écran qui a été oublié lors de cette correction.

## Problème constaté

`gocom-web/src/ApercuComptabilisation.tsx` :

- Ligne ~174 : `const [dateFin, setDateFin] = useState(() => new Date().toISOString().split('T')[0]);`
  — format `YYYY-MM-DD` pur, sans heure.
- Ligne ~222 (`handleSimuler`), l'appel `axios.get` envoie `dateFin` **tel quel**, sans aucune
  correction d'heure de fin de journée.

Comparaison avec `gocom-web/src/App.tsx:510` :
```js
if (to) params.dateFin = to + 'T23:59:59'; // borne "Au" inclusive (fin de journée)
```
Cette correction existe déjà sur `App.tsx` (et sur `RapprochementBancaire.tsx`, lignes ~473/598) mais
n'a jamais été répliquée sur `ApercuComptabilisation.tsx`.

**Conséquence** : `dateFin` arrive au backend comme minuit (`00:00:00`) du jour choisi. Le repository
sous-jacent (`ReglementClientRepository.GetAll`, hors périmètre de ce dépôt Git, DLL `Tresorerie.Dapper`)
applique un `BETWEEN @DateDebut AND @DateFin` — tout enregistrement du jour "Au" avec une heure
postérieure à minuit est donc exclu.

**Scénario concret** : un utilisateur choisit "Au = 24/09/2026" pour simuler la comptabilisation du
jour. Un règlement encaissé le 24/09/2026 à 14h30 est **exclu silencieusement** de la simulation
(aucune erreur, le règlement manque juste), alors que le même règlement apparaîtrait normalement dans
la grille principale (`App.tsx`) avec le même filtre "Au = 24/09/2026" grâce à la correction déjà en
place là-bas. Incohérence de périmètre entre deux écrans qui affichent pourtant la même notion de
date à l'utilisateur.

## Objectif

Le filtre "Au" de `ApercuComptabilisation.tsx` doit inclure l'intégralité de la journée choisie,
quelle que soit l'heure des enregistrements ce jour-là — cohérent avec le comportement déjà en place
sur `App.tsx`/`RapprochementBancaire.tsx`. L'utilisateur ne doit jamais avoir à deviner qu'un
règlement de fin de journée pourrait manquer selon l'écran utilisé.

## Fichiers concernés

- `gocom-web/src/ApercuComptabilisation.tsx` (`handleSimuler`, éventuellement `handleSimulerPreselection`
  si elle utilise aussi `dateFin` — à vérifier, un audit précédent indique qu'elle ne l'utilise pas
  actuellement, mais reconfirmer avant de conclure)

## Étapes d'implémentation

1. Dans `handleSimuler`, appliquer le même correctif que `App.tsx:510` : envoyer
   `dateFin ? dateFin + 'T23:59:59' : dateFin` (ou équivalent) au lieu de `dateFin` brut.
2. Vérifier qu'aucun autre point d'appel de cet écran n'envoie `dateFin` sans cette correction
   (grep sur `dateFin` dans le fichier).
3. Ne pas toucher au state `dateFin` lui-même (reste au format `YYYY-MM-DD`, cohérent avec l'input
   `<input type="date">`) — la correction se fait uniquement au moment de la construction des
   paramètres de la requête, pas sur l'affichage ni la saisie.
4. Ne pas propager cette correction à d'autres écrans dans cette TASK — si un autre filtre de date
   du projet a le même défaut, le signaler à l'architecte plutôt que de l'corriger ici sans review.

## Contraintes

- Ne jamais bypasser une règle de sécurité ou une DLL métier GRC.
- **Le filtre doit rester un filtre par jour calendaire pour l'utilisateur** : ne changez jamais le
  type de l'input (`<input type="date">`) ni le format affiché — la correction est strictement
  interne (ajout de l'heure de fin de journée avant l'envoi réseau), invisible pour l'utilisateur.
- Ne pas modifier le comportement de `dateDebut` (déjà correct, une borne de début à minuit est
  cohérente avec "à partir du jour choisi").
- Ne pas modifier `App.tsx`/`RapprochementBancaire.tsx` (déjà corrects) dans cette TASK.

## Checklist VALIDATION (à remplir dans VERIFY/)
- [ ] Build OK
- [ ] Test réel : un règlement daté du jour choisi comme "Au", avec une heure postérieure à minuit,
  apparaît bien dans la simulation d'aperçu de comptabilisation après le correctif (comparer avant/
  après sur un cas réel ou reconstitué)
- [ ] Non-régression : un règlement antérieur à `dateDebut` ou postérieur au jour "Au" (lendemain)
  reste bien exclu — la borne ne doit pas devenir trop large
- [ ] Non-régression : `handleSimulerPreselection` (mode par IDs, sans dateDebut/dateFin) non affecté
- [ ] Cohérence confirmée avec `App.tsx` : un même filtre "Au = <date>" sur les deux écrans retourne
  désormais le même périmètre de règlements pour cette date
- [ ] Aucune dette technique silencieuse
- [ ] Cohérent avec l'architecture
