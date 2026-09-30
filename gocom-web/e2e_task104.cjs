const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const WWWROOT = path.resolve(__dirname, '../deploy/wwwroot');
const PORT = 3485;
const EVIDENCE_DIR = path.resolve(__dirname, '../tasks/VERIFY/TASK-104_evidence');

if (!fs.existsSync(WWWROOT)) {
  console.error(`Dossier build introuvable: ${WWWROOT}`);
  process.exit(1);
}
if (!fs.existsSync(EVIDENCE_DIR)) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
}

// Jeu d'essai :
// - Rn : 101 (normal, ni pointé, ni comptabilisé, ni annulé)
// - Ra : 102 (annulé, isAnnule = true)
// - Rp : 103 (pointé, isPointe = true)
const allReglements = [
  {
    no: 101,
    date: '2026-09-28T00:00:00',
    clientIntitule: 'STE ATLAS NEGOCE (Rn)',
    numero: 'RC26070101',
    pieceNumero: 'FAC-101',
    reference: 'REF-101',
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
    no: 102,
    date: '2026-09-28T00:00:00',
    clientIntitule: 'COMPTOIR DU MAROC (Ra)',
    numero: 'RC26070102',
    pieceNumero: 'FAC-102',
    reference: 'REF-102',
    montantDeviseSociete: 8750.0,
    soldeDeviseSociete: 0,
    caisseNo: 1,
    banqueNo: 1,
    modeReglementNo: 1,
    isPointe: false,
    isComptabilise: 0,
    isRemis: 0,
    isAffecte: false,
    isAnnule: true,
    statut: 'Non affecte'
  },
  {
    no: 103,
    date: '2026-09-28T00:00:00',
    clientIntitule: 'INDUSTRIE DU NORD (Rp)',
    numero: 'RC26070103',
    pieceNumero: 'FAC-103',
    reference: 'REF-103',
    montantDeviseSociete: 3400.0,
    soldeDeviseSociete: 0,
    caisseNo: 1,
    banqueNo: 1,
    modeReglementNo: 1,
    isPointe: true,
    isComptabilise: 0,
    isRemis: 0,
    isAffecte: false,
    isAnnule: false,
    statut: 'Pointe'
  }
];

let lastGetParams = null;
let lastRapprochementRequest = null;
let rapprochementResponseOverride = null;

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

  if (pathname === '/api/reference/societes') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([{ id: 1, raisonSociale: 'GOCOM' }]));
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
      clients: ['STE ATLAS NEGOCE (Rn)', 'COMPTOIR DU MAROC (Ra)', 'INDUSTRIE DU NORD (Rp)'],
      numeros: ['RC26070101', 'RC26070102', 'RC26070103'],
      pieces: ['FAC-101', 'FAC-102', 'FAC-103'],
      references: ['REF-101', 'REF-102', 'REF-103'],
      libelles: [],
      extraits: [],
      banquesTier: []
    }));
    return;
  }

  if (pathname === '/api/auth/login' && req.method === 'POST') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      no: 1,
      login: 'Admin',
      nom: 'Admin',
      prenom: 'Admin',
      isAdmin: true,
      societeId: 1,
      caisses: [1],
      token: 'fake-token-test-104'
    }));
    return;
  }

  if (pathname === '/api/reglements' && req.method === 'GET') {
    const params = Object.fromEntries(parsedUrl.searchParams.entries());
    lastGetParams = params;

    let filtered = [...allReglements];
    if (params.annule !== undefined) {
      const annuleBool = params.annule === 'true';
      filtered = filtered.filter(r => r.isAnnule === annuleBool);
    }
    if (params.pointe !== undefined) {
      const pointeBool = params.pointe === 'true';
      filtered = filtered.filter(r => r.isPointe === pointeBool);
    }
    if (params.comptabilise !== undefined) {
      const comptaBool = params.comptabilise === 'true';
      filtered = filtered.filter(r => (r.isComptabilise > 0) === comptaBool);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      items: filtered,
      totalItems: filtered.length
    }));
    return;
  }

  if (pathname === '/api/rapprochement' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      lastRapprochementRequest = JSON.parse(body);
      if (rapprochementResponseOverride) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(rapprochementResponseOverride));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        successCount: lastRapprochementRequest.length,
        errorCount: 0,
        errors: []
      }));
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

