// Manda la risposta automatica per un'email appena arrivata (la chiama il Worker della posta).
// Non serve un segreto: agisce solo su un'email salvata da meno di un'ora, una volta sola, e risponde solo al suo mittente.
import { autoPerEmail } from '../../_lib/postacf.js';
export async function onRequestPost({ request, env }) {
  const { id } = await request.json().catch(() => ({}));
  if (!env.DB || !/^[0-9a-f-]{36}$/.test(String(id || ''))) return new Response('{}', { status: 400 });
  const esito = await autoPerEmail(env, id).catch((e) => 'errore: ' + e.message);
  return new Response(JSON.stringify({ esito }), { headers: { 'content-type': 'application/json' } });
}
