// Premio del minigioco "Trapano Slalom" (uno al mese per email): chi completa il livello 5, OPPURE chi ha giocato 5 partite (anche perse), si registra con l'email e riceve un codice sconto del 10%, valido una volta.
// POST {fase:'inizio'}                                        -> biglietto firmato quando parte l'ultimo livello
// POST {fase:'fine', biglietto, email, privacy, offerte}      -> registra l'email e invia il codice (uno per email)
// GET  ?codice=GIOCO-XXXXXXX                                  -> il carrello controlla se il codice è valido
// GET  ?elenco=csv  (header Authorization: Bearer ADMIN_TOKEN) -> elenco iscritti in CSV (email, consenso offerte, data, codice)
// Usa il KV RICHIESTE, come segreto PREMIO_SEGRETO (se manca, ADMIN_TOKEN) e Resend (RESEND_API_KEY, EMAIL_FROM) per l'email.
// Se Resend non è configurato il codice viene mostrato a schermo.
import { SITO } from '../../src/data/sito.js';

const SCONTO = 10;
const MIN_S = 18, MAX_S = 2 * 3600, VALIDO_GG = 30, MAX_PER_IP = 3;
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const enc = new TextEncoder();
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const normCodice = (c) => String(c || '').trim().toUpperCase().replace(/\s+/g, '');
const normEmail = (e) => String(e || '').trim().toLowerCase();
// Un premio al mese per email (mese di calendario, ora italiana)
const meseDi = (d = new Date()) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit' }).format(d).slice(0, 7);
const nomeMese = (d) => new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', month: 'long' }).format(d);
const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

async function firma(segreto, testo) {
  const k = await crypto.subtle.importKey('raw', enc.encode(segreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(testo))).slice(0, 32);
}
const nuovoCodice = () => {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', b = crypto.getRandomValues(new Uint8Array(7));
  return 'GIOCO-' + [...b].map((x) => A[x % A.length]).join('');
};

