// Posta nell'app (solo amministratore). Le caselle sono sul server Plesk: qui si leggono e si inviano con IMAP/SMTP.
//  GET  caselle                          → elenco caselle (senza password) + email nuove in arrivo
//  POST caselle {azione:salva|elimina…}  → aggiunge/modifica (prova l'accesso prima di salvare) o toglie
//  GET  cartelle?c=id                    → cartelle con totali e non lette
//  GET  elenco?c&f&prima&cerca           → ultime email della cartella
//  GET  leggi?c&f&uid                    → email completa (testo, html, allegati) e la segna letta
//  GET  allegato?c&f&uid&part            → scarica un allegato
//  GET  originale?c&f&uid                → sorgente completo (.eml)
//  POST azione {c,f,uid,op}              → letto | nonletto | stella | nostella | spam | nonspam | cestino | elimina | sposta(verso)
//  POST invia {c,a,cc,oggetto,testo,rispondi:{f,uid},allegati:[{nome,tipo,b64}]}
import { gdb, json, utente } from '../../../_lib/gestione.js';
import { pdb, cifra, decifra, Imap, inviaSmtp, leggiMime, parteMime, costruisci, indirizzi, dec2047 } from '../../../_lib/posta.js';

const spiega = (m) => (/cancel|closed|reset|refused|timed? ?out|tls|certificate|handshake/i.test(m) ? `connessione non riuscita: controlla nome del server e porta (${m})` : m);
const pulisci = (c) => { const { pass, ...x } = c; return { ...x, haPass: !!pass }; };
async function casella(env, id) {
  const d = await pdb(env);
  const c = await d.prepare('SELECT * FROM caselle WHERE id=?').bind(String(id || '')).first();
  if (!c) throw Object.assign(new Error('casella non trovata'), { s: 404 });
  return { ...c, pass: await decifra(env, c.pass) };
}
async function conImap(c, fn) { const m = new Imap(c); try { await m.apri(); return await fn(m); } finally { await m.chiudi(); } }

