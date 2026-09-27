# TASK-083 — Lenteur écran liste des règlements (8 Mo / requête, 14-38s)

- **Priorité** : 🔴 Bloquant
- **Domaine** : Performance (Backend Infrastructure + API), Front
- **Statut** : TODO
- **Dépend de** : rien. Touche `ReglementService.GetReglements`, utilisé par l'écran principal
  (`App.tsx`) — vérifier les autres appelants avant de livrer (cf. Risques).

## Contexte

Constat PO (2026-09-27) sur trace réseau navigateur : l'appel `GET /api/reglements?...` prend entre
**14,30 s et 38,10 s** par requête, pour une réponse de **8 078 Ko (~8 Mo)**, répété **4 fois
d'affilée** en quelques secondes au chargement de l'écran liste des règlements (`App.tsx`, grille
principale GRC_WEB).

## Diagnostic

Établi par lecture de code (back + front) et vérification du **code source réel** de la DLL
Trésorerie (`apbs-gr_winform/src/Tresorerie.Dapper/Repositories/ReglementClientRepository.cs:230-247`
+ `ReglementClientRepository.Script.cs:9-135`) :

1. **Fenêtre de dates par défaut beaucoup trop large.** Quand le front n'envoie pas de filtre date
   (utilisateur n'a rien saisi), [ReglementService.cs:40-41](../GRC.Infrastructure/Services/ReglementService.cs#L40)
   interroge la DLL sur **`2000-01-01` → `2030-01-01`**, soit l'historique complet du périmètre
   caisses. La méthode appelée, `ReglementClientRepository.GetAll(societeNo, dateDebut, dateFin,
   caissesNo)`, exécute un vrai SQL Dapper filtré `WHERE SO_Id=@SocieteNo AND CA_IdOut IN @CaissesNo
   AND MV_Date BETWEEN @DateDebut AND @DateFin` — le filtre date est donc bien poussé en SQL, mais
   la largeur de plage envoyée par défaut annule cet avantage.
2. **Pas de pagination SQL, pas de filtre serveur sur les autres critères.** La requête SQL de la
   DLL ne contient ni `TOP`/`OFFSET-FETCH`, ni de condition sur client/numéro/pièce/référence/
   libellé/montant/pointé/comptabilisé/remis/impayé/annulé/banque/mode. Tous ces filtres, plus la
   pagination (`ReglementController.cs:73-76` : `Skip/Take` après `Count()`), sont appliqués **en
   mémoire en C#** dans `ReglementService.GetReglements` ([ReglementService.cs:66-178](../GRC.Infrastructure/Services/ReglementService.cs#L66)),
   sur l'intégralité du jeu ramené par la DLL. C'est la méthode la plus fine que la DLL propose pour
   ce cas d'usage ; pousser ces filtres en SQL impliquerait de modifier la DLL métier, ce qui est
   hors périmètre (règle absolue du projet — DLL non modifiable).
3. **4 requêtes en rafale côté front**, cohérent avec les 4 `useEffect` indépendants d'
   [App.tsx:331-349](../gocom-web/src/App.tsx#L331) qui appellent chacun `fetchReglements` (reset
   page, changement page, changement pageSize, changement tri). Le garde-fou `fetchSeqRef`
   (App.tsx:622,625,630) n'empêche que l'**application** des réponses obsolètes, pas leur
   **déclenchement** — chaque requête inutile continue de coûter 14-38s côté serveur.

**Conclusion : le seul levier disponible sans modifier la DLL est de réduire la fenêtre de dates par
défaut.** Une fois le `BETWEEN` SQL borné, le volume ramené — et donc le coût du filtrage/pagination
en mémoire qui suit — chute proportionnellement.

## Décision PO (2026-09-27)

Fenêtre de dates par défaut = **30 jours glissants** (au lieu de 2000-2030), **modifiable par
l'utilisateur après coup**. Ce mécanisme de modification existe déjà côté front : le filtre colonne
"Date" ([App.tsx:1168](../gocom-web/src/App.tsx#L1168), `ExcelFilter` mode date) envoie déjà
`dateDebut`/`dateFin` dès que l'utilisateur pose une valeur ([App.tsx:506-511](../gocom-web/src/App.tsx#L506))
— **aucun nouveau composant front à créer**, seule la valeur par défaut change côté back quand ces
paramètres ne sont pas fournis.

## Objectif

- Un chargement d'écran sans filtre explicite ne charge que les 30 derniers jours, pas 30 ans
  d'historique.
- L'utilisateur retrouve un règlement plus ancien en élargissant simplement le filtre "Date" déjà
  existant — pas de bouton ou mécanisme supplémentaire à construire.
- Un changement combiné d'état (page + tri + filtre) ne déclenche qu'un seul fetch réseau, pas un
  par `useEffect` indépendant.
- Temps de réponse de la liste ramené à quelques secondes en usage normal sur le jeu de données réel
  de prod (à mesurer avant/après, pas de cible chiffrée imposée a priori).

## Fichiers concernés

- `GRC.API/Controllers/ReglementController.cs:26-77` (`GetReglements`, pagination `Skip/Take`)
- `GRC.Infrastructure/Services/ReglementService.cs:27-237` (`GetReglements`, fenêtre de dates par
  défaut ligne 40-41, filtrage en mémoire ligne 66-178)
- `gocom-web/src/App.tsx:330-349,618-632` (`fetchReglements`, les 4 `useEffect` déclencheurs,
  `fetchSeqRef`), `App.tsx:1168` (filtre colonne "Date" existant, à ne pas modifier)

## Étapes d'implémentation

1. Dans `ReglementService.GetReglements` ([ReglementService.cs:40-41](../GRC.Infrastructure/Services/ReglementService.cs#L40)) :
   remplacer `debut = dateDebut ?? new DateTime(2000, 1, 1)` par
   `debut = dateDebut ?? DateTime.Now.Date.AddDays(-30)`, et
   `fin = dateFin ?? new DateTime(2030, 1, 1)` par
   `fin = dateFin ?? DateTime.Now.Date.AddDays(1).AddSeconds(-1)` (fin de journée courante, cohérent
   avec le pattern déjà utilisé côté front pour `dateFin`, cf. App.tsx:510). Seule la valeur par
   défaut change ; dès que `dateDebut`/`dateFin` sont fournis, ils priment sans changement de
   comportement.
2. Côté front, fusionner les 4 `useEffect` de déclenchement de fetch en un seul point d'entrée (ex.
   `useEffect` unique sur un objet d'état combiné `{page, pageSize, sortCol, sortDesc,
   debouncedFilters}`) pour éliminer les requêtes en rafale — sans changer le comportement
   fonctionnel actuel (reset de page sur changement de filtre/tri/pageSize à préserver).
3. Mesurer le temps de réponse et le volume de lignes avant/après sur le jeu de données réel de
   prod (pas seulement en dev).

## Contraintes

- Ne jamais bypasser une règle de sécurité ou une DLL métier GRC ; ne pas modifier
  `ReglementClientRepository` ni recoder sa logique de filtrage/pagination.
- Respecter la Clean Architecture (Domain ← Application ← Infrastructure/API).
- Le scoping caisses/société (isAdmin, `caissesList`) doit rester strictement identique.
- Le filtre "Date" front existant ne doit subir aucune régression fonctionnelle.

## Risques / dépendances

- Le filtrage fin (client, montant, pointé, etc.) reste en mémoire après correctif, sur un jeu
  réduit par la fenêtre de dates — compromis accepté, la DLL n'étant pas modifiable.
- **Vérifié (aucun risque)** : `GetDistinctReglements` ([ReglementService.cs:255](../GRC.Infrastructure/Services/ReglementService.cs#L255))
  a sa propre fenêtre par défaut (12 mois glissants, indépendante) et `LettrerParPeriode`
  ([ReglementService.cs:486,494](../GRC.Infrastructure/Services/ReglementService.cs#L486)) reçoit
  `dateMin`/`dateMax` obligatoirement en paramètre — aucun des deux ne dépend de la valeur par
  défaut modifiée dans `GetReglements`.

## Checklist VALIDATION (à remplir dans VERIFY/)
- [ ] Build OK (back + front)
- [ ] Fenêtre de dates par défaut = 30 jours glissants, `dateFin` par défaut = fin de journée courante
- [ ] Filtre "Date" front toujours fonctionnel pour élargir/réduire la période après coup (aucune régression)
- [x] `GetDistinctReglements`/`LettrerParPeriode` non affectés par le changement (vérifié par l'architecte 2026-09-27 — fenêtres de dates indépendantes, cf. Risques)
- [ ] Comportement vérifié end-to-end sur jeu de données réel (pas seulement dev) — temps de réponse mesuré avant/après
- [ ] Aucune régression de scoping caisses/société (isAdmin et périmètre caisse identiques)
- [ ] Aucun credential/secret en dur introduit
- [ ] Aucune dette technique silencieuse
- [ ] Cohérent avec l'architecture (DLL Trésorerie non recodée, Clean Architecture respectée)
