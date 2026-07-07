# TASK-002 — Garde d'accès minimale sur les endpoints API (version LAN)

- **Priorité** : 🟠 Majeur (recalibré — LAN 100%)
- **Domaine** : Sécurité
- **Statut** : TODO
- **Dépend de** : —

> **Scope LAN** : réseau fermé, remplacement d'une WinForm en confiance réseau. Pas de JWT/OAuth complet.
> Objectif minimal : ne pas laisser les endpoints d'écriture (`/rapprochement`, `/comptabiliser`, `/relevebancaire/validate`) **totalement anonymes**, et dériver le périmètre société/caisses de l'identité, pas d'un paramètre de requête arbitraire. Un jeton simple issu du `/login` suffit.

## Contexte
`/api/auth/login` vérifie bien le hash (via `Tresorerie.Infrastructure.PasswordHasher`) mais ne délivre **aucun jeton/session**. Tous les autres endpoints sont accessibles sans authentification.

## Problème constaté
- `/api/reglements`, `/api/rapprochement`, `/api/reglements/comptabiliser`, `/api/relevebancaire/validate`… écrivent/lisent en base **sans contrôle d'accès**.
- Aucune vérification des droits utilisateur (caisses/société) alors que `analyse_rapprochement.md` impose « la gestion des droits utilisateurs existante ».
- Le login charge **toutes** les caisses de la société si la liste utilisateur est vide (hypothèse « Administrateur ») — élévation de privilège implicite.

## Objectif
Aucun endpoint métier accessible sans authentification ; le périmètre (société/caisses) est dérivé de l'identité authentifiée, pas d'un paramètre de requête arbitraire.

## Fichiers concernés
- `GRC.API/Program.cs`
- Nouveau service d'émission/validation de token (JWT ou cookie de session).

## Étapes d'implémentation
1. À la connexion réussie, émettre un token signé (JWT) contenant `UserId`, `SocieteId`, et les caisses autorisées.
2. Ajouter `AddAuthentication`/`AddAuthorization` + middleware ; protéger tous les endpoints métier (`RequireAuthorization`).
3. Dériver `societeId`/`caisses` **du token**, pas de la query string, dans `/api/reglements` et suivants.
4. Retirer le fallback « charge toutes les caisses » ou le restreindre à un rôle admin explicitement vérifié.

## Contraintes
- Respecter la logique de droits déjà portée par les DLLs GRC (ne pas la réimplémenter en la contournant).

## Checklist VALIDATION (à remplir dans VERIFY/)
- [ ] Build OK
- [ ] Appel non authentifié → 401 sur tous les endpoints métier
- [ ] Le périmètre société/caisses provient du token
- [ ] Pas d'élévation de privilège via liste de caisses vide
- [ ] Cohérent avec l'architecture
