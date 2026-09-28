# TASK-088 — Garde `IsAnnule` manquante dans la comptabilisation de règlement

- **Priorité** : 🟠 Majeur
- **Domaine** : Correction (Backend Infrastructure)
- **Statut** : TODO
- **Dépend de** : TASK-085 (introduit `IsAnnule` comme état atteignable par l'application — avant
  TASK-085, aucun règlement ne pouvait devenir `IsAnnule=true` via GRC_WEB, ce trou était donc
  jusqu'ici inaccessible en pratique par ce chemin)

## Contexte

Découvert lors de l'analyse approfondie de TASK-085 (annulation de règlement, réunion PO
2026-09-28), par une revue adversariale dédiée à chercher les impacts de TASK-085 sur les écrans
existants. `GRC.Infrastructure/Services/ReglementService.cs` a deux points d'entrée de
comptabilisation qui partagent la même garde de comptabilisabilité `VerifierComptabilisable`
(ligne 583) :
- `Comptabiliser` (ligne ~360) : `if (reg == null || reg.IsComptabilise != 0) { ... ignoré ... }`
  puis `VerifierComptabilisable(societe, reg)`.
- `ApercuComptabilisation` (ligne ~860) : même garde `IsComptabilise != 0`, même appel à
  `VerifierComptabilisable`.

Aucun des deux ne teste `reg.IsAnnule` (propriété exposée côté DTO sur `ReglementClientDto`, ligne
991, et déjà utilisée en filtre de grille ligne 123 : `allReglements.Where(r => r.IsAnnule ==
annuleVal)`). **Attention type** : le paramètre `reg` de `VerifierComptabilisable` (ligne 585) est le
modèle DLL natif `global::Tresorerie.Core.Models.ReglementClient`, **pas** le DTO — ne pas chercher
`IsAnnule` sur le DTO pour cette implémentation. La propriété existe bien aussi sur ce type natif :
`ReleveBancaireRepository.cs` (`SetDateBypassAffectation`, ligne ~870) la teste déjà sur ce même
type (`if (reg.IsAnnule) throw ...`) — faisabilité confirmée par précédent direct dans le code.
`VerifierComptabilisable` elle-même (lignes 583-596) ne teste que la caisse et le mode de règlement,
pas l'état du règlement.

## Problème constaté

Un règlement annulé (via TASK-085, `CaisseManager.ReglementClientAnnuler`) reste par construction
`IsComptabilise == 0` — l'annulation exige déjà `IsComptabilise == NonComptabilise` en garde
applicative (cf. TASK-085 § Étapes d'implémentation, point 1). Il resterait donc sélectionnable pour
`ApercuComptabilisation` (aperçu) et `Comptabiliser` (comptabilisation réelle), aucune des deux
méthodes ne l'excluant explicitement.

En pratique, l'appel DLL sous-jacent échouerait probablement plus loin dans le pipeline de
comptabilisation (un règlement annulé n'a normalement pas vocation à générer des écritures), mais ce
comportement n'est ni garanti ni testé pour ce cas précis — et ce n'est pas une garde applicative
explicite, contrairement au principe déjà appliqué par TASK-085 elle-même (ajouter une garde
`IsComptabilise` en prudence plutôt que de compter sur un échec DLL en aval pour `IsAnnule`).

## Objectif

Un règlement annulé (`IsAnnule == true`) est explicitement exclu de la comptabilisation (aperçu et
réelle), avec un message clair s'il est malgré tout soumis (ex. appel API direct avec un id obsolète
côté front), plutôt que de compter sur un échec DLL non garanti en aval.

## Fichiers concernés

- `GRC.Infrastructure/Services/ReglementService.cs` — `VerifierComptabilisable` (ligne 583) ou les
  deux points d'appel `Comptabiliser`/`ApercuComptabilisation` (lignes ~360 et ~860).

## Étapes d'implémentation

1. Ajouter le test `IsAnnule` au point de vérité partagé `VerifierComptabilisable` (préférable à
   dupliquer le test dans les deux méthodes appelantes — c'est déjà le rôle de cette méthode que de
   centraliser les conditions de rejet avant l'appel DLL de comptabilisation) :
   ```csharp
   if (reg.IsAnnule)
       throw new InvalidOperationException(
           $"Règlement non comptabilisable : le règlement n°{reg.Numero} est annulé.");
   ```
2. Vérifier que le message remonte au front de la même façon que les rejets existants de
   `VerifierComptabilisable` (mode/caisse non paramétrés) — pas de traitement spécial requis si le
   test est ajouté au même endroit, la gestion d'erreur existante s'applique déjà.
3. Ne pas dupliquer ce test directement dans `Comptabiliser`/`ApercuComptabilisation` en plus de
   `VerifierComptabilisable` — un seul endroit de vérité, cohérent avec le fonctionnement actuel du
   couple caisse/mode.

## Contraintes

- Ne jamais bypasser une règle de sécurité ou une DLL métier GRC.
- Respecter la Clean Architecture (Domain ← Application ← Infrastructure/API).
- Aucun `UPDATE` SQL brut sur une table pilotée par la DLL.

## Risques / dépendances

- Dépend de TASK-085 pour être testable en pratique (nécessite un règlement réellement annulé en
  base de test) — peut être implémentée et compilée indépendamment, mais son VERIFY doit attendre
  qu'un règlement annulé existe réellement (via TASK-085 déployée, ou via un `MV_Annule=1` déjà
  présent en base si un tel cas existe déjà indépendamment de TASK-085).

## Checklist VALIDATION (à remplir dans VERIFY/)

- [ ] Build back OK (0 erreur)
- [ ] Règlement annulé (`IsAnnule=true`) → `VerifierComptabilisable` lève `InvalidOperationException`
      explicite, testé réellement en base (pas seulement par lecture de code)
- [ ] `ApercuComptabilisation` sur un règlement annulé → refus avec message clair, pas d'aperçu
      généré
- [ ] `Comptabiliser` sur un règlement annulé → refus avec message clair, aucune écriture comptable
      générée
- [ ] Non-régression : règlements non annulés toujours comptabilisables normalement (caisse/mode
      paramétrés)
- [ ] Non-régression lot mixte : un lot contenant à la fois un règlement annulé et des règlements
      valides ne rejette QUE le règlement annulé (gestion d'erreur par-règlement existante, TASK-046
      — ne bloque pas tout le lot), testé réellement avec un lot mixte, pas seulement un règlement
      annulé isolé
- [ ] Aucune dette technique silencieuse (un seul point de test `IsAnnule`, pas de duplication)
- [ ] Cohérent avec l'architecture
