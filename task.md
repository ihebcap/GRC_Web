# Suivi d'implémentation (Rapprochement Bancaire)

- `[/]` **Phase 1 : Base de Données & Modèles**
  - `[x]` Créer les tables SQL `ReleveBancaire_Entete` et `ReleveBancaire_Ligne` *(Pris en charge par l'utilisateur dans la base GRC).*
  - `[ ]` Créer les classes/entités C# correspondantes dans `GRC.Domain`.
  - `[ ]` Ajouter le mapping Entity Framework dans `GRC.Infrastructure`.

- `[ ]` **Phase 2 : Importation Excel (Backend)**
  - `[ ]` Développer le service d'upload du fichier Excel.
  - `[ ]` Développer le parseur (lecture des colonnes Date, Code, Crédit, Libellé).
  - `[ ]` Implémenter le filtre strict pour ne lire/sauvegarder que les lignes d'Encaissements (colonne `Crédit`).
  - `[ ]` Gérer la conversion sécurisée des dates depuis le format numérique d'Excel.

- `[ ]` **Phase 3 : Algorithmique et Services (Backend)**
  - `[ ]` Implémenter le service générateur de Lettrage séquentiel (A, B... AA...).
  - `[ ]` Développer `AutoReconciliationEngine` (Logique de ciblage 1=1 sur le montant).
  - `[ ]` Préparer le endpoint de Validation Finale (Injection du `Code` dans `N° Extrait` et `MV_Info1` via les DLLs).

- `[ ]` **Phase 4 : Interface Utilisateur (Frontend)**
  - `[ ]` Créer l'écran avec les deux DataGrids virtuelles (GRC vs Relevé).
  - `[ ]` Ajouter le formulaire d'importation de relevé (avec champ Titre).
  - `[ ]` Implémenter les boutons d'action manuelle : "Lettrer" et "Délettrer".
  - `[ ]` Implémenter la fonction de tri sur la colonne Lettrage.
  - `[ ]` Connecter l'interface aux APIs backend.
