# TASK-093 — Bouton « Modifier » du règlement introuvable par le PO (condition d'affichage trop restrictive ?)

- **Priorité** : 🟠 Majeur
- **Domaine** : Correction (Front, UX)
- **Statut** : TODO
- **Dépend de** : — (chevauchement de fichier avec TASK-092 — même bloc JSX `App.tsx:770-816` ;
  traiter l'une après l'autre, pas en parallèle, pour éviter un conflit de merge)

## Contexte

Remontée PO (2026-09-29) : « je trouve pas le bouton pour modifier un règlement » sur l'écran de
liste des règlements ([App.tsx](../gocom-web/src/App.tsx)).

Exploration du code (2026-09-29) : le bouton **existe** déjà (livré par TASK-086, 2026-09-28) —
[App.tsx:775-788](../gocom-web/src/App.tsx#L775-L788). Il n'est cependant affiché que si **toutes**
ces conditions sont vraies pour la ligne :

```
!reg.isAnnule && reg.isComptabilise === 0 && !reg.isPointe && reg.isRemis === 0 && !reg.isAffecte
```

C'est-à-dire : règlement non annulé, non comptabilisé, non pointé (non rapproché bancaire), non
remis en banque, non affecté à une réservation. Si le règlement que le PO consultait remplit l'une
de ces conditions bloquantes (le cas le plus probable pour un règlement « ancien » dans la liste par
défaut est `isPointe` ou `isComptabilise`), le bouton est **silencieusement absent** — aucun indice
visuel n'explique pourquoi à l'utilisateur.

**Non confirmé à ce stade** : si cette restriction est un choix métier volontaire (documenté dans
TASK-086, à relire — `tasks/DONE_DETAIL/TASK-086.md`) ou si le PO attend de pouvoir modifier des
règlements dans un état où le bouton est aujourd'hui masqué. **Cadrage métier requis avant correction**
— ne pas assouplir les conditions sans validation PO explicite, un règlement comptabilisé/rapproché/
remis en banque pouvant avoir des contraintes d'intégrité comptable réelles (cf. `ReglementService.cs`,
appel DLL `CaisseManager.ReglementUpdate`).

## Objectif

Deux volets, à trancher avec le PO avant implémentation :

1. **UX minimal (sans changement de règle métier)** : quand le bouton Modifier n'est pas affiché,
   donner un indice visuel à l'utilisateur (ex. icône grisée avec `title` expliquant la raison —
   « Modification impossible : règlement comptabilisé », etc.) plutôt qu'une absence silencieuse.
2. **Règle métier (si le PO le demande après relecture du cadrage TASK-086)** : élargir les
   conditions d'affichage si certains états bloquants ne devraient pas l'être. Ne pas implémenter ce
   volet sans confirmation PO explicite sur *quel(s)* état(s) doivent redevenir modifiables.

## Fichiers concernés

- `gocom-web/src/App.tsx` (condition ligne 775, rendu bouton lignes 777-788)
- `tasks/DONE_DETAIL/TASK-086.md` (règle métier d'origine, à relire pour comprendre le pourquoi de
  chaque condition avant de la toucher)

## Étapes d'implémentation

1. Relire `tasks/DONE_DETAIL/TASK-086.md` pour retrouver la justification métier de chacune des 5
   conditions (`isAnnule`, `isComptabilise`, `isPointe`, `isRemis`, `isAffecte`).
2. Soumettre au PO la liste des conditions et leur justification, avec la question explicite :
   « dans quel(s) état(s) un règlement doit-il rester modifiable aujourd'hui bloqué ? » — consigner
   la réponse dans le VERIFY avant de coder quoi que ce soit qui change une condition.
3. Implémenter le volet 1 (indice visuel) dans tous les cas — c'est un gain UX sans risque métier.
4. Implémenter le volet 2 uniquement si le PO a validé un assouplissement précis.

## Contraintes

- Ne jamais assouplir une condition liée à l'intégrité comptable (`isComptabilise`, `isRemis`) sans
  validation PO explicite et documentée dans le VERIFY — cf. règle absolue « ne jamais improviser un
  contexte manquant ».
- Le volet 1 (indice visuel) ne doit pas donner l'impression que la modification est possible si
  elle ne l'est pas (pas de bouton actif qui échouerait silencieusement côté serveur).

## Checklist VALIDATION (à remplir dans VERIFY/)

- [ ] Justification de chaque condition relue et citée dans le VERIFY (référence `TASK-086.md`)
- [ ] Réponse PO consignée sur les états devant rester/redevenir modifiables
- [ ] Build front OK (0 erreur)
- [ ] Indice visuel (volet 1) vérifié sur au moins un règlement dans chaque état bloquant
      (comptabilisé, pointé, remis, affecté, annulé)
- [ ] Si volet 2 implémenté : condition modifiée cohérente avec la validation PO citée, aucun autre
      état bloquant touché
- [ ] Aucune dette technique silencieuse
- [ ] Cohérent avec l'architecture
