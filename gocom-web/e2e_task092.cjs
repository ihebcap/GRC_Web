const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const WWWROOT = path.resolve(__dirname, '../deploy/wwwroot');
const PORT = 3458;

if (!fs.existsSync(WWWROOT)) {
  console.error(`Dossier build introuvable: ${WWWROOT}`);
  process.exit(1);
}

const mockReglements = [
  {
    no: 101,
    date: '2026-09-28T00:00:00',
    clientIntitule: 'CLIENT TEST EDITABLE',
    numero: 'REG001',
    pieceNumero: 'FAC001',
    reference: 'REF-EDITABLE',
    montantDeviseSociete: 500.0,
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
  },
  {
    no: 102,
    date: '2026-09-27T00:00:00',
    clientIntitule: 'CLIENT TEST POINTE',
    numero: 'REG002',
    pieceNumero: 'FAC002',
    reference: 'REF-LOCKED',
    montantDeviseSociete: 1200.0,
    soldeDeviseSociete: 0,
    caisseNo: 1,
    banqueNo: 1,
    modeReglementNo: 1,
    isPointe: true, // Masque le bouton Modifier
    isComptabilise: 0,
    isRemis: 0,
    isAffecte: false,
    isAnnule: false,
    statut: 'Pointe'
  }
];

let returnEmpty = false;

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
      clients: ['CLIENT TEST EDITABLE', 'CLIENT TEST POINTE'],
      numeros: ['REG001', 'REG002'],
      pieces: ['FAC001', 'FAC002'],
      references: ['REF-EDITABLE', 'REF-LOCKED'],
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
    if (returnEmpty) {
      res.end(JSON.stringify({ items: [], totalItems: 0 }));
    } else {
      res.end(JSON.stringify({ items: mockReglements, totalItems: mockReglements.length }));
    }
    return;
  }

  if (pathname.startsWith('/api/reglements/') && (pathname.endsWith('/history') || pathname.endsWith('/historique'))) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([
      { id: 1, reglementNo: 101, typeAction: 'MODIFICATION', champModifie: 'Montant', ancienneValeur: '450', nouvelleValeur: '500', modifiePar: 'admin', dateModification: '2026-09-28T12:00:00' }
    ]));
    return;
  }

  console.log('Mock unhandled:', pathname);
  res.writeHead(404);
  res.end('Not Found');
});

