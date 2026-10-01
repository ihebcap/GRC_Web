// TASK-113 — E2E capture & verification script
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const WWWROOT = path.resolve(__dirname, '../deploy/wwwroot');
const PORT = 3513;
const EVIDENCE_DIR = path.resolve(__dirname, '../tasks/VERIFY/TASK-113_evidence');
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
  if (p === '/config.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    return res.end('window.GOCOM_CONFIG = { API_BASE: "/api" };');
  }

  // Static files in wwwroot (assets, svgs, etc.)
  const staticFile = path.join(WWWROOT, p);
  if (fs.existsSync(staticFile) && fs.statSync(staticFile).isFile()) {
    const ext = path.extname(staticFile);
    const mime = ext === '.js' ? 'application/javascript' :
                 ext === '.css' ? 'text/css' :
                 ext === '.svg' ? 'image/svg+xml' :
                 ext === '.png' ? 'image/png' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    return res.end(fs.readFileSync(staticFile));
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
  if (p === '/api/reference/societes') return json([{ id: 1, raisonSociale: 'GOCOM SARL' }, { id: 2, raisonSociale: 'AUTRE SOCIETE' }]);
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
          codeClient: 'CLI01',
          clientIntitule: 'Client Alpha',
          montant: 1500.0,
          montantImpute: 0,
          solde: 1500.0,
          modeIntitule: 'Chèque',
          banqueIntitule: 'Banque Populaire',
          caisseIntitule: 'Caisse Principale',
          reference: 'CHQ-789456',
          libelle: 'Règlement facture F2026-001',
          dateEcheance: '2026-10-15T00:00:00',
          statut: 'Non imputé',
          caisseId: 1,
          banqueId: 1,
          modeId: 1,
          rapproche: false,
          comptabilise: false,
          releveBancaireLigneId: null,
          dateRapprochement: null
        }
      ],
      totalCount: 1,
      page: 1,
      pageSize: 50
    });
  }

  res.writeHead(404);
  res.end('Not found');
});

const mode = process.argv[2] || 'verify';

