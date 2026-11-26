// Ordini TikTok Shop → "Ordini online" dell'app gestione (archivio docs, collezione ordiniWeb), in automatico e senza doppioni.
// Un ordine TikTok = un documento con id "tt-<numero ordine TikTok>". Lo stato segue TikTok; le altre modifiche fatte
// nell'app (note, cliente, ecc.) non vengono sovrascritte.
// Magazzino dell'app: come per gli ordini inseriti a mano, gli articoli si scalano quando l'ordine diventa Pronto/Spedito/Consegnato
// e rientrano se viene annullato dopo. Solo per gli ordini nati dopo il primo invio dell'inventario dall'app (impostazione tiktok_scarico_da):
// quelli di prima sono già fuori dal conteggio dell'inventario.
import { gdb } from './gestione.js';
import { getImp } from './db.js';

const STATO = { ON_HOLD: 'Confermato', AWAITING_SHIPMENT: 'Confermato', PARTIALLY_SHIPPING: 'Confermato', AWAITING_COLLECTION: 'Pronto',
  IN_TRANSIT: 'Spedito', DELIVERED: 'Consegnato', COMPLETED: 'Consegnato', CANCELLED: 'Annullato' };
const SCALATO = ['Pronto', 'Spedito', 'Consegnato'];
const eur = (v) => Math.round((Number(v) || 0) * 100) / 100;
const json = (s) => { try { return JSON.parse(s || 'null'); } catch { return null; } };
const varianti = (c) => { const u = String(c || '').trim().toUpperCase(); if (!u) return []; const b = u.replace(/-(QW|QZ|XJ|GB|LX|XE)$/, ''); return [...new Set([u, b, b + '-QW', b + '-QZ', b + '-XJ'])]; };

export async function prossimoNumero(d, at) {
  const t = new Date(at);
  const p = 'W' + String(t.getFullYear()).slice(2) + String(t.getMonth() + 1).padStart(2, '0') + '-';
  const r = await d.prepare("SELECT MAX(CAST(substr(json_extract(d,'$.num'),?) AS INTEGER)) n FROM docs WHERE c='ordiniWeb' AND json_extract(d,'$.num') LIKE ?")
    .bind(p.length + 1, p + '%').first();
  return p + String((r?.n || 0) + 1).padStart(3, '0');
}

// sposta la giacenza nel magazzino dell'app (stessa cosa che fa "muovi" nell'app) e registra il movimento
export async function muovi(d, codice, delta, causale, rif, chi = 'TikTok Shop') {
  const v = varianti(codice); if (!v.length) return false;
  const r = await d.prepare(`SELECT docs.id ch, j.key k, json_extract(j.value,'$.codice') cod, json_extract(j.value,'$.descr') descr,
      json_extract(j.value,'$.tipo') tipo, json_extract(j.value,'$.costo') costo FROM docs, json_each(docs.d,'$.items') j
      WHERE docs.c='mag' AND upper(json_extract(j.value,'$.codice')) IN (${v.map(() => '?').join(',')}) LIMIT 1`).bind(...v).first();
  if (!r) return false;
  const now = Date.now(), base = `$.items.${JSON.stringify(r.k)}`;
  await d.batch([
    d.prepare(`UPDATE docs SET d=json_set(d, ?, COALESCE(json_extract(d, ?),0)+?, ?, ?), u=?, chi=? WHERE c='mag' AND id=?`)
      .bind(base + '.giacenza', base + '.giacenza', delta, base + '.daInviare', now, now, chi, r.ch),
    d.prepare('INSERT INTO docs(c,id,d,u,chi) VALUES(?,?,?,?,?)').bind('movimenti', 'tt' + now.toString(36) + Math.random().toString(36).slice(2, 7),
      JSON.stringify({ at: now, codice: r.cod, descr: r.descr || '', tipo: r.tipo || '', qty: delta, causale, rif, by: null, costo: Number(r.costo) || 0 }), now, chi),
  ]);
  return true;
}

