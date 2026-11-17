// Premio del minigioco "Trapano Slalom": chi completa il livello 8 riceve un codice sconto del 15%, valido una volta.
// POST {fase:'inizio'}            -> biglietto firmato quando parte il livello 8
// POST {fase:'fine', biglietto}   -> se il livello è durato un tempo credibile, crea il codice (uno per connessione ogni 7 giorni)
// GET  ?codice=GIOCO-XXXXXX       -> il carrello controlla se il codice è valido
// Usa il KV RICHIESTE e come segreto PREMIO_SEGRETO (se manca, ADMIN_TOKEN).
const SCONTO = 15;
const MIN_S = 25, MAX_S = 15 * 60, VALIDO_GG = 60;
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const enc = new TextEncoder();
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

async function firma(segreto, testo) {
  const k = await crypto.subtle.importKey('raw', enc.encode(segreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(testo))).slice(0, 32);
}
const nuovoCodice = () => {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', b = crypto.getRandomValues(new Uint8Array(7));
  return 'GIOCO-' + [...b].map((x) => A[x % A.length]).join('');
};
const normCodice = (c) => String(c || '').trim().toUpperCase().replace(/\s+/g, '');

export async function onRequestPost({ request, env }) {
  const segreto = env.PREMIO_SEGRETO || env.ADMIN_TOKEN;
  if (!env.RICHIESTE || !segreto) return json({ error: 'premi non attivi' }, 503);
  let b; try { b = await request.json(); } catch { return json({ error: 'richiesta non valida' }, 400); }

  if (b.fase === 'inizio') {
    const ts = String(Date.now()), n = hex(crypto.getRandomValues(new Uint8Array(6)));
    return json({ biglietto: `${ts}.${n}.${await firma(segreto, ts + '.' + n)}` });
  }

  if (b.fase === 'fine') {
    const [ts, n, f] = String(b.biglietto || '').split('.');
    if (!ts || !n || !f || f !== (await firma(segreto, ts + '.' + n))) return json({ error: 'partita non valida' }, 400);
    const sec = (Date.now() - Number(ts)) / 1000;
    if (!(sec >= MIN_S && sec <= MAX_S)) return json({ error: 'partita non valida' }, 400);
    if (await env.RICHIESTE.get('premio-b:' + n)) return json({ error: 'premio già ritirato' }, 409);
    await env.RICHIESTE.put('premio-b:' + n, '1', { expirationTtl: 86400 });

    // una sola vincita per connessione ogni 7 giorni: chi rigioca riceve lo stesso codice
    const ip = request.headers.get('cf-connecting-ip') || 'x';
    const giaIp = await env.RICHIESTE.get('premio-ip:' + ip);
    if (giaIp) {
      const v = await env.RICHIESTE.get('premio:' + giaIp, 'json');
      if (v && !v.pagato) return json({ codice: giaIp, sconto: SCONTO, scade: v.scade });
      return json({ error: 'Hai già vinto e usato il premio questa settimana. Riprova più avanti!' }, 429);
    }
    const codice = nuovoCodice();
    const scade = new Date(Date.now() + VALIDO_GG * 86400e3).toISOString();
    await env.RICHIESTE.put('premio:' + codice, JSON.stringify({ creato: new Date().toISOString(), scade, ip }), { expirationTtl: VALIDO_GG * 86400 });
    await env.RICHIESTE.put('premio-ip:' + ip, codice, { expirationTtl: 7 * 86400 });
    return json({ codice, sconto: SCONTO, scade });
  }
  return json({ error: 'richiesta non valida' }, 400);
}

export async function onRequestGet({ request, env }) {
  if (!env.RICHIESTE) return json({ valido: false });
  const c = normCodice(new URL(request.url).searchParams.get('codice'));
  if (!/^GIOCO-[A-Z0-9]{7}$/.test(c)) return json({ valido: false });
  const v = await env.RICHIESTE.get('premio:' + c, 'json');
  return json(v && !v.pagato ? { valido: true, sconto: SCONTO } : { valido: false, usato: !!v?.pagato });
}
