// Account clienti. Rotte:
// POST /api/account/link     {email, dopo}  → invia il link di accesso (crea l'account al primo clic)
// GET  /api/account/entra?t=…&dopo=…        → apre la sessione e rimanda alla pagina richiesta
// GET  /api/account/io                        → profilo, punti, ordini, sconti (401 se non collegato)
// POST /api/account/profilo  {…}             → salva il profilo (privato o partita IVA)
// POST /api/account/esci                      → chiude la sessione
// POST /api/account/elimina                   → elimina l'account (gli ordini restano per obblighi fiscali)
import {
  dbc, cliente, json, normEmail, EMAIL_OK, linkAccesso, email as inviaEmail, cornice, bottone, hash,
  trovaOCrea, nuovaSessione, cookieSessione, cookieVia, profilo, COOKIE,
} from '../../_lib/clienti.js';
import { SITO } from '../../../src/data/sito.js';
import { pivaValida, cercaPiva } from '../../_lib/piva.js';
import { livelloDi } from '../../../src/lib/punti.js';
import { dbb } from '../../_lib/buoni.js';

export async function onRequest(ctx) {
  const { request, env, params } = ctx;
  if (!env.DB) return json({ error: 'Account non ancora attivi.' }, 503);
  const via = (params.p || []).join('/');
  const m = request.method;
  try {
    if (via === 'link' && m === 'POST') return await link(ctx);
    if (via === 'entra' && m === 'GET') return await entra(ctx);
    if (via === 'io' && m === 'GET') return await io(ctx);
    if (via === 'profilo' && m === 'POST') return await salva(ctx);
    if (via === 'esci' && m === 'POST') return await esci(ctx);
    if (via === 'elimina' && m === 'POST') return await elimina(ctx);
  } catch (e) { console.error('account', e); return json({ error: 'Errore momentaneo, riprova tra poco.' }, 500); }
  return json({ error: 'non trovato' }, 404);
}

async function link({ request, env }) {
  let b; try { b = await request.json(); } catch { return json({ error: 'richiesta non valida' }, 400); }
  const em = normEmail(b.email);
  if (!EMAIL_OK.test(em) || em.length > 120) return json({ error: 'Inserisci un indirizzo email valido.' }, 400);
  // limiti: 5 link l'ora per email, 20 l'ora per connessione
  if (env.RICHIESTE) {
    const ip = request.headers.get('cf-connecting-ip') || 'x';
    const [ne, ni] = await Promise.all([env.RICHIESTE.get('acc-e:' + em), env.RICHIESTE.get('acc-i:' + ip)]);
    if (Number(ne) >= 5 || Number(ni) >= 20) return json({ error: 'Troppe richieste: riprova tra un\'ora o controlla l\'email che ti abbiamo già mandato.' }, 429);
    await Promise.all([
      env.RICHIESTE.put('acc-e:' + em, String(Number(ne || 0) + 1), { expirationTtl: 3600 }),
      env.RICHIESTE.put('acc-i:' + ip, String(Number(ni || 0) + 1), { expirationTtl: 3600 }),
    ]);
  }
  const origin = new URL(request.url).origin;
  const url = await linkAccesso(env, origin, em, b.dopo);
  const ok = await inviaEmail(env, {
    a: em,
    oggetto: 'Il tuo link per entrare in Semi Store',
    html: cornice('Entra nel tuo account', `<p style="margin:0 0 18px">Premi il pulsante per entrare in Semi Store con <b>${em.replace(/</g, '')}</b>. Se non hai ancora un account lo creiamo adesso: ci vuole un attimo.</p>
      ${bottone(url, 'Entra in Semi Store')}
      <p style="margin:16px 0 0;font-size:13px;color:#5c5f65">Il link vale 30 minuti e si usa una volta. Se non l'hai chiesto tu, ignora questa email.</p>`),
    testo: `Entra in Semi Store con ${em}: ${url}\n\nIl link vale 30 minuti e si usa una volta. Se non l'hai chiesto tu, ignora questa email.`,
  });
  if (!ok) return json({ error: 'Non riusciamo a inviare l\'email ora. Riprova tra poco o scrivici su WhatsApp.' }, 502);
  return json({ ok: true });
}

