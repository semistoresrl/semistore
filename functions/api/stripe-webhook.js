// Webhook Stripe (Dashboard → Sviluppatori → Webhook → evento checkout.session.completed):
// https://semistore.it/api/stripe-webhook — scala la giacenza dei prodotti venduti sul sito e aggiorna TikTok.
// Variabile: STRIPE_WEBHOOK_SECRET (whsec_...).
import { movimento } from '../_lib/db.js';
import { configurato } from '../_lib/tiktok.js';
import { sincronizza } from '../_lib/sincronizza.js';
import { dbc, aggiungiPunti, email as inviaEmail } from '../_lib/clienti.js';
import { SITO } from '../../src/data/sito.js';

const enc = new TextEncoder();
async function verifica(segreto, corpo, header) {
  const p = Object.fromEntries(String(header || '').split(',').map((x) => x.split('=')));
  if (!p.t || !p.v1 || Math.abs(Date.now() / 1000 - Number(p.t)) > 600) return false;
  const k = await crypto.subtle.importKey('raw', enc.encode(segreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const s = [...new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(`${p.t}.${corpo}`)))].map((b) => b.toString(16).padStart(2, '0')).join('');
  return s === p.v1;
}

export async function onRequestPost({ request, env, waitUntil }) {
  if (!env.STRIPE_WEBHOOK_SECRET || !env.STRIPE_SECRET_KEY || !env.DB) return new Response('non configurato', { status: 503 });
  const corpo = await request.text();
  if (!(await verifica(env.STRIPE_WEBHOOK_SECRET, corpo, request.headers.get('stripe-signature')))) return new Response('firma non valida', { status: 400 });
  const ev = JSON.parse(corpo);
  if (ev.type !== 'checkout.session.completed' || ev.data?.object?.payment_status !== 'paid') return new Response('ok');
  const sid = ev.data.object.id;
  const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sid}/line_items?limit=100&expand[]=data.price.product`, { headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } });
  if (!r.ok) return new Response('stripe non raggiungibile', { status: 502 }); // Stripe riprova da solo
  const righe = (await r.json()).data || [];
  for (const li of righe) {
    const slug = li.price?.product?.metadata?.slug;
    if (slug) await movimento(env, `st:${sid}:${slug}`, 'sito', slug, -Number(li.quantity || 1));
  }
  try { await registraOrdine(env, ev.data.object, righe); } catch (e) { console.error('ordine', e); }
  if (configurato(env)) waitUntil(sincronizza(env, new URL(request.url).origin, { limite: 30 }).catch(() => {}));
  return new Response('ok');
}

// Ordine nell'account del cliente, punti (1 per euro sui prodotti, spedizione esclusa) e avviso al negozio
// con i dati per la fattura elettronica (solo clienti con partita IVA).
async function registraOrdine(env, o, righe) {
  const d = await dbc(env);
  const md = o.metadata || {};
  const email = String(o.customer_details?.email || o.customer_email || '').toLowerCase();
  let cl = md.cliente ? await d.prepare('SELECT * FROM clienti WHERE id=?').bind(md.cliente).first() : null;
  if (!cl && email) cl = await d.prepare('SELECT * FROM clienti WHERE email=?').bind(email).first();
  const sped = Number(o.total_details?.amount_shipping || 0), tot = Number(o.amount_total || 0);
  const punti = cl ? Math.floor(Math.max(0, tot - sped) / 100 * (SITO.punti?.perEuro || 1)) : 0;
  const fattura = md.fattura === 'SI' ? 1 : 0;
  const datiF = fattura ? { ragioneSociale: md.ragione_sociale, piva: md.piva, sdi: md.sdi, pec: md.pec, sede: md.sede } : null;
  const el = righe.map((li) => ({ nome: li.description, q: li.quantity, tot: li.amount_total, slug: li.price?.product?.metadata?.slug }));
  const nuovo = await d.prepare(`INSERT OR IGNORE INTO ordini(sessione,cliente,email,totale,spedizione,punti,fattura,dati_fattura,consegna,righe,quando)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(o.id, cl?.id || null, email, tot, sped, punti, fattura, datiF ? JSON.stringify(datiF) : null,
      md.consegna || '', JSON.stringify(el), new Date().toISOString()).run();
  if (!nuovo.meta.changes) return; // già registrato (Stripe a volte riprova)
  if (cl && punti) await aggiungiPunti(env, cl.id, 'ord:' + o.id, punti, `Ordine ${o.id.slice(-8).toUpperCase()}`);
  const eur = (c) => (c / 100).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
  const ind = o.shipping_details?.address || o.customer_details?.address || {};
  const testo = [
    `Nuovo ordine dal sito: ${o.id.slice(-8).toUpperCase()} (${eur(tot)})`,
    `Cliente: ${o.customer_details?.name || ''} <${email}> ${o.customer_details?.phone || ''}`,
    `Consegna: ${md.consegna || ''}${ind.line1 ? ` – ${ind.line1} ${ind.line2 || ''}, ${ind.postal_code || ''} ${ind.city || ''} (${ind.state || ''})` : ''}`,
    '', ...el.map((x) => `${x.q} × ${x.nome} – ${eur(x.tot)}`), `Spedizione: ${eur(sped)}`,
    md.codice_sconto ? `Codice sconto: ${md.codice_sconto}` : '',
    '', fattura ? `FATTURA ELETTRONICA DA EMETTERE\nRagione sociale: ${md.ragione_sociale}\nP.IVA: ${md.piva}\nCodice destinatario SDI: ${md.sdi}${md.pec ? `\nPEC: ${md.pec}` : ''}\nSede: ${md.sede}`
      : 'Cliente privato: niente fattura, vale la ricevuta (corrispettivo).',
    cl ? `Account: ${cl.id} · punti accreditati: ${punti}` : 'Ordine senza account.',
    o.custom_fields?.[0]?.text?.value ? `Note: ${o.custom_fields[0].text.value}` : '',
  ].filter((x) => x !== '').join('\n');
  await inviaEmail(env, { a: (env.EMAIL_TO || SITO.email).split(','), da: env.EMAIL_FROM || 'Semi Store <info@semistore.it>',
    oggetto: `${fattura ? '[FATTURA] ' : ''}Ordine ${o.id.slice(-8).toUpperCase()} · ${eur(tot)}`, testo, html: `<pre style="font:14px/1.5 Arial,sans-serif;white-space:pre-wrap">${testo.replace(/</g, '&lt;')}</pre>` });
}
