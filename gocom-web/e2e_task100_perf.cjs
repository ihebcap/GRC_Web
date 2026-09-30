// TASK-100 S20 — volume/performance : POST /lignes (tous les relevés d'une banque) vs N × GET /{id}/lignes. Env : GRC_E2E_BASE_URL, GRC_E2E_USER1, GRC_E2E_PASS1.
const B = process.env.GRC_E2E_BASE_URL;
(async () => {
  const tok = (await (await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ Username: process.env.GRC_E2E_USER1, Password: process.env.GRC_E2E_PASS1, SocieteId: 1 }) })).json()).token;
  const h = { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' };
  for (const banque of [1, 2, 3, 4, 5]) {
    const rel = await (await fetch(`${B}/api/ReleveBancaire?banqueId=${banque}&nonRapprochesSeulement=true`, { headers: h })).json();
    if (!Array.isArray(rel) || !rel.length) { console.log(`banque ${banque}: aucun relevé listé`); continue; }
    const ids = rel.map(r => r.id);
    let t = Date.now(); const r1 = await fetch(B + '/api/ReleveBancaire/lignes', { method: 'POST', headers: h, body: JSON.stringify({ releveBancaireEnteteIds: ids }) }); const txt = await r1.text(); const dNew = Date.now() - t;
    const n = JSON.parse(txt).length;
    t = Date.now(); let oldBytes = 0, oldN = 0; for (const id of ids) { const r = await fetch(`${B}/api/ReleveBancaire/${id}/lignes`, { headers: h }); const x = await r.text(); oldBytes += x.length; oldN += JSON.parse(x).length; } const dOld = Date.now() - t;
    console.log(`banque ${banque}: ${ids.length} relevés | POST /lignes : ${r1.status}, ${n} lignes, ${(txt.length / 1024).toFixed(0)} Ko, ${dNew} ms | ${ids.length} × GET : ${oldN} lignes, ${(oldBytes / 1024).toFixed(0)} Ko, ${dOld} ms | charge ÷ ${(oldBytes / txt.length).toFixed(1)}`);
  }
})();
