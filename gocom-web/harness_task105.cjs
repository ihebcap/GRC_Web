/**
 * harness_task105.cjs — TASK-105 : garde annulation réservé/pointé (base de TEST locale uniquement)
 *
 * Env requis : T105_SQL_SERVER, T105_SQL_DB, T105_SQL_USER, T105_SQL_PASSWORD (SQL via sqlcmd),
 *              T105_ADMIN_PASSWORD ; optionnel T105_API (défaut http://localhost:5000).
 * Aucun secret en dur. Refuse de tourner si le serveur n'est pas T105_SQL_SERVER local attendu.
 * NB : S1/S4 annulent réellement des règlements de la base de test (irréversible).
 */
'use strict';
const http = require('http');
const { execFileSync } = require('child_process');

const API = process.env.T105_API || 'http://localhost:5000';
const need = k => { if (!process.env[k]) { console.error(`Variable ${k} manquante`); process.exit(2); } return process.env[k]; };
const SRV = need('T105_SQL_SERVER'), DB = need('T105_SQL_DB'), USR = need('T105_SQL_USER'), PWD = need('T105_SQL_PASSWORD');
const ADMIN_PWD = need('T105_ADMIN_PASSWORD');
if (/PROD/i.test(SRV)) { console.error('Refus : serveur de prod'); process.exit(2); }

function sql(q) {
  const out = execFileSync('sqlcmd', ['-S', SRV, '-U', USR, '-P', PWD, '-C', '-d', DB, '-h', '-1', '-W', '-s', '|', '-Q', 'SET NOCOUNT ON; ' + q], { encoding: 'utf8' });
  return out.split(/\r?\n/).filter(Boolean).map(l => l.split('|'));
}
function api(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(API + path); const payload = body ? JSON.stringify(body) : '';
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) };
    if (token) headers.Authorization = `Bearer ${token}`;
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { let b; try { b = JSON.parse(d); } catch { b = d; } resolve({ status: res.statusCode, body: b }); });
    });
    req.on('error', reject); req.end(payload);
  });
}
let ok = 0, ko = 0;
const assert = (n, c, d) => { if (c) { console.log(`  OK  ${n}`); ok++; } else { console.log(`  KO  ${n} ${d || ''}`); ko++; } };
const state = id => sql(`SELECT MV_Annule, MV_Point FROM dbo.RT_MOUVEMENT WHERE MV_Id=${id}`)[0];

