// eBay (Sell Fulfillment API). eBay Italia non dà etichette via API: evadere = etichetta col nostro corriere
// + "Aggiungi tracciamento / Segna come spedito" su eBay (shipping_fulfillment). Gli ordini pagati entrano da soli in Ordini online.
// Conto (Impostazioni → Marketplace e spedizioni): clientId, clientSecret, refreshToken (OAuth utente semistore_srl).
import { chiamaJson, eur } from './comune.js';
import { creaEtichetta } from './corriere.js';

const API = 'https://api.ebay.com';
const SCOPE = 'https://api.ebay.com/oauth/api_scope/sell.fulfillment';
export const info = { id: 'ebay', nome: 'eBay', etichettaDalMarketplace: false, pannello: 'https://www.ebay.it/sh/ord' };
export const stato = (c) => (c?.clientId && c?.clientSecret && c?.refreshToken ? { ok: true, testo: 'Collegato: ordini e tracciamento automatici' } : { ok: false, testo: 'Da collegare: servono le chiavi API eBay' });

const cache = new Map();
async function token(c) {
  const k = c.clientId, t = cache.get(k);
  if (t && t.scade > Date.now() + 60000) return t.v;
  const j = await chiamaJson(`${API}/identity/v1/oauth2/token`, { method: 'POST',
    headers: { authorization: 'Basic ' + btoa(`${c.clientId}:${c.clientSecret}`), 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: c.refreshToken, scope: SCOPE }) }, 'eBay accesso');
  cache.set(k, { v: j.access_token, scade: Date.now() + (Number(j.expires_in) || 7200) * 1000 });
  return j.access_token;
}
const h = async (c) => ({ authorization: 'Bearer ' + (await token(c)), 'content-type': 'application/json', 'x-ebay-c-marketplace-id': 'EBAY_IT', 'accept-language': 'it-IT' });

function normale(o) {
  const st = o.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo || {};
  const a = st.contactAddress || {};
  const annullato = o.cancelStatus?.cancelState === 'CANCELED' || o.orderPaymentStatus === 'FULLY_REFUNDED';
  const stato = o.orderFulfillmentStatus === 'FULFILLED' ? 'Spedito' : 'Confermato';
  return {
    canale: 'ebay', canaleNome: 'eBay', rif: o.orderId, at: Date.parse(o.creationDate) || Date.now(), stato, annullato,
    cliente: st.fullName || o.buyer?.username || 'Cliente eBay', tel: st.primaryPhone?.phoneNumber || '', email: st.email || '',
    ind: [a.addressLine1, a.addressLine2].filter(Boolean).join(', '), cap: a.postalCode || '', citta: a.city || '', prov: (a.stateOrProvince || '').slice(0, 2).toUpperCase(), paese: a.countryCode || 'IT',
    righe: (o.lineItems || []).map((li) => ({ codice: li.sku || li.legacyItemId || '', descr: String(li.title || '').slice(0, 160), qty: Number(li.quantity) || 1, prezzo: eur((Number(li.lineItemCost?.value) || 0) / (Number(li.quantity) || 1)), lineId: li.lineItemId })),
    totale: eur(o.pricingSummary?.total?.value), spedizione: eur(o.pricingSummary?.deliveryCost?.value), metodo: 'eBay',
    mp: { utente: o.buyer?.username || '', lineItems: (o.lineItems || []).map((li) => ({ lineItemId: li.lineItemId, quantity: Number(li.quantity) || 1 })), entro: o.lineItems?.[0]?.lineItemFulfillmentInstructions?.shipByDate || '' },
  };
}

// ordini pagati degli ultimi giorni (o dalla data indicata)
export async function ordini(env, c, dal) {
  if (!stato(c).ok) return [];
  const da = new Date(dal || Date.now() - 30 * 864e5).toISOString();
  const out = []; let url = `${API}/sell/fulfillment/v1/order?limit=50&filter=${encodeURIComponent(`creationdate:[${da}..]`)}`;
  for (let i = 0; url && i < 10; i++) {
    const j = await chiamaJson(url, { headers: await h(c) }, 'eBay ordini');
    for (const o of j.orders || []) if (o.orderPaymentStatus !== 'PENDING' && o.orderPaymentStatus !== 'FAILED') out.push(normale(o));
    url = j.next || '';
  }
  return out;
}

// codici corriere accettati da eBay (ShippingCarrierCodeType); per gli altri si usa il nome
const CODICI = { BRT: 'BRT', GLS: 'GLS', SDA: 'SDA', Poste: 'PosteItaliane', DHL: 'DHL', UPS: 'UPS', TNT: 'TNT', InPost: 'InPost', FedEx: 'FedEx' };

export async function evadi(env, ordine, opz = {}) {
  const c = opz.conti?.ebay;
  if (!stato(c).ok) throw new Error('eBay non collegato: inserisci le chiavi API in Impostazioni → Marketplace e spedizioni');
  const j = await chiamaJson(`${API}/sell/fulfillment/v1/order/${encodeURIComponent(ordine.rif)}`, { headers: await h(c) }, 'eBay ordine');
  if (j.cancelStatus?.cancelState === 'CANCELED') throw new Error('ordine annullato su eBay: non spedire');
  if (j.cancelStatus?.cancelRequests?.length) throw new Error('il cliente ha chiesto l\'annullamento: decidi prima su eBay');
  if (j.orderFulfillmentStatus === 'FULFILLED' && !opz.ristampa) throw new Error('già segnato come spedito su eBay: usa Ristampa');
  const et = opz.etichetta || (await creaEtichetta(env, opz.conti?.corriere, ordine, opz));
  if (et.indirizzo && !opz.tracking) return { ...et, daConfermare: true, nota: 'Scrivi il tracking: lo mando io a eBay' };
  const trk = opz.tracking || et.tracking, cor = opz.corriere || et.corriere;
  await chiamaJson(`${API}/sell/fulfillment/v1/order/${encodeURIComponent(ordine.rif)}/shipping_fulfillment`, { method: 'POST', headers: await h(c),
    body: JSON.stringify({ lineItems: (j.lineItems || []).map((li) => ({ lineItemId: li.lineItemId, quantity: Number(li.quantity) || 1 })),
      shippedDate: new Date().toISOString(), shippingCarrierCode: CODICI[cor] || cor || 'Other', trackingNumber: String(trk).split(' ')[0] }) }, 'eBay spedizione');
  return { ...et, tracking: trk, corriere: cor, nota: 'Tracciamento inviato a eBay, ordine segnato come spedito', evaso: { marketplace: true } };
}
