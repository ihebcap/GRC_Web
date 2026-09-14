# TASK-070 — Clé de signature JWT codée en dur, jamais configurée : authentification entièrement forgeable

- **Priorité** : 🔴 Sécurité CRITIQUE — **prioritaire sur TASK-069** (constat audit architecte 2026-09-14, approfondissement de la demande PO « droits d'accès caisse »)
- **Domaine** : Backend (`GRC.API/Program.cs`, `GRC.API/appsettings.json`, `GRC.API/appsettings.Development.json`)
- **Dépend de / bloque** : rend [TASK-069](TASK-069.md) **insuffisante seule** — corriger les contrôles de caisse ne sert à rien si un attaquant peut forger `IsAdmin=1` directement. Les deux doivent être traitées, celle-ci en premier (ou en même temps).
- **RISK : CRITICAL** — bypass total de l'authentification et de l'autorisation, pas seulement du cloisonnement caisse.

## Contexte

[Program.cs:54](../GRC.API/Program.cs#L54) :
```csharp
var jwtKey = builder.Configuration["Jwt:Key"] ?? "une_clef_secrete_longue_et_complexe_pour_le_dev";
```
Cette même expression est dupliquée à [Program.cs:215](../GRC.API/Program.cs#L215) pour la signature du token à la connexion (`/api/auth/login`, ligne 174-248). La clé de repli (`"une_clef_secrete_longue_et_complexe_pour_le_dev"`) est écrite en clair dans le code source, donc visible par quiconque a accès au dépôt ou au binaire compilé.

Vérifié directement (pas supposé) : **aucune section `Jwt` n'existe dans `GRC.API/appsettings.json` ni `GRC.API/appsettings.Development.json`** (les deux fichiers committés en git, base du build `deploy\` — vérifié aussi que `deploy\appsettings.json` n'est pas versionné : `git show HEAD:deploy/appsettings.json` échoue, c'est un artefact de `dotnet publish` qui recopie tel quel `GRC.API/appsettings.json`).

**Nuance après vérification de `DEPLOY.md`** : il existe une procédure documentée (ÉTAPE 4, `DEPLOY.md:58-73`) qui demande explicitement de générer une clé aléatoire et de l'ajouter à `appsettings.json` à l'installation chez le client — ce n'est donc pas un point totalement aveugle côté projet. Mais :
- rien dans le code ne vérifie que l'étape a été faite : si elle est oubliée, l'appli démarre **silencieusement** avec la clé codée en dur, sans erreur ni avertissement dans les logs ;
- le fichier `appsettings.json` lui-même ne contient **aucun placeholder** pour `Jwt` (contrairement à `Urls`/`ConnectionStrings` qui ont déjà une valeur d'exemple présente et donc rappellent visuellement qu'il faut les modifier) — le déployeur doit ajouter de mémoire une section entière absente du fichier ;
- rien ne garantit que cette étape a été suivie sur chaque déploiement client existant (impossible à vérifier depuis ce dépôt — accès serveur client requis) ;
- même quand elle est suivie, la clé de repli reste **écrite en clair dans le code source public du dépôt** : n'importe qui l'ayant lue une fois peut forger un token utilisable contre **tout client ayant sauté l'étape**.

Donc l'ampleur exacte (combien de déploiements clients utilisent réellement la clé de repli) n'est pas vérifiable depuis le code, mais le risque est réel et **structurel** : rien n'empêche l'oubli, rien ne le détecte, et la conséquence d'un oubli est un bypass total et silencieux.

**Impact** : `IssuerSigningKey` (validation, ligne 61) et la clé de signature à l'émission (ligne 215) utilisent la même valeur. Quiconque connaît cette chaîne — elle est publique, dans ce dépôt — peut générer lui-même, hors ligne, un JWT valide et signé avec n'importe quel contenu :
- `UserId` / `SocieteId` arbitraires (accès à une société quelconque, sans compte),
- `Caisses` arbitraires (rend **caduque** la correction de TASK-069 : pourquoi contourner le contrôle caisse d'un endpoint alors qu'on peut directement forger un JWT qui prétend avoir toutes les caisses),
- `IsAdmin=1` (court-circuite tous les contrôles `HasEntityActionRestriction`, existants et à venir sur TASK-069 — cf. le court-circuit natif documenté dans [[autorisations-utilisateur-kernel-vs-jwt]]).

Aucune connexion réelle (`/api/auth/login`) n'est nécessaire : le token se génère hors ligne avec n'importe quelle bibliothèque JWT standard, du moment qu'on connaît la clé — qui est ici la valeur codée en dur, constante et publique.

## Pourquoi c'est plus grave que TASK-069

TASK-069 corrige l'absence de contrôle de caisse sur 5 endpoints, **en supposant que le JWT présenté est légitime** (émis par un vrai `/api/auth/login` avec de vrais droits). Cette hypothèse est fausse tant que TASK-070 n'est pas corrigée : un attaquant n'a même pas besoin de deviner un `reglementId` d'une autre caisse s'il peut se déclarer admin. Les deux tâches sont donc complémentaires mais **TASK-070 est la faille racine** — sans elle, n'importe quel contrôle d'autorisation ajouté côté GRC_WEB (caisse, `IsAdmin`, ou futur) est contournable par construction, quel que soit le soin apporté à TASK-069.

## Objectif

1. Générer une clé de signature JWT forte (256 bits minimum), **spécifique à chaque déploiement client**, jamais partagée entre environnements.
2. La lire exclusivement depuis une source non versionnée : `dotnet user-secrets` en dev, variable d'environnement (`Jwt__Key`) ou config hors dépôt en prod — même mécanisme que celui retenu pour TASK-068 (cohérence des deux corrections).
3. **Supprimer la valeur de repli codée en dur** ([Program.cs:54](../GRC.API/Program.cs#L54) et [:215](../GRC.API/Program.cs#L215)) : si `Jwt:Key` est absente de la configuration, l'application doit refuser de démarrer (`throw new InvalidOperationException(...)`, même pattern que `DefaultConnection` absente, [Program.cs:72-73](../GRC.API/Program.cs#L72-L73)) plutôt que de silencieusement retomber sur une clé publique. Fail-closed, pas fail-open.
4. Toute session existante signée avec l'ancienne clé de repli devient invalide après déploiement (comportement attendu et voulu — c'est justement l'objectif : personne ne doit plus pouvoir présenter un token signé avec la clé publique).

## Fichiers concernés

- `GRC.API/Program.cs:54` — lecture de `Jwt:Key`, suppression du `?? "..."`, remplacé par une garde qui throw si absente.
- `GRC.API/Program.cs:215` — même clé, à factoriser si pertinent (actuellement dupliquée entre la config `AddJwtBearer` et la génération du token dans `/api/auth/login` — s'assurer qu'elles restent strictement identiques après correctif, sinon les tokens émis ne seront plus validés).
- `GRC.API/appsettings.json` / `appsettings.Development.json` — pas de clé en clair ajoutée ici ; suivre le mécanisme `user-secrets`/variable d'environnement.

## Contraintes

- Ne pas committer de valeur de clé, même « temporaire » ou « pour tester », dans un fichier versionné ou un message de commit.
- Ne pas réutiliser la clé de repli actuelle comme valeur de démarrage « pour ne pas casser la prod » — elle est compromise par construction (publique dans l'historique git). Générer une clé neuve.
- Coordination requise avec le déploiement de chaque client (l'app ne démarrera plus sans `Jwt:Key` configurée) — même remarque que TASK-068 sur le mécanisme d'injection en prod, à clarifier avec qui gère les déploiements avant de livrer.

## Risques / dépendances

- Tous les utilisateurs connectés au moment du déploiement seront déconnectés (tokens existants invalidés par le changement de clé) — communication au PO/utilisateurs à prévoir, pas un bug.
- Si plusieurs instances `GRC.API` tournent derrière un même load balancer (à vérifier — LAN fermé multi-postes, donc probablement une seule instance par client, mais à confirmer et ne pas supposer), toutes doivent partager la même `Jwt:Key`.
- Cette tâche et TASK-068 partagent le même mécanisme de secret (`user-secrets`/variable d'environnement) — envisager de les traiter dans la même fenêtre pour éviter deux allers-retours de configuration côté client, à arbitrer avec le PO.

## Checklist VALIDATION (remplie dans VERIFY/TASK-070_verify.md)

- [x] Build back OK (0 erreur)
- [x] `git grep -n "une_clef_secrete"` (ou équivalent) : plus aucune occurrence dans le code
- [x] Démarrage de `GRC.API` **sans** `Jwt:Key` configurée → échec explicite au démarrage (pas de démarrage silencieux avec une clé de repli)
- [x] Démarrage avec `Jwt:Key` configurée (dev via `user-secrets`) → OK, login fonctionnel, token émis et validé
- [x] Test réel : un JWT forgé hors application avec l'ancienne clé de repli (`"une_clef_secrete_longue_et_complexe_pour_le_dev"`) est **rejeté** (401) après déploiement
- [x] Non-régression : un utilisateur légitime se connecte, obtient un token signé avec la nouvelle clé, accède normalement aux endpoints dans son périmètre
- [x] Documentation (README ou équivalent) : comment générer/fournir `Jwt:Key` par déploiement client (dev = user-secrets, prod = variable d'environnement `Jwt__Key`)
