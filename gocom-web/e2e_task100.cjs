// TASK-100 — E2E Playwright contre l'API RÉELLE (base de TEST). Pas de mock, sauf page.route pour délais/erreurs (S9, S10) et ordre 9/12 (S16).
// Env : GRC_E2E_BASE_URL (API), GRC_E2E_USER1, GRC_E2E_PASS1, SQLCMDPASSWORD (+ GRC_E2E_SQLSERVER, GRC_E2E_DB). Aucun secret dans ce fichier.
// Front servi depuis ../deploy/wwwroot (npm run build) avec proxy /api → API réelle.
const http = require('http'), fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const API = process.env.GRC_E2E_BASE_URL, U = process.env.GRC_E2E_USER1, P = process.env.GRC_E2E_PASS1;
const SRV = process.env.GRC_E2E_SQLSERVER || 'DESKTOP-2VCUE93', DB = process.env.GRC_E2E_DB || 'GR_GOCOM';
if (!API || !U || !P || !process.env.SQLCMDPASSWORD) { console.error('Variables GRC_E2E_* / SQLCMDPASSWORD manquantes'); process.exit(2); }
const WWWROOT = path.resolve(__dirname, '../deploy/wwwroot'), PORT = 3510;
const EV = path.resolve(__dirname, '../tasks/VERIFY/TASK-100_evidence'); fs.mkdirSync(EV, { recursive: true });
const DAY = '2026-04-15';
let tok, uid, fail = 0, cuIds = [];
const ok = (c, m) => { console.log(c ? '  OK :' : '  KO :', m); if (!c) fail++; };
const wait = ms => new Promise(r => setTimeout(r, ms));
const settle = async page => { await wait(400); await page.waitForFunction(() => !document.body.innerText.includes('Mise à jour...'), null, { timeout: 40000 }).catch(() => {}); await wait(300); };
const attendRelevesCharges = page => page.waitForFunction(() => { const s = document.querySelector('.apercu-dropdown-trigger span'); return s && s.innerText !== 'Relevé associé…'; }, null, { timeout: 40000 }).catch(() => {});
const sql = q => execFileSync('sqlcmd', ['-I', '-S', SRV, '-U', 'sa', '-C', '-d', DB, '-W', '-h', '-1', '-s', '|', '-Q', 'SET NOCOUNT ON; ' + q], { encoding: 'latin1' }).trim();
const api = async (method, url, body) => {
  const r = await fetch(API + url, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { status: r.status, data: j };
};
const server = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (p === '/config.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end('window.GOCOM_CONFIG = { API_BASE: "/api" };'); }
  if (p.startsWith('/api/')) {
    const chunks = []; req.on('data', c => chunks.push(c));
    return req.on('end', async () => {
      const r = await fetch(API + req.url, { method: req.method, headers: { 'Content-Type': req.headers['content-type'] || 'application/json', ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}) }, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
      res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') || 'application/json' }); res.end(Buffer.from(await r.arrayBuffer()));
    });
  }
  const f = p === '/' ? path.join(WWWROOT, 'index.html') : path.join(WWWROOT, p);
  if (fs.existsSync(f) && fs.statSync(f).isFile()) { const e = path.extname(f); res.writeHead(200, { 'Content-Type': e === '.js' ? 'application/javascript' : e === '.css' ? 'text/css' : e === '.html' ? 'text/html; charset=utf-8' : 'application/octet-stream' }); return res.end(fs.readFileSync(f)); }
  res.writeHead(404); res.end();
});

