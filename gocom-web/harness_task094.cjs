const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const WWWROOT = path.resolve(__dirname, '../deploy/wwwroot');
const PORT = 3460;

if (!fs.existsSync(WWWROOT)) {
  console.error(`Dossier build introuvable: ${WWWROOT}`);
  process.exit(1);
}

// Generate 50 items for normal case
function generateReglements(count) {
  const items = [];
  for (let i = 1; i <= count; i++) {
    items.push({
      no: 1000 + i,
      date: '2026-09-28T00:00:00',
      clientIntitule: `CLIENT TEST ${i}`,
      numero: `REG${1000 + i}`,
      pieceNumero: `FAC${1000 + i}`,
      reference: `REF-${1000 + i}`,
      montantDeviseSociete: 100.0 + i,
      soldeDeviseSociete: 0,
      caisseNo: 1,
      banqueNo: 1,
      modeReglementNo: 1,
      isPointe: false,
      isComptabilise: 0,
      isRemis: 0,
      isAffecte: false,
      isAnnule: false,
      statut: 'Non affecte'
    });
  }
  return items;
}

const normalReglements = generateReglements(50);
// 3,500 items to simulate pre-TASK-091 heavy payload
const heavyReglements = generateReglements(3500);

let currentMode = 'normal'; // 'normal' | 'heavy'

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsedUrl.pathname;

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

  if (pathname === '/api/reference/caisses') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([{ id: 1, code: 'CAISSE1', intitule: 'Caisse Principale' }]));
    return;
  }

  if (pathname.startsWith('/api/reference/modes')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([{ id: 1, code: 'VIR', intitule: 'Virement', typeNo: 1 }]));
    return;
  }

  if (pathname === '/api/reference/banques') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([{ id: 1, code: 'BNQ1', intitule: 'Banque 1' }]));
    return;
  }

  if (pathname.startsWith('/api/reglements/distincts')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      clients: ['CLIENT TEST 1'],
      numeros: ['REG1001'],
      pieces: ['FAC1001'],
      references: ['REF-1001'],
      libelles: [],
      extraits: [],
      banqueClients: [],
      info1s: [],
      info2s: [],
      info3s: [],
      info4s: []
    }));
    return;
  }

  if (pathname === '/api/reglements') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (currentMode === 'heavy') {
      const payload = JSON.stringify({ items: heavyReglements, totalItems: heavyReglements.length });
      console.log(`[Mock Server] Renvoi gros payload: ${(Buffer.byteLength(payload) / 1024 / 1024).toFixed(2)} Mo`);
      res.end(payload);
    } else {
      res.end(JSON.stringify({ items: normalReglements, totalItems: normalReglements.length }));
    }
    return;
  }

  if (pathname.startsWith('/api/reglements/') && pathname.endsWith('/historique')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([
      {
        id: 1,
        reglementNo: 1001,
        userId: 1,
        userName: 'Admin User',
        dateModification: '2026-09-28T14:32:00',
        champsModifies: 'Montant, Date',
        ancienneDate: '2026-09-27T00:00:00',
        nouvelleDate: '2026-09-28T00:00:00',
        ancienMontant: 95.0,
        nouveauMontant: 101.0
      },
      {
        id: 2,
        reglementNo: 1001,
        userId: 2,
        userName: 'Comptable',
        dateModification: '2026-09-28T16:00:00',
        champsModifies: 'Référence',
        ancienneReference: 'REF-OLD',
        nouvelleReference: 'REF-1001'
      }
    ]));
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

