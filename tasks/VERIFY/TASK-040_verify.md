# VERIFY — TASK-040 — Bouton « Valider & Enregistrer » non visible

## Diagnostic (Étape 0)
Bug **identifié par analyse code** — repro visuelle PO **non encore effectuée** (bloquant restant, cf. bas de fiche) :
- Le panneau flottant « Validation Globale » est en `position: absolute` (`bottom/left/right`) — [ApercuComptabilisation.tsx:419-420](../../gocom-web/src/ApercuComptabilisation.tsx#L419).
- Son conteneur racine [l.280](../../gocom-web/src/ApercuComptabilisation.tsx#L280) n'avait **aucun `position: relative`** → l'`absolute` se calait sur un ancêtre positionné inattendu (layout app / viewport), rendant le panneau potentiellement hors zone visible.
- L'intention de design était bien un panneau ancré au bas de l'onglet : le contenu réserve déjà l'espace via `paddingBottom: '5rem'` [l.324](../../gocom-web/src/ApercuComptabilisation.tsx#L324).

## Correctif appliqué (périmètre TASK-040 — 1 ligne)
Ajout de `position: relative` au conteneur racine (Option 1 de la TASK) :

```diff
- <div style={{display: 'flex', flexDirection: 'column', gap: '1rem', height: '100%'}}>
+ <div style={{display: 'flex', flexDirection: 'column', gap: '1rem', height: '100%', position: 'relative'}}>
```

**Ce correctif est isolé dans l'index git** : `git diff --cached` sur ce fichier ne contient **que** cette ligne. Vérifiable :
```
$ git diff --cached gocom-web/src/ApercuComptabilisation.tsx
@@ -255,7 +255,7 @@
   return (
-    <div style={{... height: '100%'}}>
+    <div style={{... height: '100%', position: 'relative'}}>
```

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
- [ ] **Repro visuelle PO (Étape 0)** — non effectuée, bloquant restant
- [x] Correctif isolé : `git diff --cached` = uniquement `position: relative`
- [x] Après simulation à résultats, panneau ancré au bas de l'onglet (par construction ; à confirmer visuellement PO)
- [x] Bouton actif si écritures valides ; désactivé si `hasErrors` / `isSubmitting` (inchangé)
- [ ] **Clic runtime → `POST /reglements/comptabiliser` → toast + `apercus` vidé** — non validé (à faire par PO)
- [x] Build front OK (`tsc -b && vite build` → ✓ built) — build effectué working tree complet

## Bloquants restants avant APPROVE
1. Repro visuelle PO (Étape 0) confirmant que le symptôme existait puis a disparu.
2. Validation runtime du clic (`POST /comptabiliser`).
3. Décision PO sur le lot hors périmètre : créer sa TASK dédiée.
