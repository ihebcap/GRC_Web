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
  const tagS=tag(); const RA=entete(`T100-RA ${tagS}`,1), RB=entete(`T100-RB ${tagS}`,1); const montant=(3000+Math.floor(Math.random()*9000)/100+0.37).toFixed(2); const A3=ligne(RA,'A3',montant), B1=ligne(RB,'B1',7777.77);
  // caisse de l'utilisateur pour la modale
  const CAISSE=17; if (sql(`SELECT COUNT(*) FROM P_UTILISATEURCAISSE WHERE UT_Id=${uid} AND CA_Id=${CAISSE}`)==='0'){ sql(`INSERT P_UTILISATEURCAISSE (CA_Id, UT_Id, CU_IsDefaultCaisse, CU_Type) VALUES (${CAISSE}, ${uid}, 0, 0)`); cuIds.push(sql(`SELECT MAX(CU_Id) FROM P_UTILISATEURCAISSE WHERE UT_Id=${uid} AND CA_Id=${CAISSE}`)); }
  const J={RA,RB};   // J: S8-S12,S16 ; J2: S13 ; J3: S13 partiel ; J4: S15
  const RE_=0;
  // login: re-login pour prendre les nouvelles caisses dans le jeton
  tok = (await (await fetch(API + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', }, body: JSON.stringify({ Username: U, Password: P, SocieteId: 1 }) })).json()).token;
  console.log('IDS',JSON.stringify({RA,RB,A3,B1,montant}));
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
    console.log('--- S18 : Generer reglement depuis union (RA + RB) ---');
    const today = new Date().toISOString().slice(0, 10);
    const page = await newPage(); await open(page, { period: false });
    await setPeriod(page, today, today);
    await setChecked(page, [RA, RB]);
    ok(await nbLignes(page) === 2, 'union RA+RB : 2 lignes (A3, B1)');
    ok(/relevé/i.test(await relTable(page).locator('thead tr').first().innerText()), 'colonne « Relevé » visible');
    await shot(page, 's18_union_avant');
    nets(page);
    // Limite d'environnement : la liste COMPLÈTE des clients ERP expire (30 s) sur cette base de test → on ne simule QUE les 2 listes de suggestions ;
    // la génération (POST generer-reglement) et la validation du client par l'ERP restent réelles.
    await page.route('**/api/reference/clients/count', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"count":1}' }));
    await page.route('**/api/reference/clients', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ code: 'IMONEY08', intitule: 'CLIENT DE TEST (liste simulee)' }]) }));
    await ligRow(page, 'A3').locator('button:has-text("Générer règlement")').click();
    await page.waitForSelector('input[autocomplete="off"]', { timeout: 30000 });
    await page.waitForFunction(() => !document.body.innerText.includes('Chargement des clients'), null, { timeout: 40000 }).catch(() => {});
    await page.fill('input[autocomplete="off"]', 'IMONEY'); await wait(1500);
    await shot(page, 's18_debug'); console.log('  ul:', (await page.locator('ul').allInnerTexts()).map(t => t.slice(0, 80)).join(' || '));
    const li = page.locator('ul li', { hasText: '—' }).first(); await li.waitFor({ timeout: 30000 });
    const cli = (await li.innerText()).replace(/ +/g, ' '); await li.dispatchEvent('mousedown'); await wait(400);
    await page.selectOption('.modal-content select, select:has(option:text-matches("^Sélectionner une caisse"))', { index: 1 }).catch(async () => { await page.locator('select').last().selectOption({ index: 1 }); });
    await shot(page, 's18_modale_remplie');
    const before = Number(sql(`SELECT COUNT(*) FROM RT_MOUVEMENT WHERE MV_Montant=${montant}`));
    const respP = page.waitForResponse(r => r.url().includes('/ReleveBancaire/generer-reglement'), { timeout: 120000 }).catch(() => null);
    await page.click('button:has-text("Générer le règlement")', { timeout: 10000 });
    const gr = await respP; const grTxt = gr ? await gr.text() : '(pas de réponse)'; console.log('  réponse generer-reglement :', gr && gr.status(), grTxt.slice(0, 300));
    await wait(4000);
    const gen = nets(page).find(x => x.ep === 'generer-reglement');
    ok(gen && JSON.parse(gen.body).ligneReleveId === A3, `corps generer-reglement : ligneReleveId = A3 (${gen && gen.body}) — client « ${cli} »`);
    const after = Number(sql(`SELECT COUNT(*) FROM RT_MOUVEMENT WHERE MV_Montant=${montant}`));
    console.log('  toast :', (await body(page)).split(String.fromCharCode(10)).filter(t => /Règlement|Erreur|généré/i.test(t)).slice(0, 2).join(' | '));
    ok(after === before + 1, `un règlement de ${montant} a été créé par l'application (RT_MOUVEMENT : ${before} → ${after})`);
    const mv = sql(`SELECT TOP 1 CONCAT(MV_Id,'|',MV_Type,'|',BN_Id,'|',MV_Point,'|',MV_Annule) FROM RT_MOUVEMENT WHERE MV_Montant=${montant} ORDER BY MV_Id DESC`); console.log('  règlement créé (id|type|banque|pointé|annulé) :', mv);
    await shot(page, 's18_apres_generation');
    nets(page); await page.click('button:has-text("Auto")'); await wait(3500);
    const na = nets(page).find(x => x.ep === 'auto-reconcile');
    ok(na && JSON.parse(na.body).releveBancaireEnteteIds.length === 2, `Auto sur l'union (${na && na.body})`);
    const l = sql(`SELECT CONCAT(ISNULL(Lettrage,'-'),'/',ISNULL(CAST(MV_ID AS varchar),'-')) FROM RAPP_ReleveBancaire_Ligne WHERE Id=${A3}`);
    ok(l !== '-/-' && l.endsWith('/' + mv.split('|')[0]), `Auto propose et réserve A3 ↔ nouveau règlement (SELECT : ${l})`);
    ok((await ligRow(page, 'A3').locator('.lettrage-cell').innerText()).trim() === `${RA}-A`, `repère préfixé ${RA}-A affiché`);
    await shot(page, 's18_auto_a3');
    await libereTout({ A3 });
  } catch (e) { console.log('  EXCEPTION', e.message); fail++; }
  await browser.close(); server.close();
  if (cuIds.length) sql(`DELETE FROM P_UTILISATEURCAISSE WHERE CU_Id IN (${cuIds.join(',')})`);
  console.log(fail ? `RESULTAT : ${fail} KO` : 'RESULTAT : PASS'); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
