// Dati del negozio TikTok Shop per il pannello admin (app gestione → TikTok Shop).
// Ordini e prodotti letti con l'Open API 202309 e salvati in D1. Degli ordini si tengono solo numero, date,
// stato, importi, articoli e spedizione: niente nome, telefono o indirizzo del cliente (restano su TikTok).
import { db, getImp, setImp } from './db.js';
import { chiama } from './tiktok.js';
import { ordineInApp } from './tiktok-app.js';

const INIZIO = Math.floor(Date.UTC(2026, 6, 1) / 1000); // 01/07/2026: il primo ordine è del 13/07
const cent = (v) => Math.round((Number(v) || 0) * 100);

// Collega un articolo TikTok alla riga del magazzino del sito (tabella giacenze), così una vendita TikTok scala la giacenza.
// Ordine: id SKU TikTok già collegato → id prodotto → codice uguale (maiuscole, spazi, trattini e suffisso -QW/-QZ/-XJ ignorati) → slug.
const normCod = (c) => String(c || '').toUpperCase().trim().replace(/-(QW|QZ|XJ|GB|LX|XE|KR)$/, '').replace(/[^A-Z0-9]/g, '');
export async function indiceGiacenze(d) {
  const righe = (await d.prepare("SELECT slug, codice, qty, tt_product, tt_sku, json_extract(dati,'$.modello') modello FROM giacenze").all()).results;
  const perSku = new Map(), perProd = new Map(), perCod = new Map(), perSlug = new Map();
  for (const r of righe) {
    if (r.tt_sku) perSku.set(String(r.tt_sku), r);
    if (r.tt_product) perProd.set(String(r.tt_product), r);
    for (const c of [r.codice, r.modello]) { const k = normCod(c); if (k && !perCod.has(k)) perCod.set(k, r); }
    perSlug.set(r.slug, r);
  }
  return ({ skuId, prodId, sellerSku }) => {
    if (skuId && perSku.has(String(skuId))) return { r: perSku.get(String(skuId)), come: 'collegamento TikTok' };
    if (prodId && perProd.has(String(prodId))) return { r: perProd.get(String(prodId)), come: 'collegamento TikTok' };
    for (const sku of String(sellerSku || '').split(',')) {
      const k = normCod(sku);
      if (k && perCod.has(k)) return { r: perCod.get(k), come: 'codice' };
      if (perSlug.has(sku.trim())) return { r: perSlug.get(sku.trim()), come: 'slug' };
    }
    return null;
  };
}

let pronto = false;
export async function tdb(env) {
  const d = await db(env);
  if (!pronto) {
    try { await d.batch([
      d.prepare(`CREATE TABLE IF NOT EXISTS tt_ordini (id TEXT PRIMARY KEY, creato INTEGER, aggiornato INTEGER, stato TEXT,
        totale INTEGER, spedizione INTEGER, sconti INTEGER, valuta TEXT, campione INTEGER NOT NULL DEFAULT 0, articoli TEXT,
        tracking TEXT, corriere TEXT, scadenza INTEGER, annullo TEXT, salvato TEXT)`),
      d.prepare('CREATE INDEX IF NOT EXISTS tto_creato ON tt_ordini(creato)'),
      d.prepare(`CREATE TABLE IF NOT EXISTS tt_prodotti (id TEXT PRIMARY KEY, titolo TEXT, stato TEXT, sku TEXT,
        scorte INTEGER, prezzo INTEGER, problemi TEXT, creato INTEGER, aggiornato INTEGER, visto TEXT)`),
    ]); } catch (e) { if (!/write limit|read.?only/i.test(String(e && e.message))) throw e; /* scritture finite per oggi: le tabelle ci sono già */ }
    try { await d.prepare('ALTER TABLE tt_prodotti ADD COLUMN sku_id TEXT').run(); } catch {}
    pronto = true;
  }
  return d;
}

export async function salvaOrdine(env, o) {
  const d = await tdb(env);
  const p = o.payment || {};
  const articoli = (o.line_items || []).map((li) => ({
    p: String(li.product_id || ''), s: String(li.sku_id || ''), sku: li.seller_sku || '', n: li.product_name || '',
    v: li.sku_name || '', q: Number(li.quantity) || 1, pr: cent(li.sale_price), st: li.display_status || '',
  }));
  const tr = (o.packages || []).map((x) => x.tracking_number).find(Boolean) || o.tracking_number || (o.line_items || []).map((x) => x.tracking_number).find(Boolean) || '';
  const sc = cent(p.seller_discount) + cent(p.platform_discount);
  await d.prepare(`INSERT INTO tt_ordini(id,creato,aggiornato,stato,totale,spedizione,sconti,valuta,campione,articoli,tracking,corriere,scadenza,annullo,salvato)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET aggiornato=excluded.aggiornato, stato=excluded.stato, totale=excluded.totale,
      spedizione=excluded.spedizione, sconti=excluded.sconti, campione=excluded.campione, articoli=excluded.articoli, tracking=excluded.tracking,
      corriere=excluded.corriere, scadenza=excluded.scadenza, annullo=excluded.annullo, salvato=excluded.salvato`)
    .bind(String(o.id), Number(o.create_time) || 0, Number(o.update_time) || 0, o.status || '', cent(p.total_amount), cent(p.shipping_fee), sc,
      p.currency || 'EUR', o.is_sample_order ? 1 : 0, JSON.stringify(articoli), tr, o.shipping_provider || '',
      Number(o.rts_sla_time || o.shipping_due_time || 0) || null, o.cancel_reason || null, new Date().toISOString()).run();
  await ordineInApp(env, o).catch((e) => console.log('ordine in app', o.id, e.message)); // anche in Ordini online dell'app
}

