// Posta delle caselle @semistore.it (server Plesk) dentro l'app: IMAP per leggere, SMTP per inviare.
// Le email restano sul server: si vedono uguali anche in webmail.semistore.it.
// Le password delle caselle sono salvate cifrate (AES-GCM) con una chiave derivata da MAIL_KEY (o ADMIN_TOKEN).
import { connect } from 'cloudflare:sockets';

/* ---------------- cifratura password ---------------- */
async function chiave(env) {
  const seme = (env.MAIL_KEY || env.ADMIN_TOKEN || '') + '|posta-semi';
  if (seme.length < 12) throw new Error('chiave di cifratura mancante (ADMIN_TOKEN)');
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seme));
  return crypto.subtle.importKey('raw', h, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export async function cifra(env, testo) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const c = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await chiave(env), new TextEncoder().encode(testo)));
  return b64(iv) + '.' + b64(c);
}
export async function decifra(env, s) {
  const [iv, c] = String(s || '').split('.');
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await chiave(env), unb64(c)));
}

/* ---------------- tabella caselle ---------------- */
export async function pdb(env) {
  const d = env.DB;
  await d.prepare(`CREATE TABLE IF NOT EXISTS caselle(id TEXT PRIMARY KEY, email TEXT UNIQUE, nome TEXT, utente TEXT, pass TEXT,
    host TEXT, porta INTEGER, sic TEXT, shost TEXT, sporta INTEGER, ssic TEXT, firma TEXT, ordine INTEGER DEFAULT 0, at INTEGER)`).run();
  return d;
}

/* ---------------- byte <-> stringa "binaria" (1 carattere = 1 byte) ---------------- */
const lat = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return s; };
const unlat = (s) => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u; };
const utf8bin = (s) => lat(new TextEncoder().encode(s));
const binutf8 = (s) => new TextDecoder().decode(unlat(s));

/* ---------------- connessione di testo con TLS ---------------- */
class Linea {
  constructor(host, porta, sic) { this.host = host; this.porta = porta; this.sic = sic; this.s = ''; }
  async apri() {
    const locale = /^(localhost|127\.0\.0\.1)$/.test(this.host);
    const st = this.sic === 'starttls' ? 'starttls' : this.sic === 'nessuna' && locale ? 'off' : 'on';
    this.sock = connect({ hostname: this.host, port: this.porta }, { secureTransport: st, allowHalfOpen: false });
    this.w = this.sock.writable.getWriter(); this.r = this.sock.readable.getReader();
  }
  async tls() { this.w.releaseLock(); this.r.releaseLock(); this.sock = this.sock.startTls(); this.w = this.sock.writable.getWriter(); this.r = this.sock.readable.getReader(); this.s = ''; }
  async scrivi(bin) { await this.w.write(unlat(bin)); }
  async piu() {
    const t = setTimeout(() => { try { this.sock.close(); } catch (e) {} }, 25000);
    const { value, done } = await this.r.read().finally(() => clearTimeout(t));
    if (done) throw new Error('il server ha chiuso la connessione');
    this.s += lat(value);
  }
  async riga() { let i; while ((i = this.s.indexOf('\r\n')) < 0) await this.piu(); const l = this.s.slice(0, i); this.s = this.s.slice(i + 2); return l; }
  // risposta IMAP "logica": include i literal {n}
  async risposta() {
    let out = '';
    for (;;) {
      let i; while ((i = this.s.indexOf('\r\n')) < 0) await this.piu();
      const l = this.s.slice(0, i); this.s = this.s.slice(i + 2); out += l;
      const m = l.match(/\{(\d+)\+?\}$/);
      if (!m) return out;
      const n = Number(m[1]); while (this.s.length < n) await this.piu();
      out += '\r\n' + this.s.slice(0, n); this.s = this.s.slice(n);
    }
  }
  chiudi() { try { this.w.close(); } catch (e) {} try { this.sock.close(); } catch (e) {} }
}

