// CONTABILITÀ (26/11/2026) – pannello di Raffaella: semistore.it/gestione/conti/
// Accesso: amministratore o ruolo "contabilita". Tutti i numeri di Semi in un'unica tabella D1 `cont_doc`:
//  - Danea (storico_art): un documento per tipo/anno/numero, importo = somma delle righe IVA esclusa
//    (le righe copiate da rapporto → DDT → fattura sono contate una volta sola: le statistiche non raddoppiano)
//  - app: ordini e vendite (ordiniWeb), schede consegnate (tickets), fatture fornitore caricate (fattureForn)
//  - fatture elettroniche XML (emesse e ricevute) ed elenchi documenti esportati da Danea: importi esatti con IVA (fimp/fiva/ftot)
//  - documenti scritti a mano (spese, incassi, rettifiche)
// Le modifiche fatte dal pannello restano (mod=1) anche quando si ricalcola, e finiscono nel registro (c='conti').
//
//  GET  stato                    → ultimo ricalcolo, periodo coperto, conteggi
//  POST ricalcola {parte}        → 'danea' | 'app' | 'tutto'
//  GET  riepilogo?da&a           → numeri del periodo + stesso periodo dell'anno prima, mesi, clienti, articoli, anni
//  GET  docs?da&a&tipo&q&stato&cli&ordina&off&n   → elenco documenti + totali
//  GET  doc?id                   → documento, righe, modifiche
//  POST salva {id,campi}         → modifica (registro)
//  POST nuovo {campi}            → documento a mano
//  POST elimina {id}             → solo documenti a mano; gli altri si escludono (nasc=1)
//  GET  clienti?da&a&q           → classifica clienti del periodo (con periodo precedente)
//  GET  cliente?cli&nome         → anni, documenti, anagrafica
//  GET  articoli?da&a&q          → articoli più venduti
//  POST importa {docs:[…]}       → documenti con importi esatti (XML o export Danea)
//  GET  modifiche                → registro delle modifiche ai conti
import { gdb, json, utente, casuale, differenza } from '../../../_lib/gestione.js';

const TIPI_DANEA = { // lettera Danea → [tipo, verso, conta nelle statistiche]
  B: ['banco', 'vendita', 1], D: ['ddt', 'vendita', 1], F: ['fattura', 'vendita', 1], G: ['riparazione', 'vendita', 1],
  I: ['fattura', 'vendita', 1], N: ['nota', 'vendita', 1], H: ['arrivo', 'acquisto', 0], Q: ['preventivo', 'nessuno', 0],
  C: ['ordinecli', 'nessuno', 0], E: ['ordineforn', 'nessuno', 0], A: ['fattura', 'vendita', 1],
};
const EDIT = ['data', 'num', 'nome', 'cli', 'piva', 'imp', 'fimp', 'fiva', 'ftot', 'pagamento', 'scadenza', 'pagato', 'pagatoIl', 'metodo', 'note', 'canale', 'tipo', 'verso', 'nasc', 'categoria'];
const COLS = 'id,fonte,dt,tipo,verso,num,data,anno,cli,nome,piva,imp,fimp,fiva,ftot,righe,pagamento,scadenza,pagato,pagatoIl,metodo,note,canale,rif,categoria,stat,nasc,mod,chi,u';
const MIA_PIVA = '07149740636';
const r2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
const oggi = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const giorno = (t) => (t ? new Date(Number(t)).toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }) : '');
const baseDi = (c) => String(c || '').trim().toUpperCase().replace(/-(QW|XJ|QS|QZ|XE|GB|LX|KR|QT|B5|B3|BL|DE|FR|IT|EU|SFDPS)$/, '');
// id di un documento Danea dalle colonne di storico_art (stessa espressione in SQL e in JS)
const ID_SQL = "'D:'||tipo||':'||substr(data,1,4)||':'||COALESCE(NULLIF(num,''),data||'-'||COALESCE(cli,''))";

let pronto = false;
async function cdb(env) {
  const d = await gdb(env);
  if (!pronto) {
    // piano gratuito D1: 100.000 righe scritte al giorno (ogni indice conta come una scrittura in più) → un solo indice
    const c = await d.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='cont_doc'").first();
    if (c.n) { pronto = true; return d; }
    try { await d.batch([
      d.prepare(`CREATE TABLE IF NOT EXISTS cont_doc (id TEXT PRIMARY KEY, fonte TEXT, dt TEXT, tipo TEXT, verso TEXT, num TEXT, data TEXT, anno TEXT,
        cli TEXT, nome TEXT, piva TEXT, imp REAL, fimp REAL, fiva REAL, ftot REAL, righe INTEGER, pagamento TEXT, scadenza TEXT, pagato INTEGER,
        pagatoIl TEXT, metodo TEXT, note TEXT, canale TEXT, rif TEXT, categoria TEXT, stat INTEGER NOT NULL DEFAULT 0, nasc INTEGER NOT NULL DEFAULT 0,
        mod INTEGER NOT NULL DEFAULT 0, chi TEXT, u INTEGER)`),
      d.prepare('CREATE INDEX IF NOT EXISTS cd_data ON cont_doc(data)'),
      d.prepare('CREATE TABLE IF NOT EXISTS storico_art (cod TEXT NOT NULL, base TEXT NOT NULL, tipo TEXT, data TEXT, num TEXT, cli TEXT, nome TEXT, qta REAL, prezzo REAL, sconti TEXT, tot REAL, descr TEXT)'),
      d.prepare('CREATE INDEX IF NOT EXISTS sa_base ON storico_art(base)'),
      d.prepare('CREATE INDEX IF NOT EXISTS sa_cli ON storico_art(cli)'),
      d.prepare('CREATE TABLE IF NOT EXISTS storico_art_info (k TEXT PRIMARY KEY, v TEXT)'),
    ]); } catch (e) { if (!/write limit|read.?only/i.test(String(e && e.message))) throw e; return d; /* scritture finite per oggi: si riprova alla prossima chiamata */ }
    pronto = true;
  }
  return d;
}
async function info(d, k) { const r = await d.prepare('SELECT v FROM storico_art_info WHERE k=?').bind(k).first(); try { return r ? JSON.parse(r.v) : null; } catch { return null; } }
async function setInfo(d, k, v) { await d.prepare('INSERT OR REPLACE INTO storico_art_info (k,v) VALUES (?,?)').bind(k, JSON.stringify(v)).run(); }

// ---------- anagrafica clienti (documenti "clienti" dell'app, blocchi c00…c15), in memoria per qualche minuto ----------
let CLI = null, CLI_AT = 0;
async function clientiMap(d) {
  if (CLI && Date.now() - CLI_AT < 180_000) return CLI;
  const m = new Map();
  const r = (await d.prepare("SELECT d FROM docs WHERE c='clienti'").all()).results;
  for (const x of r) { let o; try { o = JSON.parse(x.d); } catch { continue; } for (const [k, c] of Object.entries(o?.items || {})) if (c && c.nome) m.set(k, c); }
  CLI = m; CLI_AT = Date.now(); return m;
}
const cliDi = (M, cli) => (cli ? M.get(cli) || M.get('D' + cli) || null : null);
function arricchisci(M, row) {
  const c = cliDi(M, row.cli);
  if (c) { if (!row.piva) row.piva = c.piva || ''; row.cf = c.cf || ''; row.citta = c.citta || ''; row.prov = c.prov || ''; row.sdi = c.sdi || ''; row.pec = c.pec || ''; if (!row.pagamento) row.pagamentoCli = c.pagamento || ''; }
  return row;
}

