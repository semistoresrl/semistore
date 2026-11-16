import { MARCHE } from '../_legacy.js';
export const onRequest = ({ request }) => {
  const u = new URL(request.url);
  const m = MARCHE[(u.searchParams.get('cat') || '').toUpperCase()];
  return Response.redirect(new URL(m ? `/catalogo/?marca=${m}` : '/catalogo/', u.origin).href, 301);
};
