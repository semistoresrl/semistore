// API dell'app interna (semistore.it/gestione/). Vedi functions/_lib/gestione.js.
//  GET  io                       → utente collegato, primo avvio, email configurata
//  POST primo {token,email,nome} → primo amministratore (solo se non ci sono utenti; token = ADMIN_TOKEN)
//  POST codice {email}           → manda il codice di 6 cifre per email
//  POST entra {email,codice}     → sessione 30 giorni (cookie)
//  POST esci
//  GET  db?since=ms              → documenti cambiati da `since` (d = null se cancellato)
//  POST db {ops:[{op,c,id,d}]}   → set | update (unione profonda) | delete | add; ogni modifica va nel registro
//  POST importa {dati}           → solo admin: carica l'archivio esportato dall'app vecchia
//  GET  registro                 → solo admin: chi ha cambiato cosa
//  GET/POST utenti               → solo admin: elenco, aggiungi/modifica, codice d'accesso a mano
//  POST file                     → allegato (corpo = file, header x-nome) → {id}; si legge da /_blob/<id>
//  GET  presenze?da&a            → solo admin: persone sul sito (in diretta, per periodo)
import { gdb, json, utente, sha, casuale, cookieSessione, cookieVia, fondi, differenza, mandaEmail, giornoIT } from '../../_lib/gestione.js';

const MAX_FILE = 1_900_000;
const nuovoId = () => casuale(10);

