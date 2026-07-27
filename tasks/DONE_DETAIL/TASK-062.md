# TASK-062 — Écran génération règlements espèce : 4 corrections UX/données (retour PO post-livraison TASK-059)

- **Priorité** : 🟠 Corrections UX/données sur écran déjà en production (TASK-059)
- **Domaine** : Backend (`ReglementGenerationService.cs`, mapping `MV_Reference`) + Front (écran génération règlements espèce, `gocom-web/src/`)
- **Dépend de** : **TASK-059** (écran et service existants, livrés et clôturés 2026-07-20 — cf. `DONE_DETAIL/TASK-059.md`). **Contredit un point du round 5 de TASK-059** — voir ⚠️ ci-dessous, à trancher avant dev.

## Contexte

Retour PO sur l'écran réel en production (capture d'écran fournie, 89/2127 factures ouvertes affichées, filtre REPRÉSENTANT actif). 4 demandes distinctes.

## ✅ Point tranché — contradiction avec TASK-059 round 5 (confirmé PO 2026-07-20)

TASK-059 (round 5, 2026-07-20) avait corrigé `MV_Reference` pour qu'il prenne `Echeance.Info3`
(`EC_Info3`) avec repli sur `Echeance.DocumentNumero` (`DO_Numero`) si vide — comportement prouvé en base
réelle (`GR_GOCOM`, échéances 27533/27534, règlements 48406/48407).

**PO confirme (2026-07-20) : seul `MV_Reference` passe à vide. `MV_Info3` reste inchangé** (garde
`EC_Info3`+repli `DO_Numero`, comportement round 5 non touché par cette tâche).

