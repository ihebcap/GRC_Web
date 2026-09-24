# TASK-077 — Filtre "date" cassé sur la grille GRC de Rapprochement Bancaire (comparaison ISO brut vs affiché)

- **Priorité** : 🟠 Majeur
- **Domaine** : Correction (Front)
- **Statut** : TODO
- **Dépend de** : —

## Contexte

Audit architecte du 2026-09-24 (confirmé indépendamment par 3 passages d'analyse distincts,
y compris une vérification adversariale). La grille "Règlements GRC" de l'écran Rapprochement
Bancaire affiche la colonne "Date" formatée en `jj/mm/aaaa`, mais son filtre compare la saisie
utilisateur contre la valeur ISO brute renvoyée par l'API — le filtre ne fonctionne donc jamais en
usage normal.

## Problème constaté

`gocom-web/src/RapprochementBancaire.tsx` :

- Ligne ~1255 : `const isText = ['date', 'montant', 'solde'].includes(colKey);` → la colonne `date`
  est déclarée `filterType: 'text'` (champ libre), le picker Du/Au natif d'`ExcelFilter` n'est jamais
  utilisé pour cette colonne dans cette grille.
- Ligne ~911-935, fonction `getGrcCellValue` : aucune branche `if (key === 'date')`. La clé tombe
  dans le fallback générique `return r[key as keyof typeof r]`, qui renvoie `r.date` brut (chaîne
  ISO, ex. `"2026-09-24T00:00:00"`).
- Ligne ~963, logique de filtrage `filteredReglements` : la comparaison se fait sur
  `val.toString().toLowerCase().includes(filter.value.toLowerCase())`, où `val` est la valeur ISO
  brute ci-dessus.
- Affichage réel de la cellule (`gocom-web/src/utils.tsx:78`, `renderSharedCell`) :
  `case 'date': return formatDate(reg.date);` → `formatDate` (utils.tsx:29-34) rend `jj/mm/aaaa`.

**Exemple concret** : l'utilisateur voit `24/09/2026` affiché, tape `24/09` ou `24/09/2026` dans le
filtre → 0 résultat, car `"2026-09-24t00:00:00".includes("24/09")` est faux. Seule une saisie au
format ISO exact (non affiché nulle part) fonctionnerait.

**Contre-exemple qui prouve que le bug est isolé** (à utiliser comme test de non-régression) : sur
la même grille, le filtre "Montant" (comparaison déjà cohérente avec l'affichage) et le filtre
"Mode" (type liste) fonctionnent correctement pour une valeur copiée depuis l'écran.

**Point de vigilance CRITIQUE pour le correctif** (identifié par analyse d'impact dédiée) : la même
fonction `getGrcCellValue` est aussi utilisée pour le **tri** de colonne (`sortedReglements`, lignes
~995-996). Aujourd'hui, le tri sur "date" fonctionne correctement *par accident* : une comparaison
de chaînes ISO (`2026-09-24...`) reste chronologiquement correcte car le format est homogène. **Si
le correctif se contente d'ajouter `return formatDate(r.date)` dans `getGrcCellValue` pour la clé
`date`, le tri passera insidieusement d'un tri chronologique à un tri alphabétique sur
`jj/mm/aaaa`** (ex. "05/01/2026" serait classé avant "12/12/2025", ce qui est faux
chronologiquement). Le correctif doit impérativement séparer la valeur utilisée pour le TRI (garder
l'ISO brut ou un timestamp) de la valeur utilisée pour le FILTRAGE (formatée, alignée sur
l'affichage) — ne jamais faire dépendre les deux du même retour de fonction sans distinction.

Également à vérifier : `grcFilterOptionsMap` (ligne ~1030) exclut déjà explicitement `date` du calcul
des options de filtre-liste (`if (key === 'date' || ...) { map[key] = undefined; continue; }`) —
ce garde-fou existant ne doit pas être cassé par le correctif.

## Objectif

Le filtre "Date" de la grille GRC (Rapprochement Bancaire) doit matcher sur la valeur réellement
affichée à l'écran (`jj/mm/aaaa`), sans dégrader le tri chronologique de la même colonne.

## Fichiers concernés

- `gocom-web/src/RapprochementBancaire.tsx` (`getGrcCellValue`, `filteredReglements`,
  `sortedReglements`, `grcFilterOptionsMap`, déclaration `isText`)

## Étapes d'implémentation

1. Distinguer clairement dans le code la valeur utilisée pour le tri (chronologique, garder l'ISO
   ou un timestamp numérique) de la valeur utilisée pour le filtrage/l'affichage (formatée
   `jj/mm/aaaa`, cohérente avec `renderSharedCell`/`formatDate`).
2. Deux pistes possibles (à choisir selon ce qui s'intègre le mieux au code existant, sans
   sur-ingénierie) :
   - (a) Ajouter une fonction de filtrage dédiée pour la clé `date` qui appelle `formatDate` en
     interne, sans toucher à ce que `sortedReglements` utilise pour le tri.
   - (b) Garder `getGrcCellValue` inchangée pour le tri, et n'appliquer `formatDate` que dans le
     bloc de comparaison du filtre texte (`filteredReglements`), spécifiquement pour `key ===
     'date'`.
3. Ne pas activer le `filterType: 'date'` (picker Du/Au) sans validation explicite du PO/architecte
   au VERIFY — cela changerait l'UX de saisie (voir note ARCHITECTURE.md ci-dessous), ce n'est pas
   l'objet minimal de cette correction.
4. Vérifier que `grcFilterOptionsMap` (exclusion de `date` du calcul d'options liste) n'est pas
   affecté par le changement.

## Contraintes

- Ne jamais bypasser une règle de sécurité ou une DLL métier GRC.
- **Ne pas casser le tri chronologique de la colonne Date** — c'est le risque de régression principal
  identifié pour cette TASK, à tester explicitement (voir checklist).
- Ne pas modifier le comportement des filtres Montant/Solde/Mode/Caisse de la même grille.
- Note pour le VERIFY : ce filtre `text` sur une colonne date est une dérogation au standard `list`
  décrit dans `ARCHITECTURE.md` § Grilles de données, mais ce fichier est antérieur à cette règle
  (créé au commit initial du projet, règle ajoutée ultérieurement) — ne pas migrer vers `list` dans
  cette TASK, se contenter de corriger le bug de comparaison. Si le PO souhaite profiter de cette
  TASK pour re-questionner le choix de filterType, le documenter séparément.

## Checklist VALIDATION (à remplir dans VERIFY/)
- [ ] Build OK
- [ ] Test réel : filtrer sur une date affichée (`jj/mm/aaaa` complet) retrouve bien la ligne
  correspondante
- [ ] Test réel : filtrer sur une date partielle (`jj/mm`) retrouve bien les lignes du bon jour/mois
- [ ] **Test de non-régression critique** : le tri (croissant et décroissant) de la colonne Date
  reste chronologiquement correct après le correctif (pas de bascule en tri alphabétique) — vérifier
  avec au moins 2 dates dans des mois/années différents dont l'ordre alphabétique et chronologique
  divergent (ex. 05/01/2026 vs 12/12/2025)
- [ ] Non-régression : filtres Montant, Solde, Mode, Caisse de la même grille toujours fonctionnels
- [ ] Non-régression : filtres combinés (Date + un autre filtre) toujours en ET logique
- [ ] Aucune dette technique silencieuse
- [ ] Cohérent avec l'architecture
