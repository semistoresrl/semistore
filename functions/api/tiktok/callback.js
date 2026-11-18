// Indirizzo di ritorno da impostare nell'app del Partner Center: https://semistore.it/api/tiktok/callback
import { getImp, setImp } from '../../_lib/db.js';
import { sincronizza } from '../../_lib/sincronizza.js';
import { tokenDaCodice, leggiNegozio, magazzino } from '../../_lib/tiktok.js';

const pagina = (titolo, testo) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${titolo}</title><body style="font:16px system-ui;max-width:560px;margin:40px auto;padding:0 16px"><h1>${titolo}</h1><p>${testo}</p></body>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });

export async function onRequestGet({ request, env, waitUntil }) {
  const u = new URL(request.url);
  const code = u.searchParams.get('code');
  if (!code) return pagina('Collegamento non riuscito', 'TikTok non ha inviato il codice di autorizzazione.');
  const atteso = await getImp(env, 'tiktok_state');
  const stato = u.searchParams.get('state');
  const gia = await getImp(env, 'tiktok_token');
  // accetta solo un collegamento avviato da /api/tiktok/collega negli ultimi 30 minuti
  const valido = atteso && Date.now() - atteso.quando < 30 * 60000 && (stato ? stato === atteso.state : !gia?.access_token);
  if (!valido) return pagina('Collegamento non riuscito', 'Richiesta scaduta o non valida: riparti da /api/tiktok/collega.');
  try {
    await tokenDaCodice(env, code);
    await setImp(env, 'tiktok_state', null);
    const s = await leggiNegozio(env);
    let w = ''; try { w = await magazzino(env); } catch (e) { w = 'da impostare: ' + e.message; }
    waitUntil(sincronizza(env, u.origin, { limite: 30 }).catch(() => {}));
    return pagina('TikTok Shop collegato ✅', `Negozio: <b>${s.name}</b> (${s.region}). Magazzino: ${w}.<br>Da ora le giacenze caricate dall'app vanno in vendita anche su TikTok.`);
  } catch (e) {
    return pagina('Collegamento non riuscito', e.message);
  }
}
