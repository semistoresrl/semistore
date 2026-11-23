// Posta di semistore.it gestita da noi su Cloudflare (scelta del cliente 20/11/2026).
// Arrivo: Cloudflare Email Routing → Worker "semistore-posta" → POST /api/posta/in → qui (D1).
// Invio: Resend (dominio semistore.it già verificato).  Niente server di posta esterni.
import { leggiMime, indirizzi, dec2047 } from './posta.js';
import { SITO } from '../../src/data/sito.js';

export const DOMINIO = 'semistore.it';
const CHUNK = 1_500_000;

export async function cdb(env) {
  const d = env.DB;
  await d.batch([
    d.prepare(`CREATE TABLE IF NOT EXISTS pcaselle(indirizzo TEXT PRIMARY KEY, nome TEXT, firma TEXT, auto_on INTEGER DEFAULT 0, auto_oggetto TEXT, auto_testo TEXT,
      norisposta INTEGER DEFAULT 0, ordine INTEGER DEFAULT 0, at INTEGER)`),
    d.prepare(`CREATE TABLE IF NOT EXISTS pmail(id TEXT PRIMARY KEY, casella TEXT, cartella TEXT, da_nome TEXT, da_email TEXT, a TEXT, cc TEXT, per TEXT, oggetto TEXT,
      data INTEGER, anteprima TEXT, dim INTEGER, allegati INTEGER DEFAULT 0, letto INTEGER DEFAULT 0, stella INTEGER DEFAULT 0, risposto INTEGER DEFAULT 0,
      spam REAL DEFAULT 0, spam_info TEXT, message_id TEXT, in_reply_to TEXT, riferimenti TEXT, parti INTEGER, auto INTEGER DEFAULT 0, impronta TEXT, at INTEGER)`),
    d.prepare('CREATE INDEX IF NOT EXISTS pmail_c ON pmail(casella, cartella, data)'),
    d.prepare('CREATE INDEX IF NOT EXISTS pmail_imp ON pmail(impronta)'),
    d.prepare('CREATE TABLE IF NOT EXISTS pmail_raw(id TEXT, n INTEGER, dati BLOB, PRIMARY KEY(id, n))'),
    d.prepare('CREATE TABLE IF NOT EXISTS pmail_liste(email TEXT PRIMARY KEY, tipo TEXT, at INTEGER)'),
    d.prepare('CREATE TABLE IF NOT EXISTS pmail_auto(casella TEXT, email TEXT, at INTEGER, PRIMARY KEY(casella, email))'),
  ]);
  const n = await d.prepare('SELECT COUNT(*) n FROM pcaselle').first();
  if (!n.n) await d.batch(CASELLE_BASE.map((c, i) => d.prepare('INSERT OR IGNORE INTO pcaselle(indirizzo,nome,firma,auto_on,auto_oggetto,auto_testo,norisposta,ordine,at) VALUES(?,?,?,?,?,?,?,?,?)')
    .bind(c.indirizzo, c.nome, '', c.auto ? 1 : 0, c.oggetto || '', c.testo, c.norisposta ? 1 : 0, i, Date.now())));
  return d;
}