// ---------- ricalcolo ----------
async function ricalcolaDanea(d) {
  const now = Date.now();
  const cs = Object.entries(TIPI_DANEA);
  const caseT = 'CASE tipo ' + cs.map(([k, v]) => `WHEN '${k}' THEN '${v[0]}'`).join(' ') + " ELSE 'altro' END";
  const caseV = 'CASE tipo ' + cs.map(([k, v]) => `WHEN '${k}' THEN '${v[1]}'`).join(' ') + " ELSE 'nessuno' END";
  const caseS = 'CASE tipo ' + cs.map(([k, v]) => `WHEN '${k}' THEN ${v[2]}`).join(' ') + ' ELSE 0 END';
  // una riga per documento; le note di credito vanno in negativo
  await d.prepare(`INSERT INTO cont_doc (id,fonte,dt,tipo,verso,num,data,anno,cli,nome,imp,righe,stat,nasc,mod,u)
    SELECT ${ID_SQL} AS id, 'danea', tipo, ${caseT}, ${caseV}, COALESCE(num,''), MIN(data), substr(MIN(data),1,4), MAX(cli), MAX(nome),
      ROUND(SUM(CASE WHEN tipo='N' THEN -ABS(tot) ELSE tot END),2), COUNT(*), ${caseS}, 0, 0, ${now}
    FROM storico_art WHERE data IS NOT NULL AND data<>'' GROUP BY 1
    ON CONFLICT(id) DO UPDATE SET imp=excluded.imp, righe=excluded.righe, stat=excluded.stat,
      cli=CASE WHEN cont_doc.mod=1 THEN cont_doc.cli ELSE excluded.cli END, nome=CASE WHEN cont_doc.mod=1 THEN cont_doc.nome ELSE excluded.nome END,
      data=CASE WHEN cont_doc.mod=1 THEN cont_doc.data ELSE excluded.data END, anno=CASE WHEN cont_doc.mod=1 THEN cont_doc.anno ELSE excluded.anno END,
      tipo=CASE WHEN cont_doc.mod=1 THEN cont_doc.tipo ELSE excluded.tipo END, u=excluded.u
    WHERE cont_doc.imp IS NOT excluded.imp OR cont_doc.righe IS NOT excluded.righe OR cont_doc.stat IS NOT excluded.stat
      OR (cont_doc.mod=0 AND (cont_doc.cli IS NOT excluded.cli OR cont_doc.nome IS NOT excluded.nome OR cont_doc.data IS NOT excluded.data))`).run();
  // documenti Danea non più nello storico (ricaricato): tolti, tranne quelli toccati a mano o con importi esatti
  await d.prepare(`DELETE FROM cont_doc WHERE fonte='danea' AND mod=0 AND fimp IS NULL AND id NOT IN (SELECT ${ID_SQL} FROM storico_art WHERE data IS NOT NULL AND data<>'')`).run();
  const fine = await d.prepare("SELECT MIN(data) da, MAX(data) a, COUNT(*) n FROM storico_art WHERE data<>''").first();
  const n = (await d.prepare("SELECT COUNT(*) n FROM cont_doc WHERE fonte='danea'").first()).n;
  await setInfo(d, 'conti_danea', { at: now, da: fine?.da || '', a: fine?.a || '', righe: fine?.n || 0, documenti: n });
  await totaliFatture(d);
  return { documenti: n, da: fine?.da, a: fine?.a };
}

// ---------- totali veri di fatture e note (27/11) ----------
// Le fatture differite hanno quasi tutte le righe copiate dai DDT/rapporti: in storico_art (righe contate una volta) restano
// con poche o nessuna riga propria, quindi "Fatture" nel pannello mostrava 105.247 € invece di 485.389 € (2026).
// Dalle testate Danea (storico_doc: TotNetto, TotIva, TotDoc) si mettono gli importi del documento in fimp/fiva/ftot
// e si aggiungono le fatture senza righe proprie (imp=0: le statistiche delle vendite non raddoppiano).
const TF_VER = 1;
const SD_SRC = `SELECT anno, CASE WHEN n GLOB '[0-9]*' AND length(n)<=4 THEN substr(anno,3,2)||substr('0000'||n,-4) ELSE n END num,
  CASE k WHEN 'N' THEN 'N' ELSE 'I' END kk, d, cli, nm, json_extract(j,'$.imp') imp, json_extract(j,'$.iva') iva, json_extract(j,'$.tot') tot,
  json_extract(j,'$.pi') pi, json_extract(j,'$.pg') pg FROM storico_doc WHERE k IN ('I','N') AND d<>''`;
const STESSO = "c.fonte='danea' AND c.anno=s.anno AND c.num=s.num AND ((s.kk='N' AND c.dt='N') OR (s.kk='I' AND c.dt IN ('I','F','A')))";
async function totaliFatture(d) {
  const t = await d.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='storico_doc'").first();
  if (!t.n) return null;
  const now = Date.now();
  const agg = await d.prepare(`UPDATE cont_doc AS c SET fimp=s.imp, fiva=s.iva, ftot=s.tot,
      piva=COALESCE(NULLIF(c.piva,''),s.pi), pagamento=COALESCE(NULLIF(c.pagamento,''),NULLIF(s.pg,'')), u=?
    FROM (${SD_SRC}) AS s
    WHERE ${STESSO} AND c.mod=0 AND (c.fimp IS NOT s.imp OR c.fiva IS NOT s.iva OR c.ftot IS NOT s.tot)`).bind(now).run();
  const ins = await d.prepare(`INSERT INTO cont_doc (id,fonte,dt,tipo,verso,num,data,anno,cli,nome,piva,imp,fimp,fiva,ftot,righe,pagamento,stat,nasc,mod,u)
    SELECT 'D:'||s.kk||':'||s.anno||':'||s.num, 'danea', s.kk, CASE s.kk WHEN 'N' THEN 'nota' ELSE 'fattura' END, 'vendita', s.num, s.d, s.anno,
      COALESCE(s.cli,''), COALESCE(s.nm,''), COALESCE(s.pi,''), 0, s.imp, s.iva, s.tot, 0, COALESCE(s.pg,''), 1, 0, 0, ?
    FROM (${SD_SRC}) AS s WHERE NOT EXISTS (SELECT 1 FROM cont_doc c WHERE ${STESSO})
    ON CONFLICT(id) DO NOTHING`).bind(now).run();
  const n = (await d.prepare('SELECT COUNT(*) n FROM storico_doc').first()).n;
  const r = { at: now, v: TF_VER, n, aggiornati: agg.meta?.changes || 0, aggiunti: ins.meta?.changes || 0 };
  await setInfo(d, 'conti_fatture', r);
  return r;
}

