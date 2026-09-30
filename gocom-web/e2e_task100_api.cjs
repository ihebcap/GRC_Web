// TASK-100 — scénarios API réels S1–S7 (+ rejeu 098) sur la base de TEST.
// Variables d'environnement (jamais de secret en dur) : GRC_E2E_BASE_URL, GRC_E2E_USER1, GRC_E2E_PASS1,
// SQLCMDPASSWORD (+ GRC_E2E_SQLSERVER, GRC_E2E_DB optionnels). Le script crée ses relevés (INSERT RAPP_* uniquement).
const { execFileSync } = require('child_process');
const BASE = process.env.GRC_E2E_BASE_URL, U = process.env.GRC_E2E_USER1, P = process.env.GRC_E2E_PASS1;
const SRV = process.env.GRC_E2E_SQLSERVER || 'DESKTOP-2VCUE93', DB = process.env.GRC_E2E_DB || 'GR_GOCOM';
if (!BASE || !U || !P || !process.env.SQLCMDPASSWORD) { console.error('Variables GRC_E2E_* / SQLCMDPASSWORD manquantes'); process.exit(2); }
// Règlements RÉELS existants (virements non pointés, non annulés, banque 1, montant unique) — G1..G7
const G = { G1: 23080, G2: 23081, G3: 23084, G4: 23088, G5: 23089, G6: 23100, G7: 23108 };
let tok, fail = 0;
const ok = (c, m) => { console.log(c ? '  OK :' : '  KO :', m); if (!c) fail++; };
const sql = q => execFileSync('sqlcmd', ['-I', '-S', SRV, '-U', 'sa', '-C', '-d', DB, '-W', '-s', '|', '-h', '-1', '-Q', 'SET NOCOUNT ON; ' + q], { encoding: 'latin1' }).trim();
const scalar = q => sql(q).split('\n')[0].trim();
const api = async (method, url, body, token = tok) => {
  const r = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, data: j };
};
const stamp = new Date().toTimeString().slice(0, 8);
const entete = (titre, banque) => Number(scalar(`INSERT dbo.RAPP_ReleveBancaire_Entete (BanqueId, Titre, DateImport, ImportePar_UserId) VALUES (${banque}, N'${titre}', GETDATE(), N'test'); SELECT SCOPE_IDENTITY();`));
const ligne = (e, lib, credit, debit = 0, valide = false) => Number(scalar(`INSERT dbo.RAPP_ReleveBancaire_Ligne (ReleveBancaireEnteteId, DateOperation, DateValeur, Libelle, Reference, Code, Debit, Credit, MontantReel, DateValidation) VALUES (${e}, GETDATE(), GETDATE(), N'T100 ${lib}', N'${lib}', N'${lib}', ${debit}, ${credit}, ${credit || debit}, ${valide ? 'GETDATE()' : 'NULL'}); SELECT SCOPE_IDENTITY();`));
const libere = async ids => api('POST', '/api/ReleveBancaire/release-batch', ids.map(i => ({ ligneReleveId: i })));
const logTail = (pat) => { try { return execFileSync('powershell', ['-NoProfile', '-Command', `Get-ChildItem '${__dirname}\\..\\GRC.API\\logs\\grc-*.log' | Sort-Object LastWriteTime | Select-Object -Last 1 | ForEach-Object { Select-String -Path $_.FullName -Pattern '${pat}' | Select-Object -Last 3 | ForEach-Object { $_.Line } }`], { encoding: 'utf8' }).trim(); } catch (e) { return String(e.message); } };

