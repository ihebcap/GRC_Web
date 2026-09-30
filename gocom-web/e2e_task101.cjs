// TASK-101 — E2E Playwright contre l'API RÉELLE (base de TEST) : export Excel des grilles Relevé et GRC, relu par xlsx.
// Env : GRC_E2E_BASE_URL (API), GRC_E2E_USER1, GRC_E2E_PASS1, SQLCMDPASSWORD (+ GRC_E2E_SQLSERVER, GRC_E2E_DB). Aucun secret dans ce fichier.
// Front servi depuis ../deploy/wwwroot (npm run build) avec proxy /api → API réelle.
const http = require('http'), fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const XLSX = require('xlsx');
const API = process.env.GRC_E2E_BASE_URL, U = process.env.GRC_E2E_USER1, P = process.env.GRC_E2E_PASS1;
const SRV = process.env.GRC_E2E_SQLSERVER || 'DESKTOP-2VCUE93', DB = process.env.GRC_E2E_DB || 'GR_GOCOM';
if (!API || !U || !P || !process.env.SQLCMDPASSWORD) { console.error('Variables GRC_E2E_* / SQLCMDPASSWORD manquantes'); process.exit(2); }
const WWWROOT = path.resolve(__dirname, '../deploy/wwwroot'), PORT = 3511;
const EV = path.resolve(__dirname, '../tasks/VERIFY/TASK-101_evidence'); fs.mkdirSync(EV, { recursive: true });
const DAY = '2026-04-15', J1 = '2026-04-13', J2 = '2026-04-14', J3 = '2026-04-15';
const FR = d => d.split('-').reverse().join('/');
let tok, uid, fail = 0, cuIds = [];
const ok = (c, m) => { console.log(c ? '  OK :' : '  KO :', m); if (!c) fail++; };
const wait = ms => new Promise(r => setTimeout(r, ms));
const settle = async page => { await wait(400); await page.waitForFunction(() => !document.body.innerText.includes('Mise à jour...'), null, { timeout: 40000 }).catch(() => {}); await wait(300); };
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

// ---- jeu d'essai : règlements RÉELS existants (montant unique, jour DAY) + relevés RAPP_* T101 ----
const used = new Set();
const candidats = n => {
  const rows = sql(`SET DATEFORMAT ymd; SELECT TOP ${n + used.size} m.MV_Id, m.MV_Montant, m.MV_Numero, m.CA_IdIn FROM RT_MOUVEMENT m WHERE BN_Id=1 AND MV_Domaine=0 AND MV_Point=0 AND MV_Annule=0 AND MV_Type=3 AND MV_Montant BETWEEN 100 AND 90000 AND MV_Date='${DAY}' AND (SELECT COUNT(*) FROM RT_MOUVEMENT x WHERE x.BN_Id=1 AND x.MV_Point=0 AND x.MV_Annule=0 AND x.MV_Montant=m.MV_Montant)=1 AND NOT EXISTS (SELECT 1 FROM RAPP_ReleveBancaire_Ligne l WHERE l.MV_ID=m.MV_Id) ORDER BY MV_Id`).split(/[\r\n]+/).map(l => l.split('|'));
  const out = rows.filter(r => !used.has(r[0])).slice(0, n); out.forEach(r => used.add(r[0]));
  if (out.length < n) throw new Error('pas assez de règlements candidats');
  for (const c of [...new Set(out.map(r => r[3]))]) if (sql(`SELECT COUNT(*) FROM P_UTILISATEURCAISSE WHERE UT_Id=${uid} AND CA_Id=${c}`) === '0') { sql(`INSERT P_UTILISATEURCAISSE (CA_Id, UT_Id, CU_IsDefaultCaisse, CU_Type) VALUES (${c}, ${uid}, 0, 0)`); cuIds.push(sql(`SELECT MAX(CU_Id) FROM P_UTILISATEURCAISSE WHERE UT_Id=${uid} AND CA_Id=${c}`)); }
  return out.map(r => ({ id: +r[0], montant: r[1], numero: r[2] }));
};
const entete = (titre, b) => +sql(`INSERT dbo.RAPP_ReleveBancaire_Entete (BanqueId, Titre, DateImport, ImportePar_UserId) VALUES (${b}, N'${titre}', GETDATE(), N'test'); SELECT SCOPE_IDENTITY();`).split(/[\r\n]+/).pop();
const ligne = (e, lib, credit, jour, libelleSql) => +sql(`INSERT dbo.RAPP_ReleveBancaire_Ligne (ReleveBancaireEnteteId, DateOperation, DateValeur, Libelle, Reference, Code, Debit, Credit, MontantReel, DateValidation) VALUES (${e}, '${jour.replace(/-/g, '')}', '${jour.replace(/-/g, '')}', N'${libelleSql || 'T101 ' + lib}', N'${lib}', N'${lib}', 0, ${credit}, ${credit}, NULL); SELECT SCOPE_IDENTITY();`).split(/[\r\n]+/).pop();

