# TASK-098 — Rapprochement : un règlement annulé n'est jamais affiché ni rapprochable (grille GRC, auto-rapprochement, réservation, validation)

- **Priorité** : 🟠 Majeur
- **Domaine** : Correction (back : 1 helper + 3 gardes de 1 à 5 lignes ; front : vérification)
- **Statut** : TODO
- **Dépend de** : —
- **Lot « règlements annulés »** : TASK-098 (rapprochement) · TASK-103 (comptabilisation) · TASK-104 (liste) · TASK-105 (annulation interdite si réservé/pointé)

## Contexte
Règle PO (2026-09-30) : **l'annulation d'un règlement vaut suppression.** Un règlement annulé n'apparaît
**que dans la liste des règlements**, avec un flag (TASK-104). Il n'est **jamais proposé** : ni dans
l'écran Rapprochement (cette TASK), ni dans la comptabilisation (TASK-103).

La demande initiale (« 1 ligne front ») ne suffisait pas : l'analyse approfondie du 2026-09-30 montre
que l'annulé est aussi éligible à l'auto-rapprochement, à la réservation et (indirectement) à la
validation. Corriger seulement la grille laisserait ces chemins ouverts.

## Problèmes constatés
1. **Grille GRC** : `fetchReglementsGrc` (`RapprochementBancaire.tsx:484`) n'envoie pas `annule` ;
   le backend ne filtre que si le paramètre est fourni (`ReglementService.cs:132-135`) ;
   `EstEligibleRappBancaire` (`ReglementEligibilityHelper.cs:7`) ne regarde que le type et `IsRemis`.
2. **Auto-rapprochement** : `ReleveBancaireController.cs:165-169` (`GenererPropositions`) ne filtre pas
   `IsAnnule`. Un annulé de montant unique peut être proposé (le moteur strict apparie tout montant
   unique des deux côtés).
3. **Réservation** : `ReserverLigneAsync` (`ReleveBancaireRepository.cs:331`) et
   `ReserverLignesBatchAsync` (`:432`) ne contrôlent que l'autorisation de caisse. Un refus retombant
   sur « null » serait mappé en 409 « Ligne ou règlement déjà réservé » (`ReleveBancaireController.cs:270`),
   message **trompeur** pour un annulé.
4. **Validation** : le bloc `ReleveBancaireRepository.cs:726` ne teste que `IsPointe`. Un annulé n'est
   refusé qu'**indirectement** par `SetDateBypassAffectation` (`:870`), et seulement si une date
   d'opération est présente et le règlement non comptabilisé : protection par effet de bord, pas par garde.

**Pourquoi des gardes back malgré le filtre de la grille** : (a) course — un autre poste annule le
règlement entre le chargement de la grille et la réservation ; (b) appel API direct ; (c) l'auto-
rapprochement relit les règlements côté serveur, sans passer par la grille.

## Objectif
- Aucun règlement `IsAnnule = true` dans la grille GRC du Rapprochement ni dans les propositions de
  l'auto-rapprochement, quel que soit le filtre utilisateur (la colonne « Annulé » ne peut plus proposer OUI).
- Réserver ou valider un annulé (appel direct) → **refus explicite** (« règlement annulé… »), aucun
  effet en base, les autres paires d'un lot ne sont pas affectées.

## Décision d'architecture
La règle vit **côté serveur, en un seul endroit** : « éligible au rapprochement » inclut « non annulé ».
`ReglementEligibilityHelper.EstEligibleRappBancaire` reçoit un paramètre `isAnnule` (la signature reste
sans dépendance à la DLL : `int`/`bool`). Trois appels à adapter : `ReglementService.cs:70`,
`ReglementService.cs:414`, `ReleveBancaireController.cs:168`. **Pas de `&annule=false` dupliqué côté
front** : une règle unique, non contournable par un client.

