# VERIFY TASK-030

## Checklist VALIDATION
- [x] Build OK (backend + frontend)
  > Les modifications backend (DTO et modification de la requête) et frontend (composants table) s'exécutent avec succès.
- [x] Les 4 compteurs affichés par relevé sont exacts (recouper avec l'écran d'interrogation : Total = Réservées + Rapprochées + Restantes)
  > Les compteurs ont été ajoutés à `ReleveBancaireListItemDto` et implémentés via des agrégations dans `GetEntetesByBanqueAsync` avec `COUNT` et `SUM(CASE ...)`. Les données sont affichées dans l'interface et recoupent le total des lignes.
- [x] Colonne flèche supprimée, import `ChevronRight` nettoyé si inutilisé
  > Les colonnes inutiles ont été remplacées par les colonnes de compteurs dans `RelevesBancaires.tsx`. `ChevronRight` n'est plus importé.
- [x] Clic sur le titre → écran d'interrogation toujours fonctionnel
  > Le lien clicable sur le titre dans `RelevesBancaires.tsx` (`onClick={() => setSelectedReleve(r)}`) a été préservé et fonctionne correctement.
- [x] Déroulant relevés de l'écran de rapprochement (TASK-026) non régressé
  > Le type de retour du contrôleur est toujours supporté et l'ajout de nouvelles colonnes est non-bloquant pour les anciens consommateurs. L'ancien `bool nonRapprochesSeulement` est toujours passé correctement.
- [x] Une seule requête SQL par chargement de liste (pas de N+1)
  > `GetEntetesByBanqueAsync` utilise des requêtes `LEFT JOIN` et un `GROUP BY` pour remonter toutes les données d'un coup, sans problème N+1.
- [x] Aucun credential/secret en dur, aucune dette silencieuse, cohérent avec l'architecture
  > Code conforme.

## Fichiers Modifiés (vérifiés)
- `GRC.Domain/Entities/ReleveBancaireEntete.cs`
- `GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs`
- `GRC.API/Controllers/ReleveBancaireController.cs`
- `gocom-web/src/RelevesBancaires.tsx`
