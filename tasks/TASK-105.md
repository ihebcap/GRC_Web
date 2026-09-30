# TASK-105 — Impossible d'annuler un règlement réservé ou pointé (garde serveur + bouton de la liste)

- **Priorité** : 🟠 Majeur
- **Domaine** : Back (1 garde dans `AnnulerReglement`) + Front (1 condition, 1 champ de type)
- **Statut** : TODO
- **Dépend de** : —
- **Lot « règlements annulés »** : TASK-098 (rapprochement) · TASK-103 (comptabilisation) · TASK-104 (liste) · TASK-105 (annulation interdite si réservé/pointé)

## Contexte
Décision PO (2026-09-30) : **on ne peut pas annuler un règlement réservé ou pointé.** L'annulation valant
suppression, un règlement engagé dans un rapprochement (réservé sur une ligne de relevé, ou déjà
pointé) disparaîtrait de l'écran en laissant la ligne du relevé liée à un règlement introuvable.

## Problème constaté
- `AnnulerReglement` (`ReglementService.cs:909`) n'applique que `ValiderGardeCommune`
  (annulé / comptabilisé / affecté, `:885-904`) : **ni la réservation ni le pointage ne sont testés.**
- Le bouton « Annuler » de la liste (`App.tsx:829`) est masqué si pointé, mais **pas si réservé**.
- TASK-099 (bouton dans l'écran Rapprochement) désactive le bouton si réservé, mais un appel API direct
  ou l'écran liste permettent quand même l'annulation.
- *Non vérifié* : ce que fait la DLL `CaisseManager.ReglementClientAnnuler` sur un règlement pointé.

Ce qu'est « réservé » : une ligne de `dbo.RAPP_ReleveBancaire_Ligne` porte `MV_ID = n° du règlement`
(réservation en cours **ou** ligne déjà validée). Le DTO de `/reglements` expose déjà cette information
(`Lettrage`, `ReservePar_UserId`, `DateReservation`, lus par `SELECT ... WHERE MV_ID IN @Ids`,
`ReglementService.cs:301`).

## Objectif
- **Serveur** : refus explicite si le règlement est **pointé** (`IsPointe`) ou **référencé par une ligne
  de relevé** (réservé ou validé). Deux messages distincts et clairs (pointé : « … est pointé
  (rapproché) et ne peut pas être annulé » ; réservé : « … est réservé par un rapprochement bancaire :
  libérez d'abord la ligne du relevé »). Réponse 400 avec `message` : c'est déjà le mapping de
  `InvalidOperationException` (`ReglementController.cs:319-323`), affiché tel quel par le front.
- **Liste** : le bouton « Annuler » n'est pas proposé pour un règlement réservé (comme pour un pointé).

## Étapes d'implémentation
1. Garde serveur dans `AnnulerReglement`, **après** `ValiderGardeCommune(reg, "annulé")` (`:930`) et
   **avant** l'appel DLL (`:935`) : `IsPointe`, puis existence d'une ligne `RAPP_ReleveBancaire_Ligne`
   avec `MV_ID = reg.No` (SELECT Dapper, même mécanique que `:301`).
   **Ne pas modifier `ValiderGardeCommune`** : elle est partagée avec la modification de règlement
   (`:966`, `:1055`), hors périmètre.
2. Front (`App.tsx:829`) : ajouter `&& !reg.lettrage` à la condition du bouton ; ajouter
   `lettrage?: string | null` à l'interface `Reglement` (absent aujourd'hui, le champ arrive bien dans le JSON).
3. **Preuve DLL** : avant la garde, tester `POST /reglements/{id}/annuler` sur un règlement pointé de test
   et consigner si la DLL le refusait déjà (information pour le VERIFY ; la garde applicative reste
   obligatoire).

## Contraintes
- Ne jamais bypasser une règle de sécurité ou une DLL métier GRC ; aucun UPDATE SQL sur table métier.
- Ne pas modifier `ValiderGardeCommune` ni le comportement de la modification de règlement.
- Fenêtre de course résiduelle (quelques ms entre la garde et l'appel DLL, si un autre poste réserve à cet
  instant) : **acceptée**, à mentionner dans le VERIFY.
- Les cas historiques (déjà annulés avant cette TASK) ne sont pas corrigés ici (voir TASK-098, étape 5).

## Fichiers concernés
- `GRC.Infrastructure/Services/ReglementService.cs` (`AnnulerReglement`)
- `gocom-web/src/App.tsx` (condition `:829`, interface `Reglement`)
- `GRC.API/Controllers/ReglementController.cs` (lecture seule : mapping `:319-323`)

## Checklist VALIDATION (à remplir dans VERIFY/, avec preuve datée par critère)
- [ ] Build OK (back + front, 0 erreur)
- [ ] Appel direct d'annulation sur un règlement **pointé** → 400 + message « pointé » ; règlement
      toujours non annulé (vérifié en base : `MV_Annule`)
- [ ] Appel direct sur un règlement **réservé** → 400 + message « réservé » ; ligne de relevé inchangée
- [ ] Règlement libre (ni réservé ni pointé) : annulation toujours possible (non-régression)
- [ ] Après « Dérapprocher » (libération de la ligne), le même règlement redevient annulable
- [ ] Liste : bouton « Annuler » absent pour un règlement réservé et pour un pointé, présent pour un libre
- [ ] Résultat du test « la DLL refuse-t-elle d'elle-même un pointé ? » consigné
- [ ] Aucun credential/secret en dur introduit
- [ ] Aucune dette technique silencieuse
- [ ] Cohérent avec l'architecture
