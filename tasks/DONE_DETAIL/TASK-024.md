# TASK-024 — Endpoint « État de rapprochement d'un relevé » (lecture enrichie, toutes lignes + règlement GRC)

- **Priorité** : 🟠 Majeur (fonctionnalité de suivi demandée par le PO)
- **Domaine** : Backend / Architecture
- **Statut** : TODO
- **Dépend de** : TASK-016 (réservation), TASK-022 (`DateValidation`), TASK-023 (nom réservataire)

## Contexte
Après import d'un relevé, l'opérateur veut **vérifier l'état de rapprochement du relevé** : voir, ligne par ligne, ce qui reste et ce qui est déjà fait. L'espace de travail actuel (`GET /api/relevebancaire/{id}/lignes` → `GetAllLignesExcelAsync`) ne convient pas pour cet usage car il :
1. **masque les lignes validées** (`WHERE ... AND l.DateValidation IS NULL`, [ReleveBancaireRepository.cs:106-120](../GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs#L106)) — voulu pour le workspace (TASK-022), mais on perd la vue « ce qui est déjà rapproché » ;
2. ne **joint pas** les détails du règlement GRC (numéro, date, caisse, client) : la ligne ne porte que `MV_ID`.

## Objectif
Exposer un endpoint **lecture seule** renvoyant **toutes** les lignes d'un relevé (validées comprises), chacune avec :
- son **statut** de rapprochement dérivé : `NonRapproche` (Lettrage/MV_ID NULL) · `Reserve` (MV_ID renseigné, `DateValidation` NULL) · `Valide` (`DateValidation` renseignée) ;
- le **réservataire** (`ReservePar_UserId` + `ReservePar_UserName`, déjà résolus par la jointure `P_UTILISATEUR` de TASK-023) ;
- les **détails du règlement GRC** lié quand `MV_ID` est renseigné : `Numero`, `Date`, `CaisseNo`, `ClientIntitule`.

## Fichiers concernés
- `GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs` (nouvelle méthode `GetEtatRapprochementAsync` + DTO résultat)
- `GRC.API/Controllers/ReleveBancaireController.cs` (nouvelle action `GET {id}/etat`)

## Étapes d'implémentation

### 1. Lecture des lignes (toutes, sans filtre `DateValidation`)
Nouvelle méthode `GetEtatRapprochementAsync(int enteteId)`. Reprendre **exactement** la requête de `GetAllLignesExcelAsync` (jointure `LEFT JOIN P_UTILISATEUR u ON u.UT_Id = l.ReservePar_UserId` + alias `ReservePar_UserName`) mais **sans** la clause `AND l.DateValidation IS NULL` :
```sql
SELECT l.*, COALESCE(NULLIF(LTRIM(RTRIM(ISNULL(u.UT_Nom,'')+' '+ISNULL(u.UT_Prenom,''))),''), u.UT_Login) AS ReservePar_UserName
FROM dbo.RAPP_ReleveBancaire_Ligne l
LEFT JOIN dbo.P_UTILISATEUR u ON u.UT_Id = l.ReservePar_UserId
WHERE l.ReleveBancaireEnteteId = @EnteteId
ORDER BY l.DateOperation ASC;
```
Fermer cette connexion **avant** l'étape 2 (voir contrainte MSDTC/TASK-020).

### 2. Enrichissement règlement GRC via la DLL (lecture)
- Collecter les `MV_ID` **distincts non nuls** des lignes.
- Instancier le repo métier comme ailleurs (`ConnectionProvider` + `ReglementClientRepository`, cf. [ReleveBancaireRepository.cs:202-204](../GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs#L202)) et, pour chaque `MV_ID`, appeler `repo.Get(mvId)` (méthode déjà utilisée en Phase 2, [:211](../GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs#L211)) → construire un `Dictionary<int, ReglementClient>`.
  - `repo.Get` renvoie aussi les règlements **pointés** (nécessaire : les lignes validées pointent un règlement désormais pointé).
  - Champs à extraire : `Numero`, `Date`, `CaisseNo`, `ClientIntitule` (présents sur `ReglementClient` — cf. mapping `ReglementClientDto`, [ReglementService.cs:404-448](../GRC.Infrastructure/Services/ReglementService.cs#L404)).
- **Lecture seule** : uniquement `Get`, aucun `Update`. Ne pas rouvrir la connexion Dapper de l'étape 1 pendant les appels DLL (une connexion à la fois).

### 3. DTO de sortie
Nouveau DTO plat (dans `ReleveBancaireRepository.cs`, à côté de `ValidationPairDto`) :
```csharp
public class LigneEtatRapprochementDto
{
    // Ligne relevé
    public int Id { get; set; }
    public DateTime? DateOperation { get; set; }
    public DateTime? DateValeur { get; set; }
    public string? Libelle { get; set; }
    public string? Reference { get; set; }
    public string? Code { get; set; }
    public decimal? Credit { get; set; }
    public decimal? MontantReel { get; set; }
    // État
    public string Statut { get; set; }            // "NonRapproche" | "Reserve" | "Valide"
    public string? Lettrage { get; set; }
    public int? MV_ID { get; set; }
    public int? ReservePar_UserId { get; set; }
    public string? ReservePar_UserName { get; set; }
    public DateTime? DateReservation { get; set; }
    public DateTime? DateValidation { get; set; }
    // Règlement GRC lié (null si MV_ID null ou règlement introuvable)
    public string? ReglementNumero { get; set; }
    public DateTime? ReglementDate { get; set; }
    public int? ReglementCaisseNo { get; set; }
    public string? ReglementClient { get; set; }
}
```
Calcul du `Statut` : `DateValidation != null` → `"Valide"` ; sinon `MV_ID != null` → `"Reserve"` ; sinon `"NonRapproche"`.

### 4. Action Controller (lecture seule, autorisée)
```csharp
[HttpGet("{id}/etat")]
public async Task<IActionResult> GetEtatRapprochement(int id)
{
    var etat = await _releveRepository.GetEtatRapprochementAsync(id);
    return Ok(etat);
}
```
Le contrôleur est déjà `[Authorize]`. Ne renvoyer que les règlements accessibles à l'utilisateur : les `MV_ID` proviennent des lignes du relevé de sa banque ; `repo.Get` reste borné à l'identifiant demandé — pas d'élargissement de périmètre au-delà de ce que la ligne référence déjà.

## Contraintes
- **Lecture seule stricte** : aucun `Update`/`INSERT`, aucune écriture sur table GRC ni sur `RAPP_ReleveBancaire_Ligne`. La DLL est appelée uniquement via `Get`.
- **TASK-020** : pas de `TransactionScope`, jamais deux connexions ouvertes simultanément (SELECT Dapper fermé avant la boucle DLL) → pas de promotion MSDTC.
- **Clean Architecture** : enrichissement en Infrastructure, exposé via DTO ; aucun SQL ni appel DLL au front.
- Ne **pas** modifier `GetAllLignesExcelAsync` ni son filtre `DateValidation IS NULL` (le workspace doit continuer à masquer les lignes validées — TASK-022). Cette lecture est une méthode **distincte**.
- Réutiliser la jointure `P_UTILISATEUR` déjà validée (TASK-023) — ne pas ré-résoudre les noms autrement.

## Risques / dépendances
- **Perf** : `repo.Get` par `MV_ID` distinct = N appels DLL. Acceptable pour une consultation (un relevé = quelques dizaines à ~200 lignes, souvent moins de MV_ID distincts). Si un relevé s'avère très volumineux, prévoir en évolution un chargement groupé (`GetAll` borné période/caisses puis filtrage par `MV_ID`, comme `ReglementService`) — **non requis** pour cette tâche, à noter seulement.
- Un `MV_ID` dont le règlement est introuvable (`Get` renvoie null) : laisser les champs `Reglement*` à `null`, ne pas planter, garder la ligne avec son statut.

## Checklist VALIDATION (à remplir dans VERIFY/)
- [x] Build OK
- [x] `GET /api/relevebancaire/{id}/etat` renvoie **toutes** les lignes du relevé (validées comprises)
- [x] Statut correct pour les 3 cas : NonRapproche / Reserve / Valide
- [x] Ligne réservée : `ReservePar_UserName` renseigné (nom, pas l'ID)
- [x] Ligne rapprochée : `ReglementNumero` / `ReglementDate` / `ReglementCaisseNo` / `ReglementClient` renseignés depuis la DLL
- [x] Règlement pointé (ligne validée) : détails toujours récupérés (`Get` ne filtre pas les pointés)
- [x] `MV_ID` sans règlement trouvé : champs Reglement* à null, pas de crash
- [x] `GetAllLignesExcelAsync` et le workspace **inchangés** (lignes validées toujours masquées côté travail)
- [x] Aucune écriture base ; aucune `TransactionScope` (pas de régression MSDTC/TASK-020)
- [x] Cohérent avec l'architecture (enrichissement en Infrastructure, DTO exposé)
