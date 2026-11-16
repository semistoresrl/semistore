// Carrello leggerissimo nel browser (localStorage). I prezzi veri li ricalcola il server al checkout.
const KEY = 'semistore-cart';
export function read() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
function write(items) {
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch {}
  dispatchEvent(new Event('cart:change'));
}
export function add(slug, qty = 1) {
  const items = read(); const it = items.find((i) => i.slug === slug);
  if (it) it.qty = Math.min(20, it.qty + qty); else items.push({ slug, qty });
  write(items);
}
export function setQty(slug, qty) {
  let items = read();
  items = qty <= 0 ? items.filter((i) => i.slug !== slug) : items.map((i) => (i.slug === slug ? { ...i, qty: Math.min(20, qty) } : i));
  write(items);
}
export function clear() { write([]); }
export function count() { return read().reduce((n, i) => n + i.qty, 0); }
