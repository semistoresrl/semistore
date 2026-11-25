// Crea una sessione Stripe Checkout. I prezzi arrivano SOLO dal catalogo sul server,
// mai dal browser, quindi nessuno può modificarli.
// Variabili in Cloudflare Pages: STRIPE_SECRET_KEY (obbligatoria).
import prodotti from '../../src/data/prodotti.json';
import { SITO } from '../../src/data/sito.js';
import { cliente as clienteDi } from '../_lib/clienti.js';
import { perCodice, disponibile, prenota } from '../_lib/buoni.js';

const PER_SLUG = Object.fromEntries(prodotti.map((p) => [p.slug, p]));
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });

export async function onRequestPost({ request, env }) {
  if (!env.STRIPE_SECRET_KEY) return json({ error: 'pagamenti non ancora attivi' }, 503);
  let body; try { body = await request.json(); } catch { return json({ error: 'richiesta non valida' }, 400); }
  const items = (Array.isArray(body.items) ? body.items : [])
    .map((i) => ({ p: PER_SLUG[i.slug], q: Math.max(1, Math.min(20, Math.floor(Number(i.qty) || 0))) }))
    .filter((i) => i.p).slice(0, 50);
  if (!items.length) return json({ error: 'carrello vuoto' }, 400);
  // giacenze ufficiali: per scelta del negozio ciò che non è a magazzino si vende "su conferma" (19/11/2026),
  // quindi il blocco vale solo con VENDI_SOLO_DISPONIBILI=1
  if (env.DB && env.VENDI_SOLO_DISPONIBILI === '1') {
    try {
      const segni = items.map(() => '?').join(',');
      const g = (await env.DB.prepare(`SELECT slug, qty FROM giacenze WHERE slug IN (${segni})`).bind(...items.map((i) => i.p.slug)).all()).results;
      for (const r of g) {
        const i = items.find((x) => x.p.slug === r.slug);
        if (i && i.q > r.qty) return json({ error: r.qty ? `${i.p.nome}: disponibili solo ${r.qty}` : `${i.p.nome}: al momento esaurito` }, 409);
      }
    } catch { /* tabella non ancora creata: si procede come prima */ }
  }
  // cliente collegato (facoltativo per comprare, obbligatorio per usare gli sconti del minigioco)
  let cl = null; try { cl = await clienteDi(request, env); } catch {}
  const ritiro = body.consegna === 'ritiro';
  const sub = items.reduce((t, i) => t + i.p.prezzo * i.q, 0);
  const origin = new URL(request.url).origin;

  // codice premio del minigioco (−10%, una volta sola)
  const codice = String(body.codice || '').trim().toUpperCase().replace(/\s+/g, '');
  let premio = null;
  if (codice) {
    premio = env.RICHIESTE && /^GIOCO-[A-Z0-9]{7}$/.test(codice) ? await env.RICHIESTE.get('premio:' + codice, 'json') : null;
    if (!premio) return json({ error: 'codice sconto non valido o scaduto' }, 400);
    if (premio.sessione && !premio.pagato) { // controlla se il tentativo precedente è stato pagato
      const r0 = await fetch(`https://api.stripe.com/v1/checkout/sessions/${premio.sessione}`, { headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } });
      const s0 = r0.ok ? await r0.json() : null;
      if (s0?.status === 'complete') { premio.pagato = new Date().toISOString(); await env.RICHIESTE.put('premio:' + codice, JSON.stringify(premio), { expirationTtl: 60 * 86400 }); }
    }
    if (premio.pagato) return json({ error: 'codice sconto già utilizzato' }, 400);
    // lo sconto è legato all'account con l'email con cui è stato vinto
    if (!cl || (premio.email && cl.email !== premio.email)) {
      const em = String(premio.email || '');
      const coperta = em.replace(/^(.{2}).*(@.*)$/, '$1•••$2');
      return json({ error: `Per usare lo sconto entra nel tuo account (${coperta}).`, accedi: true }, 401);
    }
  }

  // sconto del minigioco (10% sui prodotti)
  const scontoGioco = premio ? Math.round(sub * 10 / 100) : 0;
  // buoni: regalo (su tutto) e punti (solo prodotti del Catalogo Premi, solo nel proprio account). Il server ricalcola tutto.
  const premi = new Set(SITO.punti.prodottiPremio || []);
  const subPremi = items.filter((i) => premi.has(i.p.slug)).reduce((t, i) => t + i.p.prezzo * i.q, 0);
  let resto = sub - scontoGioco, restoPremi = Math.round(subPremi * (sub ? (sub - scontoGioco) / sub : 1));
  const usi = [];
  const codiciBuoni = [...new Set((Array.isArray(body.buoni) ? body.buoni : []).map(String))].slice(0, 5);
  if ((codiciBuoni.length || (Array.isArray(body.buoniAccount) && body.buoniAccount.length)) && !env.DB) return json({ error: 'buoni non disponibili ora' }, 503);
  // buoni salvati nell'account: si passano per id (il codice non serve più), solo dal titolare
  const idsAccount = [...new Set((Array.isArray(body.buoniAccount) ? body.buoniAccount : []).map(String))].slice(0, 5);
  const daUsare = [];
  for (const cod of codiciBuoni) daUsare.push(await perCodice(env, cod) || { stato: 'annullato' });
  if (idsAccount.length) {
    if (!cl) return json({ error: 'Entra nel tuo account per usare i buoni salvati.', accedi: true }, 401);
    const { dbb } = await import('../_lib/buoni.js');
    const d = await dbb(env);
    for (const id of idsAccount) { const b = await d.prepare('SELECT * FROM buoni WHERE id=? AND cliente=?').bind(id, cl.id).first(); if (b && !daUsare.some((x) => x.id === b.id)) daUsare.push(b); }
  }
  for (const b of daUsare) {
    if (!b || b.stato === 'annullato') return json({ error: 'Un codice buono non è valido: toglilo e riprova.' }, 400);
    if (b.tipo === 'punti' && (!cl || cl.id !== b.cliente)) return json({ error: 'Per usare un buono punti entra nel tuo account.', accedi: true }, 401);
    const disp = await disponibile(env, b);
    const max = b.tipo === 'punti' ? Math.min(resto, restoPremi) : resto;
    const uso = Math.min(disp, max);
    if (uso <= 0) continue;
    usi.push({ id: b.id, importo: uso, tipo: b.tipo, fine: b.fine });
    resto -= uso; if (b.tipo === 'punti') restoPremi -= uso; else restoPremi = Math.min(restoPremi, resto);
  }
  const usoPunti = usi.filter((u) => u.tipo === 'punti').reduce((t, u) => t + u.importo, 0);
  const usoRegalo = usi.filter((u) => u.tipo !== 'punti').reduce((t, u) => t + u.importo, 0);
  const scontoTot = scontoGioco + usoPunti + usoRegalo;

  const f = new URLSearchParams();
  f.set('mode', 'payment');
  f.set('expires_at', String(Math.floor(Date.now() / 1000) + 31 * 60)); // la prenotazione dei buoni dura 45 minuti
  f.set('metadata[base_punti]', String(Math.max(0, sub - scontoGioco - usoPunti))); // i punti si calcolano su questo
  if (usi.length) f.set('metadata[buoni]', usi.map((u) => `${u.tipo === 'punti' ? 'P' : 'R'}…${u.fine}:${(u.importo / 100).toFixed(2)}`).join(', ').slice(0, 450));
  if (usoRegalo) f.set('metadata[pagato_con_buono_regalo]', (usoRegalo / 100).toFixed(2));
  if (scontoGioco) f.set('metadata[sconto_gioco]', (scontoGioco / 100).toFixed(2));
  if (usoPunti) f.set('metadata[sconto_buono_punti]', (usoPunti / 100).toFixed(2));
  f.set('locale', 'it');
  f.set('success_url', `${origin}/grazie/?s={CHECKOUT_SESSION_ID}`);
  f.set('cancel_url', `${origin}/carrello/`);
  f.set('phone_number_collection[enabled]', 'true');
  f.set('billing_address_collection', 'required');
  if (body.mk === true) { // consenso marketing: dati tecnici per l'API Conversions di Meta (acquisto confermato dal server)
    const ck = request.headers.get('cookie') || '';
    const c = (n) => (ck.match(new RegExp('(?:^|;\\s*)' + n + '=([^;]+)')) || [])[1] || '';
    f.set('metadata[mk]', '1');
    if (c('_fbp')) f.set('metadata[fbp]', c('_fbp').slice(0, 200));
    if (c('_fbc')) f.set('metadata[fbc]', c('_fbc').slice(0, 200));
    f.set('metadata[ip]', (request.headers.get('cf-connecting-ip') || '').slice(0, 60));
    f.set('metadata[ua]', (request.headers.get('user-agent') || '').slice(0, 450));
  }
  f.set('metadata[consegna]', ritiro ? 'RITIRO IN NEGOZIO' : 'SPEDIZIONE');
  // ricevuta a tutti; fattura elettronica solo a chi ha un account con partita IVA (dati presi dal profilo)
  if (cl) {
    // pagamento già compilato: nome, telefono e indirizzo arrivano dal profilo; quello che il cliente corregge su Stripe resta salvato
    const cus = await clienteStripe(env, cl).catch(() => null);
    if (cus) {
      f.set('customer', cus);
      f.set('customer_update[address]', 'auto');
      f.set('customer_update[name]', 'auto');
      if (!ritiro) f.set('customer_update[shipping]', 'auto');
    } else f.set('customer_email', cl.email);
    f.set('payment_intent_data[receipt_email]', cl.email);
    f.set('metadata[cliente]', cl.id);
    if (cl.tipo === 'azienda' && cl.piva) {
      f.set('metadata[fattura]', 'SI');
      f.set('metadata[ragione_sociale]', String(cl.ragione_sociale || '').slice(0, 450));
      f.set('metadata[piva]', cl.piva);
      f.set('metadata[sdi]', cl.sdi || '0000000');
      if (cl.pec) f.set('metadata[pec]', cl.pec);
      f.set('metadata[sede]', `${cl.indirizzo || ''}, ${cl.cap || ''} ${cl.citta || ''} (${cl.provincia || ''})`.slice(0, 450));
      f.set('payment_intent_data[description]', `Ordine con fattura a ${cl.ragione_sociale} – P.IVA ${cl.piva}`.slice(0, 900));
    }
  }
  f.set('custom_fields[0][key]', 'note');
  f.set('custom_fields[0][label][type]', 'custom');
  f.set('custom_fields[0][label][custom]', 'Note per l\'ordine');
  f.set('custom_fields[0][type]', 'text');
  f.set('custom_fields[0][optional]', 'true');
  items.forEach(({ p, q }, k) => {
    f.set(`line_items[${k}][quantity]`, String(q));
    f.set(`line_items[${k}][price_data][currency]`, 'eur');
    f.set(`line_items[${k}][price_data][unit_amount]`, String(p.prezzo));
    f.set(`line_items[${k}][price_data][product_data][name]`, `${p.marca} ${p.nome}`.slice(0, 250));
    if (p.modello) f.set(`line_items[${k}][price_data][product_data][description]`, `Codice ${p.modello}`);
    f.set(`line_items[${k}][price_data][product_data][metadata][slug]`, p.slug);
  });
  if (ritiro) {
    f.set('shipping_options[0][shipping_rate_data][type]', 'fixed_amount');
    f.set('shipping_options[0][shipping_rate_data][display_name]', `Ritiro in negozio a ${SITO.citta}`);
    f.set('shipping_options[0][shipping_rate_data][fixed_amount][amount]', '0');
    f.set('shipping_options[0][shipping_rate_data][fixed_amount][currency]', 'eur');
  } else {
    const costo = sub >= SITO.spedizione.gratisDa ? 0 : SITO.spedizione.costo;
    f.set('shipping_address_collection[allowed_countries][0]', 'IT');
    f.set('shipping_options[0][shipping_rate_data][type]', 'fixed_amount');
    f.set('shipping_options[0][shipping_rate_data][display_name]', costo ? 'Spedizione corriere' : 'Spedizione gratuita');
    f.set('shipping_options[0][shipping_rate_data][fixed_amount][amount]', String(costo));
    f.set('shipping_options[0][shipping_rate_data][fixed_amount][currency]', 'eur');
    f.set('shipping_options[0][shipping_rate_data][delivery_estimate][minimum][unit]', 'business_day');
    f.set('shipping_options[0][shipping_rate_data][delivery_estimate][minimum][value]', '2');
    f.set('shipping_options[0][shipping_rate_data][delivery_estimate][maximum][unit]', 'business_day');
    f.set('shipping_options[0][shipping_rate_data][delivery_estimate][maximum][value]', '4');
  }

  if (premio) f.set('metadata[codice_sconto]', codice);
  if (scontoTot > 0) { // Stripe accetta un solo sconto: creo un coupon unico, valido una volta, con la somma di sconto e buoni
    const coupon = await couponUnico(env, scontoTot, premio, usi);
    if (!coupon) return json({ error: 'sconto momentaneamente non disponibile' }, 502);
    f.set('discounts[0][coupon]', coupon);
  }

  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: f,
  });
  const s = await r.json();
  if (!r.ok) { console.error('Stripe', s.error?.message); return json({ error: 'pagamento non disponibile' }, 502); }
  if (premio) await env.RICHIESTE.put('premio:' + codice, JSON.stringify({ ...premio, sessione: s.id }), { expirationTtl: 60 * 86400 });
  if (usi.length) await prenota(env, s.id, usi);
  return json({ url: s.url });
}

