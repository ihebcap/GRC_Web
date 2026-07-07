# Module de Rapprochement Bancaire (Workflow Définitif)

Voici le design d'architecture et d'expérience utilisateur (UX) validé pour le module de rapprochement. Ce processus s'appuie sur ce qui existe déjà (droits utilisateurs, DLLs GRC) tout en ajoutant une couche d'intelligence et une interface ultra-fluide.

## Vision de la Nouvelle Interface

![Maquette Interface Rapprochement](C:\Users\Iheb\.gemini\antigravity\brain\e3baff56-216f-414e-977e-85b8c03d5201\bank_reconciliation_ui_mockup_1783349327223.png)

---

## Le Workflow de l'Utilisateur (Étape par Étape)

### Étape 1 : Le Paramétrage Initial
L'utilisateur arrive sur la page de rapprochement et doit définir son périmètre de travail.
- **Sélection :** Il choisit une "Banque" dans la liste déroulante et sélectionne un "Intervalle de dates" (ex: du 01/06 au 30/06).
- **Chargement GRC (Déjà fait) :** Le système affiche automatiquement la liste des `Règlements` internes correspondants à droite de l'écran (avec la gestion des droits utilisateurs existante).

### Étape 2 : L'Import du Relevé
- L'utilisateur clique sur "Importer le relevé" et charge le fichier Excel de la banque sélectionnée à l'étape 1.
- La colonne de gauche se remplit instantanément avec les lignes de l'Excel.

### Étape 3 : La Magie de l'Auto-Rapprochement
Dès que l'import est terminé, notre algorithme .NET Core entre en jeu :
- Il compare la colonne de gauche (Excel) et la colonne de droite (GRC).
- Il affiche ses **propositions** en traçant des liens visuels entre les deux colonnes (ou en alignant les cartes face à face).

### Étape 4 : La Correction Manuelle
L'utilisateur a un contrôle total :
- Il vérifie les liaisons vertes.
- Si une ligne est orpheline ou mal associée, il peut **Glisser-Déposer** (Drag & Drop) une carte de la gauche vers la droite pour forcer ou corriger le rapprochement.

### Étape 5 : Validation Finale
- L'utilisateur clique sur "Valider le rapprochement".
- Le système envoie ces paires aux **DLLs de rapprochement GRC** pour verrouiller la base de données de manière sécurisée et respecter la relation 1-à-1.

---

## Proposed Changes (Technique)

1. **Frontend (GRC_WEB) :** 
   - Création de la nouvelle page Split-Screen (React, Angular ou MVC Views selon votre stack).
   - Intégration des listes existantes (Règlements filtrés).
   - Développement de la fonctionnalité d'import Excel asynchrone et du "Drag & Drop".
2. **Backend (.NET Core) :**
   - Nouveau contrôleur API pour lire l'Excel.
   - Algorithme de calcul de "Score" (Comparaison Montant -> Date).
   - Branchement final des listes appairées vers les appels DLL de la GRC.

---

## User Review Required

> [!IMPORTANT]
> **Validation du Design**
> L'ensemble du processus (du choix de la banque jusqu'à l'utilisation des DLLs existantes) est maintenant modélisé. 
> Pouvez-vous valider ce plan d'implémentation ? Si l'architecture vous convient à 100%, nous pourrons clôturer cette phase de conception et décider des prochaines étapes de développement.