/* ---------------- parser delle risposte IMAP ---------------- */
function analizza(s) {
  let i = 0;
  const val = () => {
    while (s[i] === ' ') i++;
    const c = s[i];
    if (c === '(') { i++; const l = []; for (;;) { while (s[i] === ' ') i++; if (s[i] === ')') { i++; return l; } if (i >= s.length) return l; l.push(val()); } }
    if (c === '"') { i++; let o = ''; while (i < s.length && s[i] !== '"') { if (s[i] === '\\') i++; o += s[i++]; } i++; return o; }
    if (c === '{') { const j = s.indexOf('}', i); const n = parseInt(s.slice(i + 1, j)); i = j + 3; const o = s.slice(i, i + n); i += n; return o; }
    let o = '';
    while (i < s.length && s[i] !== ' ' && s[i] !== '(' && s[i] !== ')') {
      if (s[i] === '[') { const j = s.indexOf(']', i); o += s.slice(i, j + 1); i = j + 1; continue; }
      o += s[i++];
    }
    return o === 'NIL' ? null : o;
  };
  const out = []; while (i < s.length) { const v = val(); if (v === '' && i < s.length && s[i] !== ' ' && s[i] !== '(') i++; out.push(v); }
  return out;
}
const q = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

/* nomi delle cartelle in UTF-7 modificato (RFC 3501) */
export function daUtf7(s) {
  return String(s).replace(/&([^-]*)-/g, (m, x) => {
    if (!x) return '&';
    const b = atob(x.replace(/,/g, '/') + '==='.slice((x.length + 3) % 4)); let o = '';
    for (let i = 0; i + 1 < b.length; i += 2) o += String.fromCharCode((b.charCodeAt(i) << 8) | b.charCodeAt(i + 1));
    return o;
  });
}