(async () => {
  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log(`Serveur mock démarré sur http://localhost:${PORT}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  page.on('pageerror', e => console.log('  [pageerror]', e.message));

  try {
    console.log(`\n--- Mode: ${mode} ---`);
    await page.goto(`http://localhost:${PORT}`);

    // Wait for login screen
    await page.waitForSelector('.auth-container', { timeout: 5000 });
    await page.waitForTimeout(300);

    const prefix = mode === 'before' ? 'screenshot_task113_before' : 'screenshot_task113_after';

    // 1. Login screen screenshot
    await page.screenshot({ path: path.join(EVIDENCE_DIR, `${prefix}_login.png`) });
    console.log(`  Capture login enregistrée (${prefix}_login.png)`);

    // Favicon check
    const faviconHref = await page.locator('link[rel="icon"]').getAttribute('href');
    console.log(`  Favicon link href: ${faviconHref}`);

    // Favicon visual evidence rendering
    const faviconPage = await context.newPage();
    const faviconContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Favicon Evidence - ${mode}</title>
        <style>
          body { font-family: Roboto, sans-serif; background: #f0f2f5; padding: 40px; display: flex; flex-direction: column; align-items: center; }
          .card { background: white; border-radius: 12px; padding: 30px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); width: 500px; }
          h2 { margin-top: 0; color: #111; font-size: 1.25rem; }
          .row { display: flex; align-items: center; justify-content: space-around; margin: 25px 0; }
          .item { display: flex; flex-direction: column; align-items: center; gap: 8px; }
          .caption { font-size: 12px; color: #666; font-weight: 500; }
          .info { background: #eef2f6; padding: 12px; border-radius: 6px; font-size: 13px; font-family: monospace; color: #333; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>Validation Favicon & Icône (${mode.toUpperCase()})</h2>
          <div class="info">href: ${faviconHref}</div>
          <div class="row">
            <div class="item">
              <img src="http://localhost:${PORT}${faviconHref}" width="16" height="16" />
              <span class="caption">16 × 16 px (onglet)</span>
            </div>
            <div class="item">
              <img src="http://localhost:${PORT}${faviconHref}" width="24" height="24" />
              <span class="caption">24 × 24 px (sidebar)</span>
            </div>
            <div class="item">
              <img src="http://localhost:${PORT}${faviconHref}" width="48" height="48" />
              <span class="caption">48 × 48 px (login)</span>
            </div>
            <div class="item">
              <img src="http://localhost:${PORT}${faviconHref}" width="64" height="64" />
              <span class="caption">64 × 64 px (HD)</span>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;
    await faviconPage.setContent(faviconContent);
    await faviconPage.screenshot({ path: path.join(EVIDENCE_DIR, `${prefix}_favicon.png`) });
    await faviconPage.close();
    console.log(`  Capture favicon enregistrée (${prefix}_favicon.png)`);

    // Verify societe dropdown exists and works
    const societeSelect = page.locator('select.form-input');
    await societeSelect.selectOption({ value: '2' });
    const selectedVal = await societeSelect.inputValue();
    if (selectedVal !== '2') throw new Error('ÉCHEC : sélecteur société non fonctionnel !');
    await societeSelect.selectOption({ value: '1' });

    // Perform Login
    await page.fill('input[type="text"]', 'ADMIN');
    await page.fill('input[type="password"]', 'password');
    await page.click('button[type="submit"]');

    // Wait for sidebar and content
    await page.waitForSelector('.app-sidebar', { timeout: 5000 });
    await page.waitForSelector('.main-content', { timeout: 5000 });
    await page.waitForTimeout(500);

    // 2. Sidebar open screenshot
    const sidebarEl = page.locator('.app-sidebar');
    await sidebarEl.screenshot({ path: path.join(EVIDENCE_DIR, `${prefix}_sidebar_open.png`) });
    console.log(`  Capture sidebar open enregistrée (${prefix}_sidebar_open.png)`);

    // 3. Click sidebar header to collapse
    const headerToggle = page.locator('.sidebar-header');
    await headerToggle.click();
    await page.waitForTimeout(400); // transition

    // 4. Sidebar collapsed screenshot
    await sidebarEl.screenshot({ path: path.join(EVIDENCE_DIR, `${prefix}_sidebar_collapsed.png`) });
    console.log(`  Capture sidebar collapsed enregistrée (${prefix}_sidebar_collapsed.png)`);

    if (mode === 'verify' || mode === 'after') {
      console.log('\n--- Contrôles de validation (TASK-113) ---');
      if (faviconHref !== '/grc-logo.svg') {
        throw new Error(`ÉCHEC : favicon href attendu /grc-logo.svg, obtenu: ${faviconHref}`);
      }
      console.log('  [OK] Favicon href est /grc-logo.svg');

      // Check LayoutDashboard is no longer in sidebar
      const layoutDashboardIcons = await page.locator('.sidebar-header svg.lucide-layout-dashboard').count();
      if (layoutDashboardIcons > 0) {
        throw new Error(`ÉCHEC : LayoutDashboard est encore présent dans la sidebar !`);
      }
      console.log('  [OK] LayoutDashboard retiré de la sidebar');

      // Check grc-logo.svg image in sidebar
      const sidebarLogoCount = await page.locator('.sidebar-header img[src="/grc-logo.svg"]').count();
      if (sidebarLogoCount === 0) {
        throw new Error(`ÉCHEC : img[src="/grc-logo.svg"] introuvable dans la sidebar !`);
      }
      console.log('  [OK] Logo GRC présent dans la sidebar');

      // Verify no duplicate favicon.svg
      const faviconSvgExists = fs.existsSync(path.resolve(__dirname, 'public/favicon.svg'));
      if (faviconSvgExists) {
        throw new Error(`ÉCHEC : public/favicon.svg existe encore (doublon non résolu) !`);
      }
      console.log('  [OK] public/favicon.svg supprimé (aucun doublon)');
    }

    console.log(`\n>>> SUCCESS mode ${mode} : toutes les captures et vérifications sont validées ! <<<`);
  } catch (err) {
    console.error('Erreur test:', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
  }
})();
