using System;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.Linq;
using System.Threading.Tasks;
using Dapper;
using GRC.Infrastructure.Data;
using GRC.Infrastructure.Repositories;
using Microsoft.Extensions.Configuration;

const string ConnString = "Server=localhost;Database=GR_GOCOM;Integrated Security=True;TrustServerCertificate=True";

Console.WriteLine("================================================================================");
Console.WriteLine("   HARNESS VALIDATION TASK-081 — RÈGLEMENT ESPÈCE : PIÈCE ET LIBELLÉ FACTURE");
Console.WriteLine("================================================================================");

int totalTests = 0;
int passedTests = 0;

void AssertTrue(string description, bool condition, string detail = "")
{
    totalTests++;
    if (condition)
    {
        Console.WriteLine($"  [PASS] {description}");
        passedTests++;
    }
    else
    {
        Console.WriteLine($"  [FAIL] {description} : {detail}");
    }
}

using var conn = new SqlConnection(ConnString);
await conn.OpenAsync();

// ------------------------------------------------------------------------------------------------
// 1. AUDIT DE L'ENSEMBLE DES RÈGLEMENTS ESPÈCE RÉELS (MV_Type = 0)
// ------------------------------------------------------------------------------------------------
Console.WriteLine("\n--- ÉTAPE 1 : Audit volumétrie globale et affectation facture sur règlements espèce ---");

const string sqlAudit = @"
SELECT 
    COUNT(*) as TotalEspece,
    SUM(CASE WHEN r.MV_Compta = 0 THEN 1 ELSE 0 END) as NonComptaTotal,
    SUM(CASE WHEN r.MV_Compta = 1 THEN 1 ELSE 0 END) as DejaComptaTotal,
    SUM(CASE WHEN fact.FactureNumero IS NOT NULL THEN 1 ELSE 0 END) as AvecFactureTotal,
    SUM(CASE WHEN fact.FactureNumero IS NULL THEN 1 ELSE 0 END) as SansFactureTotal,
    SUM(CASE WHEN r.MV_Compta = 0 AND fact.FactureNumero IS NULL THEN 1 ELSE 0 END) as NonComptaSansFacture,
    SUM(CASE WHEN r.MV_Compta = 1 AND fact.FactureNumero IS NULL THEN 1 ELSE 0 END) as DejaComptaSansFacture
FROM RT_MOUVEMENT r
OUTER APPLY (
    SELECT TOP 1 ec.DO_Numero AS FactureNumero
    FROM   RT_AFFECTATION af
    JOIN   RT_ECHEANCE   ec ON ec.EC_Id = af.EC_Id
    WHERE  af.MV_Id = r.MV_ID
      AND  ec.DO_Type = 6
    ORDER BY af.AF_Id
) fact
WHERE r.MV_Type = 0 AND r.MV_Domaine = 0;";

var audit = await conn.QuerySingleAsync(sqlAudit);
int totalEspece = (int)audit.TotalEspece;
int nonComptaTotal = (int)audit.NonComptaTotal;
int dejaComptaTotal = (int)audit.DejaComptaTotal;
int sansFactureTotal = (int)audit.SansFactureTotal;
int avecFactureTotal = (int)audit.AvecFactureTotal;
int nonComptaSansFacture = (int)audit.NonComptaSansFacture;
int dejaComptaSansFacture = (int)audit.DejaComptaSansFacture;

Console.WriteLine($"  Total règlements espèce : {totalEspece}");
Console.WriteLine($"  Non comptabilisés (MV_Compta = 0) : {nonComptaTotal}");
Console.WriteLine($"  Déjà comptabilisés (MV_Compta = 1) : {dejaComptaTotal}");
Console.WriteLine($"  Avec facture affectée : {avecFactureTotal}");
Console.WriteLine($"  Sans facture affectée au total : {sansFactureTotal}");
Console.WriteLine($"  Non comptabilisés SANS facture : {nonComptaSansFacture}");
Console.WriteLine($"  Déjà comptabilisés SANS facture (historique janv 2026) : {dejaComptaSansFacture}");

AssertTrue("Volumétrie espèce cohérente (> 20 000 lignes)", totalEspece > 20000);
AssertTrue("Règlements espèce non comptabilisés sans facture = 0 (100% affectés sur facture)", nonComptaSansFacture == 0);
AssertTrue("Historique janv 2026 sans facture = 23 lignes archivées", dejaComptaSansFacture == 23);

// ------------------------------------------------------------------------------------------------
// 2. VÉRIFICATION DES CONTRAINTES DE LONGUEUR ET TRONCATURES SAGE
// ------------------------------------------------------------------------------------------------
Console.WriteLine("\n--- ÉTAPE 2 : Vérification des limites Sage (MV_Piece <= 13, LibelleEcriture <= 69) ---");

