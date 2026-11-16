// GET /api/offerta -> { attiva, titolo, immagine }
// Controlla che la pagina delle offerte DEWALT sia online e non risulti terminata.
// Risposta tenuta in cache 10 minuti, così il sito DEWALT non viene interrogato a ogni visita.
import { OFFERTA, scadenzaMs } from '../../src/data/offerta.js';

const FINITA = /(offerta|promozione|promo|campagna)[^<]{0,40}(scadut|terminat|conclus|non (è )?più (attiv|disponibil))|expired|page not found|pagina non trovata/i;
const meta = (html, p) => (html.match(new RegExp(`<meta[^>]+property=["']${p}["'][^>]+content=["']([^"']+)`, 'i')) || [])[1] || '';

export async function onRequestGet({ request, waitUntil }) {
  const cache = caches.default;
  const chiave = new Request(new URL('/api/offerta?v=1', request.url).href);
  const hit = await cache.match(chiave);
  if (hit) return hit;

  let out = { attiva: false };
  if (OFFERTA.attiva && !(OFFERTA.scade && Date.now() > scadenzaMs())) {
    try {
      const r = await fetch(OFFERTA.url, { redirect: 'follow', signal: AbortSignal.timeout(6000), headers: { 'user-agent': 'SemiStore-check/1.0' } });
      const html = r.ok ? (await r.text()).slice(0, 200000) : '';
      const finita = !r.ok || FINITA.test(html.replace(/<script[\s\S]*?<\/script>/gi, ''));
      out = { attiva: !finita, titolo: meta(html, 'og:title'), immagine: meta(html, 'og:image') };
    } catch {
      out = { attiva: false };
    }
  }
  const res = new Response(JSON.stringify(out), {
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=600' },
  });
  waitUntil(cache.put(chiave, res.clone()));
  return res;
}
