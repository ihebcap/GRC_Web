# GRC — Manuel utilisateur

**Rapprochement bancaire des encaissements clients**

Une application unique pour rapprocher les encaissements clients avec les relevés bancaires,
supprimer le pointage manuel ligne à ligne et permettre à plusieurs opérateurs de travailler
ensemble sans se marcher dessus.

- **Public** — gestionnaires trésorerie & comptabilité client
- **Périmètre** — Règlements · Relevés · Rapprochement
- **Accès** — application web, session par société

---

## Sommaire

1. [Objectif & principe de l'application](#1-objectif--principe-de-lapplication)
2. [Connexion & espace de travail](#2-connexion--espace-de-travail)
3. [Consulter les règlements clients](#3-consulter-les-règlements-clients)
4. [Importer un relevé bancaire](#4-importer-un-relevé-bancaire)
5. [Rapprocher : automatique & manuel](#5-rapprocher--automatique--manuel)
6. [Générer un règlement espèce depuis les factures ouvertes](#6-générer-un-règlement-espèce-depuis-les-factures-ouvertes)
7. [Générer un règlement versement depuis le relevé bancaire](#7-générer-un-règlement-versement-depuis-le-relevé-bancaire)
8. [Travailler à plusieurs sans conflit](#8-travailler-à-plusieurs-sans-conflit)
9. [Suivi du recouvrement par BL (Metabase)](#9-suivi-du-recouvrement-par-bl-metabase)
10. [Ce que l'application vous fait gagner](#10-ce-que-lapplication-vous-fait-gagner)

---

## 1. Objectif & principe de l'application

Le rapprochement bancaire consiste à confirmer que chaque encaissement enregistré en gestion
(virement, chèque, traite) correspond bien à une ligne réelle du relevé de la banque. Fait à la
main — dans un tableur, en cochant ligne à ligne — c'est long, répétitif, source d'erreurs, et
impossible à partager proprement entre plusieurs personnes.

**GRC automatise ce travail.** L'application place côte à côte vos règlements en gestion et les
lignes du relevé importé, propose automatiquement les correspondances évidentes, et ne touche la
base de gestion qu'au moment où vous validez. Le pointage manuel disparaît ; il ne reste que le
contrôle et la décision.

**Flux :** Importer → Apparier → Réserver → Approuver

| Étape | Description |
|-------|-------------|
| **Importer** | Le relevé Excel de la banque est chargé dans l'application. |
| **Apparier** | Auto (1=1 sur le montant) puis complément manuel si besoin. |
| **Réserver** | Chaque paire est verrouillée pour vous, en temps réel. |
| **Approuver** | La gestion est mise à jour : les règlements passent « pointés ». |

> **Bénéfice** — Un seul écran remplace le va-et-vient entre l'extrait bancaire et la gestion.
> Le rapprochement devient une relecture assistée plutôt qu'une ressaisie.

### Avant / Après

| ✗ Avant — sans l'application | ✓ Après — avec GRC |
|------------------------------|---------------------|
| Pointage ligne à ligne dans un tableur, manuel et répétitif. | Auto-rapprochement 1=1 instantané ; vous ne traitez que l'exception. |
| Chacun sa copie du relevé : des versions qui divergent. | Un relevé unique importé une seule fois, partagé par tous. |
| Deux personnes rapprochent parfois la même opération. | Réservation en temps réel : zéro doublon entre collègues. |
| Travail perdu si le fichier se ferme ou plante. | Rapprochements persistés : la session reste intacte. |
| Va-et-vient constant entre l'extrait bancaire et la gestion. | Relevé et règlements côte à côte sur un même écran. |
| Qui a fait quoi, quand ? Peu ou pas de traçabilité. | Import, réservation et validation horodatés et attribués. |

---

## 2. Connexion & espace de travail

1. **Saisissez vos identifiants.** Nom d'utilisateur et mot de passe fournis par votre administrateur.
2. **Choisissez la société.** La liste des sociétés disponibles se charge automatiquement ;
   sélectionnez celle sur laquelle vous travaillez.
3. **Se connecter.** Vous accédez à votre tableau de bord ; seules vos caisses autorisées sont visibles.

Une fois connecté, le menu de gauche donne accès aux trois espaces de travail. Le pied du menu
rappelle votre nom et le nombre de caisses qui vous sont ouvertes ; le bouton **Déconnexion**
ferme la session.

| Entrée de menu | À quoi ça sert |
|----------------|----------------|
| **Règlements** | Consulter, filtrer et exporter les règlements clients ; lancer un rapprochement rapide. |
| **Relevés Bancaires** | Importer les fichiers Excel des relevés et voir l'historique des imports. |
| **Rapprochement** | Apparier les règlements avec les lignes du relevé, automatiquement ou à la main. |

> **Bénéfice** — Chaque opérateur ne voit que le périmètre (société, caisses) qui le concerne :
> moins de bruit, pas de risque de toucher aux données d'un collègue.

---

## 3. Consulter les règlements clients

L'écran **Règlements Clients** est votre vue de référence sur les encaissements. Le nombre total
d'enregistrements est affiché en titre, et le tableau se manipule comme une feuille de calcul.

### Adapter l'affichage

- **Colonnes** — le bouton `Colonnes` permet d'afficher ou masquer chaque colonne. Faites-les
  glisser dans l'en-tête pour les réordonner ; votre disposition est mémorisée.
- **Tri** — cliquez sur un en-tête pour trier (▲/▼).
- **Filtres façon Excel** — chaque colonne offre un filtre adapté : liste à cocher, plage de
  montants (min~max), ou période de dates (du/au). Le bouton `Effacer filtres` réinitialise l'ensemble.
- **Pagination** — 10, 25, 50 lignes ou « Tout », avec navigation Précédent / Suivant.

### Exporter

Le bouton `Exporter` génère un fichier `Export_Reglements.xlsx` reprenant exactement les colonnes
affichées et les filtres appliqués — pratique pour un contrôle ou une transmission.

### Rapprochement rapide depuis cette vue

Le bouton `Rapprocher` bascule le tableau en mode sélection. Pour éviter toute erreur, le filtre
pertinent est alors **verrouillé** (🔒) : seuls les règlements non pointés sont proposés.

> **À savoir** — Le champ Référence saisi sur chaque règlement doit toujours contenir le(s) numéro(s)
> de BL/facture concerné(s) (voir la règle de saisie détaillée en section 7, indispensable au calcul
> du recouvrement).

> **Bénéfice** — Colonnes, tris et filtres personnalisables + export : chacun retrouve
> l'information qu'il cherche en quelques secondes, sans ouvrir un autre outil.

---

## 4. Importer un relevé bancaire

Avant de rapprocher, il faut charger le relevé fourni par la banque. C'est le rôle de l'écran
**Gestion des Relevés Bancaires**.

1. **Choisissez la banque / RIB** concernée. Un titre par défaut (code banque + date du jour) est proposé.
2. **Ajustez le titre** si besoin, pour retrouver facilement l'import (ex. `CIH Janvier`).
3. **Sélectionnez le fichier Excel** (`.xls` ou `.xlsx`) exporté depuis la banque.
4. **Importer.** Les lignes sont enregistrées et l'import apparaît dans l'historique en dessous.

L'historique liste chaque relevé importé pour la banque : numéro, titre, **date d'import** et
**« Importé par »** (votre nom). Un même relevé reste disponible pour toutes les sessions de
rapprochement suivantes.

> **Bénéfice** — L'extrait bancaire n'est saisi qu'une seule fois, par une seule personne. Tout
> le monde travaille ensuite sur la même source, horodatée et attribuée — fini les copies de
> tableurs qui divergent.

---

## 5. Rapprocher : automatique & manuel

L'écran **Rapprochement bancaire** affiche deux grilles : en haut le **Relevé bancaire**
(uniquement les encaissements — lignes en crédit), en bas les **Règlements GRC** (virements,
chèques, traites).

### Préparer la session

1. **Sélectionnez la banque**, puis le **relevé associé** à traiter.
2. **Bornez la période** des règlements (Du / Au) puis cliquez `Actualiser` — vous pouvez régler
   les deux dates avant de recharger.
3. **Filtre d'affichage** : « Non rapprochés » (défaut), « Rapprochés (en cours) » ou « Tous ».

### Rapprochement automatique

Le bouton `Auto` recherche les correspondances parfaites (montant identique, 1 pour 1) sur la
période et les apparie instantanément. Chaque paire reçoit un **Repère** (une lettre : A, B, C…)
qui matérialise le lien entre la ligne du relevé et le règlement.

### Rapprochement manuel

Pour les cas que l'automatique ne couvre pas : cliquez une ligne dans une grille, puis sa
contrepartie dans l'autre. La paire est créée et reçoit à son tour un repère.

> **⚠ Montants différents.** Si les deux montants ne coïncident pas, l'application demande
> confirmation avant de forcer le rapprochement — un garde-fou contre les appariements hasardeux.

### Défaire & valider

- Cliquer une ligne déjà repérée **défait** la paire (des deux côtés).
- `Dérapprocher` retire d'un coup tous les rapprochements en cours non encore approuvés.
- `Approuver` valide définitivement : la gestion est mise à jour et les règlements deviennent **Pointé**.

> **Bénéfice** — Rien n'est écrit en base tant que vous n'avez pas approuvé. Vous appariez,
> vérifiez, corrigez librement — puis validez en un clic. La correspondance évidente est trouvée
> pour vous ; vous ne traitez à la main que l'exception.

---

## 6. Générer un règlement espèce depuis les factures ouvertes

Cet écran permet de créer directement des **règlements client en espèce**, sans passer par un
relevé bancaire — pour les encaissements en caisse.

1. L'écran affiche la liste complète des **factures ouvertes** (solde > 0) de la société, tous
   clients confondus. Filtrez par colonne (client, n° facture, dates, solde…) comme sur un tableau
   Excel, et choisissez les colonnes affichées via `Colonnes` (ce choix est mémorisé).
2. **Cochez** une ou plusieurs factures à régler — le total sélectionné s'affiche en continu.
3. **Choisissez la caisse** (limitée à celles affectées à votre profil).
4. Cliquez `Générer` : un **règlement espèce est créé par facture cochée**, affecté intégralement
   sur l'échéance correspondante.
5. Le résultat détaille, facture par facture, les règlements créés avec succès et ceux en échec
   (avec le motif) — un échec sur une facture ne bloque pas les autres.

> **Bénéfice** — Plus besoin de ressaisir un règlement facture par facture dans un autre outil : la
> génération et l'affectation se font en un clic, avec un compte-rendu clair en cas d'échec partiel.

---

## 7. Générer un règlement versement depuis le relevé bancaire

Pour une ligne de relevé bancaire qui n'a pas de contrepartie existante côté GRC (encaissement
jamais saisi), il n'est plus nécessaire de créer le règlement ailleurs puis de revenir rapprocher :
il se génère directement depuis la ligne.

1. Sur une ligne du relevé **non lettrée**, cliquez `Générer règlement`.
2. Dans la fenêtre qui s'ouvre, le mode de règlement est fixé à **Versement**. Renseignez :
   - **Client** — recherche par code ou intitulé (suggestions).
   - **Caisse** — parmi celles affectées à votre profil.
   - **Référence** — pré-remplie avec la référence du relevé, modifiable (voir la
     [règle de saisie de la référence](#règle-de-saisie-de-la-référence) pour le lien BL/facture).
3. `Générer le règlement` crée le règlement pour le montant de la ligne de relevé.
4. Le règlement créé n'est **pas encore rapproché** : relancez l'auto-rapprochement (ou faites-le
   manuellement) pour lettrer la ligne avec ce nouveau règlement.

> **Bénéfice** — Les encaissements « surprise » du relevé (jamais saisis côté GRC) se traitent sans
> sortir de l'écran de rapprochement.

---

## 8. Travailler à plusieurs sans conflit

C'est le cœur de l'application : plusieurs opérateurs peuvent rapprocher **en même temps** sur les
mêmes banques, sans se gêner ni se doublonner.

Dès que vous appariez une paire (auto ou manuel), les deux lignes sont **réservées à votre nom**.
Pour vos collègues, ces lignes apparaissent **verrouillées** :

> 🔒 **Réservé par un autre utilisateur** — la ligne reste visible mais grisée et non sélectionnable.

- Seule la personne qui a réservé peut libérer la ligne (la dérapprocher).
- La réservation est **persistée** : si vous rafraîchissez ou revenez plus tard, votre travail en
  cours est toujours là.
- Deux personnes ne peuvent jamais réserver la même ligne — la première prend la main, la seconde
  reçoit un message clair.

> **Bénéfice** — Le traitement redondant entre utilisateurs disparaît : impossible de rapprocher
> deux fois la même opération, aucun écrasement du travail d'un collègue, aucune perte au
> rafraîchissement. La charge se répartit naturellement sur l'équipe.

---

## 9. Suivi du recouvrement par BL (Metabase)

Le suivi du recouvrement — savoir combien reste dû sur chaque BL et chaque facture — **n'est pas un
écran de GRC**. Il est disponible dans un tableau de bord **Metabase** dédié, alimenté directement
depuis la gestion commerciale pour les BL/factures, et **obligatoirement depuis GRC** pour les
règlements — **aucune autre source de règlement** n'est prise en compte dans ce calcul.

### Ce que montre le tableau de bord

Chaque ligne représente un BL ou une facture, avec :
- Le dépôt d'origine et le client concerné.
- Le montant total du document.
- Le montant déjà réglé et le solde restant.
- Un signal si un client a réglé plus que le montant dû (anomalie à vérifier).

### Règle de saisie de la référence

**Le champ Référence du règlement (saisi dans GRC) doit toujours contenir le(s) numéro(s) de BL ou
de facture concerné(s).** Si un règlement couvre plusieurs BL/factures en une seule fois, séparez
chaque numéro par le caractère **`#`** (ex. `BLG2601262#BLG2601263`). Cette règle n'est pas
optionnelle : c'est ce champ qui permet au calcul ci-dessous de rattacher automatiquement le
règlement au(x) bon(s) document(s). Un numéro absent ou mal saisi rend le document introuvable dans
le calcul du solde — il apparaîtra comme non réglé même si le règlement existe.

### Comment le solde est calculé

**Cas général — BL et factures à montant positif.** Le solde de chaque document dépend
uniquement des règlements qui le référencent :

1. On identifie tous les règlements dont la référence saisie mentionne ce document. Un règlement
   peut mentionner **plusieurs BL en une seule fois** (un client paie plusieurs livraisons d'un
   coup avec un seul virement/chèque).
2. Quand un règlement couvre plusieurs BL, son montant est **réparti automatiquement** entre eux :
   le BL **le plus ancien est soldé en premier**, puis le règlement passe au suivant avec ce qui
   reste, et ainsi de suite jusqu'à épuisement du montant — comme on éponge une dette en commençant
   par la plus vieille facture impayée.
3. **Solde = montant total du document − part des règlements qui lui a été affectée** à l'étape
   précédente.
4. **Un même document n'est jamais compté deux fois**, même s'il existe sous plusieurs formes dans
   les systèmes de gestion — y compris quand une facture provient de l'éclatement d'un BL déjà
   archivé : dans ce cas, seul le BL d'origine est affiché, pas les factures qui en découlent.

**Cas particulier — avoirs (montants négatifs).** Le solde affiché vient directement de
l'échéancier comptable, **pas** du calcul de répartition des règlements ci-dessus : un avoir ne se
règle pas comme une vente.

### Filtrage par dépôt

Le tableau de bord affiche tous les dépôts ; c'est **Metabase** qui applique le filtre par dépôt
selon l'utilisateur connecté, pas GRC.

> **Bénéfice** — Une seule source pour savoir ce qui reste dû, avec des règles de calcul cohérentes
> même sur les cas particuliers (versement groupé, BL multi-client, facture éclatée) — sans
> ressaisie ni tableur parallèle.

---

## 10. Ce que l'application vous fait gagner

En résumé, l'application a un but simple : **faire le rapprochement à votre place partout où c'est
évident, et fiabiliser le reste.**

| | |
|---|---|
| ⚡ **Fini le pointage manuel** | L'auto-rapprochement 1=1 traite les correspondances évidentes instantanément. Vous ne touchez que l'exception. |
| 👥 **Zéro doublon entre collègues** | La réservation en temps réel verrouille chaque ligne. Deux personnes ne peuvent jamais traiter la même opération. |
| 💾 **Aucun travail perdu** | Les rapprochements en cours sont persistés. Rafraîchir, fermer, revenir : votre session est intacte. |
| 🔎 **Une source unique** | Le relevé est importé une fois, horodaté et attribué. Fini les tableurs personnels qui divergent. |
| 🛡️ **Validé, jamais improvisé** | Rien n'est écrit en base avant approbation ; un écart de montant est signalé et demande confirmation. |
| 📑 **Traçabilité intégrée** | Qui a importé, qui a réservé, quand : l'historique répond aux questions de contrôle sans effort. |
| 🎛️ **Vue sur mesure** | Colonnes, tris, filtres façon Excel et export : chacun compose l'affichage dont il a besoin. |
| 🤝 **Charge partagée** | Plusieurs opérateurs avancent en parallèle sur les mêmes banques — le travail se répartit tout seul. |

> **L'essentiel** — Moins de manipulations, moins d'erreurs, moins de redondance entre
> utilisateurs — et un rapprochement bancaire qui passe d'une corvée de ressaisie à une relecture
> rapide et sûre.
