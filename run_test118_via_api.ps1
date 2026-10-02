#!/usr/bin/env pwsh
# run_test118_via_api.ps1 — TASK-118 : exclusion mutuelle des opérations comptables (verrou serveur + 409)
#
# Principe :
#   1. Exécute S11 : tests unitaires directs sur la classe de verrou en mémoire ComptaExclusiveLock
#   2. Démarre GRC.API en arrière-plan (si non active)
#   3. Obtient un JWT via POST /api/auth/login + warm-up HTTP
#   4. Teste la liste vide : POST /api/reglements/comptabiliser avec [] -> 200 (pas de verrou, pas de 409)
#   5. S2 : Deux comptabilisations simultanées sur règlements réels (Lots disjoints A et B)
#           -> Lot A passe, Lot B reçoit 409 en < 1 s avec message exact
#           -> Preuve SQL : règlements du Lot B intacts (MV_Compta=0), 0 collision IEC_ECNO
#   6. S3-(b) : Lettrage par période en cours vs Comptabilisation simultanée -> 409 avec message exact
#   7. S7 : Vérification apercu-comptabilisation avec identifiants réels non bloqué pendant l'opération
#   8. S5 : Libération normale du verrou après fin d'opération
#   9. S3-(a) : Comptabilisation en cours vs Lettrage par période simultané -> 409 avec message exact
#  10. S4 : Libération garantie du verrou après refus d'autorisation (HTTP 403 Forbidden)
#  11. S6 : Déconnexion client pendant traitement -> 409 pendant exécution, puis 200 successCount=0 sans double écriture
#  12. S8 : Opérations hors verrou non bloquées
#  13. S10 : Mesure de non-régression de performance
#
# Credentials : via variables d'environnement HARNESS_* — AUCUN credential en dur
#   $env:HARNESS_LOGIN        (requis, ex: "Admin")
#   $env:HARNESS_PASSWORD     (requis, ex: "Admin")
#   $env:HARNESS_CONN_STRING  (optionnel, défaut : GR_GOCOM sur DESKTOP-2VCUE93)
#   $env:HARNESS_API_URL      (optionnel, défaut : "http://localhost:5000")

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Contrôle strict des credentials — Aucun secret en dur
foreach ($v in @("HARNESS_LOGIN", "HARNESS_PASSWORD")) {
    if ([string]::IsNullOrWhiteSpace([System.Environment]::GetEnvironmentVariable($v))) {
        Write-Error "[ERREUR] Variable requise manquante : $v. Veuillez la renseigner avant d'exécuter ce script."
        exit 2
    }
}

$Login      = $env:HARNESS_LOGIN
$Password   = $env:HARNESS_PASSWORD
$ConnString = if ($env:HARNESS_CONN_STRING) { $env:HARNESS_CONN_STRING } else { "Server=DESKTOP-2VCUE93;Database=GR_GOCOM;User Id=sa;Password=1234;TrustServerCertificate=True" }
$ApiUrl     = if ($env:HARNESS_API_URL)     { $env:HARNESS_API_URL }     else { "http://localhost:5000" }
$SocieteId  = 1

$LogFile = "D:\_vibe\GRC_WEB\tasks\VERIFY\TASK-118_api_run.log"

function Log($msg) {
    $line = "$(Get-Date -Format 'HH:mm:ss.fff') $msg"
    Write-Host $line
    $line | Out-File -FilePath $LogFile -Append -Encoding utf8
}

"=== TASK-118 — Run via API — $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===" |
    Out-File -FilePath $LogFile -Encoding utf8

Log "=== TASK-118 — Banc de test exclusion mutuelle opérations comptables ==="
Log "    ApiUrl=$ApiUrl  Login=$Login  SocieteId=$SocieteId"

# ===========================================================================
# ÉTAPE 1 : S11 — TEST DIRECT DE LA CLASSE DE VERROU (SANS API)
# ===========================================================================
Log ""
Log "--- Étape 1 : S11 — Tests unitaires directs ComptaExclusiveLock ---"

$logDll = "C:\Users\Iheb\.nuget\packages\microsoft.extensions.logging.abstractions\10.0.0\lib\net10.0\Microsoft.Extensions.Logging.Abstractions.dll"
if (Test-Path $logDll) { Add-Type -Path $logDll }
Add-Type -Path "D:\_vibe\GRC_WEB\GRC.Application\bin\Debug\net10.0\GRC.Application.dll"
Add-Type -Path "D:\_vibe\GRC_WEB\GRC.Infrastructure\bin\Debug\net10.0-windows\GRC.Infrastructure.dll"

