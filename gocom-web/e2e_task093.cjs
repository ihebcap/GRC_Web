const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const WWWROOT = path.resolve(__dirname, '../deploy/wwwroot');
const PORT = 3459;

if (!fs.existsSync(WWWROOT)) {
  console.error(`Dossier build introuvable: ${WWWROOT}`);
  process.exit(1);
}

const mockReglements = [
  {
    no: 101,
    date: '2026-09-28T00:00:00',
    clientIntitule: 'CLIENT EDITABLE',
    numero: 'REG101',
    pieceNumero: 'FAC101',
    reference: 'REF-EDITABLE',
    montantDeviseSociete: 100.0,
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
    isComptabilise: 1, // Bloqué comptabilisé
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
    isPointe: true, // Bloqué pointé
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
    isRemis: 1, // Bloqué remis
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
    isAffecte: true, // Bloqué affecté
    isAnnule: false,
    statut: 'Affecte'
  },
  {
    no: 106,
    date: '2026-09-28T00:00:00',
    clientIntitule: 'CLIENT ANNULE',
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
    isAnnule: true, // Bloqué annulé
    statut: 'Annule'
  },
  {
    no: 107,
    date: '2026-09-28T00:00:00',
    clientIntitule: 'CLIENT COMPTA ET POINTE',
    numero: 'REG107',
    pieceNumero: 'FAC107',
    reference: 'REF-MULTI',
    montantDeviseSociete: 700.0,
    soldeDeviseSociete: 0,
    caisseNo: 1,
    banqueNo: 1,
    modeReglementNo: 1,
    isPointe: true, // Bloqué pointé ET comptabilisé
    isComptabilise: 1,
    isRemis: 0,
    isAffecte: false,
    isAnnule: false,
    statut: 'Comptabilise et pointe'
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
      clients: mockReglements.map(r => r.clientIntitule),
      numeros: mockReglements.map(r => r.numero),
      pieces: mockReglements.map(r => r.pieceNumero),
      references: mockReglements.map(r => r.reference),
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
    res.end(JSON.stringify({ items: mockReglements, totalItems: mockReglements.length }));
    return;
  }

  if (pathname.startsWith('/api/reglements/') && (pathname.endsWith('/history') || pathname.endsWith('/historique'))) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([
      { id: 1, reglementNo: 101, typeAction: 'MODIFICATION', champModifie: 'Montant', ancienneValeur: '90', nouvelleValeur: '100', modifiePar: 'admin', dateModification: '2026-09-28T12:00:00' }
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

    // Vérification de chaque ligne pour les indices visuels
    const expectedCases = [
      {
        rowIdx: 1,
        id: 101,
        desc: 'Éligible (aucun blocage)',
        disabled: false,
        expectedTitle: 'Modifier le règlement'
      },
      {
        rowIdx: 2,
        id: 102,
        desc: 'Comptabilisé',
        disabled: true,
        expectedTitle: 'Modification impossible : règlement comptabilisé'
      },
      {
        rowIdx: 3,
        id: 103,
        desc: 'Pointé',
        disabled: true,
        expectedTitle: 'Modification impossible : règlement pointé'
      },
      {
        rowIdx: 4,
        id: 104,
        desc: 'Remis en banque',
        disabled: true,
        expectedTitle: 'Modification impossible : règlement remis en banque'
      },
      {
        rowIdx: 5,
        id: 105,
        desc: 'Affecté',
        disabled: true,
        expectedTitle: 'Modification impossible : règlement affecté'
      },
      {
        rowIdx: 6,
        id: 106,
        desc: 'Annulé',
        disabled: true,
        expectedTitle: 'Modification impossible : règlement annulé'
      },
      {
        rowIdx: 7,
        id: 107,
        desc: 'Comptabilisé et pointé (multiple)',
        disabled: true,
        expectedTitle: 'Modification impossible : règlement comptabilisé, règlement pointé'
      }
    ];

    for (const testCase of expectedCases) {
      console.log(`Vérification ligne ${testCase.rowIdx} (${testCase.desc})...`);
      const rowTd = await page.locator(`table tbody tr:nth-child(${testCase.rowIdx}) td:nth-child(1)`);
      const button = rowTd.locator('button').first();
      
      const isDisabled = await button.isDisabled();
      if (isDisabled !== testCase.disabled) {
        throw new Error(`Ligne ${testCase.rowIdx}: attendu disabled=${testCase.disabled}, reçu=${isDisabled}`);
      }

      // Title peut être sur le bouton lui-même (si actif) ou sur le span parent / bouton (si désactivé)
      const buttonTitle = await button.getAttribute('title');
      const spanTitle = await rowTd.locator('span').getAttribute('title').catch(() => null);
      const effectiveTitle = spanTitle || buttonTitle;

      console.log(`  -> disabled=${isDisabled}, title="${effectiveTitle}"`);
      if (effectiveTitle !== testCase.expectedTitle) {
        throw new Error(`Ligne ${testCase.rowIdx}: attendu title="${testCase.expectedTitle}", reçu="${effectiveTitle}"`);
      }
    }

    // Tester le clic sur bouton désactivé (ligne 2) : ne doit PAS ouvrir de modale
    console.log('Test clic sur bouton désactivé (ligne 2)...');
    await page.click('table tbody tr:nth-child(2) td:nth-child(1)');
    await page.waitForTimeout(300);
    let bodyText = await page.evaluate(() => document.body.innerText);
    if (bodyText.includes('Modifier le règlement') || bodyText.includes('Date règlement')) {
      throw new Error('La modale Modifier ne doit PAS s\'ouvrir au clic sur un bouton désactivé');
    }

    // Tester le clic sur bouton actif (ligne 1) : DOIT ouvrir la modale
    console.log('Test clic sur bouton actif (ligne 1)...');
    await page.click('table tbody tr:nth-child(1) td:nth-child(1) button[title="Modifier le règlement"]');
    await page.waitForTimeout(500);
    bodyText = await page.evaluate(() => document.body.innerText);
    if (!bodyText.includes('Modifier le règlement')) {
      throw new Error('La modale Modifier doit s\'ouvrir au clic sur le bouton actif');
    }

    // Fermer la modale
    const closeBtn = page.locator('button', { hasText: 'Annuler' }).last();
    if (await closeBtn.isVisible()) await closeBtn.click();
    await page.waitForTimeout(400);

    // Capture d'écran pour preuve dans le rapport
    const screenshotPath = path.resolve(__dirname, '../screenshot_task093.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`Capture d'écran enregistrée: ${screenshotPath}`);

    console.log('\n========================================');
    console.log('TOUS LES TESTS E2E TASK-093 ONT REUSSI !');
    console.log('========================================\n');
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch(err => {
  console.error('ECHEC E2E TASK-093:', err);
  process.exit(1);
});
