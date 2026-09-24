# TASK-078 — Centraliser et corriger `matchAmount` (filtre montant dupliqué, bugs €/négatifs/espaces)

- **Priorité** : 🟠 Majeur
- **Domaine** : Correction (Front)
- **Statut** : TODO
- **Dépend de** : —

## Contexte

Audit architecte du 2026-09-24. La fonction `matchAmount` (filtre montant en texte libre avec
opérateurs `>`, `<`, `>=`, `<=`, `=`) est dupliquée **à l'identique, caractère pour caractère**, à
2 endroits :
- `gocom-web/src/RapprochementBancaire.tsx` (lignes ~898-909), utilisée à 2 endroits du fichier
  (colonnes montant/solde de la grille GRC, colonne credit de la grille Relevé Excel).
- `gocom-web/src/RelevesBancaires.tsx` (lignes ~31-42), utilisée sur les colonnes debit/credit de
  `ReleveInterrogation`.

Soit 3 points d'appel au total pour une seule et même fonction copiée-collée deux fois.

## Problème constaté

Code actuel (identique dans les deux fichiers) :

```js
const matchAmount = (val, filterText) => {
    if (!filterText) return true;
    const cleanFilter = filterText.trim().replace(',', '.');
    const num = parseFloat(cleanFilter.replace(/[^0-9.-]/g, ''));
    if (isNaN(num)) return val.toString().includes(filterText);
    if (cleanFilter.startsWith('>=')) return val >= num;
    if (cleanFilter.startsWith('<=')) return val <= num;
    if (cleanFilter.startsWith('>')) return val > num;
    if (cleanFilter.startsWith('<')) return val < num;
    if (cleanFilter.startsWith('=')) return val === num;
    return val.toString().includes(cleanFilter);
};
```

Bugs confirmés (testés) :
1. **Symbole €** : `matchAmount(1500, "1500€")` → `false`. `num` est bien parsé à `1500`, mais
   aucun préfixe d'opérateur ne matche `"1500€"`, donc le code tombe sur
   `val.toString().includes(cleanFilter)` où `cleanFilter` vaut encore `"1500€"` (le remplacement de
   virgule ne touche pas le symbole €) → `"1500".includes("1500€")` est faux. Un utilisateur qui
   copie-colle un montant affiché avec le symbole € ne retrouve jamais la ligne.
2. **Faux positifs sur les négatifs** : `matchAmount(-500, "500")` → `true` (car
   `(-500).toString()` = `"-500"`, qui contient bien la sous-chaîne `"500"`). Une recherche de
   montants positifs de 500 remonte aussi -500, -1500, -2500, etc.
3. **Espaces non nettoyés selon l'écran** : dans `RapprochementBancaire.tsx`/`RelevesBancaires.tsx`,
   la comparaison finale `val.toString().includes(filterText)` (branche `isNaN(num)`) et les tests
   `cleanFilter.startsWith(...)` n'ont pas de garde supplémentaire contre un espace de tête résiduel
   au-delà du `.trim()` déjà présent en tête de fonction — à vérifier lors de la correction que le
   `.trim()` initial suffit bien dans tous les cas (l'audit a identifié une incohérence avec
   `ReglementGenerationEspece.tsx` qui fait un `.trim()` supplémentaire sur la valeur de filtre à un
   autre endroit de son propre pipeline de filtrage, signe que la garde n'est pas homogène partout
   dans le projet, même si `matchAmount` lui-même a déjà un `.trim()` en tête).

## Objectif

1. Centraliser `matchAmount` dans `gocom-web/src/utils.tsx` (fichier utilitaire partagé existant,
   qui contient déjà `formatDate`/`formatMoney`/`renderSharedCell` consommés par plusieurs écrans),
   et faire pointer les 3 points d'appel dessus via import. Refactor mécanique : les 3 appels
   utilisent déjà la même signature `(val: number, filterText: string) => boolean`, aucune
   divergence de comportement actuelle entre les deux copies.
