// Account clienti: accesso senza password con link via email (Resend), sessione in cookie HttpOnly,
// profilo privato o partita IVA, ordini e punti. Dati nel database D1 (binding DB): le tabelle si creano da sole.
import { db } from './db.js';
import { SITO } from '../../src/data/sito.js';

export const COOKIE = 'semi_s';
const SESSIONE_GG = 180;
const enc = new TextEncoder();
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
export const hash = async (t) => hex(await crypto.subtle.digest('SHA-256', enc.encode(t)));
export const casuale = (n = 32) => hex(crypto.getRandomValues(new Uint8Array(n)));
export const normEmail = (e) => String(e || '').trim().toLowerCase();
export const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
export const json = (o, s = 200, h = {}) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...h } });

let pronto = false;
export async function dbc(env) {
  const d = await db(env);
  if (!pronto) {
    try { await d.batch([
      d.prepare(`CREATE TABLE IF NOT EXISTS clienti (
        id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, tipo TEXT,
        nome TEXT, cognome TEXT, telefono TEXT, cf TEXT,
        ragione_sociale TEXT, piva TEXT, sdi TEXT, pec TEXT,
        indirizzo TEXT, cap TEXT, citta TEXT, provincia TEXT,
        offerte INTEGER NOT NULL DEFAULT 0, punti INTEGER NOT NULL DEFAULT 0,
        creato TEXT, aggiornato TEXT, ultimo_accesso TEXT)`),
      d.prepare(`CREATE TABLE IF NOT EXISTS accessi (
        h TEXT PRIMARY KEY, email TEXT NOT NULL, scade INTEGER NOT NULL, riusabile INTEGER NOT NULL DEFAULT 0, usato INTEGER NOT NULL DEFAULT 0)`),
      d.prepare(`CREATE TABLE IF NOT EXISTS csessioni (h TEXT PRIMARY KEY, cliente TEXT NOT NULL, scade INTEGER NOT NULL)`),
      d.prepare('CREATE INDEX IF NOT EXISTS cs_cliente ON csessioni(cliente)'),
      d.prepare(`CREATE TABLE IF NOT EXISTS ordini (
        sessione TEXT PRIMARY KEY, cliente TEXT, email TEXT, totale INTEGER, spedizione INTEGER,
        punti INTEGER NOT NULL DEFAULT 0, fattura INTEGER NOT NULL DEFAULT 0, dati_fattura TEXT,
        consegna TEXT, righe TEXT, quando TEXT)`),
      d.prepare('CREATE INDEX IF NOT EXISTS o_cliente ON ordini(cliente)'),
      d.prepare(`CREATE TABLE IF NOT EXISTS punti_mov (
        id TEXT PRIMARY KEY, cliente TEXT NOT NULL, delta INTEGER NOT NULL, motivo TEXT, quando TEXT)`),
      d.prepare('CREATE INDEX IF NOT EXISTS p_cliente ON punti_mov(cliente)'),
    ]); } catch (e) { if (!/write limit|read.?only/i.test(String(e && e.message))) throw e; /* scritture finite per oggi: le tabelle ci sono già */ }
    try { await d.prepare('ALTER TABLE ordini ADD COLUMN pi TEXT').run(); } catch {} // payment intent, per i rimborsi
    try { await d.prepare('ALTER TABLE clienti ADD COLUMN stripe_cus TEXT').run(); } catch {} // cliente Stripe: il pagamento si apre già compilato
    pronto = true;
  }
  return d;
}

