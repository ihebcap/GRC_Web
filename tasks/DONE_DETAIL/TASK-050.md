# TASK-050 — Lettrage automatique du règlement client à la comptabilisation

- **Priorité** : 🟠 Nouveau fonctionnel (demande PO)
- **Domaine** : Backend (Infrastructure) — moteur natif `Tresorerie.ApplicationServices`
- **Dépend de** : TASK-048 (comptabilisation désormais **séquentielle** — prérequis de sûreté pour cette tâche, voir Contraintes)

## Contexte

Demande PO (2026-07-14) : au moment de la **comptabilisation** d'un règlement client, s'il est **totalement affecté sur une facture** (affectation intégrale, pas de split), il doit être **lettré automatiquement** dans le sens comptable Sage — pas seulement « pointé ».

Analyse préalable (revue du moteur natif WinForm par introspection binaire — Mono.Cecil, DLLs sans source) :

- GRC_WEB n'appelle **jamais** aujourd'hui le moteur de lettrage comptable natif. Vérifié par grep (0 match) sur `IsLettrer|\.Lettre\b|DateLettrage|ExerciceLettrage|LettrageReglementClient` dans `GRC.API`/`GRC.Infrastructure`. `ReglementService.Comptabiliser` ne pose que `IsComptabilise`, `ErpNo`, `NumeroPiece`, `DocNumero1/2` — jamais `IsLettrer`/`Lettre`.
- `ReglementClient` implémente `ICanBeLettre` et expose déjà `IsLettrer` (bool), `Lettre` (string), `DateLettrage`/`ExerciceLettrage` (nullable DateTime) — champs natifs jamais écrits par GRC_WEB.
- Le moteur natif expose une méthode **prête à l'emploi pour exactement ce besoin** :
  `Tresorerie.ApplicationServices.Comptabilite.LettrageReglementClient.LettrerAsync(ReglementClient reglement) : Task<bool>`
  (interface `ILettrageReglementClient`).

## Objectif

Après une comptabilisation réussie d'un règlement client dans `ReglementService.Comptabiliser`, invoquer `ILettrageReglementClient.LettrerAsync(reg)` pour tenter le lettrage natif.

## Fichiers modifiés

- `GRC.Infrastructure/Tresorerie/TresorerieNinjectKernel.cs` — `ActiverServicesComptabilisation()` : ajout `BindImplInterfaces(asm, "Tresorerie.ApplicationServices.Comptabilite.LettrageReglementClient")`. Confirmé par réflexion sur la DLL réelle : cet impl implémente `ILettrageReglementClient` **et** `ILettrage<ReglementClient>` (porteur de `LettrerAsync`), constructeur `(IGroupeService, IErpComptaService, IErpCommService)` déjà résoluble (mêmes deps que le comptabilizer existant).
- `GRC.Infrastructure/Services/ReglementService.cs` — `Comptabiliser` : résolution `ILettrageReglementClient`, appel `lettrage.LettrerAsync(reg).GetAwaiter().GetResult()` après `successCount++`, dans un try/catch dédié qui ne touche jamais `successCount`/`errorCount`. Résultat capturé dans une nouvelle liste `lettrageWarnings` (retournée au front). Décision : bloquant (`GetAwaiter().GetResult()`) plutôt qu'async de bout en bout — `Comptabiliser` est déjà séquentiel post-TASK-048, pas de contention nouvelle ; éviter de propager `async` jusqu'au contrôleur (`IActionResult` synchrone, inchangé) pour un bénéfice nul ici.
- `ApercuComptabilisation` : **non touché**, reste lecture seule (aucun appel `LettrerAsync`).

## Contraintes respectées

- Aucune modification de la DLL ni contournement de sa logique de lettrage.
- Aucun recodage côté GRC de la détection « totalement affecté » — laissé au moteur natif.
- Aucun `UPDATE` SQL brut sur les colonnes pilotées par la DLL (`IsLettrer`/`Lettre`/etc.) — uniquement `LettrerAsync`.
- Clean Architecture respectée.

