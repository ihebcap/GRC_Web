# Flux de synchronisation BHUB / Sage → GR_GOCOM (GRC)

Document de référence, reconstitué le 2026-10-01 à partir des jobs SQL Agent et des procédures du serveur client
172.16.0.205. Les défauts et mesures sont dans `ANALYSE_JOBS_SQL_REGLEMENT_INWI_2026-10-01.md`.
Légende : **[code]** lu dans le code ; **[mesure]** constaté en base ; **[à confirmer]** déduit, à valider par le PO.

## 1. Vue d'ensemble

```
 BHUB (commandes web)                Sage (GOCOM)                           GRC (GR_GOCOM)
 ───────────────────                 ────────────                           ──────────────
 [ORDER]  ──O_ERP_FACTURE──►  F_DOCENTETE / F_DOCREGL ──►  prc_InsertEcheance*  ──►  RT_ECHEANCE
 REGLEMENT ─R_NO──────────►  F_CREGLEMENT (RG_Compta)  ──►  prc_InsertReglement  ──►  RT_MOUVEMENT + RT_HISTOMVT
 REGLEMENT ─R_NO──────────►  F_REGLECH (règlement↔échéance) ► prc_InsertAffectation ► RT_AFFECTATION
                                                              prc_UPDSolde  ──► soldes / états
 GRC dépointe un règlement ──► job 2 ──► F_ECRITUREC (EC_TresoPiece remis à vide)
```

| Base | Rôle |
|---|---|
| `GOCOM` | Sage 100 : factures (`F_DOCENTETE`, `F_DOCREGL`), règlements (`F_CREGLEMENT`, `F_REGLECH`), compta (`F_ECRITUREC`), banques (`F_EBANQUE`) |
| `GR_GOCOM` | Base de la GRC : `RT_ECHEANCE`, `RT_MOUVEMENT`, `RT_HISTOMVT`, `RT_HISTCOMPTA`, `RT_AFFECTATION`, `RT_CAISSE`, `P_MODEREGLEMENT`, `RAPP_*` (rapprochement) |
| `GOCOM_BHUB` | Application BHUB principale : `[ORDER]`, `REGLEMENT`, `ACCOUNT`, `ERP_CLIENT` (19 304 commandes facturées) |
| `Go-Com-D_BHUB` | Seconde source de commandes, `O_TYPE = 6` (2 541) |
| `BEWEB_Gocom` | Source héritée / autre société : **aucune** pièce n'existe dans `GOCOM` [mesure] |
| `msdb` | Les deux jobs SQL Agent |

## 2. Les jobs et leur ordonnancement

**Job 1 « GR Job Reglement Inwi »** — toutes les 5 min (lun–sam 8h–18h), toutes les heures le dimanche 8h–18h et
chaque jour de 18h à 23h. Propriétaire `GOCOM-AD\beweb`. Étapes dans l'ordre :

1. Aligner `MV_Type` sur le mode → 2. Échéances (`Go-Com-D_BHUB`) → 3. Échéances « Sage » (**morte**) →
4. Flag échéance (`DO_Valide`, `cbFlag`) → 5. Forcer le mode par préfixe de tiers → 6. Recalcul des soldes →
7. (désactivée) → 8. Décompta règlements importés → 9. Décompta versements importés → 10. Échéances (`GOCOM_BHUB`) →
11. Import des règlements → 12. Affectations → 13. Flag `RG_Compta` Sage → 14. Mode 17 → 13.

**Job 2 « (Planification Instantané) »** — toutes les **10 secondes** (lun–sam 8h–18h), propriétaire `Beweb` :
dérapprochement vers la compta, `EC_Info1` (dépôt), `MV_Info4` (nom du client).

Dépendances importantes :
- Les étapes 2, 3, 10 créent les échéances **avant** que l'étape 12 puisse les affecter (cycle suivant pour les nouvelles).
- Les étapes 1, 6, 8, 9 passent **avant** l'import des règlements (étape 11) : elles traitent le cycle précédent.
- Une erreur à l'étape 10 ou 11 (`on_fail=2`) arrête le job : les étapes 12 à 14 ne tournent plus.

## 3. Flux A — Échéances (factures clients)

> **Évolution décidée le 2026-10-01 :** la source devient la base Sage (toutes les lignes `F_DOCREGL` à `cbFlag = 0`, plus de lien
> avec une commande BHUB, plus de limite par dépôt). Les trois procédures décrites ci-dessous sont remplacées par
> `GR_GOCOM.dbo.prc_IntegrerEcheancesSage` (`sql/SQL_011_prc_IntegrerEcheancesSage.sql`, testée sur base factice, **pas encore
> déployée**). Cette section décrit le fonctionnement **actuel** jusqu'à la mise en service.

