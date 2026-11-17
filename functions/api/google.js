// GET /api/google -> valutazione, numero recensioni, ultime recensioni e orari dalla scheda Google Business.
// Usa Places API (New) con la chiave GOOGLE_PLACES_KEY (variabile Cloudflare). Risposta in cache 12 ore:
// Google viene interrogato al massimo 2 volte al giorno, quindi il costo resta nella quota gratuita.
import { SITO } from '../../src/data/sito.js';

export async function onRequestGet({ request, env, waitUntil }) {
  const cache = caches.default;
  const chiave = new Request(new URL('/api/google?v=4', request.url).href);
  const hit = await cache.match(chiave);
  if (hit) return hit;
  let out = { ok: false, chiave: !!env.GOOGLE_PLACES_KEY };
  if (env.GOOGLE_PLACES_KEY) {
    try {
      const r = await fetch(`https://places.googleapis.com/v1/places/${SITO.googlePlaceId}?languageCode=it&regionCode=IT`, {
        headers: { 'X-Goog-Api-Key': env.GOOGLE_PLACES_KEY, 'X-Goog-FieldMask': 'rating,userRatingCount,reviews,regularOpeningHours.weekdayDescriptions,googleMapsUri' },
        signal: AbortSignal.timeout(6000),
      });
      if (r.ok) {
        const j = await r.json();
        out = {
          ok: true,
          voto: j.rating || null,
          totale: j.userRatingCount || 0,
          link: j.googleMapsUri || null,
          orari: j.regularOpeningHours?.weekdayDescriptions || [],
          recensioni: (j.reviews || []).filter((x) => { const t = (x.text?.text || x.originalText?.text || '').trim(); return x.rating >= 4 && t.length >= 40 && !/\?\s*$|vorrei sapere|corso novara|stazione centrale/i.test(t); }).sort((a, b) => b.rating - a.rating).slice(0, 5).map((x) => ({
            nome: x.authorAttribution?.displayName || 'Cliente Google',
            foto: x.authorAttribution?.photoUri || null,
            profilo: x.authorAttribution?.uri || null,
            voto: x.rating,
            quando: x.relativePublishTimeDescription || '',
            testo: (x.text?.text || x.originalText?.text || '').slice(0, 600),
          })),
        };
      } else out.errore = r.status;
    } catch (e) { out.errore = 'rete'; }
  }
  const res = new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': `public, max-age=${out.ok ? 43200 : 600}` } });
  if (out.ok) waitUntil(cache.put(chiave, res.clone()));
  return res;
}
