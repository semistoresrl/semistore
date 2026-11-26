// Marketplace su piattaforma Mirakl (Leroy Merlin, e molti altri: Carrefour, Decathlon, Brico…): uno solo per tutti.
// Si aggiungono da Impostazioni → Marketplace e spedizioni con nome, indirizzo API e chiave del negozio: nessuna modifica al codice.
// Ordini: OR11 (in attesa di accettazione / da spedire). Evadere = etichetta col nostro corriere + OR23 tracciamento + OR24 spedito.
import { chiamaJson, eur } from './comune.js';
import { creaEtichetta } from './corriere.js';

export const stato = (m) => (m?.url && m?.apiKey ? { ok: true, testo: 'Collegato (Mirakl): ordini e tracciamento automatici' } : { ok: false, testo: 'Da collegare: indirizzo API e chiave del negozio' });
const base = (m) => String(m.url || '').replace(/\/+$/, '').replace(/\/api$/, '') + '/api';
const h = (m) => ({ authorization: m.apiKey, accept: 'application/json', 'content-type': 'application/json' });
const STATI = { WAITING_ACCEPTANCE: 'Da confermare', WAITING_DEBIT: 'Da confermare', WAITING_DEBIT_PAYMENT: 'Da confermare', SHIPPING: 'Confermato',
  SHIPPED: 'Spedito', TO_COLLECT: 'Spedito', RECEIVED: 'Consegnato', CLOSED: 'Consegnato' };

function normale(m, o) {
  const c = o.customer || {}, a = c.shipping_address || {};
  return {
    canale: m.id, canaleNome: m.nome, rif: o.order_id, at: Date.parse(o.created_date) || Date.now(),
    stato: STATI[o.order_state] || 'Confermato', annullato: ['CANCELED', 'REFUSED'].includes(o.order_state),
    cliente: [a.firstname || c.firstname, a.lastname || c.lastname].filter(Boolean).join(' ') || 'Cliente ' + m.nome, azienda: a.company || '',
    tel: a.phone || a.phone_secondary || '', email: c.email || o.customer_notification_email || '',
    ind: [a.street_1, a.street_2].filter(Boolean).join(', '), cap: a.zip_code || '', citta: a.city || '', prov: String(a.state || '').slice(0, 2).toUpperCase(), paese: (a.country_iso_code || 'ITA').slice(0, 2) === 'IT' ? 'IT' : (a.country_iso_code || 'IT').slice(0, 2),
    righe: (o.order_lines || []).map((l) => ({ codice: l.offer_sku || l.product_sku, descr: String(l.product_title || '').slice(0, 160), qty: Number(l.quantity) || 1, prezzo: eur((Number(l.total_price ?? l.price) || 0) / (Number(l.quantity) || 1)), lineId: l.order_line_id })),
    totale: eur(o.total_price), spedizione: eur(o.shipping_price), metodo: m.nome,
    mp: { statoMirakl: o.order_state, righe: (o.order_lines || []).map((l) => l.order_line_id), entro: o.shipping_deadline || '' },
  };
}

export async function ordini(env, m, dal) {
  if (!stato(m).ok) return [];
  const da = new Date(dal || Date.now() - 30 * 864e5).toISOString();
  const out = [];
  for (let off = 0; off < 1000; off += 100) {
    const j = await chiamaJson(`${base(m)}/orders?start_date=${encodeURIComponent(da)}&max=100&offset=${off}`, { headers: h(m) }, m.nome);
    for (const o of j.orders || []) out.push(normale(m, o));
    if ((j.orders || []).length < 100) break;
  }
  return out;
}

async function leggi(m, id) {
  const j = await chiamaJson(`${base(m)}/orders?order_ids=${encodeURIComponent(id)}`, { headers: h(m) }, m.nome);
  const o = (j.orders || [])[0]; if (!o) throw new Error('ordine non trovato su ' + m.nome); return o;
}

// accettare l'ordine (OR21): su Mirakl va fatto entro la scadenza, poi l'ordine passa "da spedire"
export async function accetta(env, m, ordine) {
  const o = await leggi(m, ordine.rif);
  if (o.order_state !== 'WAITING_ACCEPTANCE') return { gia: true, stato: o.order_state };
  await chiamaJson(`${base(m)}/orders/${encodeURIComponent(ordine.rif)}/accept`, { method: 'PUT', headers: h(m), body: JSON.stringify({ order_lines: (o.order_lines || []).map((l) => ({ id: l.order_line_id, accepted: true })) }) }, m.nome);
  return { ok: true };
}

export async function evadi(env, ordine, opz = {}) {
  const m = opz.mercato;
  if (!stato(m).ok) throw new Error(m?.nome + ' non collegato: inserisci indirizzo API e chiave in Impostazioni → Marketplace e spedizioni');
  const o = await leggi(m, ordine.rif);
  if (o.order_state === 'WAITING_ACCEPTANCE') throw new Error('ordine da accettare prima su ' + m.nome + ' (tasto Accetta)');
  if (['CANCELED', 'REFUSED'].includes(o.order_state)) throw new Error('ordine annullato su ' + m.nome + ': non spedire');
  if (o.order_state !== 'SHIPPING' && !opz.ristampa) throw new Error(`${m.nome}: ordine non da spedire (stato ${o.order_state})`);
  const et = opz.etichetta || (await creaEtichetta(env, opz.conti?.corriere, ordine, opz));
  if (et.indirizzo && !opz.tracking) return { ...et, daConfermare: true, nota: 'Scrivi il tracking: lo mando io a ' + m.nome };
  const trk = String(opz.tracking || et.tracking).split(' ')[0], cor = opz.corriere || et.corriere;
  if (o.order_state === 'SHIPPING') {
    await chiamaJson(`${base(m)}/orders/${encodeURIComponent(ordine.rif)}/tracking`, { method: 'PUT', headers: h(m),
      body: JSON.stringify({ carrier_name: cor || 'Corriere', tracking_number: trk, ...(et.trackUrl ? { carrier_url: et.trackUrl } : {}), ...(m.codiciCorriere?.[cor] ? { carrier_code: m.codiciCorriere[cor] } : {}) }) }, m.nome + ' tracciamento');
    await chiamaJson(`${base(m)}/orders/${encodeURIComponent(ordine.rif)}/ship`, { method: 'PUT', headers: h(m) }, m.nome + ' spedito');
  }
  return { ...et, tracking: opz.tracking || et.tracking, corriere: cor, nota: 'Tracciamento inviato a ' + m.nome + ', ordine segnato come spedito', evaso: { marketplace: true } };
}