const leggiCookie = (request, nome) => {
  const c = request.headers.get('cookie') || '';
  const m = c.match(new RegExp('(?:^|;\\s*)' + nome + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : '';
};

// Cliente collegato (o null)
export async function cliente(request, env) {
  if (!env.DB) return null;
  const t = leggiCookie(request, COOKIE);
  if (!t || t.length > 100) return null;
  const d = await dbc(env);
  const s = await d.prepare('SELECT cliente, scade FROM csessioni WHERE h=?').bind(await hash(t)).first();
  if (!s || s.scade < Date.now()) return null;
  return await d.prepare('SELECT * FROM clienti WHERE id=?').bind(s.cliente).first();
}

export const cookieSessione = (t) => `${COOKIE}=${t}; Path=/; Max-Age=${SESSIONE_GG * 86400}; HttpOnly; Secure; SameSite=Lax`;
export const cookieVia = () => `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

export async function nuovaSessione(env, idCliente) {
  const t = casuale(24), d = await dbc(env);
  await d.prepare('INSERT INTO csessioni(h,cliente,scade) VALUES(?,?,?)').bind(await hash(t), idCliente, Date.now() + SESSIONE_GG * 86400e3).run();
  await d.prepare('UPDATE clienti SET ultimo_accesso=? WHERE id=?').bind(new Date().toISOString(), idCliente).run();
  return t;
}

export async function trovaOCrea(env, email) {
  const d = await dbc(env);
  let c = await d.prepare('SELECT * FROM clienti WHERE email=?').bind(email).first();
  if (!c) {
    const id = 'C' + casuale(6).toUpperCase(), ora = new Date().toISOString();
    await d.prepare('INSERT OR IGNORE INTO clienti(id,email,creato,aggiornato) VALUES(?,?,?,?)').bind(id, email, ora, ora).run();
    c = await d.prepare('SELECT * FROM clienti WHERE email=?').bind(email).first();
  }
  return c;
}

// Link di accesso: monouso e valido 30 minuti; quello nelle email degli sconti è riusabile fino alla scadenza del codice.
export async function linkAccesso(env, origin, email, dopo = '/account/', { riusabileGg = 0 } = {}) {
  const t = casuale(24), d = await dbc(env);
  const scade = Date.now() + (riusabileGg ? riusabileGg * 86400e3 : 30 * 60e3);
  await d.prepare('INSERT INTO accessi(h,email,scade,riusabile) VALUES(?,?,?,?)').bind(await hash(t), email, scade, riusabileGg ? 1 : 0).run();
  const dove = String(dopo).startsWith('/') && !String(dopo).startsWith('//') ? dopo : '/account/';
  return `${origin}/api/account/entra?t=${t}&dopo=${encodeURIComponent(dove)}`;
}

export async function aggiungiPunti(env, idCliente, idMov, delta, motivo) {
  const d = await dbc(env);
  const r = await d.prepare('INSERT OR IGNORE INTO punti_mov(id,cliente,delta,motivo,quando) VALUES(?,?,?,?,?)')
    .bind(idMov, idCliente, delta, motivo, new Date().toISOString()).run();
  if (r.meta.changes) await d.prepare('UPDATE clienti SET punti = MAX(0, punti + ?) WHERE id=?').bind(delta, idCliente).run();
  return !!r.meta.changes;
}

export async function email(env, { a, oggetto, html, testo, da }) {
  if (!env.RESEND_API_KEY) return false;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: da || env.EMAIL_FROM_ACCESSO || 'Semi Store <accesso@semistore.it>', to: Array.isArray(a) ? a : [a], subject: oggetto, html, text: testo }),
    });
    if (!r.ok) console.error('Resend', await r.text());
    return r.ok;
  } catch (e) { console.error('Resend', e); return false; }
}

export const cornice = (titolo, corpo) => `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#15171a">
  <div style="background:#15171a;color:#fff;padding:22px;border-radius:14px 14px 0 0;text-align:center">
    <div style="color:#f5b800;font-weight:700;letter-spacing:2px;font-size:12px">SEMI STORE</div>
    <div style="font-size:24px;font-weight:900;margin-top:6px">${titolo}</div>
  </div>
  <div style="background:#f4f3ef;padding:24px;border-radius:0 0 14px 14px;text-align:center">${corpo}
    <p style="margin:22px 0 6px;font-size:12px;color:#5c5f65">Email automatica: non rispondere a questo messaggio. Per assistenza scrivi su WhatsApp o a ${SITO.email}.</p>
    <p style="margin:0;font-size:12px;color:#5c5f65">${SITO.denominazione} · ${SITO.indirizzo}, ${SITO.citta} · ${SITO.telefono}</p>
  </div></div>`;
export const bottone = (href, testo) => `<a href="${href}" style="display:inline-block;background:#f5b800;color:#15171a;text-decoration:none;font-weight:900;font-size:17px;padding:14px 26px;border-radius:10px">${testo}</a>`;

// Profilo pubblico (quello che vede il cliente)
export const profilo = (c) => c && ({
  email: c.email, tipo: c.tipo, nome: c.nome, cognome: c.cognome, telefono: c.telefono, cf: c.cf,
  ragioneSociale: c.ragione_sociale, piva: c.piva, sdi: c.sdi, pec: c.pec,
  indirizzo: c.indirizzo, cap: c.cap, citta: c.citta, provincia: c.provincia,
  offerte: !!c.offerte, punti: c.punti, creato: c.creato, completo: !!c.tipo,
});