// Una pagina di ordini. filtro: {create_time_ge} per lo storico, {update_time_ge} per gli aggiornamenti.
export async function paginaOrdini(env, { pageToken, filtro, completo } = {}) {
  const stato = (await getImp(env, 'tiktok_dati')) || {};
  // la prima volta dopo l'aggiunta in "Ordini online" si rilegge tutto, così anche gli ordini vecchi entrano nell'app
  if (!filtro) filtro = completo || !stato.ordini || !stato.inApp ? { create_time_ge: INIZIO } : { update_time_ge: Math.floor(stato.ordini / 1000) - 3600 };
  const avvio = Date.now();
  const r = await chiama(env, 'POST', '/order/202309/orders/search', {
    query: { page_size: 50, sort_field: 'create_time', sort_order: 'ASC', page_token: pageToken || undefined }, body: filtro,
  });
  for (const o of r.orders || []) await salvaOrdine(env, o);
  const prossima = r.next_page_token || '';
  if (!prossima) await setImp(env, 'tiktok_dati', { ...stato, ordini: pageToken ? (stato.ordiniInizio || avvio) : avvio, ordiniInizio: null, ...(filtro.create_time_ge ? { inApp: true } : {}) });
  else if (!pageToken) await setImp(env, 'tiktok_dati', { ...stato, ordiniInizio: avvio });
  return { letti: (r.orders || []).length, totale: r.total_count ?? null, pageToken: prossima, filtro, fatto: !prossima };
}

const PUBBLICATO = ['ACTIVATE', 'LIVE', 'ACTIVE'];
const OK = ['ACTIVATE', 'LIVE', 'ACTIVE', 'SELLER_DEACTIVATED', 'DRAFT', 'DELETED'];
// Una pagina di prodotti; per quelli bloccati o rifiutati legge anche il motivo
export async function paginaProdotti(env, { pageToken } = {}) {
  const d = await tdb(env);
  const ora = new Date().toISOString();
  const stato = (await getImp(env, 'tiktok_dati')) || {};
  if (!pageToken) await setImp(env, 'tiktok_dati', { ...stato, prodottiInizio: ora });
  const r = await chiama(env, 'POST', '/product/202309/products/search', { query: { page_size: 50, page_token: pageToken || undefined }, body: {} });
  for (const p of r.products || []) {
    const skus = p.skus || [];
    const sku = skus.map((s) => s.seller_sku).filter(Boolean).join(', ');
    const scorte = skus.reduce((a, s) => a + (s.inventory || []).reduce((b, i) => b + (Number(i.quantity) || 0), 0), 0);
    const prezzo = cent(skus[0]?.price?.sale_price ?? skus[0]?.price?.tax_exclusive_price);
    let problemi = [];
    if (!OK.includes(p.status) || (p.audit?.status && p.audit.status !== 'APPROVED' && p.status !== 'ACTIVATE')) {
      try {
        const det = await chiama(env, 'GET', `/product/202309/products/${p.id}`);
        problemi = (det.audit_failed_reasons || []).flatMap((x) => [...(x.reasons || []), ...(x.suggestions || []).map((s) => 'Suggerimento: ' + s)]);
      } catch (e) { problemi = ['Motivo non leggibile: ' + e.message]; }
    }
    await d.prepare(`INSERT INTO tt_prodotti(id,titolo,stato,sku,scorte,prezzo,problemi,creato,aggiornato,visto,sku_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET titolo=excluded.titolo, stato=excluded.stato, sku=excluded.sku, scorte=excluded.scorte, prezzo=excluded.prezzo,
        problemi=excluded.problemi, aggiornato=excluded.aggiornato, visto=excluded.visto, sku_id=excluded.sku_id`)
      .bind(String(p.id), p.title || '', p.status || '', sku, scorte, prezzo, JSON.stringify(problemi), Number(p.create_time) || 0, Number(p.update_time) || 0, ora, skus[0]?.id ? String(skus[0].id) : null).run();
  }
  const prossima = r.next_page_token || '';
  if (!prossima) { // fine giro: quelli non più restituiti da TikTok sono stati cancellati
    const s = (await getImp(env, 'tiktok_dati')) || {};
    if (s.prodottiInizio) await d.prepare('DELETE FROM tt_prodotti WHERE visto < ?').bind(s.prodottiInizio).run();
    await setImp(env, 'tiktok_dati', { ...s, prodotti: Date.now(), prodottiInizio: null });
    await collegaProdotti(env).catch(() => {});
  }
  return { letti: (r.products || []).length, totale: r.total_count ?? null, pageToken: prossima, fatto: !prossima };
}

