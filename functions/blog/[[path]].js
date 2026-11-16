export const onRequest = ({ request }) => Response.redirect(new URL('/', request.url).href, 301);
