// TASK-118 — E2E test for S9 front behavior on 409 Conflict
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const WWWROOT = path.resolve(__dirname, '../deploy/wwwroot');
const PORT = 3518;
const EVIDENCE_DIR = path.resolve(__dirname, '../tasks/VERIFY/TASK-118_evidence');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

let comptabiliserShouldConflict = true;
let lettrageShouldConflict = true;

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  const p = u.pathname;
  const json = (o, s = 200) => {
    res.writeHead(s, { 'Content-Type': 'application/json; charset=utf-8' });
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

  // Static files in wwwroot
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

  // Auth & Reference
  if (p === '/api/auth/login') {
    return json({
      no: 1, login: 'Admin', nom: 'Admin', prenom: 'Sys',
      isAdmin: true, societeId: 1, societeName: 'GOCOM SARL', caisses: [1], token: 'mock-jwt-token'
    });
  }
  if (p === '/api/reference/societes') {
    return json([{ id: 1, raisonSociale: 'GOCOM SARL' }]);
  }
  if (p === '/api/reference/caisses') {
    return json([{ id: 1, code: 'CR', intitule: 'Caisse Recette' }]);
  }
  if (p === '/api/reference/modes') {
    return json([{ id: 1, code: 'ESP', intitule: 'Espèces' }]);
  }
  if (p === '/api/reference/banques') {
    return json([]);
  }

  // Distincts & Reglements
  if (p === '/api/reglements/distincts') {
    return json({ clients: ['CLIENT A'], pieces: ['FAC01'], numeros: ['RC001'] });
  }

  if (p === '/api/reglements' && req.method === 'GET') {
    return json({
      items: [
        {
          no: 50447,
          numero: 'RC26100028',
          date: '2026-08-01T00:00:00',
          clientIntitule: 'CLIENT TEST A',
          montantDeviseSociete: 1500.0,
          montant: '1 500,00',
          caisseCode: 'CR',
          caisseIntitule: 'Caisse Recette',
          mode: 'ESP',
          comptabilise: 'Non',
          isComptabilise: 0,
          pointe: 'Oui',
          isPointe: 1,
          remis: 'Non',
          isRemis: 0,
          impaye: 'Non',
          isImpaye: 0,
          annule: 'Non',
          isAnnule: 0,
          solde: 0,
          pieceNumero: 'FAG2600100'
        }
      ],
      totalItems: 1
    });
  }

  // Apercu comptabilisation
  if (p === '/api/reglements/apercu-comptabilisation') {
    return json([
      {
        reglementId: 50447,
        numero: 'RC26100028',
        piece: 'FAG2600100',
        date: '2026-08-01T00:00:00',
        caisseCode: 'CR',
        client: 'CLIENT TEST A',
        montant: 1500.0,
        hasError: false,
        ecritures: [
          { journal: 'OD', compteGeneral: '411000', montantDebit: 1500.0, montantCredit: 0, libelle: 'Reglement' },
          { journal: 'OD', compteGeneral: '512000', montantDebit: 0, montantCredit: 1500.0, libelle: 'Reglement' }
        ]
      }
    ]);
  }

  // Comptabiliser
  if (p === '/api/reglements/comptabiliser' && req.method === 'POST') {
    if (comptabiliserShouldConflict) {
      return json({
        type: 'https://tools.ietf.org/html/rfc9110#section-15.5.10',
        title: 'Opération comptable déjà en cours',
        status: 409,
        detail: "Une opération comptable est déjà en cours : comptabilisation, lancée à 11:38 par l'utilisateur 186 (3851 élément(s), depuis 7 min). Réessayez quand elle sera terminée."
      }, 409);
    }
    return json({
      success: true,
      successCount: 1,
      errorCount: 0,
      errors: [],
      docNumeroWarnings: [],
      lettrageWarnings: []
    });
  }

  // Lettrer periode
  if (p === '/api/reglements/lettrer-periode' && req.method === 'POST') {
    if (lettrageShouldConflict) {
      return json({
        type: 'https://tools.ietf.org/html/rfc9110#section-15.5.10',
        title: 'Opération comptable déjà en cours',
        status: 409,
        detail: "Une opération comptable est déjà en cours : lettrage par période, lancée à 11:38 par l'utilisateur 186 (depuis 7 min). Réessayez quand elle sera terminée."
      }, 409);
    }
    return json({ clientsTraites: 10, clientsAvecLettrage: 8, errors: [] });
  }

  res.writeHead(404);
  res.end('Not Found');
});

