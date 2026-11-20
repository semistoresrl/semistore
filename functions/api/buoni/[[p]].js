// Buoni Semi Store. Rotte:
// GET  /api/buoni/verifica?codice=…   → { valido, tipo, disponibile, soloPremi, fine }  (max 20 controlli l'ora per connessione)
// POST /api/buoni/acquista {importo, tema, perChi, destinatario, emailDest, messaggio, mittente} → { url } pagamento Stripe
// GET  /api/buoni/miei                → buoni dell'account
// POST /api/buoni/aggiungi {codice}   → collega un buono all'account (poi si usa senza riscrivere il codice)
// POST /api/buoni/converti {punti}    → converte i punti in un buono (dal giorno del catalogo premi)
// POST /api/buoni/rimborso {id}        → recesso: rimborso automatico di un buono regalo comprato da te, entro 14 giorni e mai usato
import { cliente as clienteDi, json, EMAIL_OK, normEmail, aggiungiPunti, email as inviaEmail, cornice } from '../../_lib/clienti.js';
import { dbb, perCodice, disponibile, pubblico, crea } from '../../_lib/buoni.js';
import { SITO } from '../../../src/data/sito.js';
import { catalogoAperto } from '../../../src/lib/punti.js';

const eur = (c) => (c / 100).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });

export async function onRequest(ctx) {
  const { request, env, params } = ctx;
  if (!env.DB) return json({ error: 'Buoni non ancora attivi.' }, 503);
  const via = (params.p || []).join('/'), m = request.method;
  try {
    if (via === 'verifica' && m === 'GET') return await verifica(ctx);
    if (via === 'acquista' && m === 'POST') return await acquista(ctx);
    if (via === 'miei' && m === 'GET') return await miei(ctx);
    if (via === 'aggiungi' && m === 'POST') return await aggiungi(ctx);
    if (via === 'converti' && m === 'POST') return await converti(ctx);
    if (via === 'rimborso' && m === 'POST') return await rimborso(ctx);
  } catch (e) { console.error('buoni', e); return json({ error: 'Errore momentaneo, riprova tra poco.' }, 500); }
  return json({ error: 'non trovato' }, 404);
}

async function limite(request, env, chiave, max) {
  if (!env.RICHIESTE) return true;
  const k = `${chiave}:${request.headers.get('cf-connecting-ip') || 'x'}`;
  const n = Number(await env.RICHIESTE.get(k)) || 0;
  if (n >= max) return false;
  await env.RICHIESTE.put(k, String(n + 1), { expirationTtl: 3600 });
  return true;
}

async function verifica({ request, env }) {
  if (!(await limite(request, env, 'bv', 20))) return json({ error: 'Troppi tentativi: riprova tra un\'ora.' }, 429);
  const b = await perCodice(env, new URL(request.url).searchParams.get('codice'));
  if (!b || b.stato === 'annullato') return json({ valido: false });
  const disp = await disponibile(env, b);
  if (b.tipo === 'punti') { // i buoni punti sono personali: valgono solo nell'account a cui appartengono
    const cl = await clienteDi(request, env);
    if (!cl || cl.id !== b.cliente) return json({ valido: false, personale: true, error: 'Questo buono punti si usa solo entrando nell\'account a cui appartiene.' });
  }
  return json({ valido: disp > 0, esaurito: disp <= 0, tipo: b.tipo, disponibile: disp, soloPremi: b.tipo === 'punti', fine: b.fine });
}

const pulisci = (v, n) => String(v ?? '').replace(/[<>]/g, '').trim().slice(0, n);

