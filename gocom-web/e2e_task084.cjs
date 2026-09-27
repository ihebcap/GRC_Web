/**
 * Harnais de test E2E Playwright pour TASK-084
 * 
 * Vérifie l'annulation des requêtes HTTP en vol devenues obsolètes
 * lors d'enchaînements de clics/filtres rapides sur la grille des règlements.
 * 
 * Exécution :
 *   cd gocom-web
 *   node e2e_task084.cjs
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const WWWROOT = path.resolve(__dirname, '../deploy/wwwroot');
const PORT = 3456;
const SIMULATED_LATENCY_MS = 600;

if (!fs.existsSync(WWWROOT)) {
  console.error(`Dossier build introuvable: ${WWWROOT}`);
  console.error('Veuillez d\'abord compiler avec : npm run build');
  process.exit(1);
}

// Suivi des requêtes sur le serveur de simulation
const serverRequests = [];
let activeInFlightRequests = 0;
let maxConcurrentInFlight = 0;

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsedUrl.pathname;

  // Servir les fichiers statiques de l'application buildée
  if (pathname === '/' || pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(WWWROOT, 'index.html')));
    return;
  }

  if (pathname.startsWith('/assets/')) {
    const filePath = path.join(WWWROOT, pathname);
    if (fs.existsSync(filePath)) {
      const ext = path.extname(filePath);
      const mime = ext === '.js' ? 'application/javascript' : ext === '.css' ? 'text/css' : 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime });
      res.end(fs.readFileSync(filePath));
      return;
    }
  }

  if (pathname === '/config.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    res.end('window.GOCOM_CONFIG = { API_BASE: "/api" };');
    return;
  }

  // API Références
  if (pathname === '/api/reference/caisses' || 
      pathname === '/api/reference/modes' || 
      pathname === '/api/reference/banques') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([]));
    return;
  }

  if (pathname === '/api/reglements/distincts') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({}));
    return;
  }

  // API Règlements avec simulation de latence réseau
  if (pathname === '/api/reglements') {
    const reqIndex = serverRequests.length + 1;
    const info = {
      index: reqIndex,
      url: req.url,
      aborted: false,
      completed: false,
      startTime: Date.now(),
    };
    serverRequests.push(info);

    activeInFlightRequests++;
    if (activeInFlightRequests > maxConcurrentInFlight) {
      maxConcurrentInFlight = activeInFlightRequests;
    }

    // Détection d'interruption par le client (socket fermée prématurément par AbortController)
    req.on('close', () => {
      if (!res.writableEnded) {
        info.aborted = true;
        activeInFlightRequests = Math.max(0, activeInFlightRequests - 1);
      }
    });

    // Latence artificielle simulant la requête SQL serveur
    setTimeout(() => {
      if (!res.writableEnded) {
        activeInFlightRequests = Math.max(0, activeInFlightRequests - 1);
        info.completed = true;
        info.endTime = Date.now();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          items: [
            {
              no: reqIndex,
              reference: `REF-${reqIndex}`,
              date: new Date().toISOString(),
              dateEcheance: new Date().toISOString(),
              montant: 100 * reqIndex,
              montantDeviseSociete: 100 * reqIndex,
              etat: 1,
              clientIntitule: `Client ${reqIndex}`,
              caisseNo: 1,
              banqueNo: null,
              banqueTier: null,
              ribClient: null,
              modeReglementNo: 1,
              isPointe: false,
              datePointage: null,
              isComptabilise: 0,
              isRemis: 0,
              dateRemis: null,
              isImpaye: 0,
              impayeDate: null,
              pieceNumero: `PC-${reqIndex}`,
              extraitNum: null,
              numero: `${reqIndex}`,
              libelle: `Reglement ${reqIndex}`,
              soldeDeviseSociete: 0,
              info1: null,
              info2: null,
              info3: null,
              info4: null
            }
          ],
          totalItems: 1
        }));
      }
    }, SIMULATED_LATENCY_MS);
    return;
  }

  res.writeHead(404);
  res.end('Not found: ' + pathname);
});

async function run() {
  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log(`[Harnais TASK-084] Serveur de simulation actif sur http://localhost:${PORT}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  const networkRequests = [];
  page.on('request', (req) => {
    if (req.url().includes('/api/reglements') && !req.url().includes('distincts')) {
      networkRequests.push({
        id: networkRequests.length + 1,
        url: req.url(),
        status: 'pending',
        failedReason: null
      });
    }
  });

  page.on('requestfailed', (req) => {
    if (req.url().includes('/api/reglements') && !req.url().includes('distincts')) {
      const item = networkRequests.find(r => r.url === req.url() && r.status === 'pending');
      if (item) {
        item.status = 'canceled';
        item.failedReason = req.failure()?.errorText;
      }
    }
  });

  page.on('requestfinished', (req) => {
    if (req.url().includes('/api/reglements') && !req.url().includes('distincts')) {
      const item = networkRequests.find(r => r.url === req.url() && r.status === 'pending');
      if (item) {
        item.status = 'finished';
      }
    }
  });

  // Injection de la session utilisateur dans le stockage de session
  await page.addInitScript(() => {
    sessionStorage.setItem('gocom_user', JSON.stringify({
      no: 1,
      login: 'admin',
      nom: 'Admin',
      prenom: 'User',
      societeId: 1,
      societeName: 'SOCIETE TEST SA',
      caisses: [1],
      token: 'jwt-token-test-084'
    }));
  });

  console.log('[Harnais TASK-084] Chargement de l\'application dans Chromium...');
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  console.log('[Harnais TASK-084] Application chargée avec succès.');

  // Réinitialisation des compteurs avant le scénario de test
  networkRequests.length = 0;
  serverRequests.length = 0;
  consoleErrors.length = 0;
  maxConcurrentInFlight = 0;

  console.log('\n--- SCÉNARIO : 4 requêtes fetch en rafale à 60ms d\'intervalle (latence serveur 600ms) ---');
  const refreshBtn = page.locator('button:has-text("Rafraîchir")');
  await refreshBtn.waitFor({ state: 'visible' });

  for (let i = 1; i <= 4; i++) {
    console.log(`Déclenchement requête #${i}...`);
    await refreshBtn.click({ force: true });
    await new Promise(r => setTimeout(r, 60));
  }

  console.log('Attente de la réponse de la dernière requête...');
  await page.waitForTimeout(1500);

  console.log('\n--- RÉSULTATS DU HARNAIS ---');
  console.log(`Nombre total de requêtes émises par le navigateur : ${networkRequests.length}`);
  networkRequests.forEach(r => {
    console.log(`- Requête #${r.id} : statut = ${r.status} (${r.failedReason || 'HTTP 200 OK'})`);
  });

  const canceledCount = networkRequests.filter(r => r.status === 'canceled').length;
  const finishedCount = networkRequests.filter(r => r.status === 'finished').length;

  console.log(`\nBilan client :`);
  console.log(`- Requêtes annulées (AbortController) : ${canceledCount}`);
  console.log(`- Requêtes terminées avec succès : ${finishedCount}`);

  console.log(`\nBilan serveur simulé :`);
  console.log(`- Requêtes reçues : ${serverRequests.length}`);
  serverRequests.forEach(s => {
    console.log(`- Requête #${s.index} : complétée=${s.completed}, interrompue_par_client=${s.aborted}`);
  });

  console.log(`\nConsole du navigateur :`);
  console.log(`- Erreurs console : ${consoleErrors.length}`);
  if (consoleErrors.length > 0) {
    console.error('Erreurs détectées :', consoleErrors);
  } else {
    console.log('0 erreur console parasite (CanceledError proprement ignorée)');
  }

  // Vérification des assertions
  let pass = true;
  if (networkRequests.length !== 4) {
    console.error(`ÉCHEC : 4 requêtes attendues, ${networkRequests.length} reçues`);
    pass = false;
  }
  if (canceledCount !== 3) {
    console.error(`ÉCHEC : 3 requêtes annulées attendues, ${canceledCount} obtenues`);
    pass = false;
  }
  if (finishedCount !== 1) {
    console.error(`ÉCHEC : 1 seule requête terminée attendue, ${finishedCount} obtenues`);
    pass = false;
  }
  if (consoleErrors.length > 0) {
    console.error('ÉCHEC : Des console.error ont été émis');
    pass = false;
  }

  await browser.close();
  await new Promise(resolve => server.close(resolve));

  if (pass) {
    console.log('\n======================================================');
    console.log('>>> HARNAIS TASK-084 : SUCCÈS 100% (TESTS CONFORMES) <<<');
    console.log('======================================================\n');
    process.exit(0);
  } else {
    console.error('\n>>> HARNAIS TASK-084 : ÉCHEC DES ASSERTIONS <<<\n');
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Erreur inattendue dans le harnais:', err);
  server.close();
  process.exit(1);
});