export class Imap {
  constructor(c) { this.c = c; this.n = 0; this.cap = ''; }
  async apri() {
    this.l = new Linea(this.c.host, this.c.porta || 993, this.c.sic || 'ssl'); await this.l.apri();
    const g = await this.l.risposta(); if (!/^\* (OK|PREAUTH)/i.test(g)) throw new Error('server IMAP: ' + g.slice(0, 120));
    if (this.c.sic === 'starttls') { await this.cmd('STARTTLS'); await this.l.tls(); }
    const r = await this.cmd(`LOGIN ${q(this.c.utente)} ${q(this.c.pass)}`).catch((e) => { throw new Error('accesso rifiutato: utente o password sbagliati (' + e.message + ')'); });
    const cp = (await this.cmd('CAPABILITY')).find((x) => /^\* CAPABILITY/i.test(x)); this.cap = (cp || '').toUpperCase();
    return r;
  }
  // manda un comando e restituisce le risposte "*"; errore se NO/BAD
  async cmd(t, dati) {
    const tag = 'S' + (++this.n);
    await this.l.scrivi(utf8bin(`${tag} ${t}\r\n`));
    const out = [];
    for (;;) {
      const r = await this.l.risposta();
      if (r.startsWith('+') && dati !== undefined) { await this.l.scrivi(dati + '\r\n'); dati = undefined; continue; }
      if (r.startsWith(tag + ' ')) { if (!/^\S+ OK/i.test(r)) throw new Error(r.slice(tag.length + 1, 200)); return out; }
      out.push(r);
    }
  }
  async cartelle() {
    const r = await this.cmd('LIST "" "*"'); const out = [];
    for (const x of r) {
      const m = x.match(/^\* LIST \(([^)]*)\) (?:"((?:[^"\\]|\\.)*)"|NIL) (.*)$/i); if (!m) continue;
      const fl = m[1].toLowerCase(); if (fl.includes('\\noselect') || fl.includes('\\nonexistent')) continue;
      const nome = analizza(m[3])[0]; const sep = m[2] || '.';
      let uso = /\\junk/.test(fl) ? 'spam' : /\\sent/.test(fl) ? 'inviati' : /\\trash/.test(fl) ? 'cestino' : /\\drafts/.test(fl) ? 'bozze' : /\\archive/.test(fl) ? 'archivio' : '';
      const ult = daUtf7(nome).split(sep).pop().toLowerCase();
      if (!uso) uso = nome.toUpperCase() === 'INBOX' ? 'arrivo' : /^(spam|junk|posta indesiderata|indesiderata)/.test(ult) ? 'spam' : /^(sent|inviat|posta inviata|elementi inviati)/.test(ult) ? 'inviati' : /^(trash|cestino|deleted|eliminat)/.test(ult) ? 'cestino' : /^(drafts|bozze)/.test(ult) ? 'bozze' : '';
      out.push({ nome, vista: nome.toUpperCase() === 'INBOX' ? 'In arrivo' : daUtf7(nome).split(sep).slice(nome.toUpperCase().startsWith('INBOX' + sep) ? 1 : 0).join(' / '), uso, sep });
    }
    for (const f of out) {
      try { const s = (await this.cmd(`STATUS ${q(f.nome)} (MESSAGES UNSEEN)`)).join(' '); f.tot = Number((s.match(/MESSAGES (\d+)/i) || [])[1] || 0); f.nuove = Number((s.match(/UNSEEN (\d+)/i) || [])[1] || 0); } catch (e) { f.tot = f.nuove = 0; }
    }
    const NOMI = { arrivo: 'In arrivo', bozze: 'Bozze', inviati: 'Inviati', spam: 'Spam', cestino: 'Cestino', archivio: 'Archivio' };
    out.forEach((f) => { if (NOMI[f.uso] && !out.some((g) => g !== f && g.uso === f.uso)) f.vista = NOMI[f.uso]; });
    const ord = { arrivo: 0, bozze: 2, inviati: 3, spam: 4, cestino: 5, archivio: 6 };
    return out.sort((a, b) => (ord[a.uso] ?? 1) - (ord[b.uso] ?? 1) || a.vista.localeCompare(b.vista));
  }
  async seleziona(f) { const r = await this.cmd(`SELECT ${q(f)}`); const m = r.join('\n').match(/\* (\d+) EXISTS/i); return m ? Number(m[1]) : 0; }
  async trova(f) { const l = await this.cartelle().catch(() => []); return l.find((x) => x.uso === f); }
  analizzaFetch(righe) {
    const out = [];
    for (const r of righe) {
      const m = r.match(/^\* (\d+) FETCH /i); if (!m) continue;
      const v = analizza(r.slice(m[0].length))[0] || []; const o = { seq: Number(m[1]) };
      for (let i = 0; i + 1 < v.length; i += 2) o[String(v[i]).toUpperCase()] = v[i + 1];
      out.push(o);
    }
    return out;
  }
  async elenco(f, { prima = 0, n = 40, cerca = '' } = {}) {
    const tot = await this.seleziona(f); if (!tot) return { tot: 0, mess: [] };
    let set, uid = false;
    if (cerca) {
      const r = (await this.cmd(`UID SEARCH CHARSET UTF-8 TEXT ${q(utf8bin(cerca))}`).catch(() => this.cmd(`UID SEARCH TEXT ${q(cerca.replace(/[^\x20-\x7e]/g, ''))}`))).join(' ');
      const uids = (r.match(/\* SEARCH ?(.*)/i) || [])[1]?.trim().split(/\s+/).filter(Boolean).map(Number) || [];
      const pag = uids.sort((a, b) => b - a).slice(prima, prima + n); if (!pag.length) return { tot: uids.length, mess: [] };
      set = pag.join(','); uid = true;
      return { tot: uids.length, mess: this.mappa(this.analizzaFetch(await this.cmd(`UID FETCH ${set} (UID FLAGS INTERNALDATE RFC822.SIZE ENVELOPE BODYSTRUCTURE)`))) };
    }
    const a = Math.max(1, tot - prima - n + 1), b = tot - prima; if (b < 1) return { tot, mess: [] };
    set = `${a}:${b}`;
    return { tot, mess: this.mappa(this.analizzaFetch(await this.cmd(`${uid ? 'UID ' : ''}FETCH ${set} (UID FLAGS INTERNALDATE RFC822.SIZE ENVELOPE BODYSTRUCTURE)`))) };
  }
  mappa(l) {
    const ind = (x) => (Array.isArray(x) ? x : []).map((a) => ({ nome: dec2047(a[0] || ''), email: a[2] && a[3] ? `${a[2]}@${a[3]}` : a[2] || '' }));
    return l.map((o) => {
      const e = o.ENVELOPE || []; const fl = (o.FLAGS || []).map((x) => String(x).toLowerCase());
      return { uid: Number(o.UID), data: Date.parse(o.INTERNALDATE) || Date.parse(e[0]) || 0, oggetto: dec2047(e[1] || ''), da: ind(e[2])[0] || { nome: '', email: '' }, a: ind(e[5]), cc: ind(e[6]),
        letto: fl.includes('\\seen'), risposto: fl.includes('\\answered'), stella: fl.includes('\\flagged'), dim: Number(o['RFC822.SIZE'] || 0), allegati: haAllegati(o.BODYSTRUCTURE) };
    }).sort((a, b) => b.data - a.data || b.uid - a.uid);
  }
  async grezzo(f, uid) {
    await this.seleziona(f);
    const r = this.analizzaFetch(await this.cmd(`UID FETCH ${Number(uid)} (UID FLAGS RFC822.SIZE BODY.PEEK[])`))[0];
    if (!r) throw new Error('email non trovata (forse spostata o cancellata)');
    return { raw: r['BODY[]'] || '', flags: (r.FLAGS || []).map((x) => String(x).toLowerCase()) };
  }
  async flag(f, uid, piu, fl) { await this.seleziona(f); await this.cmd(`UID STORE ${uid} ${piu ? '+' : '-'}FLAGS.SILENT (${fl})`); }
  async sposta(f, uid, verso) {
    await this.seleziona(f);
    if (this.cap.includes('MOVE')) return this.cmd(`UID MOVE ${uid} ${q(verso)}`);
    await this.cmd(`UID COPY ${uid} ${q(verso)}`); await this.cmd(`UID STORE ${uid} +FLAGS.SILENT (\\Deleted)`);
    if (this.cap.includes('UIDPLUS')) await this.cmd(`UID EXPUNGE ${uid}`); else await this.cmd('EXPUNGE');
  }
  async elimina(f, uid) { await this.seleziona(f); await this.cmd(`UID STORE ${uid} +FLAGS.SILENT (\\Deleted)`); if (this.cap.includes('UIDPLUS')) await this.cmd(`UID EXPUNGE ${uid}`); else await this.cmd('EXPUNGE'); }
  async aggiungi(f, bin, flag = '\\Seen') { await this.cmd(`APPEND ${q(f)} (${flag}) {${bin.length}}`, bin); }
  async chiudi() { try { await this.cmd('LOGOUT'); } catch (e) {} this.l.chiudi(); }
}
function haAllegati(bs) {
  let si = false; const giro = (x) => { if (!Array.isArray(x)) return; if (typeof x[0] === 'string' && typeof x[1] === 'string') { const disp = JSON.stringify(x).toLowerCase(); if (/"attachment"/.test(disp) || (!/^text$/i.test(x[0]) && !/^multipart$/i.test(x[0]) && /"name"|"filename"/.test(disp))) si = true; return; } x.forEach(giro); };
  giro(bs); return si;
}

