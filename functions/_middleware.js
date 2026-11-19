// www.semistore.it e semistore.pages.dev -> https://semistore.it (301), così Google vede un solo indirizzo.
// Le chiamate /api/ restano dove sono (l'app interna può usare ancora semistore.pages.dev).
export async function onRequest({ request, next }) {
  const url = new URL(request.url);
  if ((url.hostname === 'www.semistore.it' || url.hostname === 'semistore.pages.dev') && !url.pathname.startsWith('/api/')) {
    url.hostname = 'semistore.it';
    url.protocol = 'https:';
    url.port = '';
    return Response.redirect(url.toString(), 301);
  }
  return next();
}
