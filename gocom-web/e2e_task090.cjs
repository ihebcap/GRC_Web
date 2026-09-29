/**
 * Harnais de test E2E Playwright pour TASK-090
 * 
 * Vérifie l'expérience utilisateur complète sur RapprochementBancaire.tsx :
 * 1. Sélection d'une ligne de relevé (750 €) et d'un règlement GRC (500 €)
 * 2. Affichage de la modale / bannière de confirmation avec le nouveau libellé PO :
 *    "Attention : Les montants sélectionnés sont différents. Voulez-vous mettre à jour le montant du règlement avec celui du relevé et rapprocher ?"
 *    et le bouton "Mettre à jour le montant et rapprocher".
 * 3. Clic sur le bouton :
 *    - Vérification que la requête HTTP PUT /api/reglements/48419 n'envoie STRICTEMENT que { "montant": 750 }
 *    - Enchaînement automatique de POST /api/ReleveBancaire/reserve
 * 4. Rafraîchissement dynamique du montant dans la grille GRC locale (500,00 -> 750,00)
 * 5. Lettrage de la paire avec la lettre attribuée par le serveur.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const WWWROOT = path.resolve(__dirname, '../deploy/wwwroot');
const PORT = 3457;

if (!fs.existsSync(WWWROOT)) {
  console.error(`Dossier build introuvable: ${WWWROOT}`);
  console.error('Veuillez d\'abord compiler avec : npm run build');
  process.exit(1);
}

let capturedPutPayload = null;
let capturedPutUrl = null;
let capturedReservePayload = null;

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsedUrl.pathname;

  // Servir les fichiers statiques du build Vite
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

  // API Banques
  if (pathname === '/api/reference/banques') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([
      { id: 101, code: 'BNK01', rib: '0000111122223333' }
    ]));
    return;
  }

  // API Caisses et Modes
  if (pathname === '/api/reference/caisses' || pathname === '/api/reference/modes') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([]));
    return;
  }

  // API Règlements GRC pour l'écran de rapprochement
  if (pathname === '/api/reglements') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      items: [
        {
          no: 48419,
          date: '2026-09-28T00:00:00',
          clientCode: 'CLI001',
          clientIntitule: 'CLIENT TEST GRC SARL',
          libelle: 'VIR TEST REGLEMENT',
          montant: 500.00,
          lettrage: null,
          reservePar_UserId: null,
          caisseNo: 1,
          modeNo: 1,
          reference: 'REF-ORIG-123'
        }
      ],
      totalItems: 1
    }));
    return;
  }

  // API Relevés Bancaires (Entêtes)
  if (pathname === '/api/ReleveBancaire' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([
      {
        id: 88,
        nomFichier: 'releve_test_090.xlsx',
        dateImport: '2026-09-28T08:00:00',
        totalLignes: 1,
        soldeDepart: 1000,
        soldeFin: 1750
      }
    ]));
    return;
  }

  // API Lignes du relevé 88
  if (pathname === '/api/ReleveBancaire/88/lignes') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([
      {
        id: 5512,
        dateOperation: '2026-09-28T00:00:00',
        dateValeur: '2026-09-28T00:00:00',
        dateValeurRaw: '2026-09-28T00:00:00',
        libelle: 'VIREMENT CLIENT SARL',
        reference: 'VIR-RELEVE-750',
        code: 'VIR',
        credit: 750.00,
        lettrage: null,
        reservePar_UserId: null
      }
    ]));
    return;
  }

  // PUT /api/reglements/{id} — Mise à jour du montant
  if (pathname.startsWith('/api/reglements/') && req.method === 'PUT') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      capturedPutUrl = pathname;
      try {
        capturedPutPayload = JSON.parse(body);
      } catch (e) {
        capturedPutPayload = body;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        modified: true,
        champsModifies: ['Montant'],
        message: 'Règlement modifié avec succès.'
      }));
    });
    return;
  }

  // POST /api/ReleveBancaire/reserve — Réservation du lettrage
  if (pathname === '/api/ReleveBancaire/reserve' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        capturedReservePayload = JSON.parse(body);
      } catch (e) {
        capturedReservePayload = body;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        lettrage: 'K'
      }));
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found: ' + pathname);
});

async function run() {
  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log(`[E2E TASK-090] Serveur de simulation actif sur http://localhost:${PORT}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  // Injection de la session utilisateur
  await page.addInitScript(() => {
    sessionStorage.setItem('gocom_user', JSON.stringify({
      no: 1,
      login: 'admin',
      nom: 'Admin',
      prenom: 'User',
      societeId: 1,
      societeName: 'SOCIETE TEST SA',
      caisses: [1],
      token: 'jwt-token-test-090'
    }));
  });

  console.log('[E2E TASK-090] Chargement de l\'application dans Chromium...');
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });

  // 1. Navigation vers l'écran Rapprochement Bancaire
  console.log('[E2E TASK-090] Navigation vers l\'onglet Rapprochement...');
  const navItem = page.locator('.sidebar-item', { hasText: 'Rapprochement' });
  await navItem.click();
  await page.waitForTimeout(500);

  // 2. Sélection de la banque si nécessaire
  console.log('[E2E TASK-090] Sélection de la banque BNK01...');
  const selectBanque = page.locator('select').first();
  await selectBanque.selectOption('101');
  await page.waitForTimeout(600);

  // 3. Vérification de l'affichage initial des deux grilles
  console.log('[E2E TASK-090] Vérification des données affichées dans les grilles...');
  const releveRow = page.locator('tr', { hasText: 'VIREMENT CLIENT SARL' });
  await releveRow.waitFor({ timeout: 5000 });
  const grcRow = page.locator('tr', { hasText: 'CLIENT TEST GRC SARL' });
  await grcRow.waitFor({ timeout: 5000 });

  const initialGrcText = await grcRow.textContent();
  console.log(`[E2E TASK-090] Ligne GRC initiale : Montant attendu 500, texte = "${initialGrcText.replace(/\s+/g, ' ')}"`);
  if (!initialGrcText.includes('500')) {
    throw new Error('Montant initial de 500 non trouvé dans la ligne GRC');
  }

  // 4. Sélection des deux lignes via leur checkbox pour déclencher l'écart de montants (500 vs 750)
  console.log('[E2E TASK-090] Clic sur la checkbox GRC puis sur la checkbox Relevé...');
  await grcRow.locator('input[type="checkbox"]').click();
  await page.waitForTimeout(300);
  await releveRow.locator('input[type="checkbox"]').click();
  await page.waitForTimeout(500);

  // 5. Vérification de la modale / bannière de confirmation
  console.log('[E2E TASK-090] Vérification de la bannière d\'écart de montant...');
  const bannerTextElement = page.getByText('Attention : Les montants sélectionnés sont différents');
  await bannerTextElement.waitFor({ timeout: 3000 });

  const bannerText = await bannerTextElement.textContent();
  console.log(`[E2E TASK-090] Texte de la bannière : "${bannerText.replace(/\s+/g, ' ')}"`);

  const updateButton = page.getByRole('button', { name: 'Mettre à jour le montant et rapprocher' });
  const isButtonVisible = await updateButton.isVisible();
  console.log(`[E2E TASK-090] Bouton "Mettre à jour le montant et rapprocher" visible : ${isButtonVisible}`);
  if (!isButtonVisible) {
    throw new Error('Le bouton "Mettre à jour le montant et rapprocher" est introuvable ou mal libellé');
  }

  // Vérifier qu'aucun bouton "Forcer" n'existe plus
  const oldForcerButton = page.getByRole('button', { name: /^Forcer$/ });
  const isOldForcerVisible = await oldForcerButton.isVisible();
  console.log(`[E2E TASK-090] Ancien bouton "Forcer" visible : ${isOldForcerVisible}`);
  if (isOldForcerVisible) {
    throw new Error('L\'ancien bouton "Forcer" subsiste toujours dans la bannière !');
  }

  // Capture d'écran de la bannière
  const screenshotBannerPath = path.resolve(__dirname, '../screenshot_task090_banner.png');
  await page.screenshot({ path: screenshotBannerPath });
  console.log(`[E2E TASK-090] Capture d'écran de la bannière enregistrée : ${screenshotBannerPath}`);

  // 6. Clic sur "Mettre à jour le montant et rapprocher"
  console.log('[E2E TASK-090] Clic sur "Mettre à jour le montant et rapprocher"...');
  await updateButton.click();
  await page.waitForTimeout(800);

  // 7. Vérifications réseau du payload PUT envoyé
  console.log('[E2E TASK-090] Vérification du payload HTTP PUT /api/reglements/48419...');
  console.log(`[E2E TASK-090] PUT URL : ${capturedPutUrl}`);
  console.log(`[E2E TASK-090] PUT Payload : ${JSON.stringify(capturedPutPayload)}`);

  if (capturedPutUrl !== '/api/reglements/48419') {
    throw new Error(`URL PUT inattendue : ${capturedPutUrl}`);
  }
  if (!capturedPutPayload || capturedPutPayload.montant !== 750) {
    throw new Error(`Montant inattendu dans payload PUT : ${JSON.stringify(capturedPutPayload)}`);
  }
  const keys = Object.keys(capturedPutPayload);
  if (keys.length !== 1 || keys[0] !== 'montant') {
    throw new Error(`Le payload PUT doit contenir UNIQUEMENT la clé 'montant', trouvé: ${keys.join(',')}`);
  }
  console.log('[E2E TASK-090] PAYLOAD STRICTEMENT CONFORME : uniquement { montant: 750 }');

  // Vérification de l'enchaînement de réservation
  console.log(`[E2E TASK-090] POST Reserve Payload : ${JSON.stringify(capturedReservePayload)}`);
  if (!capturedReservePayload || capturedReservePayload.mvId !== 48419 || capturedReservePayload.ligneReleveId !== 5512) {
    throw new Error(`Payload de réservation inattendu : ${JSON.stringify(capturedReservePayload)}`);
  }
  console.log('[E2E TASK-090] Enchaînement de réservation automatique CONFIRMÉ (mvId=48419, ligneId=5512)');

  // 8. Vérification du rafraîchissement dans la grille GRC
  console.log('[E2E TASK-090] Vérification du rafraîchissement du montant affiché dans la grille GRC...');
  await page.waitForTimeout(500);
  const updatedGrcText = await grcRow.textContent();
  console.log(`[E2E TASK-090] Ligne GRC mise à jour : "${updatedGrcText.replace(/\s+/g, ' ')}"`);

  if (!updatedGrcText.includes('750')) {
    throw new Error(`Montant mis à jour (750) non affiché dans la grille GRC. Texte actuel: "${updatedGrcText}"`);
  }
  if (!updatedGrcText.includes('K')) {
    throw new Error(`Lettre de lettrage 'K' non affichée dans la grille GRC`);
  }
  console.log('[E2E TASK-090] RAFRAÎCHISSEMENT FRONT CONFIRMÉ : montant 750,00 € et lettrage K affichés !');

  // Capture d'écran après mise à jour et lettrage
  const screenshotUpdatedPath = path.resolve(__dirname, '../screenshot_task090_updated.png');
  await page.screenshot({ path: screenshotUpdatedPath });
  console.log(`[E2E TASK-090] Capture d'écran finale enregistrée : ${screenshotUpdatedPath}`);

  await browser.close();
  server.close();

  console.log('\n================================================================================');
  console.log('   RÉSULTAT TEST E2E PLAYWRIGHT TASK-090 : SUCCÈS COMPLET');
  console.log('================================================================================\n');
}

run().catch(err => {
  console.error('[E2E TASK-090] ÉCHEC :', err);
  process.exit(1);
});