export async function ordineInApp(env, o) {
  const stato = STATO[o.status];
  if (!stato) return null; // non pagato: non è ancora un ordine
  const d = await gdb(env);
  const id = 'tt-' + o.id;
  let row = await d.prepare("SELECT id, d FROM docs WHERE c='ordiniWeb' AND id=?").bind(id).first();
  if (!row) row = await d.prepare("SELECT id, d FROM docs WHERE c='ordiniWeb' AND json_extract(d,'$.canale')='tiktok' AND json_extract(d,'$.rif')=? LIMIT 1").bind(String(o.id)).first();
  const prima = json(row?.d);
  const docId = row?.id || id;
  const now = Date.now(), at = (Number(o.create_time) || 0) * 1000 || now;

  // righe: le righe TikTok sono un pezzo ciascuna, si raggruppano per SKU
  const per = new Map();
  for (const li of o.line_items || []) {
    const k = (li.seller_sku || li.sku_id || li.product_name || '') + '|' + li.sale_price;
    const x = per.get(k) || { codice: li.seller_sku || '', descr: [li.product_name, li.sku_name && li.sku_name !== 'Default' ? li.sku_name : ''].filter(Boolean).join(' · ').slice(0, 160), qty: 0, prezzo: eur(li.sale_price) };
    x.qty += Number(li.quantity) || 1; per.set(k, x);
  }
  const righe = [...per.values()];
  const sub = righe.reduce((a, r) => a + r.qty * r.prezzo, 0), tot = eur(o.payment?.total_amount), diff = eur(tot - sub);
  const tracking = (o.packages || []).map((x) => x.tracking_number).find(Boolean) || o.tracking_number || (o.line_items || []).map((x) => x.tracking_number).find(Boolean) || '';
  const corriere = o.shipping_provider || (o.line_items || []).map((x) => x.shipping_provider_name).find(Boolean) || '';

  const da = await getImp(env, 'tiktok_scarico_da').catch(() => null);
  const muoveMag = !!da && at >= Number(da);

  let g;
  if (!prima) {
    g = { canale: 'tiktok', rif: String(o.id), num: await prossimoNumero(d, at), stato: 'Confermato', at,
      cliente: o.is_sample_order ? 'Campione gratuito TikTok' : 'Cliente TikTok Shop', consegna: 'spedizione',
      righe, spedizione: diff > 0 ? diff : 0, sconto: diff < 0 ? -diff : 0, pagato: true, pagatoAt: at, metodo: 'TikTok Shop',
      note: 'Ordine TikTok ' + o.id + ' (importato in automatico). Nome e indirizzo del cliente sono nel Seller Center.',
      scaricato: !muoveMag, storico: [{ at, stato: 'Confermato', by: null }], tiktok: { stato: o.status } };
  } else g = { ...prima };
  g.tiktok = { ...(g.tiktok || {}), stato: o.status, aggiornato: Number(o.update_time) || 0 };
  if (tracking) g.tracking = tracking;
  if (corriere) g.corriere = corriere;
  if (o.rts_sla_time) g.spedireEntro = Number(o.rts_sla_time) * 1000;

  const cambio = g.stato !== stato;
  if (cambio) {
    g.stato = stato;
    g.storico = [...(g.storico || []), { at: now, stato, by: null, da: 'TikTok' }];
    if (stato === 'Spedito' && !g.speditoAt) g.speditoAt = now;
    if (stato === 'Consegnato' && !g.consegnatoAt) g.consegnatoAt = now;
  }
  // magazzino dell'app: scala a Pronto/Spedito/Consegnato, rientra se annullato dopo
  if (muoveMag && !g.scaricato && SCALATO.includes(g.stato)) {
    for (const r of g.righe || []) if (r.qty > 0) await muovi(d, r.codice, -r.qty, 'vendita tiktok shop', g.num);
    g.scaricato = true;
  } else if (muoveMag && g.scaricato && g.stato === 'Annullato' && prima) {
    for (const r of g.righe || []) if (r.qty > 0) await muovi(d, r.codice, +r.qty, 'ordine annullato', g.num);
    g.scaricato = false;
  }
  if (prima && !cambio && JSON.stringify(prima) === JSON.stringify({ ...g, updatedAt: prima.updatedAt })) return docId;
  g.updatedAt = now;
  await d.prepare('INSERT INTO docs(c,id,d,u,chi) VALUES(?,?,?,?,?) ON CONFLICT(c,id) DO UPDATE SET d=excluded.d, u=excluded.u, chi=excluded.chi')
    .bind('ordiniWeb', docId, JSON.stringify(g), now, 'TikTok Shop').run();
  return docId;
}
