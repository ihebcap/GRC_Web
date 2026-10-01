# TASK-102 — Rapprochement : filtres de date non fonctionnels (Relevé) + vérification côté Règlements GRC

- **Priorité** : 🟠 Majeur
- **Domaine** : Correction (front)
- **Statut** : DONE
- **Dépend de** : —

## Contexte
Remarque PO (2026-09-30) : le filtre de date ne fonctionne pas sur la partie Relevé bancaire ;
à vérifier aussi sur les règlements.

## Problème constaté (lecture de code, 2026-09-30)
**Relevé** (`RapprochementBancaire.tsx` ~l.1247-1254, filtre ~l.1053-1070)
- Les colonnes « Date Op. » / « Date Val. » utilisent `ExcelFilter` en mode `text`, comparé par
  `includes()` à `new Date(...).toLocaleDateString()` (chaîne dépendante de la locale du navigateur :
  « 30/09/2026 » ou « 9/30/2026 »). Saisir une date, une plage ou « 2026-09 » ne donne rien de fiable.
- La barre « Du / Au / Actualiser » (~l.1315-1330) n'existe que dans l'en-tête de la grille GRC ;
  **aucun filtre de période sur le Relevé**, et `GET /ReleveBancaire/{id}/lignes` ne reçoit aucune date.
**Règlements GRC** (~l.1032-1048, colonne `date` en `isText`)
- Même défaut : filtre `text` sur `formatDate(r.date)`. Le « Du / Au » de l'en-tête ne s'applique
  qu'après clic sur **Actualiser** (mécanisme voulu, TASK-077/080) — peut être perçu comme « non
  fonctionnel » si l'utilisateur ne clique pas. **Cause côté GRC non confirmée par lecture seule :
  à reproduire dans le navigateur avant de conclure** (voir étape 1).

## Objectif
- Filtre de colonne « Date Op. » et « Date Val. » (Relevé) et « Date » (GRC) en **plage Du/Au**
  (`filterType: 'date'` d'`ExcelFilter`, valeur `"min~max"` au format `yyyy-mm-dd`), comparaison
  sur la **date brute `yyyy-mm-dd`** (`dateOperationRaw.slice(0,10)`, `r.date.slice(0,10)`) — pas
  sur la chaîne localisée, pas de `new Date()` (évite les décalages de fuseau). Modèle exact :
  `ReglementGenerationEspece.tsx:186-190` et `App.tsx` (TASK-089).
- Le tri chronologique existant reste inchangé (TASK-077).
- Les lignes Relevé sans date valide sont exclues quand un bornage est actif (comme la ligne 187 du
  modèle).

## Étapes d'implémentation
1. **Reproduire d'abord** dans le navigateur (onglet réseau) : (a) filtre colonne date GRC,
   (b) « Du/Au » + Actualiser, et noter le résultat dans le VERIFY. Si un défaut backend est trouvé
   (`dateFin`, borne exclusive, fuseau), le signaler avant de le corriger.
2. Passer `dateOperation`, `dateValeur` (Relevé) et `date` (GRC) de `text` à `date`.
3. Adapter les blocs de filtrage `filteredLignes` / `filteredReglements` sur le modèle cité.
4. `getReleveFilterOptions` (l.1143) et `isText` (`['date','montant','solde']`) ajustés en conséquence.
5. Vérifier que l'export (TASK-101) et l'auto-reconcile ne dépendent pas de l'ancienne chaîne.

## Question PO (non bloquante — défaut retenu : filtre par colonne uniquement)
Souhaitez-vous **aussi** une barre « Du / Au » globale sur le bloc Relevé, comme sur le bloc GRC ?
Sans réponse, on ne l'ajoute pas (les lignes d'un relevé importé sont déjà bornées par le relevé).

## Contraintes
- Ne jamais bypasser une règle de sécurité ou une DLL métier GRC.
- Réutiliser `ExcelFilter.tsx` (mode `date` existant), aucun nouveau composant.
- Pas de régression sur `matchAmount` (colonnes montant inchangées).

## Checklist VALIDATION (à remplir dans VERIFY/, preuve datée par critère)
- [ ] Build OK + lint
- [ ] Relevé : plage Du seul, Au seul, Du+Au → lignes attendues (jeu de test réel)
- [ ] GRC : idem sur la colonne Date ; comportement Du/Au + Actualiser documenté après reproduction
- [ ] Tri chronologique inchangé (non-régression TASK-077)
- [ ] Aucun credential/secret en dur introduit
- [ ] Aucune dette technique silencieuse
- [ ] Cohérent avec l'architecture