async function run() {
  await new Promise(resolve => server.listen(PORT, resolve));
  console.log(`Serveur mock démarré sur http://localhost:${PORT}`);

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

  page.on('console', msg => {
    if (msg.type() === 'error') console.log('[Browser Error]', msg.text());
  });

  try {
    console.log('Chargement de la page...');
    await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('table', { timeout: 10000 });
    await page.waitForTimeout(500);

    // 1. Check Table Headers
    const headers = await page.$$eval('table thead tr th', ths => ths.map(th => ({
      text: th.innerText.trim(),
      styleWidth: th.style.width,
      title: th.getAttribute('title') || ''
    })));

    console.log(`Nombre total de colonnes d'en-tête: ${headers.length}`);
    console.log(`Col 0: text="${headers[0].text}", width="${headers[0].styleWidth}"`);
    console.log(`Col 1: text="${headers[1].text}", width="${headers[1].styleWidth}"`);
    console.log(`Dernière col: text="${headers[headers.length - 1].text}", width="${headers[headers.length - 1].styleWidth}"`);

    if (headers[0].text !== '') throw new Error('Col 0 header must have no text');
    if (headers[1].text !== '') throw new Error('Col 1 header must have no text');
    if (headers[0].styleWidth !== '40px') throw new Error(`Col 0 width should be 40px, got ${headers[0].styleWidth}`);
    if (headers[1].styleWidth !== '40px') throw new Error(`Col 1 width should be 40px, got ${headers[1].styleWidth}`);
    if (headers[headers.length - 1].text.toUpperCase() !== 'ACTIONS') throw new Error(`Last col should be Actions, got ${headers[headers.length - 1].text}`);
    if (headers[headers.length - 1].styleWidth !== '100px') throw new Error(`Actions col width should be 100px, got ${headers[headers.length - 1].styleWidth}`);

    // 2. Check Row 1 (Editable row 101)
    const row1Cells = await page.$$eval('table tbody tr:first-child td', tds => tds.map(td => ({
      text: td.innerText.trim(),
      hasEditBtn: !!td.querySelector('button[title*="Modifier"]'),
      editBtnText: td.querySelector('button[title*="Modifier"]')?.innerText?.trim() || '',
      hasHistoryBtn: !!td.querySelector('button[title*="Historique"]'),
      historyBtnText: td.querySelector('button[title*="Historique"]')?.innerText?.trim() || '',
      hasAnnulerBtn: !!td.querySelector('button[title*="Annuler"]'),
      annulerBtnText: td.querySelector('button[title*="Annuler"]')?.innerText?.trim() || ''
    })));

    console.log('Row 1 Col 0 (Modifier):', row1Cells[0]);
    console.log('Row 1 Col 1 (Historique):', row1Cells[1]);
    console.log('Row 1 Last Col (Actions):', row1Cells[row1Cells.length - 1]);

    if (!row1Cells[0].hasEditBtn) throw new Error('Row 1 Col 0 must contain Modifier button');
    if (row1Cells[0].editBtnText !== '') throw new Error(`Modifier button must have NO visible text, got: "${row1Cells[0].editBtnText}"`);
    if (!row1Cells[1].hasHistoryBtn) throw new Error('Row 1 Col 1 must contain Historique button');
    if (row1Cells[1].historyBtnText !== '') throw new Error(`Historique button must have NO visible text, got: "${row1Cells[1].historyBtnText}"`);
    if (!row1Cells[row1Cells.length - 1].hasAnnulerBtn) throw new Error('Row 1 Actions must contain Annuler button');
    if (row1Cells[row1Cells.length - 1].annulerBtnText !== 'Annuler') throw new Error(`Annuler button must have text "Annuler", got: "${row1Cells[row1Cells.length - 1].annulerBtnText}"`);

    // 3. Check Row 2 (Pointe row 102 - Modifier should NOT appear)
    const row2Cells = await page.$$eval('table tbody tr:nth-child(2) td', tds => tds.map(td => ({
      text: td.innerText.trim(),
      hasEditBtn: !!td.querySelector('button[title*="Modifier"]'),
      hasHistoryBtn: !!td.querySelector('button[title*="Historique"]'),
      hasAnnulerBtn: !!td.querySelector('button[title*="Annuler"]')
    })));

    console.log('Row 2 Col 0 (Modifier condition false):', row2Cells[0]);
    console.log('Row 2 Col 1 (Historique):', row2Cells[1]);

    if (row2Cells[0].hasEditBtn) throw new Error('Row 2 Col 0 must NOT contain Modifier button (condition false)');
    if (!row2Cells[1].hasHistoryBtn) throw new Error('Row 2 Col 1 must contain Historique button (always visible)');

    // 4. Test clicking Modifier opens ModifierReglementModal
    console.log('Test clic Modifier...');
    await page.click('table tbody tr:first-child td:nth-child(1) button[title="Modifier le règlement"]');
    await page.waitForTimeout(400);
    const bodyTextMod = await page.evaluate(() => document.body.innerText);
    const hasModifierTitle = bodyTextMod.includes('Modifier le règlement') || bodyTextMod.includes('Modifier règlement');
    console.log('Modale Modifier affichée ?', hasModifierTitle);
    if (!hasModifierTitle) throw new Error('Modale Modifier non ouverte au clic');

    // Fermer la modale
    const closeBtn = page.locator('button', { hasText: 'Annuler' }).last();
    if (await closeBtn.isVisible()) await closeBtn.click();
    await page.waitForTimeout(400);

    // 5. Test clicking Historique opens HistoriqueReglementModal
    console.log('Test clic Historique...');
    await page.click('table tbody tr:first-child td:nth-child(2) button[title="Historique des modifications"]');
    await page.waitForTimeout(500);
    const histText = await page.evaluate(() => document.body.innerText);
    const hasHistoryTitle = histText.includes('Historique des modifications') || histText.includes('Historique');
    console.log('Modale Historique affichée ?', hasHistoryTitle);
    if (!hasHistoryTitle) throw new Error('Modale Historique non ouverte au clic');

    // Fermer la modale historique
    const closeHistBtn = page.locator('button', { hasText: 'Fermer' }).last();
    if (await closeHistBtn.isVisible()) await closeHistBtn.click();
    await page.waitForTimeout(400);

    // 6. Test colSpan in mode Rapprochement when a row is selected
    console.log('Test colSpan ligne édition Rapprochement...');
    const totalThCount = headers.length;
    // Cliquer sur le bouton Mode Rapprochement
    const rapBtn = page.locator('button', { hasText: 'Rapprocher' }).first();
    if (await rapBtn.isVisible()) {
      await rapBtn.click();
      await page.waitForTimeout(400);
      // Cliquer sur la première ligne pour la sélectionner
      await page.click('table tbody tr:first-child');
      await page.waitForTimeout(400);

      const subRowColSpan = await page.$eval('table tbody tr:nth-child(2) td', td => td.colSpan);
      console.log(`Ligne d'édition inline Rapprochement: colSpan=${subRowColSpan}, total Th=${totalThCount}`);
      if (subRowColSpan !== totalThCount) {
        throw new Error(`Inline row colSpan (${subRowColSpan}) does not match total Th count (${totalThCount})`);
      }

    }

    // 7. Test colSpan in empty list
    returnEmpty = true;
    console.log('Test colSpan quand la liste est vide...');
    await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('table', { timeout: 10000 });
    await page.waitForTimeout(500);

    const emptyTdColSpan = await page.$eval('table tbody tr td', td => ({
      colSpan: td.colSpan,
      text: td.innerText.trim()
    }));
    console.log(`Liste vide: colSpan=${emptyTdColSpan.colSpan}, total Th=${totalThCount}, text="${emptyTdColSpan.text}"`);
    if (emptyTdColSpan.colSpan !== totalThCount) {
      throw new Error(`colSpan (${emptyTdColSpan.colSpan}) does not match total Th count (${totalThCount})`);
    }

    // Screenshot
    returnEmpty = false;
    await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('table', { timeout: 10000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.resolve(__dirname, '../screenshot_task092.png'), fullPage: true });
    console.log('Capture enregistrée sous screenshot_task092.png');

    console.log('TOUS LES TESTS E2E POUR TASK-092 ONT REUSSI AVEC SUCCES !');
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch(err => {
  console.error('Erreur test E2E:', err);
  process.exit(1);
});