const PAGATO = ['ON_HOLD', 'AWAITING_SHIPMENT', 'PARTIALLY_SHIPPING', 'AWAITING_COLLECTION', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED'];
const NOMI_STATO = { UNPAID: 'Non pagato', ON_HOLD: 'In attesa', AWAITING_SHIPMENT: 'Da spedire', PARTIALLY_SHIPPING: 'Spedito in parte',
  AWAITING_COLLECTION: 'In attesa del corriere', IN_TRANSIT: 'In viaggio', DELIVERED: 'Consegnato', COMPLETED: 'Completato', CANCELLED: 'Annullato' };
const NOMI_PROD = { ACTIVATE: 'Pubblicato', SELLER_DEACTIVATED: 'Disattivato da te', PLATFORM_DEACTIVATED: 'Bloccato da TikTok', FREEZE: 'Sospeso',
  FAILED: 'Rifiutato', PENDING: 'In revisione', DRAFT: 'Bozza', DELETED: 'Eliminato' };

export async function riepilogo(env) {
  const d = await tdb(env);
  const ord = (await d.prepare('SELECT * FROM tt_ordini ORDER BY creato DESC').all()).results.map((o) => ({ ...o, articoli: JSON.parse(o.articoli || '[]') }));
  const prod = (await d.prepare('SELECT * FROM tt_prodotti').all()).results.map((p) => ({ ...p, problemi: JSON.parse(p.problemi || '[]') }));
  const valido = (o) => PAGATO.includes(o.stato) && !o.campione;
  const mesi = {}, stati = {}, venduti = {};
  for (const o of ord) {
    const m = new Date(o.creato * 1000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }).slice(0, 7);
    const x = (mesi[m] ||= { mese: m, ordini: 0, incasso: 0, annullati: 0, campioni: 0 });
    if (o.stato === 'CANCELLED') x.annullati++; else if (o.campione) x.campioni++; else if (valido(o)) { x.ordini++; x.incasso += o.totale; }
    stati[o.stato] = (stati[o.stato] || 0) + 1;
    if (valido(o)) for (const a of o.articoli) {
      const v = (venduti[a.p || a.sku] ||= { id: a.p, sku: a.sku, nome: a.n, pezzi: 0, incasso: 0 });
      v.pezzi += a.q; v.incasso += a.pr * a.q;
    }
  }
  const val = ord.filter(valido), incasso = val.reduce((a, o) => a + o.totale, 0);
  // da spedire: da preparare (in attesa di spedizione) + pronti con etichetta, in attesa del ritiro del corriere
  const daSpedire = ord.filter((o) => ['AWAITING_SHIPMENT', 'PARTIALLY_SHIPPING', 'AWAITING_COLLECTION'].includes(o.stato))
    .sort((a, b) => (a.scadenza || a.creato) - (b.scadenza || b.creato))
    .map((o) => ({ id: o.id, creato: o.creato, scadenza: o.scadenza, totale: o.totale, stato: NOMI_STATO[o.stato] || o.stato, pronto: o.stato === 'AWAITING_COLLECTION',
      tracking: o.tracking || '', corriere: o.corriere || '', articoli: o.articoli.map((a) => ({ nome: a.n, sku: a.sku, q: a.q })) }));
  const trova = await indiceGiacenze(d).catch(() => () => null);
  const prodotti = prod.filter((p) => p.stato !== 'DELETED').map((p) => {
    const v = venduti[p.id];
    const avvisi = [...p.problemi];
    if (!p.sku) avvisi.push('Manca lo SKU venditore (codice prodotto)');
    const g = trova({ prodId: p.id, sellerSku: p.sku });

    return { id: p.id, titolo: p.titolo, stato: p.stato, statoNome: NOMI_PROD[p.stato] || p.stato, sku: p.sku, scorte: p.scorte, prezzo: p.prezzo,
      venduti: v?.pezzi || 0, avvisi, magazzino: g ? { slug: g.r.slug, codice: g.r.codice, qty: g.r.qty, come: g.come } : null,
      pubblicato: PUBBLICATO.includes(p.stato), problema: !PUBBLICATO.includes(p.stato) && !['SELLER_DEACTIVATED', 'DRAFT'].includes(p.stato) || !p.sku };
  }).sort((a, b) => (b.problema - a.problema) || (b.venduti - a.venduti) || a.titolo.localeCompare(b.titolo));
  const s = (await getImp(env, 'tiktok_dati')) || {};
  const cq = (await d.prepare(`SELECT SUM(tt_da_sync=1) coda, SUM(tt_product IS NOT NULL AND COALESCE(tt_stato,'')<>'bozza') online, SUM(tt_stato='bozza') bozze,
      SUM(tt_stato='errore') errori, SUM(tt_product IS NULL AND qty>0) mancano FROM giacenze`).first().catch(() => null)) || {};
  const err = (await d.prepare("SELECT slug, codice, tt_errore e FROM giacenze WHERE tt_stato IN ('errore','bozza') AND tt_errore IS NOT NULL ORDER BY tt_sync DESC LIMIT 300").all().catch(() => ({ results: [] }))).results;
  const motivi = {};
  for (const x of err) { const k = String(x.e).replace(/\s+/g, ' ').slice(0, 400); (motivi[k] ||= []).push(x.codice || x.slug); }
  return {
    invio: { coda: cq.coda || 0, online: cq.online || 0, bozze: cq.bozze || 0, errori: cq.errori || 0, mancano: cq.mancano || 0,
      motivi: Object.entries(motivi).map(([m, c]) => ({ motivo: m, n: c.length, codici: c.slice(0, 12) })).sort((a, b) => b.n - a.n).slice(0, 12) },
    aggiornato: { ordini: s.ordini || null, prodotti: s.prodotti || null },
    totali: { ordini: val.length, incasso, scontrinoMedio: val.length ? Math.round(incasso / val.length) : 0,
      annullati: ord.filter((o) => o.stato === 'CANCELLED').length, campioni: ord.filter((o) => o.campione).length, primo: ord.length ? ord[ord.length - 1].creato : null },
    mesi: Object.values(mesi).sort((a, b) => a.mese.localeCompare(b.mese)),
    stati: Object.entries(stati).map(([k, n]) => ({ stato: k, nome: NOMI_STATO[k] || k, n })).sort((a, b) => b.n - a.n),
    piuVenduti: Object.values(venduti).sort((a, b) => b.pezzi - a.pezzi).slice(0, 10),
    daSpedire, prodotti,
    ultimi: ord.slice(0, 30).map((o) => ({ id: o.id, creato: o.creato, stato: NOMI_STATO[o.stato] || o.stato, totale: o.totale, campione: !!o.campione,
      articoli: o.articoli.map((a) => `${a.q > 1 ? a.q + '× ' : ''}${a.n}`).join(', '), tracking: o.tracking })),
  };
}

