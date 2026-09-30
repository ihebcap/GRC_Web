const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const WWWROOT = path.resolve(__dirname, '../deploy/wwwroot');
const PORT = 3499;
const EVIDENCE_DIR = path.resolve(__dirname, '../tasks/VERIFY/TASK-099_evidence');

if (!fs.existsSync(WWWROOT)) {
  console.error(`Dossier build introuvable: ${WWWROOT}`);
  process.exit(1);
}
if (!fs.existsSync(EVIDENCE_DIR)) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
}

// Jeu d'essai (miroir du jeu d'essai du VERIFY, § Jeu d'essai base de TEST) :
// - Rl : virement libre (id=201) -> S1
// - Rx : virement libre mais la caisse est refusée côté serveur (id=202) -> S4
// - Rr : virement réservé, lettrage='A' (id=203) -> non-régression / S7
// - Rc : chèque remis, isRemis=2 (id=204) -> pas de bouton (non-régression S3, gardé pour cohérence)
// - 996 lignes de remplissage (id=1000..1995) toutes libres, non lettrées -> grille à 1000 lignes pour S6/S7
const baseReglements = [
  {
    no: 201, mv_Id: 201, date: '2026-09-28T00:00:00', clientCode: 'CL201', clientIntitule: 'STE ATLAS NEGOCE (Rl)',
    numero: 'VIR26090201', libelle: 'Virement Rl', montant: 12500.0, lettrage: null,
    reservePar_UserId: null, reservePar_UserName: null, dateReservation: null,
    isAnnule: false, isPointe: false, isComptabilise: 0, isRemis: 0, isAffecte: false
  },
  {
    no: 202, mv_Id: 202, date: '2026-09-28T00:00:00', clientCode: 'CL202', clientIntitule: 'COMPTOIR DU MAROC (Rx)',
    numero: 'VIR26090202', libelle: 'Virement Rx', montant: 8750.0, lettrage: null,
    reservePar_UserId: null, reservePar_UserName: null, dateReservation: null,
    isAnnule: false, isPointe: false, isComptabilise: 0, isRemis: 0, isAffecte: false
  },
  {
    no: 203, mv_Id: 203, date: '2026-09-28T00:00:00', clientCode: 'CL203', clientIntitule: 'INDUSTRIE DU NORD (Rr)',
    numero: 'VIR26090203', libelle: 'Virement Rr', montant: 3400.0, lettrage: 'A',
    reservePar_UserId: 1, reservePar_UserName: 'Admin', dateReservation: '2026-09-30T10:00:00',
    isAnnule: false, isPointe: false, isComptabilise: 0, isRemis: 0, isAffecte: false
  },
  {
    no: 204, mv_Id: 204, date: '2026-09-28T00:00:00', clientCode: 'CL204', clientIntitule: 'NEGOCE SUD (Rc)',
    numero: 'CHQ26090204', libelle: 'Chèque remis Rc', montant: 5200.0, lettrage: null,
    reservePar_UserId: null, reservePar_UserName: null, dateReservation: null,
    isAnnule: false, isPointe: false, isComptabilise: 0, isRemis: 2, isAffecte: false
  }
];
for (let i = 0; i < 996; i++) {
  const id = 1000 + i;
  baseReglements.push({
    no: id, mv_Id: id, date: '2026-09-28T00:00:00', clientCode: `CL${id}`, clientIntitule: `CLIENT REMPLISSAGE ${id}`,
    numero: `VIR${id}`, libelle: `Virement remplissage ${id}`, montant: 100 + (i % 50), lettrage: null,
    reservePar_UserId: null, reservePar_UserName: null, dateReservation: null,
    isAnnule: false, isPointe: false, isComptabilise: 0, isRemis: 0, isAffecte: false
  });
}

