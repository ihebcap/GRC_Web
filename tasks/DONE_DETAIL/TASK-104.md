# TASK-104 — Liste des règlements : seul écran qui affiche les annulés (flag visible) ; masqués en modes Rapprocher et Comptabiliser

- **Priorité** : 🟠 Majeur
- **Domaine** : Front (`App.tsx`) + Back (1 garde dans `RapprocherManuel`)
- **Statut** : TODO
- **Dépend de** : —
- **Lot « règlements annulés »** : TASK-098 (rapprochement) · TASK-103 (comptabilisation) · TASK-104 (liste) · TASK-105 (annulation interdite si réservé/pointé)
- **Mise en prod** : front + API, **dans n'importe quel ordre** (le front n'utilise qu'un paramètre d'API déjà existant ;
  la garde back ne change pas le contrat). Aucun script SQL, aucune config. Retour arrière = redéployer les builds précédents.
- **Références de ligne** : état du dépôt au commit `12f2dc0` (2026-09-30). Si un fichier a bougé (autre TASK fusionnée avant), se repérer par le **nom de la fonction**, pas par le numéro.

## Contexte
Règle PO (2026-09-30) : **l'annulation d'un règlement vaut suppression.** La liste des règlements est
**le seul endroit** où un annulé reste visible, avec un flag pour montrer qu'il est bien annulé. Dès qu'on passe
en mode **Rapprocher** ou **Comptabiliser** (boutons de la liste), les annulés ne sont **plus affichés du tout**.
Le PO **ne teste pas avant la mise en production** : les preuves sont produites par le worker sur la base de
**test** et figurent dans le VERIFY.

## Problèmes constatés (références vérifiées le 2026-09-30)
1. **Flag** : la colonne « Annulé » existe (`utils.tsx:104`, badge `:132`) mais n'est pas dans les colonnes par
   défaut (`utils.tsx:15`), et le choix de colonnes est **persisté par utilisateur** (`localStorage`
   `gocom_table_columns`, `App.tsx:292-310`) : ajouter `'annule'` à `DEFAULT_COLUMNS` n'aurait aucun effet pour les
   utilisateurs existants et changerait aussi la grille du Rapprochement (`RapprochementBancaire.tsx:309`), où
   l'annulé n'apparaît plus. Aucun repère au niveau de la ligne aujourd'hui.
2. **Modes Rapprocher / Comptabiliser** : ils n'excluent pas les annulés. `buildParams` (`App.tsx:483-560`) ne
   transmet `annule` que si l'utilisateur pose lui-même le filtre (`:557`) ; les modes ne verrouillent que
   `pointe` / `comptabilise`. Les annulés sont donc listés **et sélectionnables** (`:758` : `!reg.isPointe` ;
   `:771` : `reg.isComptabilise === 0` ; curseur `:781`). Une sélection « Comptabiliser » les envoie ensuite à
   l'aperçu (`handleRouteToApercu`, `:631-646`).
3. **Backend `RapprocherManuel`** (`ReglementService.cs:1269-1327`, route `POST /api/rapprochement`,
   `ReglementController.cs:259-289`) : seules gardes = autorisation de caisse et `IsPointe` (`:1304`), puis
   `reg.IsPointe = true; repo.Update(reg)`. Un annulé peut être pointé par appel direct. *Le comportement de la
   DLL sur un annulé n'est pas vérifié : à prouver par test, ne pas présumer qu'elle refuse.*
4. **Le front ignore le résultat de `POST /api/rapprochement`** (`App.tsx:580-585`) : même si le serveur refuse des
   éléments (`errorCount > 0`), il affiche « Rapprochement validé ! ». Sans correction, la nouvelle garde (point 3)
   serait **silencieuse**.

## Comportements attendus (contrat)
| Situation | Résultat attendu |
|---|---|
| Liste, mode normal | annulés **affichés**, ligne atténuée + badge « Annulé » visible **quelles que soient les colonnes choisies** ; bouton « Modifier » désactivé (TASK-093, inchangé) ; bouton « Annuler » absent (inchangé) |
| Mode Rapprocher ou Comptabiliser | **aucun annulé** : ni dans le tableau, ni dans l'export Excel ; si la colonne « Annulé » est affichée, son filtre est masqué et affiche 🔒 |
| Sortie de mode | liste normale : les annulés réapparaissent |
| `POST /api/rapprochement` avec un annulé | HTTP 200, `errorCount = 1`, `errors[0]` = « Règlement <id>: Le règlement <id> est annulé et ne peut pas être rapproché. » ; `IsPointe` inchangé ; les autres éléments du lot sont traités |
| Réponse avec `errorCount > 0` côté front | toast **warning** « n rapproché(s), m refusé(s) : <1er message> » ; **pas** de « Rapprochement validé ! » |