- `MV_Reference` (paramètre #23 `reference` de `CaisseManager.ReglementCreate`) → `string.Empty`,
  toujours, quel que soit `EC_Info3`/`DO_Numero`. Annule le comportement round 5 **pour ce seul champ**.
- `MV_Info3` (paramètre #21 `infoLibre3`) → **inchangé**, garde `EC_Info3` avec repli `DO_Numero`.
- Mettre à jour rétroactivement `DONE_DETAIL/TASK-059.md` (section mapping `MV_Reference`) pour que la
  doc n'affirme plus que `MV_Reference = EC_Info3`+repli comme vérité actuelle — noter le remplacement
  par TASK-062.

## Demandes (dans l'ordre de la capture)

### 1. `MV_Reference` doit rester vide
Cf. section ⚠️ ci-dessus. Modifier `ReglementGenerationService.cs` (paramètre #23 `reference` de
`ReglementCreate`) : `string.Empty` au lieu de `referenceVal` (`EC_Info3`/repli `DO_Numero`). Supprimer
la variable `referenceVal` si elle ne sert plus qu'à ça (`infoLibre3Val` reste utilisé pour `MV_Info3`,
sous réserve du point de confirmation ci-dessus).

### 2. Séparer les colonnes Code Client / Intitulé Client
Actuellement la colonne « CLIENT » affiche `CT_Code — CT_Intitule` concaténés dans une seule cellule
(ex. `GRBHA — BANAYADA HABIB`). Le PO demande deux colonnes distinctes, filtrables indépendamment
(pattern `ExcelFilter` déjà en place sur les autres colonnes du tableau). `EcheanceARegleDto` expose déjà
`ClientCode` et `ClientIntitule` séparément (cf. `ReglementGenerationService.cs:67-68`) — changement
**front uniquement**, pas de nouveau champ backend à ajouter.

### 3. Certains filtres Excel ne fonctionnent pas
Le PO ne précise pas lesquels. **Ne pas deviner** : reproduire chaque filtre colonne par colonne sur
l'écran réel (Client, N° Facture, Date Facture, Montant, Représentant, Commentaire, Info3...) avant de
corriger quoi que ce soit, documenter précisément le(s) filtre(s) en défaut et la cause dans le VERIFY.
Point d'attention immédiat : la capture montre le filtre **REPRÉSENTANT actif** (icône bleue) réduisant
`2127 → 89` lignes — si le bug concerne un filtre **texte libre** vs **liste**, vérifier la cohérence du
type de filtre (`list`/`text`/`date`) déclaré par colonne dans `ExcelFilter`, comparé aux colonnes qui
fonctionnent (cf. patron déjà en place dans `RapprochementBancaire.tsx`/`RelevesBancaires.tsx`).

### 4. Réorganisation du layout (cohérence avec l'écran « liste des règlements »)
- Supprimer l'en-tête de bloc « 💳 Génération de règlements espèce » (titre + sous-titre descriptif).
- Déplacer le bloc caisse + bouton « Générer » + compteur factures cochées + total (actuellement en bas
  de l'écran) **en haut**, au même niveau que le titre du tableau (« Factures ouvertes (X / Y) »), pour
  reprendre la disposition de l'écran « liste des règlements » existant (à identifier précisément dans
  `gocom-web/src/` — probablement `App.tsx` ou l'écran de règlements équivalent, à confirmer par lecture
  avant dev plutôt que supposé).
- Le tableau des factures + colonnes filtrables reste inchangé en dessous.

## Fichiers concernés

- `GRC.Infrastructure/Services/ReglementGenerationService.cs` — mapping `reference` (param #23), à
  vérifier aussi si le DTO `EcheanceARegleDto`/résultat a besoin d'ajustement pour l'affichage colonnes
  séparées (a priori non, `ClientCode`/`ClientIntitule` déjà distincts).
- `gocom-web/src/` — composant écran génération règlements espèce (fichier exact à identifier par lecture,
  probablement nommé sur le modèle `ReglementGenerationEspece.tsx`/`.css` déjà présents dans le repo) :
  colonnes séparées, filtres, réorganisation du layout.

## Contraintes

- Ne pas modifier le mapping `MV_Info3` sans confirmation PO explicite (cf. point ⚠️ 1).
- Respecter le pattern `ExcelFilter` déjà en place ailleurs dans le projet — pas de nouveau composant de
  filtre inventé.
- Aucun `UPDATE` SQL brut supplémentaire — le seul déjà en place (`EC_SoldeDevise`, dérogation PO
  TASK-059) reste inchangé, cette tâche ne le touche pas.
- Respecter la Clean Architecture (Domain ← Application ← Infrastructure/API).

## Risques / dépendances

- **Contradiction avec TASK-059 round 5** (cf. ⚠️) — le point le plus risqué de cette tâche : si la
  confirmation PO n'est pas obtenue avant dev, risque de nouveau REJECT en cascade comme sur TASK-059.
- **Filtres en défaut non caractérisés** — periode d'investigation nécessaire avant correctif, pas de
  fix à l'aveugle.
- **Écran de référence layout non identifié avec certitude** — à confirmer par lecture du code avant dev
  (nom exact du composant « liste des règlements » à répliquer).

## Checklist VALIDATION (à remplir dans VERIFY/)

- [x] Confirmation PO obtenue : `MV_Reference` vide, `MV_Info3` inchangé (2026-07-20, avant dev)
- [ ] `MV_Reference` transmis vide (`String.Empty`) à `ReglementCreate`, prouvé en base réelle sur un cas
      de test (`MV_Reference IS NULL` ou `''` selon comportement natif de la colonne)
- [ ] Colonnes Code Client / Intitulé Client séparées et filtrables indépendamment (`ExcelFilter` sur
      chacune)
- [ ] Chaque filtre du tableau (Client, N° Facture, Date Facture, Montant, Représentant, Commentaire,
      Info3, etc.) testé individuellement et fonctionnel — filtre(s) en défaut initialement identifié(s)
      et cause documentée
- [ ] En-tête de bloc retiré, bloc caisse/générer/total déplacé en haut, layout conforme à l'écran liste
      des règlements (capture avant/après fournie dans le VERIFY)
- [ ] Build back + front OK (0 erreur)
- [ ] Aucune régression sur la génération de règlement elle-même (mapping `MV_Info3`, `EC_SoldeDevise`,
      affectation `RT_AFFECTATION`, droits caisse — hérités de TASK-059, non retestés en profondeur mais
      non touchés par cette tâche)
