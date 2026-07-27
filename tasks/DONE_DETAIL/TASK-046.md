# TASK-046 — Paralléliser `ApercuComptabilisation` (lenteur aperçu compta règlements clients)

- **Priorité** : 🟠 Performance (UX bloquante ressentie : aperçu de 1 à 3 min sur grosses sélections)
- **Domaine** : Backend
- **Dépend de** : TASK-036 / TASK-038 (l'aperçu doit rester iso-compta réelle : pièce, date, référence, libellé, DocNumero)

## Contexte
Lenteur **confirmée par les logs prod** (`grc-20260710.log`), pas une impression :

| Aperçu | Règlements | Durée | Cadence |
|--------|-----------|-------|---------|
| 17:06:48 → 17:08:09 (userId=186) | 4 339 | **~81 s** | ~18,7 ms/règlt |
| 16:06:54 → 16:09:55 (userId=193) | 8 511 | **~181 s** | ~21 ms/règlt |

La lenteur est **linéaire** : `ApercuComptabilisation` traite les règlements en **`foreach` séquentiel** ([ReglementService.cs:525](../GRC.Infrastructure/Services/ReglementService.cs#L525)), un appel `generator.Generate` (~20 ms) après l'autre.

À l'inverse, la comptabilisation réelle `Comptabiliser` tourne déjà en **`Parallel.ForEach` degré 10** ([ReglementService.cs:304-391](../GRC.Infrastructure/Services/ReglementService.cs#L304)). L'aperçu n'a jamais été aligné.

⚠️ **Cette lenteur n'a AUCUN lien avec MSDTC / `DisableTransaction`** : l'aperçu ne fait pas d'écriture 2 bases, donc pas de transaction distribuée. Le levier est uniquement la parallélisation.

## Objectif
Aligner `ApercuComptabilisation` sur le pattern parallèle déjà éprouvé de `Comptabiliser`, **sans changer le résultat fonctionnel** (mêmes DTO, mêmes valeurs forcées). Gain attendu : 4 339 règlements de ~81 s → **~8-10 s** ; 8 511 de ~3 min → **~20 s**.

## Fichiers concernés
- `GRC.Infrastructure/Services/ReglementService.cs` : méthode `ApercuComptabilisation` [l.511-596](../GRC.Infrastructure/Services/ReglementService.cs#L511). Référence du pattern à recopier : `Comptabiliser` [l.292-401](../GRC.Infrastructure/Services/ReglementService.cs#L292).

## Étapes d'implémentation
1. Remplacer le `foreach (var id in reglementIds)` par un `Parallel.ForEach(reglementIds, new ParallelOptions { MaxDegreeOfParallelism = 10 }, id => { ... })`.
2. **Connexion par thread** (impératif) : `ConnectionProvider` / `ReglementClientRepository` sont créés **dans la boucle** (comme `Comptabiliser` l.316-318), pas partagés. Le `repo` unique actuel ([l.515](../GRC.Infrastructure/Services/ReglementService.cs#L515)) n'est **pas** thread-safe.
3. **Accumulateur thread-safe** : `apercus` (`List<object>`) → `ConcurrentBag<object>` (ou `lock`). L'`Add` concurrent sur `List` est non sûr.
4. `ComptaPieceContext.ForcedPiece` (AsyncLocal) : posé **et** remis à `null` dans le `finally` **à l'intérieur** de chaque itération (délégué synchrone, pas d'`await`) — comme `Comptabiliser` l.333/355. Ne pas le hisser hors de la boucle.
5. `viewRows` et `modes` restent chargés **une seule fois avant** la boucle (lecture seule partagée, déjà le cas l.520-521) — OK, ne pas les dupliquer par thread.
6. Conserver à l'identique : le mapping `EcritureApercuDto`, la gestion d'erreur par règlement (ligne d'erreur ajoutée, pas d'interruption globale), les logs `APERÇU COMPTA écriture` / `ÉCHEC`.

## Contraintes
- **Aperçu = lecture seule** : ne rien écrire en base (ni GRC ni Sage), ne pas toucher `Comptabiliser`.
- Résultat fonctionnel **inchangé** : mêmes champs DTO, mêmes valeurs forcées (pièce/date/réf/libellé/DocNumero) qu'avant et que la compta réelle.
- L'**ordre** de la liste retournée peut changer (parallélisme) : vérifier que le front ne dépend pas de l'ordre ; sinon trier par `ReglementId` en sortie.
- Ne pas augmenter `MaxDegreeOfParallelism` au-delà de 10 sans mesure (contention compteur/DLL Sage déjà cadrée à 10 en compta).
- Respect Clean Architecture : la modif reste dans `Infrastructure`.

## Risques / dépendances
- **Thread-safety** = le vrai risque (connexion partagée, `List.Add`, AsyncLocal). Les points 2-4 le couvrent ; c'est exactement ce que `Comptabiliser` fait déjà.
- Anomalie DLL observée à investiguer **séparément** (hors scope) : `reglementId=43168` → `NullReferenceException` dans `EcritureComptableGeneratorReglement.Generate` (run 16:06). La parallélisation ne doit pas masquer ce type d'échec (garder la ligne d'erreur par règlement).

## Checklist VALIDATION (à remplir dans VERIFY/)
- [ ] `ApercuComptabilisation` en `Parallel.ForEach` degré 10
- [ ] Connexion + repo créés par thread (pas de `repo` partagé)
- [ ] Accumulateur des résultats thread-safe (`ConcurrentBag` / `lock`)
- [ ] `ComptaPieceContext.ForcedPiece` posé/nettoyé par itération (finally interne)
- [ ] `viewRows` / `modes` chargés une seule fois avant la boucle
- [ ] DTO et valeurs forcées identiques à avant (aperçu = compta réelle) — comparaison sur un échantillon
- [ ] Ordre de sortie géré (indépendant côté front, ou tri par ReglementId)
- [ ] Aucune écriture base par l'aperçu (lecture seule confirmée)
- [ ] Gestion d'erreur par règlement conservée (une ligne KO n'arrête pas le lot)
- [ ] Mesure avant/après sur une grosse sélection (gain effectif constaté)
- [ ] Build back OK