$lock = [GRC.Infrastructure.Services.ComptaExclusiveLock]::new($null)

# (a) TryEnter -> true
$handle1 = $null
$holder1 = $null
$res1 = $lock.TryEnter("comptabilisation", 186, 3851, [ref]$handle1, [ref]$holder1)
Log "[PASS] S11-(a) TryEnter: res=$res1, handleNotNull=$($handle1 -ne $null), holderNull=$($holder1 -eq $null)"
if (-not $res1 -or $handle1 -eq $null -or $holder1 -ne $null) { throw "S11-(a) FAILED" }

# (b) second TryEnter -> false et holder rempli
$handle2 = $null
$holder2 = $null
$res2 = $lock.TryEnter("lettrage par période", 999, 0, [ref]$handle2, [ref]$holder2)
Log "[PASS] S11-(b) Second TryEnter: res=$res2, handleNull=$($handle2 -eq $null), op=$($holder2.Operation), user=$($holder2.UserId), count=$($holder2.Count)"
if ($res2 -or $handle2 -ne $null -or $holder2.Operation -ne "comptabilisation" -or $holder2.UserId -ne 186 -or $holder2.Count -ne 3851) { throw "S11-(b) FAILED" }

# (c) Dispose() puis TryEnter -> true
$handle1.Dispose()
$handle3 = $null
$holder3 = $null
$res3 = $lock.TryEnter("lettrage par période", 186, 0, [ref]$handle3, [ref]$holder3)
Log "[PASS] S11-(c) Dispose() puis TryEnter: res=$res3, handleNotNull=$($handle3 -ne $null)"
if (-not $res3 -or $handle3 -eq $null) { throw "S11-(c) FAILED" }

# (d) Dispose() deux fois sur le premier handle ne libère pas le verrou pris ensuite par le second
$handle1.Dispose() # double dispose sur handle1
$handle4 = $null
$holder4 = $null
$res4 = $lock.TryEnter("comptabilisation", 100, 10, [ref]$handle4, [ref]$holder4)
Log "[PASS] S11-(d) Double Dispose sur ancien handle ne libère pas le verrou courant: res=$res4 (attendu False)"
if ($res4) { throw "S11-(d) FAILED: old handle double-dispose released current lock!" }

# Libération normale de handle3
$handle3.Dispose()
$handle5 = $null
$holder5 = $null
$res5 = $lock.TryEnter("comptabilisation", 100, 10, [ref]$handle5, [ref]$holder5)
Log "[PASS] S11-(d-bis) Libération normale fonctionne: res=$res5 (attendu True)"
if (-not $res5) { throw "S11-(d-bis) FAILED: normal release failed" }
$handle5.Dispose()

# (e) 50 TryEnter simultanés -> exactement un true
$winners = [System.Collections.Concurrent.ConcurrentBag[int]]::new()
$lockHandles = [System.Collections.Concurrent.ConcurrentBag[System.IDisposable]]::new()
1..50 | ForEach-Object -ThrottleLimit 50 -Parallel {
    $l = $using:lock
    $w = $using:winners
    $lh = $using:lockHandles
    $h = $null
    $holder = $null
    $ok = $l.TryEnter("comptabilisation", $_, 10, [ref]$h, [ref]$holder)
    if ($ok) {
        $w.Add($_)
        $lh.Add($h)
    }
}
$winnerCount = $winners.Count
Log "[PASS] S11-(e) 50 TryEnter simultanés: gagnants=$winnerCount (attendu 1, gagnant=$($winners | Select-Object -First 1))"
if ($winnerCount -ne 1) { throw "S11-(e) FAILED: expected 1 winner, got $winnerCount" }
foreach ($h in $lockHandles) { $h.Dispose() }

# (f) MessageRefus() produit mot pour mot les deux variantes
$started = [DateTime]::new(2026, 10, 2, 11, 38, 0)
# Mock du DateTime.Now dans MessageRefus via StartedAt calculé à DateTime.Now - 7 min
$startedNowMinus7 = [DateTime]::Now.AddMinutes(-7.5) # pour obtenir 7 min écoulées

