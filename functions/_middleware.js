// www.semistore.it e semistore.pages.dev -> https://semistore.it (301), così Google vede un solo indirizzo.
// Le chiamate /api/ restano dove sono (l'app interna può usare ancora semistore.pages.dev).
import { utente } from './_lib/gestione.js';
export async function onRequest({ request, next, env }) {
  const url = new URL(request.url);
  // dati dell'app interna (inventario, prezzi…): solo per chi è collegato
  if (url.pathname.startsWith('/gestione/data/') && !(await utente(request, env).catch(() => null))) return new Response('Non collegato', { status: 401 });
  if ((url.hostname === 'www.semistore.it' || url.hostname === 'semistore.pages.dev') && !url.pathname.startsWith('/api/')) {
    url.hostname = 'semistore.it';
    url.protocol = 'https:';
    url.port = '';
    return Response.redirect(url.toString(), 301);
  }
  return next();
}
