const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const WWWROOT = path.resolve(__dirname, '../deploy/wwwroot');
const PORT = 3470;

if (!fs.existsSync(WWWROOT)) {
  console.error(`Dossier build introuvable: ${WWWROOT}`);
  process.exit(1);
}

const mockReglements = [
  {
    no: 48338,
    date: '2026-09-20T00:00:00',
    clientIntitule: 'STE ATLAS NEGOCE SARL',
    numero: 'RC26070369',
    pieceNumero: 'FAC-2026-001',
    reference: 'CHQ 78910',
    montantDeviseSociete: 12500.0,
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
    no: 48339,
    date: '2026-09-20T00:00:00',
    clientIntitule: 'COMPTOIR MAROCAIN SA',
    numero: 'RC26070370',
    pieceNumero: 'FAC-2026-002',
    reference: 'VIR 45678',
    montantDeviseSociete: 8750.5,
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
    no: 29721,
    date: '2026-07-27T00:00:00',
    clientIntitule: 'SOCIETE INDUSTRIELLE DU NORD',
    numero: 'RC26043514',
    pieceNumero: 'FAC-2026-003',
    reference: 'CHQ 11223',
    montantDeviseSociete: 3400.0,
    soldeDeviseSociete: 0,
    caisseNo: 1,
    banqueNo: 1,
    modeReglementNo: 1,
    isPointe: true,
    isComptabilise: 1,
    isRemis: 0,
    isAffecte: false,
    isAnnule: false,
    statut: 'Comptabilise'
  }
];