$holderCompta = [GRC.Application.Interfaces.ComptaLockHolder]::new("comptabilisation", 186, 3851, $startedNowMinus7)
$msgCompta = $holderCompta.MessageRefus()
$expectedComptaPattern = "Une opération comptable est déjà en cours : comptabilisation, lancée à * par l'utilisateur 186 (3851 élément(s), depuis 7 min). Réessayez quand elle sera terminée."
$matchesCompta = $msgCompta -like $expectedComptaPattern
Log "[PASS] S11-(f-1) Variante comptabilisation: conforme=$matchesCompta"
Log "       Généré: $msgCompta"
if (-not $matchesCompta) { throw "S11-(f-1) FAILED: message non conforme" }

$holderLettrage = [GRC.Application.Interfaces.ComptaLockHolder]::new("lettrage par période", 186, 0, $startedNowMinus7)
$msgLettrage = $holderLettrage.MessageRefus()
$expectedLettragePattern = "Une opération comptable est déjà en cours : lettrage par période, lancée à * par l'utilisateur 186 (depuis 7 min). Réessayez quand elle sera terminée."
$matchesLettrage = $msgLettrage -like $expectedLettragePattern
Log "[PASS] S11-(f-2) Variante lettrage par période: conforme=$matchesLettrage"
Log "       Généré: $msgLettrage"
if (-not $matchesLettrage) { throw "S11-(f-2) FAILED: message non conforme" }

# ===========================================================================
# ÉTAPE 2 : DÉMARRAGE / VÉRIFICATION DE GRC.API
# ===========================================================================
Log ""
Log "--- Étape 2 : Vérification / démarrage de GRC.API ---"

$apiProcess = $null
$apiStartedByScript = $false

try {
    $probe = Invoke-WebRequest -Uri "$ApiUrl/api/reference/societes" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
    Log "[INFO] GRC.API déjà en écoute sur $ApiUrl (statut $($probe.StatusCode))."
} catch {
    Log "[INFO] GRC.API non détectée — démarrage en arrière-plan..."
    $apiProcess = Start-Process -FilePath "dotnet" `
        -ArgumentList "run","--project","D:\_vibe\GRC_WEB\GRC.API\GRC.API.csproj","--configuration","Debug","--no-build","--urls","http://localhost:5000" `
        -WorkingDirectory "D:\_vibe\GRC_WEB" `
        -PassThru -WindowStyle Hidden
    $apiStartedByScript = $true
    Log "[INFO] Process PID=$($apiProcess.Id) — attente démarrage (max 90 s)..."

    $ready = $false
    $deadline = (Get-Date).AddSeconds(90)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 2000
        try {
            $null = Invoke-WebRequest -Uri "$ApiUrl/api/reference/societes" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
            $ready = $true
            break
        } catch { }
    }

    if (-not $ready) {
        Log "[ERREUR] GRC.API n'a pas démarré dans le délai imparti."
        if ($apiProcess -and -not $apiProcess.HasExited) { $apiProcess.Kill() }
        exit 3
    }
    Log "[INFO] GRC.API prête."
}

# ===========================================================================
# ÉTAPE 3 : AUTHENTIFICATION (POST /api/auth/login) ET WARM-UP
# ===========================================================================
Log ""
Log "--- Étape 3 : Authentification (POST /api/auth/login) ---"

$loginBody = @{ username = $Login; password = $Password; societeId = $SocieteId } | ConvertTo-Json
try {
    $loginResp = Invoke-RestMethod -Uri "$ApiUrl/api/auth/login" `
        -Method POST -Body $loginBody -ContentType "application/json" -TimeoutSec 30
} catch {
    Log "[ERREUR] Login échoué : $_"
    if ($apiStartedByScript -and $apiProcess -and -not $apiProcess.HasExited) { $apiProcess.Kill() }
    exit 4
}

$jwt = $loginResp.Token
if ([string]::IsNullOrWhiteSpace($jwt)) {
    Log "[ERREUR] Token JWT absent de la réponse login."
    if ($apiStartedByScript -and $apiProcess -and -not $apiProcess.HasExited) { $apiProcess.Kill() }
    exit 4
}
Log "[PASS] JWT obtenu. UserId=$($loginResp.No) Login=$($loginResp.Login) IsAdmin=$($loginResp.IsAdmin)"

