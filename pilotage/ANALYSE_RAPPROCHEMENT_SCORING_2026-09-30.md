# Rapprochement — moteur « analyse + commentaire par ligne » (scoring)

> **Statut : ⏸️ STANDBY — décision PO du 2026-09-30.** Aucune TASK créée, aucun code modifié.
>
> **Reprise en 30 secondes :** le PO tranche les 3 décisions du §7 → l'architecte génère 2 TASKs (§8) → Gemini implémente.
>
> Rédigé le 2026-09-30 (architecte). Les mesures du §3-§4 sont un **instantané de la prod du même jour** : les chiffres bougent au fur et à mesure que les relevés sont traités.

---

## 1. Demande du PO

- Le rapprochement suit la règle **1 = 1** (une ligne de relevé ↔ un règlement). L'existant est **stable : on n'y touche pas**.
- Nouveau fonctionnel, **additif** : une notion de **scoring** avec conditions sur le **montant**, la **date**, ou **les deux**.
- Précision du PO : le « trou » du moteur actuel (il ne propose rien quand le montant n'est pas unique) est **voulu** — le PO veut être sûr que le moteur ne choisisse pas le mauvais règlement.
- Le nouveau moteur peut **élargir** : traiter « 1 ligne de relevé ↔ 2 règlements de même montant, ou l'inverse », avec **un commentaire devant chaque ligne** et un **score**.
- Esprit : le nouveau module **ne réserve jamais rien tout seul**.

## 2. L'existant (vérifié dans le code)

- **Moteur strict** — `AutoReconciliationEngine.CalculerPropositions` : encaissements non lettrés uniquement (Crédit > 0), groupés par montant ; ne garde que les montants **uniques des deux côtés** (relevé et règlements GRC) puis propose la paire. Dès que deux lignes, ou deux règlements, partagent un montant → **aucune proposition**. ([AutoReconciliationEngine.cs:41-51](../GRC.Application/Services/AutoReconciliationEngine.cs#L41-L51))
- **Chaîne d'appel** — bouton « auto » → `POST /ReleveBancaire/auto-reconcile` ([ReleveBancaireController.cs:128-180](../GRC.API/Controllers/ReleveBancaireController.cs#L128-L180)) → front → `POST /reserve-batch` (lettre attribuée côté serveur) → grilles mises à jour → « Approuver » (`/validate`). ([RapprochementBancaire.tsx:634-701](../gocom-web/src/RapprochementBancaire.tsx#L634-L701))
- **Le 1=1 est tenu par la réservation, pas par le moteur** : `UPDATE … WHERE Lettrage IS NULL AND NOT EXISTS (… MV_ID=@MvId)`. ([ReleveBancaireRepository.cs:498-499](../GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs#L498-L499)) Tout nouveau moteur qui réserve via `/reserve-batch` en hérite.
- **Aucun contrôle de montant** ni à la réservation ni à l'approbation.
- **À l'approbation** (règlement non comptabilisé) : `MV_Date` et `MV_DateEcheance` sont **écrasées** par la date d'opération du relevé ; le code de la ligne est recopié dans `ExtraitNum`/`PieceNumero` et le libellé bancaire dans `Libelle`. ([ReleveBancaireRepository.cs:731-772](../GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs#L731-L772)) Conséquences : (a) un mauvais appariement contamine le règlement ; (b) l'historique des paires validées ne permet **pas** de mesurer l'écart de date.
- **Éligibilité** : `MV_Type = 3` (virement/versement) ou (`MV_Type` 1/2 chèque/traite **et** `MV_Remis = 2`). ([ReglementEligibilityHelper.cs:7-13](../GRC.Application/Services/ReglementEligibilityHelper.cs#L7-L13))
- Déjà acté dans `tasks/TODO.md` : « Matching montant SEUL (date ignorée) : voulu » et « Rapprochement strict 1=1 : voulu ».

## 3. Mesures sur la prod (lecture seule, 2026-09-30)

**Cadre.** Accès fourni par le PO pour ce test ; SELECT uniquement (+ tables temporaires de session), rien écrit dans la base. Candidats = règlements `MV_Domaine = 0`, non pointés, non annulés, éligibles, **non réservés**, même banque (`BN_Id` = `BanqueId` du relevé), même montant, datés de `D−N` à `D+3` (`D` = date de la ligne). Droits de caisse non appliqués. Requête rejouable en annexe A.

**Mode d'exploitation.** Un relevé = **un jour × une banque** (1 BCP, 2 CDM, 3 ATWB, 4 BMCE, 5 CIH), pas un relevé mensuel. Les relevés d'exemple mensuels de `extrait gocom/062026/` montrent 20,5 % de lignes qui partagent leur montant dans le mois, mais ne reflètent pas ce mode : **à ne pas utiliser pour dimensionner**.

**Répartition des 126 lignes libres des relevés du 29/09** (ids 243 à 247), selon l'ancienneté maximale `N` des règlements retenus :

| Fenêtre | Certain (l'Auto le propose) | Ambigu | Aucun règlement |
|---|---|---|---|
| 7 jours | 53 (42 %) | 5 (4 %) | 68 (54 %) |
| 30 jours | 53 (42 %) | 9 (7 %) | 64 (51 %) |
| 90 jours | 52 (41 %) | 18 (14 %) | 56 (44 %) |

**Autres mesures**
- **Semaine du 23 au 29/09** (27 relevés, 313 lignes libres), fenêtre 7 j : **12 lignes ambiguës** (6 « 1 ligne ↔ N règlements », 6 « N lignes ↔ 1 règlement »), dont **une seule** départagée par la date.
- **Écart de date des paires « certaines » du 29/09 : 94 % à 0 jour** — les règlements sont saisis à la date bancaire, donc les vrais jumeaux sont de même jour et **rien ne les sépare**.
- **Montant** : 10 978 paires validées sur 10 980 ont un montant identique → aucun besoin de tolérance observé.
- **Aucune clé commune ligne ↔ règlement** : `MV_PieceBq` vaut toujours « BQ », `MV_Reference` est un n° de BL, `MV_Tire` se retrouve dans le libellé bancaire dans moins de 1 % des cas (sauf CDM ≈ 32 %), `MV_RecouvCin`/`MV_RecouvNom` ne sont jamais renseignés.
- **Origine du doute** : des règlements virement/versement **en attente depuis juillet-août** sur des montants ronds (500, 1 000, 2 000, 5 000, 10 000, 20 000). Jusqu'à **34 candidats** pour une seule ligne de 20 000,00. Au total 698 règlements non pointés depuis le 01/08 (toutes banques).

## 4. Exemples réels (ids : ligne = `RAPP_ReleveBancaire_Ligne.Id`, mv = `RT_MOUVEMENT.MV_Id`)

| # | Cas | Données | Ce que dirait le moteur |
|---|---|---|---|
| 1 | **La date tranche** | ligne 27320 (ATWB, 23/09, 10 000,00) ↔ règlement 70366 (23/09, 0 j) contre 71537 et 71538 (25/09, 2 j) | 🟠 Probable : 70366 (marge 2 j) |
| 2 | **Ancien contre récent** | ligne 29009 (BMCE, 29/09, 786,00) ↔ 72090 (29/09) contre 56324 (31/07, 60 j) | à 7 j : ✅ Certain ; à 90 j : 🟠 Probable |
| 3 | **Doublon possible** | lignes 28945 (4 432,00) et 28944 (4 661,00) (ATWB, 29/09) ↔ 72071/72072 et 72069/72070, même jour, caisse 52, comptes IMONEY43 / AGENCE43. Ligne 27319 (2 755,00, 23/09) ↔ 70444/70445, caisse 79, IMONEY83 / PAYX83 | 🔴 À départager — doublon possible |
| 4 | **Le contraire (N lignes ↔ 1 règlement)** | lignes 28250 à 28253 (BCP, 28/09, 4 × 3 000,00) ↔ 1 seul règlement 72112 (29/09). Lignes 28776-28777 (BCP, 29/09, 2 × 2 000,00) ↔ 1 seul règlement 72110 (29/09) | 🔴 À départager : le règlement va à *une* ligne, les autres n'en ont pas (à générer) |
| 5 | **Jumeaux du même client** | ligne 28971 (ATWB, 29/09, 3 000,00) ↔ 69621/69622 (22/09, même client, créés à 3 min d'écart, BL différents). Ligne 28060 (25/09, 10 000,00) ↔ 71537/71538 (même client, 1 min d'écart) | 🔴 Jumeaux — choix manuel |
| 6 | **Pollution par l'ancien** | ligne 28714 (BCP, 29/09, 20 000,00) : 34 candidats du 01/07 au 31/08, aucun dans les 7 derniers jours | ⚪ Aucun règlement récent — « 34 plus anciens ignorés » |

**Chaîne à noter (cas 1 puis 5)** : une fois 70366 confirmé pour la ligne 27320, la ligne 28060 (25/09, même montant) reste avec 71537 et 71538, deux jumeaux.

## 5. Approche proposée — V1 légère *(proposition de l'architecte, non validée par le PO)*

**Principe.** Le moteur strict, `/auto-reconcile`, `handleAutoReconcile`, `/reserve*` et `/validate` restent **intouchés**. Le nouveau module ne décide jamais : il **explique** chaque ligne libre et **classe** les candidats ; l'utilisateur choisit, puis `/reserve-batch`, puis « Approuver ».

**Composants (uniquement de nouveaux fichiers)**
- **Moteur pur** dans `GRC.Application/Services/` (nom provisoire `AnalyseReleveEngine`), avec DTO **propres** (ne pas étendre `GrcReglementDto`, utilisé par le strict), testable sans base.
- **Endpoint dédié** (ex. `POST /ReleveBancaire/analyse`) : mêmes contrôles d'accès que les endpoints sécurisés par TASK-075 (recroisement `SocieteId`/`BanqueId`, 401/403) et mêmes droits de caisse (claim `Caisses`) que `/auto-reconcile`.
- **Front** : vue séparée « Analyse du relevé » (modale ou onglet), grille conforme à [ARCHITECTURE.md](../ARCHITECTURE.md) (ExcelFilter en mode liste, `ColumnDef[]`, colonnes persistées) sauf dérogation PO ; commentaire en première colonne ; sélection puis `/reserve-batch`.

**Candidats.** Règlements non pointés, non annulés, éligibles, **non réservés**, même banque, même montant, datés de `D−N` à `D+3` (`N` = fenêtre de récence, **7 jours par défaut, réglable**). Ceux hors fenêtre ne sont pas proposés mais **comptés** dans le commentaire.

**Score et règle de sûreté.** Score 0 à 100 = `100 − 10 × jours d'écart` (plancher 0) ; date du relevé = `DateOperation`, date GRC = `MV_Date`. Une paire est **probable** seulement si elle est **la meilleure des deux côtés** (pour la ligne ET pour le règlement) avec **au moins 2 jours d'avance** sur le 2ᵉ candidat. Égalité ou marge insuffisante → « à départager » : jamais de choix arbitraire (même philosophie que le moteur strict).

**Vocabulaire des commentaires (proposé)**

| Commentaire | Condition |
|---|---|
| ✅ Certain | un seul règlement et une seule ligne à ce montant dans la fenêtre — l'Auto le propose déjà |
| 🟠 Probable | paire meilleure des deux côtés avec ≥ 2 j d'avance |
| 🔴 À départager | plusieurs candidats sans paire nette ; candidats listés, triés par score |
| 🔴 Doublon possible | ≥ 2 règlements de même montant, même date, même caisse (comptes clients différents) — sous réserve de la décision 2 |
| ⚪ Règlement mieux placé ailleurs | « le contraire » : le règlement est plus proche d'une autre ligne → cette ligne n'a pas de règlement ; piste : générer le règlement depuis la ligne (TASK-060) |
| ⚪ Aucun règlement | aucun candidat dans la fenêtre (+ « N plus anciens ignorés ») |

**Jumeaux.** Choix **manuel** (12 lignes par semaine). Pas de « appliquer dans l'ordre » : l'approbation recopie libellé et code de la ligne sur le règlement, donc un ordre arbitraire mettrait le libellé d'un déposant sur le règlement d'un autre.

**Cascade.** Après confirmation des paires probables ou choisies, relancer l'Auto règle les restes devenus uniques. Risque : une erreur de choix se propage → d'où l'absence de tout clic automatique.

**Découpage prévisible (2 TASKs).** (1) Back : moteur pur + tests unitaires (certain, 1→N, N→1, N↔M, égalité, marge, fenêtre, exclusion des réservés) + endpoint + sécurité. (2) Front : vue séparée + sélection + appel `/reserve-batch`.

**Points d'attention**
- Le score de date discrimine peu sur les données réelles (1 cas sur 12) : **ne pas sur-investir** (pas d'algorithme d'affectation global).
- Fenêtre trop courte → un vrai règlement ancien masqué : d'où « N plus anciens ignorés » et la fenêtre réglable.
- Multi-postes : l'analyse est un instantané ; la réservation atomique reste l'arbitre (conflits 409 gérés comme aujourd'hui).

## 6. Hors V1 (idées à noter, pas à faire maintenant)

- Tolérance de montant (aucun besoin observé, cf. §3).
- Indice « nom du déposant » (pas de lien établi avec le client du règlement).
- N° de chèque dans le libellé (chèques < 2 % des lignes ; utile pour les « ENCAISSEMENT CHEQUE N … » de BCP).
- Remises N→1 (une ligne bancaire = N chèques) : contraire au 1=1.
- Lignes au débit ; vue « règlements sans ligne ».
- Voisin mais **distinct** : l'item TODO « Recherche historique compta/GR depuis une ligne de relevé ».

## 7. Décisions PO en attente

1. **Fenêtre de récence** : 7 jours par défaut, réglable ? *(recommandé : oui)*
2. **Comptes IMONEY / AGENCE / PAYX** : sont-ce de vrais doublons de saisie ? Si oui, le commentaire dira « doublon possible » (l'action, annuler l'un des deux, reste hors périmètre du module).
3. **Vue séparée** *(recommandé : n'altère pas l'écran stable)* ou colonne ajoutée à la grille actuelle ?

## 8. Reprise — prochaines étapes

1. Le PO répond aux 3 décisions du §7.
2. *(Optionnel)* Nouvelle mesure sur la prod pour recaler les chiffres et la fenêtre : accès à redemander au PO, SELECT uniquement, annexe A.
3. L'architecte génère les 2 TASKs complètes (gabarit `tasks/_TEMPLATE.md`), retire la ligne « standby » de `tasks/TODO.md`, ajoute les TASKs en ACTIF et note les idées du §6.
4. Gemini implémente → VERIFY → review par un tiers (pas par l'implémenteur).

## 9. Constats annexes (hors sujet, à cadrer séparément)

- **698 règlements** virement/versement non pointés depuis le 01/08 (toutes banques), beaucoup anciens et sur montants ronds : ils polluent l'ambiguïté pour n'importe quel moteur. À cadrer (nettoyage / régularisation).
- **Sécurité.** Le compte SQL fourni pour l'analyse dispose de **droits d'administration complets** sur le serveur de prod, et son mot de passe a été partagé en clair dans une conversation. Recommandation : un login **lecture seule** dédié aux analyses, et **changer ce mot de passe**. Aucun identifiant n'est consigné dans ce dépôt.
- **Piège T-SQL** : le login en français applique `DATEFORMAT dmy` → toujours écrire les dates au format `'YYYYMMDD'`.

---

## Annexe A — Rejouer la mesure (lecture seule)

Exécution : `sqlcmd -S <serveur> -d GR_GOCOM -U <login lecture seule> -C -W -s '|' -i analyse.sql -v P=7 E1=221 E2=247`, avec le mot de passe dans la variable d'environnement `SQLCMDPASSWORD` (jamais dans un fichier). `P` = fenêtre de récence en jours ; `E1`..`E2` = plage d'Id de relevés (`RAPP_ReleveBancaire_Entete.Id`).

```sql
SET NOCOUNT ON;
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SET LOCK_TIMEOUT 5000;
DECLARE @P int = $(P);
DECLARE @E1 int = $(E1), @E2 int = $(E2);

IF OBJECT_ID('tempdb..#L') IS NOT NULL DROP TABLE #L;
IF OBJECT_ID('tempdb..#R') IS NOT NULL DROP TABLE #R;
IF OBJECT_ID('tempdb..#P') IS NOT NULL DROP TABLE #P;
IF OBJECT_ID('tempdb..#C') IS NOT NULL DROP TABLE #C;

-- Lignes de relevé encore libres (encaissements, ni lettrées ni réservées)
SELECT l.Id AS LId, e.Id AS EId, e.BanqueId AS Bk, CAST(l.DateOperation AS date) AS D, l.Credit AS Amt
INTO #L
FROM dbo.RAPP_ReleveBancaire_Ligne l
JOIN dbo.RAPP_ReleveBancaire_Entete e ON e.Id = l.ReleveBancaireEnteteId
WHERE e.Id BETWEEN @E1 AND @E2 AND l.Credit > 0 AND l.Lettrage IS NULL AND l.MV_ID IS NULL;

-- Règlements candidats : non pointés, non annulés, éligibles, non déjà réservés
SELECT m.MV_Id AS RId, m.BN_Id AS Bk, CAST(m.MV_Date AS date) AS D, m.MV_Montant AS Amt
INTO #R
FROM dbo.RT_MOUVEMENT m
WHERE m.MV_Domaine = 0 AND m.MV_Point = 0 AND ISNULL(m.MV_Annule,0) = 0
  AND (m.MV_Type = 3 OR (m.MV_Type IN (1,2) AND m.MV_Remis = 2))
  AND m.MV_Date >= '20260101'
  AND NOT EXISTS (SELECT 1 FROM dbo.RAPP_ReleveBancaire_Ligne x WHERE x.MV_ID = m.MV_Id);

-- Paires possibles : même banque, même montant, règlement dans la fenêtre [D-P ; D+3]
SELECT L.LId, L.EId, L.Bk, L.D AS LD, L.Amt, R.RId, R.D AS RD, ABS(DATEDIFF(day, L.D, R.D)) AS gap
INTO #P
FROM #L L JOIN #R R ON R.Bk = L.Bk AND R.Amt = L.Amt
 AND R.D BETWEEN DATEADD(day, -@P, L.D) AND DATEADD(day, 3, L.D);

-- Classification par groupe (relevé, montant) : nL lignes libres, nR règlements candidats
;WITH G  AS (SELECT EId, Amt, COUNT(*) AS nL FROM #L GROUP BY EId, Amt),
      GR AS (SELECT EId, Amt, COUNT(DISTINCT RId) AS nR FROM #P GROUP BY EId, Amt)
SELECT L.LId, L.EId, L.Bk, L.D, L.Amt, G.nL, ISNULL(GR.nR,0) AS nR,
       CASE WHEN ISNULL(GR.nR,0) = 0 THEN 'aucun'
            WHEN G.nL = 1 AND GR.nR = 1 THEN 'certain'
            WHEN G.nL = 1 THEN '1L-NR'
            WHEN GR.nR = 1 THEN 'NL-1R'
            ELSE 'NL-NR' END AS cas
INTO #C
FROM #L L JOIN G ON G.EId = L.EId AND G.Amt = L.Amt
LEFT JOIN GR ON GR.EId = L.EId AND GR.Amt = L.Amt;

-- (1) Répartition des lignes libres par cas
SELECT cas, COUNT(*) AS lignes, CAST(100.0*COUNT(*)/SUM(COUNT(*)) OVER() AS decimal(5,1)) AS pct
FROM #C GROUP BY cas ORDER BY cas;

-- (2) Lignes ambiguës devenant « probables » (marge = écart mini de jours vs le 2e candidat ; fenêtre = écart max)
;WITH PP AS (
  SELECT p.LId, p.RId, p.gap,
    (SELECT MIN(p2.gap) FROM #P p2 WHERE p2.LId = p.LId AND p2.RId <> p.RId) AS othL,
    (SELECT MIN(p3.gap) FROM #P p3 WHERE p3.RId = p.RId AND p3.EId = p.EId AND p3.LId <> p.LId) AS othR
  FROM #P p JOIN #C c ON c.LId = p.LId AND c.cas IN ('1L-NR','NL-1R','NL-NR')
), K AS (SELECT k, w FROM (VALUES (1,3),(1,7),(2,3),(2,7),(2,15),(3,7)) v(k,w))
SELECT K.k AS marge_j, K.w AS fenetre_j, COUNT(DISTINCT PP.LId) AS lignes_probables
FROM PP CROSS JOIN K
WHERE PP.gap <= K.w
  AND (PP.othL IS NULL OR PP.othL - PP.gap >= K.k)
  AND (PP.othR IS NULL OR PP.othR - PP.gap >= K.k)
GROUP BY K.k, K.w ORDER BY K.k, K.w;

-- (3) Détail des cas ambigus (ligne × règlements candidats)
SELECT c.cas, c.EId AS releve, c.Bk AS bq, c.Amt AS montant, c.LId AS ligne, CONVERT(varchar(10), c.D, 120) AS date_ligne,
       p.RId AS mv_id, CONVERT(varchar(10), p.RD, 120) AS date_regl, p.gap AS ecart_j,
       m.CA_IdIn AS caisse, m.CT_Code AS client, CONVERT(varchar(16), m.MV_DateCreation, 120) AS cree_le,
       LEFT(ISNULL(m.MV_Reference,''), 14) AS ref_bl
FROM #C c
JOIN #P p ON p.LId = c.LId
JOIN dbo.RT_MOUVEMENT m ON m.MV_Id = p.RId
WHERE c.cas IN ('1L-NR','NL-1R','NL-NR')
ORDER BY c.cas, c.EId, c.Amt, c.LId, p.gap, p.RId;
```

Cas : `certain` = 1 ligne et 1 règlement au montant ; `1L-NR` = 1 ligne pour N règlements ; `NL-1R` = N lignes pour 1 règlement ; `NL-NR` = N lignes pour M règlements ; `aucun` = aucun règlement dans la fenêtre.
