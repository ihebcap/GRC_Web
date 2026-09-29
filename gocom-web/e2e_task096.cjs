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

let annulerCallReceived = false;
let annulerReglementNo = null;

const mockReglements = [
  {
    no: 101,
    date: '2026-09-28T00:00:00',
    clientIntitule: 'CLIENT ELIGIBLE ANNULATION',
    numero: 'REG101',
    pieceNumero: 'FAC101',
    reference: 'REF-ELIGIBLE',
    montantDeviseSociete: 1500.0,
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
    date: '2026-09-28T00:00:00',
    clientIntitule: 'CLIENT COMPTABILISE',
    numero: 'REG102',
    pieceNumero: 'FAC102',
    reference: 'REF-COMPTA',
    montantDeviseSociete: 200.0,
    soldeDeviseSociete: 0,
    caisseNo: 1,
    banqueNo: 1,
    modeReglementNo: 1,
    isPointe: false,
    isComptabilise: 1, // Non annulable
    isRemis: 0,
    isAffecte: false,
    isAnnule: false,
    statut: 'Comptabilise'
  },
  {
    no: 103,
    date: '2026-09-28T00:00:00',
    clientIntitule: 'CLIENT POINTE',
    numero: 'REG103',
    pieceNumero: 'FAC103',
    reference: 'REF-POINTE',
    montantDeviseSociete: 300.0,
    soldeDeviseSociete: 0,
    caisseNo: 1,
    banqueNo: 1,
    modeReglementNo: 1,
    isPointe: true, // Non annulable
    isComptabilise: 0,
    isRemis: 0,
    isAffecte: false,
    isAnnule: false,
    statut: 'Pointe'
  },
  {
    no: 104,
    date: '2026-09-28T00:00:00',
    clientIntitule: 'CLIENT REMIS',
    numero: 'REG104',
    pieceNumero: 'FAC104',
    reference: 'REF-REMIS',
    montantDeviseSociete: 400.0,
    soldeDeviseSociete: 0,
    caisseNo: 1,
    banqueNo: 1,
    modeReglementNo: 1,
    isPointe: false,
    isComptabilise: 0,
    isRemis: 1, // Non annulable
    isAffecte: false,
    isAnnule: false,
    statut: 'Remis'
  },
  {
    no: 105,
    date: '2026-09-28T00:00:00',
    clientIntitule: 'CLIENT AFFECTE',
    numero: 'REG105',
    pieceNumero: 'FAC105',
    reference: 'REF-AFFECTE',
    montantDeviseSociete: 500.0,
    soldeDeviseSociete: 0,
    caisseNo: 1,
    banqueNo: 1,
    modeReglementNo: 1,
    isPointe: false,
    isComptabilise: 0,
    isRemis: 0,
    isAffecte: true, // Non annulable
    isAnnule: false,
    statut: 'Affecte'
  },
  {
    no: 106,
    date: '2026-09-28T00:00:00',
    clientIntitule: 'CLIENT DEJA ANNULE',
    numero: 'REG106',
    pieceNumero: 'FAC106',
    reference: 'REF-ANNULE',
    montantDeviseSociete: 600.0,
    soldeDeviseSociete: 0,
    caisseNo: 1,
    banqueNo: 1,
    modeReglementNo: 1,
    isPointe: false,
    isComptabilise: 0,
    isRemis: 0,
    isAffecte: false,
    isAnnule: true, // Non annulable
    statut: 'Annule'
  }
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
    res.end(JSON.stringify([{ id: 1, code: 'CAISSE1', intitule: 'Caisse Principale' }]));
    return;
  }

  if (pathname === '/api/reference/banques') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([{ id: 1, code: 'BQ01', intitule: 'Banque Populaire' }]));
    return;
  }

  if (pathname === '/api/reference/modes-reglement') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([{ id: 1, code: 'CHQ', intitule: 'Chèque', typeNo: 1 }]));
    return;
  }

  if (pathname === '/api/reglements/distincts') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      clients: ['CLIENT ELIGIBLE ANNULATION', 'CLIENT COMPTABILISE', 'CLIENT POINTE'],
      numeros: ['REG101', 'REG102'],
      pieces: ['FAC101'],
      references: ['REF-ELIGIBLE'],
      libelles: [],
      extraits: [],
      banqueClients: [],
      info1s: [], info2s: [], info3s: [], info4s: []
    }));
    return;
  }

  if (pathname === '/api/reglements') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      items: mockReglements,
      total: mockReglements.length,
      page: 1,
      pageSize: 25,
      totalPages: 1
    }));
    return;
  }

  // POST /api/reglements/:id/annuler
  const annulerMatch = pathname.match(/^\/api\/reglements\/(\d+)\/annuler$/);
  if (annulerMatch && req.method === 'POST') {
    annulerCallReceived = true;
    annulerReglementNo = parseInt(annulerMatch[1], 10);
    console.log(`[API Mock] POST /api/reglements/${annulerReglementNo}/annuler reçu !`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
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

    // 1. Vérification des colonnes d'en-tête (<th>)
    console.log('\n--- 1. Vérification des en-têtes du tableau ---');
    const thHeaders = await page.$$eval('table thead th', ths => ths.map(th => th.innerText.trim()));
    console.log('En-têtes trouvés:', thHeaders);

    const hasActionsHeader = thHeaders.some(h => h.toLowerCase() === 'actions');
    if (hasActionsHeader) {
      throw new Error('La colonne "Actions" est toujours présente dans le thead ! Elle doit être supprimée.');
    }
    console.log('✔ Colonne d\'en-tête "Actions" bien supprimée de la fin du tableau.');

    // 2. Vérification des boutons dans la 1ère colonne (td:nth-child(1))
    console.log('\n--- 2. Vérification de la présence / absence du bouton Annuler selon éligibilité ---');
    
    // Ligne 1: Eligible
    const tdRow1 = page.locator('table tbody tr:nth-child(1) td:nth-child(1)');
    const editBtn1 = tdRow1.locator('button[title="Modifier le règlement"]');
    const annulerBtn1 = tdRow1.locator('button[title="Annuler le règlement"]');
    
    if (await editBtn1.count() !== 1) {
      throw new Error('Bouton Modifier manquant sur ligne 1');
    }
    if (await annulerBtn1.count() !== 1) {
      throw new Error('Bouton Annuler manquant sur ligne 1 (éligible)');
    }

    // Vérifier que le bouton Annuler est en icône seule (pas de texte visible "Annuler")
    const annulerBtnText = await annulerBtn1.innerText();
    if (annulerBtnText.trim() !== '') {
      throw new Error(`Le bouton Annuler ne doit pas contenir de texte visible ! Trouvé: "${annulerBtnText}"`);
    }
    console.log('✔ Ligne 1 (éligible) : Bouton Modifier ET Bouton Annuler (icône seule, pas de texte) présents côte à côte.');

    // Lignes 2 à 6: Non éligibles (comptabilisé, pointé, remis, affecté, déjà annulé)
    for (let r = 2; r <= 6; r++) {
      const tdRow = page.locator(`table tbody tr:nth-child(${r}) td:nth-child(1)`);
      const annulerBtn = tdRow.locator('button[title="Annuler le règlement"]');
      const count = await annulerBtn.count();
      if (count !== 0) {
        throw new Error(`Ligne ${r}: Le bouton Annuler ne doit PAS être affiché car le règlement n'est pas éligible ! (count=${count})`);
      }
      console.log(`✔ Ligne ${r} (${mockReglements[r - 1].statut}) : Bouton Annuler bien absent.`);
    }

    // 3. Test fonctionnel : Clic sur le bouton Annuler
    console.log('\n--- 3. Test fonctionnel : Clic sur Annuler et boîte de confirmation ---');
    await annulerBtn1.click();
    await page.waitForTimeout(400);

    // Vérifier la modale de confirmation
    const confirmModal = page.locator('.confirm-modal, [role="dialog"], .modal-content, .modal-backdrop');
    const bodyText = await page.evaluate(() => document.body.innerText);
    if (!bodyText.includes('Voulez-vous vraiment annuler le règlement') || !bodyText.includes('REG101')) {
      throw new Error('La modale de confirmation d\'annulation ne s\'est pas ouverte ou ne contient pas le message attendu !');
    }
    console.log('✔ Boîte de confirmation affichée avec le message attendu.');

    // Confirmer l'annulation
    const confirmBtn = page.locator('button', { hasText: 'Confirmer' }).or(page.locator('button', { hasText: 'Oui' })).or(page.locator('.btn-primary, .btn-danger')).filter({ hasText: /confirmer|oui|annuler le règlement/i }).first();
    await confirmBtn.click();
    await page.waitForTimeout(500);

    if (!annulerCallReceived || annulerReglementNo !== 101) {
      throw new Error(`L'appel API d'annulation n'a pas été reçu ou a reçu un id incorrect (attendu 101, reçu ${annulerReglementNo})`);
    }
    console.log('✔ Appel API POST /api/reglements/101/annuler bien émis et exécuté avec succès.');

    // 4. Test Rapprochement mode et vérification du colSpan de la ligne de détail
    console.log('\n--- 4. Test du mode Rapprochement et colSpan de la ligne de détail ---');
    const rapproBtn = page.locator('button', { hasText: 'Rapprocher' }).first();
    await rapproBtn.click();
    await page.waitForTimeout(400);

    // Compter le nombre réel de colonnes d'en-tête (th)
    const thCount = await page.locator('table thead th').count();
    console.log(`Nombre total de colonnes d'en-tête th: ${thCount}`);

    // Cliquer sur la première ligne pour afficher le détail rapprochement
    console.log('Sélection de la ligne 1 pour ouvrir la ligne de détail...');
    await page.locator('table tbody tr:nth-child(1)').click();
    await page.waitForTimeout(400);

    // La ligne de détail est la 2e ligne du tbody
    const detailTd = page.locator('table tbody tr:nth-child(2) td');
    const colSpan = await detailTd.getAttribute('colspan');
    console.log(`Ligne de détail: colSpan=${colSpan}, attendu=${thCount}`);

    if (parseInt(colSpan, 10) !== thCount) {
      throw new Error(`Le colSpan de la ligne de détail (${colSpan}) ne correspond pas au nombre de colonnes d'en-tête (${thCount}) !`);
    }
    console.log('✔ colSpan de la ligne de détail rapprochement rigoureusement égal au nombre de colonnes.');

    // 5. Capture d'écran du résultat
    console.log('\n--- 5. Capture d\'écran du résultat ---');
    const screenshotPath = path.resolve(__dirname, '../screenshot_task096.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`✔ Capture d'écran enregistrée: ${screenshotPath}`);

    console.log('\n========================================');
    console.log('TOUS LES TESTS E2E TASK-096 ONT REUSSI !');
    console.log('========================================\n');
  } catch (err) {
    console.error('\n❌ ECHEC E2E TASK-096:', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
  }
}

run();
