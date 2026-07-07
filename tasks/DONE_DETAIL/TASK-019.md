# TASK-019 — Filtre « Non rapprochés » : garder visibles les paires lettrées en session, épinglées en haut

- **Priorité** : 🟡 Mineur (UX écran rapprochement)
- **Domaine** : Frontend / UX
- **Statut** : DONE — validé le 2026-07-07
- **Dépend de** : TASK-017 (réservation persistée + lettrage de session câblé) — **livrée**

## Contexte
Écran `RapprochementBancaire.tsx`. Le filtre de rapprochement de session (`lettrageFilter` : `non` | `oui` | `tous`) porte sur le **lettrage EN COURS de session** (paires GRC↔relevé posées mais non encore approuvées), à **ne pas confondre** avec « Pointé » (`isPointe`, rapprochement final en base GRC). Cf. commentaire [RapprochementBancaire.tsx:212-215](../gocom-web/src/RapprochementBancaire.tsx#L212-L215) et mémoire projet « rapprochement-reservation-2-phases ».

## Problème constaté
En mode « Non rapprochés » (`non`), dès qu'une paire est lettrée (auto ou manuel), elle **disparaît immédiatement** des deux grilles :
- GRC — `filteredReglements` masque si `estRapproche = !!r.lettrage || r.isPointe` ([RapprochementBancaire.tsx:707-725](../gocom-web/src/RapprochementBancaire.tsx#L707-L725)).
- Relevé — `filteredLignes` masque si `estRapproche = !!l.lettrage` ([RapprochementBancaire.tsx:727-744](../gocom-web/src/RapprochementBancaire.tsx#L727-L744)).

Conséquence : l'utilisateur perd de vue ce qu'il vient d'apparier ; impossible de relire les paires en cours avant « Approuver » sans repasser en « Tous » (qui réaffiche aussi le pointé final, bruit inutile).

## Objectif (cadré PO — 2026-07-07)
Deux invariants posés par le PO :

- **Invariant A — le filtre du haut travaille TOUJOURS en session.** `lettrageFilter` (`non`/`oui`/`tous`) porte **exclusivement** sur le `lettrage` de session. **Aucune référence à `isPointe`** dans le filtre client.
- **Invariant B — la liste GRC ne remonte QUE des règlements non pointés, depuis la base.** L'exclusion du pointé final se fait au niveau de la **requête `/reglements`** (paramètre `pointe=false`), pas dans le filtre client.

Conséquences fonctionnelles en mode « Non rapprochés » :
1. Les paires **lettrées en session** (`!!lettrage`) restent **visibles** dans les deux grilles.
2. Aucun règlement **pointé final** n'apparaît (il n'est plus chargé — Invariant B).
3. Les lignes/règlements lettrés en session sont **épinglés en haut** des **deux** grilles (Relevé **et** GRC), au-dessus du reste du backlog.

Portée confirmée : **session uniquement**. Épinglage sur **les deux grilles**.

## Fichiers concernés
- `gocom-web/src/RapprochementBancaire.tsx` (frontend uniquement — aucune modif backend/DB)

## Étapes d'implémentation

### 1. Invariant B — charger uniquement les règlements NON pointés
Dans le chargement des règlements GRC ([RapprochementBancaire.tsx:329](../gocom-web/src/RapprochementBancaire.tsx#L329)), ajouter `&pointe=false` à l'appel `/reglements` (le paramètre `pointe` est déjà supporté par l'API — [ReglementController.cs:35](../GRC.API/Controllers/ReglementController.cs#L35) → [ReglementService.cs:84-86](../GRC.Infrastructure/Services/ReglementService.cs#L84-L86)). Aucune modif backend.
```ts
// …&banqueNos=${selectedBanqueId}&page=1&pageSize=1000&pointe=false${dateParams}
```
→ Le pointé final sort au niveau **requête DB** (bonne couche). Le filtre client n'a plus à connaître `isPointe`.

### 2. Invariant A — `filteredReglements` (GRC) : filtre 100 % session
Le filtre ne porte plus que sur le `lettrage` de session ; **supprimer toute référence à `isPointe`** ([RapprochementBancaire.tsx:707-709](../gocom-web/src/RapprochementBancaire.tsx#L707-L709)) :
```ts
// avant : const estRapproche = !!r.lettrage || r.isPointe;
//         if (lettrageFilter === 'oui' && !estRapproche) return false;
//         if (lettrageFilter === 'non' && estRapproche) return false;
// après :
if (lettrageFilter === 'oui' && !r.lettrage) return false;
// 'non' et 'tous' : aucun masquage sur le lettrage (les paires de session
// restent visibles, épinglées en haut — cf. §4)
```

### 3. `filteredLignes` (Relevé) : filtre 100 % session
Symétrique, le relevé n'ayant de toute façon pas d'état pointé ([RapprochementBancaire.tsx:727-730](../gocom-web/src/RapprochementBancaire.tsx#L727-L730)) :
```ts
if (lettrageFilter === 'oui' && !l.lettrage) return false;
// 'non' et 'tous' : aucun masquage sur le lettrage
```
> Les lignes réservées par un autre restent visibles verrouillées (cadenas), cohérent avec le modèle de réservation.

### 4. Épinglage en haut des deux grilles (`sortedReglements` / `sortedLignes`)
Dans les deux comparateurs de tri ([RapprochementBancaire.tsx:746-772](../gocom-web/src/RapprochementBancaire.tsx#L746-L772)), faire précéder le tri courant d'un critère « lettré de session d'abord » :
```ts
const aL = !!a.lettrage, bL = !!b.lettrage;
if (aL !== bL) return aL ? -1 : 1;   // lettrés de session épinglés en haut
// (optionnel, lisibilité) entre lettrés : ordre par lettrage
if (aL && bL && a.lettrage !== b.lettrage)
    return String(a.lettrage).localeCompare(String(b.lettrage));
// puis tri existant (grcSort / releveSort) …
```
- L'épinglage s'applique quel que soit le tri utilisateur actif (il le **précède**).
- Pertinent en `non` et `tous` ; en `oui` toutes les lignes sont lettrées (sans effet).
- Utiliser `!!lettrage` (session), **jamais** `isPointe`, comme critère d'épinglage.

## Contraintes
- **Frontend strict** : aucune modification backend, API ou DB (le paramètre `pointe` existe déjà). Aucune écriture base.
- **Invariant A** : le filtre client ne référence **jamais** `isPointe` — 100 % `lettrage` de session.
- **Invariant B** : le pointé final est exclu à la **requête** (`pointe=false`), pas dans le filtre — c'est la bonne couche (anti-« pansement » rejeté en TASK-016/017).
- Ne pas confondre `lettrage` (session) et `isPointe` (final) : c'est l'invariant de tout l'écran.
- Aucune régression du repérage visuel des paires (lettre commune, surlignage `lettered-row`) ni du verrouillage « réservé par un autre » (cadenas).
- Ne pas toucher aux autres bornes de chargement (dates appliquées, banque) ni aux compteurs « N élément(s) affiché(s) » (ils suivent naturellement les listes filtrées).

## Risques / dépendances
- Faible : 1 ligne de fetch (`pointe=false`) + 4 `useMemo` (`filteredReglements`, `filteredLignes`, `sortedReglements`, `sortedLignes`).
- **Reprise de lettrage après refresh** : vérifier qu'un règlement lettré en session mais devenu `isPointe=false` (donc encore chargé) reste bien repris ; un règlement **déjà pointé** ne sera plus chargé — s'assurer que ça ne casse pas la reconstruction de paires au refresh (une paire n'est jamais approuvée d'un seul côté).
- Conséquence assumée : `pointe=false` excluant le pointé de la source, les modes `non` et `tous` affichent le **même** ensemble (pointé jamais présent). Voir note en fin de fiche.
- Vérifier que le compteur de bas de grille reflète bien le nouveau contenu affiché.
- Vérifier l'interaction avec les filtres colonne Excel (les paires épinglées restent soumises aux filtres colonne — comportement voulu).

## Checklist VALIDATION (à remplir dans VERIFY/)
> ⚠️ Spec révisée (Invariants A/B) — à revalider intégralement.
- [x] Build OK
- [x] **Invariant B** : `/reglements` appelé avec `pointe=false` → aucun règlement pointé final dans la grille GRC
- [x] **Invariant A** : plus **aucune** référence à `isPointe` dans `filteredReglements` / `filteredLignes`
- [x] Mode « Non rapprochés » : après auto/lettrage manuel, la paire **reste visible** dans les 2 grilles, **épinglée en haut**
- [x] Mode « Rapprochés (en cours) » : n'affiche **que** les lettrés de session (`!!lettrage`)
- [x] Dissociation d'une paire : la ligne quitte le haut et réintègre le backlog
- [x] Reprise après refresh : les paires en cours (non approuvées) se reconstruisent (pas cassées par `pointe=false`)
- [x] Aucune régression : cadenas « réservé par un autre », surlignage de paire, filtres colonne, compteurs
- [x] Aucune modif backend/API/DB (paramètre `pointe` préexistant) ; aucune écriture base

## Note — deux axes à NE PAS confondre
Le pointé de la **base** et le rapproché de **session** sont deux choses **indépendantes** :

- **Liste GRC** (ce qui est chargé) : source = **base**, on ne charge que le **non pointé** (`pointe=false`). C'est une règle de **chargement**, pas un filtre.
- **Filtre « Non rapprochés »** (dropdown du haut) : son **critère** est le **rapproché de SESSION** (`lettrage`), **jamais** `isPointe`. En mode `non`, les paires de session ne sont **pas cachées** : elles sont **épinglées en haut** (pour ne pas perdre le travail en cours avant Approuver), le backlog non lettré suivant dessous.

Autrement dit : le filtre ne « voit » que la session ; le pointé base est déjà écarté en amont (chargement), il n'entre pas dans la définition du filtre.