## Étapes d'implémentation
1. **Repère de ligne « annulé »** dans `tableBodyMemo` (`App.tsx:749-907`) : pour `reg.isAnnule`, (a) style de la
   ligne `opacity: 0.55` (à fusionner dans le `style` existant `:780-784`), (b) `title="Règlement annulé"` sur le
   `<tr>`, (c) sous les icônes de la 1ʳᵉ cellule (`:786-843`, largeur 68 px) un
   `<span className="badge badge-danger">Annulé</span>` (classes existantes, `index.css:359-379`), **sur sa propre
   ligne, sans élargir la colonne**. Ne pas modifier `DEFAULT_COLUMNS` ni la colonne « Annulé » existante.
2. **Masquage dans les modes — dérivé du mode, pas stocké dans `filters`** : dans `buildParams`, juste après `:557`,
   `if (isRapprochementMode || isComptabilisationMode) params.annule = false;` (le mode prime).
   Raison : les filtres verrouillés `pointe` / `comptabilise` sont posés puis retirés en 6 endroits (`:583`, `:653`,
   `:1031-1035`, `:1049-1053`, `:1087-1091`, `:1105-1109`) ; stocker `annule` dans `filters` obligerait à le retirer
   aux 6 sorties, et **un oubli laisserait les annulés masqués hors mode** (violation de la règle PO).
   `buildParams` n'a que deux appelants (`:393` export, `:697` liste) : les deux sont couverts.
   Le rechargement à l'entrée/sortie de mode est déclenché par le changement de `filters` (debounce 500 ms `:350-353`,
   effet `:368-389`) ; le séquencement `fetchSeqRef` / `abortControllerRef` (`:676-713`) garantit que seule la
   **dernière** requête s'applique, donc un rechargement lancé avec l'ancien état du mode (ex. `fetchReglements` appelé
   dans le même handler que la sortie de mode, `:584`) est écrasé par le rechargement différé. À prouver (S2, S4, S10).
3. **Filtre « Annulé » verrouillé en mode** (même mécanique que TASK-076 pour `pointe`/`comptabilise`) :
   - à l'entrée de chaque mode (branches `:1042-1046` et `:1098-1102`) : `delete f.annule` (un éventuel filtre
     utilisateur « Annulé = Oui » est abandonné, rien à restaurer) ;
   - `handleFilterChange` (`:734-746`, gardes en `:735-736`) : ignorer `annule` si l'un des deux modes est actif ;
   - en-tête de colonne (`:1363-1378`) : ne pas rendre `ExcelFilter` pour `annule` dans les deux modes et afficher le
     🔒 (même `title` que les autres : « Filtre verrouillé en mode … »).
4. **Garde défensive de sélection** (fenêtre du debounce de 500 ms, ou donnée périmée) : ajouter `!reg.isAnnule` aux
   conditions de clic `:758` et `:771` et au curseur `:781`.
5. **Afficher le résultat du rapprochement manuel** (`handleSubmitRapprochement`, `:562-591`) : lire la réponse
   (`const res = await axios.post(...)`), `const { successCount = 0, errorCount = 0, errors = [] } = res.data || {}` ;
   si `errorCount > 0` → toast `warning` `${successCount} règlement(s) rapproché(s), ${errorCount} refusé(s) : ${errors[0]}` ;
   sinon le toast de succès actuel. Laisser inchangés la remise à zéro de la sélection, la sortie de mode et le rechargement.
6. **Garde back dans `RapprocherManuel`**, juste après la garde `IsPointe` (`:1304-1305`) :
   `if (reg.IsAnnule) throw new InvalidOperationException($"Le règlement {reg.No} est annulé et ne peut pas être rapproché.");`
   (le `catch` par élément `:1319-1323` produit déjà `errorCount++` et `errors.Add`). Aucune lecture supplémentaire :
   `reg` est déjà chargé.
7. **Preuve DLL** : avant d'ajouter la garde, appeler `POST /api/rapprochement` sur un annulé de test et consigner si la
   DLL le refuse d'elle-même (information pour le VERIFY ; la garde applicative reste obligatoire).

## Jeu d'essai (base de TEST uniquement)
Créer l'annulé **via l'application** (bouton « Annuler ») — jamais par UPDATE SQL.
- **Rn** : règlement normal (ni annulé, ni pointé, ni comptabilisé) ; **Ra** : règlement annulé ; **Rp** : règlement pointé.
- Deux comptes : un utilisateur dont le choix de colonnes est **par défaut**, un dont le `localStorage`
  `gocom_table_columns` a été **personnalisé sans** la colonne « Annulé ».

## Scénarios de test (à rejouer par le worker)
- **S1 Flag (mode normal)** : Ra visible, atténué, badge « Annulé », avec les deux comptes (colonnes par défaut et personnalisées) ;
  « Modifier » désactivé, « Annuler » absent. Captures.