**Entrée** : factures Sage de type 6 (facture) ou 7 (facture comptabilisée) liées à une commande BHUB
(`[ORDER].O_ERP_FACTURE = F_DOCENTETE.DO_Piece`), avec au moins une ligne `F_DOCREGL`.
**Conditions** [code] : commande à total ≠ 0 (`O_TOTAL`) ; `O_TYPE = 6` pour `Go-Com-D_BHUB` ; pas déjà dans `RT_ECHEANCE`
(contrôle par pièce `DO_Numero`).
**Sortie** : une ligne `RT_ECHEANCE` par ligne `F_DOCREGL` (`EC_No` = `DR_No`).
**Valeurs posées** [code] : `EC_Montant = EC_Solde = DO_TotalTTC` (recopié sur chaque ligne de règlement) ;
`MR_Id = 1`, `DE_Id = 4`, `SO_Id = 1`, `UT_Id = 1`, payeur = client ; `EC_Info1..4 = DO_Coord01..04`
(puis `EC_Info1` remplacé par l'intitulé du dépôt par le job 2).
**Après insertion** : étape 4 → `F_DOCENTETE.DO_Valide = 1` et `F_DOCREGL.cbFlag = 1` (clé = pièce, car Sage change
`DR_No` quand une facture passe de 6 à 7) ; ainsi l'écran d'import GRC ne les recrée pas.
**Volumes** [mesure] : 13 450 échéances ; 11 974 hors BHUB (écran / import SQL), 947 `GOCOM_BHUB`, 529 `Go-Com-D_BHUB`.
15 713 factures BHUB à total Sage nul sont écartées volontairement.

## 4. Flux B — Règlements

**Entrée** : `REGLEMENT` (BHUB) dont le règlement Sage `F_CREGLEMENT.RG_Compta = 0` et qui n'existe pas encore dans
`RT_MOUVEMENT` (`MV_Numero = R_ID`).
**Jointures obligatoires** [code] (échec = règlement ignoré sans trace) : mode Sage (`P_REGLEMENT`), compte BHUB
(`ACCOUNT`), caisse GRC (`RT_CAISSE.CA_Code = A_LASTNAME`), client (`ERP_CLIENT`), banque (`F_EBANQUE.JO_Num = R_JOURNAL`),
utilisateur (`P_UTILISATEUR.UT_Login = CA_Code`), table de correspondance des modes.

**Correspondance des modes Sage → GRC** [code] :

| Mode Sage | MR_Id GRC | MV_Type | Commentaire du code |
|---|---|---|---|
| 1 | 12 | 3 | « Versement et chèque sont considérés comme virement pour ne pas faire le bordereau de remise » |
| 2 | 2 | 3 | idem |
| 3 | 4 | 3 | idem |
| 4 | 3 | 2 | |
| 5 | 14 | 4 | |
| 6 | 8 | 4 | |
| 8 | 3 | 2 | |
| 7, ≥ 9 | — | — | non importés |

**Valeurs posées** [code] : `MV_Date`/`MV_Echeance`/`MV_DateCreation` = date d'échéance BHUB (pas la date d'import) ;
`MV_Compta = 0`, `MV_Point = 0`, `MV_Remis = 0` ; `MV_Reference = NULL` ; une ligne `RT_HISTOMVT` est créée dans la même
transaction.
**Pierre tombale** [code, commentaire du développeur] : l'étape 13 passe `RG_Compta = 1` côté Sage dès l'import, sinon un
règlement supprimé dans GRC serait réimporté. Effet associé : Sage ne le comptabilise pas.
**Journaux non importés** [mesure] : `RNC` (158 règlements COM depuis avril) et `COM` (18) n'ont pas de compte bancaire
`F_EBANQUE` → jamais dans GRC [à confirmer : traités uniquement en compta Sage].
**Correction par préfixe de tiers** (étape 5) [code] : `PAYX%`→15, `AGENCE%`→16, `COM%`→17 (puis 13 par l'étape 14),
`RELAIS%`→18, `IMONEY%`→19. Les modes 15–19 sont de type 3, donc éligibles au rapprochement bancaire.
**Volumes** [mesure] : 44 048 mouvements ; 8 268 virements 2026 `RG_Compta = 1` / `MV_Compta = 0` = file normale en attente
de rapprochement.

## 5. Flux C — Affectations et soldes

- Étape 12 : pour chaque `F_REGLECH` (règlement ↔ échéance) dont le règlement et l'échéance existent dans GRC, une ligne
  `RT_AFFECTATION` (`AF_Montant = RC_Montant`) est créée si elle n'existe pas. Lien échéance : `F_REGLECH.DR_No = RT_ECHEANCE.EC_No`
  (0 cas sans échéance en base [mesure]).
- Étape 6 : `MV_Solde = MV_Montant − Σ AF_Montant`, `MV_Etat = 1` si solde nul ; idem `EC_Solde`/`EC_Etat` sur les échéances.
  Limite : seuls les objets ayant au moins une affectation sont recalculés.

## 6. Flux D — Compta et pointage

- Étapes 8 et 9 : `MV_Compta = 0` pour des règlements importés **par l'application GRC** (numéro égal à la pièce de la facture,
  ou versements `RV%` à pièce `#…#`) qui n'ont pas d'historique compta, afin que GRC les comptabilise [à confirmer].