/* ---------- caselle di partenza con le risposte automatiche, una per servizio ---------- */
const WA = `https://wa.me/${SITO.whatsapp}`;
const ORARI = 'dal lunedì al venerdì, 8:30–13:00 e 14:30–18:00';
const PIEDE = `\n\nPer fare prima:\n• Stato della riparazione: https://semistore.it/assistenza/\n• WhatsApp: ${WA}\n• Telefono: ${SITO.telefono} (${ORARI})\n\nSemi Store · SE.M.I. S.R.L.\nViale G. Marconi 225, 80020 Casavatore (NA)\nhttps://semistore.it`;
export const CASELLE_BASE = [
  { indirizzo: 'info', nome: 'Semi Store', auto: true, oggetto: 'Abbiamo ricevuto la tua email',
    testo: `Ciao {nome},\ngrazie per averci scritto: abbiamo ricevuto il tuo messaggio e ti rispondiamo entro un giorno lavorativo{fuori_orario}.\n\nSe ci chiedi un prodotto, indicaci il codice o il modello (es. DCD796); per un preventivo di riparazione, modello, matricola e una foto del problema.${PIEDE}` },
  { indirizzo: 'assistenza', nome: 'Semi Store Assistenza', auto: true, oggetto: 'Assistenza Semi Store: richiesta ricevuta',
    testo: `Ciao {nome},\nabbiamo ricevuto la tua richiesta di assistenza: un tecnico ti risponde entro un giorno lavorativo{fuori_orario}.\n\nSe non l'hai già fatto puoi aprire la richiesta online, anche con spedizione o ritiro del pacco, e stampare subito il DDT: https://semistore.it/assistenza/\nCon il numero della scheda (AS-…) o della richiesta (WEB-…) e il tuo telefono vedi lo stato della riparazione in qualsiasi momento.\n\nIndicaci modello, matricola (sulla targhetta) e il difetto, con una foto se puoi.${PIEDE}` },
  { indirizzo: 'ordini', nome: 'Semi Store Ordini', auto: true, oggetto: 'Il tuo messaggio sugli ordini è arrivato',
    testo: `Ciao {nome},\nabbiamo ricevuto il tuo messaggio: ti rispondiamo entro un giorno lavorativo{fuori_orario}.\n\nPer fare prima indicaci il numero dell'ordine. Gli ordini e i punti li vedi nel tuo account: https://semistore.it/account/\nResi e recesso (14 giorni): https://semistore.it/recesso/${PIEDE}` },
  { indirizzo: 'amministrazione', nome: 'Semi Store Amministrazione', auto: true, oggetto: 'Email ricevuta – Amministrazione Semi Store',
    testo: `Buongiorno,\nabbiamo ricevuto la vostra email, che verrà gestita dall'amministrazione entro due giorni lavorativi.\n\nFatture elettroniche: SE.M.I. S.R.L., P.IVA e C.F. 07149740636, PEC semi@pec.it.\n\nSE.M.I. S.R.L. – Sede legale: Centro Direzionale Isola E7, 80143 Napoli (NA) – REA NA-583904` },
  { indirizzo: 'sconti', nome: 'Semi Store Sconti', auto: true, norisposta: true, oggetto: 'Questa casella non riceve risposte',
    testo: `Ciao {nome},\nquesta casella invia solo i codici sconto e i buoni regalo e non viene letta.\n\nPer qualsiasi domanda scrivi a info@semistore.it oppure su WhatsApp: ${WA}\nI tuoi sconti, punti e buoni sono nel tuo account: https://semistore.it/account/\n\nSemi Store` },
  { indirizzo: 'accesso', nome: 'Semi Store Account', auto: true, norisposta: true, oggetto: 'Questa casella non riceve risposte',
    testo: `Ciao {nome},\nquesta casella invia solo i link di accesso all'account e non viene letta.\n\nSe il link non funziona richiedine uno nuovo da https://semistore.it/account/ (vale 15 minuti). Per altro scrivi a info@semistore.it o su WhatsApp: ${WA}\n\nSemi Store` },
];

/* ---------- utilità ---------- */
const bin2u8 = (s) => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u; };
const u82bin = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return s; };
async function sha(s) { const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32); }
const locale = (e) => String(e || '').toLowerCase().split('@')[0].split('+')[0];
const testoPiano = (x) => (x.testo || String(x.html || '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"')).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
function aperto(t = Date.now()) {
  const d = new Date(new Date(t).toLocaleString('en-US', { timeZone: 'Europe/Rome' }));
  const g = d.getDay(), m = d.getHours() * 60 + d.getMinutes();
  return (SITO.fasce[g] || []).some(([a, b]) => { const [ah, am] = a.split(':').map(Number), [bh, bm] = b.split(':').map(Number); return m >= ah * 60 + am && m < bh * 60 + bm; });
}

export async function caselleCf(d) { return (await d.prepare('SELECT * FROM pcaselle ORDER BY ordine, indirizzo').all()).results || []; }
async function casellaPer(d, destinatari) {
  const cs = await caselleCf(d); const nomi = new Set(cs.map((c) => c.indirizzo));
  for (const r of destinatari) { const l = locale(r); if (String(r).toLowerCase().endsWith('@' + DOMINIO) && nomi.has(l)) return l; }
  return nomi.has('info') ? 'info' : cs[0]?.indirizzo || 'info'; // indirizzi sconosciuti finiscono in info@ (con "per:")
}