- **S2 Entrée/sortie Rapprocher** : entrer → Ra disparaît (compter ≤ ~1 s, debounce + rechargement) ; Rn sélectionnable ; sortir
  → Ra réapparaît. Idem **S3** avec Comptabiliser.
- **S4 Bascule directe** Rapprocher → Comptabiliser puis retour : aucun annulé à l'état stable dans les modes ; annulés de
  retour hors mode.
- **S5 Filtre résiduel** : poser « Annulé = Oui », entrer en mode Rapprocher → liste non vide sans annulés, filtre masqué + 🔒 ;
  sortir → liste complète, **pas de filtre fantôme** ni bouton « Effacer filtres » injustifié.
- **S6 Non-régression rapprochement manuel** : mode Rapprocher, sélectionner Rn + N° extrait + date → valider → toast de
  succès, Rn pointé.
- **S7 API directe** : `POST /api/rapprochement [{ReglementId: Ra}]` → 200, `errorCount = 1`, message attendu ; Ra inchangé
  (`IsPointe` faux). Un lot `[Rn, Ra]` → Rn pointé, Ra refusé.
- **S8 Affichage du refus (point 4)** : deux onglets ; dans l'onglet 1 rapprocher Rn ; dans l'onglet 2 (liste périmée,
  Rn encore sélectionnable) tenter de rapprocher Rn → toast **warning** avec « déjà pointé », **pas** « validé ».
- **S9 Export** : Excel en mode Rapprocher → sans Ra ; hors mode → avec Ra.
- **S10 Bascule rapide** : activer/désactiver Rapprocher 4 fois en < 2 s → la liste finale correspond à l'état final du mode.

## Risques et points d'attention
- **Ne pas stocker `annule` dans `filters`** (voir étape 2) : c'est le piège principal.
- Les deux handlers de mode sont longs et dupliqués : n'y ajouter que `delete f.annule` (pas de refactorisation).
- `tableBodyMemo` dépend déjà de `isRapprochementMode` / `isComptabilisationMode` (`:907`) : aucun ajout à faire.
- Le badge ne doit pas élargir la colonne d'actions (capture avant/après pour un annulé et un non-annulé).
- Hors périmètre : le bouton « Annuler » de la liste (TASK-105) ; la logique de sélection des lignes pointées.

## Contraintes
- Ne jamais bypasser une règle de sécurité ou une DLL métier GRC.
- Ne pas retirer les annulés de la liste en mode normal : ils y sont voulus (règle PO).
- Grille : respecter `ARCHITECTURE.md` § Grilles de données ; ne pas dupliquer de composant.
- Front minimal : pas de refonte de `App.tsx`.

## Fichiers concernés
- `gocom-web/src/App.tsx` (`buildParams`, `handleFilterChange`, boutons de mode, en-tête, `tableBodyMemo`, `handleSubmitRapprochement`)
- `GRC.Infrastructure/Services/ReglementService.cs` (`RapprocherManuel`)
- `gocom-web/src/utils.tsx` (**lecture seule** ; ne pas toucher `DEFAULT_COLUMNS`)

## Checklist VALIDATION (VERIFY : preuve datée par critère — capture, réponse API ou extrait de log)
- [ ] Build back + front, 0 erreur (preuve : sortie du build)
- [ ] S1 flag visible avec colonnes par défaut **et** personnalisées (preuve : 2 captures)
- [ ] S2/S3 annulés absents en modes Rapprocher et Comptabiliser, de retour en sortie (preuve : captures avant/pendant/après)
- [ ] S4 bascule directe sans annulé à l'état stable (preuve : captures)
- [ ] S5 filtre résiduel abandonné, aucun filtre fantôme (preuve : captures)
- [ ] S6 rapprochement manuel normal inchangé (preuve : toast + `GET /reglements` montrant Rn pointé)
- [ ] S7 refus serveur d'un annulé, `IsPointe` inchangé, lot mixte traité (preuve : réponses API)
- [ ] S8 le refus est **visible** côté front (preuve : capture du toast warning)
- [ ] S9 export sans annulés en mode, avec annulés hors mode (preuve : 2 fichiers ou colonnes comptées)
- [ ] S10 bascule rapide cohérente (preuve : capture de l'état final)
- [ ] Résultat du test « la DLL refuse-t-elle d'elle-même un annulé ? » consigné
- [ ] `annule` n'est **pas** écrit dans `filters` (preuve : extrait de diff de `buildParams`)
- [ ] Aucun credential/secret en dur introduit
- [ ] Aucune dette technique silencieuse
- [ ] Cohérent avec l'architecture

## Go / No-Go
**No-Go si** S5, S7 ou S8 ne sont pas prouvés, ou si un annulé reste visible hors du mode normal.