(async () => {
  tok = (await api('POST', '/api/auth/login', { Username: U, Password: P, SocieteId: 1 }, null)).data.token; ok(!!tok, 'login');
  console.log('RCSI =', scalar('SELECT is_read_committed_snapshot_on FROM sys.databases WHERE name = DB_NAME()'), '| base', scalar('SELECT DB_NAME() + N\'@\' + @@SERVERNAME'));
  // --- jeu d'essai ---
  const RA = entete('T100-RA ' + stamp, 1), RB = entete('T100-RB ' + stamp, 1), RC = entete('T100-RC ' + stamp, 1), RE = entete('T100-RE ' + stamp, 1), RD = entete('T100-RD ' + stamp, 2);
  const A1 = ligne(RA, 'A1', 2803.82), A2 = ligne(RA, 'A2', 2337.00), A3 = ligne(RA, 'A3', 3003.11), A4 = ligne(RA, 'A4', 379.00), Ad = ligne(RA, 'Ad', 0, 500.00);
  const B1 = ligne(RB, 'B1', 750.93), B2 = ligne(RB, 'B2', 670.00), B3 = ligne(RB, 'B3', 379.00);
  const C1 = ligne(RC, 'C1', 6001.17, 0, true), Cd = ligne(RC, 'Cd', 0, 700.00);
  const E1 = ligne(RE, 'E1', 48.00), E2 = ligne(RE, 'E2', 1646.00);
  const D1 = ligne(RD, 'D1', 2803.82);
  console.log('IDS', JSON.stringify({ RA, RB, RC, RE, RD, A1, A2, A3, A4, Ad, B1, B2, B3, C1, Cd, E1, E2, D1, G }));
  const ALL = [A1, A2, A3, A4, B1, B2, B3];

  console.log('\n-- S1 lignes groupées --');
  let r = await api('POST', '/api/ReleveBancaire/lignes', { releveBancaireEnteteIds: [RA, RB, RC] });
  ok(r.status === 200 && r.data.length === 7, `200 et 7 lignes (reçu ${r.status}/${r.data.length})`);
  ok(![Ad, C1, Cd].some(i => r.data.some(l => l.id === i)), 'ni Ad (débit), ni C1 (approuvée), ni Cd (débit)');
  ok(r.data.every(l => l.releveBancaireEnteteId === RA || l.releveBancaireEnteteId === RB), 'releveBancaireEnteteId ∈ {RA, RB}');
  const ordre = r.data.map(l => l.id); ok(JSON.stringify(ordre) === JSON.stringify([...ordre].sort((a, b) => a - b)), 'ordre DateOperation puis Id (mêmes dates → Id croissant)');
  ok(Number(scalar(`SELECT COUNT(*) FROM RAPP_ReleveBancaire_Ligne WHERE ReleveBancaireEnteteId IN (${RA},${RB},${RC}) AND DateValidation IS NULL AND Credit > 0`)) === 7, 'COUNT(*) SQL = 7');
  ok('mV_ID' in r.data[0] && 'reservePar_UserName' in r.data[0], 'même forme JSON (mV_ID, reservePar_UserName)');
  const old = await api('GET', `/api/ReleveBancaire/${RA}/lignes`); ok(old.status === 200 && old.data.length === 5 && old.data.some(l => l.id === Ad), 'ancien GET /{RA}/lignes inchangé : 5 lignes dont Ad');

  console.log('\n-- S2 erreurs --');
  for (const [nom, path] of [['lignes', '/api/ReleveBancaire/lignes'], ['auto-reconcile', '/api/ReleveBancaire/auto-reconcile']]) {
    const body = ids => path.endsWith('lignes') ? { releveBancaireEnteteIds: ids } : { releveBancaireEnteteIds: ids, banqueId: 1 };
    let x = await api('POST', path, body([])); ok(x.status === 400 && x.data.message === 'Aucun relevé sélectionné.', `${nom} [] → 400 message exact`);
    x = await api('POST', path, path.endsWith('lignes') ? { releveBancaireEnteteIds: null } : { banqueId: 1 }); ok(x.status === 400 && x.data.message === 'Aucun relevé sélectionné.', `${nom} null → 400`);
    x = await api('POST', path, body([0])); ok(x.status === 400 && x.data.message === 'Identifiant de relevé invalide.', `${nom} [0] → 400`);
    x = await api('POST', path, body(Array.from({ length: 1001 }, (_, i) => i + 1))); ok(x.status === 400 && x.data.message === 'Trop de relevés demandés (maximum 1000).', `${nom} 1001 ids → 400`);
    x = await api('POST', path, body([RA, 99999999])); ok(x.status === 403 && (x.data === '' || !Array.isArray(x.data)), `${nom} [RA, inexistant] → 403 sans donnée`);
    x = await api('POST', path, body([RA]), null); ok(x.status === 401, `${nom} sans jeton → 401`);
  }
  let x = await api('POST', '/api/ReleveBancaire/auto-reconcile', { releveBancaireEnteteIds: [RA, RD], banqueId: 1 });
  ok(x.status === 400 && x.data.message === "Les relevés sélectionnés n'appartiennent pas tous à la même banque.", 'auto [RA, RD] banques différentes → 400');
  x = await api('POST', '/api/ReleveBancaire/auto-reconcile', { releveBancaireEnteteIds: [RA], banqueId: 2 });
  ok(x.status === 400 && x.data.message === "Les relevés sélectionnés n'appartiennent pas à la banque demandée.", 'auto [RA] banqueId=2 → 400');
  console.log('  (401 sans claim SocieteId : non simulable avec un jeton valide ; 401 sans jeton prouvé ci-dessus)');

  console.log('\n-- S3 auto sur l\'union --');
  const auto = async body => (await api('POST', '/api/ReleveBancaire/auto-reconcile', { banqueId: 1, ...body })).data;
  const pairs = p => p.map(o => `${o.ligneReleveId}>${o.reglementGrcId}`).sort().join(',');
  const exp = (...a) => a.map(([l, g]) => `${l}>${g}`).sort().join(',');
  const pAB = await auto({ releveBancaireEnteteIds: [RA, RB] });
  ok(pairs(pAB) === exp([A1, G.G1], [A2, G.G2], [B1, G.G3], [B2, G.G4]), `[RA,RB] = A1↔G1, A2↔G2, B1↔G3, B2↔G4 exactement (reçu ${pAB.length})`);
  ok(!pAB.some(o => o.reglementGrcId === G.G5), 'G5 jamais proposé sur l\'union');
  const pA = await auto({ releveBancaireEnteteIds: [RA] }), pB = await auto({ releveBancaireEnteteIds: [RB] });
  ok(pairs(pA) === exp([A1, G.G1], [A2, G.G2], [A4, G.G5]), '[RA] = 3 propositions dont A4↔G5');
  ok(pairs(pB) === exp([B1, G.G3], [B2, G.G4], [B3, G.G5]), '[RB] = 3 propositions dont B3↔G5');
  const pOld = await auto({ releveBancaireEnteteId: RA });
  ok(JSON.stringify(pOld) === JSON.stringify(pA), 'ancien corps {releveBancaireEnteteId:RA} = [RA] (même JSON)');
  const pBoth = await auto({ releveBancaireEnteteId: RA, releveBancaireEnteteIds: [RA, RB] });
  ok(JSON.stringify(pBoth) === JSON.stringify(pAB), 'les deux champs → union sans doublon (= [RA,RB])');
  console.log('  JSON [RA] :', JSON.stringify(pA));

  console.log('\n-- S5 réservation par lot multi-relevés / S6 ordre des verrous --');
  let b = await api('POST', '/api/ReleveBancaire/reserve-batch', [{ ligneReleveId: B1, mvId: G.G3 }, { ligneReleveId: A1, mvId: G.G1 }]);
  ok(b.status === 200 && b.data.every(i => i.success && i.lettrage === 'A'), `lot [B1→G3, A1→G1] : les deux success, lettre « A » chacun (${JSON.stringify(b.data.map(i => i.lettrage))})`);
  ok(scalar(`SELECT STRING_AGG(Lettrage,',') FROM RAPP_ReleveBancaire_Ligne WHERE Id IN (${A1},${B1})`) === 'A,A', 'SELECT : A1 et B1 Lettrage = A, entêtes différents');
  b = await api('POST', '/api/ReleveBancaire/reserve-batch', [{ ligneReleveId: A2, mvId: G.G2 }, { ligneReleveId: B2, mvId: G.G4 }]);
  ok(b.data.every(i => i.success && i.lettrage === 'B'), `second lot → « B » et « B » consécutives sans trou (${JSON.stringify(b.data.map(i => i.lettrage))})`);
  console.log('  journal :', logTail('RÉSERVATION LOT : verrous'));
  const rel = await libere([A1, A2, B1, B2]); ok(rel.data.every(i => i.success), 'release-batch des 4 lignes');
  console.log('  journal :', logTail('LIBÉRATION LOT : verrous'));
  ok(Number(scalar(`SELECT COUNT(*) FROM RAPP_ReleveBancaire_Ligne WHERE Id IN (${ALL}) AND (MV_ID IS NOT NULL OR Lettrage IS NOT NULL)`)) === 0, 'SELECT : tout libre');

  console.log('\n-- rejeu 098 S3/S5 : règlement annulé dans un lot multi-relevés --');
  const annule = Number(scalar('SELECT TOP 1 MV_Id FROM RT_MOUVEMENT WHERE MV_Annule=1 AND MV_Domaine=0 AND MV_Type=3 AND MV_Id NOT IN (SELECT MV_ID FROM RAPP_ReleveBancaire_Ligne WHERE MV_ID IS NOT NULL) ORDER BY MV_Id DESC'));
  b = await api('POST', '/api/ReleveBancaire/reserve-batch', [{ ligneReleveId: A3, mvId: annule }, { ligneReleveId: B1, mvId: G.G3 }]);
  ok(b.data[0].success === false && b.data[1].success === true && b.data[1].lettrage === 'A', `annulé ${annule} refusé, B1 reçoit « A » : lettre non consommée (${JSON.stringify(b.data)})`);
  const u = await api('POST', '/api/ReleveBancaire/reserve', { ligneReleveId: A3, mvId: annule }); ok(u.status === 409, `unitaire sur annulé → 409 (${u.status})`);
  await libere([B1, A3]);

  console.log('\n-- S7 conflit d\'unicité inter-relevés (RCSI) --');
  const U2 = 2;
  ok(scalar('SELECT is_read_committed_snapshot_on FROM sys.databases WHERE name = DB_NAME()') === '1', 'RCSI = 1');
  const concurrent = async (appel) => {
    const bg = require('child_process').spawn('sqlcmd', ['-I', '-S', SRV, '-U', 'sa', '-C', '-d', DB, '-Q', `BEGIN TRAN; UPDATE dbo.RAPP_ReleveBancaire_Ligne SET MV_ID=${G.G5}, Lettrage='Z', ReservePar_UserId=${U2}, DateReservation=GETDATE() WHERE Id=${A3}; WAITFOR DELAY '00:00:08'; COMMIT;`], { stdio: 'ignore' });
    const fin = new Promise(r => bg.on('close', r));
    await new Promise(r => setTimeout(r, 2500));
    const t0 = Date.now(); const res = await appel(); res.ms = Date.now() - t0;
    await fin;
    return res;
  };
  const reset = () => sql(`UPDATE RAPP_ReleveBancaire_Ligne SET MV_ID=NULL, Lettrage=NULL, ReservePar_UserId=NULL, DateReservation=NULL WHERE Id IN (${A3},${B1},${B3})`);
  b = await concurrent(() => api('POST', '/api/ReleveBancaire/reserve-batch', [{ ligneReleveId: B3, mvId: G.G5 }, { ligneReleveId: B1, mvId: G.G3 }]));
  console.log('  durée', b.ms, 'ms ; réponse', b.status, JSON.stringify(b.data));
  ok(b.ms > 4000, 'la requête a bien attendu la transaction concurrente');
  ok(b.status === 200 && b.data.find(i => i.ligneReleveId === B3).success === false && b.data.find(i => i.ligneReleveId === B1).success === true, 'HTTP 200 : B3 success=false, B1 success=true');
  console.log('  lettre B1 :', b.data.find(i => i.ligneReleveId === B1).lettrage);
  console.log('  SELECT :', sql(`SELECT Id, MV_ID, Lettrage, ReservePar_UserId FROM RAPP_ReleveBancaire_Ligne WHERE Id IN (${A3},${B1},${B3})`).split(String.fromCharCode(10)).join(' ; '));
  console.log('  journal :', logTail('conflit d.unicit'));
  reset();
  const un = await concurrent(() => api('POST', '/api/ReleveBancaire/reserve', { ligneReleveId: B3, mvId: G.G5 }));
  ok(un.status === 409 && un.ms > 4000, `unitaire B3→G5 pendant la transaction A → 409 (${un.status} ${JSON.stringify(un.data)}, ${un.ms} ms)`);
  console.log('  journal :', logTail('conflit d.unicit'));
  reset();

  console.log(fail ? `\nRÉSULTAT : ${fail} KO` : '\nRÉSULTAT : PASS'); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