export async function onRequest({ request, env, params }) {
  const p = (params.q || []).join('/'), m = request.method, u = new URL(request.url), g = (k) => u.searchParams.get(k) || '';
  if (!env.DB) return json({ error: 'archivio non configurato' }, 503);
  await gdb(env);
  const io = await utente(request, env);
  if (!io) return json({ error: 'non collegato', code: 'unauthenticated' }, 401);
  if (io.ruolo !== 'admin') return json({ error: "la posta è solo per l'amministratore", code: 'permission_denied' }, 403);
  const body = m === 'POST' ? await request.json().catch(() => ({})) : {};
  try {
    const d = await pdb(env);
    if (p === 'caselle' && m === 'GET') {
      const l = (await d.prepare('SELECT * FROM caselle ORDER BY ordine, email').all()).results || [];
      const conta = g('conta') === '1';
      const out = await Promise.all(l.map(async (c) => {
        const x = pulisci(c);
        if (conta) { try { x.nuove = await conImap({ ...c, pass: await decifra(env, c.pass) }, async (im) => { const r = (await im.cmd('STATUS "INBOX" (UNSEEN)')).join(' '); return Number((r.match(/UNSEEN (\d+)/i) || [])[1] || 0); }); } catch (e) { x.errore = e.message; } }
        return x;
      }));
      return json({ caselle: out });
    }
    if (p === 'caselle' && m === 'POST') {
      if (body.azione === 'elimina') { await d.prepare('DELETE FROM caselle WHERE id=?').bind(String(body.id)).run(); return json({ ok: true }); }
      const email = String(body.email || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'email non valida' }, 400);
      const prima = await d.prepare('SELECT * FROM caselle WHERE id=? OR email=?').bind(String(body.id || ''), email).first();
      const c = {
        id: prima?.id || crypto.randomUUID().slice(0, 8), email, nome: String(body.nome || '').trim() || email.split('@')[0], utente: String(body.utente || '').trim() || email,
        host: String(body.host || '').trim() || 'mail.' + email.split('@')[1], porta: Number(body.porta) || 993, sic: body.sic || '',
        shost: String(body.shost || '').trim(), sporta: Number(body.sporta) || 465, ssic: body.ssic || '', firma: String(body.firma ?? prima?.firma ?? ''), ordine: Number(body.ordine ?? prima?.ordine ?? 0),
      };
      const loc = (h) => /^(localhost|127\.0\.0\.1)$/.test(h || c.host);
      if (!c.sic) c.sic = c.porta === 993 ? 'ssl' : c.porta === 143 ? 'starttls' : loc() ? 'nessuna' : 'ssl';
      if (!c.ssic) c.ssic = c.sporta === 465 ? 'ssl' : [587, 25, 2525].includes(c.sporta) ? 'starttls' : loc(c.shost) ? 'nessuna' : 'ssl';
      c.pass = body.password ? String(body.password) : prima ? await decifra(env, prima.pass) : '';
      if (!c.pass) return json({ error: 'scrivi la password della casella' }, 400);
      try { await conImap(c, async () => true); } catch (e) { return json({ error: `Non riesco ad entrare in ${email} su ${c.host}:${c.porta}: ${spiega(e.message)}` }, 400); }
      await d.prepare(`INSERT INTO caselle(id,email,nome,utente,pass,host,porta,sic,shost,sporta,ssic,firma,ordine,at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET email=excluded.email,nome=excluded.nome,utente=excluded.utente,pass=excluded.pass,host=excluded.host,porta=excluded.porta,sic=excluded.sic,shost=excluded.shost,sporta=excluded.sporta,ssic=excluded.ssic,firma=excluded.firma,ordine=excluded.ordine`)
        .bind(c.id, c.email, c.nome, c.utente, await cifra(env, c.pass), c.host, c.porta, c.sic, c.shost, c.sporta, c.ssic, c.firma, c.ordine, Date.now()).run();
      return json({ ok: true, id: c.id });
    }
    const c = await casella(env, g('c') || body.c);
    if (p === 'cartelle') return json({ cartelle: await conImap(c, (im) => im.cartelle()) });
    if (p === 'elenco') return json(await conImap(c, (im) => im.elenco(g('f') || 'INBOX', { prima: Number(g('prima')) || 0, n: 40, cerca: g('cerca') })));
    if (p === 'leggi' || p === 'allegato' || p === 'originale') {
      const f = g('f') || 'INBOX', uid = Number(g('uid'));
      const { raw, flags } = await conImap(c, async (im) => { const r = await im.grezzo(f, uid); if (p === 'leggi' && !r.flags.includes('\\seen')) await im.cmd(`UID STORE ${uid} +FLAGS.SILENT (\\Seen)`).catch(() => {}); return r; });
      if (p === 'originale') return new Response(Uint8Array.from(raw, (x) => x.charCodeAt(0) & 255), { headers: { 'content-type': 'message/rfc822', 'content-disposition': `attachment; filename="email-${uid}.eml"`, 'cache-control': 'private, no-store' } });
      if (p === 'allegato') {
        const a = parteMime(raw, g('part')); if (!a) return json({ error: 'allegato non trovato' }, 404);
        return new Response(a.dati, { headers: { 'content-type': a.tipo || 'application/octet-stream', 'content-disposition': `${/^(image|application\/pdf|text)/.test(a.tipo) ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.nome)}`, 'cache-control': 'private, no-store' } });
      }
      const x = leggiMime(raw), h = x.h;
      const spam = /^yes/i.test(h['x-spam-flag'] || '') || /^yes/i.test(h['x-spam-status'] || '');
      const punti = (String(h['x-spam-status'] || h['x-spam-score'] || '').match(/(?:score|hits)=(-?[\d.]+)/i) || [])[1] || h['x-spam-score'] || '';
      const auth = String(h['authentication-results'] || '');
      return json({ uid, oggetto: dec2047(h.subject || ''), data: Date.parse(h.date) || 0,
        da: indirizzi(h.from)[0] || null, a: indirizzi(h.to), cc: indirizzi(h.cc), rispondiA: indirizzi(h['reply-to'])[0] || null,
        messageId: h['message-id'] || '', riferimenti: h.references || '', testo: x.testo, html: x.html, cid: x.cid, allegati: x.allegati,
        spam: { segnato: spam, punti, spf: (auth.match(/spf=(\w+)/i) || [])[1] || '', dkim: (auth.match(/dkim=(\w+)/i) || [])[1] || '', dmarc: (auth.match(/dmarc=(\w+)/i) || [])[1] || '' },
        letto: true, stella: flags.includes('\\flagged') });
    }
    if (p === 'azione' && m === 'POST') {
      const f = body.f || 'INBOX', uid = Number(body.uid), op = body.op;
      if (!uid) return json({ error: 'email mancante' }, 400);
      await conImap(c, async (im) => {
        if (op === 'letto' || op === 'nonletto') return im.flag(f, uid, op === 'letto', '\\Seen');
        if (op === 'stella' || op === 'nostella') return im.flag(f, uid, op === 'stella', '\\Flagged');
        if (op === 'elimina') return im.elimina(f, uid);
        let verso = body.verso;
        if (op === 'spam' || op === 'cestino') { const x = await im.trova(op); if (!x) throw new Error(op === 'spam' ? 'cartella Spam non trovata sul server' : 'cartella Cestino non trovata sul server'); verso = x.nome; }
        if (op === 'nonspam') verso = 'INBOX';
        if (!verso) throw new Error('cartella di destinazione mancante');
        if (op === 'spam') await im.flag(f, uid, true, '\\Seen').catch(() => {});
        return im.sposta(f, uid, verso);
      });
      return json({ ok: true });
    }
    if (p === 'invia' && m === 'POST') {
      const a = indirizzi(body.a), cc = indirizzi(body.cc);
      if (!a.length) return json({ error: 'scrivi almeno un destinatario' }, 400);
      const allegati = (body.allegati || []).slice(0, 10);
      if (allegati.reduce((s, x) => s + (x.b64 || '').length * 0.75, 0) > 15e6) return json({ error: 'allegati troppo grandi (max 15 MB in tutto)' }, 413);
      const testo = String(body.testo || '') + (c.firma ? '\n\n-- \n' + c.firma : '');
      const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">${esc(String(body.testo || '')).replace(/\n/g, '<br>')}${c.firma ? `<br><br><span style="color:#555">${esc(c.firma).replace(/\n/g, '<br>')}</span>` : ''}</div>${body.citazione ? `<br><blockquote style="margin:0 0 0 .8ex;border-left:2px solid #ccc;padding-left:1ex;color:#555">${esc(body.citazione).replace(/\n/g, '<br>')}</blockquote>` : ''}`;
      const testoTot = testo + (body.citazione ? '\n\n' + String(body.citazione).split('\n').map((l) => '> ' + l).join('\n') : '');
      const { bin, id } = costruisci({ da: { nome: c.nome, email: c.email }, a, cc, oggetto: String(body.oggetto || ''), testo: testoTot, html, rispostaA: body.rispondi?.messageId || '', riferimenti: body.rispondi?.riferimenti || '', allegati });
      await inviaSmtp(c, { da: c.email, destinatari: [...a, ...cc].map((x) => x.email), bin });
      let copia = 'salvata in Inviati';
      await conImap(c, async (im) => {
        const s = await im.trova('inviati'); if (s) await im.aggiungi(s.nome, bin); else copia = 'cartella Inviati non trovata';
        if (body.rispondi?.uid) await im.flag(body.rispondi.f || 'INBOX', Number(body.rispondi.uid), true, '\\Answered').catch(() => {});
      }).catch((e) => { copia = 'copia in Inviati non salvata: ' + e.message; });
      return json({ ok: true, id, copia });
    }
    return json({ error: 'non trovato' }, 404);
  } catch (e) { return json({ error: spiega(e.message || 'errore') }, e.s || 502); }
}
