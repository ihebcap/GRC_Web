# TASK-067 — Message d'erreur « mode de règlement non paramétré » : ajouter l'intitulé, pas seulement le n°

- **Priorité** : 🟠 UX / exploitabilité (constat PO 2026-07-22, log `grc-20260722.log`)
- **Domaine** : Backend (`GRC.Infrastructure/Services/ReglementService.cs`)
- **Dépend de** : rien pour le code. **Coordination avec [TASK-055](TASK-055.md)** : ce message n'est aujourd'hui visible par l'utilisateur dans aucun cas (cf. TASK-055) — cette tâche améliore le **contenu** du message, TASK-055 le rend **visible**. Les deux sont nécessaires pour que le PO voie le bénéfice ; l'ordre d'implémentation n'importe pas.

## Contexte

`grc-20260722.log` montre le règlement `51893` échouer **à l'identique 6 fois entre 11:40 et 13:47** (lignes 1858, 4460, 9257, 9274/9280, 9314/9334, 9341/9347, 9353) :

```
Règlement non comptabilisable : le mode de règlement n°18 n'est pas paramétré pour la caisse n°121 (paramétrage comptable absent).
```

Ce message vient de notre propre garde (`VerifierComptabilisable`, TASK-047), pas de la DLL Sage — [ReglementService.cs:545-548](../GRC.Infrastructure/Services/ReglementService.cs#L545-L548). Il ne donne que le **numéro** du mode de règlement (`n°18`). Le commentaire du code lui-même ([ReglementService.cs:532](../GRC.Infrastructure/Services/ReglementService.cs#L532)) précise que mode 18 = « RELAIS » — information que le développeur a dû aller chercher à la main, alors qu'elle devrait être dans le message pour que l'utilisateur (ou le support) identifie le mode sans redescendre en base.

Combiné à TASK-055 (message actuellement invisible côté écran), les 6 tentatives identiques suggèrent que l'utilisateur a réessayé plusieurs fois sans comprendre le blocage. Une fois TASK-055 livrée, ce message deviendra visible : il doit être **exploitable** dès ce moment, donc porter le libellé du mode en plus du numéro.

## Objectif

Le message d'erreur de `VerifierComptabilisable` (et tout message équivalent qui citerait un numéro de mode de règlement à l'utilisateur) affiche **le code ET l'intitulé** du mode de règlement, par exemple :

```
Règlement non comptabilisable : le mode de règlement n°18 (RELAIS) n'est pas paramétré pour la caisse n°121 (paramétrage comptable absent).
```

Si l'intitulé est introuvable (mode inconnu du référentiel), afficher le numéro seul plutôt que de faire échouer la garde elle-même — cette garde ne doit pas devenir une nouvelle source d'exception non gérée.

## Fichiers concernés

- `GRC.Infrastructure/Services/ReglementService.cs` — `VerifierComptabilisable` ([:536-549](../GRC.Infrastructure/Services/ReglementService.cs#L536-L549)) : seul point à modifier.

## Étapes d'implémentation

1. **Identifier l'API réelle** pour résoudre un intitulé à partir d'un `ModeReglementNo`, côté Trésorerie (`Tresorerie.Core.Interfaces.IModeReglementRepository` déjà bindé dans [TresorerieCoreDapperReplacementModule.cs:33](../GRC.Infrastructure/Tresorerie/TresorerieCoreDapperReplacementModule.cs#L33), ou `Tresorerie.Core.Services.ModeReglementManager` bindé [:168](../GRC.Infrastructure/Tresorerie/TresorerieCoreDapperReplacementModule.cs#L168)). **Ne pas supposer la signature** : inspecter la DLL avec `inspect_tool` (déjà utilisé dans ce projet pour sonder `libs/Tresorerie/*.dll` via Mono.Cecil) pour confirmer la méthode de lookup par numéro et le nom de la propriété d'intitulé.
2. Injecter la dépendance retenue dans `ReglementService` (constructeur), en suivant le pattern d'injection déjà utilisé pour `societe`/`caisse` dans cette classe.
3. Dans `VerifierComptabilisable`, résoudre l'intitulé du mode `reg.ModeReglementNo` et l'inclure dans le message si trouvé ; sinon garder le numéro seul (pas de `null`/vide dans le message, pas d'exception supplémentaire si le lookup échoue).
4. Vérifier qu'aucun autre message de ce service ou de `ReglementGenerationService.cs` ne cite un numéro de mode brut sans libellé dans un contexte visible utilisateur (les deux occurrences connues dans `ReglementGenerationService.cs:149,373` citent déjà un libellé en dur car le mode y est fixe — pas de changement attendu là, à confirmer en relisant).

## Contraintes

- **Ne pas modifier le comportement de la garde** (TASK-047) : elle continue à lever l'exception dans le même cas, seul le texte change.
- Le lookup de l'intitulé ne doit pas ajouter de risque d'exception non gérée dans une garde dont le rôle est justement de sécuriser l'appel DLL suivant — entourer d'un accès défensif (pas de `try/catch` large sur toute la méthode, juste sur la résolution de l'intitulé si l'API choisie peut lever).
- Respecter la Clean Architecture (Domain ← Application ← Infrastructure/API) — cette tâche reste entièrement dans `GRC.Infrastructure`.

## Risques / dépendances

- Si `IModeReglementRepository`/`ModeReglementManager` nécessite un aller-retour base à chaque appel (pas de cache), vérifier l'impact sur un lot de comptabilisation volumineux — privilégier une résolution unitaire (mode déjà connu par règlement, pas de boucle N+1 significative attendue vu le volume habituel des lots).
- Bénéfice utilisateur nul tant que [TASK-055](TASK-055.md) n'est pas livrée (le message reste invisible à l'écran) — les deux tâches doivent être suivies ensemble côté PO.

## Checklist VALIDATION (à remplir dans VERIFY/)

- [ ] Build back OK (0 erreur)
- [ ] Cas règlement 51893 (mode 18 / caisse 121, ou équivalent en base de test) → message contient **le numéro ET l'intitulé** du mode
- [ ] Cas mode introuvable dans le référentiel (numéro invalide) → message affiche le numéro seul, **aucune exception non gérée** levée par la résolution de l'intitulé elle-même
- [ ] Aucune régression sur le message « caisse introuvable » ([ReglementService.cs:542-543](../GRC.Infrastructure/Services/ReglementService.cs#L542-L543)), non concerné par cette tâche
- [ ] Aucune modification du comportement de `VerifierComptabilisable` (toujours appelée aux mêmes points, toujours bloquante dans les mêmes cas)
- [ ] Pas de N+1 perceptible sur un lot de comptabilisation réel (mesure informelle acceptable)