// Prodotto su TikTok → riga del magazzino del sito. Usato quando un articolo del magazzino non è ancora collegato:
// si cerca tra i prodotti TikTok già letti (tt_prodotti) per codice, senza chiamare TikTok.
export async function prodottoTikTokPer(d, codici) {
  const voluti = new Set(codici.map(normCod).filter(Boolean));
  if (!voluti.size) return null;
  const l = (await d.prepare("SELECT id, sku, sku_id, prezzo FROM tt_prodotti WHERE stato NOT IN ('DELETED') AND sku_id IS NOT NULL").all()).results;
  for (const p of l) if (String(p.sku || '').split(',').some((x) => voluti.has(normCod(x)))) return { product: p.id, sku: p.sku_id, prezzo: p.prezzo || null };
  return null;
}
export async function ttProdottiLetti(d) { return (await d.prepare('SELECT COUNT(*) n FROM tt_prodotti').first().catch(() => null))?.n || 0; }

// Dopo aver letto i prodotti da TikTok: collega al magazzino del sito quelli nuovi (aggiunti a mano in Seller Center)
// e li mette in coda, così giacenza e prezzo si allineano da soli.
export async function collegaProdotti(env) {
  const d = await tdb(env);
  const trova = await indiceGiacenze(d);
  const l = (await d.prepare("SELECT id, sku, sku_id FROM tt_prodotti WHERE stato NOT IN ('DELETED') AND sku_id IS NOT NULL").all()).results;
  let n = 0;
  for (const p of l) {
    const g = trova({ prodId: p.id, sellerSku: p.sku });
    if (!g || g.r.tt_product) continue;
    await d.prepare(`UPDATE giacenze SET tt_product=?, tt_sku=?, tt_esistente=1, tt_qty=NULL, tt_prezzo=NULL, tt_stato='in vendita', tt_errore=NULL, tt_da_sync=1 WHERE slug=? AND tt_product IS NULL`)
      .bind(p.id, p.sku_id, g.r.slug).run();
    n++;
  }
  return n;
}
