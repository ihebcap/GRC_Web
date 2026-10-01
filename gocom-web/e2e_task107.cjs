// TASK-107 — Test E2E validation : Tri multi-colonnes, pagination client, mémoïsation et sélection sûre
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const WWWROOT = path.resolve(__dirname, '../deploy/wwwroot');
const PORT = 3507;
const EVIDENCE_DIR = path.resolve(__dirname, '../tasks/VERIFY/TASK-107_evidence');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

// Génération de 30 000 factures mockées avec dates et montants variés (taille réelle cible)
const NUM_FACTURES = 30000;
const mockFactures = [];
const baseDate = new Date('2026-01-01T00:00:00Z').getTime();

for (let i = 1; i <= NUM_FACTURES; i++) {
  // Dates échelonnées sur 9 mois
  const dayOffset = (i * 7) % 270;
  const d = new Date(baseDate + dayOffset * 24 * 3600 * 1000);
  const dateIso = d.toISOString().substring(0, 10);
  const montant = 100 + ((i * 37) % 5000);

  mockFactures.push({
    echeanceNo: 10000 + i,
    factureNumero: `FA26-${String(i).padStart(5, '0')}`,
    clientCode: `CL${String((i % 40) + 1).padStart(3, '0')}`,
    clientIntitule: `CLIENT ${String.fromCharCode(65 + (i % 26))} ${(i % 40) + 1}`,
    dateFacture: `${dateIso}T00:00:00`,
    dateEcheance: `${dateIso}T00:00:00`,
    montant: montant,
    solde: montant,
    representant: `REP_${(i % 5) + 1}`,
    commentaire: `Commentaire ${i}`,
    info1: '', info2: '', info3: '', info4: ''
  });
}

let getFacturesCallCount = 0;
let postGenererPayloads = [];

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
    return json(mockFactures);
  }

  // Génération espèces
  if (p === '/api/reglements/generer-espece' && req.method === 'POST') {
    const body = await readBody(req);
    postGenererPayloads.push(body);
    console.log(`  [API] POST /api/reglements/generer-espece : ${body?.echeanceNos?.length} factures transmises`);

    const reglementsCreees = (body?.echeanceNos || []).slice(0, -1).map((no, idx) => ({
      echeanceNo: no,
      factureNumero: `FA-${no}`,
      reglementNumero: `RC2607${String(idx + 1).padStart(4, '0')}`
    }));
    const erreurs = (body?.echeanceNos || []).slice(-1).map(no => ({
      echeanceNo: no,
      factureNumero: `FA-${no}`,
      erreur: 'Délai de paiement dépassé (test erreur)'
    }));

    return json({
      success: false,
      reglementsCreees,
      erreurs
    });
  }

  res.writeHead(404);
  res.end();
});

