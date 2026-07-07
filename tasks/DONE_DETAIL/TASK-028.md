# TASK-028 — Écran d'interrogation d'un relevé (remplace le child grid) avec filtres type Excel

- **Priorité** : 🟡 Mineur
- **Domaine** : UX
- **Statut** : DONE
- **Dépend de** : TASK-027 (colonnes Débit/Crédit — à conserver dans le nouvel écran)

## Contexte
Aujourd'hui, la consultation de l'état d'un relevé se fait via une **ligne dépliable**
(child grid) dans [RelevesBancaires.tsx](../gocom-web/src/RelevesBancaires.tsx) :
clic sur un relevé → `ReleveEtatPanel` s'affiche sous la ligne
([RelevesBancaires.tsx:318-324](../gocom-web/src/RelevesBancaires.tsx#L318-L324)).

Le PO juge ce format inadapté sur gros volume (ex. 4 649 lignes) et veut aligner cet écran
sur le reste de l'appli : **un écran séparé d'interrogation**, ouvert au clic sur le nom du
relevé, avec les **filtres type Excel par colonne** déjà en place ailleurs.

## Problème constaté
- Le child grid est étroit (imbriqué dans la grille maître), scroll interne limité à 400px
  ([RelevesBancaires.tsx:79](../gocom-web/src/RelevesBancaires.tsx#L79)).
- Aucun filtre par colonne : seul un filtre global Tous / Traitées / Non traitées existe.
- Incohérent avec les autres listes qui disposent des filtres Excel (`ExcelFilter`).

## Objectif
Au clic sur le **nom du relevé**, basculer vers un **écran plein** d'interrogation de CE relevé :
- En-tête : rappel du relevé (N°, titre, date d'import, importé par) + bouton **Retour** vers la liste.
- Grille des lignes avec **filtres type Excel par colonne** (composant `ExcelFilter` existant),
  reprenant les colonnes actuelles **dont Débit / Crédit** (acquis TASK-027).
- Conserver le compteur « X traitées · Y non traitées » et le filtre statut existant.
- Supprimer le child grid dépliable (plus de ligne extensible).

## Fichiers concernés
- `gocom-web/src/RelevesBancaires.tsx` (navigation liste ↔ détail, nouvel écran)
- *(réutilisation, sans modification)* `gocom-web/src/ExcelFilter.tsx`
- *(référence de pattern, ne pas dupliquer aveuglément)* `gocom-web/src/RapprochementBancaire.tsx`

## Étapes d'implémentation
1. **Navigation par état** (cohérent avec le pattern `currentView` de
   [App.tsx:225](../gocom-web/src/App.tsx#L225), sans router) : ajouter dans `RelevesBancaires`
   un état `selectedReleve: Releve | null`. Si non nul → rendre l'écran détail ; sinon → la liste.
   - Rendre le **nom du relevé** cliquable ([RelevesBancaires.tsx:314](../gocom-web/src/RelevesBancaires.tsx#L314))
     pour poser `selectedReleve` (remplacer le toggle `expandedReleveId`).
2. **Écran détail** : nouveau sous-composant (ex. `ReleveInterrogation`) qui
   - réutilise l'appel existant `GET /ReleveBancaire/{id}/etat` (aucune API nouvelle),
   - affiche l'en-tête relevé + bouton **Retour** (`onClick` → `setSelectedReleve(null)`),
   - affiche la grille avec `ExcelFilter` par colonne.
3. **Filtres Excel** : reprendre le pattern de `RapprochementBancaire` —
   - état `filters: Record<string, {type:'list'|'text', value:any}>`
     ([RapprochementBancaire.tsx:227](../gocom-web/src/RapprochementBancaire.tsx#L227)),
   - `filteredLignes` via `useMemo` appliquant list/text
     ([RapprochementBancaire.tsx:761-778](../gocom-web/src/RapprochementBancaire.tsx#L761-L778)),
   - options de liste construites depuis les valeurs uniques
     ([RapprochementBancaire.tsx:843-846](../gocom-web/src/RapprochementBancaire.tsx#L843-L846)).
   - Colonnes filtrables suggérées : Date Op. (text/date), Libellé (list), Débit (text/number),
     Crédit (text/number), Code (list), Statut (list). Réservé par / Règlement GRC : au choix du worker.
4. **Débit / Crédit** : conserver les deux colonnes issues de TASK-027 (ne pas régresser).
5. Nettoyer le code du child grid devenu inutile (`expandedReleveId`, rendu de la ligne dépliable).

## Contraintes
- Ne jamais bypasser une règle de sécurité ou une DLL métier GRC.
- Respecter la Clean Architecture (Domain ← Application ← Infrastructure/API).
- **Pas de librairie de routing ni de dépendance nouvelle** : navigation par état local, comme l'existant.
- Réutiliser `ExcelFilter` tel quel ; ne pas le réécrire.
- Écran en **lecture seule** (interrogation) : aucune action de rapprochement ici.

## Points ouverts (à trancher à l'implémentation)
- **Volume / perf** : le filtrage est client-side sur potentiellement plusieurs milliers de lignes
  (l'endpoint renvoie tout). C'est le même choix que `RapprochementBancaire` aujourd'hui → acceptable
  pour ce livrable LAN. Si lenteur constatée, noter une TASK de pagination/filtre serveur (ne pas la traiter ici).

## Checklist VALIDATION (à remplir dans VERIFY/)
- [x] Build OK (frontend)
- [x] Clic sur le nom du relevé → écran détail plein ; bouton Retour → liste
- [x] Filtres Excel par colonne fonctionnels (list + text), colonnes Débit/Crédit présentes
- [x] Compteur traitées / non traitées + filtre statut conservés
- [x] Child grid dépliable supprimé, aucun code mort résiduel
- [x] Aucun credential/secret en dur introduit
- [x] Aucune dette technique silencieuse
- [x] Cohérent avec l'architecture