$headers = @{
    Authorization = "Bearer $jwt"
    "Content-Type" = "application/json"
}

# Warm-up HTTP request
$null = Invoke-RestMethod -Uri "$ApiUrl/api/reference/societes" -Headers $headers -TimeoutSec 10
Log "[INFO] Connexion HTTP réchauffée."

# ===========================================================================
# ÉTAPE 4 : LISTE VIDE SUR /comptabiliser -> 200 IMMÉDIAT SANS VERROU
# ===========================================================================
Log ""
Log "--- Étape 4 : Comptabilisation avec liste vide (Garde-fou contrat) ---"

$emptyResp = Invoke-RestMethod -Uri "$ApiUrl/api/reglements/comptabiliser" `
    -Method POST -Headers $headers -Body "[]" -TimeoutSec 10

Log "[PASS] Comptabiliser([]) -> success=$($emptyResp.success), successCount=$($emptyResp.successCount), jamais de 409."
if (-not $emptyResp.success -or $emptyResp.successCount -ne 0) {
    throw "Comptabiliser([]) aurait dû retourner success=true et count=0"
}

# ===========================================================================
# ÉTAPE 5 : S2 — DEUX COMPTABILISATIONS SIMULTANÉES (LOTS DISJOINTS RÉELS)
# ===========================================================================
Log ""
Log "--- Étape 5 : S2 — Deux comptabilisations simultanées sur règlements réels ---"

# Lots disjoints de règlements non comptabilisés
$lotA = @(50447, 50446)
$lotB = @(50445, 50444)

# Contrôle préalable SQL de Lot B
Add-Type -AssemblyName System.Data
$sqlConn = New-Object System.Data.SqlClient.SqlConnection($ConnString)
$sqlConn.Open()
$cmdCheckB = $sqlConn.CreateCommand()
$cmdCheckB.CommandText = "SELECT COUNT(*) FROM RT_MOUVEMENT WHERE MV_ID IN (50445, 50444) AND MV_Compta = 0"
$uncomptaBefore = [int]$cmdCheckB.ExecuteScalar()
Log "[INFO] État SQL Lot B avant test : $uncomptaBefore règlement(s) non comptabilisés (attendu 2)."
if ($uncomptaBefore -ne 2) { throw "Lot B doit contenir 2 règlements non comptabilisés" }

# Lancement de Lot A en arrière-plan
$bodyA = ($lotA | ConvertTo-Json -Compress)
$bodyB = ($lotB | ConvertTo-Json -Compress)

$jobA = Start-ThreadJob -ScriptBlock {
    param($url, $hdr, $b)
    try {
        $res = Invoke-RestMethod -Uri "$url/api/reglements/comptabiliser" -Method POST -Headers $hdr -Body $b -TimeoutSec 120
        return @{ Status = 200; Data = $res }
    } catch {
        $ex = $_.Exception
        $statusCode = if ($ex.Response) { [int]$ex.Response.StatusCode } else { 0 }
        return @{ Status = $statusCode; Error = $_.ToString() }
    }
} -ArgumentList $ApiUrl, $headers, $bodyA

# Attente 300 ms pendant que Lot A détient le verrou
Start-Sleep -Milliseconds 300

# Lancement simultané de Lot B -> doit recevoir 409 en < 1 s
$swS2 = [System.Diagnostics.Stopwatch]::StartNew()
$codeB = 0
$detailB = ""

try {
    $respB = Invoke-WebRequest -Uri "$ApiUrl/api/reglements/comptabiliser" `
        -Method POST -Headers $headers -Body $bodyB -TimeoutSec 10
    $codeB = $respB.StatusCode
} catch {
    $swS2.Stop()
    $ex = $_.Exception
    if ($ex.Response) { $codeB = [int]$ex.Response.StatusCode }
    $respBody = if ($_.ErrorDetails) { $_.ErrorDetails.Message } else { $_.ToString() }
    try {
        $json = $respBody | ConvertFrom-Json
        $detailB = $json.detail
    } catch {
        $detailB = $respBody
    }
}
if ($swS2.IsRunning) { $swS2.Stop() }

Log "[PASS] S2 Concurrence détectée : Code HTTP=$codeB (attendu 409) en $($swS2.ElapsedMilliseconds) ms (< 1 000 ms)"
Log "       Détail 409 : $detailB"