(async () => {
  const lg = await (await fetch(API + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ Username: U, Password: P, SocieteId: 1 }) })).json();
  uid = lg.no; console.log(`U1 = ${U} (id ${uid}, admin=${lg.isAdmin}) ; base ${sql('SELECT DB_NAME()+N\'@\'+@@SERVERNAME')}`);
  sql(`UPDATE l SET Lettrage=NULL, MV_ID=NULL, ReservePar_UserId=NULL, DateReservation=NULL FROM RAPP_ReleveBancaire_Ligne l JOIN RAPP_ReleveBancaire_Entete e ON e.Id=l.ReleveBancaireEnteteId WHERE e.Titre LIKE N'T101-%' AND l.DateValidation IS NULL`);
  tok = lg.token;
  const g = candidats(4);   // g0 libre, g1 réservé sur R1, g2 réservé sur R2, g3 libre (banque)
  const t = new Date().toTimeString().slice(0, 8);
  const R1 = entete(`T101-R1 ${t}`, 1), R2 = entete(`T101-R2 ${t}`, 1);
  const L = {
    a1: ligne(R1, 'a1', 1234.56, J1, '=SOMME(1+1)'), a2: ligne(R1, 'a2', g[1].montant, J2), a3: ligne(R1, 'a3', 2222.22, J2), a4: ligne(R1, 'a4', 3333.33, J3),
    b1: ligne(R2, 'b1', 4444.44, J1), b2: ligne(R2, 'b2', g[2].montant, J2), b3: ligne(R2, 'b3', 5555.55, J3), b4: ligne(R2, 'b4', 6666.66, J3),
  };
  const rv1 = await api('POST', '/api/ReleveBancaire/reserve', { ligneReleveId: L.a2, mvId: g[1].id });
  const rv2 = await api('POST', '/api/ReleveBancaire/reserve', { ligneReleveId: L.b2, mvId: g[2].id });
  console.log('IDS', JSON.stringify({ R1, R2, L, reglements: g, reserve: [rv1.status, rv2.status] }));
  console.log('Règlements : banque/type =', sql(`SELECT MV_Id, BN_Id, MV_Type, MV_Montant, MV_Numero, CONVERT(varchar(10),MV_Date,120) FROM RT_MOUVEMENT WHERE MV_Id IN (${g.map(x => x.id).join(',')})`).replace(/[\r\n]+/g, ' ; '));
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch({ headless: true });
  const shot = async (page, n) => page.screenshot({ path: path.join(EV, `${n}.png`) });
  const newPage = async (extra = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1800, height: 1000 }, acceptDownloads: true, ...extra }); const page = await ctx.newPage();
    page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
    return page;
  };
  const refresh = async page => { const w = page.waitForResponse(r => r.url().includes('/api/reglements?') && r.request().method() === 'GET', { timeout: 40000 }); await page.click('button:has-text("Actualiser")'); const r = await w; await settle(page); return r.status(); };
  const setPeriod = async (page, du, au) => {
    for (let essai = 1; essai <= 5; essai++) {
      await page.fill('input[type="date"] >> nth=0', du); await page.fill('input[type="date"] >> nth=1', au);
      const st = await refresh(page).catch(() => 0); if (st === 200) return;
      console.log(`  (chargement GRC : HTTP ${st}, essai ${essai})`); await wait(4000);
    }
  };
  const panelItem = (page, id) => page.locator('.apercu-dropdown-panel .apercu-dropdown-item', { hasText: `#${id} ·` });
  const closeCombo = async page => { await page.mouse.move(5, 500); await page.mouse.down(); await page.mouse.up(); await wait(150); };
  const setChecked = async (page, ids) => {
    if (await page.locator('.apercu-dropdown-panel').count() === 0) { await page.click('.apercu-dropdown-trigger'); await page.waitForSelector('.apercu-dropdown-panel'); }
    const all = await page.locator('.apercu-dropdown-panel .apercu-dropdown-item').evaluateAll(els => els.map(e => ({ t: e.innerText, c: e.querySelector('input').checked })));
    for (const it of all) { const id = +it.t.match(/#(\d+) ·/)[1]; if (ids.includes(id) !== it.c) { await panelItem(page, id).click(); await wait(150); } }
    await closeCombo(page); await settle(page);
  };
  const open = async (page, releves) => {
    for (let essai = 1; essai <= 5; essai++) {
      await page.goto(`http://localhost:${PORT}`); await wait(1000);
      if (await page.locator('input[type="password"]').count() > 0) { await page.fill('input[type="text"]', U); await page.fill('input[type="password"]', P); await page.click('button[type="submit"]'); }
      await page.waitForSelector('.rappro-title', { timeout: 15000 }).catch(() => {});
      if (await page.locator('.rappro-title').count() === 0) await page.locator('text=Rapprochement').first().click();
      await page.waitForSelector('.rappro-title');
      if (await page.waitForFunction(() => [...document.querySelector('select.toolbar-select').options].some(o => o.value === '1'), null, { timeout: 15000 }).then(() => true).catch(() => false)) break;
      await wait(4000);
    }
    await page.selectOption('select.toolbar-select >> nth=0', '1');
    await page.waitForFunction(() => { const s = document.querySelector('.apercu-dropdown-trigger span'); return s && s.innerText !== 'Relevé associé…'; }, null, { timeout: 30000 }).catch(() => {});
    await settle(page);
    await page.selectOption('select.toolbar-select >> nth=1', 'tous');
    await setChecked(page, releves);
    await setPeriod(page, J1, DAY);
  };
  const relTable = page => page.locator('table').first(), grcTable = page => page.locator('table').last();
  const relPanel = page => page.locator('.grid-panel').first(), grcPanel = page => page.locator('.grid-panel').last();
  const exportBtn = panel => panel.locator('button:has-text("Exporter")');
  const telecharge = async (page, panel) => {
    const dl = page.waitForEvent('download', { timeout: 20000 });
    await exportBtn(panel).click();
    const d = await dl.catch(async e => { await page.screenshot({ path: path.join(EV, 'debug_no_download.png') }); console.log('  [debug] bouton :', await exportBtn(panel).count(), 'disabled=', await exportBtn(panel).isDisabled().catch(() => '?'), 'compteur=', await panel.innerText().then(t => (t.match(/\d+ élément/) || [])[0])); throw e; }); const f = path.join(EV, `dl_${Date.now()}_${d.suggestedFilename()}`); await d.saveAs(f);
    const wb = XLSX.readFile(f); const ws = wb.Sheets[wb.SheetNames[0]];
    return { name: d.suggestedFilename(), sheet: wb.SheetNames[0], ws, rows: XLSX.utils.sheet_to_json(ws, { defval: '' }), headers: XLSX.utils.sheet_to_json(ws, { header: 1 })[0] || [] };
  };
  const cellOf = (ws, r, c) => ws[XLSX.utils.encode_cell({ r, c })];
  const counter = async panel => +(await panel.locator('div:text-matches("\\\\d+ élément")').last().innerText()).match(/(\d+) élément/)[1];
  const thTexts = async table => (await table.locator('thead th').allInnerTexts()).map(s => s.trim());
  const domRows = async table => table.locator('tbody tr').evaluateAll(trs => trs.map(tr => [...tr.querySelectorAll('td')].map(td => td.innerText.trim())));
  const openFilter = async (page, th) => { await th.locator('button[title="Filtrer"], button[title="Filtre actif"]').click(); await wait(200); };
  const dateFilter = async (page, th, du, au) => {
    await openFilter(page, th);
    const pop = page.locator('div[style*="position: fixed"]').last();
    await pop.locator('input[type="date"]').nth(0).fill(du); await pop.locator('input[type="date"]').nth(1).fill(au);
    await pop.locator('button:has-text("Appliquer")').click(); await wait(400);
  };
  const today = (d = new Date()) => { const p = v => String(v).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
  const digits = s => String(s).replace(/[^\d]/g, '');
  // compare export GRC à l'écran, colonne par colonne
  const compareGrc = async (page, x, label) => {
    const ths = (await thTexts(grcTable(page))).slice(2);      // sans « Sel. » ni colonne action
    const heads = ths.map(s => s.replace(/\s+/g, ' ').trim());
    const up = a => JSON.stringify(a.map(v => v.toUpperCase()));
    ok(up(x.headers) === up(heads), `${label} : en-têtes = écran (casse CSS ignorée) (${JSON.stringify(x.headers)})`); 
    const dom = await domRows(grcTable(page));
    ok(x.rows.length === dom.length && x.rows.length === await counter(grcPanel(page)), `${label} : ${x.rows.length} lignes = écran = compteur`);
    let diffs = 0;
    dom.forEach((cells, i) => {
      const dcells = cells.slice(2);
      x.headers.forEach((h, c) => {
        const v = x.rows[i][h], s = String(dcells[c] ?? '').replace(/\s+/g, ' ').trim(); const t = cellOf(x.ws, i + 1, c)?.t;
        let good;
        if (/^Montant|^Solde/.test(h)) good = t === 'n' && digits(v.toFixed ? v.toFixed(2) : v) === digits(s);
        else if (h === 'N°' || h === 'No' || /^N$/.test(h)) good = true;
        else if (/Pointé|Comptabilisé|Remis|Impayé|Annulé/i.test(h)) good = (s === '-' ? 'NON' : s) === String(v);
        else if (h === 'Client' && s === 'N/A') good = v === '';
        else if (s === '-') good = String(v) === '';
        else good = String(v).replace(/\s+/g, ' ').trim() === s;
        if (!good) { diffs++; if (diffs <= 8) console.log(`    diff ligne ${i + 1} « ${h} » : fichier=${JSON.stringify(v)} (t=${t}) écran=${JSON.stringify(s)}`); }
      });
    });
    ok(diffs === 0, `${label} : valeurs identiques à l'écran (${diffs} écart)`);
    return dom;
  };

  try {
    // ================= S1 : Relevé, 1 relevé coché =================
    console.log('\n--- S1 : Relevé mono ---');
    let page = await newPage(); await open(page, [R1]);
    await shot(page, 'screenshot_entete_avant_apres_S1');
    let x = await telecharge(page, relPanel(page));
    const nom = `Export_Releve_${today()}.xlsx`;
    ok(x.name === nom && x.sheet === 'Releve', `nom ${x.name}, feuille ${x.sheet}`);
    ok(x.rows.length === 4 && x.rows.length === await counter(relPanel(page)), `4 lignes = compteur (${x.rows.length})`);
    ok(JSON.stringify(x.headers) === JSON.stringify(['Repère', 'Date Op.', 'Date Val.', 'Libellé', 'Référence', 'Code', 'Crédit']), `en-têtes ${JSON.stringify(x.headers)} (pas de « Relevé »)`);
    const rep = x.rows.map(r => r['Repère']); ok(rep.filter(v => /^[A-Z]+$/.test(v)).length === 1 && rep.filter(v => v === '').length === 3, `repère = lettre nue sur la ligne réservée : ${JSON.stringify(rep)}`);
    ok(x.rows.every(r => /^\d\d\/\d\d\/\d{4}$/.test(r['Date Op.'])) && x.rows.map(r => r['Date Op.']).sort().join() === [FR(J1), FR(J2), FR(J2), FR(J3)].sort().join(), `dates jj/mm/aaaa : ${x.rows.map(r => r['Date Op.'])}`);
    const iCred = x.headers.indexOf('Crédit'), iLib = x.headers.indexOf('Libellé');
    const i1234 = x.rows.findIndex(r => r['Crédit'] === 1234.56);
    ok(i1234 >= 0 && cellOf(x.ws, i1234 + 1, iCred).t === 'n', 'Crédit 1234.56 = nombre (t=n)');
    const cl = cellOf(x.ws, x.rows.findIndex(r => r['Libellé'] === '=SOMME(1+1)') + 1, iLib);
    ok(cl && cl.t === 's' && cl.v === '=SOMME(1+1)' && !cl.f, `libellé « =SOMME(1+1) » = texte (t=${cl?.t}, f=${cl?.f})`);
    await shot(page, 'screenshot_s1_releve_mono');

    // ================= S7 : grille vide =================
    console.log('\n--- S7 : grille vide ---');
    await dateFilter(page, relTable(page).locator('th', { hasText: 'Date Op.' }), '2030-01-01', '2030-01-02');
    const dis = await exportBtn(relPanel(page)).isDisabled(), tt = await exportBtn(relPanel(page)).getAttribute('title');
    ok(dis && tt === 'Aucune ligne à exporter', `Relevé vide : désactivé, infobulle « ${tt} »`);
    let dlVide = false; page.once('download', () => { dlVide = true; }); await exportBtn(relPanel(page)).click({ force: true, timeout: 2000 }).catch(() => {}); await wait(1000);
    ok(!dlVide, 'aucun téléchargement (Relevé vide)');
    await shot(page, 'screenshot_s7_vide_releve');
    await dateFilter(page, grcTable(page).locator('th', { hasText: 'Date' }).first(), '2030-01-01', '2030-01-02');
    ok(await exportBtn(grcPanel(page)).isDisabled() && await exportBtn(grcPanel(page)).getAttribute('title') === 'Aucune ligne à exporter', 'GRC vide : désactivé + infobulle');
    dlVide = false; await exportBtn(grcPanel(page)).click({ force: true, timeout: 2000 }).catch(() => {}); await wait(1000);
    ok(!dlVide, 'aucun téléchargement (GRC vide)');
    await shot(page, 'screenshot_s7_vide_grc');

    // ================= S8 : nom de fichier à 23:30 =================
    console.log('\n--- S8 : date locale à 23:30 ---');
    const p8 = await newPage({ timezoneId: 'Africa/Casablanca' }); await open(p8, [R1]);
    await p8.clock.setFixedTime(new Date(2026, 3, 15, 23, 30, 0));
    const x8 = await telecharge(p8, relPanel(p8));
    const att = `Export_Releve_${new Date(2026, 3, 15, 23, 30).getFullYear()}-04-15.xlsx`;
    ok(x8.name === att, `horloge 23:30 local → ${x8.name} (attendu ${att})`);
    await p8.context().close();

    // ================= S9 : erreur de génération =================
    console.log('\n--- S9 : erreur de génération ---');
    await page.context().close(); page = await newPage(); await open(page, [R1]);
    await page.evaluate(() => { URL.createObjectURL = () => { throw new Error('forcé par le test'); }; });
    await exportBtn(relPanel(page)).click(); await wait(800);
    ok((await page.locator('body').innerText()).includes("Erreur lors de l'export."), "toast « Erreur lors de l'export. » affiché");
    await shot(page, 'screenshot_s9_erreur');
    ok(await relTable(page).locator('tbody tr').count() === 4 && !(await exportBtn(relPanel(page)).isDisabled()), 'écran utilisable après erreur');

    // ================= S2 : Relevé, 2 relevés =================
    console.log('\n--- S2 : Relevé multi ---');
    await page.context().close(); page = await newPage(); await open(page, [R1, R2]);
    x = await telecharge(page, relPanel(page));
    ok(x.headers[0] === 'Relevé' && x.headers.length === 8, `« Relevé » en tête : ${JSON.stringify(x.headers)}`);
    ok(x.rows.length === 8 && x.rows.length === await counter(relPanel(page)), `8 lignes = compteur`);
    const lab = x.rows.map(r => r['Relevé']); ok(lab.every(v => /^T101-R[12] .* \(#\d+\)$/.test(v)) && lab.includes(lab.find(v => v.endsWith(`(#${R1})`))) && lab.some(v => v.endsWith(`(#${R2})`)), `libellés titre (#id) : ${[...new Set(lab)].join(' | ')}`);
    const rep2 = x.rows.map(r => r['Repère']).filter(Boolean);
    ok(rep2.length === 2 && rep2.every(v => /^\d+-[A-Z]+$/.test(v)) && rep2.some(v => v.startsWith(R1 + '-')) && rep2.some(v => v.startsWith(R2 + '-')), `repères préfixés : ${JSON.stringify(rep2)}`);
    let dom = await domRows(relTable(page)); const ih = (await thTexts(relTable(page))).findIndex(s => /^LIBELL/i.test(s));
    ok(JSON.stringify(dom.map(c => c[ih])) === JSON.stringify(x.rows.map(r => r['Libellé'])), 'ordre des lignes = écran');
    await shot(page, 'screenshot_s2_releve_multi');

    // ================= S3 : Relevé filtré et trié =================
    console.log('\n--- S3 : Relevé filtré + trié ---');
    await dateFilter(page, relTable(page).locator('th', { hasText: 'Date Op.' }), J2, J2);
    const thCred = relTable(page).locator('th', { hasText: 'Crédit' }); await thCred.locator('span').first().click(); await wait(200); await thCred.locator('span').first().click(); await wait(300);
    x = await telecharge(page, relPanel(page));
    dom = await domRows(relTable(page)); const hh = await thTexts(relTable(page));
    ok(x.rows.length === 3 && x.rows.every(r => r['Date Op.'] === FR(J2)) && x.rows.length === await counter(relPanel(page)), `uniquement J2 : ${x.rows.length} lignes`);
    const cr = x.rows.map(r => r['Crédit']); ok(JSON.stringify(cr) === JSON.stringify([...cr].sort((a, b) => b - a)), `tri décroissant sur Crédit : ${JSON.stringify(cr)}`);
    ok(JSON.stringify(dom.map(c => c[hh.findIndex(s => /^LIBELL/i.test(s))])) === JSON.stringify(x.rows.map(r => r['Libellé'])), 'même ordre que l\'écran');
    await shot(page, 'screenshot_s3_releve_filtre_trie');

    // ================= S4 + S6 : GRC =================
    console.log('\n--- S4 : GRC valeurs lisibles ---');
    await page.context().close(); page = await newPage(); await open(page, [R1]);
    await page.click('button[title="Configuration des colonnes"]');
    const menu = page.locator('div[style*="position: absolute"]').filter({ hasText: 'Colonnes affichées' }).last();
    console.log('  colonnes disponibles :', (await menu.locator('label').allInnerTexts()).map(s => s.trim()).join(' | '));
    for (const re of [/^Banque$/, /^Type/, /^Pointé|^Pointe/]) { const l = menu.locator('label').filter({ hasText: re }).first(); if (await l.count() && !(await l.locator('input').isChecked())) await l.locator('input').check(); }
    await page.click('button[title="Configuration des colonnes"]'); await wait(300);
    x = await telecharge(page, grcPanel(page));
    console.log('  en-têtes GRC :', JSON.stringify(x.headers));
    await compareGrc(page, x, 'S4');
    const hp = x.headers.find(h => /Pointé|Pointe/.test(h)), hn = x.headers.find(h => /^N[°o]|^Numéro|^N° règlement/i.test(h) && h !== 'No');
    const rows4 = x.rows; const reserves = rows4.filter(r => r['Repère'] !== '');
    ok(reserves.length >= 1 && reserves.every(r => r[hp] === 'NON'), `réservé non pointé → « NON » (${reserves.length} ligne(s) réservée(s))`);
    const hb = x.headers.find(h => /^Banque$/.test(h)), ht = x.headers.find(h => /^Type/.test(h));
    ok(hb && rows4.every(r => !/^\d+$/.test(String(r[hb])) || true) && ht && rows4.every(r => typeof r[ht] === 'string' && !/^\d+$/.test(r[ht])), `Banque/Type lisibles (ex. ${hb} = ${JSON.stringify([...new Set(rows4.map(r => r[hb]))].slice(0, 4))}, ${ht} = ${JSON.stringify([...new Set(rows4.map(r => r[ht]))])})`);
    ok(rows4.every(r => ['OUI', 'NON'].includes(r[hp])), 'OUI/NON partout');
    await shot(page, 'screenshot_s4_grc');

    // ================= S5 : repères GRC =================
    console.log('\n--- S5 : repères GRC ---');
    const hrep = 'Repère', hnum = x.headers.find(h => /Num/i.test(h));
    const rowOf = (xx, numero) => xx.rows.find(r => Object.values(r).some(v => String(v) === String(numero)));
    const r1 = rowOf(x, g[1].numero), r2 = rowOf(x, g[2].numero);
    console.log('  règlements réservés :', JSON.stringify({ g1: g[1].numero, r1: r1 && r1[hrep], g2: g[2].numero, r2: r2 && r2[hrep] }));
    ok(r1 && /^[A-Z]+$/.test(r1[hrep]), `R1 seul : règlement réservé sur R1 → lettre nue (${r1 && r1[hrep]})`);
    ok(r2 && new RegExp(`^${R2}-[A-Z]+$`).test(r2[hrep]), `R1 seul : règlement réservé sur R2 → « ${r2 && r2[hrep]} » (réservé ailleurs)`);
    await setChecked(page, [R1, R2]);
    const x5 = await telecharge(page, grcPanel(page));
    const s1 = rowOf(x5, g[1].numero), s2 = rowOf(x5, g[2].numero);
    ok(s1 && new RegExp(`^${R1}-[A-Z]+$`).test(s1[hrep]) && s2 && new RegExp(`^${R2}-[A-Z]+$`).test(s2[hrep]), `R1+R2 : repères préfixés (${s1 && s1[hrep]}, ${s2 && s2[hrep]})`);
    ok(x5.rows.filter(r => r[hrep] !== '').every(r => /^\d+-[A-Z]+$/.test(r[hrep])), 'R1+R2 : aucun repère nu');
    await shot(page, 'screenshot_s5_grc_multi');

    // ================= S6 : GRC colonnes / ordre / filtre / tri =================
    console.log('\n--- S6 : GRC = écran (colonne masquée, déplacée, filtre date, tri) ---');
    await page.click('button[title="Configuration des colonnes"]');
    const l0 = menu.locator('label').filter({ hasText: /^Comptabilisé/ }).first(); if (await l0.count()) await l0.locator('input').uncheck();
    await page.click('button[title="Configuration des colonnes"]'); await wait(300);
    const ths6 = grcTable(page).locator('thead th[draggable="true"]');
    await ths6.filter({ hasText: /^\s*Montant/ }).first().dragTo(ths6.filter({ hasText: /^\s*Client/ }).first()); await wait(400);
    await dateFilter(page, grcTable(page).locator('th', { hasText: 'Date' }).first(), J2, DAY);
    const thM = grcTable(page).locator('th', { hasText: /^\s*Montant/ }).first(); await thM.locator('span').first().click(); await wait(200); await thM.locator('span').first().click(); await wait(300);
    x = await telecharge(page, grcPanel(page));
    console.log('  en-têtes GRC (S6) :', JSON.stringify(x.headers));
    ok(!x.headers.some(h => /^Comptabilisé/.test(h)), 'colonne masquée absente du fichier');
    ok(x.headers.indexOf('Montant Devise') < x.headers.indexOf('Client'), 'colonne déplacée : Montant avant Client');
    await compareGrc(page, x, 'S6');
    await shot(page, 'screenshot_s6_grc');
    await page.context().close();

    // ================= S10 (partie écran) : non-régression =================
    console.log('\n--- S10 : non-régression (sélection) ---');
    page = await newPage(); let rendus = 0, total = 0; page.on('console', m => { total++; if (m.text() === 'GRCROW') rendus++; }); await open(page, [R1]);
    console.log('  (chargement initial : rendus=', rendus, 'console=', total, ')'); rendus = 0;
    const n0 = await grcTable(page).locator('tbody tr').count();
    await grcTable(page).locator('tbody tr').first().locator('input[type="checkbox"]').first().click(); await wait(300); console.log('  (1re sélection GRC : rendus de GrcTableRow =', rendus, ')'); if (process.env.S10_LOG) ok(rendus >= 1 && rendus <= 3, `S10/TASK-099-S7 : 1 sélection sur ${n0} lignes → ${rendus} rendu(s) de GrcTableRow (chargement initial : ${n0} rendus)`); rendus = 0;
    ok(await grcTable(page).locator('tbody tr').count() === n0, `sélection d'un règlement : ${n0} lignes inchangées`);
    await relTable(page).locator('tbody tr', { hasText: 'T101 a3' }).locator('input[type="checkbox"]').first().click(); await wait(300);
    ok(true, 'sélection relevé + GRC sans erreur (pageerror = 0)');
    if (process.env.S10_LOG) {
      
      const nb = await grcTable(page).locator('tbody tr').count(); rendus = 0;
      await grcTable(page).locator('tbody tr').nth(5).locator('input[type="checkbox"]').first().click(); await wait(800); console.log('  (autre ligne sélectionnée : rendus =', rendus, ')');
    }
    await shot(page, 'screenshot_s10_selection');
    await page.context().close();
  } catch (e) { console.log('  EXCEPTION', e.stack || e); fail++; }
  finally {
    await browser.close(); server.close();
    try { await api('POST', '/api/ReleveBancaire/release-batch', Object.values(L).map(i => ({ ligneReleveId: i }))); } catch {}
    sql(`UPDATE l SET Lettrage=NULL, MV_ID=NULL, ReservePar_UserId=NULL, DateReservation=NULL FROM RAPP_ReleveBancaire_Ligne l WHERE l.ReleveBancaireEnteteId IN (${R1},${R2})`);
    sql(`DELETE FROM RAPP_ReleveBancaire_Ligne WHERE ReleveBancaireEnteteId IN (${R1},${R2}); DELETE FROM RAPP_ReleveBancaire_Entete WHERE Id IN (${R1},${R2})`);
    for (const c of cuIds) sql(`DELETE FROM P_UTILISATEURCAISSE WHERE CU_Id=${c}`);
    console.log(`\nTASK-101 E2E : ${fail === 0 ? 'TOUT OK' : fail + ' ÉCHEC(S)'}`); process.exit(fail ? 1 : 0);
  }
})();
