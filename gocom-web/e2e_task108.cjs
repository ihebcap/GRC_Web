// TASK-108 — Test E2E reproduction et validation Règlement espèce
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const WWWROOT = path.resolve(__dirname, '../deploy/wwwroot');
const PORT = 3508;
const EVIDENCE_DIR = path.resolve(__dirname, '../tasks/VERIFY/TASK-108_evidence');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const initialFactures = [
  {
    echeanceNo: 101,
    factureNumero: 'FA26-001',
    clientCode: 'CL01',
    clientIntitule: 'CLIENT ALPHA',
    dateFacture: '2026-09-01T00:00:00',
    dateEcheance: '2026-09-30T00:00:00',
    montant: 500,
    solde: 500,
    representant: 'REP1',
    commentaire: 'Facture Alpha',
    info1: '', info2: '', info3: '', info4: ''
  },
  {
    echeanceNo: 102,
    factureNumero: 'FA26-002',
    clientCode: 'CL02',
    clientIntitule: 'CLIENT BETA',
    dateFacture: '2026-09-02T00:00:00',
    dateEcheance: '2026-09-30T00:00:00',
    montant: 300,
    solde: 300,
    representant: 'REP2',
    commentaire: 'Facture Beta (erreur)',
    info1: '', info2: '', info3: '', info4: ''
  },
  {
    echeanceNo: 103,
    factureNumero: 'FA26-003',
    clientCode: 'CL03',
    clientIntitule: 'CLIENT GAMMA',
    dateFacture: '2026-09-03T00:00:00',
    dateEcheance: '2026-09-30T00:00:00',
    montant: 200,
    solde: 200,
    representant: 'REP3',
    commentaire: 'Facture Gamma',
    info1: '', info2: '', info3: '', info4: ''
  }
];

let getFacturesCallCount = 0;
let postGenererCalls = [];

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
      isAdmin: true, societeId: 1, caisses: [1], token: 'fake-token'
    });
  }
  if (p === '/api/reference/caisses') {
    return json([{ id: 1, code: 'CAISSE1', intitule: 'Caisse Principale' }]);
  }
  if (p === '/api/reference/banques') return json([]);
  if (p === '/api/reference/societes') return json([{ id: 1, raisonSociale: 'GOCOM' }]);
  if (p.startsWith('/api/reference/modes')) return json([]);
  if (p.startsWith('/api/reglements/distincts')) {
    return json({ clients: [], numeros: [], pieces: [], references: [], libelles: [], extraits: [], banquesTier: [] });
  }
  if (p === '/api/reglements' && req.method === 'GET') {
    return json({ items: [], totalItems: 0 });
  }

  // Factures à régler
  if (p === '/api/reglements/factures-a-regler' && req.method === 'GET') {
    getFacturesCallCount++;
    console.log(`  [API] GET /api/reglements/factures-a-regler (appel n°${getFacturesCallCount})`);
    return json(initialFactures);
  }

  // Génération espèces (lot partiel : FA26-001 réussit, FA26-002 échoue)
  if (p === '/api/reglements/generer-espece' && req.method === 'POST') {
    const body = await readBody(req);
    postGenererCalls.push(body);
    console.log('  [API] POST /api/reglements/generer-espece :', JSON.stringify(body));

    return json({
      success: false,
      reglementsCreees: [
        { echeanceNo: 101, factureNumero: 'FA26-001', reglementNumero: 'RC26070001' }
      ],
      erreurs: [
        { echeanceNo: 102, factureNumero: 'FA26-002', erreur: 'Solde insuffisant ou échéance non lettrable' }
      ]
    });
  }

  res.writeHead(404);
  res.end();
});

const mode = process.argv[2] || 'test'; // 'reproduce' or 'verify'