(async () => {
  console.log(`=== TASK-105 harness — ${new Date().toISOString()} — ${SRV}/${DB} ===`);
  const login = await api('POST', '/api/auth/login', { Username: 'Admin', Password: ADMIN_PWD, SocieteId: 1 });
  const tok = login.body.token; assert('login Admin', login.status === 200);
  const annuler = id => api('POST', `/api/reglements/${id}/annuler`, {}, tok);
  const freeReg = `MV_Type=3 AND MV_Domaine=0 AND MV_Point=0 AND MV_Compta=0 AND MV_Annule=0 AND MV_Remis=0
    AND NOT EXISTS(SELECT 1 FROM dbo.RT_AFFECTATION a WHERE a.MV_ID=m.MV_Id)
    AND NOT EXISTS(SELECT 1 FROM dbo.RAPP_ReleveBancaire_Ligne l WHERE l.MV_ID=m.MV_Id)`;
  const [[rlId, rlNum], [rrId, rrNum]] = sql(`SELECT TOP 2 MV_Id, MV_Numero FROM dbo.RT_MOUVEMENT m WHERE ${freeReg} ORDER BY MV_Id DESC`);
  const [lId] = sql(`SELECT TOP 1 Id FROM dbo.RAPP_ReleveBancaire_Ligne WHERE MV_ID IS NULL AND DateValidation IS NULL AND ReservePar_UserId IS NULL AND Credit>0 ORDER BY Id DESC`)[0];
  console.log(`Rl=${rlNum}(${rlId}) Rr=${rrNum}(${rrId}) ligne L=${lId}`);

  console.log('\n--- S1 libre -> 200');
  const s1 = await annuler(rlId);
  assert('S1 HTTP 200', s1.status === 200, JSON.stringify(s1.body));
  assert('S1 MV_Annule=1', state(rlId)[0] === '1');

  console.log('\n--- réservation de Rr sur L');
  const rs = await api('POST', '/api/ReleveBancaire/reserve', { ligneReleveId: +lId, mvId: +rrId }, tok);
  console.log('  reserve ->', rs.status, JSON.stringify(rs.body).slice(0, 200));
  assert('réservation 200', rs.status === 200);
  console.log('  SELECT L:', JSON.stringify(sql(`SELECT Id, MV_ID, Lettrage FROM dbo.RAPP_ReleveBancaire_Ligne WHERE Id=${lId}`)));

  console.log('\n--- S2/S9 réservé (Admin) -> 400');
  const s2 = await annuler(rrId);
  console.log('  réponse:', s2.status, JSON.stringify(s2.body));
  assert('S2 HTTP 400', s2.status === 400);
  assert('S2 message exact', s2.body && s2.body.message === `Le règlement [${rrNum}] est réservé par un rapprochement bancaire et ne peut pas être annulé. Libérez d'abord la ligne du relevé.`);
  assert('S2 règlement non annulé', state(rrId)[0] === '0');
  assert('S2 L toujours liée à Rr', sql(`SELECT MV_ID FROM dbo.RAPP_ReleveBancaire_Ligne WHERE Id=${lId}`)[0][0] === rrId);

  console.log('\n--- S5 pointé sans ligne -> 400');
  const rp = sql(`SELECT TOP 1 MV_Id, MV_Numero FROM dbo.RT_MOUVEMENT m WHERE MV_Point=1 AND MV_Compta=0 AND MV_Annule=0 AND MV_Remis IN (0,2) AND NOT EXISTS(SELECT 1 FROM dbo.RT_AFFECTATION a WHERE a.MV_ID=m.MV_Id) AND NOT EXISTS(SELECT 1 FROM dbo.RAPP_ReleveBancaire_Ligne l WHERE l.MV_ID=m.MV_Id) ORDER BY MV_Id DESC`)[0];
  if (rp) {
    const s5 = await annuler(rp[0]); console.log('  réponse:', s5.status, JSON.stringify(s5.body));
    assert('S5 HTTP 400', s5.status === 400);
    assert('S5 message exact', s5.body && s5.body.message === `Le règlement [${rp[1]}] est pointé (rapproché) et ne peut pas être annulé.`);
    assert('S5 non annulé', state(rp[0])[0] === '0');
  } else console.log('  (aucun pointé sans ligne trouvé — S5 par ligne validée ci-dessous)');

  console.log('\n--- S6 pointé + ligne validée -> 400 « pointé »');
  const rv = sql(`SELECT TOP 1 m.MV_Id, m.MV_Numero FROM dbo.RT_MOUVEMENT m JOIN dbo.RAPP_ReleveBancaire_Ligne l ON l.MV_ID=m.MV_Id WHERE l.DateValidation IS NOT NULL AND m.MV_Point=1 AND m.MV_Compta=0 AND m.MV_Annule=0 AND NOT EXISTS(SELECT 1 FROM dbo.RT_AFFECTATION a WHERE a.MV_ID=m.MV_Id) ORDER BY m.MV_Id DESC`)[0];
  if (rv) {
    const s6 = await annuler(rv[0]); console.log('  réponse:', s6.status, JSON.stringify(s6.body));
    assert('S6 HTTP 400 message pointé', s6.status === 400 && s6.body.message === `Le règlement [${rv[1]}] est pointé (rapproché) et ne peut pas être annulé.`);
    assert('S6 non annulé', state(rv[0])[0] === '0');
  } else console.log('  (aucun candidat)');

  console.log('\n--- S8 non-régression');
  const rc = sql(`SELECT TOP 1 MV_Id FROM dbo.RT_MOUVEMENT WHERE MV_Compta=1 AND MV_Point=0 AND MV_Annule=0 ORDER BY MV_Id DESC`)[0];
  if (rc) { const r = await annuler(rc[0]); console.log('  comptabilisé:', r.status, JSON.stringify(r.body)); assert('S8 compta 400', r.status === 400); }
  const ra = sql(`SELECT TOP 1 MV_Id FROM dbo.RT_MOUVEMENT WHERE MV_Annule=1 ORDER BY MV_Id DESC`)[0];
  if (ra) { const r = await annuler(ra[0]); console.log('  déjà annulé:', r.status, JSON.stringify(r.body)); assert('S8 annulé 400', r.status === 400); }
  const raf = sql(`SELECT TOP 1 m.MV_Id FROM dbo.RT_MOUVEMENT m WHERE m.MV_Annule=0 AND m.MV_Compta=0 AND m.MV_Point=0 AND EXISTS(SELECT 1 FROM dbo.RT_AFFECTATION a WHERE a.MV_ID=m.MV_Id) ORDER BY m.MV_Id DESC`)[0];
  if (raf) { const r = await annuler(raf[0]); console.log('  affecté:', r.status, JSON.stringify(r.body)); assert('S8 affecté 400', r.status === 400); }

  console.log('\n--- S4 libération puis annulation');
  const rl = await api('POST', '/api/ReleveBancaire/release', { ligneReleveId: +lId }, tok);
  console.log('  release ->', rl.status, JSON.stringify(rl.body));
  assert('libération 200', rl.status === 200);
  const s4 = await annuler(rrId); console.log('  annulation:', s4.status, JSON.stringify(s4.body));
  assert('S4 annulation 200 après libération', s4.status === 200);
  assert('S4 MV_Annule=1', state(rrId)[0] === '1');

  console.log(`\nTOTAL : ${ok} OK / ${ko} KO — ${new Date().toISOString()}`);
  process.exit(ko ? 1 : 0);
})().catch(e => { console.error('Erreur fatale', e); process.exit(1); });