/* ---------- spam: punteggio semplice ma spiegato ---------- */
export async function valutaSpam(d, h, x, da) {
  const motivi = []; let p = 0;
  const auth = [h['authentication-results'], h['arc-authentication-results'], h['received-spf']].filter(Boolean).join(' ').toLowerCase();
  const spf = (auth.match(/spf=(\w+)/) || [])[1] || (/^(pass|fail|softfail|neutral|none)/.exec(String(h['received-spf'] || '').toLowerCase()) || [])[1] || '';
  const dkim = (auth.match(/dkim=(\w+)/) || [])[1] || '';
  const dmarc = (auth.match(/dmarc=(\w+)/) || [])[1] || '';
  if (spf === 'fail') { p += 3; motivi.push('SPF non valido'); } else if (spf === 'softfail') { p += 1.5; motivi.push('SPF debole'); }
  if (dkim === 'fail') { p += 2; motivi.push('firma DKIM non valida'); }
  if (dmarc === 'fail') { p += 3; motivi.push('DMARC non superato'); }
  if (!spf && !dkim) { p += 0.5; }
  const ogg = String(dec2047(h.subject || '')).toLowerCase(), corpo = testoPiano(x).toLowerCase().slice(0, 20000);
  const PAROLE = ['hai vinto', 'you won', 'winner', 'lotteria', 'lottery', 'bitcoin', 'crypto', 'criptovalut', 'viagra', 'cialis', 'casino', 'scommess', 'eredità', 'inheritance', 'investimento garantito', 'guadagna da casa',
    'password scaduta', 'verifica il tuo account', 'account sospeso', 'aggiorna i dati di pagamento', 'clicca qui per', 'urgent', 'wire transfer', 'gift card', 'seo service', 'backlink', 'ranking on google', 'web design service'];
  const trov = PAROLE.filter((w) => ogg.includes(w) || corpo.includes(w));
  if (trov.length) { p += Math.min(4, trov.length * 1.5); motivi.push('parole tipiche dello spam: ' + trov.slice(0, 3).join(', ')); }
  // phishing tipico: un esterno finge di essere il "servizio di posta" e minaccia di chiudere la casella ("Reconfirm email … or get deactivated")
  const PHISH = ['reconfirm', 'get deactivated', 'be deactivated', 'deactivation', 'still using my account', 'still using this account', 'closing down expired', 'expired and unknown users',
    'mailbox', 'storage is full', 'quota exceeded', 'verify your email', 'validate your email', 'password expir', 'keep your password', 'email upgrade',
    'conferma la tua email', 'conferma il tuo indirizzo', 'casella piena', 'casella di posta', 'spazio esaurito', 'verrà disattivat', 'sarà disattivat', 'disattivazione', 'mantenere la password'];
  const fuori = !String(da?.email || '').toLowerCase().endsWith('@' + DOMINIO);
  const fish = PHISH.filter((w) => ogg.includes(w) || corpo.includes(w));
  if (fuori && fish.length) {
    const nomina = ogg.includes(DOMINIO) || corpo.includes('@' + DOMINIO) || /\bhi info\b|\bciao info\b|\bdear info\b/.test(corpo);
    p += nomina || fish.length >= 2 ? 6 : 2.5;
    motivi.push('falso avviso di chiusura/verifica della casella (phishing): ' + fish.slice(0, 3).join(', '));
  }
  if (/[A-Z]{12,}/.test(dec2047(h.subject || '')) || /!!!|\$\$\$|€€€/.test(ogg)) { p += 1; motivi.push('oggetto urlato'); }
  const nomeDa = String(da?.nome || '').toLowerCase();
  if (/(semi ?store|se\.?m\.?i|dewalt|poste|intesa|unicredit|paypal|amazon|agenzia (delle )?entrate|inps)/.test(nomeDa) && da?.email && !/(semistore\.it|dewalt|sbdinc|stanleyblackanddecker|poste\.it|intesasanpaolo|unicredit|paypal|amazon|agenziaentrate|inps)/.test(da.email)) { p += 3; motivi.push('il nome imita un\'azienda ma l\'indirizzo è diverso'); }
  const links = (String(x.html || '') + ' ' + (x.testo || '')).match(/https?:\/\/[^\s"'<>]+/g) || [];
  if (links.some((l) => /https?:\/\/\d+\.\d+\.\d+\.\d+/.test(l))) { p += 2; motivi.push('link a indirizzi IP'); }
  if (links.filter((l) => /(bit\.ly|tinyurl|t\.co\/|cutt\.ly|rb\.gy|is\.gd)/.test(l)).length) { p += 1; motivi.push('link accorciati'); }
  if (x.allegati.some((a) => /\.(exe|scr|js|vbs|bat|cmd|jar|iso|img|lnk|hta|msi)$/i.test(a.nome))) { p += 5; motivi.push('allegato pericoloso'); }
  if (!x.testo && x.html && links.length > 15) { p += 1; motivi.push('solo grafica con molti link'); }
  // liste: decisioni dell'amministratore
  const dom = (da?.email || '').split('@')[1] || '';
  const lista = da?.email ? await d.prepare('SELECT email,tipo FROM pmail_liste WHERE email IN (?,?)').bind(da.email, '@' + dom).all() : { results: [] };
  for (const r of lista.results || []) { if (r.tipo === 'spam') { p += 10; motivi.push('mittente segnato come spam'); } if (r.tipo === 'ok') { p -= 10; motivi.push('mittente fidato'); } }
  if (h['in-reply-to']) { const r = await d.prepare("SELECT 1 FROM pmail WHERE message_id=? AND cartella='inviati' LIMIT 1").bind(String(h['in-reply-to']).trim()).first(); if (r) { p -= 4; motivi.push('risposta a una nostra email'); } }
  if (da?.email) { const r = await d.prepare("SELECT 1 FROM pmail WHERE cartella='inviati' AND a LIKE ? LIMIT 1").bind('%' + da.email + '%').first(); if (r) { p -= 2; motivi.push('gli abbiamo già scritto'); } }
  return { punti: Math.round(p * 10) / 10, spf, dkim, dmarc, motivi };
}

/* ---------- arrivo di un'email ---------- */
export async function riceviEmail(env, raw, { da: busta, a: destBusta, importa, senzaAuto } = {}) {
  const d = await cdb(env);
  const bin = typeof raw === 'string' ? raw : u82bin(new Uint8Array(raw));
  const x = leggiMime(bin), h = x.h;
  const da = indirizzi(h.from)[0] || (busta ? { nome: '', email: String(busta).toLowerCase() } : { nome: '', email: '' });
  const a = indirizzi(h.to), cc = indirizzi(h.cc);
  const dest = [destBusta, ...a.map((r) => r.email), ...cc.map((r) => r.email)].filter(Boolean).map((s) => String(s).toLowerCase());
  const casella = importa?.casella || (await casellaPer(d, dest));
  const per = String(destBusta || '').toLowerCase();
  const mid = String(h['message-id'] || '').trim();
  const data = importa?.data || Date.parse(h.date) || Date.now();
  const impronta = await sha(casella + '|' + (mid || '') + '|' + (mid ? '' : (h.subject || '') + data + da.email));
  const dopp = await d.prepare('SELECT id FROM pmail WHERE impronta=? LIMIT 1').bind(impronta).first();
  if (dopp) return { id: dopp.id, doppione: true };
  let cartella = importa?.cartella || 'arrivo', spam = { punti: 0, motivi: [] };
  if (!importa) { spam = await valutaSpam(d, h, x, da); if (spam.punti >= 5) cartella = 'spam'; }
  const id = crypto.randomUUID();
  const u8 = bin2u8(bin); const parti = Math.max(1, Math.ceil(u8.length / CHUNK));
  const ops = [d.prepare(`INSERT INTO pmail(id,casella,cartella,da_nome,da_email,a,cc,per,oggetto,data,anteprima,dim,allegati,letto,spam,spam_info,message_id,in_reply_to,riferimenti,parti,impronta,at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, casella, cartella, da.nome, da.email, JSON.stringify(a), JSON.stringify(cc),
    per && !per.startsWith(casella + '@') ? per : '', dec2047(h.subject || ''), data, testoPiano(x).slice(0, 220), u8.length, x.allegati.filter((z) => !z.cid).length,
    importa ? (importa.letto ? 1 : 0) : 0, spam.punti, JSON.stringify(spam), mid, String(h['in-reply-to'] || '').trim(), String(h.references || '').slice(0, 2000), parti, impronta, Date.now())];
  for (let i = 0; i < parti; i++) ops.push(d.prepare('INSERT INTO pmail_raw(id,n,dati) VALUES(?,?,?)').bind(id, i, u8.subarray(i * CHUNK, (i + 1) * CHUNK)));
  for (let i = 0; i < ops.length; i += 4) await d.batch(ops.slice(i, i + 4));
  let auto = null;
  if (!importa && !senzaAuto && cartella === 'arrivo') auto = await rispostaAutomatica(env, d, casella, h, da, x).catch((e) => 'errore: ' + e.message);
  return { id, casella, cartella, spam: spam.punti, auto };
}
export async function grezzoCf(d, id) {
  const r = (await d.prepare('SELECT dati FROM pmail_raw WHERE id=? ORDER BY n').bind(id).all()).results || [];
  return r.map((x) => u82bin(new Uint8Array(x.dati))).join('');
}

/* ---------- risposta automatica ---------- */
async function rispostaAutomatica(env, d, casella, h, da, x) {
  const c = await d.prepare('SELECT * FROM pcaselle WHERE indirizzo=?').bind(casella).first();
  if (!c || !c.auto_on || !c.auto_testo) return 'spenta';
  const e = String(da?.email || '').toLowerCase();
  if (!e || e.endsWith('@' + DOMINIO)) return 'interna';
  if (/^(no-?reply|noreply|mailer-daemon|postmaster|bounce|notifications?|newsletter|do-?not-?reply|info@mailer)/.test(e) || /(^|\.)(mailer|bounces?)\./.test(e)) return 'automatica';
  if ((h['auto-submitted'] && !/^no$/i.test(h['auto-submitted'])) || /bulk|list|junk/i.test(h.precedence || '') || h['list-id'] || h['list-unsubscribe'] || h['x-autoreply'] || h['x-autorespond']) return 'lista o automatica';
  const prima = await d.prepare('SELECT at FROM pmail_auto WHERE casella=? AND email=?').bind(casella, e).first();
  if (prima && Date.now() - prima.at < 3 * 864e5) return 'già risposto';
  const nome = (da.nome || '').split(/\s+/)[0] || '';
  const testo = c.auto_testo.replace(/\{nome\}/g, nome).replace(/Ciao ,/g, 'Ciao,').replace(/\{fuori_orario\}/g, aperto() ? '' : ' (ora siamo chiusi: riapriamo ' + ORARI + ')');
  const ogg = (c.auto_oggetto || 'Abbiamo ricevuto la tua email') + (h.subject ? ' – Re: ' + dec2047(h.subject).slice(0, 120) : '');
  const r = await inviaResend(env, { da: { nome: c.nome || 'Semi Store', email: `${casella}@${DOMINIO}` }, a: [da], oggetto: ogg, testo: testo + (c.firma && !c.norisposta ? '\n\n-- \n' + c.firma : ''),
    intestazioni: { 'Auto-Submitted': 'auto-replied', 'X-Auto-Response-Suppress': 'All', ...(h['message-id'] ? { 'In-Reply-To': h['message-id'], References: h['message-id'] } : {}) } });
  await d.prepare('INSERT INTO pmail_auto(casella,email,at) VALUES(?,?,?) ON CONFLICT(casella,email) DO UPDATE SET at=excluded.at').bind(casella, e, Date.now()).run();
  await salvaInviata(d, { casella, a: [da], cc: [], oggetto: ogg, testo, mid: r.mid, auto: 1 });
  return 'inviata';
}

/* ---------- invio con Resend ---------- */
const escH = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const testoInHtml = (t) => `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#222">${escH(t).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>').replace(/\n/g, '<br>')}</div>`;
export async function inviaResend(env, { da, a, cc = [], oggetto, testo, html, intestazioni = {}, allegati = [] }) {
  if (!env.RESEND_API_KEY) throw new Error('invio non configurato (manca RESEND_API_KEY)');
  const mid = `<${crypto.randomUUID()}@${DOMINIO}>`;
  const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: `${da.nome ? `"${String(da.nome).replace(/"/g, '')}" ` : ''}<${da.email}>`, to: a.map((x) => x.email), ...(cc.length ? { cc: cc.map((x) => x.email) } : {}),
      subject: oggetto || '(senza oggetto)', text: testo, html: html || testoInHtml(testo), headers: { 'Message-ID': mid, ...intestazioni },
      ...(allegati.length ? { attachments: allegati.map((x) => ({ filename: x.nome, content: x.b64, ...(x.tipo ? { content_type: x.tipo } : {}) })) } : {}) }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('invio rifiutato: ' + (j.message || j.error || r.status));
  return { mid, resend: j.id };
}
export async function salvaInviata(d, { casella, a, cc, oggetto, testo, html, mid, auto = 0, inReplyTo = '', riferimenti = '', allegati = [] }) {
  const id = crypto.randomUUID(), now = Date.now();
  // copia in formato .eml, così si apre come tutte le altre
  const b = 'semi-' + crypto.randomUUID();
  const enc = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : '=?UTF-8?B?' + btoa(u82bin(new TextEncoder().encode(s))) + '?=');
  const b64 = (s) => btoa(u82bin(new TextEncoder().encode(s))).replace(/.{1,76}/g, '$&\r\n');
  const raw = [`From: <${casella}@${DOMINIO}>`, `To: ${a.map((x) => x.email).join(', ')}`, ...(cc.length ? [`Cc: ${cc.map((x) => x.email).join(', ')}`] : []), `Subject: ${enc(oggetto || '')}`,
    `Date: ${new Date(now).toUTCString()}`, `Message-ID: ${mid}`, 'MIME-Version: 1.0', `Content-Type: multipart/mixed; boundary="${b}"`, '',
    `--${b}`, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', b64(testo || ''),
    ...(html ? [`--${b}`, 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: base64', '', b64(html)] : []),
    ...allegati.flatMap((x) => [`--${b}`, `Content-Type: ${x.tipo || 'application/octet-stream'}; name="${enc(x.nome)}"`, `Content-Disposition: attachment; filename*=UTF-8''${encodeURIComponent(x.nome)}`, 'Content-Transfer-Encoding: base64', '', x.b64.replace(/\s/g, '').replace(/.{1,76}/g, '$&\r\n')]),
    `--${b}--`, ''].join('\r\n');
  const u8 = bin2u8(raw); const parti = Math.max(1, Math.ceil(u8.length / CHUNK));
  const ops = [d.prepare(`INSERT INTO pmail(id,casella,cartella,da_nome,da_email,a,cc,oggetto,data,anteprima,dim,allegati,letto,message_id,in_reply_to,riferimenti,parti,auto,impronta,at)
    VALUES(?,?,'inviati',?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?,?)`).bind(id, casella, '', `${casella}@${DOMINIO}`, JSON.stringify(a), JSON.stringify(cc), oggetto || '', now, String(testo || '').slice(0, 220), u8.length, allegati.length, mid, inReplyTo, riferimenti, parti, auto, 'inv-' + id, now)];
  for (let i = 0; i < parti; i++) ops.push(d.prepare('INSERT INTO pmail_raw(id,n,dati) VALUES(?,?,?)').bind(id, i, u8.subarray(i * CHUNK, (i + 1) * CHUNK)));
  for (let i = 0; i < ops.length; i += 4) await d.batch(ops.slice(i, i + 4));
  return id;
}

/* risposta automatica per un'email già salvata (la chiama il Worker dopo aver salvato: il Worker non ha la chiave di Resend) */
export async function autoPerEmail(env, id) {
  const d = await cdb(env);
  try { await d.prepare('ALTER TABLE pmail ADD COLUMN autofatto INTEGER DEFAULT 0').run(); } catch (e) {}
  const r = await d.prepare("SELECT * FROM pmail WHERE id=? AND cartella='arrivo' AND at > ? AND IFNULL(autofatto,0)=0").bind(String(id), Date.now() - 3600e3).first();
  if (!r) return 'niente';
  await d.prepare('UPDATE pmail SET autofatto=1 WHERE id=?').bind(r.id).run();
  const raw = await grezzoCf(d, r.id); const x = leggiMime(raw);
  return rispostaAutomatica(env, d, r.casella, x.h, { nome: r.da_nome, email: r.da_email }, x);
}
