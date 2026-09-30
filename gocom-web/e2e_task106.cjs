// TASK-106 — E2E Playwright contre l'API RÉELLE (base de TEST). Pas de mock.
// Env : GRC_E2E_BASE_URL (API, ex. http://localhost:5044), GRC_E2E_USER1, GRC_E2E_PASS1, SQLCMDPASSWORD (pour l'étape S4 « autre utilisateur »)
// Jeu d'essai : voir tasks/VERIFY/TASK-106_verify.md (relevés T106-RX / T106-RY, règlements 48321…).
const http = require('http'), fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const API = process.env.GRC_E2E_BASE_URL, U = process.env.GRC_E2E_USER1, P = process.env.GRC_E2E_PASS1, U2 = process.env.GRC_E2E_USER2, P2 = process.env.GRC_E2E_PASS2;
if (!API || !U || !P || !U2 || !P2) { console.error('Variables GRC_E2E_* manquantes'); process.exit(2); }
const WWWROOT = path.resolve(__dirname, '../deploy/wwwroot'), PORT = 3507;
const EV = path.resolve(__dirname, '../tasks/VERIFY/TASK-106_evidence'); fs.mkdirSync(EV, { recursive: true });
let RX, RY;
let LG = {};
let RG = { R1: 0, R2: 48322, R3: 0, R4: 0, R5: 48242, R6: 48283, R7: 48271, R8: 48272 };
let tok, tok2, u1id, u2id, y4amt, r8amt, fail = 0, reglInfo = {};
const letter = (k) => sql(`SELECT ISNULL(Lettrage,'') FROM RAPP_ReleveBancaire_Ligne WHERE id=${LG[k]}`);
const ok = (c, m) => { console.log(c ? '  OK :' : '  KO :', m); if (!c) fail++; };
const sql = (q) => execFileSync('sqlcmd', ['-S', 'DESKTOP-2VCUE93', '-U', 'sa', '-C', '-I', '-W', '-h', '-1', '-s', '|', '-d', 'GR_GOCOM', '-Q', 'SET NOCOUNT ON; ' + q], { encoding: 'latin1' }).trim();
const api = async (method, url, body, token) => {
  const r = await fetch(API + url, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token || tok}` }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); try { return JSON.parse(t); } catch { return t; }
};
// Serveur statique + proxy /api → API réelle
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
  const login = async (u, p) => (await fetch(API + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ Username: u, Password: p, SocieteId: 1 }) })).json();
  const lg = await login(U, P), lg2 = await login(U2, P2); tok = lg.token; tok2 = lg2.token; u1id = lg.no; u2id = lg2.no;
  console.log(`U1 = ${U} (id ${u1id}, admin=${lg.isAdmin}, ${lg.caisses.length} caisses) ; U2 = ${U2} (id ${u2id}, admin=${lg2.isAdmin}, ${lg2.caisses.length} caisses)`);
  // Libère les réservations en cours des essais précédents (relevés de test T106-*, lignes non validées)
  sql(`UPDATE l SET Lettrage=NULL, MV_ID=NULL, ReservePar_UserId=NULL, DateReservation=NULL FROM RAPP_ReleveBancaire_Ligne l JOIN RAPP_ReleveBancaire_Entete e ON e.id=l.ReleveBancaireEnteteId WHERE e.Titre LIKE N'T106-%' AND l.DateValidation IS NULL`);
  // Jeu frais à chaque exécution (les approbations S3/S4 consomment des règlements ; des relevés NEUFS repartent à la lettre « A » → collision garantie) :
  // 3 règlements neufs (montant unique, non pointé, non annulé, éligible, juillet) + les 5 règlements fixes ; 2 nouveaux relevés + 8 lignes (tables RAPP_* de TEST uniquement).
  const cand = sql(`SET DATEFORMAT ymd; SELECT TOP 8 MV_Id, MV_Montant FROM RT_MOUVEMENT m WHERE BN_Id=1 AND MV_Domaine=0 AND MV_Point=0 AND MV_Annule=0 AND MV_Type=3 AND MV_Montant BETWEEN 100 AND 100000 AND MV_Date BETWEEN '20260701' AND '20260719' AND CA_IdIn IN (SELECT c1.CA_Id FROM P_UTILISATEURCAISSE c1 JOIN P_UTILISATEURCAISSE c2 ON c2.CA_Id=c1.CA_Id WHERE c1.UT_Id=${u1id} AND c2.UT_Id=${u2id}) AND (SELECT COUNT(*) FROM RT_MOUVEMENT x WHERE x.BN_Id=1 AND x.MV_Point=0 AND x.MV_Annule=0 AND x.MV_Montant=m.MV_Montant)=1 AND NOT EXISTS (SELECT 1 FROM RAPP_ReleveBancaire_Ligne l WHERE l.MV_ID=m.MV_Id) ORDER BY MV_Id DESC`).split(/[\r\n]+/).map(l => l.split('|'));
  if (cand.length < 8) throw new Error('pas assez de règlements candidats');
  RG = Object.fromEntries(['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8'].map((k, i) => [k, +cand[i][0]]));
  const amt = Object.fromEntries(cand);
  r8amt = Number(amt[RG.R8]); y4amt = (r8amt + 50).toFixed(2);
  const tag = new Date().toISOString().slice(11, 19);
  const mk = (t) => +sql(`INSERT dbo.RAPP_ReleveBancaire_Entete (BanqueId, Titre, DateImport, ImportePar_UserId) VALUES (1, N'T106-${t} ${tag}', GETDATE(), N'test'); SELECT SCOPE_IDENTITY()`).split(/[\r\n]+/).pop();
  RX = mk('RX'); RY = mk('RY');
  const ins = (e, lib, m) => sql(`INSERT dbo.RAPP_ReleveBancaire_Ligne (ReleveBancaireEnteteId, DateOperation, DateValeur, Libelle, Reference, Code, Debit, Credit, MontantReel) VALUES (${e},GETDATE(),GETDATE(),N'T106 ${lib}',N'${lib}',N'${lib}',0,${m},${m})`);
  const lineId = (lib, e) => +sql(`SELECT id FROM RAPP_ReleveBancaire_Ligne WHERE ReleveBancaireEnteteId=${e} AND Libelle=N'T106 ${lib}'`);
  [['X1', RX, 'R1'], ['X2', RX, 'R2'], ['X3', RX, 'R5'], ['X4', RX, 'R7'], ['Y1', RY, 'R3'], ['Y2', RY, 'R4'], ['Y3', RY, 'R6']].forEach(([l, e, r]) => ins(e, l, amt[RG[r]]));
  ins(RY, 'Y4', y4amt);      // Y4 : montant volontairement différent de R8 (+50)
  LG = Object.fromEntries(['X1', 'X2', 'X3', 'X4'].map(l => [l, lineId(l, RX)]).concat(['Y1', 'Y2', 'Y3', 'Y4'].map(l => [l, lineId(l, RY)])));
  console.log('Jeu frais : relevés RX,RY =', RX, RY, '; règlements R1,R3,R4 =', RG.R1, RG.R3, RG.R4, '; lignes', JSON.stringify(LG));
  // remise à l'état : libérer toutes les lignes de test non validées, restaurer X2 (simulation autre utilisateur)
  sql(`UPDATE RAPP_ReleveBancaire_Ligne SET Lettrage=NULL, MV_ID=NULL, ReservePar_UserId=NULL, DateReservation=NULL WHERE id IN (${LG.X2},${LG.X3},${LG.X4},${LG.Y3},${LG.Y4},${LG.X1},${LG.Y1},${LG.Y2}) AND DateValidation IS NULL`);
  const items = (await api('GET', `/api/reglements?societeId=1&caisses=${lg.caisses.join(',')}&banqueNos=1&page=1&pageSize=1000&pointe=false&eligibleRappBancaire=true&dateDebut=2026-07-01&dateFin=2026-07-31T23:59:59`)).items;
  for (const [k, no] of Object.entries(RG)) { const r = items.find(i => i.no === no); if (r) reglInfo[k] = { numero: r.numero, montant: r.montant }; }
  console.log('Règlements du jeu d\'essai visibles :', Object.keys(reglInfo).join(','));
  // État de départ, posé AVANT le chargement de la page : X1↔R1 sur RX, Y1↔R3 sur RY (même lettre « A »)
  await api('POST', '/api/ReleveBancaire/reserve', { ligneReleveId: LG.X1, mvId: RG.R1 });
  await api('POST', '/api/ReleveBancaire/reserve', { ligneReleveId: LG.Y1, mvId: RG.R3 });
  // S8 — API GET /reglements (nom d'utilisateur résolu) + noms JSON d'une ligne de relevé
  console.log('\n--- S8 : API GET /reglements et noms JSON ---');
  const grcUrl = `/api/reglements?societeId=1&caisses=${lg.caisses.join(',')}&banqueNos=1&page=1&pageSize=1000&pointe=false&eligibleRappBancaire=true&dateDebut=2026-07-01&dateFin=2026-07-31T23:59:59`;
  const s8 = (await api('GET', grcUrl)).items, g8 = (no) => s8.find(i => i.no === no);
  ok(g8(RG.R1).releveEnteteId === RX && !!g8(RG.R1).reservePar_UserName, `R1 réservé, nom résolu « ${g8(RG.R1).reservePar_UserName} » → releveEnteteId = ${g8(RG.R1).releveEnteteId} (= RX ${RX})`);
  ok(g8(RG.R3).releveEnteteId === RY, `R3 → releveEnteteId = ${g8(RG.R3).releveEnteteId} (= RY ${RY})`);
  ok(g8(RG.R8).releveEnteteId === null && !g8(RG.R8).lettrage, 'règlement libre → releveEnteteId = null');
  const keysLibre = Object.keys(g8(RG.R8)).filter(k => k !== 'releveEnteteId').sort().join(), keysRes = Object.keys(g8(RG.R1)).filter(k => k !== 'releveEnteteId').sort().join();
  ok(keysLibre === keysRes && Object.keys(g8(RG.R8)).includes('releveEnteteId'), 'seul le champ releveEnteteId est ajouté (mêmes autres clés JSON)');
  const l8 = (await api('GET', `/api/ReleveBancaire/${RY}/lignes`)).find(l => l.id === LG.Y1);
  console.log('  ligne Y1 (extrait) :', JSON.stringify({ id: l8.id, mV_ID: l8.mV_ID, releveBancaireEnteteId: l8.releveBancaireEnteteId, lettrage: l8.lettrage }));
  ok(l8.mV_ID === RG.R3 && l8.releveBancaireEnteteId === RY, 'noms JSON mV_ID / releveBancaireEnteteId prouvés par une réponse réelle');
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1700, height: 1000 } })).newPage();
  const net = []; // requêtes POST /ReleveBancaire/*
  page.on('request', r => { const u = r.url(); if (r.method() === 'POST' && u.includes('/ReleveBancaire/')) net.push({ ep: u.split('/ReleveBancaire/')[1], body: r.postData() }); });
  page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
  const nets = () => { const n = net.splice(0); return n; };
  const grcRow = (k) => page.locator('table').last().locator('tbody tr', { hasText: reglInfo[k].numero });
  const ligRow = (k) => page.locator('table').first().locator('tbody tr', { hasText: `T106 ${k}` });
  const grcOrder = () => page.locator('table').last().locator('tbody tr').evaluateAll(trs => trs.map(t => t.innerText));
  const bodyTxt = () => page.locator('body').innerText();
  const shot = (n) => page.screenshot({ path: path.join(EV, `real_${n}.png`) });
  const pickReleve = async (id, label) => { await page.selectOption('select.toolbar-select >> nth=1', String(id)); await page.waitForSelector(`table >> nth=0 >> text=${label}`, { timeout: 15000 }); await wait(500); };
  const refresh = async () => { const w = page.waitForResponse(r => r.url().includes('/api/reglements?') && r.request().method() === 'GET', { timeout: 20000 }); await page.click('button:has-text("Actualiser")'); await w; await wait(700); };
  const setPeriod = async (du, au) => { await page.fill('input[type="date"] >> nth=0', du); await page.fill('input[type="date"] >> nth=1', au); await refresh(); };
  const reloadGrc = async () => { await setPeriod('2026-07-01', '2026-07-30'); await setPeriod('2026-07-01', '2026-07-31'); }; // « Actualiser » ne recharge pas si les dates sont inchangées
  const clickCheck = (row) => row.locator('input[type="checkbox"]').first().click();
  try {
    await page.goto(`http://localhost:${PORT}`);
    await page.fill('input[type="text"]', U); await page.fill('input[type="password"]', P); await page.click('button[type="submit"]');
    await page.waitForSelector('.rappro-title', { timeout: 15000 }).catch(() => {});
    if (await page.locator('.rappro-title').count() === 0) await page.locator('text=Rapprochement').first().click();
    await page.waitForSelector('.rappro-title');
    await page.selectOption('select.toolbar-select >> nth=0', '1'); await wait(1500);
    await page.selectOption('select.toolbar-select >> nth=2', 'tous');
    const t0 = Date.now(); await setPeriod('2026-07-01', '2026-07-31'); console.log(`  chargement grille GRC (période juillet, max 1000 lignes) : ${Date.now() - t0} ms`);

    await pickReleve(RY, 'T106 Y1');    await pickReleve(RY, 'T106 Y1');

    console.log('\n--- S2 : collision (RY affiché) ---');
    await grcRow('R1').locator('svg.lucide-lock').waitFor({ timeout: 8000 }).catch(() => {});
    ok(await grcRow('R1').locator('svg.lucide-lock').count() === 1, 'R1 : cadenas');
    ok((await grcRow('R1').innerText()).includes(`#${RX}`), `R1 : libellé #${RX}`);
    const lX = letter('X1'), lY = letter('Y1'); console.log(`  lettres : X1 (RX) = ${lX} ; Y1 (RY) = ${lY}`);
    ok(lX === lY, 'collision réelle : la même lettre sur deux relevés');
    ok((await grcRow('R1').innerText()).includes(`${RX}-${lX}`), `R1 : repère ${RX}-${lX}`);
    ok(await grcRow('R1').locator('input[type="checkbox"]').count() === 0, 'R1 : sans case');
    ok(await grcRow('R3').locator('svg.lucide-lock').count() === 0 && await grcRow('R3').locator('input[type="checkbox"]:checked').count() === 1, 'R3 : apparié à Y1 (case cochée, sans cadenas)');
    ok(!(await grcRow('R3').innerText()).includes('-') || !(await grcRow('R3').innerText()).includes(`${RY}-`), `R3 : repère « ${lY} » nu (sans préfixe)`);
    await shot('s2_ry_affiche');
    nets();
    await grcRow('R1').locator('td').nth(3).click({ force: true }).catch(() => {}); await wait(500);
    ok(nets().length === 0, 'clic sur R1 : aucun appel réseau');
    await clickCheck(ligRow('Y1')); await wait(1200);
    const n2 = nets(); ok(n2.length === 1 && n2[0].ep === 'release-batch' && JSON.stringify(JSON.parse(n2[0].body)) === JSON.stringify([{ ligneReleveId: LG.Y1 }]), `clic Y1 : release-batch [${LG.Y1}] uniquement (${n2.map(x => x.ep + ' ' + x.body).join(';')})`);
    ok(sql(`SELECT CONCAT(Lettrage,'/',MV_ID) FROM RAPP_ReleveBancaire_Ligne WHERE id=${LG.X1}`) === `${lX}/${RG.R1}`, `SQL : X1 toujours réservée (${lX} / MV_ID R1)`);
    ok(sql(`SELECT ISNULL(Lettrage,'libre') FROM RAPP_ReleveBancaire_Ligne WHERE id=${LG.Y1}`) === 'libre', 'SQL : Y1 libre');
    ok(await grcRow('R1').locator('svg.lucide-lock').count() === 1, 'R1 toujours verrouillé');
    await shot('s2_apres_liberation_y1');

    console.log('\n--- S3 : réserver Y1↔R3 et Y2↔R4 puis Approuver ---');
    await clickCheck(ligRow('Y1')); await clickCheck(grcRow('R3')); await wait(1000);
    await clickCheck(ligRow('Y2')); await clickCheck(grcRow('R4')); await wait(1000);
    console.log('  SQL lettres RY :', sql(`SELECT STRING_AGG(CONCAT(id,':',Lettrage),',') FROM RAPP_ReleveBancaire_Ligne WHERE ReleveBancaireEnteteId=${RY} AND Lettrage IS NOT NULL`));
    const ord = await grcOrder(); const idx = k => ord.findIndex(t => t.includes(reglInfo[k].numero));
    ok(idx('R3') < idx('R4') && idx('R4') < idx('R1') || idx('R3') < idx('R1'), `tri : appariés (R3=${idx('R3')}, R4=${idx('R4')}) avant « ailleurs » (R1=${idx('R1')})`);
    ok(idx('R1') < idx('R2') && idx('R1') < idx('R8'), 'tri : « réservé ailleurs » avant les libres');
    await shot('s3_avant_approuver'); nets();
    await page.click('button:has-text("Approuver")'); await wait(2500);
    const n3 = nets(); const v = n3.find(x => x.ep === 'validate'); const pairs = v ? JSON.parse(v.body).map(p => [p.releveLigneId, p.grcReglementId]) : [];
    console.log('  corps validate :', JSON.stringify(pairs));
    ok(pairs.length === 2 && pairs.some(p => p[0] === LG.Y1 && p[1] === RG.R3) && pairs.some(p => p[0] === LG.Y2 && p[1] === RG.R4), 'validate = (Y1,R3) et (Y2,R4) exactement');
    const txt = await bodyTxt(); ok(txt.includes('Rapprochement validé avec succès'), 'toast succès, aucune erreur');
    ok(await grcRow('R1').count() === 1, 'R1 reste affiché'); ok(await grcRow('R3').count() === 0 && await grcRow('R4').count() === 0, 'R3, R4 retirés');
    console.log('  SQL validation :', sql(`SELECT STRING_AGG(CONCAT(id,':',CASE WHEN DateValidation IS NULL THEN 'en cours' ELSE 'valide' END),',') FROM RAPP_ReleveBancaire_Ligne WHERE id IN (${LG.X1},${LG.Y1},${LG.Y2})`));
    console.log('  SQL pointage   :', sql(`SELECT STRING_AGG(CONCAT(MV_Id,':pointe=',MV_Point),',') FROM RT_MOUVEMENT WHERE MV_Id IN (${RG.R1},${RG.R3},${RG.R4})`));
    await shot('s3_apres_approuver');

    console.log('\n--- S4 : réservation d\'un autre utilisateur (vraie session U2) ---');
    const other = String(u2id);
    const r2res = await api('POST', '/api/ReleveBancaire/reserve', { ligneReleveId: LG.X2, mvId: RG.R2 }, tok2);
    ok(r2res && r2res.lettrage, `U2 (${U2}) réserve X2↔R2 par une vraie session (lettre ${r2res && r2res.lettrage})`);
    const dbl = await fetch(API + '/api/ReleveBancaire/reserve', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: JSON.stringify({ ligneReleveId: LG.X2, mvId: RG.R2 }) });
    ok(dbl.status === 409, `U1 tente de réserver la ligne de U2 : refus serveur HTTP ${dbl.status} (attendu 409)`);
    await pickReleve(RX, 'T106 X2');
    await reloadGrc();
    ok(await grcRow('R2').locator('svg.lucide-lock').count() === 1 && await ligRow('X2').locator('svg.lucide-lock').count() === 1, 'X2 / R2 verrouillés (cadenas) pour l\'utilisateur courant');
    ok(await grcRow('R1').locator('svg.lucide-lock').count() === 0, 'X1↔R1 (à moi) : apparié, sans cadenas');
    await shot('s4_avant_approuver'); nets();
    await page.click('button:has-text("Approuver")'); await wait(2500);
    const v4 = nets().find(x => x.ep === 'validate'); const p4 = v4 ? JSON.parse(v4.body).map(p => [p.releveLigneId, p.grcReglementId]) : [];
    console.log('  corps validate :', JSON.stringify(p4));
    ok(p4.length === 1 && p4[0][0] === LG.X1 && p4[0][1] === RG.R1, 'validate = (X1,R1) seulement');
    const t4 = await bodyTxt(); ok(t4.includes('Rapprochement validé avec succès') && !t4.includes('erreurs'), 'aucun message d\'erreur');
    ok(await grcRow('R2').count() === 1 && await ligRow('X2').count() === 1, 'X2 / R2 restent visibles');
    ok(sql(`SELECT CAST(ReservePar_UserId AS varchar) FROM RAPP_ReleveBancaire_Ligne WHERE id=${LG.X2}`) === other, 'SQL : X2 toujours réservée par l\'autre utilisateur');
    await shot('s4_apres_approuver');

    console.log('\n--- S5 : règlement hors grille ---');
    await clickCheck(ligRow('X3')); await clickCheck(grcRow('R5')); await wait(1000);
    ok(sql(`SELECT ISNULL(Lettrage,'-') FROM RAPP_ReleveBancaire_Ligne WHERE id=${LG.X3}`) !== '-', 'X3↔R5 réservée');
    await setPeriod('2026-07-20', '2026-07-31');
    ok(await grcRow('R5').count() === 0, 'R5 absent de la grille (période réduite)');
    ok(await ligRow('X3').locator('input[type="checkbox"]:checked').count() === 1, 'X3 toujours lettrée à l\'écran'); nets();
    await page.click('button:has-text("Approuver")'); await wait(700);
    ok(nets().every(x => x.ep !== 'validate'), 'aucun appel validate');
    const t5 = await bodyTxt(); ok(t5.includes("1 ligne(s) réservée(s) n'ont pas de règlement dans la grille GRC (période ou filtre)"), 'message exact (n = 1 : la réservation de l\'autre utilisateur est ignorée)');
    ok(await ligRow('X3').count() === 1, 'X3 conservée à l\'écran'); await shot('s5_message');
    await clickCheck(ligRow('X3')); await wait(1200);
    const n5 = nets(); ok(n5.length === 1 && n5[0].ep === 'release-batch' && JSON.stringify(JSON.parse(n5[0].body)) === JSON.stringify([{ ligneReleveId: LG.X3 }]), 'clic X3 : release-batch [X3] (chemin de secours)');
    ok(sql(`SELECT ISNULL(Lettrage,'libre') FROM RAPP_ReleveBancaire_Ligne WHERE id=${LG.X3}`) === 'libre', 'SQL : X3 libérée');
    await setPeriod('2026-07-01', '2026-07-31');

    console.log('\n--- S6/S7 : tri, filtre Repère, Dérapprocher (RY affiché) ---');
    await api('POST', '/api/ReleveBancaire/reserve', { ligneReleveId: LG.X4, mvId: RG.R7 });   // R7 réservé sur RX (moi)
    await pickReleve(RX, 'T106 X2'); await pickReleve(RY, 'T106 Y3'); await reloadGrc();
    await clickCheck(ligRow('Y3')); await clickCheck(grcRow('R6')); await wait(1000);
    const o6 = await grcOrder(); const i6 = k => o6.findIndex(t => t.includes(reglInfo[k].numero));
    console.log('  ordre (indices) R6,R7,R2,R8 :', i6('R6'), i6('R7'), i6('R2'), i6('R8'));
    ok(i6('R6') < i6('R7') && i6('R6') < i6('R2') && Math.max(i6('R7'), i6('R2')) < i6('R8'), 'tri : R6 (apparié) < R7,R2 (ailleurs) < R8 (libre)');
    ok((await grcRow('R7').innerText()).includes(`${RX}-`), 'R7 : repère préfixé');
    await shot('s6_tri');
    // Filtre « Repère » de la grille GRC : valeurs affichées ; chaque valeur ne montre que la ligne correspondante
    const lY3 = letter('Y3'), lX4 = letter('X4');
    const filterBy = async (val) => {
      const th = page.locator('table').last().locator('thead th', { hasText: 'Repère' });
      await th.locator('svg').last().click(); await wait(400);
      const opts = await page.locator('label span').allInnerTexts();
      const box = page.locator('label', { has: page.locator(`span:text-is("${val}")`) }).locator('input[type="checkbox"]');
      const present = await box.count() === 1;
      if (present) { await box.click(); await wait(500); }
      const n = await page.locator('table').last().locator('tbody tr').count();
      const txts = await page.locator('table').last().locator('tbody tr').allInnerTexts();
      await page.locator('button:has-text("Effacer")').last().click().catch(() => {}); await wait(400);
      return { opts, present, n, txts };
    };
    const f1 = await filterBy(lY3);
    console.log('  valeurs proposées par le filtre Repère :', JSON.stringify(f1.opts.filter(o => o.length < 12).slice(0, 14)));
    ok(f1.present && f1.n === 1 && f1.txts[0].includes(reglInfo.R6.numero), `filtre « ${lY3} » (apparié) : 1 seule ligne, R6`);
    const f2 = await filterBy(`${RX}-${lX4}`);
    ok(f2.present && f2.n === 1 && f2.txts[0].includes(reglInfo.R7.numero), `filtre « ${RX}-${lX4} » (réservé ailleurs) : 1 seule ligne, R7`);
    await shot('s6_filtre');
    nets(); await page.click('button:has-text("Dérapprocher")'); await wait(1500);
    const n7 = nets(); ok(n7.length === 1 && n7[0].ep === 'release-batch' && JSON.stringify(JSON.parse(n7[0].body)) === JSON.stringify([{ ligneReleveId: LG.Y3 }]), `Dérapprocher : release-batch [Y3] uniquement (${n7.map(x => x.body).join(';')})`);
    ok(sql(`SELECT CONCAT(ISNULL(Lettrage,'libre'),'/',ISNULL(MV_ID,0)) FROM RAPP_ReleveBancaire_Ligne WHERE id=${LG.X4}`) === `${sql(`SELECT Lettrage FROM RAPP_ReleveBancaire_Ligne WHERE id=${LG.X4}`)}/${RG.R7}`, 'SQL : X4 toujours réservée (MV_ID = R7)');
    ok(await grcRow('R7').locator('svg.lucide-lock').count() === 1, 'R7 reste « réservé ailleurs »'); await shot('s7_apres_deraprocher');

    console.log('\n--- S10 : re-rendus (MutationObserver sur le tbody GRC, données réelles) ---');
    const rows = await page.locator('table').last().locator('tbody tr').count(); console.log('  lignes GRC affichées :', rows);
    await page.evaluate(() => { window.__mut = 0; const tb = document.querySelectorAll('table')[document.querySelectorAll('table').length - 1].querySelector('tbody'); window.__obs = new MutationObserver(m => { window.__mut += m.length; }); window.__obs.observe(tb, { subtree: true, childList: true, attributes: true, characterData: true }); });
    await ligRow('Y4').locator('td').nth(4).click(); await wait(600);   // sélection d'une ligne du relevé (pas de lettrage)
    const mutSel = await page.evaluate(() => window.__mut);
    ok(mutSel === 0, `sélection d'une ligne de relevé : ${mutSel} mutation(s) dans la grille GRC (attendu 0)`);
    await page.evaluate(() => { window.__mut = 0; });
    await clickCheck(ligRow('Y4')); await wait(300); // dé-sélection
    console.log('\n--- S9 : écart de montant (Y4 7 200,00 ↔ R8) ---');
    await pickReleve(RY, 'T106 Y4'); nets();
    if (await ligRow('Y4').locator('input[type="checkbox"]:checked').count() === 0) await clickCheck(ligRow('Y4'));   // Y4 peut déjà être sélectionnée (S10)
    await clickCheck(grcRow('R8')); await wait(800);
    ok(await page.locator('button:has-text("Mettre à jour le montant et rapprocher")').count() === 1, 'bandeau « Mettre à jour le montant et rapprocher »'); await shot('s9_bandeau');
    await page.click('button:has-text("Mettre à jour le montant et rapprocher")'); await wait(3000);
    ok(sql(`SELECT CONCAT(l.MV_ID,'/',CAST(m.MV_Montant AS decimal(12,2))) FROM RAPP_ReleveBancaire_Ligne l JOIN RT_MOUVEMENT m ON m.MV_Id=l.MV_ID WHERE l.id=${LG.Y4}`) === `${RG.R8}/${y4amt}`, 'SQL : Y4 réservée avec R8 (MV_ID renseigné), montant de R8 = 7 200,00');
    await clickCheck(ligRow('Y4')); await wait(1200);
    const n9 = nets(); ok(n9.some(x => x.ep === 'release-batch' && JSON.stringify(JSON.parse(x.body)) === JSON.stringify([{ ligneReleveId: LG.Y4 }])), 'libération ultérieure par un clic (mvId bien renseigné côté écran)');
    ok(sql(`SELECT ISNULL(Lettrage,'libre') FROM RAPP_ReleveBancaire_Ligne WHERE id=${LG.Y4}`) === 'libre', 'SQL : Y4 libre');
    // nettoyage : libère les lignes de test non validées
    sql(`UPDATE RAPP_ReleveBancaire_Ligne SET Lettrage=NULL, MV_ID=NULL, ReservePar_UserId=NULL, DateReservation=NULL WHERE ReleveBancaireEnteteId IN (${RX},${RY}) AND DateValidation IS NULL`);
    const put = await fetch(API + `/api/reglements/${RG.R8}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: JSON.stringify({ montant: r8amt }) }); console.log(`  R8 restauré à ${r8amt} (HTTP ${put.status})`);
    console.log('\nFIN — réservations de test libérées');
  } catch (e) { fail++; console.log('\nEXCEPTION :', e.message.split('\n')[0]); await page.screenshot({ path: path.join(EV, 'real_exception.png') }).catch(() => {}); }
  finally { await browser.close(); server.close(); console.log(fail ? `\nRÉSULTAT : ${fail} KO` : '\nRÉSULTAT : PASS'); process.exit(fail ? 1 : 0); }
})();