async function entra({ request, env }) {
  const u = new URL(request.url);
  const t = u.searchParams.get('t') || '';
  let dopo = u.searchParams.get('dopo') || '/account/';
  if (!dopo.startsWith('/') || dopo.startsWith('//')) dopo = '/account/';
  const d = await dbc(env);
  const a = t && await d.prepare('SELECT * FROM accessi WHERE h=?').bind(await hash(t)).first();
  if (!a || a.scade < Date.now() || (a.usato && !a.riusabile)) {
    return Response.redirect(`${u.origin}/account/?link=scaduto&dopo=${encodeURIComponent(dopo)}`, 302);
  }
  if (!a.riusabile) await d.prepare('UPDATE accessi SET usato=1 WHERE h=?').bind(a.h).run();
  const c = await trovaOCrea(env, a.email);
  const s = await nuovaSessione(env, c.id);
  // profilo da completare (prima volta): si passa dalla scheda di registrazione, poi si torna dove si voleva andare
  const dest = c.tipo ? dopo : `/account/?benvenuto=1&dopo=${encodeURIComponent(dopo)}`;
  return new Response(null, { status: 302, headers: { location: u.origin + dest, 'set-cookie': cookieSessione(s), 'cache-control': 'no-store' } });
}

async function io({ request, env }) {
  const c = await cliente(request, env);
  if (!c) return json({ collegato: false }, 401);
  const d = await dbb(env);
  const st = await d.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(COALESCE(base, totale - spedizione)),0) AS spesa FROM ordini WHERE cliente=? AND quando>=?').bind(c.id, SITO.punti.inizio).first();
  const spesa = Number(st?.spesa || 0);
  const [ordini, movimenti] = await Promise.all([
    d.prepare('SELECT sessione, totale, spedizione, punti, fattura, consegna, righe, quando FROM ordini WHERE cliente=? ORDER BY quando DESC LIMIT 30').bind(c.id).all(),
    d.prepare('SELECT delta, motivo, quando FROM punti_mov WHERE cliente=? ORDER BY quando DESC LIMIT 50').bind(c.id).all(),
  ]);
  // sconti del minigioco legati a questa email
  const sconti = [];
  if (env.RICHIESTE) {
    const l = await env.RICHIESTE.list({ prefix: `premio-mese:${c.email}:` });
    for (const k of l.keys) {
      const codice = await env.RICHIESTE.get(k.name);
      const v = codice && await env.RICHIESTE.get('premio:' + codice, 'json');
      if (v) sconti.push({ codice, mese: k.name.split(':').pop(), scade: v.scade, usato: !!v.pagato });
    }
  }
  return json({
    collegato: true, profilo: profilo(c),
    punti: { saldo: c.punti, perEuro: SITO.punti.perEuro, movimenti: movimenti.results, spesa, ordini: Number(st?.n || 0), livello: livelloDi(spesa) },
    ordini: ordini.results.map((o) => ({ ...o, righe: safe(o.righe), id: o.sessione.slice(-8).toUpperCase(), sessione: undefined })),
    sconti: sconti.sort((a, b) => b.mese.localeCompare(a.mese)),
  });
}
const safe = (s) => { try { return JSON.parse(s || '[]'); } catch { return []; } };

const pulisci = (v, n = 120) => String(v ?? '').replace(/[<>]/g, '').trim().slice(0, n);

