# TASK-075 — Faille IDOR : endpoints de lecture ReleveBancaireController sans contrôle société/caisse

- **Priorité** : 🔴 Bloquant
- **Domaine** : Sécurité
- **Statut** : TODO
- **Dépend de** : —

## Contexte

Audit architecte du 2026-09-24 (5 passages d'analyse croisée sur les filtres de grille, dont un
angle dédié sécurité/autorisation) : `GRC.API/Controllers/ReleveBancaireController.cs` protège
correctement tous ses endpoints d'écriture (réservation, validation, génération de règlement,
suppression) via un recroisement des claims JWT (`SocieteId`/`Caisses`) — pattern identique à
`ReglementController.cs`. Mais 3 endpoints de **lecture** du même contrôleur n'ont aucun contrôle
équivalent.

## Problème constaté

```csharp
// GRC.API/Controllers/ReleveBancaireController.cs
[HttpGet]
public async Task<IActionResult> GetEntetes([FromQuery] int banqueId, [FromQuery] bool nonRapprochesSeulement = false)
{
    var entetes = await _releveRepository.GetEntetesByBanqueAsync(banqueId, nonRapprochesSeulement);
    return Ok(entetes);
}

[HttpGet("{id}/lignes")]
public async Task<IActionResult> GetLignes(int id) { ... }

[HttpGet("{id}/etat")]
public async Task<IActionResult> GetEtatRapprochement(int id) { ... }
```

Ces 3 endpoints ne lisent aucun claim JWT (pas de `SocieteId`, pas de `Caisses`) — seule la présence
d'un JWT valide est requise (`[Authorize]` au niveau contrôleur). Les repos correspondants
(`GetEntetesByBanqueAsync`, `GetAllLignesExcelAsync`, `GetEtatRapprochementAsync`) filtrent
uniquement par `banqueId`/`enteteId` fourni par le client, sans recroisement société/caisse.

**Scénario d'exploitation concret** : un utilisateur authentifié (JWT valide, périmètre de caisses
restreint) peut :
- Appeler `GET /api/ReleveBancaire?banqueId=<id d'une banque hors de son périmètre>` → liste des
  relevés bancaires de cette banque, même hors de sa société.
- Itérer/deviner des `id` d'en-tête de relevé (`GET /api/ReleveBancaire/{id}/lignes`, `/etat`) — IDs
  probablement séquentiels — pour lire le détail de lignes de relevés bancaires (montants, dates,
  libellés, `ReglementCaisseNo`, `ReglementClient`) d'une autre société/caisse à laquelle il n'a pas
  droit.

Impact : fuite de lecture (IDOR) de données bancaires/comptables cross-société. Pas d'écriture
possible (les actions de modification restent protégées).

Constat annexe hors périmètre strict de cette TASK, à signaler : `POST /api/ReleveBancaire/upload`
n'a pas non plus de contrôle que `banqueId` (form-data) appartient à la société de l'utilisateur —
c'est une action d'écriture, contrairement aux 3 endpoints ci-dessus, mais elle n'a pas le contrôle
d'autorisation caisse que les autres endpoints d'écriture du même contrôleur ont. Ne pas corriger
dans cette TASK sans clarification PO — juste le signaler dans le VERIFY.

## Objectif

Les 3 endpoints de lecture doivent recroiser `banqueId`/l'en-tête de relevé visé avec le périmètre
société/caisses de l'utilisateur authentifié (claims JWT), sur le modèle exact du mécanisme déjà
existant (`VerifierAutorisationReglementCaisse`/`VerifierAutorisationCaisse` déjà utilisé pour les
actions d'écriture du même repository). Toute requête hors périmètre doit répondre `403 Forbidden`
(pas `404`, pour rester cohérent avec le pattern déjà en place ailleurs — à confirmer par lecture du
pattern existant plutôt que supposé).

## Fichiers concernés

- `GRC.API/Controllers/ReleveBancaireController.cs`
- `GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs`

## Étapes d'implémentation

1. Identifier précisément le mécanisme déjà utilisé pour les endpoints d'écriture du même
   contrôleur (`VerifierAutorisationReglementCaisse`/équivalent) et sa source (claims JWT lues où,
   comment le repo relie `banqueId`/`enteteId` à une société/caisse).
2. `GetEntetes` : vérifier que `banqueId` fourni appartient bien à une caisse/société autorisée pour
   l'utilisateur avant d'appeler `GetEntetesByBanqueAsync` — sinon `403 Forbidden`.
3. `GetLignes`/`GetEtatRapprochement` : résoudre la société/banque propriétaire de l'en-tête de
   relevé `id` visé, comparer au périmètre JWT de l'utilisateur avant d'appeler le repo — sinon
   `403 Forbidden`.
4. Réutiliser le mécanisme existant plutôt qu'en inventer un nouveau (cohérence avec le reste du
   contrôleur).
5. Ne pas modifier le comportement des endpoints d'écriture déjà protégés.

## Contraintes

- Ne jamais bypasser une règle de sécurité ou une DLL métier GRC.
- Respecter la Clean Architecture (Domain ← Application ← Infrastructure/API).
- Réutiliser le mécanisme d'autorisation déjà existant dans ce même repository, ne pas en inventer
  un nouveau.
- Ne pas casser le fonctionnement normal des 3 endpoints pour un utilisateur dans son périmètre
  légitime — tester explicitement le cas nominal en plus du cas de rejet.

## Checklist VALIDATION (à remplir dans VERIFY/)
- [ ] Build OK
- [ ] Test réel : un utilisateur A (société/caisses limitées) ne peut plus lire les relevés/lignes/état
  d'une banque hors de son périmètre (403 constaté, pas juste lu dans le code)
- [ ] Test réel : le même utilisateur A continue de lire normalement les relevés de son propre
  périmètre (pas de régression fonctionnelle)
- [ ] Aucun credential/secret en dur introduit
- [ ] Aucune dette technique silencieuse
- [ ] Cohérent avec l'architecture (réutilisation du mécanisme d'autorisation existant, pas de
  nouveau composant)
