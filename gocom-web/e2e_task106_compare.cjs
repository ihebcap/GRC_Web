// TASK-106 — S0 (défaut), S1 (non-régression mono avant/après) et S10 (performance) contre l'API RÉELLE (base de TEST).
// Usage : node e2e_task106_compare.cjs <label> <dossier_front>     ex. before <scratch>/oldfront/dist  |  after ../deploy/wwwroot
// Env : GRC_E2E_BASE_URL, GRC_E2E_USER1, GRC_E2E_PASS1, SQLCMDPASSWORD. Le lot N (3 règlements + relevé RN) est créé au 1er run et réutilisé au 2e.
const http = require('http'), fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const LABEL = process.argv[2], WWWROOT = path.resolve(process.argv[3] || '');
const API = process.env.GRC_E2E_BASE_URL, U = process.env.GRC_E2E_USER1, P = process.env.GRC_E2E_PASS1;
if (!LABEL || !fs.existsSync(WWWROOT) || !API || !U || !P) { console.error('usage / variables manquantes'); process.exit(2); }
const PORT = LABEL === 'before' ? 3510 : 3511;
const EV = path.resolve(__dirname, '../tasks/VERIFY/TASK-106_evidence'); fs.mkdirSync(EV, { recursive: true });
const LOTFILE = path.join(EV, 'lot_n.json');
let tok, fail = 0;
const ok = (c, m) => { console.log(c ? '  OK :' : '  KO :', m); if (!c) fail++; };
const sql = (q) => execFileSync('sqlcmd', ['-S', 'DESKTOP-2VCUE93', '-U', 'sa', '-C', '-I', '-W', '-h', '-1', '-s', '|', '-d', 'GR_GOCOM', '-Q', 'SET NOCOUNT ON; SET DATEFORMAT ymd; ' + q], { encoding: 'latin1' }).trim();
const rows = (q) => sql(q).split('\n').map(x => x.trim()).filter(Boolean).map(l => l.split('|'));
const api = async (method, url, body) => {
  const r = await fetch(API + url, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); try { return JSON.parse(t); } catch { return t; }
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
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const mkEntete = (t) => +sql(`INSERT dbo.RAPP_ReleveBancaire_Entete (BanqueId, Titre, DateImport, ImportePar_UserId) VALUES (1, N'${t}', GETDATE(), N'test'); SELECT SCOPE_IDENTITY()`).split('\n').pop().trim();
const insLigne = (e, lib, m) => sql(`INSERT dbo.RAPP_ReleveBancaire_Ligne (ReleveBancaireEnteteId, DateOperation, DateValeur, Libelle, Reference, Code, Debit, Credit, MontantReel) VALUES (${e},GETDATE(),GETDATE(),N'${lib}',N'${lib}',N'${lib}',0,${m},${m})`);

(async () => {
  const lg = await (await fetch(API + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ Username: U, Password: P, SocieteId: 1 }) })).json(); tok = lg.token;
  console.log(`[${LABEL}] front = ${WWWROOT} ; user = ${U} (id ${lg.no}, admin=${lg.isAdmin})`);
  // ---- Jeux d'essai ----
  const tag = LABEL + new Date().toISOString().slice(11, 19).replace(/:/g, '');
  const pick = (n, excl) => rows(`SELECT TOP ${n} m.MV_Id, m.MV_Montant, CONVERT(varchar(10),m.MV_Date,120) FROM RT_MOUVEMENT m WHERE BN_Id=1 AND MV_Domaine=0 AND MV_Point=0 AND MV_Annule=0 AND MV_Type=3 AND MV_Montant BETWEEN 100 AND 100000 AND MV_Date BETWEEN '20260701' AND '20260719' AND CA_IdIn IN (SELECT CA_Id FROM P_UTILISATEURCAISSE WHERE UT_Id=${lg.no}) AND (SELECT COUNT(*) FROM RT_MOUVEMENT x WHERE x.BN_Id=1 AND x.MV_Point=0 AND x.MV_Annule=0 AND x.MV_Montant=m.MV_Montant)=1 AND NOT EXISTS (SELECT 1 FROM RAPP_ReleveBancaire_Ligne l WHERE l.MV_ID=m.MV_Id) ${excl ? `AND m.MV_Id NOT IN (${excl})` : ''} ORDER BY m.MV_Id ${n > 3 ? 'ASC' : 'DESC'}`);
  let lot;
  if (fs.existsSync(LOTFILE)) lot = JSON.parse(fs.readFileSync(LOTFILE, 'utf-8'));
  else {
    const c = pick(3);   // lot N : 3 règlements, relevé RN (N1..N3 de mêmes montants)
    const rn = mkEntete('T106-RN lot N'); c.forEach((r, i) => insLigne(rn, `T106 N${i + 1}`, r[1]));
    lot = { rn, regl: c.map(r => +r[0]), montants: c.map(r => r[1]) }; fs.writeFileSync(LOTFILE, JSON.stringify(lot));
  }
  console.log('Lot N :', JSON.stringify(lot));
  const s0 = pick(4, lot.regl.join(','));    // S0 : 2 règlements (R1, R3) + relevés RX0/RY0 (relevés neufs → lettre « A » des deux côtés)
  const [R1, R3] = [+s0[0][0], +s0[1][0]];
  const RX0 = mkEntete(`T106-S0X ${tag}`), RY0 = mkEntete(`T106-S0Y ${tag}`);
  insLigne(RX0, 'T106 S0X1', s0[0][1]); insLigne(RY0, 'T106 S0Y1', s0[1][1]);
  const lid = (lib) => +sql(`SELECT id FROM RAPP_ReleveBancaire_Ligne WHERE Libelle=N'${lib}' AND ReleveBancaireEnteteId IN (${RX0},${RY0})`);
  const X1 = lid('T106 S0X1'), Y1 = lid('T106 S0Y1');
  const rm = mkEntete(`T106-S10 ${tag}`); insLigne(rm, 'T106 M1', s0[2][1]); insLigne(rm, 'T106 M2', s0[3][1]);   // relevé jetable pour la mesure S10 (créé avant l'ouverture de la page)
  const numeros = {};
  const allItems = (await api('GET', `/api/reglements?societeId=1&caisses=${lg.caisses.join(',')}&banqueNos=1&page=1&pageSize=1000&pointe=false&eligibleRappBancaire=true&dateDebut=2026-07-01&dateFin=2026-07-31T23:59:59`)).items;
  for (const id of [R1, R3, ...lot.regl]) { const r = allItems.find(i => i.no === id); numeros[id] = r ? r.numero : null; }
  // libère les réservations non validées du lot N et de S0
  sql(`UPDATE l SET Lettrage=NULL, MV_ID=NULL, ReservePar_UserId=NULL, DateReservation=NULL FROM RAPP_ReleveBancaire_Ligne l WHERE l.ReleveBancaireEnteteId IN (${lot.rn},${RX0},${RY0}) AND l.DateValidation IS NULL`);
  await api('POST', '/api/ReleveBancaire/reserve', { ligneReleveId: X1, mvId: R1 });   // X1↔R1 sur RX0 (lettre A)

  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1700, height: 1000 } })).newPage();
  const net = [];
  page.on('request', r => { const u = r.url(); if (r.method() === 'POST' && u.includes('/ReleveBancaire/')) net.push({ ep: u.split('/ReleveBancaire/')[1], body: r.postData() }); });
  let valResp = null;
  page.on('response', async r => { if (r.url().endsWith('/ReleveBancaire/validate')) { try { valResp = await r.json(); } catch {} } });
  page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
  const nets = () => net.splice(0);
  const grcTable = () => page.locator('table').last(), relTable = () => page.locator('table').first();
  const grcRow = (id) => grcTable().locator('tbody tr', { hasText: numeros[id] });
  const ligRow = (lib) => relTable().locator('tbody tr', { hasText: lib });
  const shot = (n) => page.screenshot({ path: path.join(EV, `cmp_${LABEL}_${n}.png`) });
  const pickReleve = async (id, label) => { await page.selectOption('select.toolbar-select >> nth=1', String(id)); await page.waitForSelector(`table >> nth=0 >> text=${label}`, { timeout: 15000 }); await wait(500); };
  const refresh = async () => { const w = page.waitForResponse(r => r.url().includes('/api/reglements?') && r.request().method() === 'GET', { timeout: 30000 }); await page.click('button:has-text("Actualiser")'); await w; await wait(700); };
  const setPeriod = async (du, au) => { await page.fill('input[type="date"] >> nth=0', du); await page.fill('input[type="date"] >> nth=1', au); await refresh(); };
  const check = (row) => row.locator('input[type="checkbox"]').first().click();
  try {
    await page.goto(`http://localhost:${PORT}`);
    await page.fill('input[type="text"]', U); await page.fill('input[type="password"]', P); await page.click('button[type="submit"]');
    await page.waitForSelector('.rappro-title', { timeout: 15000 }).catch(() => {});
    if (await page.locator('.rappro-title').count() === 0) await page.locator('text=Rapprochement').first().click();
    await page.waitForSelector('.rappro-title');
    await page.selectOption('select.toolbar-select >> nth=0', '1'); await wait(1500);
    await page.selectOption('select.toolbar-select >> nth=2', 'tous');
    await setPeriod('2026-07-01', '2026-07-31');

    // ================= S0 =================
    console.log(`\n--- S0 (${LABEL}) : X1↔R1 réservé sur RX0 (A) ; RY0 affiché ; réservation Y1↔R3 (A) ; clic sur R1 ---`);
    await pickReleve(RY0, 'T106 S0Y1');
    const r1txt = (await grcRow(R1).innerText()).replace(/\s+/g, ' ');
    console.log('  ligne R1 dans la grille GRC :', r1txt.slice(0, 60), '| case :', await grcRow(R1).locator('input[type="checkbox"]').count(), '| cadenas :', await grcRow(R1).locator('svg.lucide-lock').count());
    await check(ligRow('T106 S0Y1')); await check(grcRow(R3)); await wait(1000); nets();
    const lY = sql(`SELECT ISNULL(Lettrage,'') FROM RAPP_ReleveBancaire_Ligne WHERE id=${Y1}`), lX = sql(`SELECT ISNULL(Lettrage,'') FROM RAPP_ReleveBancaire_Ligne WHERE id=${X1}`);
    console.log(`  lettres : X1 = ${lX} ; Y1 = ${lY}`);
    await shot('s0_avant_clic_R1');
    const cb = grcRow(R1).locator('input[type="checkbox"]');
    if (await cb.count()) await cb.first().click(); else await grcRow(R1).locator('td').nth(3).click({ force: true }).catch(() => {});
    await wait(1500);
    const n0 = nets(); console.log('  appels réseau après clic sur R1 :', JSON.stringify(n0));
    const sY = sql(`SELECT ISNULL(Lettrage,'libre') FROM RAPP_ReleveBancaire_Ligne WHERE id=${Y1}`), sX = sql(`SELECT ISNULL(Lettrage,'libre') FROM RAPP_ReleveBancaire_Ligne WHERE id=${X1}`);
    console.log(`  SQL : Y1 = ${sY} ; X1 = ${sX}`);
    await shot('s0_apres_clic_R1');
    if (LABEL === 'before') ok(n0.length === 1 && n0[0].ep === 'release-batch' && JSON.parse(n0[0].body)[0].ligneReleveId === Y1 && sY === 'libre' && sX === lX, 'DÉFAUT REPRODUIT : le clic sur R1 (réservé sur RX0) libère Y1 (mauvaise ligne), X1 inchangée');
    else ok(n0.length === 0 && sY !== 'libre' && sX === lX, 'CORRIGÉ : le clic sur R1 ne fait rien (aucun appel, Y1 et X1 inchangées)');
    sql(`UPDATE RAPP_ReleveBancaire_Ligne SET Lettrage=NULL, MV_ID=NULL, ReservePar_UserId=NULL, DateReservation=NULL WHERE ReleveBancaireEnteteId IN (${RX0},${RY0}) AND DateValidation IS NULL`);

    // ================= S1 =================
    console.log(`\n--- S1 (${LABEL}) : lot N, relevé RN seul ; N1↔RN1, N2↔RN2 à la main, puis Auto (N3↔RN3) ---`);
    await setPeriod('2026-07-02', '2026-07-31'); await setPeriod('2026-07-01', '2026-07-31');   // recharge la grille GRC (état serveur après le nettoyage de S0)
    await pickReleve(lot.rn, 'T106 N1');
    await check(ligRow('T106 N1')); await check(grcRow(lot.regl[0])); await wait(800);
    await check(ligRow('T106 N2')); await check(grcRow(lot.regl[1])); await wait(800);
    nets(); await page.click('button:has-text("Auto")'); await wait(2500);
    const nA = nets(); console.log('  Auto → appels :', nA.map(x => x.ep).join(','));
    const snap = async () => ({
      lignes: await relTable().locator('tbody tr').evaluateAll(trs => trs.map(t => ({ txt: t.innerText.replace(/\s+/g, ' ').slice(0, 60), checked: !!t.querySelector('input:checked'), lock: !!t.querySelector('svg.lucide-lock') }))),
      grc: await grcTable().locator('tbody tr').evaluateAll(trs => trs.slice(0, 12).map(t => ({ txt: t.innerText.replace(/\s+/g, ' ').replace(/^.*?(#\d+)/, '$1').slice(0, 40), repere: (t.querySelector('.lettrage-cell') || {}).innerText || '', checked: !!t.querySelector('input:checked'), lock: !!t.querySelector('svg.lucide-lock') })))
    });
    const sn = await snap(); fs.writeFileSync(path.join(EV, `s1_${LABEL}.json`), JSON.stringify(sn, null, 1));
    console.log('  lettres en base :', sql(`SELECT STRING_AGG(CONCAT(Libelle,'=',ISNULL(Lettrage,'-')),' ; ') FROM RAPP_ReleveBancaire_Ligne WHERE ReleveBancaireEnteteId=${lot.rn}`));
    console.log('  relevé :', JSON.stringify(sn.lignes.map(l => `${l.txt.split(' ')[0]}${l.checked ? '✓' : ''}`)));
    await shot('s1_lot_n');
    if (LABEL === 'after') {
      const bf = JSON.parse(fs.readFileSync(path.join(EV, 's1_before.json'), 'utf-8'));
      const strip = (x) => x.replace(/^[0-9]+-/, '');
      const paired = (o) => o.grc.filter(g => g.checked && !g.lock);
      ok(JSON.stringify(bf.lignes) === JSON.stringify(sn.lignes), 'S1 : grille Relevé IDENTIQUE avant/après (lettres, ordre, cases)');
      ok(JSON.stringify(paired(bf)) === JSON.stringify(paired(sn)) && paired(sn).length === 3, 'S1 : règlements appariés IDENTIQUES avant/après (ordre, repères A/B/C, cases, couleurs de paire)');
      const other = (o) => o.grc.filter(g => g.lock).map(g => ({ ...g, repere: strip(g.repere), txt: strip(g.txt.replace(/^#[0-9]+ /, '#')) }));
      const prefixed = sn.grc.filter(g => g.lock && /^[0-9]+-/.test(g.repere)).length;
      ok(JSON.stringify(other(bf).map(g => g.repere)) === JSON.stringify(other(sn).map(g => g.repere)), `S1 : règlements réservés par d'autres/ailleurs : mêmes lettres, seul le préfixe <idRelevé>- s'ajoute (${prefixed} ligne(s) préfixée(s)) — changement voulu`);
    }
    if (LABEL === 'after') {
      nets(); valResp = null; await page.click('button:has-text("Approuver")'); await wait(3000);
      const v = nets().find(x => x.ep === 'validate'); const pairs = v ? JSON.parse(v.body) : [];
      ok(pairs.length === 3, `S1 Approuver : 3 paires envoyées (${pairs.map(p => `${p.releveLigneId}/${p.grcReglementId}`).join(',')})`);
      ok(valResp && valResp.successCount === 3 && valResp.errorCount === 0, `réponse validate : successCount = ${valResp && valResp.successCount}, errorCount = ${valResp && valResp.errorCount}`);
      ok(await ligRow('T106 N1').count() === 0 && (await relTable().locator('tbody tr').count()) === 0, 'lignes approuvées disparues de l\'écran');
      ok(await grcRow(lot.regl[0]).count() === 0 && await grcRow(lot.regl[1]).count() === 0 && await grcRow(lot.regl[2]).count() === 0, 'règlements approuvés disparus de la grille');
      ok(sql(`SELECT SUM(CAST(MV_Point AS int)) FROM RT_MOUVEMENT WHERE MV_Id IN (${lot.regl.join(',')})`) === '3', 'SQL : les 3 règlements ont MV_Point = 1 (isPointe)');
      fs.unlinkSync(LOTFILE);
    } else {
      await page.click('button:has-text("Dérapprocher")'); await wait(1500);   // avant : on libère pour rejouer le même lot après
      console.log('  lettres après Dérapprocher :', sql(`SELECT STRING_AGG(ISNULL(Lettrage,'-'),',') FROM RAPP_ReleveBancaire_Ligne WHERE ReleveBancaireEnteteId=${lot.rn}`));
    }

    // ================= S10 =================
    if (LABEL === 'before' || LABEL === 'after') {
      console.log(`\n--- S10 (${LABEL}) : 1 000 règlements réels affichés (période 01/01→31/07) ---`);
      const times = [];
      for (let i = 0; i < 3; i++) {
        await setPeriod('2026-07-02', '2026-07-31');   // période différente : « Actualiser » ne recharge pas si les dates sont inchangées
        const t0 = Date.now(); await page.fill('input[type="date"] >> nth=0', '2026-01-01'); await page.click('button:has-text("Actualiser")');
        await page.waitForFunction(() => { const t = document.querySelectorAll('table'); return t[t.length - 1].querySelectorAll('tbody tr').length >= 900; }, null, { timeout: 60000 });
        times.push(Date.now() - t0);
      }
      const nRows = await grcTable().locator('tbody tr').count();
      console.log(`  ${nRows} lignes GRC ; temps de chargement + rendu (3 mesures) : ${times.join(' / ')} ms`);
      fs.writeFileSync(path.join(EV, `s10_${LABEL}.json`), JSON.stringify({ rows: nRows, times }));
      const install = () => page.evaluate(() => { window.__rows = new Set(); window.__obs && window.__obs.disconnect(); const tb = document.querySelectorAll('table'); const body = tb[tb.length - 1].querySelector('tbody'); window.__obs = new MutationObserver(ms => { for (const m of ms) { let n = m.target; while (n && n.nodeName !== 'TR') n = n.parentNode; if (n) window.__rows.add(n); } }); window.__obs.observe(body, { subtree: true, childList: true, attributes: true, characterData: true }); });
      const count = () => page.evaluate(() => window.__rows.size);
      // un lot N existe encore seulement avant (après : consommé) → on utilise un relevé jetable pour la mesure de réservation
      const [M1] = [s0[2]], numM = allItems.find(i => i.no === +M1[0]);
      await page.selectOption('select.toolbar-select >> nth=1', String(rm)); await page.waitForSelector('table >> nth=0 >> text=T106 M1'); await wait(500);
      await install(); await relTable().locator('tbody tr', { hasText: 'T106 M2' }).locator('td').nth(4).click(); await wait(600);
      const mSel = await count(); console.log(`  sélection d'une ligne du relevé : ${mSel} ligne(s) de la grille GRC modifiée(s)`);
      await install(); await check(relTable().locator('tbody tr', { hasText: 'T106 M1' })); await wait(300);
      const gm = grcTable().locator('tbody tr', { hasText: numM ? numM.numero : '###' });
      if (await gm.count()) { await check(gm); await wait(1500); } else console.log('  (règlement M1 non trouvé dans la grille)');
      const mRes = await count(); console.log(`  réservation M1↔règlement : ${mRes} ligne(s) de la grille GRC modifiée(s) (sur ${nRows})`);
      fs.appendFileSync(path.join(EV, `s10_${LABEL}.json`), '\n' + JSON.stringify({ selection: mSel, reservation: mRes }));
      sql(`UPDATE RAPP_ReleveBancaire_Ligne SET Lettrage=NULL, MV_ID=NULL, ReservePar_UserId=NULL, DateReservation=NULL WHERE ReleveBancaireEnteteId=${rm} AND DateValidation IS NULL`);
      if (LABEL === 'after') { ok(mSel === 0, 'S10 : sélection d\'une ligne de relevé = 0 ligne GRC modifiée'); ok(mRes <= 2, `S10 : une réservation ne modifie que ≤ 2 lignes GRC (${mRes})`); }
    }
  } catch (e) { fail++; console.log('\nEXCEPTION :', e.message.split('\n')[0]); await page.screenshot({ path: path.join(EV, `cmp_${LABEL}_exception.png`) }).catch(() => {}); }
  finally { await browser.close(); server.close(); console.log(fail ? `\nRÉSULTAT [${LABEL}] : ${fail} KO` : `\nRÉSULTAT [${LABEL}] : PASS`); process.exit(fail ? 1 : 0); }
})();