async function inviaEmail(env, email, codice, scade, origin) {
  if (!env.RESEND_API_KEY) return false;
  const data = new Date(scade).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#15171a">
    <div style="background:#15171a;color:#fff;padding:24px;border-radius:14px 14px 0 0;text-align:center">
      <div style="color:#f5b800;font-weight:700;letter-spacing:2px;font-size:12px">TRAPANO SLALOM</div>
      <div style="font-size:26px;font-weight:900;margin-top:6px">Hai vinto il ${SCONTO}% di sconto!</div>
    </div>
    <div style="background:#f4f3ef;padding:24px;border-radius:0 0 14px 14px;text-align:center">
      <p style="margin:0 0 14px">Grazie per aver giocato a Trapano Slalom! Ecco il tuo codice sconto del mese:</p>
      <div style="display:inline-block;background:#f5b800;padding:14px 22px;border-radius:10px;font:700 24px monospace;letter-spacing:2px">${codice}</div>
      <p style="margin:16px 0 6px">Inseriscilo nel carrello alla voce <b>"Hai un codice sconto?"</b>. Vale una volta, sui prodotti, fino al ${data}.</p>
      <p style="margin:0 0 18px;font-size:13px;color:#5c5f65">Al pagamento usa questa stessa email.</p>
      <a href="${origin}/catalogo/" style="display:inline-block;background:#15171a;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:8px">Vai al catalogo</a>
      <p style="margin:22px 0 0;font-size:12px;color:#5c5f65">${SITO.nome} · ${SITO.indirizzo}, ${SITO.citta} · ${SITO.telefono}</p>
    </div></div>`;
  const testo = `Hai vinto il ${SCONTO}% di sconto!\n\nIl tuo codice: ${codice}\nInseriscilo nel carrello alla voce "Hai un codice sconto?". Vale una volta, sui prodotti, fino al ${data}.\nAl pagamento usa questa stessa email.\n\n${origin}/catalogo/`;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.EMAIL_FROM_SCONTI || 'Semi Store Sconti <sconti@semistore.it>', reply_to: (env.EMAIL_TO || 'info@semistore.it').split(',')[0], to: [email], subject: `Il tuo codice sconto del ${SCONTO}% · Semi Store`, html, text: testo }),
    });
    if (!r.ok) console.error('Resend', await r.text());
    return r.ok;
  } catch (e) { console.error('Resend', e); return false; }
}

export async function onRequestPost({ request, env }) {
  const segreto = env.PREMIO_SEGRETO || env.ADMIN_TOKEN;
  if (!env.RICHIESTE || !segreto) return json({ error: 'Premi non attivi in questo momento.' }, 503);
  let b; try { b = await request.json(); } catch { return json({ error: 'richiesta non valida' }, 400); }
  const origin = new URL(request.url).origin;

  if (b.fase === 'inizio') {
    const ts = String(Date.now()), n = hex(crypto.getRandomValues(new Uint8Array(6)));
    // tipo "t": premio dopo 5 tentativi (partita anche breve); tipo "v": vittoria del livello 5
    const k = b.tipo === 'tentativi' ? 't' : 'v';
    return json({ biglietto: `${ts}.${n}.${await firma(segreto, ts + '.' + n + '.' + k)}.${k}` });
  }

  if (b.fase === 'fine') {
    const email = normEmail(b.email);
    if (!EMAIL_OK.test(email) || email.length > 120) return json({ error: 'Inserisci un indirizzo email valido.' }, 400);
    if (b.privacy !== true) return json({ error: 'Per ricevere il codice devi accettare l\'informativa privacy.' }, 400);

    const [ts, n, f, k] = String(b.biglietto || '').split('.');
    const atteso = k ? await firma(segreto, ts + '.' + n + '.' + k) : await firma(segreto, ts + '.' + n);
    if (!ts || !n || !f || f !== atteso) return json({ error: 'Partita non valida: gioca un\'altra partita.' }, 400);
    const sec = (Date.now() - Number(ts)) / 1000;
    if (!(sec >= (k === 't' ? 3 : MIN_S) && sec <= MAX_S)) return json({ error: 'Partita non valida o scaduta: rigioca l\'ultimo livello.' }, 400);
    if (await env.RICHIESTE.get('premio-b:' + n)) return json({ error: 'Il premio di questa partita è già stato ritirato.' }, 409);

    // un premio al mese per email: se questo mese l'ha già vinto e non l'ha usato, gli rimandiamo lo stesso codice
    const mese = meseDi(), kMese = `premio-mese:${email}:${mese}`;
    let gia = await env.RICHIESTE.get(kMese);
    if (!gia) { // codici della versione precedente (una volta sola): valgono come premio del mese in cui sono stati creati
      const vecchio = await env.RICHIESTE.get('premio-email:' + email);
      const vv = vecchio && await env.RICHIESTE.get('premio:' + vecchio, 'json');
      if (vv && meseDi(new Date(vv.creato)) === mese) gia = vecchio;
    }
    const vGia = gia && await env.RICHIESTE.get('premio:' + gia, 'json');
    if (vGia) { // se il codice del mese è scaduto senza essere usato, se ne crea uno nuovo
      const v = vGia;
      if (v && !v.pagato) {
        await env.RICHIESTE.put('premio-b:' + n, '1', { expirationTtl: 86400 });
        const inviato = await inviaEmail(env, email, gia, v.scade, origin);
        return json(inviato ? { inviato: true, email, gia: true } : { codice: gia, sconto: SCONTO, scade: v.scade, gia: true });
      }
      const prossimo = new Date(); prossimo.setUTCDate(28); prossimo.setUTCDate(prossimo.getUTCDate() + 7);
      return json({ error: `Hai già usato lo sconto di ${nomeMese(new Date())}. Dal 1° ${nomeMese(prossimo)} puoi vincerne uno nuovo: grazie per aver giocato!` }, 409);
    }

    const ip = request.headers.get('cf-connecting-ip') || 'x';
    const nIp = Number(await env.RICHIESTE.get('premio-ip:' + ip)) || 0;
    if (nIp >= MAX_PER_IP) return json({ error: 'Troppi premi da questa connessione questa settimana. Riprova più avanti!' }, 429);

    const codice = nuovoCodice();
    const ora = new Date().toISOString();
    const scade = new Date(Date.now() + VALIDO_GG * 86400e3).toISOString();
    const offerte = b.offerte === true;
    await env.RICHIESTE.put('premio-b:' + n, '1', { expirationTtl: 86400 });
    await env.RICHIESTE.put('premio:' + codice, JSON.stringify({ creato: ora, scade, email, ip }), { expirationTtl: VALIDO_GG * 86400 });
    await env.RICHIESTE.put(kMese, codice, { expirationTtl: 62 * 86400 });
    await env.RICHIESTE.put('premio-ip:' + ip, String(nIp + 1), { expirationTtl: 7 * 86400 });
    // iscritto: i dati stanno nei metadati così l'elenco si legge in un colpo solo
    await env.RICHIESTE.put('iscritto:' + email, '1', { metadata: { email, offerte, data: ora, codice } });

    const inviato = await inviaEmail(env, email, codice, scade, origin);
    return json(inviato ? { inviato: true, email } : { codice, sconto: SCONTO, scade });
  }
  return json({ error: 'richiesta non valida' }, 400);
}

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  if (u.searchParams.has('elenco')) {
    if (!env.RICHIESTE || !env.ADMIN_TOKEN || request.headers.get('authorization') !== `Bearer ${env.ADMIN_TOKEN}`) return json({ error: 'non autorizzato' }, 401);
    const righe = ['email;consenso_offerte;data;codice'];
    let cursor;
    do {
      const l = await env.RICHIESTE.list({ prefix: 'iscritto:', cursor });
      for (const k of l.keys) { const m = k.metadata || {}; righe.push([m.email, m.offerte ? 'si' : 'no', m.data, m.codice].join(';')); }
      cursor = l.list_complete ? undefined : l.cursor;
    } while (cursor);
    return new Response(righe.join('\n'), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="iscritti-gioco.csv"', 'cache-control': 'no-store' } });
  }
  if (!env.RICHIESTE) return json({ valido: false });
  const c = normCodice(u.searchParams.get('codice'));
  if (!/^GIOCO-[A-Z0-9]{7}$/.test(c)) return json({ valido: false });
  const v = await env.RICHIESTE.get('premio:' + c, 'json');
  return json(v && !v.pagato ? { valido: true, sconto: SCONTO } : { valido: false, usato: !!v?.pagato });
}