- Job 2, étape 1 : quand un règlement est dépointé dans GRC (`MV_Point = 0`), l'écriture Sage correspondante perd son pointage
  (`EC_TresoPiece = ''`, `EC_DateRappro = 1753`). GRC fait autorité sur le pointage.

## 7. Registre des décisions (à confirmer par le PO)

| # | Décision retrouvée dans le code | Preuve | Statut | Question au PO |
|---|---|---|---|---|
| D-01 | Virements, chèques et versements BHUB traités en type 3 (virement) pour éviter le bordereau de remise | commentaire du code | confirmé par le code | toujours voulu ? |
| D-02 | Un règlement n'est importé qu'une fois ; `RG_Compta = 1` sert de pierre tombale | commentaire du code | confirmé par le code | — |
| D-03 | Le mode est forcé selon le préfixe du tiers (PAYX, AGENCE, COM, RELAIS, IMONEY) | procédure | confirmé par le code | liste complète et à jour ? |
| D-04 | Les règlements des journaux `RNC` et `COM` ne sont pas importés dans GRC | mesure | **à confirmer** | traités en compta Sage seulement ? |
| D-05 | Seules les factures liées à une commande BHUB à total ≠ 0 sont importées par le job ; les autres passent par l'écran | code + mesure | **remplacée le 2026-10-01** : source = toute ligne Sage à `cbFlag = 0` (`prc_IntegrerEcheancesSage`) | — |
| D-06 | L'étape 4 force `DO_Valide = 1` dans Sage sur tout document qui a une échéance | code | **à confirmer** | pourquoi valider la facture ? |
| D-07 | Le dépôt « samsung » est exclu des échéances (procédure « Sage ») | code | obsolète (étape morte) | règle toujours valable ailleurs ? |
| D-08 | Trois sources de commandes (`GOCOM_BHUB`, `Go-Com-D_BHUB`, `BEWEB_Gocom`) | code + mesure | **à confirmer** | `BEWEB_Gocom` : société à part ou ancien ? |
| D-09 | GRC fait autorité sur le pointage compta (dérapprochement efface Sage) | code | confirmé par le code | la compta le sait-elle ? |
| D-10 | Règlements importés par l'app et « factures <20000 » à recomptabiliser par GRC | titre d'étape | **à confirmer** | règle encore utile ? le seuil a disparu |
| D-11 | Job 1 toutes les 5 min, job 2 toutes les 10 s, rien entre 23h et 8h | planification | à confirmer | l'« instantané » justifie-t-il 10 s ? |
| D-12 | `MR_Id = 1`, `DE_Id = 4`, `UT_Id = 1`, `SO_Id = 1` en dur sur les échéances créées par le job | procédure | à confirmer | mode réel plutôt que 1 ? |
| D-13 | Mode 17 puis 13 pour les tiers `COM*` (étapes 5 et 14) | procédures | défaut de conception | cible finale = mode 13 ? |

## 8. Glossaire

`MV_*` mouvement / règlement ; `EC_*` échéance ; `AF_*` affectation ; `HC_*` historique compta ; `MV_Type` 0 espèces, 1 chèque,
2 traite, 3 virement/versement, 4 autre ; `MV_Point` 1 = pointé ; `MV_Compta` 1 = comptabilisé par GRC ; `RG_Compta` indicateur
Sage ; `cbFlag` 1 = ligne `F_DOCREGL` déjà intégrée dans GRC ; `DO_Type` 6 facture, 7 facture comptabilisée.
