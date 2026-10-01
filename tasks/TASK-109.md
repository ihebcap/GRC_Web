# TASK-109 — Harmonisation des barres de titre de tous les écrans (modèle : Comptabilisation)

- **Priorité** : 🟡 Mineur
- **Domaine** : Architecture (UI)
- **Statut** : TODO
- **Dépend de** : TASK-107 (même fichier `ReglementGenerationEspece.tsx` : ne pas lancer en parallèle)

## Contexte
Demande PO (2026-10-01) : le titre/en-tête de toutes les fenêtres doit être cohérent, **le modèle de l'écran Comptabilisation est le meilleur** (police et barre compacte). Point de départ : capture de l'écran Règlement espèce (« Factures ouvertes (272 / 30211) », titre plus gros que les autres écrans).

## Problème constaté (lecture du code, 2026-10-01)
Quatre styles de titre coexistent :
| Écran | En-tête actuel | Style |
|---|---|---|
| Comptabilisation (`ApercuComptabilisation.tsx:294-338`) — **modèle** | `.apercu-toolbar` + `.apercu-toolbar-title` (`ApercuComptabilisation.css:3-25`) | barre blanche compacte, bordure `#e2e8f0`, rayon 10px, titre **12.5px / 600**, contrôles et boutons 12.5px, hauteur 31px |
| Règlements Clients (`App.tsx:1006-1008`) | `.table-header-wrapper` + `.table-title` (`index.css:295-308`) | **1.125rem / 500**, fond `--bg-secondary` |
| Règlement espèce (`ReglementGenerationEspece.tsx:337-339`, aussi l.491-492) | idem, avec styles inline | 1.125rem / 500 |
| Relevés bancaires (`RelevesBancaires.tsx:342-344`) | idem | 1.125rem / 500 |
| Rapprochement (`RapprochementBancaire.tsx:1408-1409`) | `.rappro-toolbar` + `.rappro-title` (`RapprochementBancaire.css:11-30`) | **0.95rem / 500** |

Aussi : compteur « 272 / 30211 » sans séparateur de milliers, libellés de titre sans convention commune.

## Objectif
Tous les écrans partagent la **même barre de titre** (même police, taille, graisse, hauteur, espacement, style des boutons/sélecteurs d'en-tête), calquée sur l'écran Comptabilisation, sans régression fonctionnelle.

## Fichiers concernés
- `gocom-web/src/index.css` (classes partagées)
- `gocom-web/src/ApercuComptabilisation.tsx` / `.css` (référence : ne doit pas changer d'aspect)
- `gocom-web/src/App.tsx` (Règlements Clients), `ReglementGenerationEspece.tsx`, `RelevesBancaires.tsx`, `RapprochementBancaire.tsx` / `.css`

## Étapes d'implémentation
1. Extraire du modèle Comptabilisation des classes **partagées** dans `index.css` (ex. barre, titre, groupe, actions, select, date, bouton, compteur) en reprenant **exactement** les valeurs de `ApercuComptabilisation.css:3-110` ; faire pointer l'écran Comptabilisation vers ces classes **sans changement visuel** (comparaison capture avant/après).
2. Migrer chaque écran (tableau ci-dessus) vers ces classes ; retirer les styles inline et classes devenues mortes (`.rappro-title`, `.rappro-toolbar` si redondants, usage de `.table-title` pour les titres d'écran).
3. **Convention de libellé** (proposition, à valider PO) : titre en une expression nominale courte, majuscule initiale uniquement (« Règlements clients », « Rapprochement bancaire », « Relevés bancaires », « Règlement espèce » / « Factures ouvertes »), compteur à part dans la barre, avec séparateur de milliers (`toLocaleString('fr-FR')`) : « 272 / 30 211 ».
4. Respecter la hiérarchie : le titre d'écran dans la barre ; les titres de cartes secondaires (ex. « Résultat — 1 règlement par facture », modales) sont **hors périmètre** sauf incohérence flagrante de police.
5. Vérifier chaque écran en largeur réduite (la barre Comptabilisation est `nowrap` : s'assurer qu'aucun écran ne déborde, notamment Rapprochement qui contient plus de contrôles).

## Contraintes
- Ne rien changer à la logique métier ni aux appels API.
- Respecter `ARCHITECTURE.md` § Grilles de données ; ne pas inventer de composant si une classe CSS partagée suffit.
- Aucune régression sur les écrans non cités (modales, login, écran de licence).
- À livrer **après** TASK-107 pour éviter les conflits sur `ReglementGenerationEspece.tsx`.

## Checklist VALIDATION (à remplir dans VERIFY/)
- [ ] Build OK
- [ ] Captures avant/après des 5 écrans (Comptabilisation identique à l'avant)
- [ ] Même police/taille/graisse/hauteur de barre sur les 5 écrans (mesure DevTools datée)
- [ ] Compteur avec séparateur de milliers
- [ ] Aucun débordement horizontal de la barre en largeur réduite
- [ ] Aucun credential/secret en dur introduit
- [ ] Aucune dette technique silencieuse (CSS mort supprimé)
- [ ] Cohérent avec l'architecture
