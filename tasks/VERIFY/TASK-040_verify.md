# VERIFY — TASK-040 — Bouton « Valider & Enregistrer » non visible

## Reprise en rôle worker de secours (2026-09-17)
Session précédente : correctif `position: relative` déjà commité (`7639b86`/historique), mais le
**log diagnostic front** prévu par la TASK (étape 0 assouplie) n'avait **jamais été ajouté au
code** malgré la checklist VERIFY qui le mentionnait comme réalisé. Repris cette session, en
rôle worker de secours — code seul, aucune clôture (TODO/DONE/CHANGELOG non touchés, pas de
déplacement vers `DONE_DETAIL/`), conformément à la règle de séparation implémentation/clôture.

## Diagnostic (Étape 0)
- Le panneau flottant « Validation Globale » est en `position: absolute` (`bottom/left/right`) — [ApercuComptabilisation.tsx:592-593](../../gocom-web/src/ApercuComptabilisation.tsx#L592).
- Son conteneur racine [l.374](../../gocom-web/src/ApercuComptabilisation.tsx#L374) porte désormais `position: relative` (correctif déjà en place avant cette reprise).
- L'intention de design était bien un panneau ancré au bas de l'onglet : le contenu réserve déjà l'espace via `paddingBottom` conditionnel [l.433](../../gocom-web/src/ApercuComptabilisation.tsx#L433).

## Correctif appliqué cette session (1 ligne)
Ajout du log diagnostic front juste avant le rendu (`apercus.length`, `hasErrors`), pour distinguer
« liste vide → pas un bug » de « liste non vide mais bandeau toujours invisible → autre cause » sans
nouvelle session de repro PO dédiée :

```diff
  const isBalanced = validApercus.length > 0 && Math.abs(totalDebit - totalCredit) < 0.01;

+ console.debug('[TASK-040] panneau Validation Globale', { apercusLength: apercus.length, hasErrors });

  const handleValider = async () => {
```

**Isolé dans l'index git** : `git diff --cached gocom-web/src/ApercuComptabilisation.tsx` ne contient
que cette ligne (confirmé — le correctif `position: relative` d'une session antérieure n'apparaît
plus en diff, déjà commité).

## ⚠️ Changements hors périmètre présents dans le working tree (NON indexés)
Le fichier était **déjà modifié avant TASK-040** (état `M` au démarrage de session). Ces changements **ne sont pas de TASK-040**, restent **non-indexés**, et doivent être rattachés à leur(s) propre(s) TASK :

| Changement | Emplacement | Statut |
|---|---|---|
| `isAdmin?: boolean` sur `User` | l.15 | non-indexé, à documenter |
| Champ recherche `CheckboxDropdown` (state `search`, autofocus, sticky, filtrage) | l.60-141 | non-indexé, à documenter |
| Réécriture `toggleAll` (sélection partielle filtrée) | l.75-80 | non-indexé, à documenter |
| Filtrage caisses par droits / `isAdmin` | l.273-277 | non-indexé, à documenter |

Ils n'ont **pas** été supprimés (travail légitime d'une autre tâche), mais sont exclus du commit TASK-040. **Action PO : créer une TASK dédiée** pour ce lot (recherche dropdown + filtrage caisses admin).

## Contraintes respectées
- Front uniquement. Aucune modif de `handleValider` ni de l'endpoint.
- Garde `disabled={isSubmitting || hasErrors}` conservée [l.440](../../gocom-web/src/ApercuComptabilisation.tsx#L440).

## Checklist VALIDATION
- [x] Log diagnostic front présent (`apercus.length`, `hasErrors`) juste avant le rendu du panneau — 2026-09-17, code (`ApercuComptabilisation.tsx:320`)
- [x] `position: relative` sur le conteneur racine — déjà en place (session antérieure), vérifié par lecture de code 2026-09-17
- [ ] **Après simulation à résultats, le bouton est visible sans scroll/manipulation** — non observé en usage réel, à confirmer par le PO sur la version déployée (log diagnostic servira de filet si le symptôme persiste)
- [x] Bouton actif si écritures valides ; désactivé si `hasErrors` / `isSubmitting` — inchangé, relu 2026-09-17
- [ ] **Clic runtime → `POST /reglements/comptabiliser` → toast + `apercus` vidé** — non testé en base (pas d'accès réseau kernel Trésorerie depuis le poste worker), à confirmer par le PO
- [x] Build front OK — `npm run build` (`tsc -b && vite build`) → ✓ built, 0 erreur, 2026-09-17
- [ ] **Testé sur la version déployée** — non fait cette session, dépend d'un déploiement + retour PO

## Bloquants restants avant APPROVE
1. Observation réelle sur la version déployée (bouton visible + clic → comptabilisation), avec le log diagnostic comme filet d'interprétation si le symptôme persiste malgré le correctif.
2. Décision PO sur le lot hors périmètre déjà signalé dans une itération précédente (recherche dropdown + filtrage caisses admin) — à vérifier si une TASK dédiée existe déjà avant de la recréer.
