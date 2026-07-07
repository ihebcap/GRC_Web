# TASK-030 — Liste des relevés : retirer la flèche d'interrogation, ajouter les compteurs par statut

- **Priorité** : 🟡 Mineur
- **Domaine** : Back+Front / UX
- **Dépend de** : TASK-028 (nouvel écran d'interrogation), TASK-024 (dérivation de statut)
- **Statut** : DONE

## Contexte
Grille maître « Gestion des Relevés Bancaires »
([RelevesBancaires.tsx:385-421](../gocom-web/src/RelevesBancaires.tsx#L385-L421)).
Depuis TASK-028, l'interrogation se fait par clic sur le **titre** (écran séparé) ; la
petite **flèche** de l'ancien accordéon ([ligne 399-401](../gocom-web/src/RelevesBancaires.tsx#L399-L401))
n'a plus de fonction. Le PO veut à la place voir, par relevé, l'avancement du rapprochement.

## Problème constaté
- Colonne flèche (`ChevronRight`) devenue inutile mais toujours affichée.
- La liste ne donne aucune vision d'avancement : il faut ouvrir chaque relevé pour savoir
  ce qui est traité / reste à faire.

## Objectif
Sur chaque ligne de la liste des relevés, afficher 4 compteurs :
- **Total** : nombre total de lignes du relevé.
- **Réservées** : lignes rapprochées en attente de validation (statut `Reserve`).
- **Rapprochées** : lignes validées / pointées GRC (statut `Valide`).
- **Restantes (sans action)** : lignes non rapprochées (statut `NonRapproche`).

Et **supprimer** la colonne flèche.

> Mapping statut (aligné sur `GetEtatRapprochementAsync`, [ReleveBancaireRepository.cs:172-179](../GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs#L172-L179)) :
> `Rapproché` = `DateValidation IS NOT NULL` · `Réservé` = `DateValidation IS NULL AND MV_ID IS NOT NULL` · `Restant` = `DateValidation IS NULL AND MV_ID IS NULL`. **À confirmer** que « rapproché » = validé (et non « réservé »).

## Fichiers concernés
- `GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs` (`GetEntetesByBanqueAsync` + DTO de liste)
- `GRC.Domain` ou couche DTO Application : nouveau DTO de liste (ne pas polluer l'entité `ReleveBancaireEntete`)
- `GRC.API` : contrôleur `GET /api/relevebancaire` (type de retour)
- `gocom-web/src/RelevesBancaires.tsx` (colonnes + suppression flèche)

## Étapes d'implémentation
1. **Backend — DTO liste** : introduire un DTO dédié (ex. `ReleveBancaireListItemDto`) reprenant
   les champs actuels (`Id`, `BanqueId`, `Titre`, `DateImport`, `ImportePar_UserId`) **+**
   `TotalLignes`, `NbReserve`, `NbRapproche`, `NbSansAction`. Ne pas ajouter ces compteurs à
   l'entité domaine `ReleveBancaireEntete`.
2. **Backend — requête agrégée** : dans `GetEntetesByBanqueAsync`, remplacer `SELECT e.*` par une
   agrégation en **une seule requête** (pas de N+1), `LEFT JOIN` sur `RAPP_ReleveBancaire_Ligne` +
   `GROUP BY`, avec `COUNT`/`SUM(CASE …)` selon le mapping ci-dessus. Conserver le filtre
   `nonRapprochesSeulement` existant (garde `@NonRapprochesSeulement = 0 OR EXISTS(...)`) et
   l'`ORDER BY e.DateImport DESC`. **Lecture seule, aucun schéma modifié.**
3. **Backend — contrôleur** : adapter le type de retour de `GET /api/relevebancaire` au nouveau DTO.
   **Additif non cassant** : les champs existants gardent nom + casing camelCase → le consommateur
   « rapprochement » (déroulant, TASK-026) qui passe `nonRapprochesSeulement=true` ignore simplement
   les nouveaux champs. Vérifier qu'aucun champ existant n'est renommé/supprimé.
4. **Frontend — liste** : supprimer la colonne flèche (`<th style={{width:'40px'}}>` +
   cellule `<ChevronRight/>`, [lignes 389](../gocom-web/src/RelevesBancaires.tsx#L389) et
   [399-401](../gocom-web/src/RelevesBancaires.tsx#L399-L401)) et l'import `ChevronRight` s'il devient inutilisé.
   Ajouter 4 colonnes (Total, Réservées, Rapprochées, Restantes) alimentées par les nouveaux champs.
   Ajuster le `colSpan` de l'empty-state ([ligne 415](../gocom-web/src/RelevesBancaires.tsx#L415)).
   Conserver le clic sur le **titre** → écran d'interrogation (inchangé).

## Contraintes
- Ne jamais bypasser une règle de sécurité ou une DLL métier GRC.
- Respecter la Clean Architecture (compteurs dans un DTO, pas dans l'entité domaine).
- **Aucune modification de schéma**, lecture seule, une seule requête (pas de N+1 par relevé).
- Endpoint partagé : ne rien casser côté écran de rapprochement (champs existants intacts).

## Checklist VALIDATION (à remplir dans VERIFY/)
- [x] Build OK (backend + frontend)
- [x] Les 4 compteurs affichés par relevé sont exacts (recouper avec l'écran d'interrogation : Total = Réservées + Rapprochées + Restantes)
- [x] Colonne flèche supprimée, import `ChevronRight` nettoyé si inutilisé
- [x] Clic sur le titre → écran d'interrogation toujours fonctionnel
- [x] Déroulant relevés de l'écran de rapprochement (TASK-026) non régressé
- [x] Une seule requête SQL par chargement de liste (pas de N+1)
- [x] Aucun credential/secret en dur, aucune dette silencieuse, cohérent avec l'architecture