const totOrd = (o) => { const sub = (o.righe || []).reduce((a, r) => a + (Number(r.qty) || 0) * (Number(r.prezzo) || 0), 0); return Math.max(0, r2(sub - (Number(o.sconto) || 0) + (Number(o.spedizione) || 0))); };
function totScheda(t, tariffa) {
  const ricL = (t.ricambi || []).reduce((a, p) => a + (Number(p.qty) || 0) * (Number(p.prezzo) || 0), 0);
  const sc = Math.min(100, Math.max(0, Number(t.scontoRic) || 0)), ric = ricL - ricL * sc / 100;
  const mo = t.manodopera != null && t.manodopera !== '' ? Number(t.manodopera) || 0 : (Number(t.ore) || 0) * (Number(t.tariffa ?? tariffa) || 0);
  if (t.tipo === 'garanzia') return 0;
  const man = Number(t.preventivo);
  return man > 0 ? r2(man * 1.22) : r2(ric + mo); // prezzo finale a mano (t.preventivo) è IVA esclusa
}
async function ricalcolaApp(d) {
  const now = Date.now();
  const fineD = (await info(d, 'conti_danea'))?.a || '';
  const righe = (await d.prepare("SELECT c, id, d FROM docs WHERE c IN ('ordiniWeb','tickets','fattureForn','config') AND d IS NOT NULL").all()).results;
  let tariffa = 0; const out = [];
  for (const x of righe) if (x.c === 'config') { try { const o = JSON.parse(x.d); if (o?.tariffa) tariffa = o.tariffa; } catch {} }
  for (const x of righe) {
    let o; try { o = JSON.parse(x.d); } catch { continue; } if (!o) continue;
    if (x.c === 'ordiniWeb') {
      const data = giorno(o.at || o.createdAt); if (!data) continue;
      const tot = totOrd(o), imp = r2(tot / 1.22), ann = o.stato === 'Annullato', venduto = ['Confermato', 'Pronto', 'Spedito', 'Consegnato'].includes(o.stato);
      out.push({ id: 'W:' + x.id, fonte: 'app', dt: 'W', tipo: 'ordine', verso: 'vendita', num: o.num || '', data, cli: o.cliId || '', nome: o.cliente || '',
        imp, fimp: imp, fiva: r2(tot - imp), ftot: tot, righe: (o.righe || []).length, pagamento: o.termini || '', scadenza: o.scadenza ? giorno(o.scadenza) : '',
        pagato: o.pagato ? 1 : 0, pagatoIl: o.pagatoAt ? giorno(o.pagatoAt) : '', metodo: o.metodo || o.pagamento || '', canale: o.canale || '',
        note: [o.stato, o.fattura?.numero ? 'fattura n. ' + o.fattura.numero : ''].filter(Boolean).join(' · '), rif: x.id,
        stat: venduto && data > fineD ? 1 : 0, nasc: ann ? 1 : 0 });
    } else if (x.c === 'tickets') {
      if (o.stato !== 'Consegnato') continue;
      const data = giorno(o.consegnatoAt || o.updatedAt || o.createdAt); if (!data) continue;
      const tot = totScheda(o, tariffa), imp = r2(tot / 1.22);
      out.push({ id: 'T:' + x.id, fonte: 'app', dt: 'S', tipo: 'riparazione', verso: 'vendita', num: o.num || '', data, cli: o.cliId || '', nome: o.cliente || '',
        imp, fimp: imp, fiva: r2(tot - imp), ftot: tot, righe: (o.ricambi || []).length, pagamento: o.pagamento || o.metodoPag || '', scadenza: '',
        pagato: o.pagato === false ? 0 : 1, pagatoIl: o.pagato === false ? '' : data, metodo: o.metodoPag || '', canale: 'Laboratorio',
        note: [o.modello, o.tipo === 'garanzia' ? 'garanzia' : ''].filter(Boolean).join(' · '), rif: x.id, stat: data > fineD ? 1 : 0, nasc: 0 });
    } else if (x.c === 'fattureForn') {
      for (const [k, f] of Object.entries(o.f || {})) {
        if (!f || !f.data) continue;
        const nc = /^TD0[48]$/.test(f.tipo || ''), s = nc ? -1 : 1, tot = s * Math.abs(Number(f.totale) || 0), imp = f.imponibile != null ? s * Math.abs(f.imponibile) : r2(tot / 1.22);
        out.push({ id: 'F:' + k, fonte: 'app', dt: f.tipo || 'TD01', tipo: 'acquisto', verso: 'acquisto', num: f.numero || '', data: f.data, cli: f.piva || '', nome: f.forn || '', piva: f.piva || '',
          imp, fimp: imp, fiva: r2(tot - imp), ftot: tot, righe: f.righe || 0, note: nc ? 'nota di credito del fornitore' : '', rif: k, stat: 1, nasc: 0 });
      }
    }
  }
  // scrittura a blocchi: i documenti modificati a mano tengono i campi toccati, ma importi e pagato dell'app si aggiornano
  const ins = `INSERT INTO cont_doc (${COLS}) VALUES (${COLS.split(',').map(() => '?').join(',')})
    ON CONFLICT(id) DO UPDATE SET imp=CASE WHEN cont_doc.fonte='xml' THEN cont_doc.imp ELSE excluded.imp END, righe=excluded.righe, stat=excluded.stat, u=excluded.u,
      fimp=CASE WHEN cont_doc.mod=1 OR cont_doc.fonte='xml' THEN cont_doc.fimp ELSE excluded.fimp END, fiva=CASE WHEN cont_doc.mod=1 OR cont_doc.fonte='xml' THEN cont_doc.fiva ELSE excluded.fiva END,
      ftot=CASE WHEN cont_doc.mod=1 OR cont_doc.fonte='xml' THEN cont_doc.ftot ELSE excluded.ftot END, nasc=CASE WHEN cont_doc.mod=1 THEN cont_doc.nasc ELSE excluded.nasc END,
      pagato=CASE WHEN cont_doc.mod=1 THEN cont_doc.pagato ELSE excluded.pagato END, pagatoIl=CASE WHEN cont_doc.mod=1 THEN cont_doc.pagatoIl ELSE excluded.pagatoIl END,
      scadenza=CASE WHEN cont_doc.mod=1 THEN cont_doc.scadenza ELSE excluded.scadenza END, nome=CASE WHEN cont_doc.mod=1 THEN cont_doc.nome ELSE excluded.nome END,
      num=CASE WHEN cont_doc.mod=1 THEN cont_doc.num ELSE excluded.num END, data=CASE WHEN cont_doc.mod=1 THEN cont_doc.data ELSE excluded.data END,
      anno=CASE WHEN cont_doc.mod=1 THEN cont_doc.anno ELSE excluded.anno END, note=CASE WHEN cont_doc.mod=1 THEN cont_doc.note ELSE excluded.note END,
      metodo=excluded.metodo, canale=excluded.canale, cli=CASE WHEN cont_doc.mod=1 THEN cont_doc.cli ELSE excluded.cli END
    WHERE cont_doc.imp IS NOT excluded.imp OR cont_doc.stat IS NOT excluded.stat OR cont_doc.righe IS NOT excluded.righe OR cont_doc.metodo IS NOT excluded.metodo OR cont_doc.canale IS NOT excluded.canale
      OR (cont_doc.mod=0 AND cont_doc.fonte<>'xml' AND (cont_doc.ftot IS NOT excluded.ftot OR cont_doc.nasc IS NOT excluded.nasc OR cont_doc.pagato IS NOT excluded.pagato OR cont_doc.pagatoIl IS NOT excluded.pagatoIl
        OR cont_doc.scadenza IS NOT excluded.scadenza OR cont_doc.nome IS NOT excluded.nome OR cont_doc.num IS NOT excluded.num OR cont_doc.data IS NOT excluded.data OR cont_doc.note IS NOT excluded.note OR cont_doc.cli IS NOT excluded.cli))`;
  for (let i = 0; i < out.length; i += 40) {
    await d.batch(out.slice(i, i + 40).map((r) => d.prepare(ins).bind(...riga(r, now))));
  }
  // documenti dell'app spariti (cancellati nell'app): tolti se non toccati a mano
  await d.prepare("DELETE FROM cont_doc WHERE fonte='app' AND mod=0 AND id NOT IN (SELECT value FROM json_each(?))").bind(JSON.stringify(out.map((r) => r.id))).run();
  await setInfo(d, 'conti_app', { at: now, documenti: out.length, daneaFino: fineD });
  return { documenti: out.length };
}
function riga(r, now, chi = null) {
  const v = { fonte: '', dt: '', tipo: 'altro', verso: 'vendita', num: '', data: '', cli: '', nome: '', piva: '', imp: null, fimp: null, fiva: null, ftot: null, righe: 0,
    pagamento: '', scadenza: '', pagato: null, pagatoIl: '', metodo: '', note: '', canale: '', rif: '', categoria: '', stat: 0, nasc: 0, mod: 0, ...r };
  v.anno = String(v.data || '').slice(0, 4); v.chi = chi; v.u = now;
  return COLS.split(',').map((k) => (v[k] === undefined ? null : v[k]));
}

