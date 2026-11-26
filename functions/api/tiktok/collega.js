// Apri https://semistore.it/api/tiktok/collega?token=ADMIN_TOKEN dal browser in cui sei entrato in TikTok Seller Center:
// si apre la pagina di autorizzazione di TikTok Shop e, confermando, il negozio di Semi viene collegato al sito.
import { setImp, json } from '../../_lib/db.js';
import { autorizzato } from '../../_lib/gestione.js';

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  // 26/11: oltre al token, basta essere entrati nell'app di gestione come amministratore
  const conToken = env.ADMIN_TOKEN && u.searchParams.get('token') === env.ADMIN_TOKEN;
  const io = conToken ? null : await autorizzato(request, env).catch(() => null);
  if (!conToken && !(io && io.ruolo === 'admin')) return json({ error: 'non autorizzato: entra prima nell\'app di gestione come amministratore' }, 401);
  if (!env.TIKTOK_SERVICE_ID) return json({ error: 'manca la variabile TIKTOK_SERVICE_ID (Partner Center → la tua app)' }, 503);
  const state = crypto.randomUUID();
  await setImp(env, 'tiktok_state', { state, quando: Date.now() });
  return Response.redirect(`https://services.tiktokshop.com/open/authorize?service_id=${encodeURIComponent(env.TIKTOK_SERVICE_ID)}&state=${state}`, 302);
}
