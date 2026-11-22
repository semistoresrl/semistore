// Webhook TikTok Shop (Partner Center → app → Webhook, evento "Order status change"):
// https://semistore.it/api/tiktok/webhook — quando un ordine TikTok viene pagato scala la giacenza del sito,
// se viene annullato la rimette.
import { db, movimento } from '../../_lib/db.js';
import { verificaWebhook, chiama } from '../../_lib/tiktok.js';
import { salvaOrdine, indiceGiacenze } from '../../_lib/tiktok-dati.js';

const PAGATO = ['ON_HOLD', 'AWAITING_SHIPMENT', 'PARTIALLY_SHIPPING', 'AWAITING_COLLECTION', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED'];

async function gestisci(env, ordineId, stato) {
  const d = await db(env);
  const o = (await chiama(env, 'GET', '/order/202309/orders', { query: { ids: ordineId } })).orders?.[0];
  if (!o) return;
  await salvaOrdine(env, o).catch(() => {}); // pannello admin → TikTok Shop, aggiornato in tempo reale
  if (!PAGATO.includes(stato) && stato !== 'CANCELLED') return;
  const trova = await indiceGiacenze(d);
  for (const li of o.line_items || []) {
    const r = trova({ skuId: li.sku_id, prodId: li.product_id, sellerSku: li.seller_sku })?.r;
    if (!r) continue;
    const q = Number(li.quantity || 1);
    const id = `tt:${ordineId}:${li.id}`;
    if (PAGATO.includes(o.status || stato)) await movimento(env, id, 'tiktok', r.slug, -q);
    else {
      const venduto = await d.prepare('SELECT 1 FROM movimenti WHERE id=?').bind(id).first();
      if (venduto) await movimento(env, id + ':annullo', 'tiktok', r.slug, q);
    }
  }
}

export async function onRequestPost({ request, env, waitUntil }) {
  const corpo = await request.text();
  if (!(await verificaWebhook(env, corpo, request.headers.get('authorization')))) return new Response('', { status: 401 });
  let e; try { e = JSON.parse(corpo); } catch { return new Response(''); }
  if (Number(e.type) === 1 && e.data?.order_id) waitUntil(gestisci(env, String(e.data.order_id), e.data.order_status).catch(() => {}));
  return new Response(''); // TikTok vuole risposta entro 3 secondi
}
