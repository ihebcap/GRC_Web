# TASK-114 — Prouver par exécution le garde-fou `EC_Solde > 0` de `generer-espece` (reliquat de TASK-107)

- **Priorité** : 🟠 Majeur
- **Domaine** : Sécurité comptable / Test
- **Statut** : ✅ FAIT (prouvé par 2 runs d'exécution réelle via API, voir tasks/VERIFY/TASK-114_verify.md)
- **Dépend de** : TASK-107 (livrée, réserve levée)

## Contexte
TASK-107 a ajouté dans `GRC.Infrastructure/Services/ReglementGenerationService.cs` (l.202-224) un contrôle qui relit `EC_Solde` en base juste avant la création de chaque règlement et refuse la facture si elle est soldée (« Facture déjà soldée ou introuvable en base au moment de l'écriture. »). Il protège contre une facture réglée (autre poste, job SQL toutes les 5 min) entre le chargement de la liste et l'écriture. Ce contrôle **n'a jamais été exécuté** : le banc `harness_task107` ne couvre que l'ancien contrôle (facture soldée dès le chargement) et `Distinct()`. Réserve écrite à la clôture de TASK-107 ; PO du 2026-10-01 : à corriger.

## Problème constaté
Le test « facture soldée » est intercepté plus tôt par le contrôle existant (message « Facture introuvable ou déjà soldée. », l.197), donc la nouvelle branche n'est jamais atteinte. Sans preuve, un défaut du nouveau contrôle (mauvaise colonne, mauvais `EC_Id`, exception) passerait inaperçu, alors qu'il protège contre un double règlement.

## Objectif
Prouver par exécution sur la **base de test**, sans modifier le code de production, que :
1. une facture ouverte au chargement mais soldée pendant le traitement du lot est refusée avec le message « …au moment de l'écriture » ;
2. aucun règlement n'est créé pour elle ;
3. les autres factures du même lot sont traitées normalement (import partiel assumé, TASK-059).

## Fichiers concernés
- `harness_task107/Program.cs` (dossier ignoré par git, hors livrables) : nouveau test.
- `GRC.Infrastructure/Services/ReglementGenerationService.cs` : **lecture seule** sauf si le test révèle un défaut.

## Étapes d'implémentation
1. **Technique sans changer le code de prod** : lot de ~20 échéances ouvertes de test ; un thread du banc surveille `RT_MOUVEMENT` et, dès qu'apparaît le premier règlement créé par le lot, met `EC_Solde = 0` sur la **dernière** échéance du lot (traitée ~19 règlements plus tard, donc après la modification). Lancer `GenererReglementsEspece` ; contrôler que cette dernière échéance sort en erreur avec le message « …au moment de l'écriture » et que `RT_MOUVEMENT` n'a gagné aucune ligne pour elle.
2. Contrôler que les autres échéances du lot sont créées (1 règlement par facture).
3. **Nettoyage obligatoire** : restaurer `EC_Solde` de l'échéance modifiée et annuler/supprimer les règlements créés par le test (scripts SQL de nettoyage existants des règlements espèces), vérifier le retour à l'état initial (nombre de mouvements).
4. Rejouer 2 fois pour écarter un faux positif dû au timing ; si la course ne se déclenche pas (échéance déjà traitée), augmenter la taille du lot et le consigner.
5. Si le test révèle un défaut : le corriger dans le service et redéposer un VERIFY ; sinon aucune modification de code.

## Contraintes
- **Base de test uniquement** (jamais la prod) ; données de test restaurées en fin de run.
- Aucun identifiant en dur : chaîne de connexion et mots de passe par variables d'environnement (comme le banc actuel).
- Ne pas contourner ni affaiblir l'ancien contrôle (l.190-200) ni la DLL métier.
- Le harnais reste hors dépôt (`.gitignore`) ; le VERIFY contient le log d'exécution.

## Checklist VALIDATION (à remplir dans VERIFY/)
- [x] Build OK
- [x] Log d'exécution : message « …au moment de l'écriture » obtenu sur l'échéance soldée en cours de lot
- [x] 0 mouvement créé pour cette échéance (requête SQL jointe)
- [x] Autres factures du lot traitées normalement
- [x] Rejoué 2 fois, résultat stable
- [x] Base de test restaurée (compte avant/après identique)
- [x] Aucun credential/secret en dur introduit
- [x] Aucune dette technique silencieuse
- [x] Cohérent avec l'architecture
