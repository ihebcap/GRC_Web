// TASK-106 — harnais Playwright MOCKÉ (API simulée). Ne remplace pas les scénarios d'intégration
// sur base de test (e2e_task106.cjs contre l'API réelle) : il prouve la logique front (collision de lettres).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const WWWROOT = path.resolve(__dirname, '../deploy/wwwroot');
const PORT = 3506;
const EVIDENCE_DIR = path.resolve(__dirname, '../tasks/VERIFY/TASK-106_evidence');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const RX = 247, RY = 248; // relevés
const reg = (no, montant, extra = {}) => ({
  no, mv_Id: no, date: '2026-09-28T00:00:00', clientCode: `CL${no}`, clientIntitule: `CLIENT ${no}`,
  numero: `VIR${no}`, libelle: `Virement R${no}`, montant, lettrage: null, releveEnteteId: null,
  reservePar_UserId: null, reservePar_UserName: null, dateReservation: null,
  isAnnule: false, isPointe: false, isComptabilise: 0, isRemis: 0, isAffecte: false, ...extra
});
const lig = (id, ent, credit, extra = {}) => ({
  id, releveBancaireEnteteId: ent, dateOperation: '2026-09-28T00:00:00', dateValeur: '2026-09-28T00:00:00',
  libelle: `LIGNE ${id}`, reference: `REF${id}`, code: 'VIR', credit, lettrage: null, mV_ID: null,
  reservePar_UserId: null, reservePar_UserName: null, dateReservation: null, ...extra
});
// R1 (901) réservé par U1 sur RX (ligne 1, lettre A). Y1 (2001) libre sur RY. R3 (903) libre, même montant que Y1.
let reglements, lignes, releveCalls, validateBodies;
const reset = () => {
  reglements = [
    reg(901, 1101, { lettrage: 'A', releveEnteteId: RX, reservePar_UserId: 1, reservePar_UserName: 'U1' }),
    reg(903, 2201), reg(904, 2202), reg(950, 2250)
  ];
  lignes = {
    [RY]: [lig(2001, RY, 2201), lig(2002, RY, 2202)],
    [RX]: [lig(1001, RX, 1101, { lettrage: 'A', mV_ID: 901, reservePar_UserId: 1 })]
  };
  releveCalls = []; validateBodies = [];
};
reset();

