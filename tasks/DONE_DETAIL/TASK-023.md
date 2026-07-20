# TASK-023 — Afficher le NOM de l'utilisateur réservataire (au lieu de l'ID) à côté du cadenas

- **Priorité** : 🟡 Mineur (UX)
- **Domaine** : UX / Correction
- **Statut** : DONE
- **Dépend de** : TASK-016 (réservation `ReservePar_UserId`)

## Contexte
Quand une ligne de relevé (ou un règlement GRC) est réservée par un autre utilisateur, l'écran affiche un cadenas dont l'infobulle indique `Réservé par l'utilisateur {id}` — soit un **identifiant numérique** brut, illisible pour l'opérateur.
Voir [RapprochementBancaire.tsx:70](../gocom-web/src/RapprochementBancaire.tsx#L70) et [RapprochementBancaire.tsx:137](../gocom-web/src/RapprochementBancaire.tsx#L137).

## Problème constaté
Le nom n'est présent dans **aucune** donnée renvoyée au front : seul `reservePar_UserId` (int) transite. Il faut résoudre `UserId → nom` côté backend, sur **deux flux distincts** qui alimentent chacun un affichage de cadenas :
1. **Règlements GRC** : dictionnaire `reservations` construit dans `ReglementService.GetReglements`, puis `ReglementMapper.Map(...)` → DTO front ([ReglementService.cs:169-194](../GRC.Infrastructure/Services/ReglementService.cs#L169)).
2. **Lignes relevé** : `GetAllLignesExcelAsync` fait `SELECT *` et renvoie l'entité `ReleveBancaireLigne` telle quelle ([ReleveBancaireRepository.cs:106-115](../GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs#L106)).

## Objectif
À côté du cadenas (et dans l'infobulle), afficher **le nom** de l'utilisateur réservataire (ex. `Nom Prénom` ou `Login`), et non l'ID. Si le nom est introuvable, repli sur l'ID (comportement actuel préservé, pas de régression).

## Fichiers concernés
- `GRC.Infrastructure/Services/ReglementService.cs` (flux règlements — dictionnaire réservations)
- `GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs` (`GetAllLignesExcelAsync` — flux lignes relevé)
- `GRC.Domain/Entities/ReleveBancaireLigne.cs` (ajout propriété non persistée `ReservePar_UserName`)
- Mapper/DTO règlement (`ReglementMapper.Map` + le DTO qui porte déjà `reservePar_UserId`) — ajouter `reservePar_UserName`
- `gocom-web/src/RapprochementBancaire.tsx` (2 composants ligne : cadenas + tooltip ; types lignes ~L21/L33)

## Étapes d'implémentation

### 1. Source du nom (table `P_UTILISATEUR`, lecture seule)
Résoudre les IDs via un `SELECT UT_Id, UT_Nom, UT_Prenom, UT_Login FROM P_UTILISATEUR WHERE UT_Id IN @Ids`.
- **Vérifier les noms exacts de colonnes** (`UT_Nom` / `UT_Prenom` / `UT_Login`) contre la base réelle avant de figer la requête — préfixe `UT_` confirmé par `P_UTILISATEURCAISSE.UT_Id` ([Program.cs:107](../GRC.API/Program.cs#L107)) mais les colonnes nom ne sont pas prouvées dans le code.
- Format d'affichage retenu : `Nom + " " + Prenom` avec repli sur `Login`, puis sur l'ID si tout est vide.
- **Lecture seule** : cohérent avec les `SELECT` bruts déjà présents sur `P_SOCIETE` / `P_UTILISATEURCAISSE`. Ne PAS écrire cette table ; ne pas contourner la DLL métier (aucune règle métier concernée ici, simple lookup d'affichage).

### 2. Flux règlements GRC
Dans `GetReglements`, après avoir collecté les `ReservePar_UserId` distincts non nuls, charger un `Dictionary<int,string>` id→nom (une seule requête, réutiliser la connexion déjà ouverte). Propager le nom via `ReglementMapper.Map(...)` → nouveau champ DTO `ReservePar_UserName`.

### 3. Flux lignes relevé
Dans `GetAllLignesExcelAsync`, remplacer le `SELECT *` par une jointure `LEFT JOIN P_UTILISATEUR u ON u.UT_Id = l.ReservePar_UserId` renvoyant en plus une colonne alias `ReservePar_UserName`. Ajouter la propriété `[Computed]`/non persistée `ReservePar_UserName` sur `ReleveBancaireLigne` (ne pas casser l'INSERT existant qui liste les colonnes explicitement — OK, l'INSERT ne l'inclut pas).

### 4. Front
- Étendre les types lignes (~[RapprochementBancaire.tsx:21](../gocom-web/src/RapprochementBancaire.tsx#L21) et [:33](../gocom-web/src/RapprochementBancaire.tsx#L33)) avec `reservePar_UserName?: string | null`.
- Propager le champ dans les `map(...)` de chargement (~L335 et ~L383).
- Aux 2 emplacements du cadenas ([:69-70](../gocom-web/src/RapprochementBancaire.tsx#L69) et [:136-137](../gocom-web/src/RapprochementBancaire.tsx#L136)) : afficher `row.reservePar_UserName ?? row.reservePar_UserId` dans le `title`, **et** rendre le nom en texte à côté de l'icône `<Lock>`.

## Contraintes
- Ne jamais bypasser une règle de sécurité ou une DLL métier GRC. Le lookup nom est une **lecture d'affichage**, pas une opération métier.
- Aucune écriture base ; requête strictement en lecture.
- Respecter la Clean Architecture (Domain ← Application ← Infrastructure/API) : le nom est résolu en Infrastructure, exposé via DTO, jamais de SQL au front.
- Une seule requête de résolution par flux (pas de N+1 : charger tous les IDs distincts d'un coup ; si >2000 IDs, chunker comme TASK-018 — improbable ici mais à garder en tête).
- Repli ID conservé si nom introuvable → pas de régression du comportement actuel.

## Checklist VALIDATION (à remplir dans VERIFY/)
- [x] Build OK
- [x] Ligne relevé réservée par un autre utilisateur : nom affiché à côté du cadenas (pas l'ID)
- [x] Règlement GRC réservé par un autre utilisateur : nom affiché à côté du cadenas (pas l'ID)
- [x] Infobulle (`title`) affiche le nom
- [x] Repli sur l'ID si le nom est introuvable (pas de crash / cadenas sans texte)
- [x] Colonnes `P_UTILISATEUR` vérifiées contre la base réelle
- [x] Lecture seule uniquement ; aucune écriture sur `P_UTILISATEUR`
- [x] Aucune régression réservation/lettrage (TASK-016/017)
- [x] Cohérent avec l'architecture (résolution en Infrastructure, pas de SQL au front)