// ---- jeu d'essai frais (relevés RAPP_* + règlements RÉELS existants, montant unique, jour DAY) ----
const used = new Set();
const candidats = n => {
  const rows = sql(`SET DATEFORMAT ymd; SELECT TOP ${n + used.size} m.MV_Id, m.MV_Montant, m.MV_Numero, m.CA_IdIn FROM RT_MOUVEMENT m WHERE BN_Id=1 AND MV_Domaine=0 AND MV_Point=0 AND MV_Annule=0 AND MV_Type=3 AND MV_Montant BETWEEN 100 AND 90000 AND MV_Date='${DAY}' AND (SELECT COUNT(*) FROM RT_MOUVEMENT x WHERE x.BN_Id=1 AND x.MV_Point=0 AND x.MV_Annule=0 AND x.MV_Montant=m.MV_Montant)=1 AND NOT EXISTS (SELECT 1 FROM RAPP_ReleveBancaire_Ligne l WHERE l.MV_ID=m.MV_Id) ORDER BY MV_Id`).split(/[\r\n]+/).map(l => l.split('|'));
  const out = rows.filter(r => !used.has(r[0])).slice(0, n); out.forEach(r => used.add(r[0]));
  if (out.length < n) throw new Error('pas assez de règlements candidats');
  const caisses = [...new Set(out.map(r => r[3]))];
  for (const c of caisses) if (sql(`SELECT COUNT(*) FROM P_UTILISATEURCAISSE WHERE UT_Id=${uid} AND CA_Id=${c}`) === '0') { sql(`INSERT P_UTILISATEURCAISSE (CA_Id, UT_Id, CU_IsDefaultCaisse, CU_Type) VALUES (${c}, ${uid}, 0, 0)`); cuIds.push(sql(`SELECT MAX(CU_Id) FROM P_UTILISATEURCAISSE WHERE UT_Id=${uid} AND CA_Id=${c}`)); }
  return out.map(r => ({ id: +r[0], montant: r[1], numero: r[2] }));
};
const entete = (titre, b) => +sql(`INSERT dbo.RAPP_ReleveBancaire_Entete (BanqueId, Titre, DateImport, ImportePar_UserId) VALUES (${b}, N'${titre}', GETDATE(), N'test'); SELECT SCOPE_IDENTITY();`).split(/[\r\n]+/).pop();
const ligne = (e, lib, credit, debit = 0, valide = false) => +sql(`INSERT dbo.RAPP_ReleveBancaire_Ligne (ReleveBancaireEnteteId, DateOperation, DateValeur, Libelle, Reference, Code, Debit, Credit, MontantReel, DateValidation) VALUES (${e}, GETDATE(), GETDATE(), N'T100 ${lib}', N'${lib}', N'${lib}', ${debit}, ${credit}, ${credit || debit}, ${valide ? 'GETDATE()' : 'NULL'}); SELECT SCOPE_IDENTITY();`).split(/[\r\n]+/).pop();
const tag = () => new Date().toTimeString().slice(0, 8);
// lot : RA (A1,A2,A3 sans règlement,A4), RB (B1,B2,B3=même montant que A4), G1..G5 (G5 = montant de A4/B3)
const lot = (avecRC = false) => {
  const t = tag(), g = candidats(5);
  const RA = entete(`T100-RA ${t}`, 1), RB = entete(`T100-RB ${t}`, 1);
  const L = { A1: ligne(RA, 'A1', g[0].montant), A2: ligne(RA, 'A2', g[1].montant), A3: ligne(RA, 'A3', 3003.11), A4: ligne(RA, 'A4', g[4].montant), B1: ligne(RB, 'B1', g[2].montant), B2: ligne(RB, 'B2', g[3].montant), B3: ligne(RB, 'B3', g[4].montant) };
  let RC = null; if (avecRC) { RC = entete(`T100-RC ${t}`, 1); ligne(RC, 'C1', 6001.17, 0, true); ligne(RC, 'Cd', 0, 700); }
  return { RA, RB, RC, L, G: g, t };
};

