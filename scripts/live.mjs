// Prima del build: prende dal sito pubblicato prezzi e giacenze aggiornati dall'app interna
// (tabella D1 "giacenze", GET /api/giacenze?completo=1) e li scrive in src/data/prodotti.json,
// così pagine, dati strutturati, feed Google/Meta/WhatsApp, indice e checkout usano i valori nuovi.
// - prezzo (centesimi IVA incl.) > 0  → diventa il prezzo di vendita
// - quantità > 0 → "Disponibile"; quantità 0 → resta "Disponibile su conferma"
// Su Cloudflare (CF_PAGES=1) se il sito non risponde il build si ferma: resta online la versione precedente,
// così non si perdono i prezzi aggiornati (LIVE_FACOLTATIVO=1 per andare avanti comunque).
import { readFileSync, writeFileSync } from 'node:fs';

const URL_LIVE = (process.env.LIVE_URL || 'https://semistore.it').replace(/\/$/, '') + '/api/giacenze?completo=1';
const suCloudflare = !!process.env.CF_PAGES;
const FILE = new URL('../src/data/prodotti.json', import.meta.url);
// in locale (npm run build sul PC) non tocca prodotti.json, per non finire per sbaglio in un commit: LIVE=1 per provarlo
if (!suCloudflare && !process.env.LIVE) { console.log('live: saltato (solo sul build di Cloudflare; LIVE=1 per forzarlo)'); process.exit(0); }

let dati;
try {
  const r = await fetch(URL_LIVE, { headers: { 'cache-control': 'no-cache' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  dati = await r.json();
} catch (e) {
  if (suCloudflare && !process.env.LIVE_FACOLTATIVO) { console.error(`live: impossibile leggere ${URL_LIVE} (${e.message}): build fermato`); process.exit(1); }
  console.warn(`live: ${e.message}, uso i dati del repository`); process.exit(0);
}
// formato completo: [{slug, qty, prezzo}] ; formato vecchio: {slug: qty}
const righe = Array.isArray(dati) ? dati : Object.entries(dati || {}).map(([slug, qty]) => ({ slug, qty, prezzo: null }));
const per = new Map(righe.map((r) => [r.slug, r]));
const prodotti = JSON.parse(readFileSync(FILE, 'utf8'));
let np = 0, nd = 0;
for (const p of prodotti) {
  const r = per.get(p.slug); if (!r) continue;
  const prezzo = Math.round(Number(r.prezzo));
  if (prezzo > 0 && prezzo !== p.prezzo) { p.prezzo = prezzo; p.fontePrezzo = 'app'; np++; }
  const q = Math.max(0, Math.floor(Number(r.qty) || 0));
  p.giacenza = q;
  p.disponibilita = q > 0 ? 'disponibile' : 'conferma';
  if (q > 0) nd++;
}
writeFileSync(FILE, JSON.stringify(prodotti, null, 1));
console.log(`live: ${righe.length} righe dal sito, ${np} prezzi aggiornati, ${nd} prodotti disponibili`);
