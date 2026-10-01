// TASK-111 — E2E capture & verification script
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const WWWROOT = path.resolve(__dirname, '../deploy/wwwroot');
const PORT = 3511;
const EVIDENCE_DIR = path.resolve(__dirname, '../tasks/VERIFY/TASK-111_evidence');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  const p = u.pathname;
  const json = (o, s = 200) => {
    res.writeHead(s, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(o));
  };

  if (p === '/' || p === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(path.join(WWWROOT, 'index.html')));
  }
  if (p.startsWith('/assets/')) {
    const f = path.join(WWWROOT, p);
    if (fs.existsSync(f)) {
      const e = path.extname(f);
      res.writeHead(200, {
        'Content-Type': e === '.js' ? 'application/javascript' : e === '.css' ? 'text/css' : 'application/octet-stream'
      });
      return res.end(fs.readFileSync(f));
    }
  }
  if (p === '/config.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    return res.end('window.GOCOM_CONFIG = { API_BASE: "/api" };');
  }

  // Auth & Refs
  if (p === '/api/auth/login') {
    return json({
      no: 1, login: 'ADMIN', nom: 'Admin', prenom: 'Sys',
      isAdmin: true, societeId: 1, societeName: 'GOCOM SARL', caisses: [1], token: 'fake-token'
    });
  }
  if (p === '/api/reference/caisses') {
    return json([{ id: 1, code: 'CAISSE1', intitule: 'Caisse Principale' }]);
  }
  if (p === '/api/reference/banques') return json([{ id: 1, code: 'BQ01', intitule: 'Banque Populaire' }]);
  if (p === '/api/reference/societes') return json([{ id: 1, raisonSociale: 'GOCOM SARL' }]);
  if (p.startsWith('/api/reference/modes')) return json([{ id: 1, code: 'CHQ', intitule: 'Chèque' }]);
  if (p.startsWith('/api/reglements/distincts')) {
    return json({ clients: ['CLI01', 'CLI02'], numeros: ['RG001', 'RG002'], pieces: ['PC01'], references: ['REF01'], libelles: ['Règlement facture'], extraits: [], banquesTier: [] });
  }
  if (p === '/api/reglements' && req.method === 'GET') {
    return json({
      items: [
        {
          no: 1,
          numero: 'RG001',
          date: '2026-09-30T00:00:00',
          client: 'CLI01 - Client Alpha',
          montant: 1500.0,
          mode: 'CHQ',
          banque: 'BQ01',
          caisse: 'CAISSE1',
          libelle: 'Règlement facture 1234',
          piece: 'PC01',
          reference: 'REF01',
          isAnnule: false,
          isComptabilise: false,
          isPointe: false,
          isRemis: false
        },
        {
          no: 2,
          numero: 'RG002',
          date: '2026-09-29T00:00:00',
          client: 'CLI02 - Client Beta',
          montant: 2750.5,
          mode: 'ESP',
          banque: 'BQ01',
          caisse: 'CAISSE1',
          libelle: 'Règlement facture 5678',
          piece: 'PC02',
          reference: 'REF02',
          isAnnule: false,
          isComptabilise: true,
          isPointe: true,
          isRemis: true
        }
      ],
      totalItems: 2
    });
  }

  res.writeHead(404);
  res.end();
});

const mode = process.argv[2] || 'verify'; // 'before', 'after', or 'verify'

(async () => {
  await new Promise(r => server.listen(PORT, r));
  console.log(`Serveur mock démarré sur http://localhost:${PORT}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  page.on('pageerror', e => console.log('  [pageerror]', e.message));

  try {
    console.log(`\n--- Mode: ${mode} ---`);
    await page.goto(`http://localhost:${PORT}`);
    await page.fill('input[type="text"]', 'ADMIN');
    await page.fill('input[type="password"]', 'password');
    await page.click('button[type="submit"]');

    // Wait for sidebar and content
    await page.waitForSelector('.app-sidebar', { timeout: 5000 });
    await page.waitForSelector('.main-content', { timeout: 5000 });
    await page.waitForTimeout(500);

    const prefix = mode === 'before' ? 'screenshot_task111_before' : 'screenshot_task111_after';

    // 1. Sidebar open screenshot (full page & sidebar crop)
    const sidebarEl = page.locator('.app-sidebar');
    await sidebarEl.screenshot({ path: path.join(EVIDENCE_DIR, `${prefix}_sidebar_open.png`) });
    await page.screenshot({ path: path.join(EVIDENCE_DIR, `${prefix}_full_screen.png`) });
    console.log(`  Captures open & full enregistrées (${prefix})`);

    // Verify computed styles in mode verify or after
    const sidebarBg = await sidebarEl.evaluate(el => window.getComputedStyle(el).backgroundColor);
    const activeItem = page.locator('.sidebar-item.active').first();
    const activeColor = await activeItem.evaluate(el => window.getComputedStyle(el).color);
    const bodyBg = await page.evaluate(() => window.getComputedStyle(document.body).backgroundColor);

    console.log(`  Computed .app-sidebar background: ${sidebarBg}`);
    console.log(`  Computed .sidebar-item.active color: ${activeColor}`);
    console.log(`  Computed body background: ${bodyBg}`);

    if (mode === 'verify' || mode === 'after') {
      if (sidebarBg !== 'rgb(10, 10, 10)') {
        throw new Error(`ÉCHEC : .app-sidebar background attendu rgb(10, 10, 10), obtenu: ${sidebarBg}`);
      }
      if (activeColor !== 'rgb(79, 195, 247)') {
        throw new Error(`ÉCHEC : .sidebar-item.active color attendu rgb(79, 195, 247), obtenu: ${activeColor}`);
      }
      if (bodyBg !== 'rgb(245, 247, 250)') {
        throw new Error(`ÉCHEC : body background attendu rgb(245, 247, 250), obtenu: ${bodyBg}`);
      }
    }

    // 2. Click sidebar header to collapse
    const headerToggle = page.locator('.sidebar-header');
    await headerToggle.click();
    await page.waitForTimeout(400); // transition

    // Sidebar collapsed screenshot
    await sidebarEl.screenshot({ path: path.join(EVIDENCE_DIR, `${prefix}_sidebar_collapsed.png`) });
    console.log(`  Capture collapsed enregistrée (${prefix})`);

    const isCollapsed = await sidebarEl.evaluate(el => el.classList.contains('collapsed'));
    if (!isCollapsed) {
      throw new Error('ÉCHEC : .app-sidebar n\'a pas la classe collapsed après clic !');
    }

    console.log(`\n>>> SUCCESS mode ${mode} : toutes les vérifications sont validées ! <<<`);
  } catch (err) {
    console.error('Erreur test:', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
  }
})();
