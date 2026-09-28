# TASK-085 — Annulation de règlement

- **Priorité** : 🟠 Nouveau fonctionnel (demande PO, réunion 2026-09-28)
- **Domaine** : Backend (API + Infrastructure) + Front (liste des règlements)
- **Statut** : TODO
- **Dépend de** : —

## Contexte

Remarque PO en réunion (2026-09-28) : besoin d'annuler un règlement, **en passant obligatoirement
par les DLL de GRC** (aucun `UPDATE` SQL brut sur une table pilotée par la DLL métier), avec pour
condition explicite du PO : *« le règlement ne doit pas être comptabilisé, remis, affecté »*.

Vérification par inspection réelle (code source `Tresorerie.Core` + décompilation IL Mono.Cecil du
binaire livré `libs\Tresorerie\Tresorerie.Core.dll`, concordance totale confirmée entre les deux
sources, **puis contre-vérification indépendante par une seconde passe**) : **`CaisseManager.
ReglementClientAnnuler(int reglementNo)` existe déjà en natif** et fait tout le travail en interne.
**⚠️ Le pseudocode ci-dessous est une paraphrase simplifiée, pas un extrait littéral du corps réel**
(contre-vérification indépendante confirmée) : dans le code réel, **toutes les gardes s'exécutent
AVANT l'ouverture du `TransactionScope`** ; le bloc transactionnel ne contient que l'épuisement d'un
éventuel lot d'entrée non épuisé (omis ci-dessous pour lisibilité), puis `IsAnnule=true` +
persistance + notification :

```csharp
// Paraphrase simplifiée — voir note ci-dessus, ne pas citer comme extrait littéral
public void ReglementClientAnnuler(int reglementNo)
{
    var reglement = _reglementClientRepository.Get(reglementNo);
    if (reglement == null) throw new ApplicationException($"Impossible de charger le règlement [{reglementNo}].");
    if (reglement.IsAnnule) throw new ApplicationException($"Le règlement [{reglement.Numero}] est déjà annulé!");
    if (reglement.IsImpaye == ImpayeEtat.Impaye) throw new ApplicationException(TresorerieCoreMessages.ErrorReglementImpaye);
    if (reglement.IsRemis != Remis.NonRemis) throw new ApplicationException(TresorerieCoreMessages.ErrorReglementRemis);
    if (reglement.IsReglementAvoir) throw new ApplicationException("Opération invalide. Règlement d'avoir.");
    // + vérifie : transfert en cours, règlement espèce déjà consommé (ApplicationException),
    //   GetAffectations().Any(), GetRemplacements().Any(), GetMesRemplacants().Any() (InvalidOperationException),
    //   IsPointe, Solde != Montant, IsRemplacer, IsSynchroniser (ApplicationException)
    // — 14 gardes au total, toutes AVANT le bloc transactionnel qui suit :
    using (var scope = new TransactionScope(...))
    {
        // + épuisement d'un éventuel lot d'entrée non épuisé (historique), omis ici
        reglement.IsAnnule = true;
        _reglementClientRepository.AnnulerReglement(reglementNo, true);
        _notifyService.Notify(TypeEntity.Reglement, reglementNo, TypeAction.Modification, reglement.SocieteNo);
        scope.Complete();
    }
}
```

**Ne pas confondre avec `CaisseManager.ReglementClientDelete(int reglementNo)`** — suppression
physique (`_reglementClientRepository.Delete`), sémantique différente d'une annulation logique. Le
PO demande une annulation, pas une suppression.

⚠️ **Nuance confirmée par IL** : `ReglementClientAnnuler` ne teste **pas explicitement**
`IsComptabilise`. En pratique un règlement comptabilisé est presque toujours aussi `IsPointe` ou à
solde différent du montant (donc bloqué indirectement par les autres gardes), mais ce n'est pas
garanti à 100 % en théorie (cas limite : comptabilisé, solde intact, non pointé, non affecté).
**Décision actée** : ajouter un test explicite côté GRC_WEB (`IsComptabilise == EtatComptabilise.NonComptabilise`)
avant l'appel, par prudence — ne pas se reposer uniquement sur les gardes internes de la DLL pour ce
point précis.

