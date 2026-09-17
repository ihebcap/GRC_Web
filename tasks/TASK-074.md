# TASK-074 — Script `build-all.ps1` (build + publish en une commande)

- **Priorité** : 🟡 Mineur
- **Domaine** : Tooling (racine du dépôt, pas de code applicatif)
- **Statut** : TODO
- **Dépend de** : —

## Contexte

Le build/livraison actuel de GRC_WEB est documenté dans [DEPLOY.md](../DEPLOY.md) (ÉTAPE 1) sous
forme de deux commandes manuelles à enchaîner dans l'ordre :

```powershell
dotnet publish GRC.API\GRC.API.csproj -c Release --no-self-contained -o deploy
cd gocom-web
npm run build
cd ..
```

Le PO a demandé un script unique équivalent à celui déjà utilisé sur un autre projet du hub
(`D:\_vibe\SyncMaster\build-all.ps1`). **Ne pas copier ce script tel quel** : SyncMaster produit un
installeur Inno Setup avec un binaire self-contained/single-file et un bundle de migration EF Core,
ce qui ne correspond pas à l'architecture de livraison de GRC_WEB (dossier `deploy\` copié tel quel
chez le client, pas d'installeur, `--no-self-contained`, cf. DEPLOY.md). Le script à écrire ici doit
suivre le périmètre réel de GRC_WEB, pas celui de SyncMaster.

## Objectif

Un script `build-all.ps1` à la racine du dépôt qui reproduit exactement l'ÉTAPE 1 de DEPLOY.md en
une seule commande, avec les mêmes garanties (ordre publish→npm build, vérifications d'erreur),
sans rien ajouter qui ne soit pas déjà dans DEPLOY.md (pas d'installeur, pas de self-contained, pas
de bundle EF).

## Fichiers concernés

- `build-all.ps1` (nouveau, racine du dépôt)
- `DEPLOY.md` — ÉTAPE 1 à remplacer par l'appel au script une fois celui-ci validé (garder le détail
  des commandes en dessous, à titre de référence/fallback manuel)

## Étapes d'implémentation

1. Créer `build-all.ps1` à la racine :
   - `$ErrorActionPreference = 'Stop'`, se placer sur `$PSScriptRoot` (comme SyncMaster) pour être
     invocable depuis n'importe quel répertoire courant.
   - Étape 1 : `dotnet publish GRC.API\GRC.API.csproj -c Release --no-self-contained -o deploy`,
     vérifier `$LASTEXITCODE` et lever une erreur explicite si échec.
   - Étape 2 : build frontend — `Push-Location gocom-web`, `npm run build`, vérifier
     `$LASTEXITCODE`, `Pop-Location` en `finally`. Ne **pas** copier manuellement le résultat : le
     `outDir` Vite écrit déjà directement dans `deploy\wwwroot\` (cf. `gocom-web/vite.config.ts`,
     `emptyOutDir: true`) — respecter cet ordre (publish avant build front), ne pas l'inverser.
   - Vérification finale : `deploy\GRC.API.exe` et `deploy\wwwroot\index.html` existent, sinon
     lever une erreur explicite indiquant laquelle des deux étapes a échoué silencieusement.
   - Messages `Write-Host` clairs par étape (style SyncMaster : `[INFO]`/`[OK]`/`[WARN]`), pas
     obligatoire mais cohérent avec l'existant du hub.
2. Tester le script en conditions réelles (poste dev) : `.\build-all.ps1` depuis la racine, vérifier
   que `deploy\` est identique à un enchaînement manuel des deux commandes actuelles.
3. Mettre à jour DEPLOY.md ÉTAPE 1 : ajouter `.\build-all.ps1` comme méthode recommandée, garder les
   deux commandes détaillées en dessous (fallback / compréhension de ce que fait le script).

## Contraintes

- Ne pas reprendre les étapes propres à SyncMaster qui n'existent pas côté GRC_WEB : pas
  d'installeur Inno Setup, pas de `--self-contained`/`PublishSingleFile`, pas de migration bundle EF
  Core (GRC_WEB n'a pas ce mécanisme constaté dans DEPLOY.md).
- Aucun secret, chemin client ou chaîne de connexion en dur dans le script — c'est un outil de build
  générique, la config reste dans `appsettings.json` côté client (cf. DEPLOY.md ÉTAPE 4).
- Ne pas changer le comportement du build lui-même (mêmes flags `dotnet publish`/`npm run build` que
  DEPLOY.md) — ce script orchestre, il n'invente pas de nouvelle méthode de build.

## Checklist VALIDATION (à remplir dans VERIFY/)

- [ ] `.\build-all.ps1` exécuté depuis la racine produit un `deploy\` complet et fonctionnel (API +
  `wwwroot\` peuplé), comparé à un enchaînement manuel des 2 commandes de DEPLOY.md
- [ ] Le script s'arrête avec une erreur explicite si `dotnet publish` échoue (tester en cassant
  temporairement le build, ex. erreur de compilation volontaire puis annulée)
- [ ] Le script s'arrête avec une erreur explicite si `npm run build` échoue
- [ ] Aucun secret/chemin client en dur dans `build-all.ps1`
- [ ] DEPLOY.md ÉTAPE 1 mis à jour (script en tête, détail manuel conservé en dessous)
