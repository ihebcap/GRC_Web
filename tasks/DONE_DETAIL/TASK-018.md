# TASK-018 — Chunking de la requête « réservations » (limite 2100 paramètres SQL Server)

- **Priorité** : 🔴 Majeur (plante l'écran règlements sous forte volumétrie)
- **Domaine** : Performance / Robustesse backend
- **Statut** : DONE
- **Dépend de** : TASK-016 (introduction de la requête réservations dans `GetReglements`)

## Contexte
`GET /reglements` lève une `SqlException` **8003** (« La demande entrante contient trop de paramètres. Le serveur en prend en charge au maximum 2100 ») dès que le jeu de règlements filtré dépasse ~2100 lignes.

Cause exacte : dans `ReglementService.GetReglements`, la requête qui charge l'état de réservation utilise `MV_ID IN @Ids` avec la liste complète des identifiants ([ReglementService.cs:173-174](../GRC.Infrastructure/Services/ReglementService.cs#L173-L174)). Dapper développe `IN @Ids` en un paramètre par élément ; au-delà de 2100 IDs, la limite SQL Server est franchie.

Le même risque est **déjà géré** plus bas dans `GetDistinctReglements` par un découpage en chunks ([ReglementService.cs:202-213](../GRC.Infrastructure/Services/ReglementService.cs#L202-L213)) ; la requête réservations n'a pas cette protection.

## Objectif
`GetReglements` fonctionne quelle que soit la volumétrie : la requête réservations est découpée en lots < 2100 paramètres, et le dictionnaire `reservations` est alimenté à l'identique (aucun changement de comportement fonctionnel).

## Fichiers concernés
- `GRC.Infrastructure/Services/ReglementService.cs` ([:168-183](../GRC.Infrastructure/Services/ReglementService.cs#L168-L183))

## Étapes d'implémentation

### 1. Découper `reglementIds` en lots
Dans le bloc `if (reglementIds.Any())`, boucler sur `reglementIds.Chunk(2000)` et exécuter la requête pour chaque lot, en réutilisant **la même connexion ouverte**. Fusionner chaque résultat dans le dictionnaire `reservations` existant.

Forme attendue :
```csharp
foreach (var chunk in reglementIds.Chunk(2000))
{
    var resList = Dapper.SqlMapper.Query(connection, sql, new { Ids = chunk });
    foreach (var row in resList)
        if (row.MV_ID != null)
            reservations[(int)row.MV_ID] =
                ((string?)row.Lettrage, (int?)row.ReservePar_UserId, (DateTime?)row.DateReservation);
}
```

### 2. Nettoyage mineur (optionnel, non bloquant)
`AND MV_ID IS NOT NULL` dans le `WHERE` est redondant (un `MV_ID` NULL ne peut pas figurer dans `@Ids`). Peut être conservé ou retiré — sans impact fonctionnel.

## Contraintes
- **Aucun changement de comportement** : le dictionnaire `reservations` doit être strictement identique à ce qu'il serait sans la limite. La reprise de lettrage/réservation côté front (TASK-016/017) ne doit pas régresser.
- Une seule connexion ouverte pour l'ensemble des lots (ne pas ouvrir une connexion par chunk).
- Taille de lot ≤ 2000 (marge sous la limite 2100 ; laisse de la place aux autres paramètres éventuels).
- Respect Clean Architecture : correction confinée à l'Infrastructure, pas de fuite vers Application/API.
- Aucune écriture base ; requête strictement en lecture.

## Risques / dépendances
- Faible. Correction locale et défensive, alignée sur le pattern déjà utilisé dans `GetDistinctReglements`.
- Vérifier que le tri/ordre final (`allReglements.Select(...)`) reste inchangé — le chunking ne concerne que le remplissage du dictionnaire, pas l'ordre des règlements retournés.

## Checklist VALIDATION (validée sur revue code + build — 2026-07-10)
- [x] Build OK (backend `dotnet build` = 0 erreur)
- [x] `GET /reglements` sur un jeu > 2100 règlements : plus de `SqlException` 8003 (chunking en place)
- [x] Requête réservations exécutée par lots ≤ 2000, une seule connexion — `reglementIds.Chunk(2000)` dans le `using` connexion unique ([ReglementService.cs:187](../GRC.Infrastructure/Services/ReglementService.cs#L187))
- [x] État de réservation/lettrage identique à l'ancien comportement — même dictionnaire `reservations` alimenté, résolution des noms inchangée
- [x] Ordre des règlements retournés inchangé — le chunking ne touche que le remplissage du dictionnaire, pas `allReglements.Select(...)`
- [x] Aucune écriture base ; lecture seule (`SELECT` uniquement)

> Note review : validation live sur jeu > 2100 non exécutée dans l'environnement de revue (nécessite base GRC volumétrique) ; le pattern de chunking est identique à celui déjà éprouvé dans `GetDistinctReglements`.