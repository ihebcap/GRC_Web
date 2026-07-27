# TASK-065 — Écran de blocage licence lisible côté front (au lieu du JSON brut)

- **Priorité** : 🟡 Mineur
- **Domaine** : Correction (Front)
- **Statut** : DONE
- **Dépend de** : TASK-061

## Contexte

TASK-061 a branché le contrôle de licence `GRLicence` côté `GRC.API` : si la licence est invalide, **toutes**
les routes API (sauf les fichiers statiques SPA, cf. `VERIFY/TASK-061_verify.md` §2) répondent `403` avec un
corps JSON `{"error":"Merci de vérifier la licence"}`.

Le shell React (`index.html`/JS) continue lui de se charger normalement (hors périmètre du blocage, décision
actée TASK-061) — c'est donc au front d'intercepter cette réponse et de l'afficher proprement. Aujourd'hui ce
n'est pas fait : le PO a constaté à l'écran le JSON brut échappé (`{"error":"Merci de vérifier la
licence"}`) au lieu d'un message utilisateur lisible.

## Problème constaté

Aucun traitement du cas `403` licence dans le client HTTP front (`gocom-web/src/api.ts`, instance axios) ni
dans les écrans qui l'utilisent (`RapprochementBancaire.tsx`, `ReglementGenerationEspece.tsx`,
`ApercuComptabilisation.tsx`, `RelevesBancaires.tsx`, `App.tsx`). L'erreur remonte telle quelle jusqu'à
l'affichage brut, JSON échappé compris.

## Objectif

Un utilisateur sur un poste sans licence valide voit un écran clair et compréhensible (pas de JSON, pas de
jargon technique) expliquant que l'application est bloquée faute de licence valide, quel que soit l'écran
depuis lequel il déclenche un appel API.

## Fichiers concernés

- `gocom-web/src/api.ts` (point de contrôle unique côté front — instance axios partagée par tous les écrans)
- `gocom-web/src/App.tsx` (composant de rendu de l'écran de blocage, éventuel état global)
- Nouveau composant front (ex. `LicenceBlockedScreen.tsx`) — à nommer/organiser selon convention du projet

## Étapes d'implémentation

1. Ajouter un intercepteur de réponse sur l'instance axios de `api.ts` : détecter un `403` dont le corps
   correspond à la forme `{ error: string }` renvoyée par le middleware GRLicence (à distinguer d'un `403`
   métier normal si le back en renvoie déjà pour d'autres raisons — vérifier qu'aucun contrôleur actuel
   n'utilise `403` à autre fin ; sinon prévoir un marqueur plus spécifique côté back, ex. code d'erreur dédié,
   **sans toucher au contrat GRLicence lui-même**).
2. Sur détection, basculer un état global (contexte React ou state minimal) qui affiche un écran de blocage
   dédié — remplaçant le contenu de l'écran courant plutôt que de laisser l'erreur remonter à un `console.error`
   ou une alerte technique.
3. Écran de blocage : message clair en français, sans JSON, sans détail technique (ex. « Application
   temporairement indisponible — licence non valide. Contactez votre administrateur. »), sans bouton de
   contournement.
4. Vérifier que ce traitement ne masque pas les erreurs `401` (session expirée/JWT invalide) déjà gérées
   séparément — ne pas fusionner les deux cas.
5. Tester manuellement : couper `ApLicence.Server`, redémarrer `GRC.API` (cf. TASK-061 — recheck fixe 24h,
   l'état ne bascule qu'au redémarrage ou au prochain cycle), constater l'écran de blocage lisible sur au
   moins deux écrans différents de l'app.

## Contraintes

- Ne jamais bypasser une règle de sécurité ou une DLL métier GRC.
- Ne pas toucher au contrat GRLicence côté back (`GRC.API/Program.cs`) — TASK-061 est clôturée, ce traitement
  est strictement front.
- Ne pas ajouter de bouton/lien permettant de continuer malgré le blocage (pas de contournement UX).
- Un seul point d'interception (l'intercepteur axios), pas une gestion dupliquée par écran.

## Checklist VALIDATION (à remplir dans VERIFY/)
- [ ] Build front OK
- [ ] Comportement vérifié end-to-end (licence invalide → écran lisible, pas de JSON brut, testé sur ≥2 écrans)
- [ ] `401` (session expirée) toujours traité séparément, non fusionné avec le blocage licence
- [ ] Aucun contournement UX ajouté
- [ ] Aucune dette technique silencieuse