let lastRequestedNumeroFilter = null;

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
    res.end(JSON.stringify([{ id: 1, code: 'CAISSE1', intitule: 'Caisse Centrale' }]));
    return;
  }

  if (pathname === '/api/reference/banques') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([{ id: 1, code: 'AWB', intitule: 'Attijariwafa Bank' }]));
    return;
  }

  if (pathname === '/api/reference/modes' || pathname === '/api/reference/modes-reglement') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([
      { id: 1, code: 'CHQ', intitule: 'Chèque', typeNo: 1 },
      { id: 2, code: 'VIR', intitule: 'Virement', typeNo: 3 }
    ]));
    return;
  }

  if (pathname === '/api/reference/clients/count') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ count: 3 }));
    return;
  }

  if (pathname === '/api/reference/clients') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([
      { id: 1, code: 'CLI001', intitule: 'STE ATLAS NEGOCE SARL' },
      { id: 2, code: 'CLI002', intitule: 'COMPTOIR MAROCAIN SA' }
    ]));
    return;
  }

  if (pathname === '/api/reglements/distincts') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      clients: ['STE ATLAS NEGOCE SARL', 'COMPTOIR MAROCAIN SA', 'SOCIETE INDUSTRIELLE DU NORD'],
      numeros: ['RC26070369', 'RC26070370', 'RC26043514'],
      pieces: ['FAC-2026-001', 'FAC-2026-002', 'FAC-2026-003'],
      references: ['CHQ 78910', 'VIR 45678', 'CHQ 11223'],
      libelles: [],
      extraits: [],
      banqueClients: [],
      info1s: [], info2s: [], info3s: [], info4s: []
    }));
    return;
  }

  if (pathname === '/api/reglements') {
    const numeroParam = parsedUrl.searchParams.get('numero');
    lastRequestedNumeroFilter = numeroParam;

    let items = mockReglements;
    if (numeroParam) {
      const allowed = numeroParam.split('|||');
      items = mockReglements.filter(r => allowed.includes(r.numero));
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      items: items,
      total: items.length,
      page: 1,
      pageSize: 25,
      totalPages: 1
    }));
    return;
  }

  if (pathname === '/api/ReleveBancaire') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([]));
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
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
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
    console.log('\n======================================================');
    console.log('=== TEST 1 : ÉCRAN PRINCIPAL (SANS LOCALSTORAGE) ===');
    console.log('======================================================');

    await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('table', { timeout: 10000 });
    await page.waitForTimeout(500);

    // 1.1 Vérifier la liste des colonnes par défaut
    const headers = await page.$$eval('table thead th', ths => ths.map(th => th.innerText.trim()));
    console.log('Colonnes trouvées dans thead:', headers);

    const noIndex = headers.findIndex(h => h.toUpperCase().startsWith('N°'));
    const numeroIndex = headers.findIndex(h => h.toUpperCase().startsWith('NUMÉRO') || h.toUpperCase().startsWith('NUMERO'));

    console.log(`Index colonne "N°": ${noIndex}, Index colonne "Numéro": ${numeroIndex}`);

    if (noIndex === -1) {
      throw new Error('Colonne "N°" absente des colonnes par défaut !');
    }
    if (numeroIndex === -1) {
      throw new Error('Colonne "Numéro" absente des colonnes par défaut ! TASK-097 non appliquée.');
    }
    if (numeroIndex !== noIndex + 1) {
      console.warn(`Attention : "Numéro" n'est pas immédiatement après "N°" (noIndex=${noIndex}, numeroIndex=${numeroIndex})`);
    } else {
      console.log('✔ Colonne "Numéro" positionnée immédiatement après la colonne "N°".');
    }

    // 1.2 Vérifier la coexistence des données dans les cellules
    const firstRowTexts = await page.$$eval('table tbody tr:first-child td', tds => tds.map(td => td.innerText.trim()));
    console.log('Données 1ère ligne:', firstRowTexts);

    const noCell = firstRowTexts[noIndex];
    const numeroCell = firstRowTexts[numeroIndex];

    console.log(`Cellule N°: "${noCell}", Cellule Numéro: "${numeroCell}"`);

    if (!noCell.includes('48338')) {
      throw new Error(`La colonne N° devrait afficher l'identifiant technique #48338 (trouvé: "${noCell}")`);
    }
    if (!numeroCell.includes('RC26070369')) {
      throw new Error(`La colonne Numéro devrait afficher le numéro métier RC26070369 (trouvé: "${numeroCell}")`);
    }
    console.log('✔ Coexistence vérifiée : "N°" affiche #48338 (MV_Id) et "Numéro" affiche RC26070369 (MV_Numero).');

    // 1.3 Vérifier la présence du bouton de filtre sur "Numéro"
    const numeroTh = page.locator('table thead th').nth(numeroIndex);
    const filterBtn = numeroTh.locator('button[title*="Filtrer"], button[title*="Filtre"]');
    if (await filterBtn.count() === 0) {
      throw new Error('Le bouton de filtre ExcelFilter est absent sur la colonne "Numéro" !');
    }
    console.log('✔ Bouton ExcelFilter présent sur la colonne "Numéro".');

    // 1.4 Test d'ouverture et interaction avec le filtre
    console.log('Ouverture du filtre sur la colonne "Numéro"...');
    await filterBtn.click();
    await page.waitForTimeout(400);

    // Vérifier les options dans le popup ExcelFilter
    const searchInput = page.locator('input[placeholder="Rechercher..."]');
    await searchInput.waitFor({ state: 'visible', timeout: 3000 });

    const optionLabels = await page.$$eval('div[style*="max-height: 220px"] label span, div[style*="overflow-y: auto"] label span', spans => spans.map(s => s.innerText.trim()));
    console.log('Options de filtre proposées dans la liste Numéro:', optionLabels);

    if (!optionLabels.includes('RC26070369') || !optionLabels.includes('RC26070370')) {
      throw new Error(`Options distinctes attendues ('RC26070369', 'RC26070370') non trouvées dans le popup (trouvé: ${JSON.stringify(optionLabels)})`);
    }
    console.log('✔ Les numéros réels sont bien disponibles dans le filtre liste.');

    // Capture d'écran du filtre ouvert
    const verifyDir = path.resolve(__dirname, '../tasks/VERIFY');
    if (!fs.existsSync(verifyDir)) fs.mkdirSync(verifyDir, { recursive: true });

    await page.screenshot({ path: path.join(verifyDir, 'screenshot_task097_filter.png'), fullPage: false });
    console.log('✔ Capture screenshot_task097_filter.png enregistrée.');

    // Filtrer sur 'RC26070369' en cochant la case correspondante
    const rcItem = page.locator('label', { hasText: 'RC26070369' }).locator('input[type="checkbox"]');
    await rcItem.check();
    await page.waitForTimeout(400);

    // Fermer le popup
    const closeBtn = page.locator('button', { hasText: 'Fermer' });
    if (await closeBtn.count() > 0) {
      await closeBtn.click();
      await page.waitForTimeout(400);
    }

    console.log(`Dernier filtre numero reçu par l'API : "${lastRequestedNumeroFilter}"`);
    if (!lastRequestedNumeroFilter || !lastRequestedNumeroFilter.includes('RC26070369')) {
      throw new Error(`Le filtre 'RC26070369' n'a pas été transmis correctement à l'API (reçu: ${lastRequestedNumeroFilter})`);
    }

    // Vérifier le tableau filtré
    const rowCount = await page.locator('table tbody tr').count();
    console.log(`Nombre de lignes affichées après filtre: ${rowCount}`);
    if (rowCount !== 1) {
      throw new Error(`1 ligne attendue après filtrage sur RC26070369, obtenu: ${rowCount}`);
    }
    console.log('✔ Filtrage effectif : seule la ligne RC26070369 est affichée.');

    // Capture d'écran de l'écran principal filtré
    await page.screenshot({ path: path.join(verifyDir, 'screenshot_task097_main.png'), fullPage: false });
    console.log('✔ Capture screenshot_task097_main.png enregistrée.');


    console.log('\n======================================================');
    console.log('=== TEST 2 : ÉCRAN RAPPROCHEMENT BANCAIRE ===');
    console.log('======================================================');

    // Cliquer sur le menu Rapprochement Bancaire dans la barre latérale
    const rapproNav = page.locator('.sidebar-item[title*="Rapprochement"]');
    await rapproNav.click();
    await page.waitForTimeout(600);

    // Vérifier les en-têtes du tableau GRC dans l'écran de rapprochement
    const rapproHeaders = await page.$$eval('.grc-table thead th, table thead th', ths => ths.map(th => th.innerText.trim()));
    console.log('Colonnes trouvées dans Rapprochement Bancaire:', rapproHeaders);

    const hasNoInRappro = rapproHeaders.some(h => h.toUpperCase().startsWith('N°'));
    const hasNumeroInRappro = rapproHeaders.some(h => h.toUpperCase().startsWith('NUMÉRO') || h.toUpperCase().startsWith('NUMERO'));

    if (!hasNoInRappro || !hasNumeroInRappro) {
      throw new Error(`Dans Rapprochement Bancaire, N° (${hasNoInRappro}) et Numéro (${hasNumeroInRappro}) doivent être tous les deux présents par défaut !`);
    }
    console.log('✔ Coexistence dans Rapprochement Bancaire : "N°" et "Numéro" sont tous deux présents par défaut.');

    // Capture d'écran écran rapprochement
    await page.screenshot({ path: path.join(verifyDir, 'screenshot_task097_rappro.png'), fullPage: false });
    console.log('✔ Capture screenshot_task097_rappro.png enregistrée.');


    console.log('\n======================================================');
    console.log('=== TEST 3 : COMPORTEMENT AVEC PRÉFÉRENCE EXISTANTE ===');
    console.log('======================================================');

    // Simuler un profil utilisateur ayant déjà sauvegardé un jeu de colonnes (avant TASK-097)
    await page.evaluate(() => {
      localStorage.setItem('gocom_table_columns', JSON.stringify(['no', 'client', 'date', 'montant']));
    });

    // Retourner sur la vue règlements
    const reglementsNav = page.locator('.sidebar-item[title*="Règlements"]');
    await reglementsNav.click();
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('table', { timeout: 10000 });
    await page.waitForTimeout(500);

    const savedHeaders = await page.$$eval('table thead th', ths => ths.map(th => th.innerText.trim()));
    console.log('Colonnes avec préférence sauvegardée préexistante:', savedHeaders);

    const hasSavedNumero = savedHeaders.some(h => h.toUpperCase().startsWith('NUMÉRO') || h.toUpperCase().startsWith('NUMERO'));
    if (hasSavedNumero) {
      throw new Error('La préférence localStorage personnalisée a été écrasée alors qu\'elle doit être respectée.');
    }
    console.log('✔ La préférence existante en localStorage est bien respectée (Numéro n\'apparaît pas automatiquement sans action).');

    // Tester l'ajout manuel via le menu Colonnes
    const colonnesBtn = page.locator('button', { hasText: 'Colonnes' });
    await colonnesBtn.click();
    await page.waitForTimeout(300);

    // Activer la colonne Numéro
    const numeroCheckbox = page.locator('label', { hasText: 'Numéro' }).locator('input[type="checkbox"]');
    await numeroCheckbox.check();
    await page.waitForTimeout(400);

    // Vérifier que Numéro apparaît maintenant
    const updatedHeaders = await page.$$eval('table thead th', ths => ths.map(th => th.innerText.trim()));
    console.log('Colonnes après activation manuelle dans Affichage:', updatedHeaders);

    if (!updatedHeaders.some(h => h.toUpperCase().startsWith('NUMÉRO') || h.toUpperCase().startsWith('NUMERO'))) {
      throw new Error('L\'activation manuelle de "Numéro" via le menu Affichage a échoué !');
    }
    console.log('✔ L\'utilisateur existant peut activer "Numéro" via le menu Affichage sans difficulté.');

    console.log('\n======================================================');
    console.log('TOUS LES TESTS E2E TASK-097 ONT RÉUSSI AVEC SUCCÈS !');
    console.log('======================================================\n');
  } catch (err) {
    console.error('\n❌ ÉCHEC E2E TASK-097:', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
  }
}

run();
