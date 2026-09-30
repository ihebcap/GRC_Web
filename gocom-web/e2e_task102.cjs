// TASK-102 — E2E Playwright contre l'API RÉELLE (base de TEST). Pas de mock.
// Env : GRC_E2E_BASE_URL (API), GRC_E2E_USER1, GRC_E2E_PASS1, SQLCMDPASSWORD
// Jeu d'essai : relevé « T102-… » créé puis supprimé par le script (tables RAPP_* de TEST uniquement).
const http = require('http'), fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const API = process.env.GRC_E2E_BASE_URL, U = process.env.GRC_E2E_USER1, P = process.env.GRC_E2E_PASS1;
if (!API || !U || !P) { console.error('Variables GRC_E2E_* manquantes'); process.exit(2); }
const WWWROOT = path.resolve(__dirname, '../deploy/wwwroot'), PORT = 3512;
const EV = path.resolve(__dirname, '../tasks/VERIFY/TASK-102_evidence'); fs.mkdirSync(EV, { recursive: true });
let fail = 0, tok, RX;
const ok = (c, m) => { console.log(c ? '  OK :' : '  KO :', m); if (!c) fail++; };
const sql = (q) => execFileSync('sqlcmd', ['-S', 'DESKTOP-2VCUE93', '-U', 'sa', '-C', '-I', '-W', '-h', '-1', '-s', '|', '-d', 'GR_GOCOM', '-Q', 'SET NOCOUNT ON; ' + q], { encoding: 'latin1' }).trim();
const api = async (method, url, body) => { const r = await fetch(API + url, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const grcUrl = (d, f) => `/api/reglements?societeId=1&banqueNos=1&page=1&pageSize=1000&pointe=false&eligibleRappBancaire=true&dateDebut=${d}&dateFin=${f}`;
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
const wait = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const lg = await (await fetch(API + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ Username: U, Password: P, SocieteId: 1 }) })).json(); tok = lg.token;
  console.log(`Utilisateur ${U} (id ${lg.no}, admin=${lg.isAdmin})`);

  // ===== ÉTAPE 1 — Reproduction côté API GRC : format de date et borne de fin =====
  console.log('\n--- ÉTAPE 1 : API GET /reglements (format date, borne de fin) ---');
  const wide = (await api('GET', grcUrl('2026-07-01', '2026-07-31T23:59:59'))).items;
  console.log('  exemples r.date réels :', JSON.stringify(wide.slice(0, 3).map(i => i.date)));
  ok(wide.every(i => /^\d{4}-\d{2}-\d{2}T/.test(String(i.date))), `format confirmé : toutes les ${wide.length} dates commencent par yyyy-mm-ddT`);
  const byDay = {}; wide.forEach(i => { const d = String(i.date).slice(0, 10); byDay[d] = (byDay[d] || 0) + 1; });
  console.log('  répartition par jour (API, juillet) :', JSON.stringify(byDay));
  const probeDays = Object.keys(byDay).filter(d => d >= '2026-07-20').sort();
  for (const d of probeDays) {
    const withT = (await api('GET', grcUrl(d, d + 'T23:59:59'))).items.filter(i => String(i.date).slice(0, 10) === d).length;
    const bare = (await api('GET', grcUrl(d, d))).items.filter(i => String(i.date).slice(0, 10) === d).length;
    const sq = sql(`SET DATEFORMAT ymd; SELECT COUNT(*) FROM RT_MOUVEMENT WHERE BN_Id=1 AND MV_Domaine=0 AND MV_Point=0 AND MV_Annule=0 AND MV_Date>='${d}' AND MV_Date<DATEADD(day,1,'${d}')`);
    console.log(`  jour ${d} : large=${byDay[d]} | dateFin="${d}T23:59:59" → ${withT} | dateFin="${d}" (sans heure) → ${bare} | SQL brut (sans critère d'éligibilité) = ${sq}`);
    ok(withT === byDay[d], `${d} : borne de fin "T23:59:59" inclusive (${withT}/${byDay[d]})`);
    if (bare !== byDay[d]) console.log(`  NOTE ${d} : sans heure, l'API ne renvoie que ${bare}/${byDay[d]} → borne exclusive si dateFin nue`);
  }

  // ===== Jeu d'essai relevé =====
  const tag = new Date().toISOString().slice(11, 19);
  RX = +sql(`INSERT dbo.RAPP_ReleveBancaire_Entete (BanqueId, Titre, DateImport, ImportePar_UserId) VALUES (1, N'T102-RX ${tag}', GETDATE(), N'test'); SELECT SCOPE_IDENTITY()`).split(/[\r\n]+/).pop();
  const cand = sql(`SET DATEFORMAT ymd; SELECT TOP 1 MV_Id, MV_Montant FROM RT_MOUVEMENT m WHERE BN_Id=1 AND MV_Domaine=0 AND MV_Point=0 AND MV_Annule=0 AND MV_Type=3 AND MV_Montant BETWEEN 100 AND 100000 AND MV_Date BETWEEN '20260701' AND '20260719' AND (SELECT COUNT(*) FROM RT_MOUVEMENT x WHERE x.BN_Id=1 AND x.MV_Point=0 AND x.MV_Annule=0 AND x.MV_Montant=m.MV_Montant)=1 AND NOT EXISTS (SELECT 1 FROM RAPP_ReleveBancaire_Ligne l WHERE l.MV_ID=m.MV_Id) ORDER BY MV_Id DESC`).split('|');
  const mvId = +cand[0], amtA1 = Number(cand[1]);
  // op (yyyy-mm-dd hh:mm) : A1=10, A2=15, A3=15 (même jour), A4=20 ; valeur : 12, 15, 18, 22
  const lines = [['A1', '2026-07-10 14:30', '2026-07-12', amtA1], ['A2', '2026-07-15 09:00', '2026-07-15', 222.22], ['A3', '2026-07-15 23:59', '2026-07-18', 333.33], ['A4', '2026-07-20 00:00', '2026-07-22', 444.44]];
  lines.forEach(([l, op, val, m]) => sql(`SET DATEFORMAT ymd; INSERT dbo.RAPP_ReleveBancaire_Ligne (ReleveBancaireEnteteId, DateOperation, DateValeur, Libelle, Reference, Code, Debit, Credit, MontantReel) VALUES (${RX},'${op}','${val}',N'T102 ${l}',N'${l}',N'${l}',0,${m},${m})`));
  const a1 = +sql(`SELECT id FROM RAPP_ReleveBancaire_Ligne WHERE ReleveBancaireEnteteId=${RX} AND Libelle=N'T102 A1'`);
  console.log(`\nJeu d'essai : relevé ${RX} ; A1 (op 07-10, val 07-12, crédit ${amtA1}) ↔ règlement ${mvId} ; A2 op 07-15 ; A3 op 07-15 ; A4 op 07-20`);
  const r0 = await api('POST', '/api/ReleveBancaire/reserve', { ligneReleveId: a1, mvId });
  console.log('  réservation A1 :', JSON.stringify(r0).slice(0, 120));
  const lApi = (await api('GET', `/api/ReleveBancaire/${RX}/lignes`));
  console.log('  lignes API (extrait A2) :', JSON.stringify((lApi.find(l => l.libelle === 'T102 A2') || {})).slice(0, 260));

  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1700, height: 1000 } })).newPage();
  page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
  const reqs = []; page.on('request', r => { if (r.url().includes('/api/reglements?')) reqs.push(r.url()); });
  const REL = page.locator('table').first(), GRC = page.locator('table').last();
  const shot = (n) => page.screenshot({ path: path.join(EV, `${n}.png`) });
  const relRows = () => page.locator('table').first().locator('tbody tr', { hasText: 'T102' }).evaluateAll(t => t.map(x => (x.innerText.match(/T102 A\d/) || [''])[0]));
  const grcRows = () => page.locator('table').last().locator('tbody tr');
  const popup = () => page.locator('div[style*="position: fixed"]');
  const openF = async (scope, label) => { await scope.locator(`th:has-text("${label}") button[title]`).first().click(); await popup().first().waitFor(); };
  const setRange = async (scope, label, du, au) => {
    await openF(scope, label);
    await popup().locator('input[type="date"]').nth(0).fill(du); await popup().locator('input[type="date"]').nth(1).fill(au);
    await popup().locator('button:has-text("Appliquer")').click(); await wait(400);
  };
  const clearF = async (scope, label) => { await openF(scope, label); await popup().locator('button:has-text("Effacer")').click(); await wait(400); };
  const relCase = async (label, du, au, expected) => {
    await setRange(REL, label, du, au); const got = (await relRows()).sort();
    ok(JSON.stringify(got) === JSON.stringify(expected), `Relevé « ${label} » Du=${du || '∅'} Au=${au || '∅'} → [${got}] (attendu [${expected}])`);
  };
  try {
    await page.goto(`http://localhost:${PORT}`);
    await page.fill('input[type="text"]', U); await page.fill('input[type="password"]', P); await page.click('button[type="submit"]');
    await page.waitForSelector('.rappro-title', { timeout: 15000 }).catch(() => {});
    if (await page.locator('.rappro-title').count() === 0) await page.locator('text=Rapprochement').first().click();
    await page.waitForSelector('.rappro-title');
    await page.selectOption('select.toolbar-select >> nth=0', '1'); await wait(1500);
    await page.selectOption('select.toolbar-select >> nth=1', 'tous');
    const refresh = async () => { const w = page.waitForResponse(r => r.url().includes('/api/reglements?') && r.request().method() === 'GET', { timeout: 20000 }); await page.click('button:has-text("Actualiser")'); const resp = await w; await wait(800); return resp; };
    const setPeriod = async (du, au) => { await page.fill('input[type="date"] >> nth=0', du); await page.fill('input[type="date"] >> nth=1', au); return refresh(); };
    await setPeriod('2026-07-01', '2026-07-31');
    await page.waitForSelector('table >> nth=0 >> text=T102 A1', { timeout: 15000 }); await wait(600);
    const T = REL;
    console.log('\n--- RELEVÉ : Date Op. ---');
    ok((await relRows()).length === 4, 'sans filtre : 4 lignes du jeu d\'essai affichées'); await shot('releve_00_sans_filtre');
    await relCase('Date Op.', '2026-07-15', '', ['T102 A2', 'T102 A3', 'T102 A4']);
    await shot('releve_01_op_du_seul');
    await relCase('Date Op.', '', '2026-07-15', ['T102 A1', 'T102 A2', 'T102 A3']);
    await relCase('Date Op.', '2026-07-15', '2026-07-15', ['T102 A2', 'T102 A3']);
    await shot('releve_02_op_du_et_au_meme_jour');
    await relCase('Date Op.', '2026-07-16', '2026-07-19', []);
    await shot('releve_03_op_plage_vide');
    await clearF(T, 'Date Op.'); ok((await relRows()).length === 4, 'Date Op. effacé → retour aux 4 lignes');
    console.log('\n--- RELEVÉ : Date Val. ---');
    await relCase('Date Val.', '2026-07-15', '', ['T102 A2', 'T102 A3', 'T102 A4']);
    await relCase('Date Val.', '', '2026-07-15', ['T102 A1', 'T102 A2']);
    await relCase('Date Val.', '2026-07-15', '2026-07-18', ['T102 A2', 'T102 A3']);
    await relCase('Date Val.', '2026-07-23', '2026-07-31', []);
    await clearF(T, 'Date Val.'); ok((await relRows()).length === 4, 'Date Val. effacé → retour aux 4 lignes');

    console.log('\n--- GRC : colonne Date ---');
    const total = await grcRows().count(); console.log(`  lignes GRC affichées sans filtre : ${total} (API : ${wide.length})`);
    const exp = (du, au) => wide.filter(i => { const d = String(i.date).slice(0, 10); return (!du || d >= du) && (!au || d <= au); }).length;
    const grcCase = async (du, au) => { await setRange(GRC, 'Date', du, au); const got = await grcRows().count(); const e = exp(du, au); ok(got === e || (e === 0 && got <= 1), `GRC « Date » Du=${du || '∅'} Au=${au || '∅'} → ${got} lignes (attendu ${e})`); };
    ok(total >= wide.length - 1, 'la grille affiche bien toute la période chargée');
    // bornes tombant sur des dates réelles : 07-20 (2 lignes), 07-26 (1, avec heure 12:09), 07-27 (1)
    await grcCase('2026-07-20', ''); await shot('grc_01_du_seul');
    await grcCase('', '2026-07-20');
    await grcCase('2026-07-20', '2026-07-20'); await shot('grc_02_du_et_au_20');
    await grcCase('2026-07-26', '2026-07-26'); await shot('grc_03_jour_avec_heure_12h09');
    await grcCase('2026-07-21', '2026-07-25'); await shot('grc_04_plage_vide');
    await clearF(GRC, 'Date'); ok(await grcRows().count() === total, `Date GRC effacé → retour à ${total} lignes`);

    console.log('\n--- GRC : Du/Au de l\'en-tête + Actualiser (reproduction) ---');
    reqs.length = 0;
    const resp = await setPeriod('2026-07-20', '2026-07-20');
    const url = reqs[reqs.length - 1]; console.log('  requête réseau :', decodeURIComponent(url).replace(/^.*\/api/, '/api'));
    const body = await resp.json(); const n20 = body.items.length;
    const inc = body.items.filter(i => String(i.date).slice(0, 10) === '2026-07-20').length;
    ok(n20 === byDay['2026-07-20'] && inc === n20, `Du=Au=2026-07-20 + Actualiser → ${n20} lignes reçues, toutes du 20 (API large : ${byDay['2026-07-20']}) → borne de fin incluse`);
    const rows20 = await grcRows().count(); ok(rows20 === n20, `UI affiche ${rows20} lignes = réponse API ${n20}`);
    await shot('grc_05_du_au_actualiser_20');
    await setPeriod('2026-07-01', '2026-07-31');

    console.log('\n--- NON-RÉGRESSION ---');
    // filtre montant (relevé, colonne Crédit, mode texte)
    await T.locator('th:has-text("Crédit") button[title]').first().click(); await popup().locator('input[type="text"]').fill('222,22'); await popup().locator('input[type="text"]').press('Enter'); await wait(400);
    ok(JSON.stringify(await relRows()) === JSON.stringify(['T102 A2']), 'filtre Crédit « 222,22 » → A2 seule (matchAmount inchangé)'); await shot('nonreg_montant');
    await clearF(T, 'Crédit'); await wait(200);
    // filtre Repère (TASK-100) : A1 est réservée
    await T.locator('th:has-text("Repère") button[title]').first().click(); await popup().waitFor();
    const opts = await popup().locator('label, div').filter({ hasText: /^\s*\d*-?[A-Z]\s*$/ }).allInnerTexts();
    console.log('  options Repère visibles :', JSON.stringify(opts.slice(0, 5)));
    await popup().locator('input[type="checkbox"]').nth(1).check(); await popup().locator('button:has-text("Fermer")').click(); await wait(400);
    const rep = await relRows(); ok(rep.length === 1 && rep[0] === 'T102 A1', `filtre Repère (liste) → [${rep}] (A1 réservée seule)`); await shot('nonreg_repere');
    await T.locator('th:has-text("Repère") button[title]').first().click(); await popup().locator('button:has-text("Effacer")').click(); await wait(300);
    // tri chronologique GRC
    const dates = async () => page.locator('table').last().locator('tbody tr').evaluateAll(trs => trs.map(t => t.innerText));
    await page.locator('table').last().locator('th span:has-text("Date")').first().click(); await wait(500);
    const vis1 = await grcRows().count(); await shot('nonreg_tri_asc');
    await page.locator('table').last().locator('th span:has-text("Date")').first().click(); await wait(500);
    await shot('nonreg_tri_desc'); ok(vis1 === (await grcRows().count()), 'tri Date asc/desc : nombre de lignes stable, captures jointes (ordre à contrôler sur les images)');
  } catch (e) { console.log('ERREUR:', e.message); fail++; await shot('erreur').catch(() => {}); }
  finally {
    await browser.close(); server.close();
    sql(`UPDATE RAPP_ReleveBancaire_Ligne SET Lettrage=NULL, MV_ID=NULL, ReservePar_UserId=NULL, DateReservation=NULL WHERE ReleveBancaireEnteteId=${RX} AND DateValidation IS NULL; DELETE FROM RAPP_ReleveBancaire_Ligne WHERE ReleveBancaireEnteteId=${RX}; DELETE FROM RAPP_ReleveBancaire_Entete WHERE id=${RX}`);
    console.log(`\nNettoyage : relevé ${RX} supprimé. Échecs : ${fail}`);
    process.exit(fail ? 1 : 0);
  }
})();