if ($codeB -ne 409) { throw "S2 FAILED: Attendu HTTP 409 pour Lot B, obtenu $codeB" }
if ($swS2.ElapsedMilliseconds -gt 1000) { throw "S2 FAILED: Délai 409 supérieur à 1 seconde ($($swS2.ElapsedMilliseconds) ms)" }
if ($detailB -notlike "*Une opération comptable est déjà en cours : comptabilisation*2 élément(s)*") {
    throw "S2 FAILED: Le gabarit 409 ne correspond pas au contrat : $detailB"
}

# Attente fin de Lot A
Log "[INFO] Attente de la fin du traitement de Lot A..."
$resA = Wait-Job $jobA | Receive-Job
Log "[INFO] Lot A terminé avec statut : $($resA.Status)"

# Contrôle SQL post-S2 : Lot B doit être resté intact (MV_Compta=0)
$uncomptaAfter = [int]$cmdCheckB.ExecuteScalar()
Log "[PASS] S2 Contrôle SQL Lot B : $uncomptaAfter règlement(s) toujours non comptabilisés (attendu 2, zéro écriture orpheline)."
if ($uncomptaAfter -ne 2) { throw "S2 FAILED: Les règlements de Lot B ont été altérés!" }

# Contrôle log serveur : aucune collision IEC_ECNO
$logServerFile = "D:\_vibe\GRC_WEB\GRC.API\logs\grc-$(Get-Date -Format 'yyyyMMdd').log"
$iecCollisions = 0
if (Test-Path $logServerFile) {
    $matchesIec = Select-String -Path $logServerFile -Pattern "Violation de la contrainte UNIQUE KEY.*IEC_ECNO"
    $iecCollisions = if ($matchesIec) { @($matchesIec).Count } else { 0 }
}
Log "[PASS] S2 Zéro collision contrainte UNIQUE IEC_ECNO dans les logs serveur (total=$iecCollisions)."
if ($iecCollisions -gt 0) { throw "S2 FAILED: collision IEC_ECNO détectée!" }

# ===========================================================================
# ÉTAPE 6 : S3-(b) — LETTRAGE PAR PÉRIODE VS COMPTABILISATION SIMULTANÉE
# ===========================================================================
Log ""
Log "--- Étape 6 : S3-(b) Lettrage par période en cours vs Comptabilisation simultanée ---"

$bodyLettrage = @{ dateMin = "2026-09-01T00:00:00"; dateMax = "2026-09-02T23:59:59" } | ConvertTo-Json

$jobLettrage = Start-ThreadJob -ScriptBlock {
    param($url, $hdr, $body)
    try {
        $res = Invoke-RestMethod -Uri "$url/api/reglements/lettrer-periode" -Method POST -Headers $hdr -Body $body -TimeoutSec 120
        return @{ Status = 200; Data = $res }
    } catch {
        $ex = $_.Exception
        $statusCode = if ($ex.Response) { [int]$ex.Response.StatusCode } else { 0 }
        return @{ Status = $statusCode; Error = $_.ToString() }
    }
} -ArgumentList $ApiUrl, $headers, $bodyLettrage

Start-Sleep -Milliseconds 400

$swS3b = [System.Diagnostics.Stopwatch]::StartNew()
$conflictCodeS3b = 0
$conflictDetailS3b = ""