async function acquista({ request, env }) {
  if (!env.STRIPE_SECRET_KEY) return json({ error: 'Pagamenti non ancora attivi.' }, 503);
  let b; try { b = await request.json(); } catch { return json({ error: 'richiesta non valida' }, 400); }
  const R = SITO.buoniRegalo;
  const euro = Math.round(Number(b.importo));
  if (!(euro >= R.min && euro <= R.max)) return json({ error: `Scegli un importo tra ${R.min} e ${R.max} €.` }, 400);
  const tema = R.temi.some((t) => t.id === b.tema) ? b.tema : R.temi[0].id;
  const regalo = b.perChi === 'regalo';
  const d = { destinatario: pulisci(b.destinatario, 60), emailDest: normEmail(b.emailDest), messaggio: pulisci(b.messaggio, 300), mittente: pulisci(b.mittente, 60) };
  if (regalo) {
    if (!d.destinatario) return json({ error: 'Scrivi il nome di chi riceve il buono.' }, 400);
    if (d.emailDest && !EMAIL_OK.test(d.emailDest)) return json({ error: 'L\'email di chi riceve il buono non è valida.' }, 400);
  }
  const cl = await clienteDi(request, env).catch(() => null);
  const origin = new URL(request.url).origin;
  const f = new URLSearchParams();
  f.set('mode', 'payment'); f.set('locale', 'it');
  f.set('success_url', `${origin}/buono-regalo/?ok={CHECKOUT_SESSION_ID}`);
  f.set('cancel_url', `${origin}/buono-regalo/`);
  f.set('line_items[0][quantity]', '1');
  f.set('line_items[0][price_data][currency]', 'eur');
  f.set('line_items[0][price_data][unit_amount]', String(euro * 100));
  f.set('line_items[0][price_data][product_data][name]', `Buono regalo Semi Store ${euro} €`);
  f.set('line_items[0][price_data][product_data][description]', regalo ? `Per ${d.destinatario} · senza scadenza, su tutto semistore.it` : 'Senza scadenza, su tutto semistore.it');
  f.set('metadata[tipo]', 'buono_regalo');
  f.set('metadata[tema]', tema);
  f.set('metadata[per]', regalo ? 'regalo' : 'me');
  for (const [k, v] of Object.entries(d)) if (v) f.set(`metadata[${k}]`, v);
  f.set('payment_intent_data[description]', `Buono regalo ${euro} € (buono multiuso)`);
  if (cl) { f.set('customer_email', cl.email); f.set('payment_intent_data[receipt_email]', cl.email); f.set('metadata[cliente]', cl.id); }
  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded' }, body: f });
  const s = await r.json();
  if (!r.ok) { console.error('Stripe buono', s.error?.message); return json({ error: 'Pagamento non disponibile ora, riprova.' }, 502); }
  return json({ url: s.url });
}

async function miei({ request, env }) {
  const cl = await clienteDi(request, env);
  if (!cl) return json({ error: 'non collegato' }, 401);
  const d = await dbb(env);
  const l = (await d.prepare("SELECT * FROM buoni WHERE cliente=? AND stato<>'annullato' ORDER BY creato DESC").bind(cl.id).all()).results;
  const out = [];
  for (const b of l) out.push(pubblico(b, await disponibile(env, b)));
  // buoni regalo comprati da questo account (anche se regalati): stato e rimborso entro 14 giorni se mai usati
  const acq = (await d.prepare("SELECT * FROM buoni WHERE tipo='regalo' AND acquirente=? ORDER BY creato DESC LIMIT 30").bind(cl.email).all()).results;
  const acquistati = [];
  for (const b of acq) {
    const disp = await disponibile(env, b);
    acquistati.push({ ...pubblico(b, disp), rimborsabile: rimborsabile(b, disp) });
  }
  return json({ buoni: out, acquistati });
}

async function aggiungi({ request, env }) {
  const cl = await clienteDi(request, env);
  if (!cl) return json({ error: 'Entra nel tuo account per aggiungere un buono.' }, 401);
  if (!(await limite(request, env, 'bv', 20))) return json({ error: 'Troppi tentativi: riprova tra un\'ora.' }, 429);
  let b; try { b = await request.json(); } catch { return json({ error: 'richiesta non valida' }, 400); }
  const v = await perCodice(env, b.codice);
  if (!v || v.stato === 'annullato') return json({ error: 'Codice non valido: controlla di averlo scritto bene.' }, 404);
  if (v.cliente && v.cliente !== cl.id) return json({ error: 'Questo buono è già registrato su un altro account.' }, 409);
  if (!v.cliente) await (await dbb(env)).prepare('UPDATE buoni SET cliente=? WHERE id=? AND cliente IS NULL').bind(cl.id, v.id).run();
  return json({ ok: true, buono: pubblico({ ...v, cliente: cl.id }, await disponibile(env, v)) });
}

async function converti({ request, env }) {
  const cl = await clienteDi(request, env);
  if (!cl) return json({ error: 'Entra nel tuo account.' }, 401);
  if (!catalogoAperto()) return json({ error: `La conversione dei punti apre il ${new Date(SITO.punti.catalogo).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })}.` }, 403);
  if (new Date() > new Date(SITO.punti.scadenza + 'T23:59:59+01:00')) return json({ error: 'Il programma punti è terminato.' }, 403);
  let b; try { b = await request.json(); } catch { return json({ error: 'richiesta non valida' }, 400); }
  const t = SITO.punti.buoni.find((x) => x.punti === Number(b.punti));
  if (!t) return json({ error: 'Scegli uno dei buoni disponibili.' }, 400);
  if (cl.punti < t.punti) return json({ error: `Ti servono ${t.punti} punti: ne hai ${cl.punti}.` }, 400);
  const idMov = `conv:${cl.id}:${Date.now()}`;
  if (!(await aggiungiPunti(env, cl.id, idMov, -t.punti, `Buono da ${t.euro} €`))) return json({ error: 'Riprova.' }, 409);
  const { id, codice } = await crea(env, { tipo: 'punti', importo: t.euro * 100, cliente: cl.id, acquirente: cl.email });
  await inviaEmail(env, {
    a: cl.email, da: env.EMAIL_FROM_SCONTI || 'Semi Store Sconti <sconti@semistore.it>',
    oggetto: `Il tuo buono punti da ${t.euro} €`,
    html: cornice(`Buono da ${eur(t.euro * 100)}`, `<p style="margin:0 0 14px">Hai convertito <b>${t.punti} punti</b>. Il buono è già nel tuo account e si applica da solo nel carrello sui prodotti del Catalogo Premi.</p>
      <div style="display:inline-block;background:#fff;border:2px dashed #f5b800;padding:12px 18px;border-radius:10px;font:700 20px monospace;letter-spacing:1px">${codice}</div>
      <p style="margin:14px 0 0;font-size:13px;color:#5c5f65">Codice personale e segreto: non condividerlo. Senza scadenza.</p>`),
    testo: `Buono punti da ${t.euro} €: ${codice}\nGià nel tuo account, si applica da solo nel carrello sui prodotti del Catalogo Premi. Senza scadenza. Codice segreto: non condividerlo.`,
  });
  return json({ ok: true, buono: { id, fine: codice.slice(-4), importo: t.euro * 100 } });
}

