// TASK-110 — E2E capture & verification script
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const WWWROOT = path.resolve(__dirname, '../deploy/wwwroot');
const PORT = 3520;
const EVIDENCE_DIR = path.resolve(__dirname, '../tasks/VERIFY/TASK-110_evidence');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const testReglements = [
  {
    no: 101,
    numero: 'REG-ANNULE',
    date: '2026-09-20T00:00:00',
    clientIntitule: 'CLIENT ROUGE ANNULE',
    montantDeviseSociete: 1200.50,
    soldeDeviseSociete: 0,
    caisseNo: 1,
    modeReglementNo: 1,
    banqueNo: 1,
    isAnnule: true,
    isComptabilise: 0,
    isPointe: false,
    isRemis: 0,
    pieceNumero: 'PIECE-01',
    reference: 'REF-ANN'
  },
  {
    no: 102,
    numero: 'REG-COMPTA',
    date: '2026-09-21T00:00:00',
    clientIntitule: 'CLIENT VERT COMPTA',
    montantDeviseSociete: 2350.00,
    soldeDeviseSociete: 0,
    caisseNo: 1,
    modeReglementNo: 1,
    banqueNo: 1,
    isAnnule: false,
    isComptabilise: 1,
    isPointe: false,
    isRemis: 0,
    pieceNumero: 'PIECE-02',
    reference: 'REF-CPT'
  },
  {
    no: 103,
    numero: 'REG-POINTE',
    date: '2026-09-22T00:00:00',
    clientIntitule: 'CLIENT BLEU POINTE',
    montantDeviseSociete: 840.75,
    soldeDeviseSociete: 0,
    caisseNo: 1,
    modeReglementNo: 1,
    banqueNo: 1,
    isAnnule: false,
    isComptabilise: 0,
    isPointe: true,
    isRemis: 0,
    pieceNumero: 'PIECE-03',
    reference: 'REF-PNT'
  },
  {
    no: 104,
    numero: 'REG-REMIS',
    date: '2026-09-23T00:00:00',
    clientIntitule: 'CLIENT ORANGE REMIS',
    montantDeviseSociete: 3100.25,
    soldeDeviseSociete: 0,
    caisseNo: 1,
    modeReglementNo: 1,
    banqueNo: 1,
    isAnnule: false,
    isComptabilise: 0,
    isPointe: false,
    isRemis: 1,
    pieceNumero: 'PIECE-04',
    reference: 'REF-RMS'
  },
  {
    no: 105,
    numero: 'REG-STANDARD',
    date: '2026-09-24T00:00:00',
    clientIntitule: 'CLIENT SANS LISERE',
    montantDeviseSociete: 1508.50,
    soldeDeviseSociete: 1508.50,
    caisseNo: 1,
    modeReglementNo: 1,
    banqueNo: 1,
    isAnnule: false,
    isComptabilise: 0,
    isPointe: false,
    isRemis: 0,
    pieceNumero: 'PIECE-05',
    reference: 'REF-STD'
  }
];

const totalMontantExpected = testReglements.reduce((sum, r) => sum + r.montantDeviseSociete, 0);

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
  if (p.startsWith('/api/reference/modes')) return json([{ id: 1, code: 'CHQ', intitule: 'Chèque', typeNo: 1 }]);
  if (p.startsWith('/api/reglements/distincts')) {
    return json({
      clients: testReglements.map(r => r.clientIntitule),
      numeros: testReglements.map(r => r.numero),
      pieces: testReglements.map(r => r.pieceNumero),
      references: testReglements.map(r => r.reference),
      libelles: [], extraits: [], banquesTier: []
    });
  }
  if (p === '/api/reglements' && req.method === 'GET') {
    let filtered = [...testReglements];
    if (u.searchParams.get('comptabilise') === 'false') {
      filtered = filtered.filter(r => r.isComptabilise === 0);
    }
    if (u.searchParams.get('annule') === 'false') {
      filtered = filtered.filter(r => !r.isAnnule);
    }
    return json({
      items: filtered,
      totalItems: filtered.length < testReglements.length ? filtered.length : 15
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

    // Wait for table to load
    await page.waitForSelector('table tbody tr');
    await page.waitForTimeout(500);

    const rows = await page.locator('table tbody tr').all();
    console.log(`Lignes dans tbody au chargement: ${rows.length}`);

    if (mode === 'after' || mode === 'verify') {
      // Check borders of rows
      console.log('\n--- Vérification des liserés (boxShadow) ---');
      const rowStyles = await page.evaluate(() => {
        const trs = Array.from(document.querySelectorAll('table tbody tr'));
        return trs.map(tr => {
          const text = tr.innerText;
          const style = window.getComputedStyle(tr);
          return {
            text: text.slice(0, 35),
            boxShadow: style.boxShadow,
            borderLeft: style.borderLeft,
            opacity: style.opacity
          };
        });
      });

      rowStyles.forEach((r, idx) => {
        console.log(`Ligne ${idx + 1} (${r.text.replace(/\s+/g, ' ')}): boxShadow="${r.boxShadow}", opacity="${r.opacity}"`);
      });

      // Check footer row
      console.log('\n--- Vérification de la ligne de totaux ---');
      const footerExists = await page.locator('table tfoot').count();
      console.log(`tfoot présent: ${footerExists > 0}`);
      if (footerExists > 0) {
        const footerText = await page.locator('table tfoot').innerText();
        console.log(`Contenu tfoot: "${footerText.replace(/\s+/g, ' ')}"`);
      }
    }

    // Capture main grid view with all statuses and footer
    await page.screenshot({ path: path.join(EVIDENCE_DIR, `screenshot_${mode}_grid_all_statuses.png`), fullPage: false });
    console.log(`Capture enregistrée: screenshot_${mode}_grid_all_statuses.png`);

    // Click on Comptabiliser button to test selection
    const comptaBtn = page.locator('button:has-text("Comptabiliser")');
    if (await comptaBtn.count() > 0) {
      await comptaBtn.click();
      await page.waitForTimeout(400);

      // In compta mode, filter comptabilise: 'non' is set. 
      // Click on row REG-STANDARD which is not comptabilise and not annule
      const rowToSelect = page.locator('table tbody tr:has-text("REG-STANDARD")');
      if (await rowToSelect.count() > 0) {
        await rowToSelect.click();
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(EVIDENCE_DIR, `screenshot_${mode}_selection_active.png`), fullPage: false });
        console.log(`Capture sélection enregistrée: screenshot_${mode}_selection_active.png`);

        if (mode === 'after' || mode === 'verify') {
          // Check selection boxShadow
          const selStyle = await rowToSelect.evaluate(el => {
            const s = window.getComputedStyle(el);
            return { boxShadow: s.boxShadow, bg: s.backgroundColor };
          });
          console.log(`Ligne sélectionnée: boxShadow="${selStyle.boxShadow}", bg="${selStyle.bg}"`);
        }
      }
      // Leave compta mode
      const closeCompta = page.locator('button:has-text("Fermer Comptabilisation")');
      if (await closeCompta.count() > 0) {
        await closeCompta.click();
        await page.waitForTimeout(400);
      }
    }

    console.log(`\nSuccès mode ${mode}`);
  } catch (err) {
    console.error('Erreur E2E:', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
  }
})();