export async function onRequest(ctx) {
  const { request, env, params } = ctx;
  const p = (params.p || []).join('/');
  const m = request.method;
  if (!env.DB) return json({ error: 'database non collegato' }, 503);
  const d = await gdb(env);
  const body = m === 'POST' && p !== 'file' ? await request.json().catch(() => ({})) : null;
  const io = await utente(request, env);

  if (p === 'io') {
    const n = (await d.prepare('SELECT COUNT(*) n FROM utenti').first()).n;
    if (io) await d.prepare('UPDATE utenti SET ultimo=? WHERE email=?').bind(Date.now(), io.email).run();
    return json({ utente: io, primoAvvio: n === 0, email: !!env.RESEND_API_KEY, mittente: !!env.EMAIL_FROM });
  }
  if (p === 'primo' && m === 'POST') {
    const n = (await d.prepare('SELECT COUNT(*) n FROM utenti').first()).n;
    if (n > 0) return json({ error: 'già configurato' }, 409);
    if (!env.ADMIN_TOKEN || body.token !== env.ADMIN_TOKEN) return json({ error: 'codice di accesso del sito sbagliato' }, 401);
    const email = String(body.email || '').trim().toLowerCase(), nome = String(body.nome || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !nome) return json({ error: 'email o nome mancanti' }, 400);
    await d.prepare('INSERT INTO utenti(email,nome,ruolo,attivo,creato) VALUES(?,?,?,1,?)').bind(email, nome, 'admin', Date.now()).run();
    return sessione(d, email, request, { utente: { email, nome, ruolo: 'admin' } });
  }
  if (p === 'codice' && m === 'POST') {
    const email = String(body.email || '').trim().toLowerCase();
    const u = await d.prepare('SELECT nome, recupero FROM utenti WHERE email=? AND attivo=1').bind(email).first();
    if (!u) return json({ ok: true }); // non si dice se l'email esiste
    const c = await d.prepare('SELECT inviato FROM codici WHERE email=?').bind(email).first();
    if (c && Date.now() - (c.inviato || 0) < 45_000) return json({ error: 'aspetta un minuto prima di chiedere un altro codice' }, 429);
    const codice = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
    await d.prepare(`INSERT INTO codici(email,hash,scade,tentativi,inviato) VALUES(?,?,?,0,?)
      ON CONFLICT(email) DO UPDATE SET hash=excluded.hash, scade=excluded.scade, tentativi=0, inviato=excluded.inviato`)
      .bind(email, await sha(email + ':' + codice), Date.now() + 15 * 60_000, Date.now()).run();
    const r = await mandaEmail(env, { to: email, subject: `${codice} è il tuo codice per Semi Gestione`,
      text: `Ciao ${u.nome},\n\nil tuo codice per entrare nell'app Semi Gestione è: ${codice}\n\nVale 15 minuti. Se non l'hai chiesto tu, ignora questa email.\n\nSemi Store`,
      html: `<p>Ciao ${u.nome},</p><p>il tuo codice per entrare nell'app <b>Semi Gestione</b> è:</p><p style="font-size:34px;font-weight:800;letter-spacing:6px;margin:16px 0">${codice}</p><p>Vale 15 minuti. Se non l'hai chiesto tu, ignora questa email.</p><p>Semi Store</p>` });
    if (u.recupero && u.recupero !== email) { // copia all'email di recupero (es. se la casella principale si legge solo dentro l'app)
      const r2 = await mandaEmail(env, { to: u.recupero, subject: `${codice} è il codice di ${u.nome} per Semi Gestione`,
        text: `Codice per entrare nell'app Semi Gestione come ${u.nome} (${email}): ${codice}\n\nVale 15 minuti. Lo ricevi perché sei l'email di recupero. Se non l'ha chiesto nessuno, ignora questa email.\n\nSemi Store`,
        html: `<p>Codice per entrare nell'app <b>Semi Gestione</b> come <b>${u.nome}</b> (${email}):</p><p style="font-size:34px;font-weight:800;letter-spacing:6px;margin:16px 0">${codice}</p><p>Vale 15 minuti. Lo ricevi perché sei l'email di recupero. Se non l'ha chiesto nessuno, ignora questa email.</p><p>Semi Store</p>` });
      if (!r.ok && r2.ok) return json({ ok: true });
    }
    if (!r.ok) return json({ error: "Non riesco a mandare l'email: chiedi a Gianluca il codice dall'app (Utenti → Codice d'accesso).", motivo: r.motivo }, 502);
    return json({ ok: true });
  }
  if (p === 'entra' && m === 'POST') {
    const email = String(body.email || '').trim().toLowerCase(), codice = String(body.codice || '').replace(/\D/g, '');
    const c = await d.prepare('SELECT hash, scade, tentativi FROM codici WHERE email=?').bind(email).first();
    if (!c || c.scade < Date.now()) return json({ error: 'codice scaduto: chiedine un altro' }, 401);
    if (c.tentativi >= 5) return json({ error: 'troppi tentativi: chiedi un altro codice' }, 429);
    if (c.hash !== await sha(email + ':' + codice)) {
      await d.prepare('UPDATE codici SET tentativi=tentativi+1 WHERE email=?').bind(email).run();
      return json({ error: 'codice sbagliato' }, 401);
    }
    const u = await d.prepare('SELECT email,nome,ruolo FROM utenti WHERE email=? AND attivo=1').bind(email).first();
    if (!u) return json({ error: 'utente non attivo' }, 403);
    await d.prepare('DELETE FROM codici WHERE email=?').bind(email).run();
    return sessione(d, email, request, { utente: u });
  }
  if (p === 'esci' && m === 'POST') {
    const tok = (request.headers.get('cookie') || '').match(/semi_sess=([^;]+)/);
    if (tok) await d.prepare('DELETE FROM sessioni WHERE token=?').bind(await sha(decodeURIComponent(tok[1]))).run();
    return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json', 'set-cookie': cookieVia() } });
  }

  // ----- da qui serve essere collegati -----
  if (!io) return json({ error: 'non collegato' }, 401);
  const admin = io.ruolo === 'admin';

  if (p === 'db' && m === 'GET') {
    const since = Number(new URL(request.url).searchParams.get('since') || 0);
    const ora = Date.now();
    const r = (await d.prepare('SELECT c, id, d, u, chi FROM docs WHERE u >= ? ORDER BY u').bind(since).all()).results;
    return json({ ora, docs: r.map((x) => ({ c: x.c, id: x.id, u: x.u, chi: x.chi, d: x.d == null ? null : JSON.parse(x.d) })) });
  }
  if (p === 'db' && m === 'POST') {
    const ops = Array.isArray(body.ops) ? body.ops.slice(0, 60) : [];
    const ids = [];
    for (const o of ops) {
      const c = String(o.c || ''), op = String(o.op || '');
      if (!/^[A-Za-z][\w-]{0,40}$/.test(c)) return json({ error: 'collezione non valida' }, 400);
      const id = op === 'add' ? (o.id || nuovoId()) : String(o.id || '');
      if (!id || id.length > 200) return json({ error: 'id non valido' }, 400);
      const prev = await d.prepare('SELECT d FROM docs WHERE c=? AND id=?').bind(c, id).first();
      const prima = prev && prev.d != null ? JSON.parse(prev.d) : null;
      let dopo;
      if (op === 'delete') dopo = null;
      else if (op === 'update') { if (!prima) return json({ error: 'documento inesistente', code: 'not_found' }, 404); dopo = fondi(prima, o.d || {}); }
      else if (op === 'merge') dopo = fondi(prima || {}, o.d || {});
      else if (op === 'set' || op === 'add') dopo = o.d || {};
      else return json({ error: 'operazione non valida' }, 400);
      if (!admin && dopo) await bloccaPrezzi(d, c, prima, dopo); // solo l'amministratore cambia i prezzi
      const u = Date.now();
      const testo = dopo == null ? null : JSON.stringify(dopo);
      if (testo && testo.length > 1_800_000) return json({ error: 'documento troppo grande', code: 'quota_exceeded' }, 413);
      const diff = op === 'delete' ? { _cancellato: true } : prima ? differenza(prima, dopo) : { _nuovo: riassunto(dopo) };
      let dj = JSON.stringify(diff); if (dj.length > 6000) dj = dj.slice(0, 6000) + '…';
      if (dj === '{}') { ids.push(id); continue; } // nessun cambiamento reale
      await d.batch([
        d.prepare('INSERT INTO docs(c,id,d,u,chi) VALUES(?,?,?,?,?) ON CONFLICT(c,id) DO UPDATE SET d=excluded.d, u=excluded.u, chi=excluded.chi').bind(c, id, testo, u, io.nome),
        d.prepare('INSERT INTO registro(at,chi,nome,c,docid,op,d) VALUES(?,?,?,?,?,?,?)').bind(u, io.email, io.nome, c, id, op, dj),
      ]);
      ids.push(id);
    }
    return json({ ok: true, ids, u: Date.now() });
  }
  if (p === 'importa' && m === 'POST') {
    if (!admin) return json({ error: 'solo amministratore' }, 403);
    const dati = body.dati || {};
    let n = 0; const u = Date.now();
    const righe = [];
    for (const c of Object.keys(dati)) for (const [id, v] of Object.entries(dati[c] || {})) righe.push([c, id, v]);
    // unione: quello che c'è già nell'app sul sito vince, dall'archivio vecchio si aggiunge solo ciò che manca
    for (const r of righe) {
      const prev = await d.prepare('SELECT d FROM docs WHERE c=? AND id=?').bind(r[0], r[1]).first();
      if (prev && prev.d != null) { try { r[2] = fondi(r[2] && typeof r[2] === 'object' ? r[2] : {}, JSON.parse(prev.d)); } catch (e) {} }
    }
    for (let i = 0; i < righe.length; i += 50) {
      await d.batch(righe.slice(i, i + 50).map(([c, id, v]) => d.prepare('INSERT INTO docs(c,id,d,u,chi) VALUES(?,?,?,?,?) ON CONFLICT(c,id) DO UPDATE SET d=excluded.d, u=excluded.u, chi=excluded.chi').bind(c, id, JSON.stringify(v), u, io.nome)));
      n += Math.min(50, righe.length - i);
    }
    await d.prepare('INSERT INTO registro(at,chi,nome,c,docid,op,d) VALUES(?,?,?,?,?,?,?)').bind(u, io.email, io.nome, '*', '*', 'importa', JSON.stringify({ documenti: n })).run();
    return json({ ok: true, documenti: n });
  }
  if (p === 'registro' && m === 'GET') {
    if (!admin) return json({ error: 'solo amministratore' }, 403);
    const q = new URL(request.url).searchParams;
    const da = Number(q.get('da') || 0), a = Number(q.get('a') || Date.now() + 1), chi = q.get('chi') || '', c = q.get('c') || '', id = q.get('id') || '';
    let sql = 'SELECT n,at,chi,nome,c,docid,op,d FROM registro WHERE at>=? AND at<?'; const b = [da, a];
    if (chi) { sql += ' AND chi=?'; b.push(chi); }
    if (c) { sql += ' AND c=?'; b.push(c); }
    if (id) { sql += ' AND docid=?'; b.push(id); }
    sql += ' ORDER BY at DESC LIMIT ' + Math.min(1000, Number(q.get('limite') || 300));
    const r = (await d.prepare(sql).bind(...b).all()).results.map((x) => ({ ...x, d: (() => { try { return JSON.parse(x.d); } catch { return x.d; } })() }));
    return json({ righe: r });
  }
  if (p === 'utenti') {
    if (!admin) return json({ error: 'solo amministratore' }, 403);
    if (m === 'GET') return json({ utenti: (await d.prepare('SELECT email,nome,ruolo,attivo,creato,ultimo,recupero FROM utenti ORDER BY ruolo, nome').all()).results });
    const email = String(body.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'email non valida' }, 400);
    if (body.azione === 'salva') {
      const ruolo = body.ruolo === 'admin' ? 'admin' : 'operatore', nome = String(body.nome || '').trim() || email;
      if (email === io.email && (ruolo !== 'admin' || body.attivo === false)) return json({ error: 'non puoi togliere i permessi a te stesso' }, 400);
      await d.prepare(`INSERT INTO utenti(email,nome,ruolo,attivo,creato) VALUES(?,?,?,?,?)
        ON CONFLICT(email) DO UPDATE SET nome=excluded.nome, ruolo=excluded.ruolo, attivo=excluded.attivo`).bind(email, nome, ruolo, body.attivo === false ? 0 : 1, Date.now()).run();
      if (body.recupero !== undefined) { const rec = String(body.recupero || '').trim().toLowerCase();
        if (rec && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(rec)) return json({ error: 'email di recupero non valida' }, 400);
        await d.prepare('UPDATE utenti SET recupero=? WHERE email=?').bind(rec || null, email).run(); }
      if (body.attivo === false) await d.prepare('DELETE FROM sessioni WHERE email=?').bind(email).run();
      await d.prepare('INSERT INTO registro(at,chi,nome,c,docid,op,d) VALUES(?,?,?,?,?,?,?)').bind(Date.now(), io.email, io.nome, 'utenti', email, 'salva', JSON.stringify({ nome, ruolo, attivo: body.attivo !== false })).run();
      return json({ ok: true });
    }
    if (body.azione === 'codice') { // codice d'accesso da dare a voce o su WhatsApp, se l'email non arriva
      const codice = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
      await d.prepare(`INSERT INTO codici(email,hash,scade,tentativi,inviato) VALUES(?,?,?,0,?)
        ON CONFLICT(email) DO UPDATE SET hash=excluded.hash, scade=excluded.scade, tentativi=0, inviato=excluded.inviato`)
        .bind(email, await sha(email + ':' + codice), Date.now() + 60 * 60_000, Date.now()).run();
      return json({ ok: true, codice, valido: '60 minuti' });
    }
    if (body.azione === 'esci-ovunque') { await d.prepare('DELETE FROM sessioni WHERE email=?').bind(email).run(); return json({ ok: true }); }
    return json({ error: 'azione non valida' }, 400);
  }
  if (p === 'file' && m === 'POST') {
    const buf = await request.arrayBuffer();
    if (!buf.byteLength) return json({ error: 'file vuoto' }, 400);
    if (buf.byteLength > MAX_FILE) return json({ error: 'file troppo grande (max 1,9 MB)', code: 'quota_exceeded' }, 413);
    const xid = String(request.headers.get('x-id') || '').replace(/[^\w-]/g, '').slice(0, 80);
    const id = admin && xid ? xid : nuovoId(), tipo = request.headers.get('content-type') || 'application/octet-stream', nome = decodeURIComponent(request.headers.get('x-nome') || 'file');
    await d.prepare('INSERT OR REPLACE INTO files(id,tipo,nome,dati,at,chi) VALUES(?,?,?,?,?,?)').bind(id, tipo, nome, buf, Date.now(), io.nome).run();
    return json({ id, contentType: tipo });
  }
  // esportazione completa (solo admin): elenco tabelle e righe a pagine, senza segreti, codici, sessioni e contenuti binari
  if (p === 'esporta' && m === 'GET') {
    if (!io || io.ruolo !== 'admin') return json({ error: 'solo amministratore' }, 403);
    const NO_TAB = /^(codici|sessioni|csessioni|accessi|segreti|pmail_raw|sqlite_sequence|_cf_.*|d1_.*)$/;
    const NO_COL = /^(hash|pass|token|h|dati)$/;
    const u = new URL(request.url), t = u.searchParams.get('t') || '';
    const tabs = (await d.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()).results.map(r => r.name).filter(n => !NO_TAB.test(n));
    if (!t) {
      const out = [];
      for (const n of tabs) { try { out.push({ t: n, n: (await d.prepare(`SELECT COUNT(*) n FROM "${n}"`).first()).n }); } catch (e) {} }
      return json({ tabelle: out, at: Date.now() });
    }
    if (!tabs.includes(t)) return json({ error: 'tabella non esportabile' }, 400);
    const cols = (await d.prepare(`PRAGMA table_info("${t}")`).all()).results.map(c => c.name).filter(c => !NO_COL.test(c));
    if (!cols.length) return json({ righe: [], fine: true });
    const da = Math.max(0, Number(u.searchParams.get('da')) || 0), quanti = Math.min(1000, Math.max(50, Number(u.searchParams.get('n')) || 500));
    const righe = (await d.prepare(`SELECT ${cols.map(c => `"${c}"`).join(',')} FROM "${t}" ORDER BY rowid LIMIT ? OFFSET ?`).bind(quanti, da).all()).results;
    return json({ colonne: cols, righe, fine: righe.length < quanti });
  }
  if (p === 'presenze' && m === 'GET') {
    if (!admin) return json({ error: 'solo amministratore' }, 403);
    const q = new URL(request.url).searchParams;
    const a = q.get('a') || giornoIT(), da = q.get('da') || a;
    const live = (await d.prepare('SELECT COUNT(*) n FROM presenze WHERE ultimo > ?').bind(Date.now() - 120_000).first()).n;
    const tot = await d.prepare('SELECT COUNT(DISTINCT vid) v, SUM(pagine) p FROM presenze WHERE giorno BETWEEN ? AND ?').bind(da, a).first();
    const giorni = (await d.prepare('SELECT giorno, COUNT(*) v, SUM(pagine) p FROM presenze WHERE giorno BETWEEN ? AND ? GROUP BY giorno ORDER BY giorno').bind(da, a).all()).results;
    const pagine = (await d.prepare('SELECT pagina, COUNT(*) v FROM presenze WHERE giorno BETWEEN ? AND ? AND pagina IS NOT NULL GROUP BY pagina ORDER BY v DESC LIMIT 8').bind(da, a).all()).results;
    const ora = (await d.prepare('SELECT pagina FROM presenze WHERE ultimo > ? ORDER BY ultimo DESC LIMIT 10').bind(Date.now() - 120_000).all()).results.map((x) => x.pagina);
    return json({ live, da, a, visitatori: tot.v || 0, pagine: tot.p || 0, giorni, piuViste: pagine, oraSu: ora });
  }
  return json({ error: 'non trovato' }, 404);
}

