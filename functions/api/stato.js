// Stato riparazione.
// GET  /api/stato?scheda=AS-2026-0142&tel=333...  -> pubblico, risponde solo se telefono coincide
// POST /api/stato  (header Authorization: Bearer ADMIN_TOKEN)
//      body JSON {scheda, telefono, stato, nota}    -> usato dall'app interna per aggiornare
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const STATI = ['Ricevuto', 'In diagnosi', 'Preventivo inviato', 'Attesa ricambi', 'In riparazione', 'Pronto', 'Consegnato'];
const norm = (t) => String(t || '').replace(/\D/g, '').slice(-9);
const key = (s) => 'scheda:' + String(s || '').trim().toUpperCase();

// Prima guarda l'archivio dell'app sul sito (D1): schede (AS-…) e richieste online (WEB-…).
const PACCO = { 'ritiro da prenotare': 'Richiesta ricevuta: ti contattiamo per il giorno del ritiro', 'ritiro prenotato': 'Ritiro prenotato', 'in attesa del pacco': 'Richiesta ricevuta: aspettiamo il tuo pacco', 'arrivato': 'Pacco arrivato in laboratorio' };
async function daArchivio(env, scheda, tel) {
  if (!env.DB) return null;
  const s = String(scheda || '').trim().toUpperCase();
  try {
    if (s.startsWith('WEB-')) {
      const r = await env.DB.prepare("SELECT d FROM docs WHERE c='richieste' AND id=?").bind(s).first();
      const v = r && JSON.parse(r.d); if (!v || !norm(v.tel) || norm(v.tel) !== norm(tel)) return null;
      if (v.ticketNum) return daArchivio(env, v.ticketNum, tel);
      const p = v.pacco || {}; let nota = PACCO[p.stato] || 'Richiesta ricevuta: ti richiamiamo entro un giorno lavorativo';
      if (p.stato === 'ritiro prenotato' && p.data) nota += ` per il ${new Date(p.data).toLocaleDateString('it-IT')}${p.corriere ? ' con ' + p.corriere : ''}`;
      return { stato: 'Richiesta', nota, aggiornata: new Date(p.at || v.at).toISOString() };
    }
    const r = await env.DB.prepare("SELECT d,u FROM docs WHERE c='tickets' AND json_extract(d,'$.num')=? LIMIT 1").bind(s).first();
    const v = r && JSON.parse(r.d); if (!v || !norm(v.tel) || norm(v.tel) !== norm(tel)) return null;
    return { stato: STATI.includes(v.stato) ? v.stato : 'Ricevuto', nota: v.notaCliente || '', aggiornata: new Date(r.u).toISOString() };
  } catch (e) { return null; }
}

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  const a = await daArchivio(env, u.searchParams.get('scheda'), u.searchParams.get('tel'));
  if (a) return json(a);
  if (!env.RICHIESTE) return json({ error: 'non trovata' }, 404);
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