⚠️ **`IsLettrer` non testé non plus par `ReglementClientAnnuler`** (ni comme garde native, ni par la
garde `IsComptabilise` ci-dessus — vérifié par décompilation, aucune des deux notions n'apparaît dans
le corps réel de la méthode). **Position PO (2026-09-28)** : un règlement non comptabilisé ne peut pas
être lettré, donc la garde `IsComptabilise` couvre indirectement ce risque, pas de garde
supplémentaire nécessaire. **Non prouvée à 100 % côté code** : le moteur de lettrage natif appelé par
GRC_WEB (`ILettrageReglementClient`, résolu par IoC) est une interface dont l'implémentation concrète
n'est pas présente dans les DLL inspectables du repo (probablement un assembly Erp.Sage.* spécifique
version) — impossible de confirmer par le code que le moteur natif exige lui-même `IsComptabilise`
avant de lettrer. Décision actée sur confiance métier PO, pas sur preuve code à 100 % — si un doute
apparaît en test réel (VERIFY), vérifier `IsLettrer` sur le jeu de règlements testés avant annulation.

## Objectif

Un endpoint et une action UI permettant d'annuler un règlement non comptabilisé, non remis, non
affecté, non annulé — appelant `CaisseManager.ReglementClientAnnuler` sans aucun bypass ni
`UPDATE` SQL direct.

## Fichiers concernés

- `GRC.Infrastructure/Services/ReglementService.cs` — nouvelle méthode, ex.
  `AnnulerReglement(int reglementNo, int userId)`.
- `GRC.API/Controllers/ReglementController.cs` — nouvel endpoint, ex.
  `[HttpPost("{id}/annuler")]`, avec le même contrôle de droits caisse que les autres actions
  d'écriture (`VerifierAutorisationCaisse`, pattern TASK-069).
- `gocom-web/src/App.tsx` (ou composant liste des règlements) — bouton « Annuler » par ligne,
  visible seulement si le règlement est éligible (voir garde front ci-dessous), avec confirmation
  utilisateur avant l'appel (opération irréversible côté trésorerie).

## Étapes d'implémentation