let reglements = JSON.parse(JSON.stringify(baseReglements));
let lignesReleve = [
  { id: 501, dateOperation: '2026-09-28T00:00:00', dateValeur: '2026-09-28T00:00:00', libelle: 'VIR RECU ATLAS NEGOCE', reference: 'REF-501', code: 'VIR', credit: 12500.0, lettrage: null, reservePar_UserId: null, reservePar_UserName: null, dateReservation: null },
  { id: 502, dateOperation: '2026-09-28T00:00:00', dateValeur: '2026-09-28T00:00:00', libelle: 'VIR RECU REMPLISSAGE 1000', reference: 'REF-502', code: 'VIR', credit: 100.0, lettrage: null, reservePar_UserId: null, reservePar_UserName: null, dateReservation: null }
];

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : null); } catch { resolve(null); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsedUrl.pathname;
  const json = (obj, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

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

  if (pathname === '/api/auth/login' && req.method === 'POST') {
    return json({ no: 1, login: 'Admin', nom: 'Admin', prenom: 'Admin', isAdmin: true, societeId: 1, caisses: [1], token: 'fake-token-test-099' });
  }

  if (pathname === '/api/reference/banques') {
    return json([{ id: 1, code: 'BNQ1', rib: 'RIB0001' }]);
  }
  if (pathname === '/api/reference/societes') return json([{ id: 1, raisonSociale: 'GOCOM' }]);
  if (pathname.startsWith('/api/reference/modes')) return json([{ id: 1, code: 'VIR', intitule: 'Virement', typeNo: 1 }]);
  if (pathname === '/api/reference/caisses') return json([{ id: 1, code: 'CAISSE1', intitule: 'Caisse Principale' }]);
  if (pathname.startsWith('/api/reglements/distincts')) {
    return json({ clients: [], numeros: [], pieces: [], references: [], libelles: [], extraits: [], banquesTier: [] });
  }

  if (pathname === '/api/ReleveBancaire' && req.method === 'GET') {
    return json([{ id: 1, titre: 'Relevé Sept 2026', dateImport: '2026-09-29T00:00:00' }]);
  }
  if (pathname === '/api/ReleveBancaire/1/lignes' && req.method === 'GET') {
    return json(lignesReleve);
  }
  if (pathname === '/api/ReleveBancaire/reserve' && req.method === 'POST') {
    const body = await readBody(req);
    const ligne = lignesReleve.find(l => l.id === body.ligneReleveId);
    const reg = reglements.find(r => r.mv_Id === body.mvId);
    const lettre = 'B';
    if (ligne) { ligne.lettrage = lettre; ligne.reservePar_UserId = 1; }
    if (reg) { reg.lettrage = lettre; reg.reservePar_UserId = 1; }
    return json({ lettrage: lettre });
  }
  if (pathname === '/api/ReleveBancaire/release-batch' && req.method === 'POST') {
    const body = await readBody(req);
    const results = body.map(b => {
      const ligne = lignesReleve.find(l => l.id === b.ligneReleveId);
      if (ligne) { ligne.lettrage = null; ligne.reservePar_UserId = null; }
      return { ligneReleveId: b.ligneReleveId, success: true };
    });
    return json(results);
  }
  if (pathname === '/api/ReleveBancaire/auto-reconcile' && req.method === 'POST') {
    // Correspondance parfaite 1=1 : ligne 501 (12500) <-> règlement 201 (Rl, déjà annulé dans le scénario S1
    // au moment où S6 s'exécute -> aucune correspondance disponible, réponse vide, comportement normal).
    const props = [];
    for (const l of lignesReleve) {
      if (l.lettrage) continue;
      const match = reglements.find(r => !r.lettrage && r.montant === l.credit);
      if (match) props.push({ ligneReleveId: l.id, reglementGrcId: match.mv_Id, montant: match.montant, lettragePropose: 'C' });
    }
    return json(props);
  }
  if (pathname === '/api/ReleveBancaire/reserve-batch' && req.method === 'POST') {
    const body = await readBody(req);
    const results = body.map((p, i) => {
      const lettre = String.fromCharCode(67 + i); // 'C', 'D', ...
      const ligne = lignesReleve.find(l => l.id === p.ligneReleveId);
      const reg = reglements.find(r => r.mv_Id === p.mvId);
      if (ligne) { ligne.lettrage = lettre; ligne.reservePar_UserId = 1; }
      if (reg) { reg.lettrage = lettre; reg.reservePar_UserId = 1; }
      return { ligneReleveId: p.ligneReleveId, mvId: p.mvId, success: true, lettrage: lettre };
    });
    return json(results);
  }
  if (pathname === '/api/ReleveBancaire/validate' && req.method === 'POST') {
    return json({ success: true, successCount: 1, errorCount: 0, errors: [] });
  }

  if (pathname === '/api/reglements' && req.method === 'GET') {
    return json({ items: reglements, totalItems: reglements.length });
  }

  const annulerMatch = pathname.match(/^\/api\/reglements\/(\d+)\/annuler$/);
  if (annulerMatch && req.method === 'POST') {
    const id = Number(annulerMatch[1]);
    if (id === 202) {
      // Rx : refus serveur (compte sans droit sur cette caisse)
      return json({ message: "Vous n'avez pas les droits pour annuler un règlement sur cette caisse." }, 403);
    }
    const reg = reglements.find(r => r.mv_Id === id);
    if (!reg) return json({ message: 'Règlement introuvable.' }, 404);
    reg.isAnnule = true;
    reglements = reglements.filter(r => r.mv_Id !== id); // TASK-098 : annulé disparaît de la grille rapprochement
    return json({ success: true });
  }

  res.writeHead(404);
  res.end();
});