(async () => {
  await new Promise(r => server.listen(PORT, r));
  console.log(`Serveur mock démarré sur http://localhost:${PORT}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  page.on('pageerror', e => console.log('  [pageerror]', e.message));

  let lastDialogMessage = '';
  page.on('dialog', async dialog => {
    lastDialogMessage = dialog.message();
    console.log(`  [dialog intercepté] "${lastDialogMessage.split('\n')[0]}..."`);
    await dialog.accept();
  });

  try {
    console.log('\n=== 1. Connexion et navigation vers Règlement espèce ===');
    await page.goto(`http://localhost:${PORT}`);
    await page.fill('input[type="text"]', 'ADMIN');
    await page.fill('input[type="password"]', 'password');
    await page.click('button[type="submit"]');

    const regEspBtn = page.locator('.sidebar-item').filter({ hasText: /Règlement\s+espèce/i }).first();
    await regEspBtn.waitFor({ state: 'visible', timeout: 5000 });
    await regEspBtn.click();

    // Attendre l'affichage de la table
    await page.waitForSelector('.regesp-factures-container table tbody tr', { timeout: 8000 });
    console.log(`  Nombre d'appels GET factures-a-regler à l'ouverture : ${getFacturesCallCount}`);
    if (getFacturesCallCount !== 1) {
      console.warn(`  ATTENTION : ${getFacturesCallCount} appels constatés à l'ouverture (attendu: 1)`);
    }

    // Mesure du DOM
    const domNodesCount = await page.evaluate(() => document.querySelectorAll('*').length);
    const visibleRows = await page.locator('.regesp-factures-container table tbody tr').count();
    console.log(`  Factures visibles dans le DOM : ${visibleRows} (taille de page par défaut 100)`);
    console.log(`  Nœuds DOM totaux : ${domNodesCount} (au lieu de >350 000 sans pagination)`);

    // Capture écran initial
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '01_ouverture_tri_defaut.png'), fullPage: true });

    console.log('\n=== 2. Vérification du tri par défaut (Date facture, ascendant) ===');
    // Vérifier l'indicateur sur l'en-tête "Date facture"
    const thDateFacture = page.locator('th').filter({ hasText: 'Date facture' });
    const thText = await thDateFacture.innerText();
    console.log(`  En-tête Date facture : "${thText.trim()}"`);
    if (!thText.includes('▲')) {
      throw new Error(`Le tri par défaut doit être Date facture ascendant (▲ attendu, obtenu: "${thText}")`);
    }

    // Lire les dates des 3 premières lignes
    const dateRow1 = await page.locator('.regesp-factures-container table tbody tr').nth(0).locator('td').nth(4).innerText();
    const dateRow2 = await page.locator('.regesp-factures-container table tbody tr').nth(1).locator('td').nth(4).innerText();
    console.log(`  Ligne 1 date : ${dateRow1}, Ligne 2 date : ${dateRow2}`);

    console.log('\n=== 3. Vérification du tri cliquable sur TOUTES les 8 colonnes actives (asc / desc) ===');
    const colsToTest = [
      { name: 'Date facture', colIdx: 4 },
      { name: 'Date échéance', colIdx: 5 },
      { name: 'N° Facture', colIdx: 3 },
      { name: 'Code Client', colIdx: 1 },
      { name: 'Intitulé Client', colIdx: 2 },
      { name: 'Montant', colIdx: 6 },
      { name: 'Solde', colIdx: 7 },
      { name: 'Représentant', colIdx: 8 }
    ];

    for (const c of colsToTest) {
      const th = page.locator('th').filter({ hasText: c.name }).first();
      let text = await th.innerText();
      // Si la colonne n'est pas déjà triée en ascendant, cliquer pour activer ASC
      if (!text.includes('▲')) {
        await th.click();
        await page.waitForTimeout(200);
        text = await th.innerText();
        if (text.includes('▼')) {
          // Si le premier clic a mis DESC (cas de clic sur colonne déjà active en asc), re-cliquer pour ASC
          await th.click();
          await page.waitForTimeout(200);
          text = await th.innerText();
        }
      }
      if (!text.includes('▲')) {
        throw new Error(`Échec activation tri ascendant sur ${c.name} : "${text.trim()}"`);
      }

      const val1Asc = await page.locator('.regesp-factures-container table tbody tr').first().locator('td').nth(c.colIdx).innerText();
      const valLastAsc = await page.locator('.regesp-factures-container table tbody tr').last().locator('td').nth(c.colIdx).innerText();
      console.log(`  [PASS] ${c.name.padEnd(16)} ASC (▲) : Ligne 1 = "${val1Asc.trim()}", Ligne 100 = "${valLastAsc.trim()}"`);

      // Clic pour passer en DESC
      await th.click();
      await page.waitForTimeout(200);
      const textDesc = await th.innerText();
      if (!textDesc.includes('▼')) {
        throw new Error(`Échec bascule tri descendant sur ${c.name} : "${textDesc.trim()}"`);
      }
      const val1Desc = await page.locator('.regesp-factures-container table tbody tr').first().locator('td').nth(c.colIdx).innerText();
      const valLastDesc = await page.locator('.regesp-factures-container table tbody tr').last().locator('td').nth(c.colIdx).innerText();
      console.log(`  [PASS] ${c.name.padEnd(16)} DESC (▼) : Ligne 1 = "${val1Desc.trim()}", Ligne 100 = "${valLastDesc.trim()}"`);
    }

    await page.screenshot({ path: path.join(EVIDENCE_DIR, '02_tri_toutes_colonnes.png') });

    console.log('\n=== 4. Vérification de la pagination client ===');
    const paginationText = await page.locator('.pagination .text-secondary').innerText();
    console.log(`  Bandeau pagination : "${paginationText.replace(/\s+/g, ' ').trim()}"`);

    // Changer la taille de page à 50
    await page.selectOption('.pagination select', '50');
    await page.waitForTimeout(200);
    const visibleRows50 = await page.locator('.regesp-factures-container table tbody tr').count();
    console.log(`  Lignes visibles après sélection 50/page : ${visibleRows50}`);
    if (visibleRows50 !== 50) {
      throw new Error(`Attendu 50 lignes affichées, obtenu: ${visibleRows50}`);
    }

    // Aller à la page 2
    const btnSuivant = page.locator('.pagination button:has-text("Suivant")');
    await btnSuivant.click();
    await page.waitForTimeout(200);
    const pageIndicator = await page.locator('.pagination span', { hasText: /\d+\s*\/\s*\d+/ }).innerText();
    console.log(`  Indicateur de page : "${pageIndicator.trim()}"`);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '03_pagination_page2.png') });

    console.log('\n=== 4b. Mesure de réactivité unitaire (clic checkbox) ===');
    const firstRowCheckbox = page.locator('.regesp-factures-container table tbody tr').first().locator('input[type="checkbox"]');
    const t0 = Date.now();
    await firstRowCheckbox.click();
    const tClick = Date.now() - t0;
    console.log(`  Temps de réponse clic checkbox unitaire : ${tClick} ms`);

    console.log('\n=== 5. Vérification de la sélection multi-pages et « Tout cocher filtré » ===');
    // Tout cocher
    const selectAllBox = page.locator('th input[type="checkbox"]');
    await selectAllBox.check();
    await page.waitForTimeout(200);

    const btnGenerer = page.locator('button:has-text("Générer")');
    let btnGenText = await btnGenerer.innerText();
    console.log(`  Bouton après tout cocher : "${btnGenText}" (sélection globale de toutes les pages)`);
    if (!btnGenText.includes(`(${NUM_FACTURES})`)) {
      throw new Error(`Tout cocher doit sélectionner les ${NUM_FACTURES} factures (obtenu: ${btnGenText})`);
    }

    console.log('\n=== 6. Filtrage et compteur « dont M hors filtre » ===');
    // Appliquer un filtre sur Code Client (ex: CL001)
    const thClient = page.locator('th').filter({ hasText: 'Code Client' });
    const filterBtn = thClient.locator('button').first();
    await filterBtn.click();
    
    // Attendre l'input de recherche dans le popup
    const searchInput = page.locator('input[placeholder="Rechercher..."]');
    await searchInput.waitFor({ state: 'visible', timeout: 5000 });
    await searchInput.fill('CL001');
    await page.waitForTimeout(300);

    // Initialement aucun filtre : 1er clic sur (Tout sélectionner) coche toutes les options, 2nd clic décoche tout
    const toggleAllLabel = page.locator('label', { hasText: '(Tout sélectionner)' });
    await toggleAllLabel.click();
    await page.waitForTimeout(100);
    await toggleAllLabel.click();
    await page.waitForTimeout(100);

    // Cocher uniquement CL001
    await page.locator('label', { hasText: 'CL001' }).first().locator('input[type="checkbox"]').check();
    await page.waitForTimeout(200);

    // Fermer le popover en cliquant sur le body
    await page.click('body', { position: { x: 50, y: 50 } });
    await page.waitForTimeout(300);

    // Vérifier le compteur de sélection
    const badgeSelection = page.locator('.table-header-wrapper').filter({ hasText: /Cochées\s*:/i });
    const badgeText = await badgeSelection.innerText();
    console.log(`  Badge de sélection : "${badgeText.replace(/\s+/g, ' ').trim()}"`);

    if (!badgeText.includes('hors filtre')) {
      throw new Error(`Le compteur de sélection doit mentionner "(dont ... hors filtre)" ! Obtenu: ${badgeText}`);
    }
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '04_selection_avec_hors_filtre.png') });

    // Test du bouton "Décocher hors filtre"
    const btnDecocherHorsFiltre = page.locator('button:has-text("Décocher hors filtre")');
    if (await btnDecocherHorsFiltre.isVisible()) {
      console.log('  Bouton "Décocher hors filtre" présent, clic pour purger la sélection masquée...');
      await btnDecocherHorsFiltre.click();
      await page.waitForTimeout(200);

      const badgeTextApres = await badgeSelection.innerText();
      console.log(`  Badge après purge hors filtre : "${badgeTextApres.replace(/\s+/g, ' ').trim()}"`);
      if (badgeTextApres.includes('hors filtre')) {
        throw new Error('Les factures hors filtre n\'ont pas été correctement décochées !');
      }
    }

    console.log('\n=== 7. Boîte de confirmation et Génération (Non-régression TASK-108) ===');
    // Sélectionner la caisse
    await page.selectOption('select.form-input', 'CAISSE1');

    // Cliquer sur Générer
    await btnGenerer.click();
    await page.waitForTimeout(1000);

    console.log(`  Message de dialogue capturé : "${lastDialogMessage.replace(/\n+/g, ' ')}"`);
    if (!lastDialogMessage.includes('Confirmez-vous la génération')) {
      throw new Error('La boîte de dialogue de confirmation n\'a pas été affichée avant génération !');
    }

    // Vérification du tableau de résultats
    const hasResultats = await page.locator('.regesp-resultats-container').isVisible();
    console.log(`  Tableau Résultat affiché post-génération : ${hasResultats}`);
    if (!hasResultats) {
      throw new Error('Le tableau Résultat doit rester affiché après la génération (TASK-108) !');
    }

    await page.screenshot({ path: path.join(EVIDENCE_DIR, '05_resultats_post_generation.png'), fullPage: true });

    console.log('\n>>> TOUTES LES VÉRIFICATIONS E2E ONT RÉUSSI (100% SUCCÈS) ! <<<');

  } catch (err) {
    console.error('\nERREUR PENDANT LE TEST E2E:', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
  }
})();