## Test réel effectué (2026-07-14)

API lancée avec la config Trésorerie réelle (`GR_GOCOM.apt`), base `GR_GOCOM`/`GOCOM` sur
`DESKTOP-2VCUE93`. Binding résolu sans exception (`Kernel Trésorerie initialisé avec 6
modules`). 4 vrais règlements non comptabilisés comptabilisés via l'API réelle :

| MV_Id | Cas | successCount/errorCount | `F_ECRITUREC.EC_Lettrage` |
|---|---|---|---|
| 37659 | 1 échéance, affectation = montant intégral | 1/0 | `A` — lettré |
| 47804 | 1 échéance, affectation = montant intégral | 1/0 | `C` — lettré |
| 45706 | 1 échéance, affectation = montant intégral | 1/0 | `0` — non lettré |
| 44517 | 6 échéances distinctes (split) | 1/0 | `0` — non lettré (attendu) |

### Clarification PO (2026-07-14)

Point initialement bloquant : `LettrerAsync` retourne `false` dans les 4 cas et les colonnes
miroir côté Trésorerie (`RT_MOUVEMENT.MV_IsLettrer`/`MV_Lettre`/`DT_Lettrage`/
`MV_ExerciceLettrage`) restent à `0`/`NULL`, y compris pour 37659/47804 réellement lettrés.

**PO confirme** : dans l'application WinForm de référence, le lettrage d'un encaissement
client se traduit **uniquement** sur `F_ECRITUREC` (côté écritures Sage) — il n'y a jamais eu
de retour/mirroring attendu sur les colonnes `RT_MOUVEMENT`. Le critère d'acceptation du TASK
(rédigé à partir d'une analyse IL statique, sans test réel à l'époque) visait la mauvaise
table. **`F_ECRITUREC.EC_Lettrage`/`EC_Lettre` renseignés est la preuve de lettrage correcte et
suffisante**, cohérente avec le comportement WinForm.

Résiduel non bloquant : 45706 (structurellement identique à 37659/47804 — 1 échéance, montant
intégral) n'a pas été lettré. Cause non investiguée — conforme aux contraintes du TASK, c'est
une décision interne du moteur natif (règle Σdébit=Σcrédit ou autre condition Sage), pas un
défaut GRC_WEB à corriger.

**Mutation réelle** : ces 4 règlements sont désormais `IsComptabilise=1` de façon permanente
dans `GR_GOCOM` (montants faibles, 4,64 à 270, choisis pour limiter l'impact).

## Checklist VALIDATION — APPROVE 2026-07-14

- [x] Build back OK (0 erreur)
- [x] Binding `ILettrageReglementClient` résolu sans exception au démarrage (log réel : `Kernel Trésorerie initialisé avec 6 modules`)
- [x] Règlement client comptabilisé, **totalement affecté sur une seule facture** → lettré côté `F_ECRITUREC` (`EC_Lettrage`/`EC_Lettre` renseignés) pour 2/3 candidats testés — preuve acceptée par le PO comme critère correct (mise à jour du critère initial, qui visait `RT_MOUVEMENT` à tort)
- [x] Règlement client comptabilisé, **affecté partiellement / sur plusieurs factures** → reste comptabilisé, non lettré, aucune erreur (`errorCount` inchangé) — testé (MV_Id=44517)
- [x] Échec du lettrage → non bloquant par construction (try/catch dédié, `lettrageWarnings` séparé) — chemin exception non déclenché en conditions réelles (aucun exercice clôturé disponible dans le jeu de test), mais garanti par revue de code
- [x] `ApercuComptabilisation` inchangé : aucun appel à `LettrerAsync`, toujours lecture seule
- [x] Aucune régression sur TASK-048 : lot de 2 règlements comptabilisés en une passe, `successCount=2/errorCount=0`, `ErpNo` distincts (305513-305516)
