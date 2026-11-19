// Copertina dei video YouTube servita dal nostro dominio: il browser del visitatore non contatta Google
// finché non preme play (niente trasferimento dell'IP a terzi senza scelta dell'utente).
export async function onRequestGet({ params, request }) {
  const id = String(params.id || '').replace(/\.jpg$/, '');
  if (!/^[\w-]{6,20}$/.test(id)) return new Response('no', { status: 400 });
  const cache = caches.default, key = new Request(new URL(request.url).toString());
  const hit = await cache.match(key); if (hit) return hit;
  const r = await fetch(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`);
  if (!r.ok) return new Response('no', { status: 404 });
  const res = new Response(r.body, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=2592000' } });
  await cache.put(key, res.clone()); return res;
}
