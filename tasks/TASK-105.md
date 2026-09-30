# TASK-105 — Impossible d'annuler un règlement réservé ou pointé (garde serveur + bouton de la liste)

- **Priorité** : 🟠 Majeur
- **Domaine** : Back (1 garde dans `AnnulerReglement`) + Front (1 condition, 1 champ de type)
- **Statut** : TODO
- **Dépend de** : —
- **Lot « règlements annulés »** : TASK-098 (rapprochement) · TASK-103 (comptabilisation) · TASK-104 (liste) · TASK-105 (annulation interdite si réservé/pointé)
- **Mise en prod** : API + front, **dans n'importe quel ordre** (ancien front + nouvelle API : le refus s'affiche via le
  `message` serveur ; nouveau front + ancienne API : le bouton est simplement masqué). Aucun script SQL, aucune config.
  Retour arrière = redéployer les builds précédents.
- **Références de ligne** : état du dépôt au commit `12f2dc0` (2026-09-30). Si un fichier a bougé (autre TASK fusionnée avant), se repérer par le **nom de la fonction**, pas par le numéro.

## Contexte
Décision PO (2026-09-30) : **on ne peut pas annuler un règlement réservé ou pointé.** L'annulation valant
suppression, un règlement engagé dans un rapprochement (réservé sur une ligne de relevé, ou déjà pointé)
disparaîtrait de l'écran en laissant la ligne du relevé liée à un règlement introuvable (lettrage orphelin ; libérable
seulement par son réservataire, jamais si la ligne est validée : `LibererLigneAsync`, `ReleveBancaireRepository.cs:555`).
Le PO **ne teste pas avant la mise en production** : les preuves sont produites par le worker sur la base de **test**
et figurent dans le VERIFY.

## Problème constaté (références vérifiées le 2026-09-30)
- `AnnulerReglement` (`ReglementService.cs:909-938`) n'applique que `ValiderGardeCommune` (`:885-904` : annulé /
  comptabilisé / affecté) : **ni la réservation ni le pointage ne sont testés.** Ordre actuel : chargement du règlement
  → autorisation de caisse (`:922-927`) → garde commune (`:930`) → appel DLL `ReglementClientAnnuler` (`:935`).
- Le bouton « Annuler » de la liste (`App.tsx:829`) est masqué si pointé, mais **pas si réservé**.
- TASK-099 (bouton dans l'écran Rapprochement) désactive le bouton si réservé, mais un appel API direct ou l'écran liste
  permettent quand même l'annulation.
- *Non vérifié* : ce que fait la DLL `CaisseManager.ReglementClientAnnuler` sur un règlement pointé.

**Ce qu'est « réservé »** : une ligne de `dbo.RAPP_ReleveBancaire_Ligne` porte `MV_ID = n° du règlement` (réservation en
cours **ou** ligne déjà validée ; la libération remet `MV_ID` à NULL, `ReleveBancaireRepository.cs:553-555`). Le DTO de
`GET /reglements` expose déjà cette information (`lettrage`, `reservePar_UserId`, `dateReservation`, lus par
`SELECT ... FROM RAPP_ReleveBancaire_Ligne WHERE MV_ID IN @Ids`, `ReglementService.cs:301` ; propriétés `ReglementClientDto.Lettrage`
et `ReservePar_UserId`, `:1540-1543`, sérialisées en camelCase par défaut : `lettrage`, `reservePar_UserId`).

## Comportements attendus (contrat)
| Situation | Résultat attendu |
|---|---|
| `POST /reglements/{id}/annuler`, règlement **pointé** | HTTP 400, `{ "message": "Le règlement [<numéro>] est pointé (rapproché) et ne peut pas être annulé." }` ; règlement non annulé ; **pas d'appel à la DLL** |
| Idem, règlement **réservé** (ligne de relevé avec `MV_ID` = ce règlement, non pointé) | HTTP 400, `{ "message": "Le règlement [<numéro>] est réservé par un rapprochement bancaire et ne peut pas être annulé. Libérez d'abord la ligne du relevé." }` ; aucune modification |
| Règlement libre (ni réservé, ni pointé, ni comptabilisé/affecté/remis) | annulation **inchangée** (200) |
| Règlement réservé, puis ligne libérée (« dérapprocher ») | redevient annulable |
| Utilisateur **sans droit** d'annulation sur la caisse | HTTP 403 **avant** tout test de réservation/pointage (aucune fuite d'information) |
| Règlement comptabilisé / affecté / déjà annulé | messages existants **inchangés** |
| Liste : bouton « Annuler » | absent pour un règlement réservé et pour un pointé ; présent pour un règlement libre |

Le 400 avec `message` est **déjà** le mapping de `InvalidOperationException` (`ReglementController.cs:319-323`) et le front
l'affiche tel quel (`App.tsx:665-667`) : aucun changement de contrôleur ni de gestion d'erreur.

## Étapes d'implémentation
1. **Garde serveur** dans `AnnulerReglement`, **après** `ValiderGardeCommune(reg, "annulé")` (`:930`) et **avant** l'appel
   DLL (`:935`), dans cet ordre :
   a. `if (reg.IsPointe)` → `InvalidOperationException` (message « pointé » du tableau) ;
   b. existence d'une ligne réservée : `SELECT COUNT(1) FROM dbo.RAPP_ReleveBancaire_Ligne WHERE MV_ID = @No`
      (Dapper, paramétré, lecture seule, connexion `_dbFactory.GetConnectionString()`, même mécanique que `:296-301`) ;
      si > 0 → `InvalidOperationException` (message « réservé » du tableau).
   Journaliser chaque refus en Warning, au format des gardes existantes (`GARDE COMMUNE refusée (…)`, `:889`, `:895`, `:901`) :
   `GARDE ANNULATION refusée (pointé|réservé) : reglementNo=…`.
   **Ne pas modifier `ValiderGardeCommune`** : elle est partagée avec la modification de règlement (`:966`, `:1055`),
   hors périmètre.
