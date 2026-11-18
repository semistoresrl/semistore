// POST (ADMIN_TOKEN): lavora il prossimo blocco della coda TikTok. Ripetere finché restanti = 0.
// Con { "tutti": true } rimette in coda tutti i prodotti (es. dopo aver cambiato il ricarico).
// Con { "riprova": true } rimette in coda quelli finiti in errore.
import { db, json, admin } from '../../_lib/db.js';
import { configurato } from '../../_lib/tiktok.js';
import { sincronizza } from '../../_lib/sincronizza.js';

export async function onRequestPost({ request, env }) {
  if (!admin(request, env)) return json({ error: 'non autorizzato' }, 401);
  if (!configurato(env)) return json({ error: 'TikTok non configurato (TIKTOK_APP_KEY, TIKTOK_APP_SECRET, DB)' }, 503);
  const b = await request.json().catch(() => ({}));
  const d = await db(env);
  if (b.tutti) await d.prepare('UPDATE giacenze SET tt_da_sync=1 WHERE qty > 0 OR tt_product IS NOT NULL').run();
  if (b.riprova) await d.prepare("UPDATE giacenze SET tt_da_sync=1 WHERE tt_stato='errore'").run();
  try { return json(await sincronizza(env, new URL(request.url).origin, { limite: 40 })); }
  catch (e) { return json({ error: e.message }, 502); }
}