// ---------- filtri comuni ----------
function filtro(q) {
  const w = ['1=1'], b = [];
  const da = q.get('da'), a = q.get('a');
  if (da) { w.push('data>=?'); b.push(da); }
  if (a) { w.push('data<=?'); b.push(a); }
  const tipo = q.get('tipo') || '';
  const GR = { vendite: "verso='vendita' AND (stat=1 OR fonte='xml')", fiscali: "tipo IN ('fattura','nota','banco') OR (tipo='ordine' AND nasc=0)", fatture: "tipo IN ('fattura','nota')", acquisti: "tipo IN ('acquisto','spesa')",
    riparazioni: "tipo='riparazione'", banco: "tipo='banco'", ddt: "tipo='ddt'", ordini: "tipo='ordine'", preventivi: "tipo='preventivo'", note: "tipo='nota'", arrivi: "tipo='arrivo'", spese: "fonte='manuale'" };
  if (GR[tipo]) w.push('(' + GR[tipo] + ')');
  if (q.get('nasc') !== '1') w.push('nasc=0');
  const st = q.get('stato') || '';
  if (st === 'aperti') w.push("pagato=0 AND verso='vendita'");
  if (st === 'scaduti') { w.push("pagato=0 AND verso='vendita' AND scadenza<>'' AND scadenza<?"); b.push(oggi()); }
  if (st === 'pagati') w.push('pagato=1');
  if (st === 'modificati') w.push('mod=1');
  if (q.get('fonte')) { w.push('fonte=?'); b.push(q.get('fonte')); }
  const cli = q.get('cli'); if (cli) { w.push('(cli=? OR cli=?)'); b.push(cli, cli.replace(/^D/, '')); }
  const nome = q.get('nome'); if (nome && !cli) { w.push('UPPER(nome)=?'); b.push(nome.toUpperCase()); }
  const t = String(q.get('q') || '').trim();
  if (t) {
    const n = Number(t.replace(/\./g, '').replace(',', '.').replace(/[€\s]/g, ''));
    const parti = [];
    parti.push('UPPER(nome) LIKE ?'); b.push('%' + t.toUpperCase() + '%');
    parti.push('num=?'); b.push(t);
    parti.push('UPPER(note) LIKE ?'); b.push('%' + t.toUpperCase() + '%');
    parti.push('piva=?'); b.push(t);
    if (/^[\d.,€\s]+$/.test(t) && n > 0) { parti.push('ABS(COALESCE(ftot,imp*1.22)-?)<0.6 OR ABS(COALESCE(fimp,imp)-?)<0.6'); b.push(n, n); }
    if (/^[A-Z0-9][A-Z0-9-]{3,}$/i.test(t) && /\d/.test(t)) { parti.push(`id IN (SELECT ${ID_SQL} FROM storico_art WHERE base=?)`); b.push(baseDi(t)); }
    w.push('(' + parti.join(' OR ') + ')');
  }
  return { w: w.join(' AND '), b };
}
const VAL = 'COALESCE(fimp,imp,0)';      // importo IVA esclusa del documento
const VAL_S = 'COALESCE(imp,fimp,0)';     // importo per le statistiche (righe proprie: niente doppioni)