2. Corriger la fonction centralisée pour gérer : le symbole `€` (et autres symboles monétaires
   éventuels) dans la saisie, les montants négatifs (ne pas faire de faux positif sur un nombre
   positif recherché qui est une sous-chaîne d'un négatif), les espaces (y compris séparateurs de
   milliers dans la saisie, ex. `"1 500"`).

## Fichiers concernés

- `gocom-web/src/utils.tsx` (nouvelle fonction centralisée)
- `gocom-web/src/RapprochementBancaire.tsx` (suppression de la définition locale, import depuis
  utils, 2 points d'appel à vérifier)
- `gocom-web/src/RelevesBancaires.tsx` (suppression de la définition locale, import depuis utils,
  1 point d'appel à vérifier)

## Étapes d'implémentation

1. Créer `matchAmount` dans `utils.tsx`, en conservant la signature et le comportement des
   opérateurs `>`, `<`, `>=`, `<=`, `=` déjà corrects aujourd'hui.
2. Corriger le nettoyage de la saisie : retirer le symbole `€` (et espaces insécables/séparateurs de
   milliers) avant le `parseFloat`, sans casser le parsing des opérateurs préfixés.
3. Corriger la comparaison "positive vs négative" : la branche fallback
   (`val.toString().includes(...)`) ne doit pas considérer qu'une recherche `"500"` matche `-500`
   sauf si l'utilisateur a explicitement inclus le signe `-` dans sa saisie — à traiter comme une
   comparaison numérique explicite plutôt qu'un simple `includes()` sur la représentation texte, dès
   que la saisie est un nombre valide (pas seulement quand elle a un préfixe d'opérateur).
4. Remplacer les 3 définitions locales de `matchAmount` par un import depuis `utils.tsx`. Ne rien
   changer d'autre dans les 3 fichiers appelants.
5. Vérifier qu'aucun appelant ne dépendait d'un comportement de fallback texte différent (aucun cas
   identifié par l'audit, mais à re-confirmer par lecture des 3 points d'appel avant de toucher au
   code).

## Contraintes

- Ne jamais bypasser une règle de sécurité ou une DLL métier GRC.
- Le refactor de centralisation et la correction fonctionnelle sont à livrer ensemble dans cette
  TASK (même fichier de fonction, pas de sens à les séparer), mais tester les deux aspects
  séparément dans la checklist.
- Ne pas modifier le comportement des colonnes qui utilisent un filtre `list`/`number` ailleurs dans
  le projet (App.tsx, ReglementGenerationEspece.tsx) — cette TASK ne touche que les 3 points d'appel
  de `matchAmount` identifiés ci-dessus.
- Respecter `ARCHITECTURE.md` § Grilles de données (ne pas inventer un nouveau composant de filtre).

## Checklist VALIDATION (à remplir dans VERIFY/)
- [ ] Build OK
- [ ] Test réel : filtre montant avec symbole € dans la saisie (ex. `"1500€"`) retrouve la ligne
  correspondante, sur les 3 points d'appel (grille GRC Rapprochement, grille Relevé Excel
  Rapprochement, ReleveInterrogation)
- [ ] Test réel : filtre `"500"` sur une colonne contenant à la fois 500 et -500 ne retourne QUE 500
  (pas de faux positif sur le négatif)
- [ ] Test réel : les opérateurs `>`, `<`, `>=`, `<=`, `=` fonctionnent toujours identiquement
  qu'avant sur les 3 points d'appel
- [ ] Test réel : format décimal virgule française (`"1500,50"`) toujours géré correctement
- [ ] Non-régression : aucune duplication de code restante (grep `matchAmount` ne doit trouver
  qu'une seule définition, dans utils.tsx)
- [ ] Aucune dette technique silencieuse
- [ ] Cohérent avec l'architecture
