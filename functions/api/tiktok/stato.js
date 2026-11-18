// GET (ADMIN_TOKEN): stato del collegamento e della sincronizzazione.
// POST (ADMIN_TOKEN): { conformita: { "DEWALT": { fabbricante: "id", responsabile: "id" }, ... } } (dati GPSR per TikTok)
import { db, json, admin, getImp, setImp } from '../../_lib/db.js';
import { configurato, chiama, leggiNegozio } from '../../_lib/tiktok.js';

export async function onRequestGet({ request, env }) {
  if (!admin(request, env)) return json({ error: 'non autorizzato' }, 401);
  if (!configurato(env)) return json({ collegato: false, motivo: 'mancano TIKTOK_APP_KEY, TIKTOK_APP_SECRET o il database DB' });
  const d = await db(env);
  let t = await getImp(env, 'tiktok_token');
  const out = { collegato: !!t?.access_token };
  if (t?.access_token && !t.shop_cipher) { try { await leggiNegozio(env); t = await getImp(env, 'tiktok_token'); } catch (e) { out.errore = e.message; } }
  if (t) Object.assign(out, { negozio: t.shop_name, regione: t.region, venditore: t.seller_name, scadenzaRinnovo: t.refresh_exp ? new Date(t.refresh_exp * 1000).toISOString() : null });
  out.magazzino = await getImp(env, 'tiktok_magazzino');
  out.conformita = await getImp(env, 'tiktok_conformita');
  out.ricaricoPercento = Number(env.TIKTOK_RICARICO_PERCENTO || 0);
  out.conteggi = Object.fromEntries((await d.prepare("SELECT COALESCE(tt_stato,'non inviato') s, COUNT(*) n FROM giacenze GROUP BY 1").all()).results.map((r) => [r.s, r.n]));
  out.inCoda = (await d.prepare('SELECT COUNT(*) n FROM giacenze WHERE tt_da_sync=1').first()).n;
  out.problemi = (await d.prepare("SELECT slug, tt_stato stato, tt_errore errore FROM giacenze WHERE tt_errore IS NOT NULL ORDER BY tt_sync DESC LIMIT 50").all()).results;
  if (out.collegato && new URL(request.url).searchParams.has('gpsr')) { // elenco fabbricanti/responsabili già creati in Seller Center
    for (const [k, p] of [['fabbricanti', '/product/202409/compliance/manufacturers/search'], ['responsabili', '/product/202409/compliance/responsible_persons/search']]) {
      try { out[k] = await chiama(env, 'POST', p, { query: { page_size: 100 }, body: {} }); } catch (e) { out[k] = { errore: e.message }; }
    }
  }
  return json(out);
}

export async function onRequestPost({ request, env }) {
  if (!admin(request, env)) return json({ error: 'non autorizzato' }, 401);
  const b = await request.json().catch(() => ({}));
  if (b.conformita && typeof b.conformita === 'object') await setImp(env, 'tiktok_conformita', b.conformita);
  if (b.magazzino) await setImp(env, 'tiktok_magazzino', String(b.magazzino));
  return json({ ok: true });
}