(async () => {
  const lg = await (await fetch(API + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ Username: U, Password: P, SocieteId: 1 }) })).json();
  uid = lg.no; console.log(`U1 = ${U} (id ${uid}, admin=${lg.isAdmin}) ; base ${sql('SELECT DB_NAME()+N\'@\'+@@SERVERNAME')} ; RCSI=${sql('SELECT is_read_committed_snapshot_on FROM sys.databases WHERE name=DB_NAME()')}`);
  // libère d'éventuelles réservations de tests précédents
  sql(`UPDATE l SET Lettrage=NULL, MV_ID=NULL, ReservePar_UserId=NULL, DateReservation=NULL FROM RAPP_ReleveBancaire_Ligne l JOIN RAPP_ReleveBancaire_Entete e ON e.Id=l.ReleveBancaireEnteteId WHERE e.Titre LIKE N'T100-%' AND l.DateValidation IS NULL`);
  const J = lot(true), J2 = lot(true), J3 = lot(true), J4 = lot(true);   // J: S8-S12,S16 ; J2: S13 ; J3: S13 partiel ; J4: S15
  const RD = entete(`T100-RD ${tag()}`, 2); ligne(RD, 'D1', 1234.56);
  const RE = entete(`T100-RE ${tag()}`, 1); const gE = candidats(2); const E1 = ligne(RE, 'E1', gE[0].montant), E2 = ligne(RE, 'E2', gE[1].montant);
  const RE_ = RE; // créé en dernier → relevé le plus récent de la banque 1 (coché par défaut)
  // login: re-login pour prendre les nouvelles caisses dans le jeton
  tok = (await (await fetch(API + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', }, body: JSON.stringify({ Username: U, Password: P, SocieteId: 1 }) })).json()).token;
  console.log('IDS', JSON.stringify({ J: { RA: J.RA, RB: J.RB, RC: J.RC, L: J.L, G: J.G.map(x => x.id) }, J2: { RA: J2.RA, RB: J2.RB }, J3: { RA: J3.RA, RB: J3.RB }, J4: { RA: J4.RA, RB: J4.RB }, RD, RE: RE_, E1, E2, gE: gE.map(x => x.id) }));
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch({ headless: true });
  const shot = async (page, n) => page.screenshot({ path: path.join(EV, `${n}.png`) });
  const newPage = async () => {
    const ctx = await browser.newContext({ viewport: { width: 1700, height: 1000 } }); const page = await ctx.newPage();
    page.net = []; page.resp = [];
    page.on('request', r => { if (r.method() === 'POST' && r.url().includes('/ReleveBancaire/')) page.net.push({ ep: r.url().split('/ReleveBancaire/')[1], body: r.postData() }); });
    page.on('response', async r => { if (r.url().includes('/ReleveBancaire/validate')) page.resp.push(await r.json().catch(() => null)); });
    page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
    return page;
  };
  const nets = page => page.net.splice(0);
  const open = async (page, { banque = '1', period = true } = {}) => {
    // l'API/SQL distant est par moments instable (500 « pre-login handshake ») : on recharge jusqu'à 5 fois si les banques ne se chargent pas
    for (let essai = 1; essai <= 5; essai++) {
      await page.goto(`http://localhost:${PORT}`);
      await wait(1000);
      if (await page.locator('input[type="password"]').count() > 0) { await page.fill('input[type="text"]', U); await page.fill('input[type="password"]', P); await page.click('button[type="submit"]'); }
      await page.waitForSelector('.rappro-title', { timeout: 15000 }).catch(() => {});
      if (await page.locator('.rappro-title').count() === 0) await page.locator('text=Rapprochement').first().click();
      await page.waitForSelector('.rappro-title');
      const okBanques = await page.waitForFunction(b => [...document.querySelector('select.toolbar-select').options].some(o => o.value === b), banque, { timeout: 15000 }).then(() => true).catch(() => false);
      if (okBanques) break; console.log(`  (essai ${essai} : banques non chargées, nouvel essai)`); await wait(4000);
    }
    for (let essai = 1; essai <= 5; essai++) {
      await page.selectOption('select.toolbar-select >> nth=0', banque);
      const okRel = await page.waitForFunction(() => { const s = document.querySelector('.apercu-dropdown-trigger span'); return s && s.innerText !== 'Relevé associé…'; }, null, { timeout: 15000 }).then(() => true).catch(() => false);
      await settle(page); if (okRel) break;
      console.log(`  (essai ${essai} : relevés non chargés, nouvel essai)`); await wait(4000); await page.selectOption('select.toolbar-select >> nth=0', ''); await wait(500);
    }
    await page.selectOption('select.toolbar-select >> nth=1', 'tous');
    if (period) await setPeriod(page, DAY, DAY);
  };
  const refresh = async page => { const w = page.waitForResponse(r => r.url().includes('/api/reglements?') && r.request().method() === 'GET', { timeout: 40000 }); await page.click('button:has-text("Actualiser")'); const r = await w; await settle(page); return r.status(); };
  const setPeriod = async (page, du, au) => {
    for (let essai = 1; essai <= 5; essai++) {
      await page.fill('input[type="date"] >> nth=0', du); await page.fill('input[type="date"] >> nth=1', au);
      const st = await refresh(page).catch(() => 0); if (st === 200) return;
      console.log(`  (chargement GRC : HTTP ${st}, nouvel essai ${essai})`); await wait(4000);
      await page.fill('input[type="date"] >> nth=0', '2026-01-01'); await refresh(page).catch(() => 0);
    }
  };
  const reloadGrc = async page => { await setPeriod(page, '2026-04-14', DAY); await setPeriod(page, DAY, DAY); };
  const panelItem = (page, id) => page.locator('.apercu-dropdown-panel .apercu-dropdown-item', { hasText: `#${id} ·` });
  const openCombo = async page => { if (await page.locator('.apercu-dropdown-panel').count() === 0) { await page.click('.apercu-dropdown-trigger'); await page.waitForSelector('.apercu-dropdown-panel'); } };
  const closeCombo = async page => { await page.mouse.move(5, 500); await page.mouse.down(); await page.mouse.up(); await wait(150); };
  const setChecked = async (page, ids, { fast = false } = {}) => {
    await openCombo(page);
    const all = await page.locator('.apercu-dropdown-panel .apercu-dropdown-item').evaluateAll(els => els.map(e => ({ t: e.innerText, c: e.querySelector('input').checked })));
    for (const it of all) {
      const id = +it.t.match(/#(\d+) ·/)[1]; const want = ids.includes(id);
      if (want !== it.c) { await panelItem(page, id).click(); if (!fast) await wait(150); }
    }
    await closeCombo(page); if (!fast) await settle(page);
  };
  const comboIds = page => page.locator('.apercu-dropdown-trigger').click().then(() => page.locator('.apercu-dropdown-panel .apercu-dropdown-item').evaluateAll(els => els.map(e => ({ id: +e.innerText.match(/#(\d+) ·/)[1], c: e.querySelector('input').checked })))).then(async r => { await closeCombo(page); return r; });
  const relTable = page => page.locator('table').first(), grcTable = page => page.locator('table').last();
  const ligRow = (page, k) => relTable(page).locator('tbody tr', { hasText: `T100 ${k}` });
  const grcRow = (page, num) => grcTable(page).locator('tbody tr', { hasText: num });
  const body = page => page.locator('body').innerText();
  const click = row => row.locator('input[type="checkbox"]').first().click();
  const nbLignes = async page => relTable(page).locator('tbody tr').count();
  const sel = ids => sql(`SELECT STRING_AGG(CONCAT(Id,':',ISNULL(Lettrage,'-'),'/',ISNULL(CAST(MV_ID AS varchar),'-')),' ') FROM RAPP_ReleveBancaire_Ligne WHERE Id IN (${ids})`);
  const ids = o => Object.values(o).join(',');
  const libereTout = async L => api('POST', '/api/ReleveBancaire/release-batch', Object.values(L).map(i => ({ ligneReleveId: i })));

  try {
    // ================= S19 combo (panneau, libellés, recherche, désactivé) =================
    console.log('\n--- S19 : combo ---');
    let page = await newPage();
    await open(page, { period: false });
    await page.selectOption('select.toolbar-select >> nth=0', ''); await wait(800);
    ok(await page.locator('.apercu-dropdown-trigger').evaluate(e => e.style.cursor === 'not-allowed'), 'combo désactivé (not-allowed) sans banque');
    await page.click('.apercu-dropdown-trigger'); await wait(300); ok(await page.locator('.apercu-dropdown-panel').count() === 0, "clic sans banque : le panneau ne s'ouvre pas");
    await page.selectOption('select.toolbar-select >> nth=0', '1'); await attendRelevesCharges(page); await settle(page);
    let st = await comboIds(page); ok(st.length > 3 && st.filter(x => x.c).length === 1 && st.find(x => x.c).id === RE_, `seul le relevé le plus récent (RE #${RE_}) est coché (${st.filter(x => x.c).map(x => '#' + x.id)})`);
    ok(!st.some(x => x.id === J.RC), `RC #${J.RC} (100 % approuvé + débit) n'est PAS listé`);
    ok(st.some(x => x.id === J.RA) && st.some(x => x.id === J.RB), 'RA et RB listés');
    await page.click('.apercu-dropdown-trigger'); await page.waitForSelector('.apercu-dropdown-panel');
    const lbl = await page.locator('.apercu-dropdown-panel .apercu-dropdown-item').first().innerText(); ok(/^#\d+ · .+ - \d/.test(lbl), `libellé « #id · titre - date » (${lbl})`);
    await page.fill('.apercu-dropdown-search-input', `#${J.RA} ·`); await wait(300); ok(await page.locator('.apercu-dropdown-panel .apercu-dropdown-item').count() === 1, 'recherche filtre la liste');
    await shot(page, 's19_combo_ouvert_recherche'); await page.fill('.apercu-dropdown-search-input', 'T100-R'); await wait(200);
    await page.click('.apercu-dropdown-toggle-all'); await wait(400);
    const nb = await page.locator('.apercu-dropdown-panel .apercu-dropdown-item input:checked').count(); ok(nb >= 10, `« (TOUT SÉLECTIONNER) » sur le résultat filtré (${nb} cochés)`);
    await page.click('.apercu-dropdown-toggle-all'); await wait(300); await shot(page, 's19_tout_selectionner'); await closeCombo(page);
    const pbox = await (async () => { await page.click('.apercu-dropdown-trigger'); await page.waitForSelector('.apercu-dropdown-panel'); const b = await page.locator('.apercu-dropdown-panel').boundingBox(); const vp = page.viewportSize(); await shot(page, 's19_panneau_non_rogne'); await closeCombo(page); return { b, vp }; })();
    ok(pbox.b.x >= 0 && pbox.b.y >= 0 && pbox.b.x + pbox.b.width <= pbox.vp.width && pbox.b.y + pbox.b.height <= pbox.vp.height, `panneau entièrement visible (non rogné) : ${JSON.stringify(pbox.b)}`);
    await page.close();

    // ================= S8 mono + S11/S12 (2 relevés) + S16 colonne =================
    console.log('\n--- S8 : non-régression mono (RA seul) ---');
    page = await newPage(); await open(page);
    await setChecked(page, [J.RA]);
    ok(!/relevé/i.test(await relTable(page).locator('thead tr').first().innerText()), 'pas de colonne « Relevé » (1 seul relevé)');
    const nA = await nbLignes(page); ok(nA === 4, `4 lignes crédit (A1..A4) — pas de Ad débit (${nA})`);
    console.log('  compteur :', (await body(page)).match(/\d+ élément\(s\) affiché\(s\)/g));
    await shot(page, 's8_mono_avant_reservation');
    await click(ligRow(page, 'A1')); await click(grcRow(page, J.G[0].numero)); await wait(1200);
    const lA = sql(`SELECT ISNULL(Lettrage,'') FROM RAPP_ReleveBancaire_Ligne WHERE Id=${J.L.A1}`);
    ok(lA === 'A', `réservation manuelle mono : lettre « ${lA} »`);
    ok((await ligRow(page, 'A1').locator('.lettrage-cell').innerText()).trim() === 'A', 'repère nu « A » (sans préfixe) côté relevé');
    ok((await grcRow(page, J.G[0].numero).locator('.lettrage-cell').innerText()).trim() === 'A', 'repère nu « A » côté GRC');
    await shot(page, 's8_mono_reserve');
    await page.click('button:has-text("Dérapprocher")'); await wait(1200); ok(sel(J.L.A1) === `${J.L.A1}:-/-`, 'Dérapprocher mono : libre');
    nets(page);
    await page.click('button:has-text("Auto")'); await wait(2000); ok(/3 correspondance/.test(await body(page)), 'Auto mono [RA] : 3 correspondances (A1,A2,A4)');
    const nAuto = nets(page).find(x => x.ep === 'auto-reconcile'); ok(nAuto && JSON.parse(nAuto.body).releveBancaireEnteteIds.length === 1 && JSON.parse(nAuto.body).releveBancaireEnteteIds[0] === J.RA, `corps auto = releveBancaireEnteteIds:[RA] (${nAuto && nAuto.body})`);
    await page.click('button:has-text("Dérapprocher")'); await wait(1200);

    console.log('\n--- S11 : manuel sur 2 relevés (RA + RB) / S16 colonne Relevé ---');
    await setChecked(page, [J.RA, J.RB]);
    ok(await nbLignes(page) === 7, `union : 7 lignes (${await nbLignes(page)})`);
    const thTxt = await relTable(page).locator('thead tr').first().innerText(); ok(/relevé/i.test(thTxt), 'colonne « Relevé » visible (en-tête)');
    ok((await ligRow(page, 'A1').innerText()).includes(`T100-RA ${J.t} (#${J.RA})`), `libellé de colonne « titre (#id) » : ${(await ligRow(page, 'A1').innerText()).replace(/\s+/g, ' ').slice(0, 90)}`);
    await click(ligRow(page, 'A1')); await click(grcRow(page, J.G[0].numero)); await wait(1000);
    await click(ligRow(page, 'B1')); await click(grcRow(page, J.G[2].numero)); await wait(1000);
    const rep = async (row) => (await row.locator('.lettrage-cell').innerText()).trim();
    ok(await rep(ligRow(page, 'A1')) === `${J.RA}-A` && await rep(ligRow(page, 'B1')) === `${J.RB}-A`, `repères relevé ${J.RA}-A / ${J.RB}-A`);
    ok(await rep(grcRow(page, J.G[0].numero)) === `${J.RA}-A` && await rep(grcRow(page, J.G[2].numero)) === `${J.RB}-A`, 'mêmes repères préfixés côté GRC');
    const colA = await ligRow(page, 'A1').evaluate(e => e.style.backgroundColor), colB = await ligRow(page, 'B1').evaluate(e => e.style.backgroundColor);
    console.log(`  couleurs de fond : A1=${colA} B1=${colB} ${colA === colB ? '(coïncidence de teinte : 15 teintes)' : '(distinctes)'}`);
    await shot(page, 's11_deux_releves_reperes_prefixes');
    // filtre Repère : valeurs préfixées
    await relTable(page).locator('thead th', { hasText: 'Repère' }).locator('button, svg, [class*="filter"]').first().click().catch(() => {}); await wait(400);
    const opts = await page.locator('body').innerText(); ok(opts.includes(`${J.RA}-A`) && opts.includes(`${J.RB}-A`), 'filtre « Repère » : valeurs préfixées listées');
    await shot(page, 's16_filtre_reperes'); await page.keyboard.press('Escape'); await page.mouse.click(5, 500); await wait(300);
    nets(page); await click(ligRow(page, 'A1')); await wait(1200);
    const nRel = nets(page); ok(nRel.length === 1 && nRel[0].ep === 'release-batch' && nRel[0].body === JSON.stringify([{ ligneReleveId: J.L.A1 }]), `clic A1 → release-batch [A1] seul (${nRel.map(x => x.ep + ' ' + x.body)})`);
    ok(sel(`${J.L.A1},${J.L.B1}`) === `${J.L.A1}:-/- ${J.L.B1}:A/${J.G[2].id}`, `SELECT : A1 libre, B1/G3 intacts (${sel(`${J.L.A1},${J.L.B1}`)})`);
    await click(ligRow(page, 'A1')); await click(grcRow(page, J.G[0].numero)); await wait(1000);  // re-réserve A1↔G1
    // S15 : décocher RB avec réservations en cours
    console.log('\n--- S15 : décocher RB avec des réservations en cours ---');
    await setChecked(page, [J.RA]);
    ok(await ligRow(page, 'B1').count() === 0, 'les lignes de RB disparaissent');
    ok(await rep(ligRow(page, 'A1')) === 'A', 'RA seul : lettre nue « A »');
    const g3 = grcRow(page, J.G[2].numero);
    ok(await g3.locator('svg.lucide-lock').count() === 1 && (await g3.innerText()).includes(`#${J.RB}`) && (await rep(g3)) === `${J.RB}-A`, `G3 « réservé ailleurs » : cadenas #${J.RB}, repère ${J.RB}-A`);
    nets(page); await g3.locator('td').nth(3).click({ force: true }).catch(() => {}); await wait(400); ok(nets(page).length === 0, 'clic sur G3 : aucun appel');
    ok(sel(J.L.B1) === `${J.L.B1}:A/${J.G[2].id}`, 'SELECT : B1 toujours réservée');
    await shot(page, 's15_rb_decoche_reserve_ailleurs');
    await setChecked(page, [J.RA, J.RB]);
    const g3b = grcRow(page, J.G[2].numero); ok(await g3b.locator('svg.lucide-lock').count() === 0 && await g3b.locator('input[type="checkbox"]:checked').count() === 1, 'RB recoché : G3 de nouveau apparié (case cochée, sans cadenas)');
    await shot(page, 's15_rb_recoche_reapparie');
    await libereTout(J.L);

    console.log('\n--- S12 : Auto + Dérapprocher sur 2 relevés ---');
    nets(page); await page.click('button:has-text("Auto")'); await wait(2500);
    ok(/4 correspondance/.test(await body(page)), 'toast « 4 correspondance(s) »');
    const na = nets(page).find(x => x.ep === 'auto-reconcile'); ok(na && JSON.parse(na.body).releveBancaireEnteteIds.length === 2, `corps auto = 2 relevés (${na && na.body})`);
    ok(sel(`${J.L.A3},${J.L.A4},${J.L.B3}`) === `${J.L.A3}:-/- ${J.L.A4}:-/- ${J.L.B3}:-/-`, 'A3, A4, B3 restent libres ; G5 attribué à personne');
    const reps = [await rep(ligRow(page, 'A1')), await rep(ligRow(page, 'A2')), await rep(ligRow(page, 'B1')), await rep(ligRow(page, 'B2'))]; console.log('  repères :', reps.join(' '));
    ok(reps.join() === `${J.RA}-A,${J.RA}-B,${J.RB}-A,${J.RB}-B`, 'repères RA-A, RA-B, RB-A, RB-B');
    await shot(page, 's12_auto_deux_releves');
    await page.click('button:has-text("Dérapprocher")'); await wait(1500);
    ok(Number(sql(`SELECT COUNT(*) FROM RAPP_ReleveBancaire_Ligne WHERE Id IN (${ids(J.L)}) AND (MV_ID IS NOT NULL OR Lettrage IS NOT NULL)`)) === 0, 'Dérapprocher : tout libre (SELECT)');

    // ================= S16 colonne Relevé, filtre, reset =================
    console.log('\n--- S16 : colonne Relevé / filtres remis à zéro ---');
    await relTable(page).locator('thead th', { hasText: /^Relevé/ }).locator('button, svg').first().click().catch(() => {}); await wait(400);
    const filtTxt = await body(page); ok(filtTxt.includes(`(#${J.RA})`) && filtTxt.includes(`(#${J.RB})`), 'filtre liste « Relevé » : libellés titre (#id)'); await shot(page, 's16_filtre_releve'); await page.keyboard.press('Escape'); await page.mouse.click(5, 500);
    await setChecked(page, [J.RA]); ok(!/relevé/i.test(await relTable(page).locator('thead tr').first().innerText()), 'retour à 1 relevé : colonne « Relevé » disparue');
    await page.close();

    // ================= S9 sélections rapides =================
    console.log('\n--- S9 : sélections rapides, jamais de lot périmé ---');
    page = await newPage(); await open(page);
    await page.route('**/api/ReleveBancaire/lignes', async route => { const ids = route.request().postDataJSON().releveBancaireEnteteIds; if (ids.length === 1 && ids[0] === J.RA) await wait(3000); await route.continue(); });
    await openCombo(page);
    await panelItem(page, RE_).click(); await panelItem(page, J.RA).click(); await panelItem(page, J.RB).click(); await closeCombo(page);   // RA (retardé 3 s) puis RB aussitôt
    await wait(6000);
    ok(await ligRow(page, 'A1').count() === 1 && await ligRow(page, 'B1').count() === 1 && await nbLignes(page) === 7, `après toutes les réponses : lignes de RA ET RB (${await nbLignes(page)} lignes)`);
    await shot(page, 's9_ra_puis_rb_apres_reponses');
    await page.unroute('**/api/ReleveBancaire/lignes');
    await page.route('**/api/ReleveBancaire/lignes', async route => { const ids = route.request().postDataJSON().releveBancaireEnteteIds; if (ids.length === 2) await wait(3000); await route.continue(); });
    await setChecked(page, [J.RA]);   // RA seul chargé
    await openCombo(page); await panelItem(page, J.RB).click(); await panelItem(page, J.RB).click(); await closeCombo(page);  // coche RB (retardé) puis décoche aussitôt
    await wait(6000);
    ok(await ligRow(page, 'A1').count() === 1 && await ligRow(page, 'B1').count() === 0 && await nbLignes(page) === 4, `décocher RB pendant un chargement : affichage final = RA seul (${await nbLignes(page)} lignes)`);
    await shot(page, 's9_decoche_pendant_chargement');

    // ================= S10 échec de chargement =================
    console.log('\n--- S10 : échec de chargement ---');
    await page.unroute('**/api/ReleveBancaire/lignes');
    let mode = 500;
    await page.route('**/api/ReleveBancaire/lignes', route => route.fulfill({ status: mode, contentType: 'application/json', body: '{}' }));
    await setChecked(page, [J.RA, J.RB]);
    ok(await nbLignes(page) === 0 && /Impossible de charger les lignes des relevés sélectionnés\./.test(await body(page)), '500 : grille vidée + toast « Impossible de charger… »'); await shot(page, 's10_500');
    await wait(3500); mode = 403; await setChecked(page, [J.RA]);
    ok(await nbLignes(page) === 0 && /Accès refusé à l'un des relevés sélectionnés\./.test(await body(page)), '403 : grille vidée + toast « Accès refusé… »'); await shot(page, 's10_403');
    await page.unroute('**/api/ReleveBancaire/lignes'); await wait(3500);
    await setChecked(page, [J.RA, J.RB]); ok(await nbLignes(page) === 7, 'retour à une sélection valide : rechargement normal (7 lignes)');
    await page.close();

    // ================= S13 Approuver sur l'union =================
    console.log('\n--- S13 : Approuver sur l\'union (4 paires) ---');
    page = await newPage(); await open(page); await setChecked(page, [J2.RA, J2.RB]);
    await page.click('button:has-text("Auto")'); await wait(2500); nets(page); page.resp.length = 0;
    await page.click('button:has-text("Approuver")'); await wait(3500);
    const v = nets(page).find(x => x.ep === 'validate'); const pairs = v ? JSON.parse(v.body) : [];
    ok(pairs.length === 4 && pairs.filter(p => [J2.L.A1, J2.L.A2].includes(p.releveLigneId)).length === 2 && pairs.filter(p => [J2.L.B1, J2.L.B2].includes(p.releveLigneId)).length === 2, `corps validate = 4 paires (2 RA + 2 RB) : ${JSON.stringify(pairs.map(p => [p.releveLigneId, p.grcReglementId]))}`);
    ok(page.resp[0] && page.resp[0].successCount === 4, `réponse validate successCount=4 (${JSON.stringify(page.resp[0] && { s: page.resp[0].success, ok: page.resp[0].successCount, ko: page.resp[0].errorCount })})`);
    ok(await nbLignes(page) === 3 && await grcRow(page, J2.G[0].numero).count() === 0, `les 4 lignes et règlements disparaissent (reste ${await nbLignes(page)} lignes : A3, A4, B3)`);
    const cb = await comboIds(page); ok(cb.some(x => x.id === J2.RA) && cb.some(x => x.id === J2.RB), 'RA et RB restent dans le combo (A3/A4/B3 non approuvées)');
    console.log('  SQL :', sql(`SELECT STRING_AGG(CONCAT(Id,':',CASE WHEN DateValidation IS NULL THEN 'en cours' ELSE 'valide' END),' ') FROM RAPP_ReleveBancaire_Ligne WHERE Id IN (${J2.L.A1},${J2.L.A2},${J2.L.B1},${J2.L.B2})`));
    await shot(page, 's13_approuve_union'); await page.close();

    console.log('\n--- S13 variante : échec partiel (G2 pointé par ailleurs) ---');
    page = await newPage(); await open(page); await setChecked(page, [J3.RA, J3.RB]);
    await click(ligRow(page, 'A2')); await click(grcRow(page, J3.G[1].numero)); await wait(900);
    await click(ligRow(page, 'B2')); await click(grcRow(page, J3.G[3].numero)); await wait(900);
    const pt = await api('POST', '/api/rapprochement', [{ reglementId: J3.G[1].id, extraitNum: 'T100', dateValeur: null }]);
    console.log('  pointage externe de G2 :', pt.status, JSON.stringify(pt.data).slice(0, 120), '| MV_Point =', sql(`SELECT MV_Point FROM RT_MOUVEMENT WHERE MV_Id=${J3.G[1].id}`));
    nets(page); page.resp.length = 0; await page.click('button:has-text("Approuver")'); await wait(1800); const toast13 = await body(page); await wait(1500);
    ok(page.resp[0] && JSON.stringify(page.resp[0].failedLigneIds) === JSON.stringify([J3.L.A2]), `failedLigneIds = [A2] (${JSON.stringify(page.resp[0] && page.resp[0].failedLigneIds)})`);
    ok(await ligRow(page, 'B2').count() === 0 && await ligRow(page, 'A2').count() === 1, 'B2↔G4 approuvée (retirée), A2 reste');
    ok(/Validation terminée avec des erreurs/.test(toast13), 'message d\'erreur dans le toast'); await shot(page, 's13_echec_partiel');
    const cb3 = await comboIds(page); ok(cb3.some(x => x.id === J3.RA), 'RA reste listé');
    await page.close();

    // ================= S14 relevé 100 % approuvé disparaît =================
    console.log('\n--- S14 : relevé 100 % approuvé disparaît du combo sans rechargement ---');
    page = await newPage(); await open(page); await setChecked(page, [RE_]);
    ok(await nbLignes(page) === 2, 'RE seul : 2 lignes'); await page.click('button:has-text("Auto")'); await wait(2500);
    await page.click('button:has-text("Approuver")'); await wait(3500);
    const cb14 = await comboIds(page); ok(!cb14.some(x => x.id === RE_), `RE #${RE_} disparaît du combo (sans rechargement)`); ok(cb14.filter(x => x.c).length === 0, 'et de la sélection');
    ok(await nbLignes(page) === 0 && !/Erreur|Impossible/.test(await body(page)), 'grille Relevé vide, pas de message d\'erreur'); ok(!cb14.some(x => x.id === J.RC), 'RC jamais listé');
    await shot(page, 's14_re_disparait'); await page.close();

    // ================= S17 changement de banque =================
    console.log('\n--- S17 : changement de banque ---');
    page = await newPage(); await open(page); await setChecked(page, [J4.RA, J4.RB]);
    await page.selectOption('select.toolbar-select >> nth=0', '2'); await wait(2500);
    let c17 = await comboIds(page); ok(c17.filter(x => x.c).length === 1 && c17.find(x => x.c).id === RD && !c17.some(x => x.id === J4.RA), `banque 2 : sélection remise à zéro, seul RD #${RD} coché`);
    ok(!(await body(page)).includes('T100 A1'), 'aucune ligne de l\'ancienne banque affichée'); await shot(page, 's17_banque2');
    await page.selectOption('select.toolbar-select >> nth=0', '1'); await wait(2500);
    c17 = await comboIds(page); ok(c17.filter(x => x.c).length === 1, `retour banque 1 : un seul relevé coché (#${c17.find(x => x.c).id}, le plus récent)`); ok(await ligRow(page, 'A1').count() === 0, 'aucune ligne de RA affichée (RA non coché)');
    await page.close();

    // ================= S16 ordre 9 / 12 (mocks) =================
    console.log('\n--- S16 : ordre 9-A avant 12-A (mocks) ---');
    page = await newPage();
    const lignesMock = [9, 12].map((id, i) => ({ id: 900 + id, releveBancaireEnteteId: id, dateOperation: '2026-04-15T00:00:00', dateValeur: '2026-04-15T00:00:00', libelle: `MOCK ${id}`, reference: '', code: '', credit: 100 + i, debit: 0, lettrage: 'A', mV_ID: 70000 + id, reservePar_UserId: uid, reservePar_UserName: 'x', dateReservation: null }));
    await page.route('**/api/ReleveBancaire?banqueId=*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([9, 12].map(id => ({ id, titre: `MOCK-${id}`, banqueId: 1, dateImport: '2026-04-15T00:00:00' }))) }));
    await page.route('**/api/ReleveBancaire/lignes', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(lignesMock.slice().reverse()) }));
    await page.route('**/api/reglements?**', async route => { let r; for (let i = 0; i < 5 && !(r && r.ok()); i++) { r = await route.fetch().catch(() => null); if (!r || !r.ok()) await wait(3000); } if (!r || !r.ok()) return route.abort(); const j = await r.json(); const items = j.items; [12, 9].forEach((id, i) => { if (items[i]) { items[i].no = 70000 + id; items[i].lettrage = 'A'; items[i].releveEnteteId = id; items[i].reservePar_UserId = uid; } }); await route.fulfill({ response: r, json: j }); });
    await open(page); await setChecked(page, [9, 12]);
    const relTxt = (await relTable(page).locator('tbody').innerText()).replace(/\s+/g, ' '), grcTxt = (await grcTable(page).locator('tbody').innerText()).replace(/\s+/g, ' ');
    ok(relTxt.indexOf('9-A') >= 0 && relTxt.indexOf('9-A') < relTxt.indexOf('12-A'), `grille Relevé : 9-A avant 12-A`);
    ok(grcTxt.indexOf('9-A') >= 0 && grcTxt.indexOf('9-A') < grcTxt.indexOf('12-A'), 'grille GRC : 9-A avant 12-A'); await shot(page, 's16_ordre_9_12');
    await page.close();
  } catch (e) { console.log('  EXCEPTION', e.message); fail++; }
  await browser.close(); server.close();
  if (cuIds.length) sql(`DELETE FROM P_UTILISATEURCAISSE WHERE CU_Id IN (${cuIds.join(',')})`);
  console.log(fail ? `\nRÉSULTAT : ${fail} KO` : '\nRÉSULTAT : PASS'); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
