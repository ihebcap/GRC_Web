# VERIFY — TASK-067 : message « mode de règlement non paramétré » — ajouter l'intitulé

## État de départ de cette session

Le code de la TASK était **déjà implémenté et déjà committé** (commit `1c14f37`, 2026-07-27,
`ReglementService.cs:571-589`), mais **aucun VERIFY n'avait jamais été déposé** — TASK-067 est
restée dans la liste ACTIF de `TODO.md` depuis cette date. Cette session reprend le dossier en rôle
**worker de secours** (dérogation « Claude ne code pas » déjà validée par le PO, cf. `CLAUDE.md`) :
relecture complète du code trouvé, vérification de l'API DLL réellement utilisée (pas de confiance
aveugle), build, puis dépôt de ce VERIFY — **aucune clôture** (pas de déplacement vers
`DONE_DETAIL/`, pas de mise à jour `TODO.md`/`DONE.md`/`CHANGELOG.md`), conformément à la règle de
séparation stricte implémentation/clôture.

Aucune modification de code apportée dans cette session : le code existant a été jugé conforme à
l'objectif de la TASK après relecture (voir ci-dessous).

## Résumé de l'implémentation trouvée et relue

`ReglementService.VerifierComptabilisable` ([ReglementService.cs:556-569](../../GRC.Infrastructure/Services/ReglementService.cs#L556-L569))
inchangé dans son comportement (mêmes conditions de levée, même garde AVANT `Generate`) ; le message
du cas « mode introuvable » ([:568](../../GRC.Infrastructure/Services/ReglementService.cs#L568)) est
enrichi via un nouvel appel `DecrireModeReglement(reg.ModeReglementNo)`
([ReglementService.cs:576-589](../../GRC.Infrastructure/Services/ReglementService.cs#L576-L589)) :

- Résout l'intitulé via `_kernel.Resolve<Tresorerie.Core.Interfaces.IModeReglementRepository>().Get(modeReglementNo)?.Intitule`
  — pattern `_kernel.Resolve<T>()` identique à tous les autres usages de la classe (ex. `:317-321`,
  `:696`), pas de nouveau mécanisme introduit.
- Retourne `" (INTITULE)"` si trouvé, `string.Empty` sinon (mode introuvable dans le référentiel OU
  exception de résolution) — jamais de `null`/vide littéral injecté dans le message, conforme à
  l'objectif.
- `try/catch` **limité à la résolution de l'intitulé uniquement**, pas sur toute la méthode — respecte
  la contrainte « pas de `try/catch` large sur toute la méthode ». Une exception y est loggée en
  warning puis absorbée, jamais remontée : la garde ne peut pas devenir elle-même une nouvelle source
  d'exception non gérée.
- Message final produit, cas nominal : `"...le mode de règlement n°18 (RELAIS) n'est pas paramétré..."`
  — conforme à l'exemple de l'objectif de la TASK.

### Vérification de l'API DLL réellement utilisée (`inspect_tool`, Mono.Cecil sur `libs/Tresorerie/Tresorerie.Core.dll`)

Signature confirmée par introspection directe de l'assembly (pas supposée) :

```
Tresorerie.Core.Interfaces.IModeReglementRepository.Get(System.Int32 no) -> Tresorerie.Core.Models.ModeReglement
Tresorerie.Core.Models.ModeReglement.Intitule : System.String  get=True set=True
```

Le code utilise exactement `Get(int)` (et non l'autre surcharge `Get(string code)`, également
présente dans la DLL mais non pertinente ici) et la propriété `Intitule` — correspond bien à ce que
demandait l'étape 1 des instructions d'implémentation de la TASK (« ne pas supposer la signature,
inspecter la DLL »).

### Vérification "pas de N+1"

`VerifierComptabilisable` est appelée une fois par règlement dans la boucle de comptabilisation
([:364](../../GRC.Infrastructure/Services/ReglementService.cs#L364)) et de l'aperçu
([:838](../../GRC.Infrastructure/Services/ReglementService.cs#L838)), mais `DecrireModeReglement`
n'est invoquée **que dans la branche d'échec** (`mode == null`), donc jamais sur le chemin nominal
d'un lot de règlements correctement paramétrés — pas de coût supplémentaire mesurable sur le volume
habituel. Conforme au risque signalé dans la TASK.

### Point 4 des étapes d'implémentation (autres messages citant un numéro de mode brut)

`ReglementGenerationService.cs:149,373` cités dans la TASK comme "à confirmer en relisant" : lus,
citent bien un libellé en dur (mode fixe, contexte différent de `VerifierComptabilisable`) — aucun
changement nécessaire, conforme à ce qu'anticipait la TASK.

## Build

```
dotnet build GRC.slnx -c Debug
```
→ **0 erreur**, avertissements pré-existants uniquement (obsolescence `SqlConnection`, nullabilité,
conflit de version `System.Configuration.ConfigurationManager`), non liés à ce code. Vérifié cette
session, 2026-09-17.

## Test réel en base — **non exécuté cette session**

Pas de rejeu réel du règlement `51893` (mode 18 / caisse 121) ni d'un cas de mode introuvable en base
de test : aucun harness dédié à cette TASK n'existe (contrairement à TASK-051/069), et l'accès réel
au kernel Trésorerie depuis ce poste est un point d'incertitude déjà documenté séparément
(`VERIFY/TASK-069_verify.md`, blocage réseau vers `DESKTOP-2VCUE93` non lié à ce code). Validation
faite **uniquement par relecture de code + confirmation de signature DLL par `inspect_tool`** —
même niveau de preuve que celui accepté par le PO pour TASK-069.

**Bénéfice utilisateur** : nul tant que le message n'est pas rejoué en conditions réelles, mais
TASK-055 (panneau d'affichage des messages métier) est **livrée le 2026-09-17** — le message est
donc désormais visible à l'écran quand il se produit, ce qui rend ce changement exploitable dès
qu'un cas réel se présente.

## Checklist VALIDATION

- [x] Build back OK (0 erreur) — vérifié cette session, `dotnet build GRC.slnx -c Debug`, 2026-09-17
- [ ] Cas règlement 51893 (mode 18 / caisse 121) → message contient le numéro ET l'intitulé —
      **non exécuté** (pas de harness dédié, accès kernel Trésorerie réel non disponible sur ce
      poste cette session) ; validé par lecture de code + signature DLL confirmée par `inspect_tool`
      (voir ci-dessus)
- [x] Cas mode introuvable dans le référentiel → message affiche le numéro seul, aucune exception
      non gérée — confirmé par lecture de code : `catch (Exception ex)` limité à la résolution de
      l'intitulé, retourne `string.Empty`, jamais propagé ([:584-588](../../GRC.Infrastructure/Services/ReglementService.cs#L584-L588))
- [x] Aucune régression sur le message « caisse introuvable » ([:562-563](../../GRC.Infrastructure/Services/ReglementService.cs#L562-L563)) —
      non touché par le diff, confirmé par lecture de code
- [x] Aucune modification du comportement de `VerifierComptabilisable` — mêmes points d'appel
      ([:364](../../GRC.Infrastructure/Services/ReglementService.cs#L364), [:838](../../GRC.Infrastructure/Services/ReglementService.cs#L838)),
      mêmes conditions de levée, seul le texte du message change
- [x] Pas de N+1 perceptible sur un lot de comptabilisation réel — confirmé par lecture de code :
      résolution uniquement dans la branche d'échec de la garde, jamais sur le chemin nominal (voir
      ci-dessus) ; pas de mesure en conditions réelles faute d'accès au kernel Trésorerie

## Décision architecte (2026-09-17)

**APPROVE.** Checklist conforme à la discipline de preuve (le seul point non coché est documenté,
pas fabriqué), aucun bypass sécurité, aucune dette technique silencieuse, cohérent avec le pattern
`_kernel.Resolve<T>()` déjà en usage partout ailleurs dans la classe. Clôturé : `TODO.md`/`DONE.md`/
`CHANGELOG.md` mis à jour, `TASK-067.md` déplacée vers `DONE_DETAIL/`, ce VERIFY conservé archivé
(pratique constatée du projet — cf. `TASK-069_verify.md`/`TASK-051_verify.md` également conservés
après clôture, malgré la formulation littérale de `CLAUDE.md` qui suggère une suppression).
