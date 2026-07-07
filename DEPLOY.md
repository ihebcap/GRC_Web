# DEPLOY.md — GRC (rapprochement bancaire)

## Principe

Un seul dossier `deploy\` contient tout : API + frontend + DLLs Trésorerie.
Tu copies ce dossier chez le client, tu configures `appsettings.json`, tu lances l'EXE.
L'API sert aussi bien le frontend que les endpoints REST sur le même port (5000).

---

## ÉTAPE 1 — Builder (machine de dev)

> Lancer depuis `D:\_vibe\GRC_WEB\` dans PowerShell

```powershell
# 1. Compiler et publier l'API dans deploy\
dotnet publish GRC.API\GRC.API.csproj -c Release --no-self-contained -o deploy

# 2. Builder le frontend React → écrit directement dans deploy\wwwroot\
#    (vite.config.ts : outDir = ../deploy/wwwroot, emptyOutDir = true)
cd gocom-web
npm run build
cd ..
```

> Pas de copie manuelle : Vite génère le frontend directement dans `deploy\wwwroot\`.
> `emptyOutDir: true` ne purge que `wwwroot\`, pas le reste de `deploy\`.
> Faire le build frontend **après** le `dotnet publish` (l'ordre inverse ferait
> écraser `wwwroot\` par la publication de l'API).

**Résultat :** `deploy\` est prêt. C'est le seul dossier à livrer.

---

## ÉTAPE 2 — Prérequis sur le serveur client

```powershell
# Vérifier si .NET 10 Runtime est installé
dotnet --list-runtimes | Select-String "10.0"
```

Si absent, installer **ASP.NET Core Runtime 10.0 x64** :
`https://dotnet.microsoft.com/en-us/download/dotnet/10.0`

> Pas besoin du SDK — le Runtime suffit.

---

## ÉTAPE 3 — Installer chez le client

```powershell
New-Item -ItemType Directory -Force "C:\grc\api"
Copy-Item "deploy\*" "C:\grc\api\" -Recurse -Force
```

---

## ÉTAPE 4 — Configurer appsettings.json

```powershell
notepad "C:\grc\api\appsettings.json"
```

| Champ | Valeur à renseigner |
|---|---|
| `Urls` | Port d'écoute — ex: `http://0.0.0.0:5000`, ou `http://0.0.0.0:8080` pour le port 8080 |
| `ConnectionStrings.DefaultConnection` | Chaîne SQL Server (Server, Database, User Id, Password) |
| `Jwt:Key` | Clé secrète aléatoire — générer avec la commande ci-dessous |

```powershell
# Générer une clé JWT sécurisée (copier le résultat dans appsettings.json)
-join ((65..90) + (97..122) + (48..57) | Get-Random -Count 48 | % {[char]$_})
```

> Le frontend est servi par la même API (même origine) → `wwwroot\config.js` reste
> sur `API_BASE: "/api"`, rien à modifier. Pas de config CORS nécessaire.

---

## ÉTAPE 5 — Lancer

### En test / dev — EXE direct

```powershell
cd C:\grc\api
.\GRC.API.exe
```

Ouvrir le navigateur sur **`http://localhost:5000`**

### En production — Service Windows (démarre automatiquement)

```powershell
# Créer le service (une seule fois)
sc.exe create GrcAPI binPath="C:\grc\GRC.API.exe" DisplayName="GRC API" start=auto

# Démarrer
sc.exe start GrcAPI

# Arrêter
sc.exe stop GrcAPI

# Supprimer le service si besoin de recréer
sc.exe delete GrcAPI
```

> Ouvrir le port dans le pare-feu si accès distant :
> ```powershell
> New-NetFirewallRule -DisplayName "GRC API" -Direction Inbound -Protocol TCP -LocalPort 5000 -Action Allow
> ```

---

## ÉTAPE 6 — Vérifier

```powershell
# API (liste des sociétés, endpoint public)
Invoke-RestMethod "http://localhost:5000/api/reference/societes"
```

Ouvrir **`http://localhost:5000`** → le frontend GRC doit s'afficher.

---

## Changer le port

1. Éditer `C:\grc\api\appsettings.json` → `"Urls": "http://0.0.0.0:8080"`
2. Adapter la règle pare-feu si besoin
3. Redémarrer : `sc.exe stop GrcAPI` puis `sc.exe start GrcAPI`

---

## Mise à jour chez le client

```powershell
# Sur la machine de dev — rebuilder (reprendre ÉTAPE 1)
# Puis chez le client :
sc.exe stop GrcAPI
Copy-Item "deploy\*" "C:\grc\api\" -Recurse -Force
sc.exe start GrcAPI
```

---

## Erreurs fréquentes

| Erreur | Cause | Correction |
|---|---|---|
| Le service démarre puis s'arrête | Runtime ASP.NET Core 10 absent ou chaîne SQL invalide | `dotnet --list-runtimes` ; vérifier `ConnectionStrings.DefaultConnection` |
| `Login failed for user` | Droits SQL insuffisants | Donner accès à la base à l'utilisateur SQL |
| Page blanche sur `http://localhost:5000` | `wwwroot\` vide | Refaire l'ÉTAPE 1 (`npm run build` régénère `deploy\wwwroot\`) |
| Front OK mais appels API en erreur | `wwwroot\config.js` altéré | Doit contenir `API_BASE: "/api"` |
| Port 5000 déjà utilisé | Autre process sur le port | Changer `Urls` dans `appsettings.json` |
| Aucune réponse à distance | Pare-feu / écoute | Vérifier la règle pare-feu et `Urls` sur `0.0.0.0` |
