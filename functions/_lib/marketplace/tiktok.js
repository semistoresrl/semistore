// TikTok Shop: evadere un ordine dal pannello = fare quello che si fa in Seller Center con "Organizza spedizione" + "Stampa etichetta".
// Spedizione TikTok (BRT tramite piattaforma): Ship Package con ritiro (PICKUP) o consegna al punto (DROP_OFF), poi l'etichetta PDF A6.
// Spedizione del venditore (SEND_BY_SELLER): etichetta col nostro corriere e tracking inviato a TikTok con Ship Package.
// Se l'ordine è già "In attesa di ritiro" si ristampa e basta.
import { chiama, configurato } from '../tiktok.js';
import { salvaOrdine } from '../tiktok-dati.js';
import { attendi } from './comune.js';
import { creaEtichetta } from './corriere.js';

export const info = { id: 'tiktok', nome: 'TikTok Shop', etichettaDalMarketplace: true, pannello: 'https://seller-eu.tiktok.com/order' };
export const stato = (env) => (configurato(env) ? { ok: true, testo: 'Collegato: etichette BRT di TikTok' } : { ok: false, testo: 'Non configurato (TIKTOK_APP_KEY / SECRET)' });

async function dettaglio(env, id) {
  const d = await chiama(env, 'GET', '/order/202309/orders', { query: { ids: String(id) } });
  const o = (d.orders || [])[0];
  if (!o) throw new Error('ordine non trovato su TikTok');
  return o;
}

async function pacco(env, pid) { try { return await chiama(env, 'GET', `/fulfillment/202309/packages/${pid}`); } catch { return null; } }

async function documento(env, pid, formato) {
  let ultimo;
  for (let i = 0; i < 5; i++) { // subito dopo "Ship Package" TikTok impiega qualche secondo a preparare l'etichetta
    try {
      const d = await chiama(env, 'GET', `/fulfillment/202309/packages/${pid}/shipping_documents`, { query: { document_type: 'SHIPPING_LABEL', document_size: formato === 'A5' ? 'A5' : 'A6' } });
      if (d.doc_url) {
        const r = await fetch(d.doc_url);
        if (!r.ok) throw new Error('etichetta TikTok non scaricabile (HTTP ' + r.status + ')');
        return { pdf: new Uint8Array(await r.arrayBuffer()), tracking: d.tracking_number || '' };
      }
    } catch (e) { ultimo = e; }
    await attendi(1500 + i * 1000);
  }
  throw new Error('TikTok non ha ancora preparato l\'etichetta: riprova tra un minuto' + (ultimo ? ' (' + ultimo.message + ')' : ''));
}

async function spedisciTikTok(env, pid, preferito) {
  let body = { handover_method: preferito || 'PICKUP' };
  try {
    const s = await chiama(env, 'GET', `/fulfillment/202309/packages/${pid}/handover_time_slots`);
    const ritiro = s.can_pickup !== false, punto = !!s.can_drop_off;
    const metodo = preferito === 'DROP_OFF' && punto ? 'DROP_OFF' : ritiro ? 'PICKUP' : punto ? 'DROP_OFF' : preferito || 'PICKUP';
    body = { handover_method: metodo };
    const slot = (s.pickup_slots || []).find((x) => x.avaliable !== false && x.available !== false);
    if (metodo === 'PICKUP' && slot) body.pickup_slot = { start_time: slot.start_time, end_time: slot.end_time };
  } catch { /* fasce orarie non previste in questo mercato: si spedisce col metodo predefinito */ }
  try { await chiama(env, 'POST', `/fulfillment/202309/packages/${pid}/ship`, { body }); }
  catch (e) {
    if (/already|shipped|status/i.test(e.message)) return body.handover_method; // già organizzata
    if (body.pickup_slot || body.handover_method) { await chiama(env, 'POST', `/fulfillment/202309/packages/${pid}/ship`, { body: {} }); return 'predefinito'; }
    throw e;
  }
  return body.handover_method;
}

// opz: { formato:'A6'|'A5', consegna:'PICKUP'|'DROP_OFF', ristampa, conti }
export async function evadi(env, ordine, opz = {}) {
  if (!configurato(env)) throw new Error('TikTok Shop non configurato');
  const o = await dettaglio(env, ordine.rif);
  if (o.status === 'CANCELLED') throw new Error('ordine annullato su TikTok: non spedire');
  if (o.status === 'UNPAID' || o.status === 'ON_HOLD') throw new Error('ordine non ancora spedibile su TikTok (' + o.status + ')');
  if ((o.line_items || []).some((li) => li.is_cancel_requested || li.cancel_user)) throw new Error('il cliente ha chiesto l\'annullamento: decidi prima in Seller Center');
  const pacchi = [...new Set((o.packages || []).map((p) => p.id).filter(Boolean))];
  if (!pacchi.length) throw new Error('TikTok non ha ancora creato il pacco per questo ordine: aprilo in Seller Center');
  const venditore = o.delivery_option_type === 'SEND_BY_SELLER' || o.shipping_type === 'SELLER';
  const pdfs = [], tracking = []; let corriere = o.shipping_provider || '', consegna = '';
  for (const pid of pacchi) {
    if (venditore) {
      if (o.status === 'AWAITING_SHIPMENT' || o.status === 'PARTIALLY_SHIPPING') {
        const et = await creaEtichetta(env, opz.conti?.corriere, ordine, opz);
        if (et.indirizzo) throw new Error('per gli ordini TikTok spediti da noi serve il corriere collegato (Sendcloud)');
        const prov = await providerTikTok(env, o.delivery_option_id, et.corriere);
        await chiama(env, 'POST', `/fulfillment/202309/packages/${pid}/ship`, { body: { self_shipment: { tracking_number: et.tracking, shipping_provider_id: prov } } });
        pdfs.push(...et.pdfs); tracking.push(et.tracking); corriere = et.corriere;
      } else throw new Error('ordine già spedito da noi: l\'etichetta è quella del nostro corriere');
      continue;
    }
    if (o.status === 'AWAITING_SHIPMENT' || o.status === 'PARTIALLY_SHIPPING') consegna = await spedisciTikTok(env, pid, opz.consegna);
    const doc = await documento(env, pid, opz.formato);
    pdfs.push(doc.pdf); if (doc.tracking) tracking.push(doc.tracking);
    const pk = await pacco(env, pid);
    if (pk?.tracking_number && !doc.tracking) tracking.push(pk.tracking_number);
    if (pk?.shipping_provider_name) corriere = pk.shipping_provider_name;
  }
  // riallineo subito lo stato (diventa "In attesa di ritiro"): archivio TikTok e Ordini online
  try { await salvaOrdine(env, await dettaglio(env, ordine.rif)); } catch {}
  return { pdfs, tracking: [...new Set(tracking)].join(' '), corriere: /brt|bartolini/i.test(corriere) ? 'BRT' : corriere, formato: opz.formato === 'A5' ? 'A5' : 'A6',
    nota: consegna === 'DROP_OFF' ? 'Da portare al punto di consegna' : 'Ritiro del corriere organizzato da TikTok', evaso: { consegna } };
}

async function providerTikTok(env, opzione, nome) {
  const d = await chiama(env, 'GET', `/logistics/202309/delivery_options/${opzione}/shipping_providers`);
  const l = d.shipping_providers || [];
  const p = l.find((x) => String(x.name || '').toLowerCase().includes(String(nome || '').toLowerCase())) || null;
  if (!p) throw new Error(`il corriere ${nome} non è tra quelli accettati da TikTok (${l.map((x) => x.name).join(', ')})`);
  return p.id;
}