async function salva({ request, env }) {
  const c = await cliente(request, env);
  if (!c) return json({ error: 'Sessione scaduta: entra di nuovo.' }, 401);
  let b; try { b = await request.json(); } catch { return json({ error: 'richiesta non valida' }, 400); }
  const tipo = b.tipo === 'azienda' ? 'azienda' : 'privato';
  const r = {
    tipo, telefono: pulisci(b.telefono, 30), offerte: b.offerte ? 1 : 0,
    nome: pulisci(b.nome, 60), cognome: pulisci(b.cognome, 60), cf: pulisci(b.cf, 16).toUpperCase(),
    ragione_sociale: null, piva: null, sdi: null, pec: null,
    indirizzo: pulisci(b.indirizzo, 120), cap: pulisci(b.cap, 5), citta: pulisci(b.citta, 60), provincia: pulisci(b.provincia, 2).toUpperCase(),
  };
  if (r.telefono && !/^\+?[0-9 ]{6,20}$/.test(r.telefono)) return json({ error: 'Il numero di telefono non sembra corretto.' }, 400);
  if (r.cap && !/^\d{5}$/.test(r.cap)) return json({ error: 'Il CAP deve avere 5 cifre.' }, 400);
  if (tipo === 'privato') {
    if (!r.nome || !r.cognome) return json({ error: 'Inserisci nome e cognome.' }, 400);
    if (r.cf && !/^[A-Z0-9]{16}$/.test(r.cf)) return json({ error: 'Il codice fiscale deve avere 16 caratteri.' }, 400);
  } else {
    const piva = String(b.piva || '').replace(/\D/g, '');
    if (!pivaValida(piva)) return json({ error: 'La partita IVA non è valida: controlla le 11 cifre.' }, 400);
    r.piva = piva;
    r.sdi = pulisci(b.sdi, 7).toUpperCase() || null;
    r.pec = pulisci(b.pec, 120).toLowerCase() || null;
    if (r.sdi && !/^[A-Z0-9]{7}$/.test(r.sdi)) return json({ error: 'Il codice destinatario SDI ha 7 caratteri.' }, 400);
    if (r.pec && !EMAIL_OK.test(r.pec)) return json({ error: 'L\'indirizzo PEC non è valido.' }, 400);
    r.ragione_sociale = pulisci(b.ragioneSociale, 120);
    if (!r.ragione_sociale) { // se il browser non l'ha precompilata, la cerco io
      const v = await cercaPiva(env, piva);
      if (v?.ragioneSociale) Object.assign(r, { ragione_sociale: v.ragioneSociale, indirizzo: r.indirizzo || v.indirizzo, cap: r.cap || v.cap, citta: r.citta || v.citta, provincia: r.provincia || v.provincia });
    }
    if (!r.ragione_sociale) return json({ error: 'Inserisci la ragione sociale.' }, 400);
    if (!r.indirizzo || !r.cap || !r.citta) return json({ error: 'Per la fattura servono indirizzo, CAP e città della sede.' }, 400);
  }
  const d = await dbc(env);
  await d.prepare(`UPDATE clienti SET tipo=?, nome=?, cognome=?, telefono=?, cf=?, ragione_sociale=?, piva=?, sdi=?, pec=?,
      indirizzo=?, cap=?, citta=?, provincia=?, offerte=?, aggiornato=? WHERE id=?`)
    .bind(r.tipo, r.nome || null, r.cognome || null, r.telefono || null, r.cf || null, r.ragione_sociale, r.piva, r.sdi, r.pec,
      r.indirizzo || null, r.cap || null, r.citta || null, r.provincia || null, r.offerte, new Date().toISOString(), c.id).run();
  return json({ ok: true, profilo: profilo(await d.prepare('SELECT * FROM clienti WHERE id=?').bind(c.id).first()) });
}

async function esci({ request, env }) {
  const t = (request.headers.get('cookie') || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`))?.[1];
  if (t) await (await dbc(env)).prepare('DELETE FROM csessioni WHERE h=?').bind(await hash(decodeURIComponent(t))).run();
  return json({ ok: true }, 200, { 'set-cookie': cookieVia() });
}

async function elimina({ request, env }) {
  const c = await cliente(request, env);
  if (!c) return json({ error: 'Sessione scaduta: entra di nuovo.' }, 401);
  const d = await dbc(env);
  await d.batch([
    d.prepare('DELETE FROM csessioni WHERE cliente=?').bind(c.id),
    d.prepare('DELETE FROM punti_mov WHERE cliente=?').bind(c.id),
    d.prepare('UPDATE ordini SET cliente=NULL WHERE cliente=?').bind(c.id), // gli ordini restano per gli obblighi fiscali (10 anni)
    d.prepare('DELETE FROM clienti WHERE id=?').bind(c.id),
  ]);
  return json({ ok: true }, 200, { 'set-cookie': cookieVia() });
}