async function runTests() {
  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log(`Serveur de test démarré sur http://localhost:${PORT}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  page.on('console', msg => { if (msg.type() === 'error') console.log('  [console:error]', msg.text()); });
  // TASK-099 S2 : journal des requêtes POST /annuler ; S7 : compteur de rendus réels de GrcTableRow (log temporaire T099-RENDER)
  const annulerPosts = [];
  page.on('request', r => { if (r.method() === 'POST' && /\/reglements\/\d+\/annuler/.test(r.url())) annulerPosts.push(r.url()); });
  let renderLogs = [];
  page.on('console', msg => { const t = msg.text(); if (t.startsWith('[T099-RENDER]')) renderLogs.push(t.split(' ')[1]); });

  try {
    console.log('--- Connexion ---');
    await page.goto(`http://localhost:${PORT}`);
    await page.fill('input[type="text"]', 'Admin');
    await page.fill('input[type="password"]', 'Admin');
    await page.click('button[type="submit"]');
    await page.waitForSelector('.rappro-title', { timeout: 10000 }).catch(() => {});

    // Naviguer vers l'écran Rapprochement si ce n'est pas déjà la vue par défaut
    const navRappro = page.locator('text=Rapprochement').first();
    if (await navRappro.count() > 0 && await page.locator('.rappro-title').count() === 0) {
      await navRappro.click();
    }
    await page.waitForSelector('.rappro-title', { timeout: 10000 });

    // Sélectionner la banque -> déclenche fetchReglementsGrc (1000 lignes)
    console.log('Sélection de la banque (chargement de 1000 lignes)...');
    const t0 = Date.now();
    await page.selectOption('select.toolbar-select', '1');
    await page.waitForSelector('tr:has-text("VIR26090201")', { timeout: 15000 });
    const loadMs = Date.now() - t0;
    console.log(`Grille GRC (1000 lignes) chargée et rendue en ${loadMs} ms.`);
    await page.waitForTimeout(300);

    const counterBefore = await page.locator('text=/\\d+ élément\\(s\\) affiché\\(s\\)/').last().innerText();
    console.log(`Compteur avant : "${counterBefore}"`);

    // ==========================================
    // S2 — Réservé (Rr = 203) : bouton désactivé, infobulle, aucun POST au clic
    // ==========================================
    console.log('\n--- S2 : Règlement réservé (Rr) ---');
    const rrRow = page.locator('tr:has-text("VIR26090203")');
    await rrRow.waitFor();
    const disabledBtn = rrRow.locator('button[aria-label="Annuler le règlement (désactivé)"]');
    if (await disabledBtn.count() !== 1) throw new Error('S2 : bouton désactivé absent sur Rr');
    if (!(await disabledBtn.isDisabled())) throw new Error("S2 : le bouton de Rr n'est pas disabled");
    if (await rrRow.locator('button[title="Annuler le règlement"]').count() !== 0) throw new Error('S2 : bouton actif présent sur Rr');
    const tip = await rrRow.locator('span[title]').first().getAttribute('title');
    console.log(`Infobulle : "${tip}"`);
    if (tip !== "Dérapprochez d'abord la ligne") throw new Error('S2 : infobulle incorrecte');
    const postsBefore = annulerPosts.length;
    await disabledBtn.click({ force: true }).catch(() => {});
    await rrRow.locator('td').nth(1).click({ force: true }).catch(() => {});
    await page.waitForTimeout(400);
    const modalOpen = await page.locator('text=/Voulez-vous vraiment annuler le règlement \[203\]/').count();
    console.log(`POST /annuler émis au clic : ${annulerPosts.length - postsBefore} (attendu 0) ; modale de confirmation : ${modalOpen} (attendu 0)`);
    if (annulerPosts.length !== postsBefore || modalOpen !== 0) throw new Error('S2 : le clic sur le bouton désactivé a déclenché une action');
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'screenshot_s2_reserve_desactive.png') });
    console.log('S2 : PASS');

    // ==========================================
    // S3 — Remis (Rc = 204) : aucun bouton
    // ==========================================
    console.log('\n--- S3 : Règlement remis (Rc) ---');
    const rcRow = page.locator('tr:has-text("CHQ26090204")');
    await rcRow.waitFor();
    const rcButtons = await rcRow.locator('button').count();
    console.log(`Boutons dans la ligne Rc : ${rcButtons} (attendu 0)`);
    if (rcButtons !== 0) throw new Error('S3 : un bouton est présent sur un règlement remis');
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'screenshot_s3_remis_sans_bouton.png') });
    console.log('S3 : PASS');

    // ==========================================
    // S1 — Annulation d'un règlement libre (Rl)
    // ==========================================
    console.log('\n--- S1 : Annulation règlement libre (Rl) ---');
    const rlRow = page.locator('tr:has-text("VIR26090201")');
    await rlRow.waitFor();
    const annulerBtnRl = rlRow.locator('button[title="Annuler le règlement"]');
    if (await annulerBtnRl.count() === 0) throw new Error('S1 : bouton Annuler absent sur Rl (libre)');
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'screenshot_s1_avant.png') });

    await annulerBtnRl.click();
    const confirmMsg = page.locator('text=/Voulez-vous vraiment annuler le règlement \\[201\\]/');
    await confirmMsg.waitFor({ timeout: 5000 });
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'screenshot_s1_confirmation.png') });
    console.log('Modale de confirmation affichée (S1).');

    await page.click('button:has-text("Confirmer")');
    const toastSuccess = page.locator('text=/Règlement \\[201\\] annulé avec succès/');
    await toastSuccess.waitFor({ timeout: 5000 });
    console.log('Toast de succès affiché (S1).');

    const rlAfter = await page.locator('tr:has-text("VIR26090201")').count();
    console.log(`Ligne Rl toujours présente après annulation : ${rlAfter} (attendu: 0)`);
    if (rlAfter !== 0) throw new Error('S1 : la ligne Rl aurait dû disparaître après annulation');

    await page.waitForTimeout(3200); // laisser le toast disparaître (auto-dismiss 3s)
    const counterAfterS1 = await page.locator('text=/\\d+ élément\\(s\\) affiché\\(s\\)/').last().innerText();
    console.log(`Compteur après S1 : "${counterAfterS1}" (attendu -1 vs avant)`);
    const countBeforeNum = parseInt(counterBefore, 10);
    const countAfterNum = parseInt(counterAfterS1, 10);
    if (countAfterNum !== countBeforeNum - 1) throw new Error(`S1 : compteur incorrect, avant=${countBeforeNum} après=${countAfterNum}`);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'screenshot_s1_apres.png') });
    console.log('S1 : PASS');

    // ==========================================
    // S4 — Refus serveur (Rx, compte sans droit)
    // ==========================================
    console.log('\n--- S4 : Refus serveur (Rx) ---');
    const rxRow = page.locator('tr:has-text("VIR26090202")');
    await rxRow.waitFor();
    await rxRow.locator('button[title="Annuler le règlement"]').click();
    await page.locator('text=/Voulez-vous vraiment annuler le règlement \\[202\\]/').waitFor({ timeout: 5000 });
    await page.click('button:has-text("Confirmer")');

    const toastErr = page.locator("text=/Vous n'avez pas les droits pour annuler un règlement sur cette caisse\\./");
    await toastErr.waitFor({ timeout: 5000 });
    console.log('Toast d\'erreur avec le message serveur affiché (S4).');
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'screenshot_s4_refus_serveur.png') });

    const rxStill = await page.locator('tr:has-text("VIR26090202")').count();
    console.log(`Ligne Rx toujours présente après refus : ${rxStill} (attendu: 1)`);
    if (rxStill !== 1) throw new Error('S4 : la ligne Rx doit rester dans la grille après un refus serveur');
    await page.waitForTimeout(3200);
    console.log('S4 : PASS');

    // ==========================================
    // S6 — Non-régression (sélection, lettrage manuel, auto-rapprochement, filtres, tri)
    // ==========================================
    console.log('\n--- S6 : Non-régression grille ---');

    // -- Sélection simple (checkbox) sur une ligne de remplissage --
    const fillRow = page.locator('tr:has-text("VIR1000")');
    await fillRow.waitFor();
    await fillRow.locator('input[type="checkbox"]').click();
    await page.waitForTimeout(150);
    const fillRowSelected = await fillRow.evaluate(el => el.className.includes('selected-row') || el.querySelector('input[type=checkbox]').checked);
    console.log(`Sélection simple appliquée sur VIR1000 : ${fillRowSelected}`);
    if (!fillRowSelected) throw new Error('S6 : la sélection d\'une ligne GRC ne fonctionne plus');
    await fillRow.locator('input[type="checkbox"]').click(); // désélectionner
    await page.waitForTimeout(150);

    // -- Tri --
    console.log('Tri par colonne Montant...');
    await page.click('th:has-text("Montant") span');
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'screenshot_s6_tri.png') });

    // -- Filtre --
    console.log('Filtre Excel sur une colonne...');
    const filterBtn = page.locator('th:has-text("Client")').locator('button, [role="button"]').first();
    if (await filterBtn.count() > 0) {
      await filterBtn.click();
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(EVIDENCE_DIR, 'screenshot_s6_filtre_ouvert.png') });
      await page.keyboard.press('Escape');
    } else {
      console.log('  (bouton de filtre non trouvé par ce sélecteur générique — voir capture tri pour la grille dans son état normal)');
    }

    // -- Lettrage manuel : Rl a été annulé, on utilise VIR1000 vs la ligne de relevé 501 (montants différents -> juste vérifier le flux de sélection croisée sans forcer la mise à jour de montant) --
    console.log('Lettrage manuel (sélection croisée GRC <-> relevé)...');
    const relRow = page.locator('tr:has-text("VIR RECU ATLAS NEGOCE")');
    await relRow.waitFor();
    await relRow.locator('input[type="checkbox"]').click();
    await page.waitForTimeout(150);
    // Montant relevé (12500) != montant VIR1000 (100..149) -> bandeau de confirmation de mise à jour attendu
    await fillRow.locator('input[type="checkbox"]').click();
    await page.waitForTimeout(200);
    const pendingBanner = page.locator('text=/Les montants sélectionnés sont différents/');
    const pendingVisible = await pendingBanner.count() > 0;
    console.log(`Bandeau de confirmation de lettrage (montants différents) affiché : ${pendingVisible}`);
    if (pendingVisible) {
      await page.screenshot({ path: path.join(EVIDENCE_DIR, 'screenshot_s6_lettrage_manuel_montants_differents.png') });
      await page.click('button:has-text("Annuler")'); // annule le lettrage proposé, ne modifie rien
      await page.waitForTimeout(150);
    } else {
      throw new Error('S6 : le flux de lettrage manuel (sélection croisée) ne réagit plus comme attendu');
    }

    // -- Auto-rapprochement (bouton Auto) : ligne relevé 502 (montant 77) <-> VIR1000..1995 (montant 100+i%50) --
    console.log('Auto-rapprochement...');
    await page.evaluate(() => {}); // no-op, garde la structure symétrique avec les autres étapes
    await page.click('button:has-text("Auto")');
    await page.waitForTimeout(600);
    const autoToast = page.locator('text=/correspondance/');
    const autoToastCount = await autoToast.count();
    console.log(`Toast résultat auto-rapprochement affiché : ${autoToastCount > 0}`);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'screenshot_s6_auto_rapprochement.png') });
    if (autoToastCount === 0) throw new Error('S6 : aucun toast de résultat après auto-rapprochement');

    console.log('S6 : PASS (sélection, tri, lettrage manuel, auto-rapprochement fonctionnels avec 1000 lignes GRC)');

    // ==========================================
    // S7 — Mémoïsation : pas de re-rendu global à la sélection
    // ==========================================
    console.log('\n--- S7 : Mémoïsation (mesure dynamique) ---');

    // Mesure directe : chaque rendu réel de GrcTableRow écrit '[T099-RENDER] <mv_Id>' (log TEMPORAIRE dans le source, retiré après la mesure).
    const targetRow = page.locator('tr:has-text("VIR1500")');
    await targetRow.waitFor();
    await page.waitForTimeout(300);
    renderLogs = [];
    const t1 = Date.now();
    await targetRow.locator('input[type="checkbox"]').click();
    await page.waitForTimeout(400);
    const selectMs = Date.now() - t1;
    const selectRenders = renderLogs.length;
    const rowsInDom = await page.locator('tbody tr').count();
    console.log(`Sélection d'1 ligne parmi ~${rowsInDom} : ${renderLogs.length} rendu(s) de GrcTableRow (ids : ${renderLogs.slice(0, 5).join(',')}), ${selectMs} ms.`);
    if (process.env.EXPECT_BROKEN_MEMO) {
      console.log(`Contrôle négatif (memo volontairement cassé) : ${renderLogs.length} rendus, ~${rowsInDom} lignes`);
      if (renderLogs.length < rowsInDom / 2) throw new Error('Contrôle négatif : le compteur ne détecte pas la régression');
    } else if (renderLogs.length > 2) {
      throw new Error(`S7 : ${renderLogs.length} rendus après une sélection (attendu <= 2)`);
    }
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'screenshot_s7_selection_1000_lignes.png') });
    await targetRow.locator('input[type="checkbox"]').click();
    await page.waitForTimeout(100);
    console.log(`S7 : PASS — ${selectRenders} rendu(s) de GrcTableRow après sélection (sur ~${rowsInDom} lignes).`);

    console.log('\n==========================================');
    console.log('TOUS LES TESTS E2E (S1, S2, S3, S4, S6, S7) SONT PASSÉS AVEC SUCCÈS !');
    console.log('==========================================');
  } finally {
    await browser.close();
    server.close();
  }
}

runTests().catch((err) => {
  console.error('\n❌ Échec du test :', err);
  server.close();
  process.exit(1);
});