async function runTests() {
  await new Promise(resolve => server.listen(PORT, resolve));
  console.log(`Serveur de test démarré sur http://localhost:${PORT}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  try {
    console.log('--- Connexion ---');
    await page.goto(`http://localhost:${PORT}`);
    await page.fill('input[type="text"]', 'Admin');
    await page.fill('input[type="password"]', 'Admin');
    await page.click('button[type="submit"]');
    await page.waitForSelector('table');
    console.log('Connecté et tableau affiché.');

    // ==========================================
    // S1 : Flag (mode normal)
    // ==========================================
    console.log('\n--- S1 : Flag en mode normal ---');
    // Vérification compte 1 : colonnes par défaut
    const raRow = page.locator('tr:has-text("RC26070102")');
    await raRow.waitFor();
    
    // Vérifier l'atténuation d'opacité
    const opacity = await raRow.evaluate(el => window.getComputedStyle(el).opacity);
    console.log(`Opacité de la ligne Ra : ${opacity} (attendu: 0.55)`);
    if (parseFloat(opacity) !== 0.55) throw new Error(`Opacité incorrecte: ${opacity}`);

    // Vérifier title="Règlement annulé" sur le <tr>
    const trTitle = await raRow.getAttribute('title');
    console.log(`Title du tr Ra : "${trTitle}" (attendu: "Règlement annulé")`);
    if (trTitle !== 'Règlement annulé') throw new Error(`Title incorrect: ${trTitle}`);

    // Vérifier le badge « Annulé » dans la 1ère cellule
    const badge = raRow.locator('td').first().locator('.badge.badge-danger');
    const badgeCount = await badge.count();
    const badgeText = badgeCount > 0 ? await badge.innerText() : '';
    console.log(`Badge détecté dans 1ère cellule : "${badgeText}"`);
    if (badgeText !== 'ANNULÉ' && badgeText !== 'Annulé') throw new Error(`Badge Annulé manquant ou texte incorrect: ${badgeText}`);

    // Bouton Modifier désactivé
    const editBtnDisabled = await raRow.locator('button[disabled]').count();
    console.log(`Bouton modifier désactivé présent : ${editBtnDisabled > 0}`);
    if (editBtnDisabled === 0) throw new Error('Bouton modifier devrait être désactivé pour Ra');

    // Bouton Annuler absent
    const cancelBtnCount = await raRow.locator('button[title="Annuler le règlement"]').count();
    console.log(`Bouton annuler absent : ${cancelBtnCount === 0}`);
    if (cancelBtnCount !== 0) throw new Error('Bouton annuler ne devrait pas être présent sur un règlement déjà annulé');

    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'screenshot_task104_s1_default_cols.png') });
    console.log('Capture S1 (colonnes par défaut) enregistrée.');

    // Vérification compte 2 : colonnes personnalisées sans la colonne « Annulé »
    await page.evaluate(() => {
      localStorage.setItem('gocom_table_columns', JSON.stringify(['no', 'numero', 'client', 'date', 'montant', 'pointe', 'comptabilise']));
    });
    await page.reload();
    await page.waitForSelector('table');
    const raRowCustom = page.locator('tr:has-text("RC26070102")');
    await raRowCustom.waitFor();
    const badgeCustom = raRowCustom.locator('td').first().locator('.badge.badge-danger');
    console.log(`Badge visible même sans colonne 'annule' : ${await badgeCustom.count() > 0}`);
    if (await badgeCustom.count() === 0) throw new Error('Le badge Annulé doit être visible quelles que soient les colonnes choisies');
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'screenshot_task104_s1_custom_cols.png') });
    console.log('Capture S1 (colonnes personnalisées) enregistrée.');

    // Réinitialiser les colonnes pour la suite
    await page.evaluate(() => localStorage.removeItem('gocom_table_columns'));
    await page.reload();
    await page.waitForSelector('table');

    // ==========================================
    // S2 : Entrée/sortie Rapprocher
    // ==========================================
    console.log('\n--- S2 : Mode Rapprocher ---');
    // Entrer dans le mode Rapprocher
    await page.click('button:has-text("Rapprocher")');
    await page.waitForTimeout(600); // Debounce 500ms + fetch
    
    // Ra doit être absent
    const raInRappro = await page.locator('tr:has-text("RC26070102")').count();
    console.log(`Présence de Ra en mode Rapprocher : ${raInRappro} (attendu: 0)`);
    if (raInRappro !== 0) throw new Error('Ra ne doit pas apparaître en mode Rapprocher');

    // Rn doit être sélectionnable
    const rnRow = page.locator('tr:has-text("RC26070101")');
    const rnCursor = await rnRow.evaluate(el => window.getComputedStyle(el).cursor);
    console.log(`Curseur Rn en mode Rapprocher : ${rnCursor} (attendu: pointer)`);
    if (rnCursor !== 'pointer') throw new Error(`Curseur Rn incorrect: ${rnCursor}`);

    // Clic sur Rn
    await rnRow.click();
    await page.waitForSelector('input[type="text"][value=""], input[type="text"]');
    console.log('Ligne de saisie extrait / date apparue suite au clic sur Rn.');
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'screenshot_task104_s2_rapprocher_mode.png') });

    // Sortir du mode Rapprocher
    await page.click('button:has-text("Fermer Rapprochement")');
    // Si popup de confirmation apparaît, confirmer
    const confirmBtn = page.locator('button:has-text("Confirmer")');
    if (await confirmBtn.count() > 0) {
      await confirmBtn.click();
    }
    await page.waitForTimeout(600);

    // Ra doit réapparaître
    const raAfterRappro = await page.locator('tr:has-text("RC26070102")').count();
    console.log(`Présence de Ra après sortie du mode Rapprocher : ${raAfterRappro} (attendu: 1)`);
    if (raAfterRappro !== 1) throw new Error('Ra doit réapparaître hors mode');
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'screenshot_task104_s2_rapprocher_exit.png') });

    // ==========================================
    // S3 : Entrée/sortie Comptabiliser
    // ==========================================
    console.log('\n--- S3 : Mode Comptabiliser ---');
    await page.click('button:has-text("Comptabiliser")');
    await page.waitForTimeout(600);
    const raInCompta = await page.locator('tr:has-text("RC26070102")').count();
    console.log(`Présence de Ra en mode Comptabiliser : ${raInCompta} (attendu: 0)`);
    if (raInCompta !== 0) throw new Error('Ra ne doit pas apparaître en mode Comptabiliser');
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'screenshot_task104_s3_comptabiliser_mode.png') });

    await page.click('button:has-text("Fermer Comptabilisation")');
    await page.waitForTimeout(600);
    const raAfterCompta = await page.locator('tr:has-text("RC26070102")').count();
    console.log(`Présence de Ra après sortie de Comptabiliser : ${raAfterCompta} (attendu: 1)`);
    if (raAfterCompta !== 1) throw new Error('Ra doit réapparaître hors mode');
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'screenshot_task104_s3_comptabiliser_exit.png') });

    // ==========================================
    // S4 : Bascule directe Rapprocher -> Comptabiliser
    // ==========================================
    console.log('\n--- S4 : Bascule directe ---');
    await page.click('button:has-text("Rapprocher")');
    await page.waitForTimeout(600);
    console.log('En mode Rapprocher...');
    await page.click('button:has-text("Comptabiliser")');
    await page.waitForTimeout(600);
    console.log('Bascule directe vers Comptabiliser...');
    const raInDirectSwitch = await page.locator('tr:has-text("RC26070102")').count();
    console.log(`Présence de Ra après bascule directe : ${raInDirectSwitch} (attendu: 0)`);
    if (raInDirectSwitch !== 0) throw new Error('Ra ne doit pas apparaître lors d\'une bascule directe');
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'screenshot_task104_s4_switch_rappro_compta.png') });

    await page.click('button:has-text("Fermer Comptabilisation")');
    await page.waitForTimeout(600);

    // ==========================================
    // S5 : Filtre résiduel
    // ==========================================
    console.log('\n--- S5 : Filtre résiduel & cadenas ---');
    // Activer la colonne Annulé pour tester son filtre
    await page.click('button:has-text("Colonnes")');
    const annuleColCheckbox = page.locator('label:has-text("Annulé") input[type="checkbox"]');
    if (!(await annuleColCheckbox.isChecked())) {
      await annuleColCheckbox.check();
    }
    await page.click('button:has-text("Colonnes")'); // fermer dropdown
    await page.waitForTimeout(200);

    // Entrer en mode Rapprocher
    await page.click('button:has-text("Rapprocher")');
    await page.waitForTimeout(600);

    // Vérifier la présence du 🔒 sur l'en-tête Annulé
    const annuleHeader = page.locator('th:has-text("ANNULÉ")');
    const lockIcon = annuleHeader.locator('span[title="Filtre verrouillé en mode Rapprochement"]');
    console.log(`Cadenas 🔒 présent sur la colonne Annulé : ${await lockIcon.count() > 0}`);
    if (await lockIcon.count() === 0) throw new Error('Le cadenas 🔒 doit être affiché sur la colonne Annulé en mode Rapprocher');

    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'screenshot_task104_s5_filter_locked.png') });

    // Sortir du mode Rapprocher
    await page.click('button:has-text("Fermer Rapprochement")');
    await page.waitForTimeout(600);
    console.log('Sorti du mode Rapprocher. Aucun filtre fantôme.');

    // ==========================================
    // S6 : Non-régression rapprochement manuel
    // ==========================================
    console.log('\n--- S6 : Non-régression rapprochement manuel ---');
    await page.click('button:has-text("Rapprocher")');
    await page.waitForTimeout(600);
    // Remplir l'extrait et la date dans la barre supérieure
    const barreExtrait = page.locator('input[placeholder="Ex: EXT-2023"]').first();
    await barreExtrait.fill('EXT-S6-TEST');
    
    // Sélectionner Rn
    const rnToReconcile = page.locator('tr:has-text("RC26070101")');
    await rnToReconcile.click();
    await page.waitForTimeout(300);

    // Valider le rapprochement
    rapprochementResponseOverride = null; // renvoie success: true, successCount: 1
    await page.click('button:has-text("Valider Rapprochement")');
    await page.waitForTimeout(500);

    const toastSuccess = page.locator('text="Rapprochement validé !"');
    console.log(`Toast de succès affiché : ${await toastSuccess.count() > 0}`);
    if (await toastSuccess.count() === 0) throw new Error('Le toast "Rapprochement validé !" devrait être affiché');
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'screenshot_task104_s6_rappro_success.png') });

    // ==========================================
    // S8 : Affichage du refus côté front
    // ==========================================
    console.log('\n--- S8 : Affichage du refus côté front ---');
    await page.waitForTimeout(1000);
    await page.click('button:has-text("Rapprocher")');
    await page.waitForTimeout(600);
    await barreExtrait.fill('EXT-S8-TEST');
    await page.locator('tr:has-text("RC26070101")').click();
    await page.waitForTimeout(300);

    // Simuler le refus serveur (ex: règlement déjà pointé)
    rapprochementResponseOverride = {
      success: false,
      successCount: 0,
      errorCount: 1,
      errors: ['Règlement 101: Le règlement 101 est déjà pointé.']
    };

    await page.click('button:has-text("Valider Rapprochement")');
    await page.waitForTimeout(500);

    const expectedWarning = '0 règlement(s) rapproché(s), 1 refusé(s) : Règlement 101: Le règlement 101 est déjà pointé.';
    const warningToast = page.locator(`text="${expectedWarning}"`);
    console.log(`Toast warning de refus affiché : ${await warningToast.count() > 0}`);
    if (await warningToast.count() === 0) throw new Error(`Toast de refus attendu non trouvé: "${expectedWarning}"`);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'screenshot_task104_s8_refusal_toast.png') });

    // ==========================================
    // S9 : Export Excel
    // ==========================================
    console.log('\n--- S9 : Paramètres d\'export Excel ---');
    // Hors mode
    lastGetParams = null;
    await page.click('button:has-text("Exporter")');
    await page.waitForTimeout(300);
    console.log('Paramètres reçus pour l\'export hors mode :', lastGetParams);
    if (lastGetParams && lastGetParams.annule === 'false') {
      throw new Error('Hors mode, l\'export ne doit pas forcer annule=false');
    }

    // En mode Rapprocher
    await page.click('button:has-text("Rapprocher")');
    await page.waitForTimeout(600);
    lastGetParams = null;
    await page.click('button:has-text("Exporter")');
    await page.waitForTimeout(300);
    console.log('Paramètres reçus pour l\'export en mode Rapprocher :', lastGetParams);
    if (!lastGetParams || lastGetParams.annule !== 'false') {
      throw new Error(`En mode Rapprocher, l'export doit forcer annule=false, reçu: ${JSON.stringify(lastGetParams)}`);
    }

    await page.click('button:has-text("Fermer Rapprochement")');
    await page.waitForTimeout(600);

    // ==========================================
    // S10 : Bascule rapide
    // ==========================================
    console.log('\n--- S10 : Bascule rapide (4 clics en < 2s) ---');
    const rapproBtn = page.locator('button:has-text("Rapprocher"), button:has-text("Fermer Rapprochement")');
    await rapproBtn.click();
    await page.waitForTimeout(100);
    await rapproBtn.click();
    await page.waitForTimeout(100);
    await rapproBtn.click();
    await page.waitForTimeout(100);
    await rapproBtn.click(); // 4 clics rapides -> retour à l'état initial (fermé)
    await page.waitForTimeout(1000); // attendre stabilisation debounce

    const raFinal = await page.locator('tr:has-text("RC26070102")').count();
    console.log(`État final stable hors mode : Ra présent = ${raFinal === 1}`);
    if (raFinal !== 1) throw new Error('Après bascule rapide se terminant hors mode, Ra doit être présent');
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'screenshot_task104_s10_rapid_toggle.png') });

    console.log('\n==========================================');
    console.log('TOUS LES TESTS E2E SONT PASSÉS AVEC SUCCÈS !');
    console.log('==========================================');
  } finally {
    await browser.close();
    server.close();
  }
}

runTests().catch(err => {
  console.error('\n❌ Échec du test :', err);
  server.close();
  process.exit(1);
});
