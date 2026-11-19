// Crea una sessione Stripe Checkout. I prezzi arrivano SOLO dal catalogo sul server,
// mai dal browser, quindi nessuno può modificarli.
// Variabili in Cloudflare Pages: STRIPE_SECRET_KEY (obbligatoria).
import prodotti from '../../src/data/prodotti.json';
import { SITO } from '../../src/data/sito.js';
import { cliente as clienteDi } from '../_lib/clienti.js';

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

  const f = new URLSearchParams();
  f.set('mode', 'payment');
  f.set('locale', 'it');
  f.set('success_url', `${origin}/grazie/?s={CHECKOUT_SESSION_ID}`);
  f.set('cancel_url', `${origin}/carrello/`);
  f.set('phone_number_collection[enabled]', 'true');
  f.set('billing_address_collection', 'required');
  f.set('metadata[consegna]', ritiro ? 'RITIRO IN NEGOZIO' : 'SPEDIZIONE');
  // ricevuta a tutti; fattura elettronica solo a chi ha un account con partita IVA (dati presi dal profilo)
  if (cl) {
    f.set('customer_email', cl.email);
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

  if (premio) {
    const coupon = await couponGioco(env);
    if (!coupon) return json({ error: 'sconto momentaneamente non disponibile' }, 502);
    f.set('discounts[0][coupon]', coupon);
    f.set('metadata[codice_sconto]', codice);
  }

  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: f,
  });
  const s = await r.json();
  if (!r.ok) { console.error('Stripe', s.error?.message); return json({ error: 'pagamento non disponibile' }, 502); }
  if (premio) await env.RICHIESTE.put('premio:' + codice, JSON.stringify({ ...premio, sessione: s.id }), { expirationTtl: 60 * 86400 });
  return json({ url: s.url });
}

// Coupon Stripe del 10% per i vincitori del minigioco: lo crea la prima volta che serve.
async function couponGioco(env) {
  const id = 'SEMI-GIOCO-10', h = { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` };
  const g = await fetch(`https://api.stripe.com/v1/coupons/${id}`, { headers: h });
  if (g.ok) return id;
  const f = new URLSearchParams({ id, percent_off: '10', duration: 'once', name: 'Premio Trapano Slalom −10%' });
  const c = await fetch('https://api.stripe.com/v1/coupons', { method: 'POST', headers: { ...h, 'content-type': 'application/x-www-form-urlencoded' }, body: f });
  if (!c.ok) { console.error('Stripe coupon', (await c.json()).error?.message); return null; }
  return id;
}
