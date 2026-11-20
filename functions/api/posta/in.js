// Ingresso della posta: lo chiama solo il Worker "semistore-posta" (Cloudflare Email Routing)
// e lo script di importazione dal vecchio server. Autorizzazione: intestazione x-posta-token = ADMIN_TOKEN (o POSTA_TOKEN).
import { riceviEmail } from '../../_lib/postacf.js';
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
async function uguali(a, b) { const e = new TextEncoder(); const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', e.encode(a)), crypto.subtle.digest('SHA-256', e.encode(b))]);
  const u = new Uint8Array(x), v = new Uint8Array(y); let r = 0; for (let i = 0; i < u.length; i++) r |= u[i] ^ v[i]; return r === 0; }
export async function onRequestPost({ request, env }) {
  const segreto = env.POSTA_TOKEN || env.ADMIN_TOKEN;
  const t = request.headers.get('x-posta-token') || '';
  if (!segreto || !t || !(await uguali(t, segreto))) return json({ error: 'non autorizzato' }, 401);
  if (!env.DB) return json({ error: 'archivio non configurato' }, 503);
  const raw = await request.arrayBuffer();
  if (!raw.byteLength) return json({ error: 'vuota' }, 400);
  const u = new URL(request.url), q = (k) => u.searchParams.get(k) || '';
  const importa = q('importa') ? { casella: q('casella') || 'info', cartella: q('cartella') || 'arrivo', letto: q('letto') === '1', data: Number(q('data')) || 0 } : null;
  try { return json({ ok: true, ...(await riceviEmail(env, raw, { da: request.headers.get('x-da'), a: request.headers.get('x-a'), importa })) }); }
  catch (e) { return json({ error: e.message || 'errore' }, 500); }
}