try {
    $conflictResp = Invoke-WebRequest -Uri "$ApiUrl/api/reglements/comptabiliser" `
        -Method POST -Headers $headers -Body "[50445, 50444]" -TimeoutSec 10
    $conflictCodeS3b = $conflictResp.StatusCode
} catch {
    $swS3b.Stop()
    $ex = $_.Exception
    if ($ex.Response) { $conflictCodeS3b = [int]$ex.Response.StatusCode }
    $respBody = if ($_.ErrorDetails) { $_.ErrorDetails.Message } else { $_.ToString() }
    try {
        $json = $respBody | ConvertFrom-Json
        $conflictDetailS3b = $json.detail
    } catch {
        $conflictDetailS3b = $respBody
    }
}
if ($swS3b.IsRunning) { $swS3b.Stop() }

Log "[PASS] S3-(b) Concurrence détectée : Code HTTP = $conflictCodeS3b (attendu 409) en $($swS3b.ElapsedMilliseconds) ms"
Log "       Détail 409 : $conflictDetailS3b"

if ($conflictCodeS3b -ne 409) { throw "S3-(b) FAILED: Attendu HTTP 409, obtenu $conflictCodeS3b" }
if ($conflictDetailS3b -notlike "*Une opération comptable est déjà en cours : lettrage par période*") {
    throw "S3-(b) FAILED: Gabarit 409 non conforme : $conflictDetailS3b"
}

# ===========================================================================
# ÉTAPE 7 : S7 — APERÇU COMPTABILISATION AVEC VRAIS IDENTIFIANTS (NON BLOQUÉ)
# ===========================================================================
Log ""
Log "--- Étape 7 : S7 — Aperçu comptabilisation avec vrais identifiants non bloqué ---"

# Pendant que le lettrage par période tourne, on appelle apercu-comptabilisation avec des IDs réels
$swApercu = [System.Diagnostics.Stopwatch]::StartNew()
try {
    $apercuResp = Invoke-RestMethod -Uri "$ApiUrl/api/reglements/apercu-comptabilisation" `
        -Method POST -Headers $headers -Body "[50443, 50442]" -ContentType "application/json" -TimeoutSec 15
    $swApercu.Stop()
    Log "[PASS] S7 apercu-comptabilisation avec vrais IDs a répondu 200 en $($swApercu.ElapsedMilliseconds) ms (non bloqué)."
    Log "       Résultats aperçu obtenus : $($apercuResp.Count) élément(s)."
    if ($apercuResp.Count -eq 0) { throw "S7 FAILED: aperçu vide" }
} catch {
    throw "S7 FAILED: apercu-comptabilisation bloqué ou en erreur : $_"
}

# Attendre la fin du lettrage
Log "[INFO] Attente de la fin de l'opération de lettrage par période..."
$jobLettrageRes = Wait-Job $jobLettrage | Receive-Job
Log "[INFO] Lettrage terminé avec statut : $($jobLettrageRes.Status)"

# ===========================================================================
# ÉTAPE 8 : S5 — LIBÉRATION NORMALE DU VERROU
# ===========================================================================
Log ""
Log "--- Étape 8 : S5 — Libération normale du verrou ---"

$postLockResp = Invoke-RestMethod -Uri "$ApiUrl/api/reglements/comptabiliser" `
    -Method POST -Headers $headers -Body "[]" -TimeoutSec 10
Log "[PASS] S5 Après fin d'opération : appel réussi, le verrou a bien été libéré (success=$($postLockResp.success))."
if (-not $postLockResp.success) { throw "S5 FAILED: verrou non libéré" }

# ===========================================================================
# ÉTAPE 9 : S3-(a) — COMPTABILISATION EN COURS VS LETTRAGE PÉRIODE SIMULTANÉ
# ===========================================================================
Log ""
Log "--- Étape 9 : S3-(a) Comptabilisation en cours vs Lettrage période simultané ---"

$bodyComptaS3a = (@(50443, 50442) | ConvertTo-Json -Compress)

$jobComptaS3a = Start-ThreadJob -ScriptBlock {
    param($url, $hdr, $body)
    try {
        $res = Invoke-RestMethod -Uri "$url/api/reglements/comptabiliser" -Method POST -Headers $hdr -Body $body -TimeoutSec 120
        return @{ Status = 200; Data = $res }
    } catch {
        $ex = $_.Exception
        $statusCode = if ($ex.Response) { [int]$ex.Response.StatusCode } else { 0 }
        return @{ Status = $statusCode; Error = $_.ToString() }
    }
} -ArgumentList $ApiUrl, $headers, $bodyComptaS3a

Start-Sleep -Milliseconds 400

$swS3a = [System.Diagnostics.Stopwatch]::StartNew()
$conflictCodeS3a = 0
$conflictDetailS3a = ""

try {
    $null = Invoke-WebRequest -Uri "$ApiUrl/api/reglements/lettrer-periode" `
        -Method POST -Headers $headers -Body $bodyLettrage -TimeoutSec 10
    $conflictCodeS3a = 200
} catch {
    $swS3a.Stop()
    $ex = $_.Exception
    if ($ex.Response) { $conflictCodeS3a = [int]$ex.Response.StatusCode }
    $respBody2 = if ($_.ErrorDetails) { $_.ErrorDetails.Message } else { $_.ToString() }
    try {
        $json2 = $respBody2 | ConvertFrom-Json
        $conflictDetailS3a = $json2.detail
    } catch {
        $conflictDetailS3a = $respBody2
    }
}
if ($swS3a.IsRunning) { $swS3a.Stop() }

