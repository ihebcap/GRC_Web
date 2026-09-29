# TASK-097 — Rendre visible/utilisable le filtre par numéro de règlement (`MV_Numero`)

- **Priorité** : 🟡 Mineur
- **Domaine** : Front (`gocom-web/src/utils.tsx`)
- **Statut** : TODO
- **Dépend de** : —

## ⚠️ Correction post-création (2026-09-29)

**Cette TASK a été réécrite après une erreur factuelle de la 1ère version.** La 1ère version affirmait
que la colonne "N°" (`key: 'no'`) correspondait à `MV_Numero` et qu'il fallait créer un nouveau filtre
sur ce champ. **C'est faux, vérifié en profondeur** (workflow de vérification adversariale à 3
agents indépendants, tous `certain_refute`, dont un par décompilation réelle des DLL `Tresorerie.*`
avec `ilspycmd` et une requête SQL directe sur `RT_MOUVEMENT` en prod) :

- `ReglementClient.No` (colonne affichée "N°", `reg.no`, `utils.tsx:118` → `#{reg.no}`) = **`MV_Id`**,
  la clé technique auto-incrémentée de `RT_MOUVEMENT`. Preuve directe (SQL Dapper décompilé) :
  `SELECT [MV_Id] Id, [MV_No] ErpNo, [MV_Numero] Numero, [MV_Date] Date ... FROM [RT_MOUVEMENT] WHERE
  MV_Domaine = 0 AND SO_Id = @SocieteNo AND CA_IdOut In @CaissesNo`.
- `ReglementClient.Numero` = **`MV_Numero`** (`nvarchar(30)`, numéro métier, souvent préfixé `RC...`,
  vérifié unique par ligne sur 46056 lignes réelles de `RT_MOUVEMENT`, et **non substituable** à
  `MV_Id` — 95,6% des lignes ont une valeur numérique différente entre les deux colonnes).
- Ce champ `Numero` est **déjà exposé** dans `ReglementClientDto.Numero`
  (`GRC.Infrastructure/Services/ReglementService.cs:1503`, mappé ligne 1604), **déjà filtrable**
  côté backend (`GRC.API/Controllers/ReglementController.cs:35` paramètre `numero`,
  `ReglementService.cs:78-81`), et **déjà déclaré côté UI** comme colonne disponible :
  `gocom-web/src/utils.tsx:107` → `{ key: 'numero', label: 'Numéro' }`, avec son `<ExcelFilter>` déjà
  rendu (pas dans la liste d'exclusions de `App.tsx:1339/1363`, qui ne visait que `no`) et ses valeurs
  distinctes déjà remontées par le backend (`distincts.numeros`, `ReglementService.cs:417`).

**Le vrai problème n'est donc pas un filtre manquant, mais un défaut de visibilité** : la colonne
`numero` n'est pas dans `DEFAULT_COLUMNS` (`utils.tsx:15` :
`['no', 'client', 'caisseCode', 'caisseIntitule', 'mode', 'date', 'montant', 'pointe',
'comptabilise']` — `numero` absent). Elle n'apparaît donc pas à l'écran tant que l'utilisateur ne
l'ajoute pas manuellement via le sélecteur de colonnes, ce qui explique l'impression qu'"on ne peut
pas filtrer par numéro de règlement".

## Contexte

Demande PO (2026-09-29) : sur l'écran principal de liste des règlements, impossible de filtrer par
numéro de règlement. Le PO a précisé que la colonne visée en base est `mv_numero` ("normalement
c'est celle-là la colonne qui est affichée").

Or la colonne actuellement affichée par défaut sous le libellé "N°" (`no`) est en réalité `MV_Id`
(clé technique), pas `MV_Numero`. `MV_Numero` correspond à la colonne `numero` (libellé "Numéro"),
qui existe et est fonctionnelle mais n'est pas affichée par défaut.

## Objectif

Rendre le filtre par `MV_Numero` immédiatement disponible pour l'utilisateur, sans qu'il ait besoin
de connaître l'existence du sélecteur de colonnes ni la distinction technique `no`/`numero`.

**Décision PO (2026-09-29) : on garde les deux colonnes.** "N°" (`MV_Id`) reste affichée telle
quelle, "Numéro" (`MV_Numero`) est ajoutée à côté, par défaut, sans rien retirer. C'est l'option A
ci-dessous — validée, à implémenter telle quelle.

- **Option A (retenue)** — Ajouter `'numero'` à `DEFAULT_COLUMNS` (`utils.tsx:15`), pour que la
  colonne "Numéro" (`MV_Numero`) apparaisse par défaut aux côtés de "N°" (`MV_Id`). Changement
  minimal, aucune ambiguïté technique introduite, les deux colonnes coexistent avec des libellés déjà
  distincts.

## Fichiers concernés

- `gocom-web/src/utils.tsx` — `DEFAULT_COLUMNS` (ligne 15), éventuellement `getAvailableColumns`
  (lignes 88-114) selon l'option retenue.

## Étapes d'implémentation

1. Ajouter `'numero'` dans le tableau `DEFAULT_COLUMNS` (`utils.tsx:15`), à la position jugée
   pertinente (ex. juste après `'no'`) — ne pas retirer `'no'`, les deux colonnes coexistent (décision
   PO 2026-09-29).
2. Vérifier que les utilisateurs ayant déjà une préférence de colonnes sauvegardée en `localStorage`
   (clé `gocom_table_columns`, cf. `App.tsx:291-305`) ne sont pas bloqués sur l'ancien jeu de colonnes
   — `DEFAULT_COLUMNS` ne s'applique qu'en absence de préférence sauvegardée, donc les utilisateurs
   existants ne verront PAS la nouvelle colonne apparaître automatiquement. Documenter ce point dans
   le VERIFY et informer le PO : à communiquer aux utilisateurs (ajout manuel via le sélecteur de
   colonnes), ou prévoir une migration de la préférence sauvegardée si le PO veut que ça s'applique
   aussi aux postes déjà configurés.
3. Test réel : vérifier que la colonne "Numéro" apparaît par défaut sur un poste sans préférence
   sauvegardée, que son filtre (`<ExcelFilter>` mode liste) fonctionne, et que le résultat filtré
   correspond bien à `MV_Numero` (comparer avec une valeur connue en base, ex. `RC26070370`).

## Contraintes

- Ne pas toucher au champ `no`/`MV_Id` ni à son filtre (actuellement volontairement exclu du filtre
  dans `App.tsx:1339/1363` — ce point reste hors périmètre de cette TASK, aucune preuve qu'il s'agit
  d'un besoin PO distinct).
- Ne pas dupliquer le mécanisme de filtre existant : `numero` a déjà son `<ExcelFilter>` mode `list`
  et son alimentation backend — aucun nouveau code de filtrage à écrire.
- Respecter `ARCHITECTURE.md` : pas de nouveau composant, pas de nouveau mécanisme de persistance
  colonnes.

## Checklist VALIDATION (à remplir dans VERIFY/)

- [ ] Colonne "Numéro" visible par défaut aux côtés de "N°" (les deux coexistent, aucune supprimée)
  sur un poste sans préférence `localStorage` préexistante
- [ ] Filtre liste sur "Numéro" fonctionnel, valeurs distinctes correctes, résultat filtré vérifié
  contre une valeur réelle de `MV_Numero` en base
- [ ] Impact sur les postes ayant déjà une préférence de colonnes sauvegardée documenté et communiqué
  au PO (pas de changement automatique rétroactif sans action utilisateur, sauf migration explicite
  décidée)
- [ ] Build front 0 erreur
