// Presenze sul sito per l'app interna (in diretta, per giorno). Nessun cookie e nessun indirizzo IP:
// la pagina manda un identificativo casuale del browser (localStorage) e il percorso, ogni 30 s finché è aperta.
import { gdb, json, giornoIT } from '../_lib/gestione.js';
const BOT = /bot|crawl|spider|slurp|lighthouse|headless|preview|facebookexternalhit|whatsapp|google-inspectiontool|bingpreview/i;
export async function onRequestPost({ request, env }) {
  if (!env.DB) return new Response(null, { status: 204 });
  if (BOT.test(request.headers.get('user-agent') || '')) return new Response(null, { status: 204 });
  const b = await request.json().catch(() => ({}));
  const vid = String(b.v || '').replace(/[^a-z0-9]/gi, '').slice(0, 32);
  if (vid.length < 8) return new Response(null, { status: 204 });
  const pagina = String(b.p || '/').slice(0, 120), nuova = b.n ? 1 : 0, ora = Date.now();
  const d = await gdb(env);
  await d.prepare(`INSERT INTO presenze(vid,giorno,primo,ultimo,pagine,pagina) VALUES(?,?,?,?,1,?)
    ON CONFLICT(vid,giorno) DO UPDATE SET ultimo=excluded.ultimo, pagine=pagine+?, pagina=excluded.pagina`)
    .bind(vid, giornoIT(ora), ora, ora, pagina, nuova).run();
  return new Response(null, { status: 204 });
}
export const onRequestGet = () => json({ error: 'usare POST' }, 405);
