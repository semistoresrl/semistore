// Stato riparazione.
// GET  /api/stato?scheda=AS-2026-0142&tel=333...  -> pubblico, risponde solo se telefono coincide
// POST /api/stato  (header Authorization: Bearer ADMIN_TOKEN)
//      body JSON {scheda, telefono, stato, nota}    -> usato dall'app interna per aggiornare
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const STATI = ['Ricevuto', 'In diagnosi', 'Preventivo inviato', 'Attesa ricambi', 'In riparazione', 'Pronto', 'Consegnato'];
const norm = (t) => String(t || '').replace(/\D/g, '').slice(-9);
const key = (s) => 'scheda:' + String(s || '').trim().toUpperCase();

export async function onRequestGet({ request, env }) {
  if (!env.RICHIESTE) return json({ error: 'non configurato' }, 503);
  const u = new URL(request.url);
  const v = await env.RICHIESTE.get(key(u.searchParams.get('scheda')), 'json');
  if (!v || norm(v.telefono) !== norm(u.searchParams.get('tel')) || !norm(v.telefono)) return json({ error: 'non trovata' }, 404);
  return json({ stato: v.stato, nota: v.nota || '', aggiornata: v.aggiornata });
}

export async function onRequestPost({ request, env }) {
  if (!env.RICHIESTE || !env.ADMIN_TOKEN) return json({ error: 'non configurato' }, 503);
  if (request.headers.get('authorization') !== `Bearer ${env.ADMIN_TOKEN}`) return json({ error: 'non autorizzato' }, 401);
  const b = await request.json();
  if (!b.scheda || !STATI.includes(b.stato)) return json({ error: `stato non valido (${STATI.join(', ')})` }, 400);
  const prev = (await env.RICHIESTE.get(key(b.scheda), 'json')) || {};
  const rec = { ...prev, telefono: b.telefono || prev.telefono, stato: b.stato, nota: b.nota ?? prev.nota, aggiornata: new Date().toISOString() };
  await env.RICHIESTE.put(key(b.scheda), JSON.stringify(rec));
  return json({ ok: true });
}