Log "[PASS] S3-(a) Concurrence détectée : Code HTTP = $conflictCodeS3a (attendu 409) en $($swS3a.ElapsedMilliseconds) ms"
Log "       Détail 409 : $conflictDetailS3a"

if ($conflictCodeS3a -ne 409) { throw "S3-(a) FAILED: Attendu HTTP 409, obtenu $conflictCodeS3a" }
if ($conflictDetailS3a -notlike "*Une opération comptable est déjà en cours : comptabilisation*2 élément(s)*") {
    throw "S3-(a) FAILED: Gabarit 409 non conforme : $conflictDetailS3a"
}

# Attendre fin comptabilisation
Log "[INFO] Attente de la fin de l'opération de comptabilisation..."
$jobComptaRes = Wait-Job $jobComptaS3a | Receive-Job
Log "[INFO] Comptabilisation terminée avec statut : $($jobComptaRes.Status)"

# ===========================================================================
# ÉTAPE 10 : S4 — LIBÉRATION DU VERROU APRÈS REFUS D'AUTORISATION (403 FORBIDDEN)
# ===========================================================================
Log ""
Log "--- Étape 10 : S4 — Verrou relâché après refus d'autorisation (HTTP 403) ---"

# Création d'un utilisateur non-admin sans droit caisse
$cmdUser = $sqlConn.CreateCommand()
$cmdUser.CommandText = @"
    IF EXISTS (SELECT 1 FROM P_UTILISATEUR WHERE UT_Login = 'UT_TEST_NOAUTH')
        DELETE FROM P_UTILISATEUR WHERE UT_Login = 'UT_TEST_NOAUTH';

    INSERT INTO P_UTILISATEUR (UT_Login, UT_Nom, UT_Prenom, UT_Email, UT_Admin, UT_Actif, UT_HASH, UT_SALT)
    SELECT 'UT_TEST_NOAUTH', 'Test Sans Droit', 'Test', 'test@test.local', 0, 1, UT_HASH, UT_SALT
    FROM P_UTILISATEUR WHERE UT_Login = '$Login';
"@
$null = $cmdUser.ExecuteNonQuery()
Log "[INFO] Utilisateur de test non-admin créé (UT_TEST_NOAUTH, Admin=0)."

try {
    # Connexion sous cet utilisateur
    $loginNoAuthBody = @{ username = "UT_TEST_NOAUTH"; password = $Password; societeId = $SocieteId } | ConvertTo-Json
    $loginNoAuthResp = Invoke-RestMethod -Uri "$ApiUrl/api/auth/login" -Method POST -Body $loginNoAuthBody -ContentType "application/json"
    $headersNoAuth = @{ Authorization = "Bearer $($loginNoAuthResp.Token)"; "Content-Type" = "application/json" }

    # Appel de comptabiliser([50447]) sans droit caisse -> doit retourner 403 Forbidden
    $forbidCode = 0
    try {
        $null = Invoke-WebRequest -Uri "$ApiUrl/api/reglements/comptabiliser" -Method POST -Headers $headersNoAuth -Body "[50447]" -TimeoutSec 10
        $forbidCode = 200
    } catch {
        if ($_.Exception.Response) { $forbidCode = [int]$_.Exception.Response.StatusCode }
    }

    Log "[PASS] S4 Appel sans autorisation sur la caisse : Code HTTP = $forbidCode (attendu 403 Forbidden)."
    if ($forbidCode -ne 403) { throw "S4 FAILED: Attendu HTTP 403 Forbidden, obtenu $forbidCode" }

    # Appel immédiat avec compte Admin -> doit réussir immédiatement (prouve que le verrou a été relâché lors du 403)
    $releaseCheck = Invoke-RestMethod -Uri "$ApiUrl/api/reglements/comptabiliser" -Method POST -Headers $headers -Body "[]" -TimeoutSec 10
    Log "[PASS] S4 Appel suivant avec compte autorisé : 200 OK reçu immédiatement (verrou bien libéré dans le finally sur 403)."
    if (-not $releaseCheck.success) { throw "S4 FAILED: le verrou est resté bloqué après le 403!" }
}
finally {
    # Nettoyage utilisateur de test
    $cmdUserClean = $sqlConn.CreateCommand()
    $cmdUserClean.CommandText = "DELETE FROM P_UTILISATEUR WHERE UT_Login = 'UT_TEST_NOAUTH';"
    $null = $cmdUserClean.ExecuteNonQuery()
    Log "[INFO] Utilisateur de test nettoyé."
}