// Coupon Stripe usa e getta con l'importo esatto di sconto del gioco + buoni (Checkout accetta un solo sconto per pagamento).
async function couponUnico(env, importo, premio, usi) {
  const nome = [premio ? 'Premio −10%' : '', usi.some((u) => u.tipo !== 'punti') ? 'Buono regalo' : '', usi.some((u) => u.tipo === 'punti') ? 'Buono punti' : ''].filter(Boolean).join(' + ');
  const f = new URLSearchParams({ amount_off: String(importo), currency: 'eur', duration: 'once', max_redemptions: '1', name: nome.slice(0, 40) || 'Sconto Semi Store' });
  f.set('redeem_by', String(Math.floor(Date.now() / 1000) + 2 * 3600));
  const c = await fetch('https://api.stripe.com/v1/coupons', { method: 'POST', headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded' }, body: f });
  const j = await c.json();
  if (!c.ok) { console.error('Stripe coupon', j.error?.message); return null; }
  return j.id;
}

// Crea (una volta) o aggiorna il cliente Stripe con i dati del profilo
async function clienteStripe(env, cl) {
  const nome = cl.tipo === 'azienda' ? cl.ragione_sociale : [cl.nome, cl.cognome].filter(Boolean).join(' ');
  const f = new URLSearchParams();
  if (!cl.stripe_cus) f.set('email', cl.email);
  if (nome) f.set('name', nome.slice(0, 250));
  if (cl.telefono) f.set('phone', cl.telefono);
  if (cl.indirizzo && cl.cap && cl.citta) {
    for (const [k, v] of [['line1', cl.indirizzo], ['postal_code', cl.cap], ['city', cl.citta], ['state', cl.provincia || ''], ['country', 'IT']]) f.set(`address[${k}]`, v);
    if (!cl.stripe_cus) {
      f.set('shipping[name]', (nome || cl.email).slice(0, 250));
      if (cl.telefono) f.set('shipping[phone]', cl.telefono);
      for (const [k, v] of [['line1', cl.indirizzo], ['postal_code', cl.cap], ['city', cl.citta], ['state', cl.provincia || ''], ['country', 'IT']]) f.set(`shipping[address][${k}]`, v);
    }
  }
  f.set('preferred_locales[0]', 'it');
  f.set('metadata[cliente]', cl.id);
  const url = 'https://api.stripe.com/v1/customers' + (cl.stripe_cus ? '/' + cl.stripe_cus : '');
  const r = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded' }, body: f });
  const j = await r.json();
  if (!r.ok) { if (cl.stripe_cus && r.status === 404) { cl.stripe_cus = null; return clienteStripe(env, cl); } return null; }
  if (j.id !== cl.stripe_cus) await env.DB.prepare('UPDATE clienti SET stripe_cus=? WHERE id=?').bind(j.id, cl.id).run();
  return j.id;
}
