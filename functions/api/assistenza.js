// Riceve le richieste di assistenza dal sito.
// - Le salva in Cloudflare KV (binding RICHIESTE) se configurato
// - Le invia per email tramite Resend se c'è RESEND_API_KEY (+ EMAIL_TO, EMAIL_FROM)
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
const CAMPI = ['modello', 'seriale', 'garanzia', 'problema', 'nome', 'telefono', 'email', 'consegna'];

export async function onRequestPost({ request, env }) {
  const fd = await request.formData();
  if (fd.get('sito_web')) return json({ id: 'ok' }); // trappola anti-spam
  const d = Object.fromEntries(CAMPI.map((k) => [k, String(fd.get(k) || '').slice(0, 2000).trim()]));
  if (!d.modello || !d.problema || !d.nome || !d.telefono || !fd.get('privacy')) return json({ error: 'campi mancanti' }, 400);
  const now = new Date();
  const id = 'WEB-' + now.toISOString().slice(2, 10).replace(/-/g, '') + '-' + crypto.randomUUID().slice(0, 4).toUpperCase();
  const rec = { id, ricevuta: now.toISOString(), stato: 'Richiesta dal sito', ...d };
  let salvata = false;
  if (env.RICHIESTE) { await env.RICHIESTE.put(`richiesta:${id}`, JSON.stringify(rec)); salvata = true; }
  if (env.RESEND_API_KEY && env.EMAIL_TO) {
    const testo = Object.entries(rec).map(([k, v]) => `${k}: ${v}`).join('\n');
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.EMAIL_FROM || 'Sito Semi Store <sito@semistore.it>', to: env.EMAIL_TO.split(','), reply_to: d.email || undefined, subject: `Assistenza ${id} · ${d.modello} · ${d.nome}`, text: testo }),
    });
    salvata = salvata || r.ok;
  }
  if (!salvata) return json({ error: 'servizio non configurato' }, 503);
  return json({ id });
}
