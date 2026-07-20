# TASK-033 — Supprimer un relevé bancaire (uniquement si aucune ligne réservée ni validée)

- **Priorité** : 🟠 Normal
- **Domaine** : Back+Front
- **Dépend de** : TASK-016/017 (modèle réservation 2 phases), TASK-030 (compteurs de liste réutilisés côté UX)
- **Statut** : DONE

## Contexte
Écran « Gestion des Relevés Bancaires » ([RelevesBancaires.tsx:400](../gocom-web/src/RelevesBancaires.tsx#L400)).
Un relevé importé par erreur (mauvaise banque, doublon, mauvais fichier) doit pouvoir être
**supprimé** tant qu'il n'a pas commencé à être rapproché. Le modèle est le rapprochement
2 phases persisté dans `RAPP_ReleveBancaire_Ligne` (réservation phase 1 → validation phase 2,
cf. mémoire *rapprochement-reservation-2-phases*).

État d'une ligne :
- **Sans action** : `Lettrage IS NULL AND MV_ID IS NULL AND DateValidation IS NULL`
- **Réservée** (phase 1) : `MV_ID IS NOT NULL AND DateValidation IS NULL` — claim posé sur un règlement GRC
- **Validée** (phase 2) : `DateValidation IS NOT NULL` — **la base GRC a été touchée** (`isPointe=true` via DLL)

## Objectif
Ajouter la suppression d'un relevé (en-tête + ses lignes) **strictement conditionnée** :
un relevé n'est supprimable **que si TOUTES ses lignes sont sans action** — ni réservée, ni validée.

### Règle métier (décidée avec le PO — 2026-07-07)
- **Tout-ou-rien au niveau relevé** : si **au moins une** ligne est **réservée OU validée**,
  la suppression du relevé entier est **refusée** (pas de suppression partielle).
- **Droit** : n'importe quel utilisateur authentifié peut supprimer (LAN fermé, cohérent avec le reste).

## Points d'architecture (critiques)
1. **Réservée ou validée → bloqué.** Le garde couvre les deux états, via les 3 signaux :
   `Lettrage IS NOT NULL OR MV_ID IS NOT NULL OR DateValidation IS NOT NULL`.
   - Une ligne **réservée** (phase 1) porte un claim sur un règlement GRC : on ne veut pas la
     faire disparaître sous les pieds d'un utilisateur en cours de rapprochement.
   - Une ligne **validée** (phase 2) a mis `isPointe=true` côté GRC ; supprimer le relevé
     **ne dépointe pas** le règlement → **incohérence comptable + perte de traçabilité**.
   > **On ne touche pas GRC dans cette tâche** : pas de dépointage, pas de libération de claim, pas
   > d'appel DLL. On se contente de **refuser** la suppression dès qu'une ligne est actionnée.
2. **Check-and-delete atomique** (anti-concurrence multi-postes, même esprit que `ReserverLigneAsync`).
   Le contrôle « aucune ligne actionnée » et le `DELETE` doivent être **une seule instruction SQL
   gardée** (`DELETE ... WHERE NOT EXISTS(...)` + `@@ROWCOUNT`), jamais SELECT-puis-DELETE : sinon
   course si quelqu'un réserve une ligne entre le contrôle et la suppression.
3. **Suppression = pur RAPP, AUCUN appel DLL GRC.** On supprime les lignes puis l'en-tête (ou cascade
   FK si elle existe). On ne touche **jamais** la base GRC / les DLL `Tresorerie.*`.
4. **Transaction** : lignes + en-tête dans une seule transaction (comme `InsertReleveAsync`), rollback sur erreur.

## Fichiers concernés
- `GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs` — nouvelle méthode `SupprimerReleveAsync(int enteteId)`
- `GRC.API/Controllers/ReleveBancaireController.cs` — `[HttpDelete("{id}")]`
- `gocom-web/src/RelevesBancaires.tsx` — bouton/colonne de suppression + confirmation

## Étapes d'implémentation
1. **Backend — repository** : ajouter `Task<bool> SupprimerReleveAsync(int enteteId)`.
   - Ouvrir une transaction.
   - **Garde atomique** : ne supprimer les lignes **que si** aucune ligne actionnée n'existe :
     ```sql
     DELETE FROM dbo.RAPP_ReleveBancaire_Ligne
     WHERE ReleveBancaireEnteteId = @Id
       AND NOT EXISTS (
         SELECT 1 FROM dbo.RAPP_ReleveBancaire_Ligne x
         WHERE x.ReleveBancaireEnteteId = @Id
           AND (x.Lettrage IS NOT NULL OR x.MV_ID IS NOT NULL OR x.DateValidation IS NOT NULL)
       );
     ```
   - Vérifier le résultat : si le garde a bloqué (au moins une ligne réservée ou validée), **ne pas** supprimer
     l'en-tête, rollback, retourner un statut « refusé ». Sinon `DELETE` de l'en-tête et commit.
   - Distinguer clairement 3 cas de retour : **supprimé** / **refusé (lignes actionnées)** / **introuvable**
     (relevé inexistant) — pour un code HTTP correct côté contrôleur.
2. **Backend — contrôleur** : `[HttpDelete("{id}")]` →
   - `204 No Content` si supprimé,
   - `409 Conflict` (message clair : « X ligne(s) réservée(s)/validée(s), suppression impossible ») si refusé,
   - `404` si introuvable.
   Ne pas exposer de détail technique SQL.
3. **Frontend** : bouton de suppression par relevé dans la liste.
   - **UX de garde** : désactiver/masquer le bouton quand `NbReserve + NbRapproche > 0`
     (données déjà présentes via TASK-030) — seul un relevé 100 % « sans action » est supprimable.
     **Le backend reste l'autorité**.
   - **Confirmation obligatoire** avant l'appel `DELETE ${API_BASE}/ReleveBancaire/{id}`.
   - Sur `409`, afficher le message métier (ne pas supprimer la ligne de la liste).
   - Sur succès, retirer le relevé de la liste (ou recharger).

## Contraintes
- Ne jamais bypasser une règle de sécurité ni une DLL métier GRC.
- **Aucun `UPDATE`/appel sur la base GRC** : la suppression ne touche que les tables `RAPP_*`.
- **Aucune modification de schéma** (sauf si une cascade FK doit être ajoutée — à valider, sinon suppression explicite lignes+en-tête).
- Garde et delete **atomiques et transactionnels** ; pas de SELECT-puis-DELETE.
- Respecter la Clean Architecture (Domain ← Application ← Infrastructure/API).

## Checklist VALIDATION (à remplir dans VERIFY/)
- [x] Build OK (backend + frontend)
- [x] Relevé 100 % sans action → suppression OK (en-tête + lignes disparues), aucune trace GRC touchée
- [x] Relevé avec ≥1 ligne **réservée** (non validée) → suppression **refusée** (409), rien supprimé
- [x] Relevé avec ≥1 ligne **validée** → suppression **refusée** (409), rien supprimé, pointage GRC **intact**
- [x] Relevé inexistant → 404
- [x] Garde + delete en une seule instruction SQL gardée (`Lettrage/MV_ID/DateValidation IS NOT NULL`, pas de SELECT-puis-DELETE), sous transaction
- [x] Aucun appel DLL `Tresorerie.*` dans le chemin de suppression (pas de dépointage ni libération de claim)
- [x] Front : confirmation avant suppression ; bouton désactivé si `NbReserve + NbRapproche > 0` ; message 409 affiché
- [x] Aucun credential/secret en dur, aucune dette silencieuse, cohérent avec l'architecture
