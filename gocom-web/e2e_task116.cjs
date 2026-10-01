// TASK-116 — Test E2E Playwright : Dépôt & Caisse paramétrée, interrupteur de filtre, répartition & alerte
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const WWWROOT = path.resolve(__dirname, '../deploy/wwwroot');
const PORT = 3516;
const EVIDENCE_DIR = path.resolve(__dirname, '../tasks/VERIFY/TASK-116_evidence');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

// 30 000 factures pour tester la performance et tous les cas limites
const NUM_FACTURES = 30000;
const mockFactures = [];
const baseDate = new Date('2026-01-01T00:00:00Z').getTime();

for (let i = 1; i <= NUM_FACTURES; i++) {
  const dayOffset = (i * 7) % 270;
  const d = new Date(baseDate + dayOffset * 24 * 3600 * 1000);
  const dateIso = d.toISOString().substring(0, 10);
  const montant = 100 + ((i * 37) % 5000);

  let depotIntitule = '';
  let caisseCode = null;
  let caisseIntitule = null;
  let caisseSommeil = false;
  let caisseMotif = null;

  const mod = i % 10;
  if (mod === 1 || mod === 2) {
    // Cas 4 : Deux dépôts distincts pour la même caisse XDR2
    depotIntitule = mod === 1 ? 'DR2 DEPOT REGIONAL NADOR' : 'DR2 DEPOT ANIMATEUR NADOR';
    caisseCode = 'XDR2';
    caisseIntitule = 'X-REGIONAL NADOR';
  } else if (mod === 3 || mod === 4) {
    depotIntitule = 'DR3 DEPOT REGIONAL RABAT';
    caisseCode = 'XDR3';
    caisseIntitule = 'X-REGIONAL RABAT';
  } else if (mod === 5) {
    // Cas 7 : Caisse en sommeil
    depotIntitule = 'DR9 DEPOT REGIONAL MARRAKECH';
    caisseCode = 'XDR9';
    caisseIntitule = 'X-REGIONAL MARRAKECH';
    caisseSommeil = true;
  } else if (mod === 6) {
    // Cas 3 : Dépôt hors paramétrage
    depotIntitule = 'DEPOT SANS CAISSE';
    caisseCode = null;
    caisseMotif = 'absent';
  } else if (mod === 7) {
    // Cas 5 : Dépôt ambigu
    depotIntitule = 'DEPOT AMBIGU CONFLIT';
    caisseCode = null;
    caisseMotif = 'ambigu';
  } else {
    // Cas 1 : Info 1 vide
    depotIntitule = '';
    caisseCode = null;
    caisseMotif = 'vide';
  }

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
    info1: depotIntitule,
    info2: '', info3: '', info4: '',
    depotIntitule: depotIntitule,
    caisseCode: caisseCode,
    caisseIntitule: caisseIntitule,
    caisseSommeil: caisseSommeil,
    caisseMotif: caisseMotif,
    parametrageIndisponible: false
  });
}

let modeIndisponible = false;
let getFacturesCallCount = 0;

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
      isAdmin: true, societeId: 1, caisses: [192, 193, 201, 999], token: 'fake-token'
    });
  }
  if (p === '/api/reference/caisses') {
    return json([
      { id: 192, code: 'XDR2', intitule: 'X-REGIONAL NADOR' },
      { id: 193, code: 'XDR3', intitule: 'X-REGIONAL RABAT' },
      { id: 201, code: 'XDR9', intitule: 'X-REGIONAL MARRAKECH' },
      { id: 999, code: 'CAISSE_VIDE', intitule: 'Caisse Sans Facture' }
    ]);
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
    console.log(`  [API] GET /api/reglements/factures-a-regler (appel n°${getFacturesCallCount}, indisponible=${modeIndisponible})`);
    if (modeIndisponible) {
      return json(mockFactures.map(f => ({
        ...f,
        caisseCode: null,
        caisseIntitule: null,
        caisseSommeil: false,
        caisseMotif: null,
        parametrageIndisponible: true
      })));
    }
    return json(mockFactures);
  }

  // Génération espèces
  if (p === '/api/reglements/generer-espece' && req.method === 'POST') {
    const body = await readBody(req);
    console.log(`  [API] POST /api/reglements/generer-espece : caisse=${body?.caisseCode}, ${body?.echeanceNos?.length} factures`);
    return json({
      success: true,
      reglementsCreees: (body?.echeanceNos || []).map(no => ({ echeanceNo: no, factureNumero: `FA-${no}`, reglementNumero: `RC26-${no}` })),
      erreurs: []
    });
  }

  res.writeHead(404);
  res.end();
});