2. **Front — bouton de la liste** (`App.tsx:829`) : ajouter `&& !reg.lettrage` à la condition. Ajouter
   `lettrage?: string | null` à l'interface `Reglement` (`App.tsx:25-59`, champ absent aujourd'hui alors qu'il arrive bien
   dans le JSON). Le bouton reste **masqué** (et non grisé) : cohérent avec le traitement actuel du pointé.
3. **Preuve DLL** : avant d'ajouter la garde, appeler `POST /reglements/{id}/annuler` sur un règlement pointé de test et
   consigner si la DLL le refusait déjà (information pour le VERIFY ; la garde applicative reste obligatoire).

## Jeu d'essai (base de TEST uniquement)
- **Rl** : règlement libre (virement non pointé, non comptabilisé, non remis, non affecté), banque de test B.
- **Rr** : virement libre **réservé** sur une ligne L de relevé de B (via l'écran Rapprochement, sans valider).
- **Rp** : règlement **pointé** (soit par « Rapprocher » de la liste, soit par validation d'un rapprochement).
- Deux comptes : un avec droit d'annulation sur la caisse, un **sans** ; un compte admin.

## Scénarios de test (à rejouer par le worker)
- **S1 Libre** : annuler Rl (UI) → succès, ligne disparaît de la liste normale des non-annulés (non-régression).
- **S2 Réservé, API directe** : `POST …/annuler` sur Rr → 400 + message « réservé » ; `GET /reglements` : Rr toujours non
  annulé ; SELECT : L toujours liée à Rr.
- **S3 Réservé, UI** : dans la liste, la ligne de Rr n'a **pas** de bouton « Annuler ».
- **S4 Libération** : « dérapprocher » Rr (libération de L) → recharger la liste → le bouton réapparaît → l'annulation aboutit.
- **S5 Pointé** : `POST …/annuler` sur Rp → 400 + message « pointé » ; règlement non annulé.
- **S6 Ligne validée** : le règlement d'une ligne **validée** est refusé (message « pointé », car `IsPointe`).
- **S7 Ordre des gardes** : avec le compte **sans droit**, `POST …/annuler` sur Rr → 403 (pas le message « réservé »).
- **S8 Non-régression** : règlement comptabilisé / affecté / déjà annulé → messages existants identiques.
- **S9 Admin** : mêmes résultats que S2/S5 avec le compte admin.

## Risques et points d'attention
- **Ordre des gardes** : l'autorisation de caisse reste **avant** (pas de fuite d'information sur la réservation).
- **Course résiduelle** : une réservation survenant entre la garde et l'appel DLL (quelques ms) reste possible ;
  acceptée, à mentionner dans le VERIFY (TASK-098 refuse ensuite la réservation d'un annulé dès qu'il est annulé).
- **Cas historiques** (déjà annulés avant cette TASK) : non corrigés ici — voir l'état des lieux de TASK-098.
- Le message « réservé » ne nomme pas le réservataire (information disponible dans la grille du Rapprochement) : volontaire, garder simple.
- Hors périmètre : la modification d'un règlement réservé (noté au TODO, non décidé).

## Contraintes
- Ne jamais bypasser une règle de sécurité ou une DLL métier GRC ; aucun UPDATE SQL sur table métier.
- Ne pas modifier `ValiderGardeCommune` ni le comportement de la modification de règlement.
- Aucun changement du contrôleur (le mapping 400 existe déjà).

## Fichiers concernés
- `GRC.Infrastructure/Services/ReglementService.cs` (`AnnulerReglement`)
- `gocom-web/src/App.tsx` (condition `:829`, interface `Reglement`)
- `GRC.API/Controllers/ReglementController.cs` (**lecture seule** : mapping `:319-323`)

## Checklist VALIDATION (VERIFY : preuve datée par critère — capture, réponse API ou extrait de log)
- [ ] Build back + front, 0 erreur (preuve : sortie du build)
- [ ] S1 annulation d'un règlement libre inchangée (preuve : réponse + capture)
- [ ] S2 refus « réservé » : 400 + message exact, règlement et ligne inchangés (preuve : réponse + `GET /reglements` + SELECT)
- [ ] S3 bouton absent pour un réservé (preuve : capture)
- [ ] S4 après libération, annulation possible (preuve : captures avant/après)
- [ ] S5/S6 refus « pointé » : 400 + message exact (preuve : 2 réponses)
- [ ] S7 compte sans droit → 403 (preuve : réponse)
- [ ] S8 messages existants inchangés (preuve : 3 réponses)
- [ ] S9 admin identique (preuve : réponses)
- [ ] Résultat du test « la DLL refuse-t-elle d'elle-même un pointé ? » consigné
- [ ] Le diff de `ValiderGardeCommune` est **vide** (preuve : `git diff`)
- [ ] Aucun credential/secret en dur introduit
- [ ] Aucune dette technique silencieuse
- [ ] Cohérent avec l'architecture

## Go / No-Go
**No-Go si** S2, S5 ou S7 ne sont pas prouvés : ils protègent contre le lettrage orphelin et contre la fuite d'information.