async function run() {
  await new Promise(r => server.listen(PORT, r));
  console.log(`Test mock server listening on http://localhost:${PORT}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  page.on('console', msg => console.log('  [console]', msg.text()));
  page.on('request', req => console.log('  [req]', req.method(), req.url()));
  page.on('response', res => console.log('  [res]', res.status(), res.url()));

  try {
    // 1. Login
    console.log('Navigating to app...');
    await page.goto(`http://localhost:${PORT}`);
    await page.waitForSelector('input[type="text"]');

    // Fill login
    await page.fill('input[type="text"]', 'ADMIN');
    await page.fill('input[type="password"]', 'password');
    await page.click('button[type="submit"]');

    // Wait for main dashboard
    await page.waitForSelector('.app-sidebar', { timeout: 5000 });
    await page.waitForSelector('.main-content', { timeout: 5000 });
    console.log('Logged in successfully.');

    // 2. Test S9-a : Comptabilisation -> 409
    console.log('Testing S9-a: Comptabilisation with 409 response...');
    // Navigate to Comptabilisation screen
    await page.click('.sidebar-item[title*="Comptabilisation"]');
    await page.waitForTimeout(500);

    // Click "Générer l'Aperçu" button to load apercu
    await page.click('button:has-text("Générer l\'Aperçu")');
    await page.waitForSelector('.data-table tbody tr');
    console.log('Apercu loaded.');

    // Check all checkbox
    const thCheckbox = await page.$('thead input[type="checkbox"]');
    if (thCheckbox) await thCheckbox.click();
    await page.waitForTimeout(300);

    // Click "Comptabiliser" button
    const btnComptabiliser = await page.$('button:has-text("Comptabiliser")');
    if (btnComptabiliser) {
      await btnComptabiliser.click();
    }

    // Wait for toast & error panel
    await page.waitForSelector('.toast, .card.animate-fade-in');
    await page.waitForTimeout(500);

    // Capture screenshot
    const comptaScreenshot = path.join(EVIDENCE_DIR, 'screenshot_s9_comptabilisation_409.png');
    await page.screenshot({ path: comptaScreenshot, fullPage: true });
    console.log(`Saved screenshot: ${comptaScreenshot}`);

    // Verify error detail is displayed in error card or toast
    const bodyText = await page.textContent('body');
    const has409Detail = bodyText.includes('Une opération comptable est déjà en cours : comptabilisation');
    console.log(`409 Comptabilisation detail present in UI: ${has409Detail}`);
    if (!has409Detail) throw new Error('409 detail message not displayed in UI!');

    // Verify apercu table rows are still intact (not cleared on 409)
    const rowCount = await page.$$eval('.data-table tbody tr', rows => rows.length);
    console.log(`Apercu rows remaining intact after 409: ${rowCount > 0} (count=${rowCount})`);
    if (rowCount === 0) throw new Error('Apercu rows were erroneously cleared on 409!');

    // 3. Test S9-b : Lettrer par période -> 409
    console.log('Testing S9-b: Lettrer par période with 409 response...');
    // Return to Règlements screen
    await page.click('.sidebar-item[title*="Règlements"]');
    await page.waitForTimeout(500);

    // Open Lettrage par période modal
    const btnLettragePeriode = await page.$('button:has-text("Lettrer entre deux périodes")');
    if (btnLettragePeriode) {
      await btnLettragePeriode.click();
      await page.waitForSelector('button:has-text("Confirmer le lettrage")');
      await page.waitForTimeout(300);

      // Fill dates specifically inside the modal
      const modal = page.locator('div[style*="z-index: 1000"], div[style*="zIndex: 1000"], .fixed.inset-0, div:has(> div:has-text("Lettrer entre deux périodes"))');
      const dateInputs = modal.locator('input[type="date"]');
      await dateInputs.nth(0).fill('2026-01-01');
      await dateInputs.nth(1).fill('2026-06-30');

      // Click "Confirmer le lettrage" in modal
      await modal.locator('button:has-text("Confirmer le lettrage")').click();

      // Wait for toast (rendered with zIndex: 9999)
      await page.waitForSelector('div[style*="9999"]', { timeout: 10000 });
      await page.waitForTimeout(500);
      const lettrageScreenshot = path.join(EVIDENCE_DIR, 'screenshot_s9_lettrage_periode_409.png');
      await page.screenshot({ path: lettrageScreenshot, fullPage: true });
      console.log(`Saved screenshot: ${lettrageScreenshot}`);

      const bodyTextLettrage = await page.textContent('body');
      const hasLettrage409 = bodyTextLettrage.includes('Une opération comptable est déjà en cours : lettrage par période');
      console.log(`409 Lettrage période detail present in UI toast: ${hasLettrage409}`);
      if (!hasLettrage409) throw new Error('409 Lettrage detail message not displayed in toast!');
    } else {
      throw new Error('Button "Lettrer entre deux périodes" not found!');
    }

    console.log('=== S9 FRONT E2E TEST VALIDATED WITH 100% SUCCESS ===');
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch(err => {
  console.error('E2E TEST ERROR:', err);
  server.close();
  process.exit(1);
});
