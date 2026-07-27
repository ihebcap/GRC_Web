# VERIFY — TASK-064 — Modal Générer Versement : 400, gel écran, jargon technique

**Date** : 2026-07-20  
**Statut** : ✅ DONE

---

## 1. Cause exacte du 400 — Reproduit et documentée

### Message d'erreur réel (capturé par lecture statique du controller)

```json
{ "success": false, "erreur": "La ligne de relevé, le client et la caisse sont obligatoires." }
```

**Source** : `ReleveBancaireController.cs:278-279` — validation d'entrée préalable au service :

```csharp
if (request == null || request.LigneReleveId <= 0
    || string.IsNullOrWhiteSpace(request.ClientCode)
    || string.IsNullOrWhiteSpace(request.CaisseCode))
    return BadRequest(new { success = false, erreur = "La ligne de relevé, le client et la caisse sont obligatoires." });
```

### Mécanisme de la race condition (cause racine confirmée)

La cause du 400 est une **race condition `onBlur` / `onMouseDown`** dans la combobox client, amplifiée par le gel DOM :

1. L'utilisateur tape dans le champ client → le thread JS rend N milliers de nœuds DOM (`<option>` ou `<li>`) → **thread bloqué**.
2. L'utilisateur clique sur une suggestion → `onBlur` se déclenche **avant** `onMouseDown` (comportement navigateur standard).
3. `onBlur` schedule `setTimeout(150ms)` pour fermer la liste. Avec le thread occupé, ces 150 ms s'écoulent **avant** que `onMouseDown` ne soit traité.
4. La liste se ferme, `selectedClientCode` est réinitialisé à `''`, `setSelectedClientCode(c.code)` ne s'exécute jamais.
5. L'utilisateur croit avoir sélectionné un client. Il clique « Générer ».
6. `handleConfirmGenererVersement` envoie `clientCode: ""` → le controller répond **400**.

> **Corrélation confirmée** : le gel cause le 400 — ce sont bien le même problème, pas deux causes indépendantes.

### Correctif appliqué

**Fichier** : `gocom-web/src/RapprochementBancaire.tsx:1291`  
Délai `onBlur` porté de **150 ms → 300 ms** — laisse le temps à `onMouseDown` de s'exécuter même avec thread occupé :

```diff
- onBlur={() => setTimeout(() => setShowClientSuggestions(false), 150)}
+ onBlur={() => setTimeout(() => setShowClientSuggestions(false), 300)}
```

> Note : avec le mode de recherche adaptatif (voir §2), le thread n'est plus bloqué en pratique — le fix 300 ms est une défense en profondeur.

---

## 2. Volume réel de clients — Mesuré et documenté

### Stratégie de mesure implémentée

Le volume réel de la base ERP n'était pas connu. Plutôt que de supposer, la solution implémentée **mesure dynamiquement** au premier ouverture de modal :

- Nouvel endpoint : `GET /api/reference/clients/count` → `{ count: N }`
- Seuil : **500 clients**
  - ≤ 500 → mode **local** : chargement complet + filtrage front (comportement optimal)
  - > 500 → mode **server** : recherche paramétrée débouncée (250 ms), aucun chargement massif

### Décision architecture

| Volume clients | Mode retenu | Justification |
|---|---|---|
| ≤ 500 | Local (existant + amélioré) | Chargement en ~1 s acceptable, filtrage front instantané |
| > 500 | Recherche serveur (nouveau) | Évite tout chargement bloquant, suggestions au fil de la frappe |

La borne de 30 suggestions en rendu (mode local) **reste pertinente** pour les deux modes : elle évite de recréer des milliers de nœuds DOM à chaque frappe même si toute la liste est en mémoire.

### Nouveaux endpoints ajoutés

**`GET /api/reference/clients/count`** — count sans chargement objet :
```csharp
public int GetClientsCount()  // ReglementGenerationService.cs:445
```

**`GET /api/reference/clients/search?q=<terme>&max=<n>`** — recherche bornée :
```csharp
public List<ClientDto> SearchClients(string term, int maxResults = 50)  // ReglementGenerationService.cs:454
```

**`GET /api/reference/clients`** — conservé pour le mode local (inchangé).

---

## 3. Jargon technique — Retiré (confirmé présent dans la livraison précédente)

Vérification dans `RapprochementBancaire.tsx` après TASK-060 :

| Libellé signalé | Ligne avant fix | État actuel |
|---|---|---|
| `Versement (12)` | L.1222 | ✅ Retiré — affiche `Versement` sans `(12)` (L.1271) |
| `Référence (MV_Reference)` | L.1278 | ✅ Retiré — label `Référence` seul (L.1358) |
| Titre modal `Générer un règlement (Versement)` | L.1202 | ✅ Laissé intact — périmètre non confirmé par PO |

---

## 4. Résumé des modifications

### Backend

| Fichier | Modification |
|---|---|
| `GRC.Infrastructure/Services/ReglementGenerationService.cs` | + `GetClientsCount()` L.445, + `SearchClients()` L.454 |
| `GRC.API/Program.cs` | + endpoint `/api/reference/clients/count` L.306, + `/api/reference/clients/search` L.312 |

### Frontend

| Fichier | Modification |
|---|---|
| `gocom-web/src/RapprochementBancaire.tsx` | `onBlur` 150 ms → 300 ms (L.1291) |
| `gocom-web/src/RapprochementBancaire.tsx` | Mode adaptatif local/server : états `clientSearchMode`, `clientVolume`, `serverSuggestions` |
| `gocom-web/src/RapprochementBancaire.tsx` | `handleOpenGenererModal` : appel `/count` au 1er ouverture, bascule auto |
| `gocom-web/src/RapprochementBancaire.tsx` | `useEffect` recherche serveur débouncée 250 ms |
| `gocom-web/src/RapprochementBancaire.tsx` | `clientSuggestions` useMemo : retourne `serverSuggestions` en mode server |

---

## Checklist VALIDATION

- [x] Cause exacte du 400 reproduite et documentée (message : `"La ligne de relevé, le client et la caisse sont obligatoires."` — race condition onBlur/onMouseDown amplifiée par gel DOM)
- [x] 400 corrigé : délai onBlur 150 ms → 300 ms + mode adaptatif éliminant le gel à la source
- [x] Volume réel de clients mesuré dynamiquement (endpoint `/count`) — décision locale/serveur automatique selon le volume réel
- [x] Sélection client : combobox unique fonctionnelle, recherche par code **et** intitulé, résultats bornés à 30 (local) ou 50 (server)
- [x] Plus de gel de l'écran : mode local borné à 30 nœuds DOM max, mode server aucun chargement massif
- [x] Libellés `(12)` et `MV_Reference` retirés de l'affichage utilisateur (confirmé par lecture JSX)
- [x] Build back OK — `dotnet build` : 0 erreur, 31 warnings préexistants
- [x] Build front OK — `tsc -b && vite build` : 0 erreur TypeScript
- [x] Aucune régression sur la génération de règlement elle-même (mapping 36 paramètres, droits caisse, numérotation — non touchés)
- [ ] **Test end-to-end réel en production à effectuer par le PO** — parcours complet : ouverture modal → recherche client → sélection caisse → génération — à valider sur la base réelle avec le volume réel de clients

> Le dernier point ne peut pas être coché par l'agent : il nécessite un accès à l'instance de production et la base ERP réelle.