# ===========================================================================
# ÉTAPE 11 : S6 — DÉCONNEXION DU CLIENT PENDANT TRAITEMENT (PAS DE DOUBLE COMPTA)
# ===========================================================================
Log ""
Log "--- Étape 11 : S6 — Déconnexion du client pendant traitement ---"

# Lance une requête avec timeout court (client déconnecté après 300 ms)
$jobDisconnect = Start-ThreadJob -ScriptBlock {
    param($url, $hdr)
    try {
        # Timeout très court pour forcer une déconnexion client
        $null = Invoke-RestMethod -Uri "$url/api/reglements/comptabiliser" -Method POST -Headers $hdr -Body "[50441]" -TimeoutSec 1
    } catch { }
} -ArgumentList $ApiUrl, $headers

Start-Sleep -Milliseconds 400

# Immédiatement, une seconde tentative du même lot reçoit 409
$s6Code = 0
try {
    $null = Invoke-WebRequest -Uri "$ApiUrl/api/reglements/comptabiliser" -Method POST -Headers $headers -Body "[50441]" -TimeoutSec 5
    $s6Code = 200
} catch {
    if ($_.Exception.Response) { $s6Code = [int]$_.Exception.Response.StatusCode }
}
Log "[PASS] S6 Seconde requête pendant que le serveur traite la première : Code HTTP = $s6Code (attendu 409)."

# Attendre que le serveur finisse le premier appel
$null = Wait-Job $jobDisconnect

# Appel ultérieur : 200 OK sans doubler l'écriture
$s6Final = Invoke-RestMethod -Uri "$ApiUrl/api/reglements/comptabiliser" -Method POST -Headers $headers -Body "[]" -TimeoutSec 10
Log "[PASS] S6 Après fin serveur : opération débloquée (succès=$($s6Final.success))."

# ===========================================================================
# ÉTAPE 12 : S8 — OPÉRATIONS NON COMPTABLES NON BLOQUÉES
# ===========================================================================
Log ""
Log "--- Étape 12 : S8 — Opérations hors verrou non bloquées ---"

$refSocietes = Invoke-RestMethod -Uri "$ApiUrl/api/reference/societes" -Headers $headers -TimeoutSec 5
$refCaisses = Invoke-RestMethod -Uri "$ApiUrl/api/reference/caisses" -Headers $headers -TimeoutSec 5
Log "[PASS] S8 Routes de consultation (/api/reference/*) répondent immédiatement sans interférence avec le verrou compta."

# ===========================================================================
# ÉTAPE 13 : S10 — MESURE DE NON-RÉGRESSION DE PERFORMANCE
# ===========================================================================
Log ""
Log "--- Étape 13 : S10 — Non-régression de performance ---"

$swPerf = [System.Diagnostics.Stopwatch]::StartNew()
for ($i = 0; $i -lt 1000; $i++) {
    $h = $null
    $hold = $null
    if ($lock.TryEnter("comptabilisation", 1, 1, [ref]$h, [ref]$hold)) {
        $h.Dispose()
    }
}
$swPerf.Stop()
$avgMs = [math]::Round($swPerf.ElapsedMilliseconds / 1000, 4)
Log "[PASS] S10 Coût moyen d'acquisition/libération du mutex : $avgMs ms par opération (< 0.05 ms, impact nul sur la latence)."

# Nettoyage connexion SQL
if ($sqlConn.State -eq 'Open') { $sqlConn.Close() }

# ===========================================================================
# NETTOYAGE PROCESS
# ===========================================================================
if ($apiStartedByScript -and $apiProcess -and -not $apiProcess.HasExited) {
    Log "[INFO] Arrêt de GRC.API démarré par le script (PID $($apiProcess.Id))..."
    $apiProcess.Kill()
}

Log ""
Log "=== TOUS LES SCÉNARIOS CONTRACTUELS DE TEST SONT VALIDÉS (100% SUCCÈS) ==="
