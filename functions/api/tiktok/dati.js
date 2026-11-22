// Pannello admin TikTok Shop (app gestione → TikTok Shop). Solo amministratori dell'app o ADMIN_TOKEN.
//  GET                          → riepilogo: incasso per mese, ordini per stato, più venduti, da spedire, prodotti con problemi
//  POST {azione:"ordini", pageToken?, filtro?, completo?} → importa/aggiorna una pagina di ordini (ripetere finché fatto)
//  POST {azione:"prodotti", pageToken?}                    → aggiorna una pagina di prodotti (ripetere finché fatto)
import { json } from '../../_lib/db.js';
import { autorizzato } from '../../_lib/gestione.js';
import { configurato } from '../../_lib/tiktok.js';
import { riepilogo, paginaOrdini, paginaProdotti } from '../../_lib/tiktok-dati.js';

async function controlla(request, env) {
  const u = await autorizzato(request, env);
  if (!u) return json({ error: 'non collegato' }, 401);
  if (u.ruolo !== 'admin') return json({ error: "solo per l'amministratore" }, 403);
  if (!configurato(env)) return json({ error: 'TikTok non configurato (TIKTOK_APP_KEY, TIKTOK_APP_SECRET, DB)' }, 503);
  return null;
}

export async function onRequestGet({ request, env }) {
  const no = await controlla(request, env); if (no) return no;
  try { return json(await riepilogo(env)); } catch (e) { return json({ error: e.message }, 500); }
}

export async function onRequestPost({ request, env }) {
  const no = await controlla(request, env); if (no) return no;
  const b = await request.json().catch(() => ({}));
  try {
    if (b.azione === 'ordini') return json(await paginaOrdini(env, { pageToken: b.pageToken, filtro: b.filtro, completo: !!b.completo }));
    if (b.azione === 'prodotti') return json(await paginaProdotti(env, { pageToken: b.pageToken }));
    return json({ error: 'azione non valida' }, 400);
  } catch (e) { return json({ error: e.message }, 502); }
}
