// Webhook Stripe (Dashboard → Sviluppatori → Webhook → evento checkout.session.completed):
// https://semistore.it/api/stripe-webhook — scala la giacenza dei prodotti venduti sul sito e aggiorna TikTok.
// Variabile: STRIPE_WEBHOOK_SECRET (whsec_...).
import { movimento } from '../_lib/db.js';
import { configurato } from '../_lib/tiktok.js';
import { sincronizza } from '../_lib/sincronizza.js';

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
  for (const li of (await r.json()).data || []) {
    const slug = li.price?.product?.metadata?.slug;
    if (slug) await movimento(env, `st:${sid}:${slug}`, 'sito', slug, -Number(li.quantity || 1));
  }
  if (configurato(env)) waitUntil(sincronizza(env, new URL(request.url).origin, { limite: 30 }).catch(() => {}));
  return new Response('ok');
}
