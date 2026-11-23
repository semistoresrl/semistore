// Giacenze e prezzi ufficiali. GET pubblico: { slug: quantità } (con ?completo=1: [{slug, qty, prezzo}]). POST (ADMIN_TOKEN, dall'app interna):
// { giacenze: [{ slug? | codice, qty, prezzo? (centesimi IVA incl.), nome?, marca?, immagine?, ean?, pesoKg?, descrizione? }] }
// Tutto ciò che arriva con quantità > 0 va in vendita anche su TikTok Shop (se collegato).
import prodotti from '../../src/data/prodotti.json';
import { db, json, getImp, setImp } from '../_lib/db.js';
import { autorizzato } from '../_lib/gestione.js';
import { configurato } from '../_lib/tiktok.js';
import { sincronizza } from '../_lib/sincronizza.js';

const norm = (c) => String(c || '').toUpperCase().replace(/-[A-Z]{2}$/, '').replace(/[^A-Z0-9]/g, '');
const PER_CODICE = {};
for (const p of prodotti) for (const c of [p.modello, p.codice]) if (c && !PER_CODICE[norm(c)]) PER_CODICE[norm(c)] = p.slug;
const SLUGS = new Set(prodotti.map((p) => p.slug));
const nuovoSlug = (marca, codice) => `${marca || 'articolo'}-${codice}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const CAMPI = ['nome', 'marca', 'modello', 'codice', 'immagine', 'immagini', 'ean', 'pesoKg', 'descrizione', 'sottotitolo', 'caratteristiche', 'categoria', 'tiktokCategoria', 'lunghezzaCm', 'larghezzaCm', 'altezzaCm'];

export async function onRequestGet({ request, env, waitUntil }) {
  const completo = new URL(request.url).searchParams.has('completo');
  if (!env.DB) return json(completo ? [] : {});
  const d = await db(env);
  // ?completo=1: [{slug, qty, prezzo}] per il build del sito (scripts/live.mjs), senza cache
  if (completo) return json((await d.prepare('SELECT slug, qty, prezzo FROM giacenze').all()).results);
  const r = (await d.prepare('SELECT slug, qty FROM giacenze').all()).results;
  // avanza la coda TikTok anche con le visite (al massimo una volta al minuto)
  if (configurato(env)) waitUntil((async () => {
    const ultimo = await getImp(env, 'ultimo_sync');
    if (ultimo && Date.now() - ultimo < 60000) return;
    await setImp(env, 'ultimo_sync', Date.now());
    await sincronizza(env, new URL(request.url).origin, { limite: 30 });
  })().catch(() => {}));
  return new Response(JSON.stringify(Object.fromEntries(r.map((x) => [x.slug, x.qty]))), {
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' },
  });
}

export async function onRequestPost({ request, env, waitUntil }) {
  if (!(await autorizzato(request, env))) return json({ error: 'non autorizzato' }, 401);
  if (!env.DB) return json({ error: 'database D1 non collegato (binding DB)' }, 503);
  let b; try { b = await request.json(); } catch { return json({ error: 'richiesta non valida' }, 400); }
  const lista = Array.isArray(b.giacenze) ? b.giacenze : [];
  if (!lista.length || lista.length > 3000) return json({ error: 'invia da 1 a 3000 righe in "giacenze"' }, 400);
  const tiktok = b.tiktok !== false && configurato(env);
  const d = await db(env);
  const ora = new Date().toISOString();
  const esito = { salvati: 0, scartati: [], nonSulSito: [] };
  const istr = [];
  for (const g of lista) {
    const qty = Math.floor(Number(g.qty));
    let slug = g.slug && SLUGS.has(g.slug) ? g.slug : PER_CODICE[norm(g.codice || g.modello)];
    if (!slug && (g.codice || g.slug)) { slug = g.slug || nuovoSlug(g.marca, g.codice); esito.nonSulSito.push(slug); }
    if (!slug || !Number.isFinite(qty) || qty < 0) { esito.scartati.push(g.codice || g.slug || '?'); continue; }
    const dati = {}; for (const k of CAMPI) if (g[k] !== undefined && g[k] !== '') dati[k] = g[k];
    const prezzo = Number.isFinite(Number(g.prezzo)) && Number(g.prezzo) > 0 ? Math.round(Number(g.prezzo)) : null;
    istr.push(d.prepare(`INSERT INTO giacenze(slug, codice, qty, prezzo, dati, aggiornata, tt_da_sync) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(slug) DO UPDATE SET qty=excluded.qty, codice=COALESCE(excluded.codice, codice),
        prezzo=COALESCE(excluded.prezzo, prezzo), dati=CASE WHEN excluded.dati='{}' THEN dati ELSE excluded.dati END,
        aggiornata=excluded.aggiornata,
        tt_da_sync=CASE WHEN ?=1 AND (tt_product IS NOT NULL OR excluded.qty > 0) THEN 1 ELSE tt_da_sync END`)
      .bind(slug, g.codice || null, qty, prezzo, JSON.stringify(dati), ora, tiktok && qty > 0 ? 1 : 0, tiktok ? 1 : 0));
    esito.salvati++;
  }
  for (let i = 0; i < istr.length; i += 100) await d.batch(istr.slice(i, i + 100));
  esito.daSincronizzareTikTok = tiktok ? (await d.prepare('SELECT COUNT(*) n FROM giacenze WHERE tt_da_sync=1').first()).n : 0;
  if (tiktok) waitUntil(sincronizza(env, new URL(request.url).origin, { limite: 40 }).catch(() => {}));
  // ricostruisce il sito (pagine, feed Google/Meta/WhatsApp, checkout) con i valori nuovi: deploy hook di Cloudflare Pages
  esito.ricostruzione = await ricostruisci(env, b.ricostruisci !== false && esito.salvati > 0);
  // primo invio dall'app (fine inventario): da qui in poi le vendite TikTok scalano anche il magazzino dell'app
  if (!(await getImp(env, 'tiktok_scarico_da').catch(() => null))) await setImp(env, 'tiktok_scarico_da', Date.now()).catch(() => {});
  return json(esito);
}

// Deploy hook (Cloudflare Pages → Impostazioni → Build → Deploy hooks), salvato nella variabile DEPLOY_HOOK_URL.
// Più invii ravvicinati: Cloudflare mette i build in coda e l'ultimo usa i valori più recenti.
async function ricostruisci(env, si) {
  if (!si) return 'non richiesta';
  if (!env.DEPLOY_HOOK_URL) return 'manca DEPLOY_HOOK_URL';
  try { const r = await fetch(env.DEPLOY_HOOK_URL, { method: 'POST' }); return r.ok ? 'avviata' : 'errore ' + r.status; }
  catch (e) { return 'errore: ' + e.message; }
}
