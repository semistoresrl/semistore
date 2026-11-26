// Posta in attesa (26/11): se l'archivio D1 non accetta scritture (es. scritture gratuite finite per oggi),
// il Worker "semistore-posta" non rifiuta più l'email ma la parcheggia qui (KV RICHIESTE, 30 giorni).
//  POST (dal Worker)            → parcheggia l'email grezza (solo destinatari @semistore.it, max 8 MB, max 500 in attesa)
//  GET  (amministratore)        → elenco delle email in attesa con mittente, oggetto e testo (per leggerle subito)
//  POST ?importa=1 (amministratore) → le mette nella Posta dell'app e le toglie dall'attesa
import { utente } from '../../_lib/gestione.js';
import { leggiMime, indirizzi, dec2047 } from '../../_lib/posta.js';
import { riceviEmail, DOMINIO } from '../../_lib/postacf.js';
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const PRE = 'posta-attesa:';
const bin = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return s; };
async function elenco(env) { const out = []; let cursor; do { const r = await env.RICHIESTE.list({ prefix: PRE, cursor }); out.push(...r.keys); cursor = r.list_complete ? null : r.cursor; } while (cursor && out.length < 2000); return out; }
async function admin(request, env) { try { const io = await utente(request, env); return io && io.ruolo === 'admin' ? io : null; } catch { return null; } }
export async function onRequestPost({ request, env }) {
  if (!env.RICHIESTE) return json({ error: 'KV non collegato' }, 503);
  const u = new URL(request.url);
  if (u.searchParams.get('importa')) {
    if (!(await admin(request, env))) return json({ error: 'solo amministratore' }, 403);
    const ks = await elenco(env); let ok = 0, err = '';
    for (const k of ks) {
      const raw = await env.RICHIESTE.get(k.name, 'arrayBuffer'); if (!raw) continue;
      try { await riceviEmail(env, raw, { da: k.metadata?.da, a: k.metadata?.a }); await env.RICHIESTE.delete(k.name); ok++; }
      catch (e) { err = e.message; break; }
    }
    return json({ ok, rimaste: ks.length - ok, errore: err });
  }
  const a = String(request.headers.get('x-a') || '').toLowerCase();
  if (!a.endsWith('@' + DOMINIO)) return json({ error: 'destinatario non valido' }, 400);
  const raw = await request.arrayBuffer();
  if (!raw.byteLength || raw.byteLength > 8_000_000) return json({ error: 'dimensione non valida' }, 400);
  if ((await elenco(env)).length >= 500) return json({ error: 'troppe email in attesa' }, 507);
  const k = PRE + Date.now() + ':' + crypto.randomUUID().slice(0, 8);
  await env.RICHIESTE.put(k, raw, { expirationTtl: 30 * 86400, metadata: { da: String(request.headers.get('x-da') || '').slice(0, 200), a, at: Date.now(), dim: raw.byteLength } });
  return json({ ok: true });
}
export async function onRequestGet({ request, env }) {
  if (!(await admin(request, env))) return json({ error: 'solo amministratore' }, 403);
  if (!env.RICHIESTE) return json({ email: [] });
  const ks = await elenco(env), email = [];
  for (const k of ks.slice(-60).reverse()) {
    const raw = await env.RICHIESTE.get(k.name, 'arrayBuffer'); if (!raw) continue;
    try {
      const x = leggiMime(bin(new Uint8Array(raw))), h = x.h || {};
      const da = indirizzi(h.from)[0] || { email: k.metadata?.da || '' };
      const testo = (x.testo || String(x.html || '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
      email.push({ k: k.name, a: k.metadata?.a || '', da: da.nome ? da.nome + ' <' + da.email + '>' : da.email, oggetto: dec2047(h.subject || ''), at: k.metadata?.at || 0, testo: testo.slice(0, 4000) });
    } catch (e) { email.push({ k: k.name, a: k.metadata?.a || '', da: k.metadata?.da || '', oggetto: '(non leggibile)', at: k.metadata?.at || 0, testo: '' }); }
  }
  return json({ n: ks.length, email });
}
