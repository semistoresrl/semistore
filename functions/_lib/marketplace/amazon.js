// Amazon (Selling Partner API, ordini spediti dal venditore - MFN). Evadere = etichetta col nostro corriere
// + conferma di spedizione con tracking su Amazon (confirmShipment). Gli ordini "Non spediti" entrano da soli in Ordini online.
// Conto: clientId, clientSecret, refreshToken (app SP-API autorizzata dal negozio "SemiStore Casavatore").
// Per nome e indirizzo del cliente Amazon chiede il ruolo "Direct-to-Consumer Shipping": senza, l'ordine entra con città e CAP
// e l'indirizzo completo resta in Seller Central.
import { chiamaJson, eur, attendi } from './comune.js';
import { creaEtichetta } from './corriere.js';

const SP = 'https://sellingpartnerapi-eu.amazon.com';
const IT = 'APJ6JRA9NG5V4';
export const info = { id: 'amazon', nome: 'Amazon', etichettaDalMarketplace: false, pannello: 'https://sellercentral.amazon.it/orders-v3' };
export const stato = (c) => (c?.clientId && c?.clientSecret && c?.refreshToken ? { ok: true, testo: 'Collegato: ordini e conferma spedizione automatici' } : { ok: false, testo: 'Da collegare: in attesa dell\'approvazione del negozio e delle chiavi SP-API' });

const cache = new Map();
async function token(c) {
  const t = cache.get(c.clientId);
  if (t && t.scade > Date.now() + 60000) return t.v;
  const j = await chiamaJson('https://api.amazon.com/auth/o2/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: c.refreshToken, client_id: c.clientId, client_secret: c.clientSecret }) }, 'Amazon accesso');
  cache.set(c.clientId, { v: j.access_token, scade: Date.now() + (Number(j.expires_in) || 3600) * 1000 });
  return j.access_token;
}
async function sp(c, metodo, path, body, tok) {
  for (let i = 0; i < 4; i++) {
    try {
      return await chiamaJson(SP + path, { method: metodo, headers: { 'x-amz-access-token': tok || (await token(c)), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }, 'Amazon');
    } catch (e) { if (e.status === 429 && i < 3) { await attendi(1500 * (i + 1)); continue; } throw e; }
  }
}
// token per i dati del cliente (nome, indirizzo, telefono): se il ruolo non c'è si va avanti senza
async function rdt(c, path) {
  try {
    const j = await sp(c, 'POST', '/tokens/2021-03-01/restrictedDataToken', { restrictedResources: [{ method: 'GET', path, dataElements: ['buyerInfo', 'shippingAddress'] }] });
    return j.restrictedDataToken;
  } catch { return null; }
}

function normale(o, righe) {
  const a = o.ShippingAddress || {};
  const st = o.OrderStatus;
  return {
    canale: 'amazon', canaleNome: 'Amazon', rif: o.AmazonOrderId, at: Date.parse(o.PurchaseDate) || Date.now(),
    stato: st === 'Shipped' ? 'Spedito' : st === 'Pending' ? 'Da confermare' : 'Confermato', annullato: st === 'Canceled',
    cliente: a.Name || o.BuyerInfo?.BuyerName || 'Cliente Amazon', tel: a.Phone || '', email: o.BuyerInfo?.BuyerEmail || '',
    ind: [a.AddressLine1, a.AddressLine2, a.AddressLine3].filter(Boolean).join(', '), cap: a.PostalCode || '', citta: a.City || '', prov: String(a.StateOrRegion || '').slice(0, 2).toUpperCase(), paese: a.CountryCode || 'IT',
    righe: righe.map((r) => ({ codice: r.SellerSKU || r.ASIN, descr: String(r.Title || '').slice(0, 160), qty: Number(r.QuantityOrdered) || 1, prezzo: eur((Number(r.ItemPrice?.Amount) || 0) / (Number(r.QuantityOrdered) || 1)), lineId: r.OrderItemId })),
    totale: eur(o.OrderTotal?.Amount), spedizione: eur(righe.reduce((s, r) => s + (Number(r.ShippingPrice?.Amount) || 0), 0)), metodo: 'Amazon',
    mp: { righe: righe.map((r) => ({ orderItemId: r.OrderItemId, quantity: Number(r.QuantityOrdered) || 1 })), entro: o.LatestShipDate || '', prime: !!o.IsPrime },
  };
}

export async function ordini(env, c, dal) {
  if (!stato(c).ok) return [];
  const da = new Date(dal || Date.now() - 30 * 864e5).toISOString();
  const base = `/orders/v0/orders?MarketplaceIds=${IT}&FulfillmentChannels=MFN&CreatedAfter=${encodeURIComponent(da)}&OrderStatuses=Unshipped,PartiallyShipped,Shipped,Canceled`;
  const tok = await rdt(c, '/orders/v0/orders');
  const out = []; let next = '';
  for (let i = 0; i < 10; i++) {
    const j = await sp(c, 'GET', base + (next ? '&NextToken=' + encodeURIComponent(next) : ''), null, tok);
    for (const o of j.payload?.Orders || []) {
      const it = await sp(c, 'GET', `/orders/v0/orders/${o.AmazonOrderId}/orderItems`);
      out.push(normale(o, it.payload?.OrderItems || []));
    }
    next = j.payload?.NextToken; if (!next) break;
  }
  return out;
}

const CODICI = { BRT: 'BRT', GLS: 'GLS', SDA: 'SDA', Poste: 'Poste Italiane', DHL: 'DHL', UPS: 'UPS', TNT: 'TNT', InPost: 'InPost', FedEx: 'FedEx' };

export async function evadi(env, ordine, opz = {}) {
  const c = opz.conti?.amazon;
  if (!stato(c).ok) throw new Error('Amazon non collegato: inserisci le chiavi SP-API in Impostazioni → Marketplace e spedizioni');
  const j = await sp(c, 'GET', `/orders/v0/orders/${encodeURIComponent(ordine.rif)}`);
  const st = j.payload?.OrderStatus;
  if (st === 'Canceled') throw new Error('ordine annullato su Amazon: non spedire');
  if (st === 'Pending') throw new Error('Amazon non ha ancora confermato il pagamento: aspetta');
  if (st === 'Shipped' && !opz.ristampa) throw new Error('già confermato come spedito su Amazon: usa Ristampa');
  const et = opz.etichetta || (await creaEtichetta(env, opz.conti?.corriere, ordine, opz));
  if (et.indirizzo && !opz.tracking) return { ...et, daConfermare: true, nota: 'Scrivi il tracking: lo mando io ad Amazon' };
  const trk = opz.tracking || et.tracking, cor = opz.corriere || et.corriere;
  let righe = ordine.mp?.righe;
  if (!righe?.length) righe = ((await sp(c, 'GET', `/orders/v0/orders/${ordine.rif}/orderItems`)).payload?.OrderItems || []).map((r) => ({ orderItemId: r.OrderItemId, quantity: Number(r.QuantityOrdered) || 1 }));
  await sp(c, 'POST', `/orders/v0/orders/${encodeURIComponent(ordine.rif)}/shipmentConfirmation`, {
    marketplaceId: IT, packageDetail: { packageReferenceId: '1', carrierCode: CODICI[cor] || cor || 'Other', ...(CODICI[cor] ? {} : { carrierName: cor || 'Corriere' }),
      trackingNumber: String(trk).split(' ')[0], shipDate: new Date().toISOString(), orderItems: righe } });
  return { ...et, tracking: trk, corriere: cor, nota: 'Spedizione confermata su Amazon con il tracciamento', evaso: { marketplace: true } };
}