(async () => {
  await new Promise(r => server.listen(PORT, r));
  console.log(`Serveur mock démarré sur http://localhost:${PORT}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await context.newPage();

  page.on('pageerror', e => console.log('  [pageerror]', e.message));

  let lastDialogMessage = '';
  page.on('dialog', async dialog => {
    lastDialogMessage = dialog.message();
    console.log(`  [dialog intercepté]\n${lastDialogMessage}\n`);
    await dialog.accept();
  });

  try {
    console.log('\n=== TEST 1 : Migration préférence localStorage legacy vers v2 (Cas 13) ===');
    await page.goto(`http://localhost:${PORT}`);
    // Simuler une préférence legacy préexistante sans les colonnes depotIntitule ni caisseParametree
    await page.evaluate(() => {
      localStorage.setItem('gocom_reglement_espece_columns', JSON.stringify([
        'clientCode', 'clientIntitule', 'factureNumero', 'dateFacture', 'dateEcheance', 'montant', 'solde', 'representant'
      ]));
      localStorage.removeItem('gocom_reglement_espece_columns_v2');
    });

    await page.fill('input[type="text"]', 'ADMIN');
    await page.fill('input[type="password"]', 'password');
    await page.click('button[type="submit"]');

    const regEspBtn = page.locator('.sidebar-item').filter({ hasText: /Règlement\s+espèce/i }).first();
    await regEspBtn.waitFor({ state: 'visible', timeout: 5000 });
    await regEspBtn.click();

    await page.waitForSelector('.regesp-factures-container table tbody tr', { timeout: 8000 });

    // Vérifier que les colonnes Dépôt et Caisse paramétrée sont bien présentes dans le DOM
    const thDepot = page.locator('th').filter({ hasText: 'Dépôt' }).first();
    const thCaisse = page.locator('th').filter({ hasText: 'Caisse paramétrée' }).first();
    const isDepotVisible = await thDepot.isVisible();
    const isCaisseVisible = await thCaisse.isVisible();

    console.log(`  Colonne 'Dépôt' visible : ${isDepotVisible}`);
    console.log(`  Colonne 'Caisse paramétrée' visible : ${isCaisseVisible}`);
    if (!isDepotVisible || !isCaisseVisible) {
      throw new Error("Les colonnes 'Dépôt' et 'Caisse paramétrée' doivent être visibles même avec une préférence legacy.");
    }

    // Vérifier migration v2 écrite dans localStorage
    const v2Storage = await page.evaluate(() => localStorage.getItem('gocom_reglement_espece_columns_v2'));
    console.log(`  localStorage v2 enregistré : ${v2Storage}`);
    if (!v2Storage || !v2Storage.includes('depotIntitule') || !v2Storage.includes('caisseParametree')) {
      throw new Error("localStorage v2 doit contenir depotIntitule et caisseParametree après migration.");
    }

    await page.screenshot({ path: path.join(EVIDENCE_DIR, '01_migration_colonnes_v2.png'), fullPage: true });
    console.log('  [PASS] Test 1 validé.');

    console.log('\n=== TEST 2 : Tri et ExcelFilter sur Dépôt et Caisse paramétrée ===');
    // Tri sur Dépôt
    await thDepot.click();
    await page.waitForTimeout(300);
    const thDepotText = await thDepot.innerText();
    console.log(`  En-tête Dépôt après clic : "${thDepotText.trim()}"`);
    if (!thDepotText.includes('▲')) throw new Error("Le tri sur Dépôt doit afficher ▲");

    // Tri sur Caisse paramétrée
    await thCaisse.click();
    await page.waitForTimeout(300);
    const thCaisseText = await thCaisse.innerText();
    console.log(`  En-tête Caisse paramétrée après clic : "${thCaisseText.trim()}"`);
    if (!thCaisseText.includes('▲')) throw new Error("Le tri sur Caisse paramétrée doit afficher ▲");

    await page.screenshot({ path: path.join(EVIDENCE_DIR, '02_tri_colonnes.png'), fullPage: true });
    console.log('  [PASS] Test 2 validé.');

    console.log('\n=== TEST 3 : Interrupteur « Filtrer sur les dépôts de cette caisse » (Cas 4, 9, 10, 11) ===');
    const switchLabel = page.locator('.regesp-switch-label');
    const switchInput = switchLabel.locator('input[type="checkbox"]');
    const caisseSelect = page.locator('.regesp-factures-container select').first();

    // Vérifier état initial sans caisse choisie
    const isDisabledSansCaisse = await switchInput.isDisabled();
    const tooltipSansCaisse = await switchLabel.getAttribute('title');
    console.log(`  Interrupteur désactivé sans caisse : ${isDisabledSansCaisse} (titre: "${tooltipSansCaisse}")`);
    if (!isDisabledSansCaisse || tooltipSansCaisse !== "Choisissez d'abord une caisse") {
      throw new Error("L'interrupteur doit être désactivé avec l'infobulle 'Choisissez d'abord une caisse' tant qu'aucune caisse n'est choisie.");
    }

    // Choisir la caisse XDR2
    await caisseSelect.selectOption('XDR2');
    await page.waitForTimeout(200);

    const isEnabledAvecCaisse = await switchInput.isEnabled();
    console.log(`  Interrupteur activé après choix caisse XDR2 : ${isEnabledAvecCaisse}`);
    if (!isEnabledAvecCaisse) throw new Error("L'interrupteur doit devenir actif dès qu'une caisse est choisie.");

    // Activer l'interrupteur
    await switchInput.check();
    await page.waitForTimeout(300);

    // Compteur de factures filtrées
    const headerTitle = await page.locator('.table-title').innerText();
    console.log(`  Compteur de factures avec filtre actif : "${headerTitle.trim()}"`);
    if (!headerTitle.includes('6000 / 30000')) {
      throw new Error(`Attendu 6000 factures pour XDR2 (2/10 de 30 000), obtenu: "${headerTitle}"`);
    }

    // Vérifier Cas 4 : Les factures affichées ont soit "DR2 DEPOT REGIONAL NADOR" soit "DR2 DEPOT ANIMATEUR NADOR"
    const depotCells = await page.locator('.regesp-factures-container table tbody tr td:nth-child(10)').allInnerTexts();
    const uniqueDepotsInPage = Array.from(new Set(depotCells));
    console.log(`  Dépôts visibles sur page 1 : ${uniqueDepotsInPage.join(', ')}`);
    const hasRegional = uniqueDepotsInPage.some(d => d.includes('REGIONAL NADOR'));
    const hasAnimateur = uniqueDepotsInPage.some(d => d.includes('ANIMATEUR NADOR'));
    if (!hasRegional || !hasAnimateur) {
      throw new Error("Cas 4 : Tous les dépôts de la caisse XDR2 doivent apparaître sous le filtre.");
    }

    // Cas 9 : Caisse sans aucune facture
    await caisseSelect.selectOption('CAISSE_VIDE');
    await page.waitForTimeout(300);
    const titleVide = await page.locator('.table-title').innerText();
    const emptyRowText = await page.locator('.regesp-factures-container table tbody tr td').first().innerText();
    console.log(`  Caisse vide -> Titre: "${titleVide.trim()}", Message: "${emptyRowText.trim()}"`);
    if (!titleVide.includes('0 / 30000') || !emptyRowText.includes('Aucune facture ne correspond')) {
      throw new Error("Cas 9 : Caisse sans facture doit afficher 0 / 30000 et le message aucun résultat sans erreur.");
    }

    // Cas 10 : Changement de caisse -> retour à XDR2
    await caisseSelect.selectOption('XDR2');
    await page.waitForTimeout(300);
    const titleRetour = await page.locator('.table-title').innerText();
    console.log(`  Retour à XDR2 -> Titre: "${titleRetour.trim()}"`);
    if (!titleRetour.includes('6000 / 30000')) {
      throw new Error("Cas 10 : La grille doit se recalculer immédiatement lors d'un changement de caisse.");
    }

    await page.screenshot({ path: path.join(EVIDENCE_DIR, '03_interrupteur_filtre_caisse.png'), fullPage: true });
    console.log('  [PASS] Test 3 validé.');

    console.log('\n=== TEST 4 : Bandeau de répartition des caisses et alerte de confirmation (Cas 11, 12) ===');
    // Désactiver l'interrupteur pour voir toutes les factures
    await switchInput.uncheck();
    await page.waitForTimeout(300);

    // Trier sur N° facture ascendant pour garantir les indices des factures
    const thFacture = page.locator('th').filter({ hasText: 'N° facture' }).first();
    await thFacture.click();
    await page.waitForTimeout(300);

    // Cocher 2 factures XDR2 (lignes 0, 1), 2 factures XDR3 (lignes 2, 3), 1 facture Non paramétré (ligne 5)
    // Dans notre mock trié par N° facture :
    // FA26-00001 (mod 1: XDR2), FA26-00002 (mod 2: XDR2), FA26-00003 (mod 3: XDR3), FA26-00004 (mod 4: XDR3), FA26-00006 (mod 6: Non paramétré)
    const rows = page.locator('.regesp-factures-container table tbody tr');
    await rows.nth(0).locator('input[type="checkbox"]').check();
    await rows.nth(1).locator('input[type="checkbox"]').check();
    await rows.nth(2).locator('input[type="checkbox"]').check();
    await rows.nth(3).locator('input[type="checkbox"]').check();
    await rows.nth(5).locator('input[type="checkbox"]').check();
    await page.waitForTimeout(300);

    // Vérifier le bandeau de répartition
    const repartitionBanner = page.locator('.regesp-repartition');
    const isBannerVisible = await repartitionBanner.isVisible();
    const bannerText = await repartitionBanner.innerText();
    console.log(`  Bandeau de répartition visible : ${isBannerVisible}`);
    console.log(`  Texte du bandeau : "${bannerText}"`);

    if (!isBannerVisible || !bannerText.includes('XDR2') || !bannerText.includes('XDR3') || !bannerText.includes('Non paramétré')) {
      throw new Error("Le bandeau de répartition doit détailler les caisses cochées (XDR2, XDR3, Non paramétré).");
    }

    // Cas 11 : Activer le filtre alors que des factures sont déjà cochées
    await switchInput.check();
    await page.waitForTimeout(300);
    const horsFiltreLabel = page.locator('text=dont 3 hors filtre');
    const isHorsFiltreVisible = await horsFiltreLabel.isVisible();
    console.log(`  Compteur 'dont 3 hors filtre' visible : ${isHorsFiltreVisible}`);
    if (!isHorsFiltreVisible) throw new Error("Cas 11 : Les factures cochées hors caisse doivent être indiquées 'dont N hors filtre'.");

    await page.screenshot({ path: path.join(EVIDENCE_DIR, '04_bandeau_repartition.png'), fullPage: true });

    // Cas 12 : Cliquer sur Générer et vérifier le texte EXACT de l'alerte
    lastDialogMessage = '';
    const btnGenerer = page.locator('button').filter({ hasText: /Générer/i }).first();
    await btnGenerer.click();
    await page.waitForTimeout(500);

    console.log(`  Message de confirmation reçu :\n${lastDialogMessage}\n`);
    const hasAvertissementAutreCaisse = lastDialogMessage.includes("ATTENTION : 2 facture(s) cochée(s) ont une autre caisse paramétrée que XDR2 (XDR3 : 2).");
    const hasAvertissementSansCaisse = lastDialogMessage.includes("1 facture(s) n'ont pas de caisse paramétrée (traitées sur la caisse choisie).");

    console.log(`  Avertissement autre caisse présent : ${hasAvertissementAutreCaisse}`);
    console.log(`  Avertissement sans caisse présent : ${hasAvertissementSansCaisse}`);

    if (!hasAvertissementAutreCaisse || !hasAvertissementSansCaisse) {
      throw new Error("Cas 12 : L'alerte de confirmation doit comporter les mentions exactes pour autre caisse et sans caisse.");
    }

    await page.screenshot({ path: path.join(EVIDENCE_DIR, '05_alerte_confirmation.png'), fullPage: true });
    console.log('  [PASS] Test 4 validé.');

    console.log('\n=== TEST 5 : Indisponibilité du paramétrage (Cas 8) ===');
    modeIndisponible = true;
    const btnRefresh = page.locator('button').filter({ hasText: /Rafraîchir/i }).first();
    await btnRefresh.click();
    await page.waitForTimeout(1000);

    // Vérifier le bandeau discret d'indisponibilité
    const indispoBanner = page.locator('.regesp-indispo-banner');
    const isIndispoBannerVisible = await indispoBanner.isVisible();
    const indispoText = await indispoBanner.innerText();
    console.log(`  Bandeau indisponibilité visible : ${isIndispoBannerVisible} ("${indispoText.trim()}")`);
    if (!isIndispoBannerVisible || !indispoText.includes('Paramétrage des caisses indisponible : filtre automatique désactivé')) {
      throw new Error("Cas 8 : Le bandeau d'indisponibilité discret doit être affiché.");
    }

    // Vérifier que l'interrupteur est désactivé même avec caisse XDR2
    const isSwitchDisabledIndispo = await switchInput.isDisabled();
    const switchTitleIndispo = await switchLabel.getAttribute('title');
    console.log(`  Interrupteur désactivé en mode indisponible : ${isSwitchDisabledIndispo} (titre: "${switchTitleIndispo}")`);
    if (!isSwitchDisabledIndispo || switchTitleIndispo !== "Paramétrage des caisses indisponible") {
      throw new Error("Cas 8 : L'interrupteur doit être désactivé avec infobulle 'Paramétrage des caisses indisponible'.");
    }

    // Vérifier que la grille affiche bien la liste normale (30000 / 30000) et non 0 / 30000
    const headerTitleIndispo = await page.locator('.table-title').first().innerText();
    console.log(`  Compteur factures en mode indisponible : "${headerTitleIndispo.trim()}"`);
    if (!headerTitleIndispo.includes('30000 / 30000')) {
      throw new Error(`Cas 8 : La grille doit afficher la liste normale (30000 / 30000) quand le paramétrage est indisponible, obtenu: "${headerTitleIndispo}"`);
    }

    await page.screenshot({ path: path.join(EVIDENCE_DIR, '06_indisponibilite_parametrages.png'), fullPage: true });
    console.log('  [PASS] Test 5 validé.');

    console.log('\n===================================================================================');
    console.log('   TOUS LES TESTS E2E TASK-116 ONT ÉTÉ VALIDÉS AVEC SUCCÈS (5/5) !');
    console.log(`   Preuves d'écran enregistrées dans : ${EVIDENCE_DIR}`);
    console.log('===================================================================================');

  } finally {
    await browser.close();
    server.close();
  }
})();
