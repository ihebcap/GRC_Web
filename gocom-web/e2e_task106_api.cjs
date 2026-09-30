// TASK-106 — vérifications API réelles (base de TEST). Identifiants via l'environnement, jamais en dur :
// GRC_E2E_BASE_URL (ex. http://localhost:5044), GRC_E2E_USER1, GRC_E2E_PASS1.
const BASE = process.env.GRC_E2E_BASE_URL, U = process.env.GRC_E2E_USER1, P = process.env.GRC_E2E_PASS1;
if (!BASE || !U || !P) { console.error('Variables GRC_E2E_* manquantes'); process.exit(2); }
const RX = 1007, RY = 1008;                       // relevés de test T106-RX / T106-RY
const L = { X1: 5845, Y1: 5849 }, R = { R1: 48321, R2: 48322, R3: 48336 }; // lignes / règlements du jeu d'essai
let tok, fail = 0;
const ok = (c, m) => { console.log(c ? '  OK :' : '  KO :', m); if (!c) fail++; };
const api = async (method, url, body) => {
  const r = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, data: j };
};
const grc = async () => (await api('GET', '/api/reglements?societeId=1&caisses=&banqueNos=1&page=1&pageSize=1000&pointe=false&eligibleRappBancaire=true&dateDebut=2026-07-01&dateFin=2026-07-31T23:59:59')).data.items;
(async () => {
  const lg = await api('POST', '/api/auth/login', { Username: U, Password: P, SocieteId: 1 });
  tok = lg.data.token; ok(!!tok, 'login');
  // nettoyage préalable
  await api('POST', '/api/ReleveBancaire/release-batch', [{ ligneReleveId: L.X1 }, { ligneReleveId: L.Y1 }]);
  let items = await grc(); const before = Object.fromEntries(items.filter(i => Object.values(R).includes(i.no)).map(i => [i.no, i]));
  ok(Object.keys(before).length === 3, 'R1,R2,R3 présents dans la grille');
  ok(Object.values(before).every(i => i.releveEnteteId === null && !i.lettrage), 'libres : releveEnteteId = null');
  console.log('\n-- S0/S2 : la même lettre sur deux relevés --');
  const a = await api('POST', '/api/ReleveBancaire/reserve', { ligneReleveId: L.X1, mvId: R.R1 });
  const b = await api('POST', '/api/ReleveBancaire/reserve', { ligneReleveId: L.Y1, mvId: R.R3 });
  console.log('  lettres attribuées :', a.data.lettrage, b.data.lettrage);
  ok(a.data.lettrage && a.data.lettrage === b.data.lettrage, 'collision réelle : X1 (RX) et Y1 (RY) ont la même lettre');
  console.log('\n-- S8 : GET /reglements --');
  items = await grc(); const g = n => items.find(i => i.no === n);
  ok(g(R.R1).releveEnteteId === RX && g(R.R1).reservePar_UserName, `R1 (réservé, nom résolu « ${g(R.R1).reservePar_UserName} ») → releveEnteteId = ${g(R.R1).releveEnteteId}`);
  ok(g(R.R3).releveEnteteId === RY, `R3 → releveEnteteId = ${g(R.R3).releveEnteteId}`);
  ok(g(R.R2).releveEnteteId === null, 'R2 (libre) → null');
  const kb = Object.keys(before[R.R2]).sort(), ka = Object.keys(g(R.R2)).sort();
  ok(JSON.stringify(kb) === JSON.stringify(ka), 'libre : mêmes clés JSON avant/après réservation');
  console.log('  clés d\'un règlement (extrait) :', ka.filter(k => /lettr|reserv|entete/i.test(k)).join(', '));
  console.log('\n-- Noms JSON d\'une ligne de relevé --');
  const lines = (await api('GET', `/api/ReleveBancaire/${RY}/lignes`)).data;
  const y1 = lines.find(l => l.id === L.Y1);
  console.log('  ligne Y1 (extrait) :', JSON.stringify({ id: y1.id, mV_ID: y1.mV_ID, releveBancaireEnteteId: y1.releveBancaireEnteteId, lettrage: y1.lettrage, reservePar_UserId: y1.reservePar_UserId }));
  ok(y1.mV_ID === R.R3 && y1.releveBancaireEnteteId === RY, 'noms JSON mV_ID / releveBancaireEnteteId prouvés');
  // état laissé : X1↔R1 (RX) et Y1↔R3 (RY) réservés — repris par l'E2E UI
  console.log(fail ? `\nRÉSULTAT : ${fail} KO` : '\nRÉSULTAT : PASS'); process.exit(fail ? 1 : 0);
})();
