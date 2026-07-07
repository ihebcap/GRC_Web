# TASK-011 — URL de l'API en dur (`http://localhost:5044`) → configurable

- **Priorité** : 🔴 Bloquant (déploiement LAN)
- **Domaine** : Déploiement / UX
- **Statut** : TODO
- **Dépend de** : —

## Contexte
Le frontend appelle l'API via `http://localhost:5044` codé en dur : `App.tsx:70` (`const API_BASE = 'http://localhost:5044/api'`) et **répété en dur** dans `RapprochementBancaire.tsx` (lignes 102, 125, 137, 157, 177, 242) et probablement les autres écrans.

## Problème constaté
Objectif = **LAN 100%**, l'appli remplace une WinForm sur plusieurs postes. Or `localhost` désigne **le poste de l'utilisateur**, pas le serveur. Depuis n'importe quel poste client autre que le serveur, **toutes les requêtes échouent**. C'est bloquant pour le déploiement multi-postes.

## Objectif
Une seule URL d'API, configurable au build/déploiement, fonctionnant depuis tout poste du LAN.

## Fichiers concernés
- `gocom-web/src/App.tsx`
- `gocom-web/src/RapprochementBancaire.tsx`
- `gocom-web/src/RelevesBancaires.tsx`, `ApercuComptabilisation.tsx` (vérifier)
- `gocom-web/.env` / `vite.config.ts`

## Étapes d'implémentation
1. Centraliser dans **un seul** module (`src/api.ts`) exportant `API_BASE`.
2. Alimenter via `import.meta.env.VITE_API_BASE` (fichier `.env` / `.env.production`), défaut relatif ou nom du serveur LAN.
3. Remplacer **toutes** les occurrences `http://localhost:5044` par ce module (créer une instance axios partagée).
4. Documenter dans le README la variable à définir au déploiement.

## Contraintes
- Aucune URL absolue codée en dur ne doit subsister.

## Checklist VALIDATION (à remplir dans VERIFY/)
- [ ] Build OK
- [ ] `grep localhost:5044` = 0 dans src/
- [ ] Testé depuis un poste ≠ serveur sur le LAN
- [ ] URL configurable sans recompiler le code source
