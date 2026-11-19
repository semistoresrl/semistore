// Allegati dell'app interna (foto schede, foto prodotti), salvati in D1: solo per chi è collegato.
import { gdb, utente } from '../_lib/gestione.js';
export async function onRequestGet({ request, env, params }) {
  if (!(await utente(request, env))) return new Response('Non collegato', { status: 401 });
  const d = await gdb(env);
  const f = await d.prepare('SELECT tipo, nome, dati FROM files WHERE id=?').bind(String(params.id)).first();
  if (!f) return new Response('Non trovato', { status: 404 });
  const dati = f.dati instanceof ArrayBuffer || ArrayBuffer.isView(f.dati) ? f.dati : new Uint8Array(f.dati);
  return new Response(dati, { headers: { 'content-type': f.tipo || 'application/octet-stream', 'cache-control': 'private, max-age=86400', 'content-disposition': `inline; filename="${encodeURIComponent(f.nome || 'file')}"` } });
}
