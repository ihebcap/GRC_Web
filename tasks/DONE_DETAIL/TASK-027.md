# TASK-027 — Affichage Débit / Crédit des lignes de relevé (état du rapprochement)

- **Priorité** : 🟡 Mineur
- **Domaine** : UX
- **Statut** : DONE
- **Dépend de** : —

## Contexte
Panneau « État du rapprochement » d'un relevé bancaire, dans le composant
[RelevesBancaires.tsx](../gocom-web/src/RelevesBancaires.tsx) (sous-composant `ReleveEtatPanel`).
La grille affiche une colonne unique **MONTANT** valorisée par
`montantReel ?? credit ?? 0` ([RelevesBancaires.tsx:99-101](../gocom-web/src/RelevesBancaires.tsx#L99-L101)).

## Problème constaté
Une colonne montant unique ne distingue pas les **débits** (sorties) des **crédits**
(entrées). Sur un relevé bancaire c'est le format attendu par le métier (comptable) et
c'est illisible sur gros volume (ex. 4 649 lignes). Le sens de l'opération n'apparaît pas.

Le sens existe pourtant en base : l'entité `ReleveBancaireLigne` porte `Debit`, `Credit`
et `MontantReel` ([ReleveBancaireLigne.cs:16-18](../GRC.Domain/Entities/ReleveBancaireLigne.cs#L16-L18)).
Mais le DTO de l'état **n'expose pas `Debit`** — il ne remonte que `Credit` et `MontantReel`
([ReleveBancaireRepository.cs:377-378](../GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs#L377-L378)),
donc le frontend ne peut pas afficher le débit aujourd'hui.

## Objectif
Remplacer la colonne unique **MONTANT** par deux colonnes **DÉBIT** et **CRÉDIT**,
alignées à droite, chaque ligne ne renseignant que la colonne correspondant à son sens
(format bancaire — Option A validée avec le PO). Aucune régression sur les colonnes
Statut / Réservé par / Règlement GRC.

## Fichiers concernés
- `GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs` (DTO `LigneEtatRapprochementDto`)
- `gocom-web/src/RelevesBancaires.tsx` (interface `LigneEtatRapprochementDto` + rendu grille)

## Étapes d'implémentation
1. **Backend — DTO** : ajouter `public decimal? Debit { get; set; }` à `LigneEtatRapprochementDto`
   ([ReleveBancaireRepository.cs:368-392](../GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs#L368-L392)).
   Le SQL fait déjà `SELECT l.*` ([ligne 141-146](../GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs#L141-L146))
   → `Debit` est déjà dans le jeu de résultats, Dapper l'hydratera automatiquement. **Aucune modification SQL.**
2. **Frontend — interface** : ajouter `debit: number | null;` à l'interface `LigneEtatRapprochementDto`
   ([RelevesBancaires.tsx:7-27](../gocom-web/src/RelevesBancaires.tsx#L7-L27)).
3. **Frontend — en-têtes** : remplacer le `<th>Montant</th>` unique par `<th>Débit</th><th>Crédit</th>`
   ([RelevesBancaires.tsx:85](../gocom-web/src/RelevesBancaires.tsx#L85)). Ajuster le `colSpan`
   de la ligne « Aucune ligne. » (7 → 8) ([RelevesBancaires.tsx:94](../gocom-web/src/RelevesBancaires.tsx#L94)).
4. **Frontend — cellules** : remplacer la cellule montant unique par deux cellules alignées à droite :
   - DÉBIT : formater `l.debit` si `> 0`, sinon vide.
   - CRÉDIT : formater `l.credit` si `> 0`, sinon vide.
   Conserver le format `Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'MAD' })`.
5. Décider explicitement du sort de `montantReel` : il n'est plus la source d'affichage
   principale ; ne pas l'afficher dans cette grille (le débit/crédit brut du relevé prime).

## Contraintes
- Ne jamais bypasser une règle de sécurité ou une DLL métier GRC.
- Respecter la Clean Architecture (Domain ← Application ← Infrastructure/API).
- Pas de modification du schéma base ni du SQL de lecture (le champ existe déjà).
- Ne pas toucher à la logique de statut / réservation / règlement GRC.

## Checklist VALIDATION (à remplir dans VERIFY/)
- [x] Build OK (backend + frontend)
- [x] Comportement vérifié end-to-end : lignes débit affichées en colonne DÉBIT, crédit en CRÉDIT, jamais les deux
- [x] `Debit` bien remonté par l'API `/ReleveBancaire/{id}/etat` (vérifier payload réel)
- [x] Aucun credential/secret en dur introduit
- [x] Aucune dette technique silencieuse
- [x] Cohérent avec l'architecture