const string sqlLimits = @"
SELECT 
    MAX(LEN(v.MV_Piece)) as MaxPieceLen,
    MAX(LEN(v.LibelleEcriture)) as MaxLibelleLen,
    SUM(CASE WHEN LEN(v.MV_Piece) > 13 THEN 1 ELSE 0 END) as PieceDepassements,
    SUM(CASE WHEN LEN(v.LibelleEcriture) > 69 THEN 1 ELSE 0 END) as LibelleDepassements
FROM vw_ReglementsAComptabiliser v
WHERE v.MV_Type = 0;";

var limits = await conn.QuerySingleAsync(sqlLimits);
int maxPieceLen = (int)limits.MaxPieceLen;
int maxLibelleLen = (int)limits.MaxLibelleLen;
int pieceDepassements = (int)limits.PieceDepassements;
int libelleDepassements = (int)limits.LibelleDepassements;

Console.WriteLine($"  Max longueur MV_Piece réelle : {maxPieceLen} (limite Sage : 13)");
Console.WriteLine($"  Max longueur LibelleEcriture réelle : {maxLibelleLen} (limite Sage : 69)");
Console.WriteLine($"  Dépassements pièce : {pieceDepassements}");
Console.WriteLine($"  Dépassements libellé : {libelleDepassements}");

AssertTrue("MV_Piece <= 13 car. sur l'intégralité des règlements espèce", maxPieceLen <= 13);
AssertTrue("LibelleEcriture <= 69 car. sur l'intégralité des règlements espèce", maxLibelleLen <= 69);
AssertTrue("Zéro troncature destructrice sur MV_Piece", pieceDepassements == 0);
AssertTrue("Zéro troncature destructrice sur LibelleEcriture", libelleDepassements == 0);

// ------------------------------------------------------------------------------------------------
// 3. VÉRIFICATION DU FORMAT SUR ÉCHANTILLON RÉEL AVEC FACTURE
// ------------------------------------------------------------------------------------------------
Console.WriteLine("\n--- ÉTAPE 3 : Vérification du format (MV_Piece = facture, Libelle = 'Règlement facture N°<facture>') ---");

const string sqlSample = @"
SELECT TOP 20
    v.MV_ID,
    v.MV_Numero,
    v.FactureNumero,
    v.MV_Piece,
    v.LibelleEcriture
FROM vw_ReglementsAComptabiliser v
WHERE v.MV_Type = 0 AND v.FactureNumero IS NOT NULL
ORDER BY v.MV_ID DESC;";

var sampleRows = (await conn.QueryAsync(sqlSample)).ToList();
AssertTrue("Échantillon de 20 règlements récents récupéré", sampleRows.Count == 20);

bool allPiecesMatchFacture = true;
bool allLibellesMatchFormat = true;

foreach (var row in sampleRows)
{
    string piece = (string)row.MV_Piece;
    string facture = (string)row.FactureNumero;
    string libelle = (string)row.LibelleEcriture;

    if (piece.Trim() != facture.Trim())
    {
        allPiecesMatchFacture = false;
        Console.WriteLine($"  [MISMATCH] MV_ID {row.MV_ID}: Piece='{piece}' != Facture='{facture}'");
    }

    string expectedLibelle = $"Règlement facture N°{facture.Trim()}";
    if (libelle.Trim() != expectedLibelle)
    {
        allLibellesMatchFormat = false;
        Console.WriteLine($"  [MISMATCH] MV_ID {row.MV_ID}: Libelle='{libelle}' != Expected='{expectedLibelle}'");
    }
}

AssertTrue("Tous les MV_Piece correspondent exactement au n° de facture (sans préfixe RC)", allPiecesMatchFacture);
AssertTrue("Tous les LibelleEcriture sont sous la forme exacte 'Règlement facture N°<num_facture>'", allLibellesMatchFormat);

// ------------------------------------------------------------------------------------------------
// 4. VÉRIFICATION DU GARDE-FOU DÉFENSIF (SANS FACTURE)
// ------------------------------------------------------------------------------------------------
Console.WriteLine("\n--- ÉTAPE 4 : Vérification du garde-fou défensif (sans facture affectée) ---");

const string sqlDefensive = @"
SELECT 
    v.MV_ID,
    v.MV_Numero,
    v.FactureNumero,
    v.MV_Piece,
    v.LibelleEcriture
FROM vw_ReglementsAComptabiliser v
WHERE v.MV_ID IN (2934, 2935, 2936, 1622);";

