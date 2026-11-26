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
import { cdb, caselleCf, grezzoCf, inviaResend, salvaInviata, testoInHtml, DOMINIO } from '../../../_lib/postacf.js';
import { pdb, cifra, decifra, Imap, inviaSmtp, leggiMime, parteMime, costruisci, indirizzi, dec2047, segreto, pleskSito, pleskCaselle, pleskCrea, pleskPassword, pleskElimina, nuovaPassword, diagnosi } from '../../../_lib/posta.js';

const spiega = (m) => (/cancel|closed|reset|refused|timed? ?out|tls|certificate|handshake/i.test(m) ? `connessione non riuscita: controlla nome del server e porta (${m})` : m);
const pulisci = (c) => { const { pass, ...x } = c; return { ...x, haPass: !!pass }; };
async function casella(env, id) {
  const d = await pdb(env);
  const c = await d.prepare('SELECT * FROM caselle WHERE id=?').bind(String(id || '')).first();
  if (!c) throw Object.assign(new Error('casella non trovata'), { s: 404 });
  return { ...c, pass: await decifra(env, c.pass) };
}
async function conImap(c, fn) { const m = new Imap(c); try { await m.apri(); return await fn(m); } finally { await m.chiudi(); } }

async function salva(env, d, c) {
  await d.prepare(`INSERT INTO caselle(id,email,nome,utente,pass,host,porta,sic,shost,sporta,ssic,firma,ordine,at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET email=excluded.email,nome=excluded.nome,utente=excluded.utente,pass=excluded.pass,host=excluded.host,porta=excluded.porta,sic=excluded.sic,shost=excluded.shost,sporta=excluded.sporta,ssic=excluded.ssic,firma=excluded.firma,ordine=excluded.ordine`)
    .bind(c.id, c.email, c.nome, c.utente, await cifra(env, c.pass), c.host, c.porta, c.sic, c.shost, c.sporta, c.ssic, c.firma, c.ordine, Date.now()).run();
}
const FIRMA = "SEMI STORE · SE.M.I. S.R.L.\nConcessionario DEWALT Lazio, Campania, Molise\nCentro assistenza autorizzato DEWALT · STANLEY · BLACK+DECKER\n\nPunto vendita e laboratorio: Viale G. Marconi 225, 80020 Casavatore (NA)\nTel. 081 553 6604 · WhatsApp +39 375 626 6947 · info@semistore.it\nLun–Ven 8:30–13:00 / 14:30–18:00\n\nNegozio online: https://semistore.it\nAssistenza e stato riparazione: https://semistore.it/assistenza/\nTi siamo stati utili? Lasciaci una recensione: https://search.google.com/local/writereview?placeid=ChIJpQmSJREIOxMRsHBGmNErdn0\nInstagram e TikTok @semistore.it\n\nSE.M.I. S.R.L. – Sede legale: Centro Direzionale Isola E7, 80143 Napoli (NA)\nP.IVA e C.F. 07149740636 – REA NA-583904 – Capitale sociale € 49.000,00 i.v.\nPEC: semi@pec.it\n\nQuesta email e gli eventuali allegati sono riservati e destinati solo alle persone indicate. Se l'hai ricevuta per errore, avvisaci rispondendo e cancellala: è vietato usarla, copiarla o inoltrarla. I dati personali sono trattati secondo il Regolamento UE 2016/679 (GDPR); informativa: https://semistore.it/privacy/";
async function pleskCfg(env) { const c = await segreto(env, 'plesk'); if (!c) throw Object.assign(new Error('Plesk non collegato'), { s: 400 }); return c; }
// collega (o ricollega) in app una casella di Plesk con la password data
async function collegaDaPlesk(env, d, cfg, email, pass, nome, soloSeOk) {
  const prima = await d.prepare('SELECT * FROM caselle WHERE email=?').bind(email).first();
  const c = { id: prima?.id || crypto.randomUUID().slice(0, 8), email, nome: nome || prima?.nome || 'Semi Store', utente: email, pass, host: cfg.mailHost || 'mail.' + cfg.dominio, porta: 993, sic: 'ssl', shost: cfg.smtpHost || '', sporta: 465, ssic: 'ssl', firma: prima?.firma ?? FIRMA, ordine: prima?.ordine ?? 0 };
  let prova = 'ok'; try { await conImap(c, async () => true); } catch (e) { prova = spiega(e.message); }
  if (soloSeOk && prova !== 'ok') return { id: prima?.id, prova, nonSalvata: true };
  await salva(env, d, c); return { id: c.id, prova };
}

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
      const dc = await cdb(env);
      const nn = Object.fromEntries((((await dc.prepare("SELECT casella, COUNT(*) n FROM pmail WHERE cartella='arrivo' AND letto=0 GROUP BY casella").all()).results) || []).map((r) => [r.casella, r.n]));
      const cf = (await caselleCf(dc)).map((x) => ({ id: 'cf-' + x.indirizzo, tipo: 'cf', email: `${x.indirizzo}@${DOMINIO}`, nome: x.nome, host: 'Cloudflare', porta: '', firma: x.firma, auto_on: !!x.auto_on, auto_oggetto: x.auto_oggetto, auto_testo: x.auto_testo, norisposta: !!x.norisposta, nuove: nn[x.indirizzo] || 0 }));
      return json({ caselle: [...cf, ...out] });
    }
    if (p === 'caselle' && m === 'POST') {
      if (body.azione === 'elimina') { await d.prepare('DELETE FROM caselle WHERE id=?').bind(String(body.id)).run(); return json({ ok: true }); }
      const email = String(body.email || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'email non valida' }, 400);
      const prima = await d.prepare('SELECT * FROM caselle WHERE id=? OR email=?').bind(String(body.id || ''), email).first();
      const c = {
        id: prima?.id || crypto.randomUUID().slice(0, 8), email, nome: String(body.nome || '').trim() || email.split('@')[0], utente: String(body.utente || '').trim() || email,
        host: String(body.host || '').trim() || 'mail.' + email.split('@')[1], porta: Number(body.porta) || 993, sic: body.sic || '',
        shost: String(body.shost || '').trim(), sporta: Number(body.sporta) || 465, ssic: body.ssic || '', firma: String(body.firma ?? prima?.firma ?? '') || FIRMA, ordine: Number(body.ordine ?? prima?.ordine ?? 0),
      };
      const loc = (h) => /^(localhost|127\.0\.0\.1)$/.test(h || c.host);
      if (!c.sic) c.sic = c.porta === 993 ? 'ssl' : c.porta === 143 ? 'starttls' : loc() ? 'nessuna' : 'ssl';
      if (!c.ssic) c.ssic = c.sporta === 465 ? 'ssl' : [587, 25, 2525].includes(c.sporta) ? 'starttls' : loc(c.shost) ? 'nessuna' : 'ssl';
      c.pass = body.password ? String(body.password) : prima ? await decifra(env, prima.pass) : '';
      if (!c.pass) return json({ error: 'scrivi la password della casella' }, 400);
      try { await conImap(c, async () => true); } catch (e) {
        let piu = '';
        if (!/accesso rifiutato/.test(e.message)) { const dg = await diagnosi(c.host).catch(() => null);
          if (dg && /^\* OK/i.test(dg.imap)) piu = ` · Il server risponde (porta 143) ma la connessione protetta SSL sulla ${c.porta} non va: quasi sempre il certificato SSL del server di posta non è valido per ${c.host} (certificato "fatto in casa" di Plesk). Soluzione: in Plesk proteggere la posta con un certificato Let's Encrypt per ${c.host}.`;
          else if (dg) piu = ` · Il server non risponde neanche sulla porta 143 (${dg.imap.slice(0, 80)}): probabile firewall che blocca le connessioni esterne alla posta.`; }
        return json({ error: `Non riesco ad entrare in ${email} su ${c.host}:${c.porta}: ${spiega(e.message)}${piu}` }, 400); }
      await salva(env, d, c);
      return json({ ok: true, id: c.id });
    }
    if (p === 'plesk' && m === 'GET') { const c = await segreto(env, 'plesk'); return json(c ? { collegato: true, url: c.url, login: c.login, dominio: c.dominio, mailHost: c.mailHost || 'mail.' + c.dominio } : { collegato: false }); }
    if (p === 'plesk' && m === 'POST') {
      if (body.azione === 'scollega') { await segreto(env, 'plesk', null); return json({ ok: true }); }
      const prima = await segreto(env, 'plesk');
      const cfg = { url: String(body.url || prima?.url || '').trim(), login: String(body.login || prima?.login || '').trim(), pass: body.password ? String(body.password) : prima?.pass || '',
        dominio: String(body.dominio || prima?.dominio || 'semistore.it').trim().toLowerCase(), mailHost: String(body.mailHost || '').trim() || prima?.mailHost || '' };
      if (!cfg.url || !cfg.login || !cfg.pass) return json({ error: 'servono indirizzo del pannello, utente e password di Plesk' }, 400);
      cfg.sito = await pleskSito(cfg);
      const l = await pleskCaselle(cfg);
      await segreto(env, 'plesk', cfg);
      return json({ ok: true, caselle: l.length });
    }
    if (p === 'plesk/caselle') {
      const cfg = await pleskCfg(env); const l = await pleskCaselle(cfg);
      const app = new Set(((await d.prepare('SELECT email FROM caselle').all()).results || []).map((x) => x.email));
      return json({ dominio: cfg.dominio, caselle: l.map((x) => ({ ...x, collegata: app.has(x.email) })) });
    }
    if (p === 'plesk/crea' && m === 'POST') {
      const cfg = await pleskCfg(env); const nome = String(body.nome || '').trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(nome)) return json({ error: 'nome della casella non valido: solo lettere, numeri, punto, trattino (es. ordini, assistenza, mario.rossi)' }, 400);
      const pass = body.password ? String(body.password) : nuovaPassword();
      await pleskCrea(cfg, nome, pass);
      const r = await collegaDaPlesk(env, d, cfg, `${nome}@${cfg.dominio}`, pass, body.mittente);
      return json({ ok: true, email: `${nome}@${cfg.dominio}`, password: pass, ...r });
    }
    if (p === 'plesk/collega' && m === 'POST') {
      const cfg = await pleskCfg(env); const nome = String(body.nome || '').trim().toLowerCase(); const email = `${nome}@${cfg.dominio}`;
      let pass = String(body.password || ''); let nuova = false;
      if (body.nuovaPassword) { pass = body.password ? pass : nuovaPassword(); await pleskPassword(cfg, nome, pass); nuova = true; }
      if (!pass) return json({ error: 'scrivi la password attuale della casella oppure scegli di impostarne una nuova' }, 400);
      const r = await collegaDaPlesk(env, d, cfg, email, pass, body.mittente, !nuova);
      if (r.nonSalvata) return json({ error: 'password non accettata: ' + r.prova }, 400);
      return json({ ok: true, email, ...(nuova ? { password: pass } : {}), ...r });
    }
    if (p === 'plesk/elimina' && m === 'POST') {
      const cfg = await pleskCfg(env); const nome = String(body.nome || '').trim().toLowerCase();
      if (body.conferma !== `${nome}@${cfg.dominio}`) return json({ error: 'conferma mancante' }, 400);
      await pleskElimina(cfg, nome); await d.prepare('DELETE FROM caselle WHERE email=?').bind(`${nome}@${cfg.dominio}`).run();
      return json({ ok: true });
    }
    /* ---------- caselle @semistore.it su Cloudflare ---------- */
    if (p === 'caselle' && m === 'POST' && body.azione === 'cfsalva') {
      const dc = await cdb(env); const ind = String(body.indirizzo || '').trim().toLowerCase().replace(/@.*$/, '');
      if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(ind)) return json({ error: 'nome della casella non valido: solo lettere, numeri, punto, trattino (es. ordini, mario.rossi)' }, 400);
      const prima = await dc.prepare('SELECT * FROM pcaselle WHERE indirizzo=?').bind(ind).first();
      if (body.nuova && prima) return json({ error: `${ind}@${DOMINIO} esiste già` }, 400);
      await dc.prepare(`INSERT INTO pcaselle(indirizzo,nome,firma,auto_on,auto_oggetto,auto_testo,norisposta,ordine,at) VALUES(?,?,?,?,?,?,?,?,?)
        ON CONFLICT(indirizzo) DO UPDATE SET nome=excluded.nome,firma=excluded.firma,auto_on=excluded.auto_on,auto_oggetto=excluded.auto_oggetto,auto_testo=excluded.auto_testo,norisposta=excluded.norisposta`)
        .bind(ind, String(body.nome ?? prima?.nome ?? 'Semi Store'), String(body.firma ?? prima?.firma ?? ''), body.auto_on === undefined ? (prima?.auto_on ?? 0) : (body.auto_on ? 1 : 0),
          String(body.auto_oggetto ?? prima?.auto_oggetto ?? ''), String(body.auto_testo ?? prima?.auto_testo ?? ''), body.norisposta === undefined ? (prima?.norisposta ?? 0) : (body.norisposta ? 1 : 0), prima?.ordine ?? 50, Date.now()).run();
      return json({ ok: true, id: 'cf-' + ind });
    }
    if (p === 'caselle' && m === 'POST' && body.azione === 'cfelimina') {
      const dc = await cdb(env); const ind = String(body.indirizzo || '').toLowerCase();
      if (ind === 'info') return json({ error: 'info@ non si può togliere: riceve anche gli indirizzi sconosciuti' }, 400);
      await dc.batch([dc.prepare("UPDATE pmail SET casella='info', per=? WHERE casella=?").bind(`${ind}@${DOMINIO}`, ind), dc.prepare('DELETE FROM pcaselle WHERE indirizzo=?').bind(ind)]);
      return json({ ok: true });
    }
    const cid = String(g('c') || body.c || '');
    if (cid.startsWith('cf-')) {
      const dc = await cdb(env); const ind = cid.slice(3);
      const cc = await dc.prepare('SELECT * FROM pcaselle WHERE indirizzo=?').bind(ind).first();
      if (!cc) return json({ error: 'casella non trovata' }, 404);
      const CART = [['INBOX', 'arrivo', 'In arrivo'], ['Inviati', 'inviati', 'Inviati'], ['Spam', 'spam', 'Spam'], ['Archivio', 'archivio', 'Archivio'], ['Cestino', 'cestino', 'Cestino']];
      const daNome = (f) => (CART.find((x) => x[0] === f) || CART[0])[1];
      // pulizia: cestino e spam più vecchi di 30 giorni
      if (Math.random() < 0.05) try { const vecchi = ((await dc.prepare("SELECT id FROM pmail WHERE cartella IN ('cestino','spam') AND at < ? LIMIT 200").bind(Date.now() - 30 * 864e5).all()).results || []).map((r) => r.id);
        for (const i of vecchi) await dc.batch([dc.prepare('DELETE FROM pmail_raw WHERE id=?').bind(i), dc.prepare('DELETE FROM pmail WHERE id=?').bind(i)]); } catch (e) { /* pulizia rimandata */ }
      if (p === 'cartelle') {
        const st = Object.fromEntries((((await dc.prepare('SELECT cartella, COUNT(*) tot, SUM(CASE WHEN letto=0 THEN 1 ELSE 0 END) nuove FROM pmail WHERE casella=? GROUP BY cartella').bind(ind).all()).results) || []).map((r) => [r.cartella, r]));
        return json({ cartelle: CART.map(([nome, uso, vista]) => ({ nome, uso: uso === 'arrivo' ? 'arrivo' : uso, vista, tot: st[uso]?.tot || 0, nuove: uso === 'inviati' ? 0 : st[uso]?.nuove || 0 })) });
      }
      const mapR = (r) => ({ uid: r.id, data: r.data, oggetto: r.oggetto, da: { nome: r.da_nome, email: r.da_email }, a: JSON.parse(r.a || '[]'), cc: JSON.parse(r.cc || '[]'), per: r.per,
        letto: !!r.letto, risposto: !!r.risposto, stella: !!r.stella, dim: r.dim, allegati: !!r.allegati, anteprima: r.anteprima, spam: r.spam, auto: !!r.auto });
      if (p === 'elenco') {
        const cart = daNome(g('f') || 'INBOX'), prima = Number(g('prima')) || 0, q = g('cerca').trim();
        const w = 'casella=? AND cartella=?' + (q ? ' AND (oggetto LIKE ? OR da_email LIKE ? OR da_nome LIKE ? OR anteprima LIKE ? OR a LIKE ?)' : '');
        const args = [ind, cart, ...(q ? Array(5).fill('%' + q + '%') : [])];
        const tot = (await dc.prepare('SELECT COUNT(*) n FROM pmail WHERE ' + w).bind(...args).first()).n;
        const l = ((await dc.prepare('SELECT * FROM pmail WHERE ' + w + ' ORDER BY data DESC LIMIT 40 OFFSET ?').bind(...args, prima).all()).results || []).map(mapR);
        return json({ tot, mess: l });
      }
      const uid = String(g('uid') || body.uid || '');
      if (p === 'leggi' || p === 'allegato' || p === 'originale') {
        const r = await dc.prepare('SELECT * FROM pmail WHERE id=? AND casella=?').bind(uid, ind).first(); if (!r) return json({ error: 'email non trovata' }, 404);
        const raw = await grezzoCf(dc, uid);
        if (p === 'originale') return new Response(Uint8Array.from(raw, (x) => x.charCodeAt(0) & 255), { headers: { 'content-type': 'message/rfc822', 'content-disposition': `attachment; filename="email.eml"`, 'cache-control': 'private, no-store' } });
        if (p === 'allegato') { const a = parteMime(raw, g('part')); if (!a) return json({ error: 'allegato non trovato' }, 404);
          return new Response(a.dati, { headers: { 'content-type': a.tipo || 'application/octet-stream', 'content-disposition': `${/^(image|application\/pdf|text)/.test(a.tipo) ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.nome)}`, 'cache-control': 'private, no-store' } }); }
        if (!r.letto) await dc.prepare('UPDATE pmail SET letto=1 WHERE id=?').bind(uid).run().catch(() => {}); // sola lettura se le scritture sono finite
        const x = leggiMime(raw), h = x.h, si = JSON.parse(r.spam_info || '{}');
        return json({ uid, oggetto: r.oggetto || dec2047(h.subject || ''), data: r.data, da: { nome: r.da_nome, email: r.da_email }, a: JSON.parse(r.a || '[]'), cc: JSON.parse(r.cc || '[]'), per: r.per,
          rispondiA: indirizzi(h['reply-to'])[0] || null, messageId: r.message_id, riferimenti: r.riferimenti, testo: x.testo, html: x.html, cid: x.cid, allegati: x.allegati,
          spam: { segnato: r.cartella === 'spam' || r.spam >= 5, punti: r.spam ? String(r.spam) : '', spf: si.spf || '', dkim: si.dkim || '', dmarc: si.dmarc || '', motivi: si.motivi || [] }, letto: true, stella: !!r.stella, auto: !!r.auto });
      }
      if (p === 'azione' && m === 'POST') {
        const r = await dc.prepare('SELECT * FROM pmail WHERE id=? AND casella=?').bind(uid, ind).first(); if (!r) return json({ error: 'email non trovata' }, 404);
        const op = body.op, set = (k, v) => dc.prepare(`UPDATE pmail SET ${k}=? WHERE id=?`).bind(v, uid).run();
        if (op === 'letto' || op === 'nonletto') await set('letto', op === 'letto' ? 1 : 0);
        else if (op === 'stella' || op === 'nostella') await set('stella', op === 'stella' ? 1 : 0);
        else if (op === 'spam') { await set('cartella', 'spam'); if (r.da_email) await dc.prepare("INSERT INTO pmail_liste(email,tipo,at) VALUES(?,'spam',?) ON CONFLICT(email) DO UPDATE SET tipo='spam', at=excluded.at").bind(r.da_email, Date.now()).run(); }
        else if (op === 'nonspam') { await set('cartella', 'arrivo'); if (r.da_email) await dc.prepare("INSERT INTO pmail_liste(email,tipo,at) VALUES(?,'ok',?) ON CONFLICT(email) DO UPDATE SET tipo='ok', at=excluded.at").bind(r.da_email, Date.now()).run(); }
        else if (op === 'cestino') await set('cartella', 'cestino');
        else if (op === 'elimina') await dc.batch([dc.prepare('DELETE FROM pmail_raw WHERE id=?').bind(uid), dc.prepare('DELETE FROM pmail WHERE id=?').bind(uid)]);
        else if (op === 'sposta') await set('cartella', daNome(body.verso));
        return json({ ok: true });
      }
      if (p === 'invia' && m === 'POST') {
        const a = indirizzi(body.a), cc2 = indirizzi(body.cc);
        if (!a.length) return json({ error: 'scrivi almeno un destinatario' }, 400);
        const allegati = (body.allegati || []).slice(0, 10);
        if (allegati.reduce((s2, x) => s2 + (x.b64 || '').length * 0.75, 0) > 15e6) return json({ error: 'allegati troppo grandi (max 15 MB in tutto)' }, 413);
        const firma = cc.firma || FIRMA;
        const testo = String(body.testo || '') + (firma ? '\n\n-- \n' + firma : '') + (body.citazione ? '\n\n' + String(body.citazione).split('\n').map((l) => '> ' + l).join('\n') : '');
        const html = testoInHtml(String(body.testo || '')) + (firma ? `<br><div style="font-family:Arial,sans-serif;font-size:12px;color:#555;border-top:1px solid #ddd;padding-top:8px;margin-top:8px">${testoInHtml(firma).replace(/font-size:14px/, 'font-size:12px')}</div>` : '') +
          (body.citazione ? `<br><blockquote style="margin:0 0 0 .8ex;border-left:2px solid #ccc;padding-left:1ex;color:#555">${testoInHtml(String(body.citazione))}</blockquote>` : '');
        const rif = body.rispondi?.messageId ? { 'In-Reply-To': body.rispondi.messageId, References: [body.rispondi.riferimenti, body.rispondi.messageId].filter(Boolean).join(' ') } : {};
        const r = await inviaResend(env, { da: { nome: cc.nome, email: `${ind}@${DOMINIO}` }, a, cc: cc2, oggetto: String(body.oggetto || ''), testo, html, intestazioni: rif, allegati });
        await salvaInviata(dc, { casella: ind, a, cc: cc2, oggetto: String(body.oggetto || ''), testo, html, mid: r.mid, inReplyTo: rif['In-Reply-To'] || '', riferimenti: rif.References || '', allegati });
        if (body.rispondi?.uid) await dc.prepare('UPDATE pmail SET risposto=1 WHERE id=?').bind(String(body.rispondi.uid)).run();
        return json({ ok: true, copia: 'salvata in Inviati' });
      }
      return json({ error: 'non trovato' }, 404);
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
  } catch (e) { return json({ error: spiega(e.message || 'errore') }, e.s || 400); }
}