export async function onRequest(ctx) {
  try { return await gestisci(ctx); }
  catch (e) {
    const m = String(e?.message || e);
    return json({ error: /write limit|daily row/i.test(m) ? 'Il database ha finito le scritture gratuite di oggi: le modifiche si possono fare dopo l\'01:00 (oppure subito con il piano Workers Paid di Cloudflare).'
      : /no such table/i.test(m) ? 'I conti non sono ancora stati preparati (si preparano da soli appena il database accetta scritture).' : 'Errore del server: ' + m.slice(0, 300) }, 500);
  }
}
async function gestisci(ctx) {
  const { request, env, params } = ctx;
  const p = (params.q || []).join('/');
  const m = request.method;
  if (!env.DB) return json({ error: 'database non collegato' }, 503);
  const io = await utente(request, env);
  if (!io) return json({ error: 'non collegato' }, 401);
  if (!['admin', 'contabilita'].includes(io.ruolo)) return json({ error: 'solo amministrazione e contabilità' }, 403);
  const d = await cdb(env);
  const q = new URL(request.url).searchParams;
  const body = m === 'POST' ? await request.json().catch(() => ({})) : null;

  if (p === 'stato') {
    const t = await d.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='cont_doc'").first();
    if (!t.n) {
      try { pronto = false; await cdb(env); } catch (e) {}
      const t2 = await d.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='cont_doc'").first();
      if (!t2.n) return json({ io, danea: null, app: null, documenti: { n: 0 }, anni: [], oggi: oggi(), avviso: 'I conti non sono ancora stati preparati: il database oggi ha finito le scritture gratuite. Si preparano da soli alla prima apertura dopo l\'01:00 (oppure subito con il piano Workers Paid di Cloudflare).' });
    }
    let dan = await info(d, 'conti_danea'), app = await info(d, 'conti_app');
    const sa = await info(d, 'info');
    const nSa = (await d.prepare('SELECT COUNT(*) n FROM storico_art').first()).n;
    // ricalcolo automatico: Danea se lo storico è cambiato, app se sono passati più di 3 minuti
    let avviso = '';
    try {
      if (nSa && (!dan || dan.righe !== nSa)) await ricalcolaDanea(d);
      else {
        const tf = await info(d, 'conti_fatture');
        const sdt = await d.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='storico_doc'").first();
        const nSd = sdt.n ? (await d.prepare('SELECT COUNT(*) n FROM storico_doc').first()).n : 0;
        if (nSd && (!tf || tf.v !== TF_VER || tf.n !== nSd)) await totaliFatture(d);
      }
      if (!app || Date.now() - app.at > 600_000) await ricalcolaApp(d);
    } catch (e) { avviso = /write limit|daily row/i.test(String(e?.message || e)) ? 'Il database ha finito le scritture gratuite di oggi: i conti si vedono ma non si aggiornano né si modificano fino all\'01:00 (oppure subito con il piano Workers Paid di Cloudflare).' : 'Aggiornamento dei conti non riuscito: ' + String(e?.message || e).slice(0, 200); }
    app = await info(d, 'conti_app');
    dan = await info(d, 'conti_danea');
    const c = (await d.prepare("SELECT COUNT(*) n, MIN(data) da, MAX(data) a, SUM(fonte='xml' OR fimp IS NOT NULL AND fonte='danea') esatti, SUM(mod) modificati FROM cont_doc").first());
    const anni = (await d.prepare("SELECT anno, COUNT(*) n FROM cont_doc WHERE anno<>'' GROUP BY anno ORDER BY anno").all()).results;
    return json({ io, danea: dan, app, storico: sa, documenti: c, anni, oggi: oggi(), avviso });
  }
  if (p === 'ricalcola' && m === 'POST') {
    const parte = body.parte || 'tutto', r = {};
    if (parte !== 'app') r.danea = await ricalcolaDanea(d);
    if (parte !== 'danea') r.app = await ricalcolaApp(d);
    return json({ ok: true, ...r });
  }

  if (p === 'riepilogo') {
    const da = q.get('da') || '2000-01-01', a = q.get('a') || '2999-12-31';
    const spost = (s) => { const y = Number(s.slice(0, 4)) - 1; return y + s.slice(4); };
    const daP = spost(da), aP = spost(a);
    const kpi = async (x, y) => d.prepare(`SELECT
        SUM(CASE WHEN verso='vendita' AND stat=1 THEN ${VAL_S} END) venduto,
        SUM(CASE WHEN verso='vendita' AND stat=1 THEN 1 END) nvend,
        SUM(CASE WHEN tipo='fattura' THEN ${VAL} END) fatture, SUM(CASE WHEN tipo='fattura' THEN 1 END) nfatture,
        SUM(CASE WHEN tipo='nota' THEN ${VAL} END) note, SUM(CASE WHEN tipo='nota' THEN 1 END) nnote,
        SUM(CASE WHEN tipo='banco' AND stat=1 THEN ${VAL_S} END) banco, SUM(CASE WHEN tipo='banco' THEN 1 END) nbanco,
        SUM(CASE WHEN tipo='ddt' AND stat=1 THEN ${VAL_S} END) ddt, SUM(CASE WHEN tipo='ddt' THEN 1 END) nddt,
        SUM(CASE WHEN tipo='riparazione' AND stat=1 THEN ${VAL_S} END) riparazioni, SUM(CASE WHEN tipo='riparazione' THEN 1 END) nriparazioni,
        SUM(CASE WHEN tipo='ordine' AND stat=1 THEN ${VAL_S} END) ordini, SUM(CASE WHEN tipo='ordine' AND stat=1 THEN 1 END) nordini,
        SUM(CASE WHEN tipo='acquisto' THEN ${VAL} END) acquisti, SUM(CASE WHEN tipo='acquisto' THEN 1 END) nacquisti,
        SUM(CASE WHEN tipo='arrivo' THEN ${VAL_S} END) arrivi,
        SUM(CASE WHEN tipo='spesa' THEN ${VAL} END) spese,
        SUM(CASE WHEN tipo='preventivo' THEN ${VAL_S} END) preventivi, SUM(CASE WHEN tipo='preventivo' THEN 1 END) npreventivi,
        COUNT(DISTINCT CASE WHEN verso='vendita' AND stat=1 THEN COALESCE(NULLIF(cli,''),UPPER(nome)) END) clienti
      FROM cont_doc WHERE nasc=0 AND data BETWEEN ? AND ?`).bind(x, y).first();
    const [ora, prima] = [await kpi(da, a), await kpi(daP, aP)];
    const mesi = (await d.prepare(`SELECT substr(data,1,7) m, SUM(${VAL_S}) v, COUNT(*) n FROM cont_doc WHERE nasc=0 AND stat=1 AND verso='vendita' AND ((data BETWEEN ? AND ?) OR (data BETWEEN ? AND ?)) GROUP BY 1 ORDER BY 1`).bind(da, a, daP, aP).all()).results;
    const perTipo = (await d.prepare(`SELECT tipo, SUM(${VAL_S}) v, COUNT(*) n FROM cont_doc WHERE nasc=0 AND stat=1 AND verso='vendita' AND data BETWEEN ? AND ? GROUP BY 1 ORDER BY 2 DESC`).bind(da, a).all()).results;
    const perCanale = (await d.prepare(`SELECT COALESCE(NULLIF(canale,''),'Negozio') canale, SUM(${VAL_S}) v, COUNT(*) n FROM cont_doc WHERE nasc=0 AND stat=1 AND tipo='ordine' AND data BETWEEN ? AND ? GROUP BY 1 ORDER BY 2 DESC`).bind(da, a).all()).results;
    const clienti = (await d.prepare(`SELECT MAX(cli) cli, MAX(nome) nome, SUM(${VAL_S}) v, COUNT(*) n FROM cont_doc WHERE nasc=0 AND stat=1 AND verso='vendita' AND data BETWEEN ? AND ? AND nome<>'' GROUP BY COALESCE(NULLIF(cli,''),UPPER(nome)) ORDER BY 3 DESC LIMIT 10`).bind(da, a).all()).results;
    const articoli = (await d.prepare(`SELECT base cod, MAX(descr) descr, SUM(CASE WHEN tipo='N' THEN -ABS(qta) ELSE qta END) qta, SUM(CASE WHEN tipo='N' THEN -ABS(tot) ELSE tot END) v FROM storico_art WHERE tipo IN ('B','D','F','G','I','N') AND data BETWEEN ? AND ? AND base NOT IN ('MAN','') GROUP BY base ORDER BY 4 DESC LIMIT 10`).bind(da, a).all()).results;
    const anni = (await d.prepare(`SELECT anno, SUM(CASE WHEN verso='vendita' AND stat=1 THEN ${VAL_S} END) v, SUM(CASE WHEN tipo='riparazione' THEN 1 END) rip, SUM(CASE WHEN tipo='acquisto' THEN ${VAL} END) acq FROM cont_doc WHERE nasc=0 AND anno<>'' GROUP BY anno ORDER BY anno`).all()).results;
    const aperti = await d.prepare(`SELECT COUNT(*) n, SUM(COALESCE(ftot,imp*1.22)) v, SUM(CASE WHEN scadenza<>'' AND scadenza<? THEN COALESCE(ftot,imp*1.22) END) scad, SUM(CASE WHEN scadenza<>'' AND scadenza<? THEN 1 END) nscad FROM cont_doc WHERE nasc=0 AND verso='vendita' AND pagato=0`).bind(oggi(), oggi()).first();
    return json({ da, a, daP, aP, ora, prima, mesi, perTipo, perCanale, clienti, articoli, anni, aperti });
  }

  if (p === 'docs') {
    const M = await clientiMap(d);
    const { w, b } = filtro(q);
    const ORD = { data: 'data DESC, num DESC', dataAsc: 'data ASC, num ASC', importo: `${VAL} DESC`, nome: 'nome ASC, data DESC', scadenza: "CASE WHEN scadenza='' OR scadenza IS NULL THEN 1 ELSE 0 END, scadenza ASC" };
    const ord = ORD[q.get('ordina')] || ORD.data;
    const n = Math.min(5000, Math.max(1, Number(q.get('n')) || 100)), off = Math.max(0, Number(q.get('off')) || 0);
    const rows = (await d.prepare(`SELECT ${COLS} FROM cont_doc WHERE ${w} ORDER BY ${ord} LIMIT ? OFFSET ?`).bind(...b, n, off).all()).results.map((r) => arricchisci(M, r));
    // fatture, note, banco, acquisti: importo del documento; elenchi misti (vendite, DDT, riparazioni): righe proprie, per non contare due volte DDT e fattura
    const esatti = ['fatture', 'fiscali', 'note', 'acquisti', 'spese'].includes(q.get('tipo') || '');
    const tot = esatti
      ? await d.prepare(`SELECT COUNT(*) n, SUM(${VAL}) imp, SUM(COALESCE(fiva, ${VAL}*0.22)) iva, SUM(COALESCE(ftot, ${VAL}*1.22)) tot FROM cont_doc WHERE ${w}`).bind(...b).first()
      : await d.prepare(`SELECT COUNT(*) n, SUM(${VAL_S}) imp, SUM(${VAL_S}*0.22) iva, SUM(${VAL_S}*1.22) tot FROM cont_doc WHERE ${w}`).bind(...b).first();
    return json({ righe: rows, tot, off, n });
  }

  if (p === 'doc') {
    const id = q.get('id') || '';
    const r = await d.prepare(`SELECT ${COLS} FROM cont_doc WHERE id=?`).bind(id).first();
    if (!r) return json({ error: 'documento non trovato' }, 404);
    arricchisci(await clientiMap(d), r);
    let righe = [];
    if (r.fonte === 'danea' || id.startsWith('D:')) {
      const [, t, y, num] = id.split(':');
      const k = id.split(':').slice(3).join(':');
      righe = (await d.prepare('SELECT cod,descr,qta,prezzo,sconti,tot FROM storico_art WHERE tipo=? AND num=? AND substr(data,1,4)=? LIMIT 500').bind(t, k, y).all()).results;
      if (!righe.length) righe = (await d.prepare("SELECT cod,descr,qta,prezzo,sconti,tot FROM storico_art WHERE tipo=? AND substr(data,1,4)=? AND (num IS NULL OR num='') AND data||'-'||COALESCE(cli,'')=? LIMIT 500").bind(t, y, k).all()).results;
    } else if (r.rif && (id.startsWith('W:') || id.startsWith('T:'))) {
      const x = await d.prepare('SELECT d FROM docs WHERE c=? AND id=?').bind(id.startsWith('W:') ? 'ordiniWeb' : 'tickets', r.rif).first();
      try { const o = JSON.parse(x?.d || 'null');
        if (o && id.startsWith('W:')) righe = (o.righe || []).map((z) => ({ cod: z.codice, descr: z.descr, qta: z.qty, prezzo: r2((Number(z.prezzo) || 0) / 1.22), sconti: '', tot: r2((Number(z.qty) || 0) * (Number(z.prezzo) || 0) / 1.22) }));
        if (o && id.startsWith('T:')) { righe = (o.ricambi || []).map((z) => ({ cod: z.codice, descr: z.descr, qta: z.qty, prezzo: r2((Number(z.prezzo) || 0) / 1.22), sconti: o.scontoRic ? o.scontoRic + '%' : '', tot: r2((Number(z.qty) || 0) * (Number(z.prezzo) || 0) / 1.22 * (1 - (Number(o.scontoRic) || 0) / 100)) }));
          if (Number(o.manodopera)) righe.push({ cod: 'MAN', descr: o.manodoperaDescr || 'Manodopera', qta: 1, prezzo: r2(o.manodopera / 1.22), sconti: '', tot: r2(o.manodopera / 1.22) }); }
      } catch {}
    }
    const mod = (await d.prepare("SELECT at,nome,op,d FROM registro WHERE c='conti' AND docid=? ORDER BY at DESC LIMIT 50").bind(id).all()).results.map((x) => ({ ...x, d: (() => { try { return JSON.parse(x.d); } catch { return x.d; } })() }));
    return json({ doc: r, righe, modifiche: mod });
  }

  if ((p === 'salva' || p === 'nuovo') && m === 'POST') {
    const campi = {};
    for (const k of EDIT) if (body.campi && body.campi[k] !== undefined) campi[k] = body.campi[k];
    for (const k of ['imp', 'fimp', 'fiva', 'ftot']) if (campi[k] !== undefined) campi[k] = campi[k] === '' || campi[k] === null ? null : r2(campi[k]);
    for (const k of ['pagato', 'nasc']) if (campi[k] !== undefined) campi[k] = campi[k] === null || campi[k] === '' ? null : campi[k] ? 1 : 0;
    if (campi.data !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(campi.data))) return json({ error: 'data non valida' }, 400);
    const now = Date.now();
    if (p === 'nuovo') {
      if (!campi.data) return json({ error: 'manca la data' }, 400);
      const id = 'M:' + casuale(6);
      const r = { id, fonte: 'manuale', dt: 'M', tipo: 'spesa', verso: 'acquisto', ...campi, stat: 1, mod: 1 };
      if (r.fimp != null && r.imp == null) r.imp = r.fimp;
      if (r.fimp == null && r.imp != null) r.fimp = r.imp;
      if (r.fimp != null && r.fiva == null) r.fiva = r2(r.fimp * 0.22);
      if (r.fimp != null && r.ftot == null) r.ftot = r2(r.fimp + r.fiva);
      if (!['vendita', 'acquisto', 'nessuno'].includes(r.verso)) r.verso = 'acquisto';
      await d.batch([
        d.prepare(`INSERT INTO cont_doc (${COLS}) VALUES (${COLS.split(',').map(() => '?').join(',')})`).bind(...riga(r, now, io.nome)),
        d.prepare('INSERT INTO registro(at,chi,nome,c,docid,op,d) VALUES(?,?,?,?,?,?,?)').bind(now, io.email, io.nome, 'conti', id, 'nuovo', JSON.stringify({ _nuovo: campi }).slice(0, 6000)),
      ]);
      return json({ ok: true, id });
    }
    const id = String(body.id || '');
    const prima = await d.prepare(`SELECT ${COLS} FROM cont_doc WHERE id=?`).bind(id).first();
    if (!prima) return json({ error: 'documento non trovato' }, 404);
    // cambiando l'importo di un documento che conta nelle statistiche si aggiorna anche quello, tranne le fatture che includono DDT/rapporti (importo diverso dalle righe proprie)
    if (campi.fimp !== undefined && campi.imp === undefined) {
      const incl = prima.fonte === 'danea' && prima.fimp != null && prima.imp != null && Math.abs(prima.fimp - prima.imp) > 0.5;
      if (!incl) campi.imp = campi.fimp;
    }
    if (campi.data) campi.anno = String(campi.data).slice(0, 4);
    const dopo = { ...prima, ...campi };
    const diff = differenza(prima, dopo); delete diff.u; delete diff.chi; delete diff.mod; delete diff.anno;
    if (!Object.keys(diff).length) return json({ ok: true, invariato: true });
    const ks = Object.keys(campi);
    const st = [
      d.prepare(`UPDATE cont_doc SET ${ks.map((k) => k + '=?').join(',')}, mod=1, chi=?, u=? WHERE id=?`).bind(...ks.map((k) => campi[k]), io.nome, now, id),
      d.prepare('INSERT INTO registro(at,chi,nome,c,docid,op,d) VALUES(?,?,?,?,?,?,?)').bind(now, io.email, io.nome, 'conti', id, 'modifica', JSON.stringify(diff).slice(0, 6000)),
    ];
    // ordine dell'app: "pagato" e scadenza vanno anche nell'ordine, così lo vedono tutti
    if (id.startsWith('W:') && prima.rif && (campi.pagato !== undefined || campi.scadenza !== undefined)) {
      const x = await d.prepare("SELECT d FROM docs WHERE c='ordiniWeb' AND id=?").bind(prima.rif).first();
      if (x?.d) { const o = JSON.parse(x.d), o2 = { ...o };
        if (campi.pagato !== undefined) { o2.pagato = !!campi.pagato; o2.pagatoAt = campi.pagato ? (campi.pagatoIl ? new Date(campi.pagatoIl + 'T12:00:00').getTime() : now) : null; if (campi.pagato) o2.daPagare = false; }
        if (campi.scadenza !== undefined) o2.scadenza = campi.scadenza ? new Date(campi.scadenza + 'T12:00:00').getTime() : null;
        if (campi.metodo) o2.metodo = campi.metodo;
        st.push(d.prepare('UPDATE docs SET d=?, u=?, chi=? WHERE c=? AND id=?').bind(JSON.stringify(o2), now, io.nome, 'ordiniWeb', prima.rif));
        st.push(d.prepare('INSERT INTO registro(at,chi,nome,c,docid,op,d) VALUES(?,?,?,?,?,?,?)').bind(now, io.email, io.nome, 'ordiniWeb', prima.rif, 'update', JSON.stringify(differenza(o, o2)).slice(0, 6000)));
      }
    }
    await d.batch(st);
    return json({ ok: true });
  }
  if (p === 'elimina' && m === 'POST') {
    const id = String(body.id || '');
    const r = await d.prepare('SELECT fonte, nome, num, data FROM cont_doc WHERE id=?').bind(id).first();
    if (!r) return json({ error: 'documento non trovato' }, 404);
    if (r.fonte !== 'manuale' && r.fonte !== 'xml') return json({ error: 'si possono eliminare solo i documenti scritti a mano o caricati da file: gli altri si escludono dai conti' }, 400);
    await d.batch([d.prepare('DELETE FROM cont_doc WHERE id=?').bind(id),
      d.prepare('INSERT INTO registro(at,chi,nome,c,docid,op,d) VALUES(?,?,?,?,?,?,?)').bind(Date.now(), io.email, io.nome, 'conti', id, 'elimina', JSON.stringify({ _cancellato: r }))]);
    return json({ ok: true });
  }

  if (p === 'clienti') {
    const M = await clientiMap(d);
    const da = q.get('da') || '2000-01-01', a = q.get('a') || '2999-12-31';
    const sp = (s) => (Number(s.slice(0, 4)) - 1) + s.slice(4);
    const t = String(q.get('q') || '').trim().toUpperCase();
    const fq = t ? ' AND (UPPER(nome) LIKE ? OR cli=? OR piva=?)' : '';
    const bq = t ? ['%' + t + '%', t, t] : [];
    const sql = (x, y) => d.prepare(`SELECT COALESCE(NULLIF(cli,''),UPPER(nome)) k, MAX(cli) cli, MAX(nome) nome, SUM(${VAL_S}) v, COUNT(*) n,
        SUM(CASE WHEN tipo='riparazione' THEN 1 END) rip, MAX(data) ult, SUM(CASE WHEN pagato=0 THEN COALESCE(ftot,imp*1.22) END) aperto
      FROM cont_doc WHERE nasc=0 AND stat=1 AND verso='vendita' AND nome<>'' AND data BETWEEN ? AND ?${fq} GROUP BY 1 ORDER BY 4 DESC LIMIT ${t ? 100 : 300}`).bind(x, y, ...bq).all();
    const ora = (await sql(da, a)).results, prima = new Map((await sql(sp(da), sp(a))).results.map((r) => [r.k, r.v]));
    const tot = await d.prepare(`SELECT SUM(${VAL_S}) v, COUNT(DISTINCT COALESCE(NULLIF(cli,''),UPPER(nome))) n FROM cont_doc WHERE nasc=0 AND stat=1 AND verso='vendita' AND data BETWEEN ? AND ?`).bind(da, a).first();
    return json({ righe: ora.map((r) => { const c = cliDi(M, r.cli); return { ...r, prima: prima.get(r.k) || 0, piva: c?.piva || '', citta: c?.citta || '', pagamento: c?.pagamento || '' }; }), tot });
  }
  if (p === 'cliente') {
    const M = await clientiMap(d);
    const cli = q.get('cli') || '', nome = q.get('nome') || '';
    const w = cli ? '(cli=? OR cli=?)' : 'UPPER(nome)=?', b = cli ? [cli, cli.replace(/^D/, '')] : [nome.toUpperCase()];
    const anni = (await d.prepare(`SELECT anno, SUM(CASE WHEN verso='vendita' AND stat=1 THEN ${VAL_S} END) v, COUNT(*) n, SUM(CASE WHEN tipo='riparazione' THEN 1 END) rip, SUM(CASE WHEN tipo='fattura' THEN 1 END) fat FROM cont_doc WHERE nasc=0 AND ${w} GROUP BY anno ORDER BY anno DESC`).bind(...b).all()).results;
    const docs = (await d.prepare(`SELECT ${COLS} FROM cont_doc WHERE nasc=0 AND ${w} ORDER BY data DESC LIMIT 400`).bind(...b).all()).results;
    const arti = (await d.prepare(`SELECT base cod, MAX(descr) descr, SUM(qta) qta, SUM(tot) v, MAX(data) ult FROM storico_art WHERE tipo IN ('B','D','F','G','I') AND ${cli ? '(cli=? OR cli=?)' : 'UPPER(nome)=?'} AND base NOT IN ('MAN','') GROUP BY base ORDER BY 4 DESC LIMIT 40`).bind(...b).all()).results;
    const ana = cliDi(M, cli) || [...M.values()].find((c) => String(c.nome).toUpperCase() === nome.toUpperCase()) || null;
    return json({ anni, docs, articoli: arti, anagrafica: ana });
  }
  if (p === 'articoli') {
    const da = q.get('da') || '2000-01-01', a = q.get('a') || '2999-12-31', t = String(q.get('q') || '').trim().toUpperCase();
    const r = (await d.prepare(`SELECT base cod, MAX(descr) descr, SUM(CASE WHEN tipo='N' THEN -ABS(qta) WHEN tipo='H' THEN 0 ELSE qta END) qta,
        SUM(CASE WHEN tipo='N' THEN -ABS(tot) WHEN tipo='H' THEN 0 ELSE tot END) v, SUM(CASE WHEN tipo='H' THEN qta ELSE 0 END) acq, SUM(CASE WHEN tipo='H' THEN tot ELSE 0 END) costo,
        COUNT(DISTINCT CASE WHEN tipo<>'H' THEN cli END) clienti, MAX(data) ult
      FROM storico_art WHERE tipo IN ('B','D','F','G','I','N','H') AND data BETWEEN ? AND ? AND base NOT IN ('MAN','')${t ? ' AND (base LIKE ? OR UPPER(descr) LIKE ?)' : ''}
      GROUP BY base ORDER BY 4 DESC LIMIT 200`).bind(da, a, ...(t ? [t + '%', '%' + t + '%'] : [])).all()).results;
    return json({ righe: r });
  }

  if (p === 'importa' && m === 'POST') {
    const lista = Array.isArray(body.docs) ? body.docs.slice(0, 400) : [];
    const now = Date.now(); let nuovi = 0, aggiornati = 0;
    const st = [];
    for (const x of lista) {
      const data = String(x.data || ''); if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) continue;
      const num = String(x.num || '').trim(), tipo = ['fattura', 'nota', 'banco', 'ddt', 'acquisto', 'riparazione', 'spesa'].includes(x.tipo) ? x.tipo : 'fattura';
      const verso = tipo === 'acquisto' || tipo === 'spesa' ? 'acquisto' : 'vendita';
      const fimp = x.imp == null || x.imp === '' ? null : r2(x.imp), fiva = x.iva == null || x.iva === '' ? (fimp == null ? null : r2(fimp * 0.22)) : r2(x.iva);
      const ftot = x.tot == null || x.tot === '' ? (fimp == null ? null : r2(fimp + fiva)) : r2(x.tot);
      // vendite: si cerca il documento Danea con lo stesso numero nello stesso anno (fattura I o accompagnatoria F, nota N, banco B, DDT D)
      let id = null;
      if (verso === 'vendita' && num) {
        const lett = { fattura: ['I', 'F', 'A'], nota: ['N'], banco: ['B'], ddt: ['D'], riparazione: ['G'] }[tipo] || ['I'];
        const numN = num.replace(/^0+/, '').replace(/\s/g, '');
        const conAnno = data.slice(2, 4) + numN.padStart(4, '0');
        const c = await d.prepare(`SELECT id FROM cont_doc WHERE fonte='danea' AND anno=? AND dt IN (${lett.map(() => '?').join(',')}) AND (num=? OR num=? OR num=? OR REPLACE(num,' ','')=?) LIMIT 1`).bind(data.slice(0, 4), ...lett, num, numN, conAnno, numN).first();
        if (c) id = c.id;
      }
      const campi = { fimp, fiva, ftot, ...(x.pagamento ? { pagamento: String(x.pagamento).slice(0, 80) } : {}), ...(x.scadenza && /^\d{4}-\d{2}-\d{2}$/.test(x.scadenza) ? { scadenza: x.scadenza } : {}), ...(x.piva ? { piva: String(x.piva).slice(0, 20) } : {}) };
      if (id) {
        const ks = Object.keys(campi);
        st.push(d.prepare(`UPDATE cont_doc SET ${ks.map((k) => k + '=?').join(',')}, u=? WHERE id=? AND (${ks.map((k) => k + ' IS NOT ?').join(' OR ')})`).bind(...ks.map((k) => campi[k]), now, id, ...ks.map((k) => campi[k]))); aggiornati++;
      } else {
        id = verso === 'acquisto' ? 'F:' + String((x.piva || '') + '_' + num + '_' + data).replace(/[^A-Za-z0-9_-]/g, '-') : 'X:' + tipo + ':' + data.slice(0, 4) + ':' + (num || casuale(4));
        // vendite caricate da file e non trovate in Danea: elenco e commercialista sì, statistiche no (le righe sono già contate dai DDT/rapporti)
        const r = { id, fonte: 'xml', dt: x.td || '', tipo, verso, num, data, cli: x.cli || x.piva || '', nome: String(x.nome || '').slice(0, 120), piva: x.piva || '', imp: fimp, ...campi,
          note: String(x.note || '').slice(0, 200), stat: verso === 'acquisto' ? 1 : 0, rif: x.file || '' };
        st.push(d.prepare(`INSERT INTO cont_doc (${COLS}) VALUES (${COLS.split(',').map(() => '?').join(',')})
          ON CONFLICT(id) DO UPDATE SET fimp=excluded.fimp, fiva=excluded.fiva, ftot=excluded.ftot, imp=CASE WHEN cont_doc.fonte IN ('app','xml') THEN excluded.imp ELSE cont_doc.imp END, fonte=CASE WHEN cont_doc.fonte='app' THEN 'xml' ELSE cont_doc.fonte END, u=excluded.u
          WHERE cont_doc.fimp IS NOT excluded.fimp OR cont_doc.fiva IS NOT excluded.fiva OR cont_doc.ftot IS NOT excluded.ftot`).bind(...riga(r, now, io.nome)));
        nuovi++;
      }
    }
    for (let i = 0; i < st.length; i += 50) await d.batch(st.slice(i, i + 50));
    if (st.length) await d.prepare('INSERT INTO registro(at,chi,nome,c,docid,op,d) VALUES(?,?,?,?,?,?,?)').bind(now, io.email, io.nome, 'conti', '*', 'importa', JSON.stringify({ nuovi, aggiornati, fonte: body.fonte || '' })).run();
    return json({ ok: true, nuovi, aggiornati });
  }

  if (p === 'modifiche') {
    const r = (await d.prepare("SELECT at,nome,docid,op,d FROM registro WHERE c='conti' ORDER BY at DESC LIMIT 300").all()).results.map((x) => ({ ...x, d: (() => { try { return JSON.parse(x.d); } catch { return x.d; } })() }));
    return json({ righe: r });
  }
  return json({ error: 'non trovato' }, 404);
}