var defensiveRows = (await conn.QueryAsync(sqlDefensive)).ToList();
AssertTrue("Lignes de test garde-fou historique récupérées (4 lignes)", defensiveRows.Count == 4);

bool allDefensivePiecesOk = true;
bool allDefensiveLibellesOk = true;

foreach (var row in defensiveRows)
{
    string piece = (string)row.MV_Piece;
    string mvNumero = (string)row.MV_Numero;
    string libelle = (string)row.LibelleEcriture;
    string expectedNum = mvNumero.Replace("RC", "").Trim();

    if (piece.Trim() != expectedNum)
    {
        allDefensivePiecesOk = false;
        Console.WriteLine($"  [MISMATCH GARDE-FOU] MV_ID {row.MV_ID}: Piece='{piece}' != Expected='{expectedNum}'");
    }

    string expectedLibelle = $"Règlement facture N°{expectedNum}";
    if (libelle.Trim() != expectedLibelle)
    {
        allDefensiveLibellesOk = false;
        Console.WriteLine($"  [MISMATCH GARDE-FOU] MV_ID {row.MV_ID}: Libelle='{libelle}' != Expected='{expectedLibelle}'");
    }
}

AssertTrue("Garde-fou pièce : repli sur n° de règlement sans RC si facture NULL", allDefensivePiecesOk);
AssertTrue("Garde-fou libellé : repli défensif 'Règlement facture N°<num_reglement>' si facture NULL", allDefensiveLibellesOk);

// ------------------------------------------------------------------------------------------------
// 5. INTÉGRITÉ DES AUTRES MODES (HORS ESPÈCE, MV_Type = 3)
// ------------------------------------------------------------------------------------------------
Console.WriteLine("\n--- ÉTAPE 5 : Vérification de non-régression sur le hors espèce (MV_Type != 0) ---");

const string sqlVersement = @"
SELECT TOP 5
    v.MV_ID,
    v.MV_Numero,
    v.MV_Type,
    v.MV_Piece,
    v.LibelleEcriture
FROM vw_ReglementsAComptabiliser v
WHERE v.MV_Type = 3 AND v.MV_ID IN (48337, 48335);";

var versementRows = (await conn.QueryAsync(sqlVersement)).ToList();
AssertTrue("Lignes de versement récupérées (2 lignes)", versementRows.Count == 2);
foreach (var row in versementRows)
{
    string libelle = (string)row.LibelleEcriture;
    AssertTrue($"Versement MV_ID {row.MV_ID} a conservé son repli 'Versement' ({libelle})", libelle == "Versement");
}

// ------------------------------------------------------------------------------------------------
// 6. INTÉGRATION C# : ReglementComptaViewRepository
// ------------------------------------------------------------------------------------------------
Console.WriteLine("\n--- ÉTAPE 6 : Test intégration C# via ReglementComptaViewRepository ---");

var dbFactory = new DbConnectionFactory(ConnString);
var repo = new ReglementComptaViewRepository(dbFactory);

// Sélectionner 3 IDs réels d'espèces
var testIds = sampleRows.Take(3).Select(r => (int)r.MV_ID).ToList();
var viewDict = repo.GetByMvIds(testIds);

AssertTrue("ReglementComptaViewRepository.GetByMvIds renvoie les 3 lignes", viewDict.Count == 3);

foreach (var id in testIds)
{
    var row = viewDict[id];
    var sqlRow = sampleRows.First(r => (int)r.MV_ID == id);
    string expectedFacture = ((string)sqlRow.FactureNumero).Trim();

    AssertTrue($"ID {id} : MV_Piece C# ({row.MV_Piece}) == Facture ({expectedFacture})", row.MV_Piece?.Trim() == expectedFacture);
    AssertTrue($"ID {id} : LibelleEcriture C# conforme ({row.LibelleEcriture})", row.LibelleEcriture?.Trim() == $"Règlement facture N°{expectedFacture}");
}

// ------------------------------------------------------------------------------------------------
// BILAN DU HARNAIS
// ------------------------------------------------------------------------------------------------
Console.WriteLine("\n================================================================================");
Console.WriteLine($"   RÉSULTAT HARNAIS TASK-081 : {passedTests} / {totalTests} TESTS PASSÉS AVEC SUCCÈS");
Console.WriteLine("================================================================================");

if (passedTests == totalTests)
{
    Console.WriteLine(">>> VALIDATION 100% RÉUSSIE SUR BASE SQL SERVER RÉELLE <<<");
    Environment.Exit(0);
}
else
{
    Console.WriteLine(">>> ÉCHEC DE CERTAINS TESTS <<<");
    Environment.Exit(1);
}
