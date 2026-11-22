// Dati del negozio TikTok Shop per il pannello admin (app gestione → TikTok Shop).
// Ordini e prodotti letti con l'Open API 202309 e salvati in D1. Degli ordini si tengono solo numero, date,
// stato, importi, articoli e spedizione: niente nome, telefono o indirizzo del cliente (restano su TikTok).
import { db, getImp, setImp } from './db.js';
import { chiama } from './tiktok.js';

const INIZIO = Math.floor(Date.UTC(2026, 6, 1) / 1000); // 01/07/2026: il primo ordine è del 13/07
const cent = (v) => Math.round((Number(v) || 0) * 100);

let pronto = false;
export async function tdb(env) {
  const d = await db(env);
  if (!pronto) {
    await d.batch([
      d.prepare(`CREATE TABLE IF NOT EXISTS tt_ordini (id TEXT PRIMARY KEY, creato INTEGER, aggiornato INTEGER, stato TEXT,
        totale INTEGER, spedizione INTEGER, sconti INTEGER, valuta TEXT, campione INTEGER NOT NULL DEFAULT 0, articoli TEXT,
        tracking TEXT, corriere TEXT, scadenza INTEGER, annullo TEXT, salvato TEXT)`),
      d.prepare('CREATE INDEX IF NOT EXISTS tto_creato ON tt_ordini(creato)'),
      d.prepare(`CREATE TABLE IF NOT EXISTS tt_prodotti (id TEXT PRIMARY KEY, titolo TEXT, stato TEXT, sku TEXT,
        scorte INTEGER, prezzo INTEGER, problemi TEXT, creato INTEGER, aggiornato INTEGER, visto TEXT)`),
    ]);
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
}

// Una pagina di ordini. filtro: {create_time_ge} per lo storico, {update_time_ge} per gli aggiornamenti.
export async function paginaOrdini(env, { pageToken, filtro, completo } = {}) {
  const stato = (await getImp(env, 'tiktok_dati')) || {};
  if (!filtro) filtro = completo || !stato.ordini ? { create_time_ge: INIZIO } : { update_time_ge: Math.floor(stato.ordini / 1000) - 3600 };
  const avvio = Date.now();
  const r = await chiama(env, 'POST', '/order/202309/orders/search', {
    query: { page_size: 50, sort_field: 'create_time', sort_order: 'ASC', page_token: pageToken || undefined }, body: filtro,
  });
  for (const o of r.orders || []) await salvaOrdine(env, o);
  const prossima = r.next_page_token || '';
  if (!prossima) await setImp(env, 'tiktok_dati', { ...stato, ordini: pageToken ? (stato.ordiniInizio || avvio) : avvio, ordiniInizio: null });
  else if (!pageToken) await setImp(env, 'tiktok_dati', { ...stato, ordiniInizio: avvio });
  return { letti: (r.orders || []).length, totale: r.total_count ?? null, pageToken: prossima, filtro, fatto: !prossima };
}

const OK = ['ACTIVATE', 'SELLER_DEACTIVATED', 'DRAFT', 'DELETED'];
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
    await d.prepare(`INSERT INTO tt_prodotti(id,titolo,stato,sku,scorte,prezzo,problemi,creato,aggiornato,visto) VALUES(?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET titolo=excluded.titolo, stato=excluded.stato, sku=excluded.sku, scorte=excluded.scorte, prezzo=excluded.prezzo,
        problemi=excluded.problemi, aggiornato=excluded.aggiornato, visto=excluded.visto`)
      .bind(String(p.id), p.title || '', p.status || '', sku, scorte, prezzo, JSON.stringify(problemi), Number(p.create_time) || 0, Number(p.update_time) || 0, ora).run();
  }
  const prossima = r.next_page_token || '';
  if (!prossima) { // fine giro: quelli non più restituiti da TikTok sono stati cancellati
    const s = (await getImp(env, 'tiktok_dati')) || {};
    if (s.prodottiInizio) await d.prepare('DELETE FROM tt_prodotti WHERE visto < ?').bind(s.prodottiInizio).run();
    await setImp(env, 'tiktok_dati', { ...s, prodotti: Date.now(), prodottiInizio: null });
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
  const daSpedire = ord.filter((o) => ['AWAITING_SHIPMENT', 'PARTIALLY_SHIPPING'].includes(o.stato))
    .sort((a, b) => (a.scadenza || a.creato) - (b.scadenza || b.creato))
    .map((o) => ({ id: o.id, creato: o.creato, scadenza: o.scadenza, totale: o.totale, stato: NOMI_STATO[o.stato] || o.stato, articoli: o.articoli.map((a) => ({ nome: a.n, sku: a.sku, q: a.q })) }));
  const prodotti = prod.filter((p) => p.stato !== 'DELETED').map((p) => {
    const v = venduti[p.id];
    const avvisi = [...p.problemi];
    if (!p.sku) avvisi.push('Manca lo SKU venditore (codice prodotto)');
    return { id: p.id, titolo: p.titolo, stato: p.stato, statoNome: NOMI_PROD[p.stato] || p.stato, sku: p.sku, scorte: p.scorte, prezzo: p.prezzo,
      venduti: v?.pezzi || 0, avvisi, problema: !['ACTIVATE', 'SELLER_DEACTIVATED', 'DRAFT'].includes(p.stato) || !p.sku };
  }).sort((a, b) => (b.problema - a.problema) || (b.venduti - a.venduti) || a.titolo.localeCompare(b.titolo));
  const s = (await getImp(env, 'tiktok_dati')) || {};
  return {
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
