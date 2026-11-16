import { PRODOTTI } from '../_legacy.js';
export const onRequest = ({ request }) => {
  const u = new URL(request.url);
  return Response.redirect(new URL(PRODOTTI[u.searchParams.get('id')] || '/catalogo/', u.origin).href, 301);
};
