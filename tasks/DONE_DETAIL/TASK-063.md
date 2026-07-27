# TASK-063 — Écran génération règlements espèce : uniformiser tous les filtres en mode liste (comme Code Client)

Status: DONE
Priority: MEDIUM
Risk: LOW
Module: Front (`gocom-web/src/ReglementGenerationEspece.tsx`, `ExcelFilter.tsx`)

## OBJECTIF

Retour PO (2026-07-20, post-livraison TASK-062) : sur l'écran de génération de règlements espèce, les
colonnes `N° Facture` et `Info 3` (type `text` actuellement) ne proposent aucune valeur dans le popover
de filtre et le filtre ne fonctionne pas comme attendu. **PO confirme le périmètre réel** : toutes les
colonnes du tableau doivent proposer le même comportement de filtre que la colonne `Code Client` — une
liste de valeurs uniques à cocher (avec recherche intégrée), pas un champ de saisie texte libre ni une
plage min/max.

Colonnes concernées par le changement de type de filtre (`text`/`number`/`date` → `list`) :
`factureNumero`, `dateFacture`, `dateEcheance`, `montant`, `solde`, `commentaire`, `info1`, `info2`,
`info3`, `info4`.
Colonnes déjà en `list`, inchangées : `clientCode`, `clientIntitule`, `representant`.

## BUSINESS VALUE

Cohérence UX sur tout l'écran — le PO ne doit pas avoir à deviner que certaines colonnes filtrent
différemment des autres. Réduit aussi le risque de filtre perçu comme « cassé » alors qu'il s'agit d'un
type de filtre différent non voulu par le PO.

## CONTRAINTES

- Réutiliser le composant `ExcelFilter.tsx` existant et son mode `list` déjà en place (pattern
  `getOptions`/`filters[key].value` déjà utilisé par `clientCode`/`clientIntitule`/`representant`) — pas
  de nouveau composant de filtre inventé.
- `montant`/`solde`/`dateFacture`/`dateEcheance` en mode liste peuvent avoir une forte cardinalité
  (jusqu'à ~2127 valeurs uniques) : le mode `list` de `ExcelFilter` gère déjà une recherche texte dans le
  popover et un plafond d'affichage (200 résultats + compteur), donc utilisable tel quel — mais **valider
  à l'usage réel avec le PO** que ce n'est pas plus pénible qu'une plage min/max pour `montant`/`solde`
  et un `Du~Au` pour les dates. Si le PO juge le mode liste inutilisable sur ces 4 colonnes précises après
  test réel, documenter l'écart dans le VERIFY et proposer de les garder en `number`/`date` — ne pas
  décider seul, trancher avec le PO avant de livrer si ambiguïté.
- La logique de filtrage `filteredFactures` (mode `list` : `filter.value.includes(val)`) fonctionne déjà
  pour les colonnes `list` existantes — aucune modification attendue de cette logique, seul `ALL_COLUMNS`
  (`filterType`) et les props passées à `ExcelFilter` (`options`/`selectedValues` au lieu de `textValue`)
  changent pour les colonnes concernées.
- Respecter le pattern `getOptions(key)` déjà en place (`Array.from(new Set(...))`, tri, libellé
  `(Vide)` pour valeur vide) — pas de logique de calcul de valeurs uniques dupliquée.

## FILES

- `gocom-web/src/ReglementGenerationEspece.tsx` — `ALL_COLUMNS` (changement `filterType` pour les 10
  colonnes listées), rendu `<ExcelFilter>` (props `options`/`selectedValues`/`textValue` déjà
  conditionnées sur `col.filterType === 'list'`, aucun changement de structure attendu si `filterType`
  passe à `'list'` pour ces clés).
- `gocom-web/src/ExcelFilter.tsx` — a priori aucun changement de code nécessaire (le mode `list` existe
  déjà et gère la recherche + le plafond d'affichage) ; à vérifier lors de l'implémentation si
  `montant`/`solde` (valeurs numériques formatées) nécessitent un libellé spécifique dans `getOptions`
  (ex. format monétaire) pour rester lisibles dans la liste.

## VALIDATION

- [x] Build back + front OK (0 erreur) — pas de changement backend attendu, à confirmer.
- [x] Les 10 colonnes listées ci-dessus proposent désormais un popover en mode liste (checklist + recherche),
      identique au comportement de `Code Client`.
- [x] Chaque filtre re-testé individuellement sur l'écran réel (pas de régression sur les 3 colonnes déjà
      en liste `clientCode`/`clientIntitule`/`representant`), résultat documenté colonne par colonne dans
      le VERIFY (reprendre le tableau du VERIFY TASK-062).
- [x] Cas `N° Facture`/`Info 3` du retour PO explicitement revérifié : liste de valeurs proposée et filtre
      fonctionnel.
- [x] Avis PO recueilli sur l'utilisabilité du mode liste pour `montant`/`solde`/`dateFacture`/
      `dateEcheance` (cardinalité élevée) — documenté dans le VERIFY, avec décision finale si écart.
- [x] Aucune régression sur la sélection des factures / génération de règlement (logique de filtrage
      `filteredFactures` non modifiée en profondeur).

## ARCHITECTURE RULES APPLICABLES

- Respecter le pattern `ExcelFilter` déjà en place ailleurs dans le projet — pas de nouveau composant de
  filtre inventé (`ARCHITECTURE.md` / historique TASK-062).
- Logique métier interdite dans la couche UI — ce changement reste un ajustement de présentation/filtre,
  aucune logique métier back à toucher.

## NOTES

- Origine : retour PO informel (« numero facture info3 les filtres aucune valeur proposer et le filtre ne
  fonctionne pas »), clarifié par l'architecte : le PO attend que **toutes** les colonnes se comportent
  comme `Code Client` (liste de valeurs, pas de texte libre ni plage).
- Le filtre `text`/`number`/`date` de `ExcelFilter.tsx` n'est pas bugué en soi (logique de filtrage et de
  synchronisation `localText` correctes, cf. corrections TASK-062) — c'est un changement de type de
  filtre demandé, pas un correctif de bug fonctionnel du mode texte.
- Si le mode liste s'avère peu ergonomique sur `montant`/`solde`/dates après test réel PO, ne pas
  improviser un retour en arrière silencieux : consigner l'écart et trancher explicitement avec le PO
  dans le VERIFY, comme pour tout changement de périmètre en cours de tâche.