1. **Garde applicative explicite avant l'appel DLL** : vérifier `IsComptabilise ==
   EtatComptabilise.NonComptabilise` en plus de laisser la DLL faire le reste — ne pas dupliquer les
   autres contrôles déjà faits nativement (remis/affecté/pointé/annulé/impayé/avoir/transfert), la
   DLL les fait déjà et les fait mieux (transaction, notification).
2. **Contrôle de droits de caisse** sur le nouvel endpoint, pattern `HasEntityActionRestriction`
   identique aux autres actions d'écriture (TASK-069) — un utilisateur restreint à une caisse ne doit
   pas pouvoir annuler un règlement hors périmètre. Action à utiliser dans `VerifierAutorisationCaisse`
   (vérifiée par réflexion réelle sur `libs\Tresorerie\Tresorerie.Authorization.Core.dll`, classe
   existante et confirmée) :
   `new global::Tresorerie.Authorization.Core.Actions.ReglementAnnuler().Guid`
   — ne pas réutiliser `ReglementComptabiliser`/`ReglementModifier`/`ReglementSupprimer` par erreur de
   copier-collé du pattern TASK-069/086.
3. **Appel `CaisseManager.ReglementClientAnnuler(reglementNo)`** — aucun code applicatif ne doit
   réimplémenter la logique de garde (ne pas manipuler `IsAnnule`/`ChangeEtatComptabilise` à la main,
   cf. rapport d'inspection : ce serait un contournement dangereux et incomplet, il manquerait la
   transaction, l'épuisement de lot, et la notification).
4. **Gestion des deux familles d'exceptions** : `ReglementClientAnnuler` lève tantôt
   `ApplicationException` (déjà annulé, impayé, remis, avoir, transfert en cours, espèce consommé,
   pointé, synchronisé ERP), tantôt `InvalidOperationException` (affecté, remplacé) — **prévoir un
   `catch` couvrant les deux types**, avec message métier lisible remonté au front (pas de message
   technique brut), sur le modèle du panneau d'erreurs de TASK-055.
5. **Front** : bouton « Annuler » désactivé/masqué si le règlement est visiblement déjà comptabilisé,
   **affecté**, pointé, remis ou annulé côté données déjà chargées par la grille (défense en
   profondeur légère, la vraie garde reste côté serveur — **"affecté" ne doit pas être oublié dans
   cette liste**, c'est une condition bloquante native de `ReglementClientAnnuler` au même titre que
   les autres) ; confirmation modale avant l'appel ; message de succès/erreur affiché clairement
   (pas un `alert()` — cf. TASK-014, pattern toast déjà en place ; noter que `ApercuComptabilisation.tsx`
   ne reçoit actuellement que `showToast` en prop, pas `showConfirm` — si la confirmation doit
   s'afficher depuis ce composant plutôt que la liste des règlements dans `App.tsx`, prévoir de
   propager `showConfirm` en prop supplémentaire).
6. **Rafraîchir la grille** après annulation réussie (le règlement annulé doit soit disparaître du
   filtre courant, soit afficher visuellement son état annulé selon le filtre actif).

## Contraintes

- **Aucun bypass DLL** : ne jamais manipuler `IsAnnule`/`ChangeEtatComptabilise` directement en
  contournement — l'appel natif `ReglementClientAnnuler` fait tout le travail et est la seule voie
  autorisée. Utiliser `ReglementClientDelete` est interdit ici (sémantique différente, suppression
  physique).
- Respecter le scoping caisses/société de l'utilisateur connecté (pattern TASK-069). **Vérifier
  explicitement que le règlement appartient à la société de l'utilisateur connecté**, pas seulement
  à une caisse autorisée (IDOR société, cf. précédent déjà traité TASK-075 sur un autre endpoint de
  ce projet) — confirmer au dev que `VerifierAutorisationCaisse` couvre nativement cette
  vérification société↔règlement, sinon l'ajouter explicitement.
- Respecter la Clean Architecture (Domain ← Application ← Infrastructure/API).
- Aucun `UPDATE` SQL brut sur une table pilotée par la DLL.

## Risques / dépendances

- La garde `IsComptabilise` ajoutée côté GRC_WEB est une **prudence applicative en plus** de la DLL,
  pas une redite d'une garde native — bien la commenter comme telle (why non-obvious) pour qu'un
  futur lecteur ne la prenne pas pour du code mort.
- Si le PO souhaite un jour annuler un règlement affecté (retirer l'affectation avant annulation),
  c'est hors périmètre de cette TASK — la DLL bloque ce cas nativement (`GetAffectations().Any()`)
  et aucune méthode de désaffectation n'a été identifiée dans ce rapport.

## Checklist VALIDATION (à remplir dans VERIFY/)

**Préalable discipline de preuve** : la checklist ci-dessous exige de tester 6 états distincts du
règlement (non comptabilisé éligible, comptabilisé, affecté, remis, pointé, déjà annulé). Deux de ces
états (affecté, remis) sont peu fréquents et non triviaux à obtenir sur un jeu de données de test —
sur le modèle des harnais dédiés déjà produits pour TASK-081/082/083 (`harness_task081/082/083` :
setup SQL réel, appel du vrai repository/DLL, vérification en base, teardown), prévoir soit un
harnais `harness_task085` équivalent, soit identifier explicitement dans le VERIFY un ou plusieurs
`MV_Id` réels existants en base couvrant chaque état requis, avant de cocher les cases correspondantes
— ne pas cocher sur la base d'un raisonnement par le code seul (cf. TASK-083, premier VERIFY rejeté
pour ce motif).

- [ ] Build back + front OK (0 erreur)
- [ ] Règlement non comptabilisé/non affecté/non remis/non annulé/non pointé → annulation réussie,
      confirmée en base réelle sur **`RT_MOUVEMENT.MV_Annule`** (nom de colonne confirmé par
      décompilation directe du SQL brut dans `ReglementClientRepository.AnnulerReglement`, pas
      `MV_IsAnnule`). **Vérifier aussi `RT_HISTOMVT`** : `ReglementClientAnnuler` y fait un `UPDATE`
      conditionnel de `HM_MontantRestant = 0` (pas un `INSERT`), uniquement s'il existe un lot
      d'entrée non épuisé pour ce règlement — à contrôler dans le VERIFY si le règlement de test a un
      tel lot (sinon cette table n'est simplement pas touchée, ce n'est pas un bug)
- [ ] Vérification société↔règlement confirmée (un règlement d'une société différente de
      l'utilisateur connecté n'est jamais accessible, même via une caisse au nom similaire — IDOR,
      cf. TASK-075)
- [ ] Bouton front "Annuler" masqué/désactivé aussi pour un règlement affecté (pas seulement
      comptabilisé/pointé/remis/annulé)
- [ ] Règlement comptabilisé → refus explicite (garde applicative GRC_WEB), message clair
- [ ] Règlement affecté → refus, message métier lisible (`InvalidOperationException` catchée et
      traduite, pas de stack trace brute au front)
- [ ] Règlement remis/pointé/déjà annulé → refus, message métier lisible pour chaque cas
- [ ] Contrôle de droits de caisse vérifié (utilisateur restreint ne peut pas annuler hors périmètre)
- [ ] Front : bouton non trompeur (masqué/désactivé si l'état visible l'exclut), confirmation avant
      annulation, pas d'`alert()`/`window.confirm` (pattern toast existant)
- [ ] Aucun bypass DLL (`ReglementClientAnnuler` seul appelé, pas de manipulation directe
      `IsAnnule`/`ChangeEtatComptabilise`, pas d'`UPDATE` SQL brut)
