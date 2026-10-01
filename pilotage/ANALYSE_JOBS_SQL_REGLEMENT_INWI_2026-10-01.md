# Analyse des jobs SQL Agent « GR Job Reglement Inwi » — 2026-10-01

Serveur client 172.16.0.205 (SQL Server 2019). Analyse faite à partir des scripts de création des jobs,
du code des procédures (sauf `vDetailAffectation`, chiffrée) et de mesures en lecture seule.
Aucune modification n'a été appliquée sur le serveur.

## 1. Conclusion

Les deux jobs forment une chaîne de synchronisation cohérente (BHUB / Sage → GR_GOCOM). La performance
n'est pas un sujet (toutes les étapes < 1 s, `RT_MOUVEMENT` = 44 048 lignes, 1 société). Les vrais défauts :

1. **Aucune supervision** : historique Agent limité à 100 lignes par job (≈ 35 min pour le job 1, ≈ 4 min pour
   le job 2), pas de Database Mail, pas d'opérateur, quasi toutes les étapes en `on_fail=3` (échec masqué).
2. **Boucle d'écriture `COM%`** : étape 5 force le mode 17, étape 14 le convertit en 13, à chaque cycle
   (287 règlements concernés, tous en 13 aujourd'hui).
3. **Deux étapes mortes** : étape 7 du job 1 (`1=0`) et étape 3 du job 1 (source `BEWEB_Gocom`, 0 échéance produite).
4. **Ordre des étapes** : l'étape 1 (`MV_Type`) passe avant l'étape 5 (changement de mode) et avant l'étape 11
   (import) → décalage d'un cycle.
5. **11 règlements jamais importés** (abandon silencieux par `INNER JOIN`, aucune trace) :
   - 10 règlements (8 017) de tiers `COM*` sur le journal `RNC` : ce journal n'a aucune ligne `F_EBANQUE` (pas un compte
     bancaire). Exclusion de fait depuis le début (158 règlements `RNC` et 18 `COM` côté BHUB depuis avril, aucun importé
     avec une banque : les 287 `COM%` de GRC sont tous sur les banques 1 à 5) ; très probablement traités en compta
     directement dans Sage. Les 10 restent à `RG_Compta = 0` tant que la compta ne les a pas passés. À confirmer avec la compta.
   - 1 virement (`PAYXR71`, 2 824, 2026-09-29) : compte BHUB `RI FDALATTE` sans caisse dans `RT_CAISSE` → **à corriger**
     (créer la caisse et l'utilisateur de même code depuis l'application).

## 2. Architecture

```
BHUB.[ORDER] + Sage F_DOCENTETE/F_DOCREGL ─► prc_InsertEcheance* ─► GR.RT_ECHEANCE
BHUB.REGLEMENT + Sage F_CREGLEMENT        ─► prc_InsertReglement ─► GR.RT_MOUVEMENT + RT_HISTOMVT
Sage F_REGLECH                            ─► prc_InsertAffectation ─► GR.RT_AFFECTATION ─► prc_UPDSolde
GRC dépointe un règlement                 ─► job 2 ét. 1 ─► efface le pointage dans F_ECRITUREC
```

Sources d'échéances (13 450 en base) : 11 974 hors BHUB (écran GRC / Sage direct), 947 `GOCOM_BHUB`,
529 `Go-Com-D_BHUB`, 0 `BEWEB_Gocom`, aucun recouvrement entre sources.

## 3. Rôle de chaque étape

### Job 1 (toutes les 5 min, 8h–18h lun–sam ; 1 h le dimanche et de 18h à 23h)

