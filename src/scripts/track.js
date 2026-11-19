// Statistiche e pubblicità: Google Analytics 4 e Pixel Meta partono SOLO dopo il consenso nel banner cookie
// (provvedimento Garante privacy 10/06/2021). Senza consenso nessuno script esterno viene caricato.
// Gli eventi chiamati prima del caricamento vengono messi in coda e inviati appena gli script sono pronti.
const q = (window.__semiQ = window.__semiQ || []);

/** Evento e-commerce. nome: view_item | add_to_cart | begin_checkout | purchase */
export function track(nome, { items = [], value = 0, transaction_id } = {}) {
  q.push({ nome, items, value, transaction_id });
  if (window.__semiPronto) svuota();
}

const FB = { view_item: 'ViewContent', add_to_cart: 'AddToCart', begin_checkout: 'InitiateCheckout', purchase: 'Purchase' };

export function svuota() {
  while (q.length) {
    const e = q.shift();
    const valore = Math.round(e.value * 100) / 100;
    if (window.gtag) {
      window.gtag('event', e.nome, { currency: 'EUR', value: valore, transaction_id: e.transaction_id, items: e.items.map((i) => ({ item_id: i.id, item_name: i.nome, item_brand: i.marca, item_category: i.cat, price: i.prezzo, quantity: i.qty || 1 })) });
    }
    if (window.fbq && FB[e.nome]) {
      window.fbq('track', FB[e.nome], { currency: 'EUR', value: valore, content_type: 'product', content_ids: e.items.map((i) => i.id), contents: e.items.map((i) => ({ id: i.id, quantity: i.qty || 1 })), num_items: e.items.reduce((n, i) => n + (i.qty || 1), 0) }, e.transaction_id ? { eventID: e.transaction_id } : undefined);
    }
  }
}

/** Prodotti del carrello con prezzi (da /indice.json), per gli eventi. */
export async function itemsCarrello(cart) {
  try {
    const idx = await (await fetch('/indice.json')).json();
    const lista = Array.isArray(idx) ? idx : idx.p || idx.prodotti || [];
    const per = new Map(lista.map((v) => [v.s, v]));
    return cart.map(({ slug, qty }) => { const v = per.get(slug); return v ? { id: v.m || v.s, nome: v.n, marca: v.b, cat: v.c, prezzo: v.p / 100, qty } : null; }).filter(Boolean);
  } catch { return []; }
}
