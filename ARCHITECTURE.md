# ARCHITECTURE.md — Conventions transverses GRC_WEB

## Grilles de données (tableaux avec filtres)

Toute nouvelle grille de données tabulaires (factures, règlements, relevés, écritures...)
DOIT réutiliser le pattern existant, validé sur `ReglementGenerationEspece.tsx` (TASK-059/062/063) :

- **Filtre par colonne** : composant `gocom-web/src/ExcelFilter.tsx`, mode `list` par défaut
  (checklist de valeurs uniques + recherche intégrée), pas de champ texte libre ni de plage
  min/max sauf dérogation explicite du PO documentée dans le VERIFY.
- **Config colonnes** : tableau `ColumnDef[]` (`key`, `label`, `filterType`, `defaultVisible`)
  suivant le modèle `ALL_COLUMNS` de `ReglementGenerationEspece.tsx:50-64`.
- **Valeurs uniques** : `getOptions(key)` — `Array.from(new Set(...))`, trié, libellé `(Vide)`
  pour valeur vide. Ne pas dupliquer cette logique.
- **Choix des colonnes affichées** : persistance `localStorage`, une clé dédiée par écran
  (ex. `gocom_reglement_espece_columns`), pattern `ReglementGenerationEspece.tsx:66,84-119`.

**Interdit** : inventer un nouveau composant de filtre, un nouveau mécanisme de persistance
colonnes, ou un filtre texte/plage sans accord PO préalable.

**Écarts actés** : si le PO juge le mode `list` inutilisable sur une colonne à forte
cardinalité (montant, date), documenter l'écart dans le VERIFY — ne pas revenir en arrière
silencieusement (cf. TASK-063).

## Sélecteur à cases à cocher

Toute liste déroulante multi-sélection DOIT réutiliser `gocom-web/src/CheckboxDropdown.tsx`
(recherche, « (TOUT SÉLECTIONNER) », prop optionnelle `disabled`) — extrait d'`ApercuComptabilisation`
(TASK-100). **Interdit** d'en inventer un autre (même esprit que § Grilles de données).

## Opérations comptables exclusives

Les endpoints `POST /api/reglements/comptabiliser` et `POST /api/reglements/lettrer-periode` partagent un verrou d'exclusion mutuelle serveur en mémoire (`IComptaExclusiveLock` / `ComptaExclusiveLock`).

### Justification
La DLL Sage d'écriture comptable n'est pas thread-safe : l'attribution des numéros d'écriture (`IEC_ECNO` dans `dbo.F_ECRITUREC`) procède par allocation du prochain numéro puis insertion sans verrou de table. Deux appels concurrents provoquent une collision de clé primaire (`Violation de la contrainte UNIQUE KEY « IEC_ECNO »`) et des échecs d'écriture. De plus, la garde « déjà comptabilisé » étant un *lire-puis-écrire* non atomique, deux requêtes concurrentes sur un même règlement entraîneraient une double comptabilisation.

### Comportement et refus
- Le verrou est non-bloquant : si une opération est déjà en cours, tout nouvel appel est immédiatement rejeté avec le code **HTTP 409 Conflict**.
- Le corps de réponse 409 (`ProblemDetails`) contient un message précis indiquant l'opération en cours, l'heure de lancement, l'identifiant de l'utilisateur ayant posé le verrou, le nombre d'éléments (pour la comptabilisation) et la durée écoulée en minutes.
- Un appel à `comptabiliser` avec une liste vide ou nulle ne pose aucun verrou et ne renvoie jamais de 409.
- Le verrou est libéré dans un bloc `finally` garanti, y compris en cas d'exception, d'erreur d'autorisation (403) ou d'abandon client.

### Limites assumées
- **Périmètre process unique** : Le verrou est géré en mémoire de l'instance `GRC.API`. Il ne protège pas contre des écritures concurrentes effectuées par une session cliente Sage Compta (poste utilisateur), par des jobs SQL Agent externes (ex: « Reglement Inwi »), ou par une éventuelle seconde instance de `GRC.API` connectée à la même base de données.
- **Verrou bloqué (DLL gelée)** : En cas de blocage interne de la DLL Sage (ex: blocage MSDTC), le verrou reste détenu. La durée d'exécution affichée dans le message de refus 409 permet d'identifier l'anomalie. La procédure de déblocage consiste à **redémarrer le service Windows GRC.API** (le verrou étant volatile en mémoire, aucun verrou fantôme ne subsiste en base de données).
