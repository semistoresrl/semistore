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
//  POST ai {compito,img?,testo?}  → intelligenza artificiale (Claude con ANTHROPIC_API_KEY, altrimenti Workers AI)
import { gdb, json, utente, sha, casuale, cookieSessione, cookieVia, fondi, differenza, mandaEmail, giornoIT } from '../../_lib/gestione.js';
import { riprovaRicostruzione } from '../../_lib/ricostruzione.js';

const MAX_FILE = 1_900_000;
const nuovoId = () => casuale(10);

export async function onRequest(ctx) {
  try { return await gestisci(ctx); }
  catch (e) { // errore leggibile invece della pagina di Cloudflare
    const msg = String(e && (e.message || e) || 'errore');
    console.error('gestione', ctx.params?.p, msg);
    return json({ error: /daily row write limit/i.test(msg) ? 'Il database ha finito le scritture gratuite di oggi (piano gratuito Cloudflare): si riattiva all\'01:00, oppure subito passando al piano Workers Paid.' : /SQLITE_FULL|maximum|too big|size limit/i.test(msg) ? 'Database pieno: ' + msg : 'Errore del server: ' + msg.slice(0, 300) }, 500);
  }
}
async function gestisci(ctx) {
  const { request, env, params } = ctx;
  const p = (params.p || []).join('/');
  const m = request.method;
  if (!env.DB) return json({ error: 'database non collegato' }, 503);
  const d = await gdb(env);
  const body = m === 'POST' && p !== 'file' ? await request.json().catch(() => ({})) : null;
  const io = await utente(request, env);

  if (p === 'io') {
    const n = (await d.prepare('SELECT COUNT(*) n FROM utenti').first()).n;
    if (io) await d.prepare('UPDATE utenti SET ultimo=? WHERE email=?').bind(Date.now(), io.email).run().catch(() => {}); // se il database non accetta scritture si entra lo stesso in sola lettura
    return json({ utente: io, primoAvvio: n === 0, email: !!env.RESEND_API_KEY, mittente: !!env.EMAIL_FROM, ai: !!(env.ANTHROPIC_API_KEY || env.AI) });
  }
  // prova dell'API Conversions di Meta (solo admin): manda un evento di prova a «Testa gli eventi» e restituisce la risposta di Meta
  if (p === 'metatest' && m === 'POST') {
    if (!io || io.ruolo !== 'admin') return json({ error: 'solo amministratore' }, 403);
    if (!env.META_CAPI_TOKEN) return json({ error: 'META_CAPI_TOKEN non impostato' }, 400);
    const ev = { event_name: 'PageView', event_time: Math.floor(Date.now() / 1000), event_id: 'prova-' + Date.now(), action_source: 'website',
      event_source_url: 'https://semistore.it/', user_data: { client_ip_address: request.headers.get('cf-connecting-ip') || undefined, client_user_agent: request.headers.get('user-agent') || undefined } };
    const q = { data: [ev], access_token: env.META_CAPI_TOKEN };
    if (body && body.codice) q.test_event_code = String(body.codice).slice(0, 40);
    const r = await fetch('https://graph.facebook.com/v21.0/2053772285330509/events', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(q) });
    return json({ stato: r.status, meta: await r.json().catch(() => null) });
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

  // 26/11: intelligenza artificiale dell'app. Usa Claude se su Cloudflare c'è ANTHROPIC_API_KEY,
  // altrimenti Workers AI di Cloudflare (binding "AI", senza chiavi). Senza nessuno dei due l'app lavora come prima.
  //  POST ai {compito:'preventivo', img? , testo?}  → {modello,type,posizioni,codici,pezzi,dubbi}
  //  POST ai {compito:'trascrivi', img}             → {testo}   (etichette, documenti, biglietti)
  //  POST ai {compito:'risposta', testo, istruzioni?} → {testo}  (bozza di risposta a un'email)
  if ((p === 'ai' || p === 'leggi-foto') && m === 'POST') {
    if (!env.ANTHROPIC_API_KEY && !env.AI) return json({ error: 'intelligenza artificiale non attiva' }, 501);
    const compito = p === 'leggi-foto' ? 'preventivo' : String(body.compito || '');
    const img = String(body.img || '').replace(/^data:image\/\w+;base64,/, '');
    const testo = String(body.testo || '').slice(0, 20000);
    if (img.length > 4_500_000) return json({ error: 'foto troppo grande' }, 400);
    const P = {
      preventivo: `Questa è una richiesta di preventivo per un centro assistenza DEWALT, STANLEY e BLACK+DECKER. Può essere: un esploso ricambi (disegno con numeri di posizione) con i pezzi segnati dal cliente (evidenziatore, cerchi, frecce, spunte); un biglietto o un elenco scritto a penna; un messaggio WhatsApp o email; una targhetta o un'etichetta; un elenco stampato.
Rispondi SOLO con un oggetto JSON, senza altro testo:
{"modello":"codice del modello dell'utensile se scritto (es. DCH273), altrimenti stringa vuota","type":"numero del Type se scritto, altrimenti stringa vuota","posizioni":["numeri di posizione dell'esploso SEGNATI o richiesti, come scritti"],"codici":[{"codice":"codice ricambio o prodotto scritto (es. N463936, 590306-00, DCB184)","qty":1}],"pezzi":[{"testo":"pezzo chiesto a parole senza codice né posizione, in italiano (es. motore, carboncini, molla)","qty":1}],"dubbi":"cosa non si legge bene, in italiano, oppure stringa vuota"}
In un esploso metti in "posizioni" solo i numeri segnati dal cliente, non tutti quelli del disegno. Leggi con cura la scrittura a mano: cifre e lettere dei codici devono essere esatte; se non sei sicuro scrivi la lettura più probabile e spiegalo in "dubbi". Le quantità scritte (2x, n. 3, 3 pz) vanno in qty.`,
      trascrivi: `Trascrivi fedelmente tutto il testo di questa foto (etichetta, documento, bolla, fattura, biglietto, anche scritto a mano), riga per riga, nell'ordine in cui si legge. Nelle tabelle tieni ogni riga della tabella su una riga e separa le colonne con tre spazi. Non tradurre, non correggere, non aggiungere commenti: rispondi solo con il testo.`,
      zona: `Questo è un piccolo ritaglio di un esploso ricambi: contiene un numero di posizione (a volte due numeri uno sopra l'altro) segnato con l'evidenziatore. Rispondi SOLO con i numeri che leggi, separati da uno spazio, dall'alto in basso. Niente altro testo. Se non leggi nessun numero rispondi con un trattino.`,
      risposta: `Sei l'assistente di SE.M.I. S.R.L. (Semi Store), concessionario DEWALT, STANLEY e BLACK+DECKER e centro assistenza autorizzato a Casavatore (NA). Scrivi in italiano una bozza di risposta cortese, chiara e breve all'email qui sotto, dando del Lei. Non inventare prezzi, disponibilità, date o impegni che non sono scritti: dove servono, metti [DA COMPLETARE: …]. Chiudi con «Cordiali saluti» e nient'altro dopo: la firma si aggiunge da sola. Rispondi solo con il testo della risposta.${body.istruzioni ? '\nIndicazioni di chi risponde: ' + String(body.istruzioni).slice(0, 1000) : ''}`,
    }[compito];
    if (!P) return json({ error: 'compito sconosciuto' }, 400);
    if (compito !== 'risposta' && !img && !testo) return json({ error: 'foto o testo mancanti' }, 400);
    const domanda = P + (testo ? '\n\n---\n' + testo : '');
    let out = '';
    try {
      if (env.ANTHROPIC_API_KEY) {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5', max_tokens: 3000,
            messages: [{ role: 'user', content: [...(img ? [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img } }] : []), { type: 'text', text: domanda }] }] }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) return json({ error: 'AI non riuscita: ' + (j.error?.message || r.status) }, 502);
        out = (j.content || []).map((c) => c.text || '').join('');
      } else {
        const r = await env.AI.run(env.AI_MODEL || '@cf/meta/llama-4-scout-17b-16e-instruct', {
          messages: [{ role: 'user', content: [{ type: 'text', text: domanda }, ...(img ? [{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + img } }] : [])] }],
          max_tokens: 3000, temperature: 0.1,
        });
        out = typeof r?.response === 'string' ? r.response : r?.response ? JSON.stringify(r.response) : String(r?.result?.response || '');
      }
    } catch (e) { return json({ error: 'AI non riuscita: ' + String(e?.message || e).slice(0, 200) }, 502); }
    if (compito === 'risposta') out = out.replace(/\n*\[(non aggiungere|firma)[^\]]*\]\s*$/i, '').trim();
    if (compito !== 'preventivo') return json({ testo: out.trim(), fonte: env.ANTHROPIC_API_KEY ? 'claude' : 'cloudflare' });
    let o = {}; try { const mm = out.match(/\{[\s\S]*\}/); o = mm ? JSON.parse(mm[0]) : {}; } catch (e) { o = {}; }
    return json({
      fonte: env.ANTHROPIC_API_KEY ? 'claude' : 'cloudflare',
      modello: String(o.modello || '').trim().toUpperCase(), type: String(o.type || '').replace(/\D/g, ''),
      posizioni: (Array.isArray(o.posizioni) ? o.posizioni : []).map((x) => String(x).trim()).filter(Boolean).slice(0, 200),
      codici: (Array.isArray(o.codici) ? o.codici : []).map((c) => ({ codice: String(c?.codice || c || '').trim().toUpperCase(), qty: Number(c?.qty) || 1 })).filter((c) => c.codice).slice(0, 200),
      pezzi: (Array.isArray(o.pezzi) ? o.pezzi : []).map((x) => ({ testo: String(x?.testo || x || '').trim().slice(0, 80), qty: Number(x?.qty) || 1 })).filter((x) => x.testo).slice(0, 100),
      dubbi: String(o.dubbi || '').slice(0, 500),
    });
  }

  if (p === 'db' && m === 'GET') {
    const since = Number(new URL(request.url).searchParams.get('since') || 0);
    if (ctx.waitUntil) ctx.waitUntil(riprovaRicostruzione(env).catch(() => {}));
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
      const ruolo = ['admin', 'contabilita'].includes(body.ruolo) ? body.ruolo : 'operatore', nome = String(body.nome || '').trim() || email;
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
  // STORICO PER CODICE (26/11): righe dei documenti Danea (vendite, DDT, fatture, rapporti d'intervento, arrivi, preventivi)
  if (p === 'storicoart') {
    if (!io) return json({ error: 'non autorizzato' }, 401);
    try { await d.batch([
      d.prepare(`CREATE TABLE IF NOT EXISTS storico_art (cod TEXT NOT NULL, base TEXT NOT NULL, tipo TEXT, data TEXT, num TEXT, cli TEXT, nome TEXT,
        qta REAL, prezzo REAL, sconti TEXT, tot REAL, descr TEXT)`),
      d.prepare('CREATE INDEX IF NOT EXISTS sa_base ON storico_art(base)'),
      d.prepare('CREATE INDEX IF NOT EXISTS sa_cli ON storico_art(cli)'),
      d.prepare('CREATE TABLE IF NOT EXISTS storico_art_info (k TEXT PRIMARY KEY, v TEXT)'),
    ]); } catch (e) { if (!/write limit|read.?only/i.test(String(e && e.message))) throw e; /* scritture finite per oggi: le tabelle ci sono già */ }
    const baseDi = c => String(c || '').trim().toUpperCase().replace(/-(QW|XJ|QS|QZ|XE|GB|LX|KR|QT|B5|B3|BL|DE|FR|IT|EU|SFDPS)$/, '');
    if (m === 'POST') {
      if (io.ruolo !== 'admin') return json({ error: 'solo amministratore' }, 403);
      const b = body || {};
      if (b.reset) await d.prepare('DELETE FROM storico_art').run();
      const righe = Array.isArray(b.righe) ? b.righe.slice(0, 900) : [];
      const st = [];
      for (let i = 0; i < righe.length; i += 8) {
        const blocco = righe.slice(i, i + 8), vals = [], arg = [];
        for (const r of blocco) { vals.push('(?,?,?,?,?,?,?,?,?,?,?,?)'); const cod = String(r[0] || '').toUpperCase().slice(0, 40);
          arg.push(cod, baseDi(cod), String(r[1] || '').slice(0, 2), String(r[2] || '').slice(0, 10), String(r[3] || '').slice(0, 30), String(r[4] || '').slice(0, 20), String(r[5] || '').slice(0, 120),
            Number(r[6]) || 0, Number(r[7]) || 0, String(r[8] || '').slice(0, 30), Number(r[9]) || 0, String(r[10] || '').slice(0, 80)); }
        st.push(d.prepare('INSERT INTO storico_art (cod,base,tipo,data,num,cli,nome,qta,prezzo,sconti,tot,descr) VALUES ' + vals.join(',')).bind(...arg));
      }
      if (b.info) st.push(d.prepare('INSERT OR REPLACE INTO storico_art_info (k,v) VALUES (?,?)').bind('info', JSON.stringify(b.info)));
      if (st.length) await d.batch(st);
      return json({ ok: true, n: righe.length });
    }
    const u = new URL(request.url), c = u.searchParams.get('c'), q = u.searchParams.get('q');
    if (c) {
      const righe = (await d.prepare('SELECT cod,tipo,data,num,cli,nome,qta,prezzo,sconti,tot,descr FROM storico_art WHERE base=? ORDER BY data DESC LIMIT 20000').bind(baseDi(c)).all()).results;
      const soldi = io.ruolo === 'admin' || io.ruolo === 'contabilita';
      if (!soldi) for (const r of righe) { r.prezzo = null; r.sconti = ''; r.tot = null; }
      return json({ righe, soldi });
    }
    if (q) {
      const t = String(q).trim().toUpperCase();
      const r = (await d.prepare("SELECT cod, MAX(descr) descr, COUNT(*) n FROM storico_art WHERE cod LIKE ? OR UPPER(descr) LIKE ? GROUP BY cod ORDER BY n DESC LIMIT 30").bind(t + '%', '%' + t + '%').all()).results;
      return json({ codici: r });
    }
    const info = await d.prepare("SELECT v FROM storico_art_info WHERE k='info'").first();
    const n = (await d.prepare('SELECT COUNT(*) n FROM storico_art').first()).n;
    return json({ righe: n, info: info ? JSON.parse(info.v) : null });
  }
  // ARCHIVIO DOCUMENTI DANEA (26/11): rapporti d'intervento, DDT, fatture e note storiche. Tutti consultano, importi solo all'amministratore.
  if (p === 'storicodoc') {
    if (!io) return json({ error: 'non autorizzato' }, 401);
    try { await d.batch([
      d.prepare(`CREATE TABLE IF NOT EXISTS storico_doc (id TEXT PRIMARY KEY, k TEXT, anno TEXT, n TEXT, d TEXT, cli TEXT, nm TEXT, txt TEXT, j TEXT)`),
      d.prepare('CREATE INDEX IF NOT EXISTS sd_cli ON storico_doc(cli)'),
      d.prepare('CREATE INDEX IF NOT EXISTS sd_d ON storico_doc(d)'),
      d.prepare('CREATE TABLE IF NOT EXISTS storico_doc_info (k TEXT PRIMARY KEY, v TEXT)'),
    ]); } catch (e) { if (!/write limit|read.?only/i.test(String(e && e.message))) throw e; /* scritture finite per oggi: le tabelle ci sono già */ }
    const vedeSoldi = admin || io.ruolo === 'contabilita';
    const pulisci = (x) => {
      if (vedeSoldi) return x;
      const y = { ...x }; delete y.imp; delete y.iva; delete y.tot; delete y.pg;
      y.r = (x.r || []).map(r => [r[0], r[1], r[2]]);
      return y;
    };
    const breve = (x) => { const u = (x.r || []).find(r => r[0] && !/^(MAN|RIP|GAR|TRASP|SPESE)$/i.test(r[0])) || (x.r || [])[0];
      const o = { i: x.i, k: x.k, n: x.n, d: x.d, cli: x.cli, nm: x.nm, inc: x.inc || '', ncmp: (x.cmp || []).length, acc: x.acc || '', esi: x.esi || '', dif: x.dif || '', u: u ? [u[0], u[1]] : null, nr: (x.r || []).length };
      if (vedeSoldi) o.tot = x.tot; return o; };
    if (m === 'POST') {
      if (!admin) return json({ error: 'solo amministratore' }, 403);
      const b = body || {};
      if (b.reset) await d.prepare('DELETE FROM storico_doc').run();
      const docs = Array.isArray(b.docs) ? b.docs.slice(0, 400) : [];
      const st = docs.map(x => {
        const txt = [x.i, x.n, x.nm, x.pi, x.cli, x.acc, x.esi, x.dif, x.acq, x.note, ...(x.r || []).map(r => r[0] + ' ' + r[1])].join(' ').toUpperCase();
        return d.prepare('INSERT OR REPLACE INTO storico_doc (id,k,anno,n,d,cli,nm,txt,j) VALUES (?,?,?,?,?,?,?,?,?)')
          .bind(String(x.i).slice(0, 40), String(x.k || ''), String(x.d || '').slice(0, 4), String(x.n || ''), String(x.d || '').slice(0, 10), String(x.cli || ''), String(x.nm || '').slice(0, 160), txt, JSON.stringify(x));
      });
      if (b.info) st.push(d.prepare('INSERT OR REPLACE INTO storico_doc_info (k,v) VALUES (?,?)').bind('info', JSON.stringify(b.info)));
      for (let i = 0; i < st.length; i += 50) await d.batch(st.slice(i, i + 50));
      return json({ ok: true, n: docs.length });
    }
    const u = new URL(request.url), sp = u.searchParams;
    const id = sp.get('id');
    if (id) {
      const r = await d.prepare('SELECT j FROM storico_doc WHERE id=?').bind(id).first();
      if (!r) return json({ error: 'non trovato' }, 404);
      const x = JSON.parse(r.j);
      const legati = [x.inc, ...(x.cmp || [])].filter(Boolean);
      let rel = [];
      if (legati.length) rel = (await d.prepare(`SELECT j FROM storico_doc WHERE id IN (${legati.slice(0, 60).map(() => '?').join(',')})`).bind(...legati.slice(0, 60)).all()).results.map(z => breve(JSON.parse(z.j)));
      return json({ doc: pulisci(x), legati: rel, soldi: vedeSoldi });
    }
    const cli = sp.get('cli'), q = (sp.get('q') || '').trim().toUpperCase(), k = sp.get('k') || '', anno = sp.get('anno') || '';
    const off = Math.max(0, Number(sp.get('off')) || 0), lim = Math.min(200, Number(sp.get('lim')) || 60);
    if (cli || q || k || anno) {
      const w = [], a = [];
      if (cli) { w.push('cli=?'); a.push(cli); }
      if (k) { w.push('k=?'); a.push(k); }
      if (anno) { w.push('anno=?'); a.push(anno); }
      if (q) for (const t of q.split(/\s+/).filter(Boolean).slice(0, 5)) { w.push('(txt LIKE ? OR n=?)'); a.push('%' + t + '%', t); }
      const wh = w.length ? 'WHERE ' + w.join(' AND ') : '';
      const n = (await d.prepare(`SELECT COUNT(*) n FROM storico_doc ${wh}`).bind(...a).first()).n;
      const r = (await d.prepare(`SELECT j FROM storico_doc ${wh} ORDER BY d DESC, id DESC LIMIT ? OFFSET ?`).bind(...a, lim, off).all()).results;
      return json({ n, docs: r.map(z => breve(JSON.parse(z.j))), soldi: vedeSoldi });
    }
    const info = await d.prepare("SELECT v FROM storico_doc_info WHERE k='info'").first();
    const per = (await d.prepare('SELECT k, anno, COUNT(*) n FROM storico_doc GROUP BY k, anno').all()).results;
    return json({ info: info ? JSON.parse(info.v) : null, per, soldi: vedeSoldi });
  }
  // AFFIDABILITÀ CLIENTI (26/11): rating OpenAPI.it per P.IVA, controllo protesti per P.IVA o C.F. (vedi _lib/affidabilita.js)
  if (p === 'affid' || p.startsWith('affid/')) {
    const A = await import('../../_lib/affidabilita.js');
    const { segreto } = await import('../../_lib/posta.js');
    const sub = p.slice(6);
    try {
      if (sub === 'chiave') {
        if (!admin) return json({ error: 'solo amministratore' }, 403);
        const cfg = (await A.config(env)) || {};
        if (m === 'GET') return json({ configurata: !!cfg.token, sandbox: !!cfg.sandbox, auto: cfg.auto !== false, soloAdmin: !!cfg.soloAdmin, at: cfg.at || null, fine: cfg.token ? '…' + cfg.token.slice(-4) : '' });
        if (body.togli) { await segreto(env, 'openapi_risk', null); return json({ ok: true }); }
        const nuovo = { ...cfg, sandbox: !!body.sandbox, auto: body.auto !== false, soloAdmin: !!body.soloAdmin, at: Date.now() };
        if (body.token) { const t = String(body.token).trim(); if (t.length < 20 || /\s/.test(t)) return json({ error: 'La chiave non sembra giusta: copia tutto il token da console.openapi.com' }, 400); nuovo.token = t; }
        if (!nuovo.token) return json({ error: 'Incolla la chiave (token) di OpenAPI' }, 400);
        await segreto(env, 'openapi_risk', nuovo);
        await d.prepare('INSERT INTO registro(at,chi,nome,c,docid,op,d) VALUES(?,?,?,?,?,?,?)').bind(Date.now(), io.email, io.nome, 'impostazioni', 'openapi', 'chiave', JSON.stringify({ sandbox: nuovo.sandbox, auto: nuovo.auto, soloAdmin: nuovo.soloAdmin, chiave: body.token ? 'cambiata' : 'invariata' })).run();
        return json({ ok: true });
      }
      if (sub === 'tutti' && m === 'GET') return json({ chiavi: await A.riepilogo(env) });
      if (m === 'GET') {
        const k = String(new URL(request.url).searchParams.get('k') || '').toUpperCase().replace(/^IT/, '').replace(/[^A-Z0-9]/g, '');
        if (!A.chiaveValida(k)) return json({ error: 'P.IVA o C.F. non valido' }, 400);
        const cfg = await A.config(env);
        return json({ k, dati: await A.aggiornaAttese(env, k), configurata: !!cfg?.token, puoChiedere: !!cfg?.token && (admin || !cfg.soloAdmin), validita: A.VALIDITA });
      }
      if (m === 'POST') {
        const cfg = await A.config(env);
        if (cfg?.soloAdmin && !admin) return json({ error: 'Solo l\'amministratore può chiedere i rating' }, 403);
        const forza = !!body.forza && admin;
        const dati = await A.chiedi(env, body.k, String(body.servizio || 'advanced'), io.nome, { forza });
        if (!dati._cache) await d.prepare('INSERT INTO registro(at,chi,nome,c,docid,op,d) VALUES(?,?,?,?,?,?,?)').bind(Date.now(), io.email, io.nome, 'affidabilita', String(body.k || ''), 'chiedi', JSON.stringify({ servizio: body.servizio, cliente: String(body.nome || '').slice(0, 80) })).run();
        return json({ ok: true, dati });
      }
    } catch (e) { return json({ error: e.message || 'errore' }, e.status && e.status < 600 ? (e.status === 402 ? 402 : e.status) : 500); }
    return json({ error: 'non trovato' }, 404);
  }
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
