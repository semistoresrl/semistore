// 23/11: filtro spam con riconoscimento dei falsi avvisi di chiusura casella (phishing) – vedi functions/_lib/postacf.js
// Riceve ogni email per @semistore.it (Email Routing → "Invia a un Worker") e la salva nell'archivio dell'app (D1).
// Se il salvataggio non riesce l'email viene rifiutata con errore, così chi scrive lo sa e nulla si perde in silenzio.
import { riceviEmail } from '../../functions/_lib/postacf.js';
export default {
  async email(message, env, ctx) {
    const raw = await new Response(message.raw).arrayBuffer();
    let r, errore = '';
    for (let i = 0; i < 3 && !r; i++) {
      try { r = await riceviEmail(env, raw, { da: message.from, a: message.to, senzaAuto: true }); }
      catch (e) { errore = e.message; await new Promise((ok) => setTimeout(ok, 500 * (i + 1))); }
    }
    if (!r) { console.log('email non salvata', message.to, errore); message.setReject('Errore temporaneo della casella, riprova più tardi'); return; }
    if (!r.doppione && r.cartella === 'arrivo') ctx.waitUntil(fetch((env.SITO || 'https://semistore.it') + '/api/posta/auto', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: r.id }) }).catch(() => {}));
  },
  async fetch() { return new Response('Posta Semi Store', { status: 404 }); },
};