const GG_RECESSO = 14;
const rimborsabile = (b, disp) => b.tipo === 'regalo' && b.stato === 'attivo' && !!b.pi && b.saldo === b.importo && disp === b.importo
  && Date.now() - new Date(b.creato).getTime() <= GG_RECESSO * 86400e3;

async function rimborso({ request, env }) {
  const cl = await clienteDi(request, env);
  if (!cl) return json({ error: 'Entra nel tuo account.' }, 401);
  let q; try { q = await request.json(); } catch { return json({ error: 'richiesta non valida' }, 400); }
  const d = await dbb(env);
  const b = await d.prepare("SELECT * FROM buoni WHERE id=? AND tipo='regalo' AND acquirente=?").bind(String(q.id || ''), cl.email).first();
  if (!b) return json({ error: 'Buono non trovato tra quelli che hai acquistato.' }, 404);
  if (!rimborsabile(b, await disponibile(env, b))) return json({ error: 'Il rimborso automatico vale entro 14 giorni dall\'acquisto e solo se il buono non è mai stato usato. Per altri casi scrivici.' }, 409);
  // prima blocco il buono (così nessuno può spenderlo mentre rimborso), poi chiedo il rimborso a Stripe
  const blocco = await d.prepare("UPDATE buoni SET stato='annullato' WHERE id=? AND stato='attivo' AND saldo=importo").bind(b.id).run();
  if (!blocco.meta.changes) return json({ error: 'Riprova tra un attimo.' }, 409);
  const f = new URLSearchParams({ payment_intent: b.pi, reason: 'requested_by_customer' });
  f.set('metadata[motivo]', 'Recesso buono regalo dal sito');
  const r = await fetch('https://api.stripe.com/v1/refunds', { method: 'POST', headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded', 'idempotency-key': 'rimb-' + b.id }, body: f });
  const j = await r.json();
  if (!r.ok) {
    await d.prepare("UPDATE buoni SET stato='attivo' WHERE id=?").bind(b.id).run();
    console.error('Stripe rimborso', j.error?.message);
    return json({ error: 'Il rimborso automatico non è riuscito: scrivici a ' + SITO.email + ' e lo facciamo noi.' }, 502);
  }
  await d.prepare("UPDATE buoni SET saldo=0 WHERE id=?").bind(b.id).run();
  await d.prepare('INSERT OR IGNORE INTO buoni_mov(id,buono,delta,motivo,quando) VALUES(?,?,?,?,?)').bind(`rimbb:${b.id}:${b.importo}`, b.id, -b.importo, 'Recesso: buono rimborsato', new Date().toISOString()).run();
  const eu = eur(b.importo);
  await inviaEmail(env, { a: cl.email, da: env.EMAIL_FROM || 'Semi Store <info@semistore.it>', oggetto: `Rimborso del buono regalo da ${eu}`,
    html: cornice('Rimborso avviato', `<p style="margin:0">Abbiamo annullato il buono …${b.fine} e avviato il rimborso di <b>${eu}</b> sullo stesso metodo di pagamento. Di solito arriva in 5–10 giorni lavorativi.</p>`),
    testo: `Abbiamo annullato il buono …${b.fine} e avviato il rimborso di ${eu} sullo stesso metodo di pagamento (5–10 giorni lavorativi).` });
  await inviaEmail(env, { a: (env.EMAIL_TO || SITO.email).split(','), da: env.EMAIL_FROM || 'Semi Store <info@semistore.it>', oggetto: `Recesso buono regalo ${eu}`,
    testo: `Il cliente ${cl.email} ha esercitato il recesso sul buono regalo …${b.fine} (${eu}). Buono annullato e rimborso Stripe avviato in automatico (${j.id}).` });
  return json({ ok: true });
}