(async () => {
  await new Promise(r => server.listen(PORT, r));
  console.log(`Serveur mock démarré sur http://localhost:${PORT}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 850 } });
  const page = await context.newPage();

  page.on('pageerror', e => console.log('  [pageerror]', e.message));

  try {
    console.log('\n--- 1. Connexion et navigation vers Règlement espèce ---');
    await page.goto(`http://localhost:${PORT}`);
    await page.fill('input[type="text"]', 'ADMIN');
    await page.fill('input[type="password"]', 'password');
    await page.click('button[type="submit"]');

    // Cliquer sur le menu Règlement espèce
    const regEspBtn = page.locator('.sidebar-item').filter({ hasText: /Règlement\s+espèce/i }).first();
    await regEspBtn.waitFor({ state: 'visible', timeout: 5000 });
    await regEspBtn.click();

    // Attendre l'affichage de la table des factures
    await page.waitForSelector('.regesp-factures-container table tbody tr', { timeout: 5000 });
    const rowCountBefore = await page.locator('.regesp-factures-container table tbody tr').count();
    console.log(`  Nombre de factures affichées initialement : ${rowCountBefore}`);

    // Choisir la caisse
    await page.selectOption('select.form-input', 'CAISSE1');

    // Cocher FA26-001 et FA26-002
    const row1 = page.locator('tr:has-text("FA26-001")');
    const row2 = page.locator('tr:has-text("FA26-002")');
    await row1.locator('input[type="checkbox"]').check();
    await row2.locator('input[type="checkbox"]').check();

    // Vérifier le bouton Générer (2)
    const btnGenerer = page.locator('button:has-text("Générer")');
    const btnText = await btnGenerer.innerText();
    console.log(`  Bouton : "${btnText}"`);

    // Réinitialiser le compteur de GET factures avant clic
    const getCountBeforeClick = getFacturesCallCount;

    console.log('\n--- 2. Déclenchement de la génération ---');
    await btnGenerer.click();

    // Attendre la fin de la requête POST et du cycle React
    await page.waitForTimeout(1000);

    // Vérifications
    const getCountAfterClick = getFacturesCallCount;
    const hasResultatsTable = await page.locator('.regesp-resultats-container').isVisible();
    const rowsCountAfter = await page.locator('.regesp-factures-container table tbody tr').count();
    const isRow1VisibleInFactures = await page.locator('.regesp-factures-container tr:has-text("FA26-001")').isVisible();
    const isRow2VisibleInFactures = await page.locator('.regesp-factures-container tr:has-text("FA26-002")').isVisible();
    const isRow2Checked = isRow2VisibleInFactures ? await page.locator('.regesp-factures-container tr:has-text("FA26-002") input[type="checkbox"]').isChecked() : false;

    const isRow1InResultats = await page.locator('.regesp-resultats-container tr:has-text("FA26-001")').isVisible();
    const isRow2InResultats = await page.locator('.regesp-resultats-container tr:has-text("FA26-002")').isVisible();

    console.log('\n--- 3. Constat post-génération ---');
    console.log(`  Tableau Résultat visible ? : ${hasResultatsTable}`);
    console.log(`  Appels GET factures pendant/après génération : ${getCountAfterClick - getCountBeforeClick}`);
    console.log(`  FA26-001 (succès) dans table factures ? : ${isRow1VisibleInFactures}`);
    console.log(`  FA26-002 (échec) dans table factures ? : ${isRow2VisibleInFactures}`);
    console.log(`  FA26-002 (échec) cochée ? : ${isRow2Checked}`);
    console.log(`  FA26-001 dans table résultats ? : ${isRow1InResultats}`);
    console.log(`  FA26-002 dans table résultats ? : ${isRow2InResultats}`);

    if (mode === 'reproduce') {
      const screenshotPath = path.join(EVIDENCE_DIR, 'screenshot_task108_before.png');
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`\n  Capture enregistrée : ${screenshotPath}`);

      if (!hasResultatsTable) {
        console.log('\n>>> BUG REPRODUIT AVEC SUCCÈS ! <<<');
        console.log('Le tableau Résultat a disparu immédiatement après la génération.');
        console.log(`GET factures rechargé inutilement (${getCountAfterClick - getCountBeforeClick} appel(s)).`);
      } else {
        console.log('\nTableau résultat présent (bug non reproduit ?)');
      }
    } else {
      // Mode verify
      const screenshotPath = path.join(EVIDENCE_DIR, 'screenshot_task108_after.png');
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`\n  Capture enregistrée : ${screenshotPath}`);

      if (!hasResultatsTable) {
        throw new Error('ÉCHEC : Le tableau Résultat n\'est pas visible après génération !');
      }
      if (!isRow1InResultats || !isRow2InResultats) {
        throw new Error('ÉCHEC : Le tableau Résultat ne contient pas les deux lignes (succès et erreur) !');
      }
      if (isRow1VisibleInFactures) {
        throw new Error('ÉCHEC : La facture FA26-001 (créée) est encore présente dans la liste des factures ouvertes !');
      }
      if (!isRow2VisibleInFactures) {
        throw new Error('ÉCHEC : La facture FA26-002 (échec) n\'est plus visible dans la liste !');
      }
      if (!isRow2Checked) {
        throw new Error('ÉCHEC : La facture FA26-002 (échec) n\'est plus cochée !');
      }
      if (getCountAfterClick > getCountBeforeClick) {
        throw new Error('ÉCHEC : Un GET factures a encore été déclenché post-génération !');
      }
      console.log('\n>>> VÉRIFICATION 100% SUCCÈS ! <<<');
      console.log('1. Tableau Résultat visible avec les lignes Succès et Erreur.');
      console.log('2. FA26-001 (réglée) retirée de la liste.');
      console.log('3. FA26-002 (échec) reste visible et cochée.');
      console.log('4. Aucun refetch GET complet (optimisation préservée).');
    }

  } catch (err) {
    console.error('Erreur test:', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
  }
})();
