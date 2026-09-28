# TASK-088 — Garde `IsAnnule` dans `VerifierComptabilisable`

- **Priorité** : 🟠 Majeur
- **Domaine** : Correction (Backend Infrastructure)
- **Statut** : DONE

## Résumé

Garde `IsAnnule` ajoutée en tête de `VerifierComptabilisable` (point de vérité partagé entre
`Comptabiliser` et `ApercuComptabilisation`). Un seul ajout de 4 lignes dans
`ReglementService.cs` (l.604-607 TASK-088) — aucun autre fichier modifié.

## Implémentation

**`GRC.Infrastructure/Services/ReglementService.cs`** :

```csharp
// TASK-088 — Garde IsAnnule : un règlement annulé (via TASK-085 ou antécédent)
// ne doit jamais générer d'écritures ni d'aperçu comptable.
if (reg.IsAnnule)
    throw new InvalidOperationException(
        $"Règlement non comptabilisable : le règlement n°{reg.Numero} est annulé.");
```

Inséré dans `VerifierComptabilisable` **avant** les tests de caisse et de mode — la méthode
étant déjà le point de vérité UNIQUE partagé par `Comptabiliser` (l.387) et
`ApercuComptabilisation` (l.1269) depuis TASK-047.

## Validation

- Build back 0 erreur.
- Banc de test réel `harness_task088` contre `DESKTOP-2VCUE93/GR_GOCOM` : **20/20 PASSED**.
  - Pré-checks SQL confirmant l'état des données de test (MV_Id=9682 annulé, MV_Id=7926 valide).
  - `ApercuComptabilisation` annulé → `HasError=true`, message _"Règlement non comptabilisable : le règlement n°RC26021715 est annulé."_, 0 écriture.
  - `Comptabiliser` annulé → `errorCount=1`, `successCount=0`, `MV_Compta` reste 0 en base (SELECT post-test).
  - Lot mixte (annulé+valide) → annulé seul en erreur, valide avec 2 écritures générées.
  - Non-régression règlement valide seul → `HasError=false`, 2 écritures d'aperçu générées.
  - Cas croisé TASK-087 documenté : aucun règlement annulé Type 0/4 en base (garde type-agnostique vérifiée par analyse de code).
- **Résultat : 20/20 PASSED, 0 FAILED**
- Rapport : `VERIFY/TASK-088_verify.md`

## Notes de conception

- **Un seul point de test** : ajouté dans `VerifierComptabilisable` uniquement, pas dupliqué dans
  les méthodes appelantes — cohérent avec le pattern caisse/mode (TASK-047).
- **Précédent de faisabilité** : `ReleveBancaireRepository.cs` l.870 teste déjà `IsAnnule` sur le
  même type natif `ReglementClient` (via `if (reg.IsAnnule) throw ...`) — aucune nouveauté d'accès.
- **Gestion d'erreur inchangée** : l'`InvalidOperationException` est captée par la gestion PAR
  RÈGLEMENT existante (TASK-046) — le règlement KO est remonté dans `errors[]` sans bloquer le lot.
- **Cas croisé TASK-087** : TASK-087 filtre la liste affichée (GetReglements), TASK-088 filtre
  l'action de comptabilisation (VerifierComptabilisable) — deux gardes orthogonales, aucun conflit.