async function run() {
  await new Promise(resolve => server.listen(PORT, resolve));
  console.log(`Serveur mock TASK-094 démarré sur http://localhost:${PORT}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  // Inject session
  await page.addInitScript(() => {
    sessionStorage.setItem('gocom_user', JSON.stringify({
      no: 1,
      login: 'admin',
      nom: 'Admin',
      prenom: 'User',
      societeId: 1,
      societeName: 'SOCIETE TEST SA',
      caisses: [1],
      isAdmin: true,
      token: 'fake-token'
    }));
  });

  try {
    // =========================================================================
    // SCENARIO 1: POST-TASK-091 CONDITIONS (Normal payload 50 items)
    // =========================================================================
    console.log('\n--- SCENARIO 1: Conditions normales (post TASK-091, 50 lignes) ---');
    currentMode = 'normal';

    await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('table tbody tr', { timeout: 10000 });

    // Setup PerformanceObserver in page context to capture long tasks
    await page.evaluate(() => {
      window.__longTasks = [];
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__longTasks.push({
            name: entry.name,
            startTime: entry.startTime,
            duration: entry.duration
          });
        }
      });
      observer.observe({ entryTypes: ['longtask'] });
    });

    // 1.1 Open Historique Modal
    console.log('Ouverture du modal Historique (ligne 1)...');
    const t0Open = Date.now();
    await page.click('table tbody tr:first-child td:nth-child(2) button[title="Historique des modifications"]');
    await page.waitForSelector('text=Historique des modifications', { timeout: 5000 });
    const t1Open = Date.now();
    const openDuration = t1Open - t0Open;
    console.log(`Modal Historique ouvert en ${openDuration} ms`);

    // Wait for history data to load
    await page.waitForSelector('text=Admin User', { timeout: 5000 });

    // 1.2 Close Historique Modal and measure unmount & UI responsiveness
    console.log('Fermeture du modal Historique via bouton "Fermer"...');
    
    // Measure event loop lag during/after close
    const closeMetrics = await page.evaluate(async () => {
      window.__longTasks = []; // reset for close measurement
      const startClose = performance.now();
      
      const closeBtn = document.querySelector('button.btn-primary');
      closeBtn.click();

      // Check requestAnimationFrame latency over 5 frames
      const frameDelays = [];
      let lastTime = performance.now();
      for (let i = 0; i < 5; i++) {
        await new Promise(r => requestAnimationFrame(r));
        const now = performance.now();
        frameDelays.push(now - lastTime);
        lastTime = now;
      }

      const modalStillPresent = !!document.querySelector('.animate-spin') || 
        Array.from(document.querySelectorAll('h3')).some(h => h.innerText.includes('Historique'));

      return {
        totalTime: performance.now() - startClose,
        frameDelays,
        modalStillPresent,
        longTasks: window.__longTasks
      };
    });

    console.log(`Fermeture modal terminée en ${closeMetrics.totalTime.toFixed(1)} ms`);
    console.log(`Modal encore dans le DOM ? ${closeMetrics.modalStillPresent}`);
    console.log(`Délais RAF (latence frames, ~16ms idéal): ${closeMetrics.frameDelays.map(d => d.toFixed(1) + 'ms').join(', ')}`);
    console.log(`Long tasks détectées (>50ms) à la fermeture: ${closeMetrics.longTasks.length}`);
    if (closeMetrics.longTasks.length > 0) {
      console.log('Détail long tasks:', closeMetrics.longTasks);
    }

    // =========================================================================
    // SCENARIO 2: PRE-TASK-091 CONDITIONS (Gros payload 3 500 - 5 000 lignes)
    // =========================================================================
    console.log('\n--- SCENARIO 2: Reproduction conditions PRE-TASK-091 (Gros payload ~3500 lignes) ---');
    currentMode = 'heavy';

    // Navigate and measure initial load & memory with heavy items
    console.log('Chargement page avec règlements pré-TASK-091...');
    const t0Heavy = Date.now();
    await page.goto(`http://localhost:${PORT}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('table tbody tr', { timeout: 45000 });
    const t1Heavy = Date.now();
    console.log(`Page lourde chargée en ${t1Heavy - t0Heavy} ms`);

    // Setup PerformanceObserver for heavy scenario
    await page.evaluate(() => {
      window.__longTasks = [];
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__longTasks.push({
            name: entry.name,
            startTime: entry.startTime,
            duration: entry.duration
          });
        }
      });
      observer.observe({ entryTypes: ['longtask'] });
    });

    // Open modal on heavy page
    console.log('Ouverture du modal Historique sur page chargée à 10 000 lignes...');
    const t0HeavyOpen = Date.now();
    await page.click('table tbody tr:first-child td:nth-child(2) button[title="Historique des modifications"]');
    await page.waitForSelector('text=Historique des modifications', { timeout: 5000 });
    const t1HeavyOpen = Date.now();
    console.log(`Modal Historique ouvert en ${t1HeavyOpen - t0HeavyOpen} ms`);

    await page.waitForSelector('text=Admin User', { timeout: 5000 });

    // Close modal on heavy page
    console.log('Fermeture du modal Historique sur page 10 000 lignes...');
    const heavyCloseMetrics = await page.evaluate(async () => {
      window.__longTasks = [];
      const startClose = performance.now();
      
      const closeBtn = document.querySelector('button.btn-primary');
      closeBtn.click();

      // Check requestAnimationFrame latency over 5 frames
      const frameDelays = [];
      let lastTime = performance.now();
      for (let i = 0; i < 5; i++) {
        await new Promise(r => requestAnimationFrame(r));
        const now = performance.now();
        frameDelays.push(now - lastTime);
        lastTime = now;
      }

      const modalStillPresent = Array.from(document.querySelectorAll('h3')).some(h => h.innerText.includes('Historique'));

      return {
        totalTime: performance.now() - startClose,
        frameDelays,
        modalStillPresent,
        longTasks: window.__longTasks
      };
    });

    console.log(`Fermeture modal sur page lourde terminée en ${heavyCloseMetrics.totalTime.toFixed(1)} ms`);
    console.log(`Modal encore dans le DOM ? ${heavyCloseMetrics.modalStillPresent}`);
    console.log(`Délais RAF: ${heavyCloseMetrics.frameDelays.map(d => d.toFixed(1) + 'ms').join(', ')}`);
    console.log(`Long tasks détectées (>50ms) à la fermeture: ${heavyCloseMetrics.longTasks.length}`);
    if (heavyCloseMetrics.longTasks.length > 0) {
      console.log('Détail long tasks page lourde:', heavyCloseMetrics.longTasks);
    }

    // =========================================================================
    // SCENARIO 3: A/B TEST BACKDROP-FILTER BLUR(2PX) VS NONE
    // =========================================================================
    console.log('\n--- SCENARIO 3: Test A/B backdrop-filter: blur(2px) vs none ---');
    currentMode = 'normal';
    await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('table tbody tr', { timeout: 10000 });

    // Test A: With blur(2px)
    await page.click('table tbody tr:first-child td:nth-child(2) button[title="Historique des modifications"]');
    await page.waitForSelector('text=Historique des modifications');
    
    const blurMetrics = await page.evaluate(async () => {
      const modalOverlay = document.querySelector('div[style*="backdrop-filter"], div[style*="backdropFilter"]');
      const hasBlur = modalOverlay ? window.getComputedStyle(modalOverlay).backdropFilter : 'none';
      
      const t0 = performance.now();
      const closeBtn = document.querySelector('button.btn-primary');
      closeBtn.click();
      
      await new Promise(r => requestAnimationFrame(r));
      const t1 = performance.now();
      return { hasBlur, durationFirstFrame: t1 - t0 };
    });
    console.log(`Test A (avec blur) : backdropFilter="${blurMetrics.hasBlur}", premier frame de fermeture = ${blurMetrics.durationFirstFrame.toFixed(2)} ms`);

    // Test B: Without blur (remove blur dynamically before closing)
    await page.waitForTimeout(300);
    await page.click('table tbody tr:first-child td:nth-child(2) button[title="Historique des modifications"]');
    await page.waitForSelector('text=Historique des modifications');

    const noBlurMetrics = await page.evaluate(async () => {
      // Find modal overlay and remove blur
      const allDivs = Array.from(document.querySelectorAll('div'));
      const modalOverlay = allDivs.find(d => d.style.zIndex === '1100');
      if (modalOverlay) {
        modalOverlay.style.backdropFilter = 'none';
        modalOverlay.style.webkitBackdropFilter = 'none';
      }

      const t0 = performance.now();
      const closeBtn = document.querySelector('button.btn-primary');
      closeBtn.click();
      
      await new Promise(r => requestAnimationFrame(r));
      const t1 = performance.now();
      return { durationFirstFrame: t1 - t0 };
    });
    console.log(`Test B (sans blur) : premier frame de fermeture = ${noBlurMetrics.durationFirstFrame.toFixed(2)} ms`);

    // =========================================================================
    // SCENARIO 4: CLICKING OUTSIDE (BACKDROP) TEST
    // =========================================================================
    console.log('\n--- SCENARIO 4: Test fermeture par clic sur le backdrop (overlay) ---');
    await page.waitForTimeout(300);
    await page.click('table tbody tr:first-child td:nth-child(2) button[title="Historique des modifications"]');
    await page.waitForSelector('text=Historique des modifications');

    const backdropCloseMetrics = await page.evaluate(async () => {
      const allDivs = Array.from(document.querySelectorAll('div'));
      const modalOverlay = allDivs.find(d => d.style.zIndex === '1100');
      
      const t0 = performance.now();
      // Click at top-left corner of overlay (outside modal card)
      modalOverlay.click();

      await new Promise(r => requestAnimationFrame(r));
      const t1 = performance.now();
      const modalStillPresent = Array.from(document.querySelectorAll('h3')).some(h => h.innerText.includes('Historique'));
      return { durationFirstFrame: t1 - t0, modalStillPresent };
    });
    console.log(`Fermeture via clic backdrop : premier frame = ${backdropCloseMetrics.durationFirstFrame.toFixed(2)} ms, modal encore présent = ${backdropCloseMetrics.modalStillPresent}`);

    // Take screenshot for evidence
    await page.screenshot({ path: path.resolve(__dirname, '../screenshot_task094.png'), fullPage: true });
    console.log('Capture écran enregistrée sous screenshot_task094.png');

    console.log('\n========================================');
    console.log('DIAGNOSTIC COMPLET TASK-094 TERMINE AVEC SUCCES');
    console.log('========================================\n');
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch(err => {
  console.error('Erreur harness TASK-094:', err);
  process.exit(1);
});