const readBody = (req) => new Promise((resolve) => {
  let b = ''; req.on('data', c => (b += c)); req.on('end', () => { try { resolve(b ? JSON.parse(b) : null); } catch { resolve(null); } });
});
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`); const p = u.pathname;
  const json = (o, s = 200) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (p === '/' || p === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(path.join(WWWROOT, 'index.html'))); }
  if (p.startsWith('/assets/')) {
    const f = path.join(WWWROOT, p);
    if (fs.existsSync(f)) { const e = path.extname(f); res.writeHead(200, { 'Content-Type': e === '.js' ? 'application/javascript' : e === '.css' ? 'text/css' : 'application/octet-stream' }); return res.end(fs.readFileSync(f)); }
  }
  if (p === '/config.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end('window.GOCOM_CONFIG = { API_BASE: "/api" };'); }
  if (p === '/api/auth/login') return json({ no: 1, login: 'U1', nom: 'U1', prenom: 'U1', isAdmin: true, societeId: 1, caisses: [1], token: 'fake-token' });
  if (p === '/api/reference/banques') return json([{ id: 1, code: 'BNQ1', rib: 'RIB0001' }]);
  if (p === '/api/reference/societes') return json([{ id: 1, raisonSociale: 'GOCOM' }]);
  if (p.startsWith('/api/reference/modes')) return json([{ id: 1, code: 'VIR', intitule: 'Virement', typeNo: 1 }]);
  if (p === '/api/reference/caisses') return json([{ id: 1, code: 'CAISSE1', intitule: 'Caisse Principale' }]);
  if (p.startsWith('/api/reglements/distincts')) return json({ clients: [], numeros: [], pieces: [], references: [], libelles: [], extraits: [], banquesTier: [] });
  if (p === '/api/ReleveBancaire' && req.method === 'GET') return json([{ id: RY, titre: 'Relevé RY', dateImport: '2026-09-29T00:00:00' }, { id: RX, titre: 'Relevé RX', dateImport: '2026-09-29T00:00:00' }]);
  let m;
  if ((m = p.match(/^\/api\/ReleveBancaire\/(\d+)\/lignes$/))) return json(lignes[Number(m[1])] || []);
  if (p === '/api/ReleveBancaire/reserve') {
    const b = await readBody(req); releveCalls.push(['reserve', b]);
    const l = Object.values(lignes).flat().find(x => x.id === b.ligneReleveId); const r = reglements.find(x => x.mv_Id === b.mvId);
    l.lettrage = 'A'; l.mV_ID = b.mvId; l.reservePar_UserId = 1; // même lettre « A » que R1 sur RX : collision
    r.lettrage = 'A'; r.releveEnteteId = l.releveBancaireEnteteId; r.reservePar_UserId = 1; r.reservePar_UserName = 'U1';
    return json({ lettrage: 'A' });
  }
  if (p === '/api/ReleveBancaire/release-batch') {
    const b = await readBody(req); releveCalls.push(['release-batch', b]);
    return json(b.map(x => {
      const l = Object.values(lignes).flat().find(y => y.id === x.ligneReleveId);
      if (l) { const mv = l.mV_ID; l.lettrage = null; l.mV_ID = null; l.reservePar_UserId = null; const r = reglements.find(z => z.mv_Id === mv); if (r) { r.lettrage = null; r.releveEnteteId = null; r.reservePar_UserId = null; } }
      return { ligneReleveId: x.ligneReleveId, success: true };
    }));
  }
  if (p === '/api/ReleveBancaire/validate') {
    const b = await readBody(req); validateBodies.push(b);
    for (const x of b) { for (const k of Object.keys(lignes)) lignes[k] = lignes[k].filter(l => l.id !== x.releveLigneId); reglements = reglements.filter(r => r.mv_Id !== x.grcReglementId); }
    return json({ success: true, successCount: b.length, errorCount: 0, errors: [] });
  }
  if (p === '/api/reglements' && req.method === 'GET') return json({ items: reglements, totalItems: reglements.length });
  res.writeHead(404); res.end();
});

const must = (cond, msg) => { if (!cond) throw new Error(msg); console.log('  OK :', msg); };

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
  page.on('pageerror', e => { console.log('  [pageerror]', e.message); process.exitCode = 1; });
  page.on('console', m => { if (m.type() === 'error') console.log('  [console:error]', m.text()); });
  let failed = false;
  try {
    await page.goto(`http://localhost:${PORT}`);
    await page.fill('input[type="text"]', 'U1'); await page.fill('input[type="password"]', 'x'); await page.click('button[type="submit"]');
    await page.waitForSelector('.rappro-title', { timeout: 10000 }).catch(() => {});
    if (await page.locator('.rappro-title').count() === 0) await page.locator('text=Rapprochement').first().click();
    await page.waitForSelector('.rappro-title');
    await page.selectOption('select.toolbar-select >> nth=0', '1');
    await page.waitForSelector('tr:has-text("VIR903")');
    // Les 2 grilles : filtre « lettrés » = tous pour voir R1
    const lettrageSel = page.locator('select').filter({ hasText: 'Tous' }).first();
    if (await lettrageSel.count()) await lettrageSel.selectOption({ label: 'Tous' }).catch(() => {});
    await page.waitForTimeout(400);

    console.log('\n--- S2 : collision (RY affiché, R1 réservé sur RX avec la même lettre A) ---');
    const r1 = page.locator('tr:has-text("VIR901")');
    must(await r1.count() === 1, 'R1 reste affiché (réservé ailleurs)');
    must((await r1.locator('svg.lucide-lock').count()) === 1, 'R1 : cadenas');
    must((await r1.innerText()).includes(`#${RX}`), `R1 : libellé #${RX}`);
    must((await r1.innerText()).includes(`${RX}-A`), `R1 : repère ${RX}-A`);
    must(await r1.locator('input[type="checkbox"]').count() === 0, 'R1 : sans case à cocher');
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'mock_s2_avant_reservation.png') });
    releveCalls.length = 0;
    await r1.locator('td').nth(2).click({ force: true }).catch(() => {});
    await page.waitForTimeout(300);
    must(releveCalls.length === 0, 'clic sur R1 : aucun appel réseau');

    // Réserver Y1 (2001) ↔ R3 (903) : clic ligne puis règlement
    await page.locator('tr:has-text("LIGNE 2001") input[type="checkbox"]').click();
    await page.locator('tr:has-text("VIR903") input[type="checkbox"]').click();
    await page.waitForTimeout(400);
    must(releveCalls.some(c => c[0] === 'reserve'), 'réservation Y1↔R3 envoyée');
    const r3 = page.locator('tr:has-text("VIR903")');
    must((await r3.innerText()).includes('A') && !(await r3.innerText()).includes('-A'), 'R3 : repère « A » nu (apparié)');
    must((await r3.locator('svg.lucide-lock').count()) === 0, 'R3 : pas de cadenas (apparié à Y1)');
    must((await r1.locator('svg.lucide-lock').count()) === 1, 'R1 toujours « réservé ailleurs » (jamais apparié à Y1)');
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'mock_s2_apres_reservation.png') });

    // Tri : R3 (apparié) avant R1 (ailleurs) avant libres
    const order = await page.locator('table').last().locator('tbody tr').evaluateAll(trs => trs.map(t => (t.innerText.match(/VIR\d+/) || [''])[0]));
    console.log('  ordre GRC :', order.join(' '));
    must(order.indexOf('VIR903') < order.indexOf('VIR901') && order.indexOf('VIR901') < order.indexOf('VIR904'), 'tri : apparié < réservé ailleurs < libre');

    console.log('\n--- S2 suite : clic sur la ligne Y1 → release-batch [Y1] seule ---');
    releveCalls.length = 0;
    await page.locator('tr:has-text("LIGNE 2001") input[type="checkbox"]').click();
    await page.waitForTimeout(400);
    must(releveCalls.length === 1 && releveCalls[0][0] === 'release-batch' && JSON.stringify(releveCalls[0][1]) === JSON.stringify([{ ligneReleveId: 2001 }]), 'release-batch avec [2001] uniquement');
    must(lignes[RX][0].lettrage === 'A' && lignes[RX][0].mV_ID === 901, 'X1 (RX) toujours réservée (MV_ID 901)');
    must((await page.locator('tr:has-text("VIR901") svg.lucide-lock').count()) === 1, 'R1 toujours verrouillé à l\'écran');

    console.log('\n--- S3 : Approuver avec collision ---');
    await page.locator('tr:has-text("LIGNE 2001") input[type="checkbox"]').click(); // ré-arme la sélection ligne
    await page.locator('tr:has-text("VIR903") input[type="checkbox"]').click();
    await page.waitForTimeout(400);
    await page.locator('tr:has-text("LIGNE 2002") input[type="checkbox"]').click();
    await page.locator('tr:has-text("VIR904") input[type="checkbox"]').click();
    await page.waitForTimeout(400);
    await page.locator('button:has-text("Approuver")').first().click();
    await page.waitForTimeout(600);
    const body = validateBodies[0] || [];
    console.log('  corps validate :', JSON.stringify(body.map(x => [x.releveLigneId, x.grcReglementId])));
    must(body.length === 2 && body.some(x => x.releveLigneId === 2001 && x.grcReglementId === 903) && body.some(x => x.releveLigneId === 2002 && x.grcReglementId === 904), 'validate = (2001,903) et (2002,904) exactement');
    must(await page.locator('tr:has-text("VIR901")').count() === 1, 'R1 reste affiché après Approuver');
    must(await page.locator('tr:has-text("VIR903")').count() === 0 && await page.locator('tr:has-text("VIR904")').count() === 0, 'R3 et R4 retirés');
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'mock_s3_apres_approuver.png') });

    console.log('\n--- S5 : ligne réservée sans règlement dans la grille → aucun validate, message, ligne conservée ---');
    lignes[RY].push(lig(2003, RY, 3000, { lettrage: 'B', mV_ID: 777, reservePar_UserId: 1 }));
    await page.selectOption('select.toolbar-select >> nth=1', String(RX));
    await page.waitForTimeout(300);
    await page.selectOption('select.toolbar-select >> nth=1', String(RY));
    await page.waitForSelector('tr:has-text("LIGNE 2003")');
    validateBodies.length = 0;
    await page.locator('button:has-text("Approuver")').first().click();
    await page.waitForTimeout(400);
    must(validateBodies.length === 0, 'aucun appel validate');
    const bodyTxt = await page.locator('body').innerText();
    must(bodyTxt.includes("1 ligne(s) réservée(s) n'ont pas de règlement dans la grille GRC (période ou filtre)"), 'message « sans règlement » affiché');
    must(await page.locator('tr:has-text("LIGNE 2003")').count() === 1, 'ligne 2003 conservée à l\'écran');
    console.log('\nRÉSULTAT : PASS');
  } catch (e) {
    failed = true; console.log('\nRÉSULTAT : FAIL —', e.message);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'mock_fail.png') }).catch(() => {});
  } finally {
    await browser.close(); server.close(); process.exit(failed || process.exitCode ? 1 : 0);
  }
})();
