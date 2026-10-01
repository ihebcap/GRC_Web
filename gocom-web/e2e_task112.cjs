// TASK-112 — E2E capture & verification script
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const WWWROOT = path.resolve(__dirname, '../deploy/wwwroot');
const PORT = 3512;
const EVIDENCE_DIR = path.resolve(__dirname, '../tasks/VERIFY/TASK-112_evidence');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const readBody = (req) => new Promise((resolve) => {
  let b = '';
  req.on('data', c => (b += c));
  req.on('end', () => {
    try { resolve(b ? JSON.parse(b) : null); } catch { resolve(null); }
  });
});

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
  if (p === '/api/reference/banques') {
    return json([{ id: 1, code: 'BQ01', intitule: 'Banque Populaire', rib: '0123456789' }]);
  }
  if (p === '/api/reference/societes') return json([{ id: 1, raisonSociale: 'GOCOM SARL' }]);
  if (p.startsWith('/api/reference/modes')) {
    return json([
      { id: 1, code: 'CHQ', intitule: 'Chèque', typeNo: 1 },
      { id: 2, code: 'ESP', intitule: 'Espèce', typeNo: 2 },
      { id: 3, code: 'VIR', intitule: 'Virement', typeNo: 3 }
    ]);
  }
  if (p === '/api/reference/clients/count') return json(2);
  if (p.startsWith('/api/reference/clients')) {
    return json([{ code: 'CLI01', intitule: 'Client Alpha' }, { code: 'CLI02', intitule: 'Client Beta' }]);
  }
  if (p.startsWith('/api/reglements/distincts')) {
    return json({ clients: ['CLI01', 'CLI02'], numeros: ['RG001', 'RG002'], pieces: ['PC01'], references: ['REF01'], libelles: ['Règlement facture'], extraits: [], banquesTier: [] });
  }

  // Rapprochement Bancaire endpoints
  if (p === '/api/ReleveBancaire' && req.method === 'GET') {
    return json([
      { id: 101, titre: 'Relevé 09/2026', dateImport: '2026-09-30T00:00:00' }
    ]);
  }
  if (p === '/api/ReleveBancaire/lignes' && req.method === 'POST') {
    return json([
      {
        id: 1,
        releveBancaireEnteteId: 101,
        dateOperation: '2026-09-30T00:00:00',
        dateValeur: '2026-09-30T00:00:00',
        libelle: 'Virement Facture Alpha 1234',
        reference: 'VIR-101',
        code: 'VIR',
        credit: 1500.0,
        debit: 0,
        lettrage: null,
        mV_ID: null,
        reservePar_UserId: null,
        reservePar_UserName: null,
        dateReservation: null
      }
    ]);
  }

  // Reglements list (used by Règlements, Rapprochement, Comptabilisation)
  if (p === '/api/reglements' && req.method === 'GET') {
    return json({
      items: [
        {
          no: 1,
          mv_Id: 1,
          numero: 'RG001',
          date: '2026-09-30T00:00:00',
          client: 'CLI01 - Client Alpha',
          clientCode: 'CLI01',
          clientIntitule: 'Client Alpha',
          montant: 1500.0,
          montantDeviseSociete: 1500.0,
          mode: 'CHQ',
          banque: 'BQ01',
          caisse: 'CAISSE1',
          libelle: 'Règlement facture 1234',
          piece: 'PC01',
          reference: 'REF01',
          isAnnule: false,
          isComptabilise: false,
          isPointe: true,
          isRemis: false,
          lettrage: null
        },
        {
          no: 2,
          mv_Id: 2,
          numero: 'RG002',
          date: '2026-09-29T00:00:00',
          client: 'CLI02 - Client Beta',
          clientCode: 'CLI02',
          clientIntitule: 'Client Beta',
          montant: 2750.5,
          montantDeviseSociete: 2750.5,
          mode: 'ESP',
          banque: 'BQ01',
          caisse: 'CAISSE1',
          libelle: 'Règlement facture 5678',
          piece: 'PC02',
          reference: 'REF02',
          isAnnule: false,
          isComptabilise: true,
          isPointe: true,
          isRemis: true,
          lettrage: null
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
  console.log(`Serveur mock TASK-112 démarré sur http://localhost:${PORT}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  const fontRequests = [];
  page.on('response', resp => {
    const url = resp.url();
    if (url.includes('fonts.gstatic.com') || url.includes('fonts.googleapis.com')) {
      fontRequests.push(url);
    }
  });

  page.on('pageerror', e => console.log('  [pageerror]', e.message));

  try {
    console.log(`\n--- Démarrage test mode: ${mode} ---`);
    await page.goto(`http://localhost:${PORT}`);
    await page.fill('input[type="text"]', 'ADMIN');
    await page.fill('input[type="password"]', 'password');
    await page.click('button[type="submit"]');

    await page.waitForSelector('.app-sidebar', { timeout: 5000 });
    await page.waitForSelector('.main-content', { timeout: 5000 });
    await page.waitForTimeout(1000);

    const prefix = mode === 'before' ? 'screenshot_task112_before' : 'screenshot_task112_after';

    // 1. Écran Règlements
    console.log('Capture Écran 1: Règlements...');
    await page.screenshot({ path: path.join(EVIDENCE_DIR, `${prefix}_reglements.png`) });

    const bodyFontFamily = await page.evaluate(() => window.getComputedStyle(document.body).fontFamily);
    console.log(`  Body font-family: "${bodyFontFamily}"`);

    // 2. Écran Rapprochement
    console.log('Navigation vers Écran 2: Rapprochement...');
    await page.click('.sidebar-item[title*="Rapprochement"]');
    await page.waitForSelector('.rapprochement-container, .rappro-toolbar', { timeout: 5000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, `${prefix}_rapprochement.png`) });

    const rapproFontFamily = await page.evaluate(() => {
      const el = document.querySelector('.rapprochement-container');
      return el ? window.getComputedStyle(el).fontFamily : 'not-found';
    });
    console.log(`  Rapprochement-container font-family: "${rapproFontFamily}"`);

    // 3. Écran Comptabilisation
    console.log('Navigation vers Écran 3: Comptabilisation...');
    await page.click('.sidebar-item[title*="Comptabilisation"]');
    await page.waitForSelector('.compta-toolbar, .table-container, .card', { timeout: 5000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, `${prefix}_comptabilisation.png`) });

    // Validation mode check
    if (mode === 'verify' || mode === 'after') {
      console.log('\n--- Vérification des polices actives ---');
      const isRobotoBody = bodyFontFamily.toLowerCase().includes('roboto');
      console.log(`  Body contient "Roboto" : ${isRobotoBody} (${bodyFontFamily})`);
      if (!isRobotoBody) {
        throw new Error(`ÉCHEC : document.body font-family attendue Roboto, obtenu: ${bodyFontFamily}`);
      }

      const isRobotoRappro = rapproFontFamily.toLowerCase().includes('roboto');
      console.log(`  Rapprochement contient "Roboto" : ${isRobotoRappro} (${rapproFontFamily})`);
      if (!isRobotoRappro) {
        throw new Error(`ÉCHEC : .rapprochement-container font-family attendue Roboto, obtenu: ${rapproFontFamily}`);
      }

      // Check loaded font faces in document.fonts and explicitly test the 5 weights
      const weightChecks = await page.evaluate(async () => {
        const weights = ['300', '400', '500', '600', '700'];
        const results = {};
        for (const w of weights) {
          const loaded = await document.fonts.load(`${w} 16px Roboto`);
          results[w] = loaded.length > 0 && loaded[0].status === 'loaded';
        }
        return results;
      });
      console.log('  Vérification du chargement effectif des 5 graisses (300, 400, 500, 600, 700):', weightChecks);
      for (const [w, ok] of Object.entries(weightChecks)) {
        if (!ok) {
          throw new Error(`ÉCHEC : La graisse Roboto ${w} n'a pas pu être chargée !`);
        }
      }

      console.log('\n>>> SUCCÈS : Toutes les 5 graisses Roboto (300, 400, 500, 600, 700) sont confirmées chargées ! <<<');
    }

    console.log(`Captures enregistrées sous ${EVIDENCE_DIR}`);
  } catch (err) {
    console.error('Erreur test:', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
  }
})();