function riassunto(v) { const s = JSON.stringify(v); return s.length > 400 ? s.slice(0, 400) + '…' : v; }
async function sessione(d, email, request, extra) {
  const tok = casuale(32);
  await d.batch([
    d.prepare('INSERT INTO sessioni(token,email,scade,creato,ua) VALUES(?,?,?,?,?)').bind(await sha(tok), email, Date.now() + 30 * 86400_000, Date.now(), (request.headers.get('user-agent') || '').slice(0, 200)),
    d.prepare('DELETE FROM sessioni WHERE scade < ?').bind(Date.now()),
    d.prepare('UPDATE utenti SET ultimo=? WHERE email=?').bind(Date.now(), email),
  ]);
  return new Response(JSON.stringify({ ok: true, ...extra }), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'set-cookie': cookieSessione(tok) } });
}

// Gli operatori non possono cambiare i prezzi: qualunque prezzo modificato da loro torna com'era.
// Magazzino: prezzo listino e prezzo sul sito. Schede: prezzo dei ricambi già presenti (i nuovi prendono quello del magazzino) e sconto ricambi.
// Ordini: prezzo delle righe già presenti e sconto.
const CAMPI_PREZZO = ['prezzo', 'prezzoSito', 'prezzoSitoAt', 'prezzoManuale'];
async function bloccaPrezzi(d, c, prima, dopo) {
  if (c === 'mag' && dopo.items && typeof dopo.items === 'object') {
    for (const k of Object.keys(dopo.items)) {
      const n = dopo.items[k], v = prima?.items?.[k];
      if (!n || typeof n !== 'object') continue;
      for (const f of CAMPI_PREZZO) { if (v && v[f] !== undefined) n[f] = v[f]; else delete n[f]; }
    }
  }
  const righe = (lista, vecchie) => {
    if (!Array.isArray(lista)) return [];
    const pv = new Map((Array.isArray(vecchie) ? vecchie : []).map((r) => [String(r?.codice || '').toUpperCase(), r?.prezzo]));
    const nuove = [];
    for (const r of lista) {
      if (!r || typeof r !== 'object') continue;
      const k = String(r.codice || '').toUpperCase();
      if (k && pv.has(k)) r.prezzo = pv.get(k); else if (k) nuove.push(r);
    }
    return nuove;
  };
  if (c === 'tickets') {
    const nuove = righe(dopo.ricambi, prima?.ricambi);
    for (const r of nuove) { const pz = await prezzoMag(d, r.codice); if (pz > 0) r.prezzo = pz; }
    if (prima) dopo.scontoRic = prima.scontoRic ?? 0;
  }
  if (c === 'ordiniWeb' && prima) {
    righe(dopo.righe, prima.righe);
    dopo.sconto = prima.sconto ?? 0;
  }
}
async function prezzoMag(d, codice) {
  const r = await d.prepare(`SELECT json_extract(j.value,'$.prezzo') p FROM docs, json_each(docs.d,'$.items') j
    WHERE docs.c='mag' AND upper(json_extract(j.value,'$.codice'))=? LIMIT 1`).bind(String(codice).toUpperCase()).first().catch(() => null);
  return Number(r?.p) || 0;
}
