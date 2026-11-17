// Cerca su YouTube video IN ITALIANO per i prodotti e li mette nella scheda.
// Fase 1: sostituisce i video in lingua straniera. Fase 2: aggiunge un video ai prodotti che non ce l'hanno.
// Usa la YouTube Data API v3 (chiave in YT_KEY). Quota gratuita: 10.000 unità/giorno, una ricerca = ~101 unità,
// quindi ~90 prodotti per giro: il workflow GitHub lo ripete ogni notte finché non ha controllato tutto.
// Un video è accettato solo se YouTube lo dichiara in italiano (lingua audio/predefinita) oppure, se la lingua
// non è dichiarata, se titolo+descrizione sono chiaramente italiani; e il titolo deve contenere il codice prodotto.
import fs from 'node:fs/promises';

const KEY = process.env.YT_KEY;
if (!KEY) { console.error('Manca YT_KEY'); process.exit(1); }
const MAX = Number(process.env.MAX || 90);
const PROD = 'src/data/prodotti.json';
const LOG = 'src/data/video-cercati.json';

const prodotti = JSON.parse(await fs.readFile(PROD, 'utf8'));
const log = JSON.parse(await fs.readFile(LOG, 'utf8').catch(() => '{}'));

const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
// codice base: DCS334NT -> DCS334, DWE4357 -> DWE4357, DWST83517-1 -> DWST83517
const base = (m) => { const x = norm(m).match(/^([A-Z]{1,5}\d{2,6})/); return x ? x[1] : norm(m); };

const PAROLE_IT = /\b(recensione|smerigliatrice|trapano|avvitatore|seghetto|tassellatore|troncatrice|levigatrice|aspiratore|aspirapolvere|tagliasiepi|tagliabordi|decespugliatore|chiodatrice|demolitore|pialla|pialletto|fresatrice|elettrosega|motosega|livella|misuratore|caricabatterie|batteria|batterie|utensile|questo|questa|della|dello|degli|nella|perché|anche|abbiamo|vediamo|ciao a tutti|lavoro|legno|ferro|cemento)\b/gi;
const sembraItaliano = (t) => new Set((t.match(PAROLE_IT) || []).map((w) => w.toLowerCase())).size >= 3;

async function api(path, params) {
  const u = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  for (const [k, v] of Object.entries({ ...params, key: KEY })) u.searchParams.set(k, v);
  const r = await fetch(u);
  if (!r.ok) { const e = await r.text(); throw new Error(`${r.status} ${e.slice(0, 300)}`); }
  return r.json();
}
const durata = (iso) => { const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || '') || []; return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0); };

async function cerca(p) {
  const codice = base(p.modello);
  const q = `${p.marca === 'BLACK+DECKER' ? 'Black Decker' : p.marca} ${p.modello}`;
  const s = await api('search', { part: 'snippet', q, type: 'video', relevanceLanguage: 'it', regionCode: 'IT', maxResults: '15', videoEmbeddable: 'true', safeSearch: 'strict' });
  const ids = (s.items || []).map((i) => i.id.videoId).filter(Boolean);
  if (!ids.length) return null;
  const v = await api('videos', { part: 'snippet,contentDetails,status', id: ids.join(',') });
  const ok = (v.items || []).filter((x) => {
    const sn = x.snippet, lingua = (sn.defaultAudioLanguage || sn.defaultLanguage || '').toLowerCase();
    if (!x.status?.embeddable) return false;
    if (!norm(sn.title).includes(codice) && !norm(sn.description).slice(0, 400).includes(codice)) return false;
    if (lingua) return lingua.startsWith('it');
    return sembraItaliano(`${sn.title} ${sn.description}`);
  }).map((x) => ({ x, sec: durata(x.contentDetails?.duration), nelTitolo: norm(x.snippet.title).includes(codice) }));
  // preferisci: codice nel titolo, poi video tra 1 e 20 minuti, poi l'ordine di pertinenza di YouTube
  ok.sort((a, b) => (b.nelTitolo - a.nelTitolo) || ((b.sec >= 60 && b.sec <= 1200) - (a.sec >= 60 && a.sec <= 1200)));
  const best = ok[0]?.x;
  return best ? { id: best.id, t: best.snippet.title, ch: best.snippet.channelTitle, it: best.snippet.title, l: 'it' } : null;
}

// coda: prima i video stranieri, poi i prodotti senza video; i codici già cercati non si ricercano (stesso codice base = stesso risultato)
const coda = [
  ...prodotti.filter((p) => p.video && p.video.l && p.video.l !== 'it'),
  ...prodotti.filter((p) => !p.video && p.modello),
].filter((p) => !(base(p.modello) in log));

const fatti = new Map();
let usati = 0, trovati = 0;
for (const p of coda) {
  const b = base(p.modello);
  if (fatti.has(b)) continue;
  if (usati >= MAX) break;
  try {
    const r = await cerca(p);
    usati++;
    fatti.set(b, r);
    log[b] = r ? r.id : 0;
  } catch (e) {
    console.error(`Stop su ${p.modello}: ${e.message}`); // di solito quota esaurita: si riprende domani
    break;
  }
}
// applica a tutti i prodotti con lo stesso codice base (es. DCS334NT e DCS334P2)
for (const p of prodotti) {
  const r = fatti.get(base(p.modello));
  if (!r) continue;
  if (p.video && p.video.l === 'it') continue;
  p.video = r; trovati++;
}
// stesso formato del file originale (una voce per riga, senza rientri)
const fmt = (x) => JSON.stringify(x, null, 1).replace(/^ +/gm, '');
await fs.writeFile(PROD, fmt(prodotti));
await fs.writeFile(LOG, JSON.stringify(log, null, 0) + '\n');
const restanti = new Set(coda.filter((p) => !(base(p.modello) in log)).map((p) => base(p.modello))).size;
console.log(`Ricerche: ${usati} · prodotti aggiornati con video italiano: ${trovati} · ancora da controllare: ${restanti}`);
