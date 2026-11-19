// GET /api/piva?n=12345678901 → { valida, attiva, trovata, ragioneSociale, indirizzo, cap, citta, provincia }
import { cercaPiva } from '../_lib/piva.js';
export async function onRequestGet({ request, env }) {
  const n = String(new URL(request.url).searchParams.get('n') || '').replace(/\D/g, '');
  const out = await cercaPiva(env, n);
  return new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