## Fichiers concernés
- `GRC.Application/Services/ReglementEligibilityHelper.cs` (paramètre `isAnnule`)
- `GRC.Infrastructure/Services/ReglementService.cs` (2 appels : `:70`, `:414`)
- `GRC.API/Controllers/ReleveBancaireController.cs` (appel `:168` ; mapping du refus de réservation)
- `GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs` (gardes réservation unitaire + lot, validation `:726`)
- `gocom-web/src/RapprochementBancaire.tsx` (vérification de l'affichage du refus de réservation)

## Étapes d'implémentation
1. Helper + les 3 appels : un règlement annulé n'est jamais éligible.
2. Garde **réservation** (unitaire et lot) : relire le règlement (`repo.Get(mvId)`, déjà lu par
   `VerifierAutorisationReglementCaisse` pour les non-admin — **réutiliser, ne pas lire deux fois ;
   la garde doit aussi s'appliquer aux admin**) et refuser si `IsAnnule`.
   - unitaire : refus avec message dédié (ni 409 « déjà réservé », ni 500) ;
   - lot : l'élément passe en `Success = false`, les autres sont traités normalement.
3. Garde **validation** : `if (reg.IsAnnule) throw new InvalidOperationException(...)` juste à côté de la
   garde `IsPointe` (`:726`) ; l'exception est captée par le `catch` par élément existant.
4. Front : lire comment le refus de réservation est affiché ; si le `message` serveur est ignoré,
   l'afficher tel quel (≤ 5 lignes), sinon le signaler dans le VERIFY. Ne pas toucher à `DEFAULT_COLUMNS`.
5. **État des lieux facultatif (lecture seule, SELECT uniquement)** : avant TASK-105, rien n'interdisait
   d'annuler un règlement déjà réservé ou pointé. Compter les lignes de relevé dont `MV_ID` désigne un
   règlement `MV_Annule = 1` (cas historiques). Consigner le nombre dans le VERIFY, ou « non vérifié
   (pas d'accès à la base) » — cela ne bloque pas la clôture. **Aucun UPDATE de correction** ; si le
   nombre est > 0, le signaler au PO.

## Contraintes
- Ne jamais bypasser une règle de sécurité ou une DLL métier GRC. Aucun UPDATE SQL sur table métier.
- Respecter la Clean Architecture (Domain ← Application ← Infrastructure/API).
- **Aucun changement du moteur strict 1=1** (son refus de deviner est voulu) : on ne filtre que
  l'ensemble d'entrée.

## Décision PO liée (2026-09-30)
Impossible d'annuler un règlement **réservé ou pointé** → traité dans **TASK-105** (garde serveur + bouton
de la liste). Cela supprime à la source le risque de ligne de relevé réservée sur un règlement annulé
devenu invisible ; seuls restent les cas historiques (étape 5).

## Checklist VALIDATION (à remplir dans VERIFY/, avec preuve datée par critère)
- [ ] Build OK (back + front, 0 erreur)
- [ ] Un règlement annulé (`MV_Annule = 1`, virement non pointé, banque sélectionnée) est absent de la
      grille ; un règlement équivalent non annulé est présent (preuve : réponse API ou capture, datée)
- [ ] `GET /reglements?...&eligibleRappBancaire=true` ne renvoie aucun `isAnnule = true`
- [ ] Auto-rapprochement : annulé de montant unique + ligne de relevé de même montant → **aucune
      proposition** ; même cas avec un règlement non annulé → proposition (non-régression)
- [ ] Réservation unitaire ET lot d'un `MvId` annulé → refus explicite, `RAPP_ReleveBancaire_Ligne`
      inchangée (vérifié en base), autres paires du lot réservées normalement ; vérifié aussi en admin
- [ ] Validation (appel direct) d'une paire dont le règlement est annulé → refus, `IsPointe` inchangé
- [ ] Moteur strict 1=1 : mêmes propositions qu'avant sur un jeu sans annulé
- [ ] État des lieux SQL (lecture seule) consigné avec le nombre de lignes concernées, ou « non vérifié »
      avec la raison (facultatif, ne bloque pas la clôture)
- [ ] Aucun credential/secret en dur introduit
- [ ] Aucune dette technique silencieuse
- [ ] Cohérent avec l'architecture
