const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const WWWROOT = path.resolve(__dirname, '../deploy/wwwroot');
const PORT = 3466;

const mockCaisses = [
  { id: 1, code: 'CAISSE1', intitule: 'Caisse Principale' },
  { id: 2, code: 'CAISSE2', intitule: 'Caisse Secondaire' }
];

const mockBanques = [
  { id: 1, code: 'BQ01', rib: '12345678901', intitule: 'Banque Populaire' }
];

const mockModes = [
  { id: 1, code: 'CHQ', intitule: 'Chèque', typeNo: 1 },
  { id: 2, code: 'VIR', intitule: 'Virement', typeNo: 2 },
  { id: 3, code: 'ESP', intitule: 'Espèces', typeNo: 3 }
];

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
    res.end(JSON.stringify(mockCaisses));
    return;
  }

  if (pathname === '/api/reference/banques') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(mockBanques));
    return;
  }

  if (pathname === '/api/reference/modes-reglement' || pathname === '/api/reference/modes') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(mockModes));
    return;
  }

  if (pathname === '/api/releves') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([]));
    return;
  }

  if (pathname === '/api/reglements/distincts') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      clients: ['CLIENT 1'], numeros: ['REG101'], pieces: ['FAC101'],
      references: ['REF1'], libelles: [], extraits: [], banqueClients: [],
      info1s: [], info2s: [], info3s: [], info4s: []
    }));
    return;
  }

  if (pathname === '/api/reglements') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      items: [],
      total: 0,
      page: 1,
      pageSize: 25,
      totalPages: 1
    }));
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

  await page.addInitScript(() => {
    sessionStorage.setItem('gocom_user', JSON.stringify({
      no: 1,
      login: 'admin',
      nom: 'Admin',
      prenom: 'User',
      societeId: 1,
      societeName: 'SOCIETE TEST SA',
      caisses: [1, 2],
      isAdmin: true,
      token: 'fake-token'
    }));
  });

  page.on('console', msg => {
    if (msg.type() === 'error') console.log('[Browser Error]', msg.text());
  });

  try {
    console.log('Chargement de l\'application...');
    await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);

    // 1. Mesure de référence sur l'écran Rapprochement bancaire (.rappro-toolbar)
    console.log('\n--- 1. Référence Rapprochement bancaire (.rappro-toolbar) ---');
    const rapproMenu = page.locator('.sidebar-item', { hasText: 'Rapprochement' });
    await rapproMenu.click();
    await page.waitForTimeout(500);

    const rapproToolbar = page.locator('.rappro-toolbar');
    const rapproBox = await rapproToolbar.boundingBox();
    console.log(`Hauteur de référence .rappro-toolbar : ${rapproBox.height}px (width: ${rapproBox.width}px)`);

    // 2. Navigation vers Comptabilisation et mesure de la nouvelle barre .apercu-toolbar
    console.log('\n--- 2. Mesure de la nouvelle barre .apercu-toolbar ---');
    const comptaMenu = page.locator('.sidebar-item', { hasText: 'Comptabilisation' });
    await comptaMenu.click();
    await page.waitForTimeout(600);

    const apercuToolbar = page.locator('.apercu-toolbar');
    if (await apercuToolbar.count() !== 1) {
      throw new Error('La classe .apercu-toolbar n\'a pas été trouvée sur l\'écran Comptabilisation !');
    }

    const apercuBox = await apercuToolbar.boundingBox();
    console.log(`Nouvelle hauteur .apercu-toolbar : ${apercuBox.height}px (width: ${apercuBox.width}px)`);

    // Vérification que la hauteur est proche de .rappro-toolbar (cible ~40-48px)
    if (apercuBox.height > 52) {
      throw new Error(`La barre .apercu-toolbar est trop haute (${apercuBox.height}px) ! Attendu <= 50px`);
    }
    console.log(`✔ Hauteur de la barre compactée validée : ${apercuBox.height}px (vs ${rapproBox.height}px sur Rapprochement, avant: 114.5px).`);

    // 3. Vérification des éléments de la barre
    console.log('\n--- 3. Vérification des contrôles de filtre compactés ---');
    
    // Titre / icône filtre
    const titleText = await page.locator('.apercu-toolbar-title').innerText();
    console.log(`Titre barre : "${titleText.trim()}"`);
    if (!titleText.includes('Filtres de simulation')) {
      throw new Error('Titre Filtres de simulation manquant');
    }

    // Dropdowns
    const dropdowns = page.locator('.apercu-toolbar .apercu-dropdown');
    const ddCount = await dropdowns.count();
    console.log(`Nombre de CheckboxDropdown trouvés : ${ddCount} (attendu: 2)`);
    if (ddCount !== 2) throw new Error(`Nombre de dropdowns incorrect: ${ddCount}`);

    const ddCaissesBox = await dropdowns.nth(0).boundingBox();
    console.log(`Largeur du dropdown Caisses : ${ddCaissesBox.width}px (attendu ~175px, avant: 220px)`);
    if (ddCaissesBox.width > 185) {
      throw new Error(`Le dropdown Caisses est trop large (${ddCaissesBox.width}px) !`);
    }

    // Date inputs
    const dateInputs = page.locator('.apercu-toolbar-date');
    const dateCount = await dateInputs.count();
    console.log(`Champs date trouvés : ${dateCount} (attendu: 2)`);
    if (dateCount !== 2) throw new Error(`Nombre de champs date incorrect: ${dateCount}`);

    // Select Rapproché
    const selectRapproche = page.locator('.apercu-toolbar-select');
    const isSelectDisabled = await selectRapproche.isDisabled();
    const selectVal = await selectRapproche.inputValue();
    console.log(`Sélecteur Rapproché : disabled=${isSelectDisabled}, valeur=${selectVal}`);
    if (!isSelectDisabled || selectVal !== 'oui') {
      throw new Error('Sélecteur Rapproché doit être verrouillé à "oui"');
    }

    // Bouton Générer l'Aperçu
    const btnSimuler = page.locator('.apercu-toolbar-btn');
    const btnText = await btnSimuler.innerText();
    console.log(`Bouton d'action : "${btnText.trim()}"`);
    if (!btnText.includes('Générer l\'Aperçu')) {
      throw new Error('Bouton Générer l\'Aperçu non trouvé');
    }

    // 4. Test fonctionnel de CheckboxDropdown (recherche, sélection, clic extérieur)
    console.log('\n--- 4. Test fonctionnel de CheckboxDropdown ---');
    const ddCaissesTrigger = dropdowns.nth(0).locator('.apercu-dropdown-trigger');
    
    // Ouvrir le dropdown
    await ddCaissesTrigger.click();
    await page.waitForTimeout(300);
    
    const panel = dropdowns.nth(0).locator('.apercu-dropdown-panel');
    if (await panel.count() !== 1 || !(await panel.isVisible())) {
      throw new Error('Le panneau du dropdown ne s\'est pas ouvert au clic !');
    }
    console.log('✔ Panneau dropdown ouvert avec succès.');

    // Tester la recherche
    const searchInput = panel.locator('.apercu-dropdown-search-input');
    await searchInput.fill('Principale');
    await page.waitForTimeout(200);

    const visibleItems = panel.locator('.apercu-dropdown-item');
    const itemCount = await visibleItems.count();
    console.log(`Éléments filtrés par recherche "Principale" : ${itemCount} (attendu: 1)`);
    if (itemCount !== 1) {
      throw new Error(`Recherche dropdown inopérante: ${itemCount} éléments trouvés au lieu de 1`);
    }

    // Effacer la recherche
    await searchInput.fill('');
    await page.waitForTimeout(200);

    // Tester "TOUT SÉLECTIONNER"
    const toggleAll = panel.locator('.apercu-dropdown-toggle-all');
    await toggleAll.click();
    await page.waitForTimeout(200);

    const triggerTextAfterAll = await ddCaissesTrigger.innerText();
    console.log(`Texte après Tout sélectionner : "${triggerTextAfterAll.trim()}"`);
    if (!triggerTextAfterAll.includes('Tous sélectionnés')) {
      throw new Error(`Attendu "Tous sélectionnés", reçu "${triggerTextAfterAll}"`);
    }
    console.log('✔ Tout sélectionner fonctionne correctement.');

    // Clic extérieur pour fermer
    await page.locator('.apercu-toolbar-title').click();
    await page.waitForTimeout(300);
    const isPanelStillOpen = await panel.isVisible().catch(() => false);
    if (isPanelStillOpen) {
      throw new Error('Le dropdown ne s\'est pas fermé au clic extérieur !');
    }
    console.log('✔ Fermeture au clic extérieur validée.');

    // 5. Capture d'écran finale
    console.log('\n--- 5. Capture d\'écran AFTER ---');
    const screenshotPath = path.resolve(__dirname, '../screenshot_task095.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`✔ Capture d'écran enregistrée: ${screenshotPath}`);

    console.log('\n========================================');
    console.log('TOUS LES TESTS E2E TASK-095 ONT REUSSI !');
    console.log(`Hauteur initiale : 114.5px`);
    console.log(`Hauteur finale   : ${apercuBox.height}px`);
    console.log(`Référence        : ${rapproBox.height}px`);
    console.log('========================================\n');

  } catch (err) {
    console.error('\n❌ ECHEC E2E TASK-095:', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
  }
}

run();