| # | Étape | Rôle réel | Constat / action |
|---|---|---|---|
| 1 | Correction Type Règlement | `MV_Type = MR_TypeNo` du mode | OK (map_mr cohérente avec P_MODEREGLEMENT). Déplacer **après** les étapes 5 et 11. |
| 2 | prc_InsertEcheance (Go-Com-D_BHUB) | Échéances des commandes `O_TYPE = 6` de cette base (529 produites) | OK. |
| 3 | prc_InsertEcheance_Sage | Variante lisant `BEWEB_Gocom.[ORDER]`, exige `do_valide=1`, exclut le dépôt « samsung » | **Morte** : aucun `O_ERP_FACTURE` de `BEWEB_Gocom` n'existe dans `GOCOM.F_DOCENTETE`, 0 à insérer. Désactiver. |
| 4 | Flag Echeance | `DO_Valide = 1` sur le document Sage + `cbFlag = 1` (par pièce) pour que l'import par écran/DLL ne réintègre pas | OK. Le flag par pièce est voulu (Sage change `DR_No` au passage 6→7). Qualifier les colonnes (`g.DO_Valide`, `g.cbFlag`). |
| 5 | Change Mode Règlement | Force `MR_Id` par préfixe du tiers (PAYX→15, AGENCE→16, COM→17, RELAIS→18, IMONEY→19) sur `RT_MOUVEMENT` et `RT_HISTOMVT` | **Bloc COM à rediriger vers 13** (voir §4.1). Aucune garde compta/pointé. |
| 6 | UPD Solde | Recalcule `MV_Solde`/`EC_Solde` et les états depuis `RT_AFFECTATION` | OK, mais ne remet jamais un solde si la dernière affectation disparaît. |
| 7 | Synchro Derap GR→Sage | Copie désactivée (`1=0`) de l'étape 1 du job 2 | **Morte**, supprimer. |
| 8 | Décomptabilise règlements importés (« <20000 ») | `MV_Compta = 0` pour les règlements dont le n° = pièce de facture, sans historique compta (importés par l'app GRC) | Déduit. Le filtre « <20000 » du titre n'existe plus. |
| 9 | Décompta versements importés | Idem pour les versements `RV%` à pièce `#…#` | Déduit. Remplacer `LEFT/RIGHT` par `LIKE '#%#'` (cosmétique). |
| 10 | prc_InsertEcheance (GOCOM_BHUB) | Échéances des commandes `O_TOTAL <> 0` (947 produites) | OK, backlog 0. Les 15 713 factures à `O_TOTAL = 0` ont un TTC Sage nul (3 exceptions, 13 950, hors job). |
| 11 | prc_InsertReglement | Importe les règlements BHUB (`RG_Compta = 0`), mappe le mode, crée `RT_MOUVEMENT` + `RT_HISTOMVT` | Transactionnelle. Abandon silencieux par `INNER JOIN` (11 cas). `on_fail=2` : une ligne en erreur bloque les étapes 12–14. |
| 12 | prc_InsertAffectation | Crée les affectations depuis `F_REGLECH` | OK (0 affectation sans échéance). |
| 13 | Flag compta Sage | `RG_Compta = 1` : **pierre tombale anti-réimport** (un règlement supprimé dans GRC ne revient pas) + Sage ne comptabilise pas | OK, 8 268 virements 2026 en attente de rapprochement (normal). |
| 14 | Corriger Comm→RNC | Mode 17 → 13, type 4 | **À supprimer** une fois l'étape 5 corrigée. Modifie aussi l'historique. |

### Job 2 « Planification Instantané » (toutes les 10 s, 8h–18h lun–sam)

| # | Étape | Rôle réel | Constat |
|---|---|---|---|
| 1 | Synchro dérapprochement | `EC_TresoPiece = ''` et `EC_DateRappro = 1753` sur les écritures des règlements non pointés | OK, idempotent. Écrire `'17530101'`. Ne tourne ni la nuit ni le dimanche. |
| 2 | maj dépôt Info1 | Écrase `EC_Info1` (posé à `DO_Coord01` par les procédures) par l'intitulé du dépôt (valeur DLL) | Rustine : corriger les procédures supprimerait l'étape. Ajouter `e.DO_Domaine = 0` et `OR EC_Info1 IS NULL`. |
| 3 | upd info4 reg | `MV_Info4` = client du BL pour les règlements liés à un BL | Les règlements BHUB ont `MV_Reference = NULL`, non concernés. |

## 4. Détail des défauts

### 4.1 Boucle COM (confirmée)
Étape 5 : `COM%` et mode ≠ 17 → 17. Étape 14 : mode 17 → 13, type 4. Les 287 règlements sont tous en 13 :
chaque cycle les remet à 17 puis à 13 (4 `UPDATE` par règlement, historique compris). Le mode 17 est de type 3
(éligible au rapprochement) mais `MV_Type` reste 4 pendant l'intervalle : pas de fuite d'éligibilité.
**Correctif :** bloc COM de `prc_ChnageModeReglement` → cible 13 (jamais 17), supprimer l'étape 14.
Ne pas simplement retirer le bloc : le mode 17 n'est produit que par cette procédure.

### 4.2 Historique et alertes
`jobhistory_max_rows` = 1000, `jobhistory_max_rows_per_job` = 100 (défauts). Le job 2 écrit ≈ 14 000 lignes/jour.
Pour garder ≈ 1 semaine : ≈ 150 000 au total, 100 000 par job (à valider). Configurer Database Mail
(`email_profile` = NULL) ou `notify_level_eventlog = 2`, et un opérateur.

### 4.3 Étape 11 : blocage et abandons
`on_fail=2` sur 10/11 : une erreur sur `prc_InsertReglement` (THROW) saute les étapes 12–14 à chaque cycle.
Les `INNER JOIN` (P_REGLEMENT, ACCOUNT, RT_CAISSE sur `A_LASTNAME`, ERP_CLIENT, F_EBANQUE sur le journal,
P_UTILISATEUR sur le login de caisse, `map_mr`) écartent sans trace tout règlement qui échoue sur un seul.
Modes Sage non mappés : 7 et ≥ 9.

### 4.4 Dérive des procédures d'échéance par rapport à la DLL
`MR_Id = 1`, `DE_Id = 4`, `UT_Id = 1`, `SO_Id = 1` en dur ; `EC_Montant = DO_TotalTTC` recopié sur chaque
ligne `F_DOCREGL` (aucune facture multi-échéance aujourd'hui) ; payeur = client ; `EC_Info1 = DO_Coord01`.
Une échéance supprimée dont la facture est liée à une commande BHUB (`O_TOTAL <> 0`) est recréée sous 5 minutes
avec ces valeurs, différentes de celles du script d'intégration (mode réel, `SUM(DL_MontantTTC)`).

### 4.5 Autres
- `prc_UPDSolde` : jamais de remise à zéro, ignore les ajustements/escomptes.
- `prc_ChnageModeReglement` : pas de garde compta/pointé/remis ; ne touche pas `MV_Type` (réaligné par l'étape 1
  au cycle suivant). Les modes 15–19 sont de type 3 (éligibles au rapprochement GRC_WEB).
- Étape 1 du job 2 : efface un pointage Sage fait à la main sur un règlement non pointé dans GRC (GRC fait autorité).
- Propriétaires différents (`GOCOM-AD\beweb`, `Beweb`) ; planification du job 1 à 18:00 en double (inoffensif) ;
  aucune exécution de 23h à 8h.

## 5. Risques examinés et écartés (mesures du 2026-10-01)

Conflit `map_mr` / `MR_TypeNo` (tout concorde) ; doublons de journaux `F_EBANQUE` ou de `MV_Numero` (0) ;
affectations sans échéance, piège `DR_No` 6→7 (0) ; factures à plusieurs échéances (0) ; plusieurs sociétés (1 seule) ;
`Go-Com-D_BHUB` = copie de dev (non : source distincte de 2 541 commandes).

## 6. Plan de correction proposé (rien appliqué)

1. Historique, Database Mail ou journal d'événements, opérateur ; `on_fail` cohérent.
2. `prc_ChnageModeReglement` : COM → 13 ; supprimer l'étape 14.
3. Déplacer l'étape 1 après les étapes 5 et 11.
4. Désactiver l'étape 3, supprimer l'étape 7.
5. Étape 11 : journaliser les rejets au lieu de les perdre ; traiter les 11 règlements actuels.
6. Facultatif : écrire `Info1` correctement dans les procédures puis supprimer l'étape 2 du job 2 ;
   UPDSolde complet ; qualifier les colonnes de l'étape 4.

Tout script doit d'abord être testé sur une base factice, avec mode aperçu, puis sauvegarde de `GR_GOCOM`
et `msdb` avant application sur le serveur client.

## 7. Reste à vérifier

- Confirmer avec la compta que les règlements des journaux `RNC` et `COM` sont bien traités uniquement dans Sage
  (10 en attente depuis le 2026-08-06, 8 017).
- Créer la caisse `RI FDALATTE` (+ utilisateur) pour `PAYXR71`.
- Code de la vue chiffrée `vDetailAffectation` (étape 8) : illisible, mais coût nul.