/* ---------------- SMTP ---------------- */
export async function inviaSmtp(c, { da, destinatari, bin }) {
  const l = new Linea(c.shost || c.host, c.sporta || 465, c.ssic || (Number(c.sporta) === 587 ? 'starttls' : 'ssl')); await l.apri();
  const leggi = async () => { let r = '', x; do { x = await l.riga(); r += x + '\n'; } while (/^\d{3}-/.test(x)); return r; };
  const atteso = async (cod, cosa) => { const r = await leggi(); if (!r.startsWith(String(cod))) throw new Error(`SMTP (${cosa}): ${r.trim().slice(0, 200)}`); return r; };
  const dici = async (t, cod, cosa) => { await l.scrivi(utf8bin(t + '\r\n')); return atteso(cod, cosa); };
  try {
    await atteso(220, 'saluto');
    let eh = await dici('EHLO semistore.it', 250, 'EHLO');
    if (l.sic === 'starttls') { await dici('STARTTLS', 220, 'STARTTLS'); await l.tls(); eh = await dici('EHLO semistore.it', 250, 'EHLO'); }
    if (/AUTH[ =][^\n]*PLAIN/i.test(eh)) await dici('AUTH PLAIN ' + btoa(utf8bin(`\0${c.utente}\0${c.pass}`)), 235, 'accesso');
    else { await dici('AUTH LOGIN', 334, 'accesso'); await dici(btoa(utf8bin(c.utente)), 334, 'accesso'); await dici(btoa(utf8bin(c.pass)), 235, 'accesso'); }
    await dici(`MAIL FROM:<${da}>`, 250, 'mittente');
    for (const r of destinatari) await dici(`RCPT TO:<${r}>`, 25, 'destinatario ' + r);
    await dici('DATA', 354, 'DATA');
    await l.scrivi(bin.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..') + '\r\n.\r\n'); await atteso(250, 'invio');
    await l.scrivi('QUIT\r\n').catch(() => {});
  } finally { l.chiudi(); }
}

/* ---------------- MIME: lettura ---------------- */
export function dec2047(s) {
  return String(s || '').replace(/\?=\s+=\?/g, '?==?').replace(/=\?([^?]+)\?([bqBQ])\?([^?]*)\?=/g, (m, cs, enc, t) => {
    try { const bin = enc.toUpperCase() === 'B' ? atob(t.replace(/\s/g, '')) : t.replace(/_/g, ' ').replace(/=([0-9a-f]{2})/gi, (x, h) => String.fromCharCode(parseInt(h, 16))); return decCharset(bin, cs); } catch (e) { return t; }
  }).replace(/[\u0080-ÿ]{2,}/g, (x) => { try { return binutf8(x); } catch (e) { return x; } });
}
function decCharset(bin, cs) {
  cs = String(cs || 'utf-8').toLowerCase().replace(/^(us-ascii|ascii)$/, 'utf-8').replace(/^latin-?1$/, 'iso-8859-1');
  try { return new TextDecoder(cs, { fatal: false }).decode(unlat(bin)); } catch (e) { return new TextDecoder('windows-1252').decode(unlat(bin)); }
}
function testate(h) {
  const o = {}; h.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/).forEach((l) => { const i = l.indexOf(':'); if (i > 0) { const k = l.slice(0, i).trim().toLowerCase(); const v = l.slice(i + 1).trim(); if (o[k] === undefined) o[k] = v; else if (k === 'received') o[k] += '\n' + v; } });
  return o;
}
function param(v, nome) {
  const s = String(v || '');
  const star = s.match(new RegExp(`${nome}\\*0?\\*?=([^;]+)`, 'i'));
  if (star) { const parti = [...s.matchAll(new RegExp(`${nome}\\*(\\d+)\\*?=("[^"]*"|[^;]+)`, 'gi'))].sort((a, b) => a[1] - b[1]).map((x) => x[2].replace(/^"|"$/g, '')).join('') || star[1].replace(/^"|"$/g, '');
    const m = parti.match(/^([^']*)'[^']*'(.*)$/); if (m) { try { return decCharset(m[2].replace(/%([0-9a-f]{2})/gi, (x, h) => String.fromCharCode(parseInt(h, 16))), m[1] || 'utf-8'); } catch (e) {} } return parti; }
  const m = s.match(new RegExp(`(?:^|;)\\s*${nome}\\s*=\\s*("((?:[^"\\\\]|\\\\.)*)"|[^;\\s]+)`, 'i'));
  return m ? dec2047(m[2] !== undefined ? m[2] : m[1]) : '';
}
function corpo(bin, cte) {
  cte = String(cte || '').toLowerCase();
  if (cte === 'base64') { try { return atob(bin.replace(/[^A-Za-z0-9+/=]/g, '')); } catch (e) { return ''; } }
  if (cte === 'quoted-printable') return bin.replace(/=\r?\n/g, '').replace(/=([0-9a-f]{2})/gi, (x, h) => String.fromCharCode(parseInt(h, 16)));
  return bin;
}
export function leggiMime(raw) {
  const out = { testo: '', html: '', allegati: [], cid: {} };
  const giro = (bin, path) => {
    const sep = bin.search(/\r?\n\r?\n/); const h = testate(sep < 0 ? bin : bin.slice(0, sep)); const b = sep < 0 ? '' : bin.slice(sep).replace(/^\r?\n\r?\n/, '');
    const ct = h['content-type'] || 'text/plain'; const tipo = ct.split(';')[0].trim().toLowerCase(); const disp = String(h['content-disposition'] || '').toLowerCase();
    if (tipo.startsWith('multipart/')) {
      const bd = param(ct, 'boundary'); if (!bd) return;
      const pezzi = b.split(new RegExp('\\r?\\n?--' + bd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:--)?[ \\t]*\\r?\\n?'));
      pezzi.slice(1).forEach((p, k) => { if (p.trim()) giro(p, path ? path + '.' + (k + 1) : String(k + 1)); });
      return out;
    }
    if (tipo === 'message/rfc822' && !disp.startsWith('attachment')) { giro(b, path); return; }
    const nomeF = param(h['content-disposition'], 'filename') || param(ct, 'name');
    const dati = corpo(b, h['content-transfer-encoding']);
    if (!disp.startsWith('attachment') && !nomeF && (tipo === 'text/plain' || tipo === 'text/html')) {
      const t = decCharset(dati, param(ct, 'charset') || 'utf-8');
      if (tipo === 'text/plain' && !out.testo) out.testo = t; else if (tipo === 'text/html' && !out.html) out.html = t; else if (tipo === 'text/plain') out.testo += '\n\n' + t;
      return;
    }
    const cid = String(h['content-id'] || '').replace(/[<>]/g, '');
    const a = { part: path || '1', nome: nomeF || (cid ? 'immagine' : 'allegato'), tipo, dim: dati.length, cid };
    if (cid && tipo.startsWith('image/') && dati.length < 400000) out.cid[cid] = `data:${tipo};base64,${btoa(dati)}`;
    if (!(cid && disp.startsWith('inline') && !nomeF)) out.allegati.push(a);
  };
  const sep = raw.search(/\r?\n\r?\n/); out.h = testate(sep < 0 ? raw : raw.slice(0, sep));
  giro(raw, ''); return out;
}
export function parteMime(raw, part) {
  let trovato = null;
  const giro = (bin, path) => {
    const sep = bin.search(/\r?\n\r?\n/); const h = testate(sep < 0 ? bin : bin.slice(0, sep)); const b = sep < 0 ? '' : bin.slice(sep).replace(/^\r?\n\r?\n/, '');
    const ct = h['content-type'] || 'text/plain'; const tipo = ct.split(';')[0].trim().toLowerCase();
    if (tipo.startsWith('multipart/')) { const bd = param(ct, 'boundary'); b.split(new RegExp('\\r?\\n?--' + bd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:--)?[ \\t]*\\r?\\n?')).slice(1).forEach((p, k) => { if (p.trim()) giro(p, path ? path + '.' + (k + 1) : String(k + 1)); }); return; }
    if (tipo === 'message/rfc822' && !String(h['content-disposition'] || '').toLowerCase().startsWith('attachment')) { giro(b, path); return; }
    if ((path || '1') === part && !trovato) trovato = { tipo, nome: param(h['content-disposition'], 'filename') || param(ct, 'name') || 'allegato', dati: unlat(corpo(b, h['content-transfer-encoding'])) };
  };
  giro(raw, ''); return trovato;
}
export function indirizzi(s) {
  const out = []; let cur = '', inq = false, ang = false;
  const pezzi = []; for (const ch of String(s || '')) { if (ch === '"') inq = !inq; if (ch === '<') ang = true; if (ch === '>') ang = false; if ((ch === ',' || ch === ';') && !inq && !ang) { pezzi.push(cur); cur = ''; } else cur += ch; } pezzi.push(cur);
  for (let p of pezzi) { p = p.trim(); if (!p) continue;
    const m = p.match(/^(.*)<([^<>]+@[^<>]+)>\s*$/);
    if (m) out.push({ nome: dec2047(m[1].trim().replace(/^"|"$/g, '').trim()), email: m[2].trim().toLowerCase() });
    else { const e = p.match(/[^\s<>"]+@[^\s<>"]+/); if (e) out.push({ nome: '', email: e[0].toLowerCase() }); } }
  return out;
}

/* ---------------- MIME: scrittura ---------------- */
const enc2047 = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : '=?UTF-8?B?' + btoa(utf8bin(s)) + '?=');
const indir = (a) => (a.nome ? `${/^[\w .-]*$/.test(a.nome) ? `"${a.nome}"` : enc2047(a.nome)} <${a.email}>` : a.email);
const a76 = (s) => s.replace(/.{1,76}/g, '$&\r\n');
export function costruisci({ da, a, cc, oggetto, testo, html, rispostaA, riferimenti, allegati = [] }) {
  const id = `<${crypto.randomUUID()}@semistore.it>`;
  const h = [`From: ${indir(da)}`, `To: ${a.map(indir).join(', ')}`, ...(cc.length ? [`Cc: ${cc.map(indir).join(', ')}`] : []), `Subject: ${enc2047(oggetto || '')}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`, `Message-ID: ${id}`, 'MIME-Version: 1.0', ...(rispostaA ? [`In-Reply-To: ${rispostaA}`, `References: ${[riferimenti, rispostaA].filter(Boolean).join(' ')}`] : []), 'X-Mailer: Semi Gestione'];
  const b1 = 'semi-' + crypto.randomUUID(), b2 = 'semi-' + crypto.randomUUID();
  const alt = `Content-Type: multipart/alternative; boundary="${b2}"\r\n\r\n--${b2}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${a76(btoa(utf8bin(testo || '')))}--${b2}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${a76(btoa(utf8bin(html || '')))}--${b2}--\r\n`;
  let corpo;
  if (!allegati.length) corpo = h.join('\r\n') + '\r\n' + alt;
  else corpo = h.join('\r\n') + `\r\nContent-Type: multipart/mixed; boundary="${b1}"\r\n\r\n--${b1}\r\n` + alt + allegati.map((x) => `--${b1}\r\nContent-Type: ${x.tipo || 'application/octet-stream'}; name="${enc2047(x.nome)}"\r\nContent-Disposition: attachment; filename*=UTF-8''${encodeURIComponent(x.nome)}\r\nContent-Transfer-Encoding: base64\r\n\r\n${a76(x.b64.replace(/\s/g, ''))}`).join('') + `--${b1}--\r\n`;
  return { bin: corpo, id };
}

/* ---------------- Plesk (XML API): elenco, creazione e password delle caselle ---------------- */
export async function segreto(env, k, v) {
  const d = env.DB; await d.prepare('CREATE TABLE IF NOT EXISTS segreti(k TEXT PRIMARY KEY, v TEXT, at INTEGER)').run();
  if (v === undefined) { const r = await d.prepare('SELECT v FROM segreti WHERE k=?').bind(k).first(); return r ? JSON.parse(await decifra(env, r.v)) : null; }
  if (v === null) { await d.prepare('DELETE FROM segreti WHERE k=?').bind(k).run(); return null; }
  await d.prepare('INSERT INTO segreti(k,v,at) VALUES(?,?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v, at=excluded.at').bind(k, await cifra(env, JSON.stringify(v)), Date.now()).run();
  return v;
}
const xe = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const tag = (x, t) => { const m = String(x).match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)); return m ? m[1].trim() : ''; };
export async function pleskXml(cfg, corpo) {
  let url = String(cfg.url || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(url)) url = 'https://' + url;
  if (!/:\d+$/.test(url.replace(/^https?:\/\//, ''))) url += ':8443';
  let r;
  try {
    r = await fetch(url + '/enterprise/control/agent.php', { method: 'POST', headers: { 'content-type': 'text/xml', HTTP_AUTH_LOGIN: cfg.login, HTTP_AUTH_PASSWD: cfg.pass, HTTP_PRETTY_PRINT: 'TRUE' },
      body: `<?xml version="1.0" encoding="UTF-8"?><packet>${corpo}</packet>`, signal: AbortSignal.timeout(20000) });
  } catch (e) { throw new Error(`Plesk non raggiungibile su ${url} (${e.message}). Controlla indirizzo e porta (di solito 8443) e che il pannello abbia un certificato SSL valido.`); }
  const t = await r.text();
  if (!r.ok) throw new Error(`Plesk ha risposto ${r.status}`);
  const errs = [...t.matchAll(/<status>error<\/status>\s*<errcode>(\d+)<\/errcode>\s*<errtext>([\s\S]*?)<\/errtext>/g)];
  if (errs.length) { const e = new Error(`Plesk: ${errs[0][2].trim()} (codice ${errs[0][1]})`); e.cod = Number(errs[0][1]); throw e; }
  return t;
}
export async function pleskSito(cfg) {
  const t = await pleskXml(cfg, `<site><get><filter><name>${xe(cfg.dominio)}</name></filter><dataset><gen_info/></dataset></get></site>`);
  const id = tag(t, 'id'); if (!id) throw new Error(`dominio ${cfg.dominio} non trovato in Plesk`); return id;
}
export async function pleskCaselle(cfg) {
  const t = await pleskXml(cfg, `<mail><get_info><filter><site-id>${xe(cfg.sito)}</site-id></filter><mailbox/></get_info></mail>`);
  return [...t.matchAll(/<mailname>([\s\S]*?)<\/mailname>/g)].map((m) => ({ id: tag(m[1], 'id'), nome: tag(m[1], 'name'), attiva: !/<enabled>false<\/enabled>/.test(tag(m[1], 'mailbox')) || !tag(m[1], 'mailbox'), quota: Number(tag(m[1], 'quota') || -1) }))
    .filter((x) => x.nome).map((x) => ({ ...x, email: `${x.nome}@${cfg.dominio}`.toLowerCase() })).sort((a, b) => a.email.localeCompare(b.email));
}
const pw = (p) => `<password><value>${xe(p)}</value><type>plain</type></password>`;
export async function pleskCrea(cfg, nome, pass) {
  try { await pleskXml(cfg, `<mail><create><filter><site-id>${xe(cfg.sito)}</site-id><mailname><name>${xe(nome)}</name><mailbox><enabled>true</enabled></mailbox>${pw(pass)}</mailname></filter></create></mail>`); }
  catch (e) { if (e.cod !== 1014) throw e; // versioni che non accettano password insieme a mailbox: si crea e poi si imposta
    await pleskXml(cfg, `<mail><create><filter><site-id>${xe(cfg.sito)}</site-id><mailname><name>${xe(nome)}</name><mailbox><enabled>true</enabled></mailbox></mailname></filter></create></mail>`);
    await pleskPassword(cfg, nome, pass); }
}
export async function pleskPassword(cfg, nome, pass) {
  await pleskXml(cfg, `<mail><update><set><filter><site-id>${xe(cfg.sito)}</site-id><mailname><name>${xe(nome)}</name>${pw(pass)}</mailname></filter></set></update></mail>`);
}
export async function pleskElimina(cfg, nome) {
  await pleskXml(cfg, `<mail><remove><filter><site-id>${xe(cfg.sito)}</site-id><name>${xe(nome)}</name></filter></remove></mail>`);
}
export function nuovaPassword() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ', a = 'abcdefghijkmnpqrstuvwxyz', n = '23456789', s = '!#%+=?@';
  const r = (x) => x[crypto.getRandomValues(new Uint32Array(1))[0] % x.length];
  const base = [r(A), r(A), r(a), r(a), r(a), r(n), r(n), r(s), ...Array.from({ length: 8 }, () => r(A + a + n))];
  for (let i = base.length - 1; i > 0; i--) { const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1); [base[i], base[j]] = [base[j], base[i]]; }
  return base.join('');
}

/* diagnosi quando l'accesso non riesce: il server risponde in chiaro sulla 143? allora il problema è il certificato SSL */
export async function diagnosi(host) {
  const prova = async (porta) => { const l = new Linea(host, porta, 'nessuna'); l.host = host;
    try { l.sock = connect({ hostname: host, port: porta }, { secureTransport: 'off', allowHalfOpen: false }); l.w = l.sock.writable.getWriter(); l.r = l.sock.readable.getReader();
      const g = await Promise.race([l.riga(), new Promise((_, ko) => setTimeout(() => ko(new Error('nessuna risposta')), 8000))]); return g; }
    catch (e) { return 'ERR ' + e.message; } finally { l.chiudi(); } };
  const imap = await prova(143), smtp = await prova(587);
  return { imap, smtp };
}
