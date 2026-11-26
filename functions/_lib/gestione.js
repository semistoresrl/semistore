// App interna "Gestione" su semistore.it/gestione/ (dal 19/11/2026, prima era su claude.ai).
// Accesso con codice via email (Resend), ruoli admin / operatore, archivio documenti in D1
// con registro di ogni modifica (chi, quando, cosa), file allegati in D1, presenze sul sito.
import { db, json } from './db.js';

let pronto = false;
export async function gdb(env) {
  const d = await db(env);
  if (!pronto) {
    try { await d.batch([
      d.prepare(`CREATE TABLE IF NOT EXISTS utenti (email TEXT PRIMARY KEY, nome TEXT NOT NULL, ruolo TEXT NOT NULL DEFAULT 'operatore',
        attivo INTEGER NOT NULL DEFAULT 1, creato INTEGER, ultimo INTEGER)`),
      d.prepare('CREATE TABLE IF NOT EXISTS codici (email TEXT PRIMARY KEY, hash TEXT, scade INTEGER, tentativi INTEGER NOT NULL DEFAULT 0, inviato INTEGER)'),
      d.prepare('CREATE TABLE IF NOT EXISTS sessioni (token TEXT PRIMARY KEY, email TEXT NOT NULL, scade INTEGER NOT NULL, creato INTEGER, ua TEXT)'),
      d.prepare('CREATE TABLE IF NOT EXISTS docs (c TEXT NOT NULL, id TEXT NOT NULL, d TEXT, u INTEGER NOT NULL, chi TEXT, PRIMARY KEY (c, id))'),
      d.prepare('CREATE INDEX IF NOT EXISTS docs_u ON docs(u)'),
      d.prepare(`CREATE TABLE IF NOT EXISTS registro (n INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, chi TEXT, nome TEXT,
        c TEXT, docid TEXT, op TEXT, d TEXT)`),
      d.prepare('CREATE INDEX IF NOT EXISTS reg_at ON registro(at)'),
      d.prepare('CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, tipo TEXT, nome TEXT, dati BLOB, at INTEGER, chi TEXT)'),
      d.prepare(`CREATE TABLE IF NOT EXISTS presenze (vid TEXT NOT NULL, giorno TEXT NOT NULL, primo INTEGER, ultimo INTEGER,
        pagine INTEGER NOT NULL DEFAULT 1, pagina TEXT, PRIMARY KEY (vid, giorno))`),
      d.prepare('CREATE INDEX IF NOT EXISTS pres_ultimo ON presenze(ultimo)'),
      d.prepare('CREATE INDEX IF NOT EXISTS pres_giorno ON presenze(giorno)'),
    ]); } catch (e) { if (!/write limit|read.?only/i.test(String(e && e.message))) throw e; /* scritture finite per oggi: le tabelle ci sono già */ }
    try { await d.prepare('ALTER TABLE utenti ADD COLUMN recupero TEXT').run(); } catch (e) { /* colonna già presente */ }
    pronto = true;
  }
  return d;
}

export { json };
export const COOKIE = 'semi_sess';
const enc = new TextEncoder();
export async function sha(s) { const b = await crypto.subtle.digest('SHA-256', enc.encode(s)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join(''); }
export function casuale(n = 24) { const a = new Uint8Array(n); crypto.getRandomValues(a); return [...a].map((x) => x.toString(16).padStart(2, '0')).join(''); }
export const oraIT = (t = Date.now()) => new Date(t).toLocaleString('it-IT', { timeZone: 'Europe/Rome' });
export const giornoIT = (t = Date.now()) => new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }); // AAAA-MM-GG

function cookieDi(request, nome) {
  const c = request.headers.get('cookie') || '';
  const m = c.match(new RegExp('(?:^|;\\s*)' + nome + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}
// utente collegato (o null)
export async function utente(request, env) {
  const tok = cookieDi(request, COOKIE);
  if (!tok || !env.DB) return null;
  const d = await gdb(env);
  const r = await d.prepare(`SELECT u.email, u.nome, u.ruolo FROM sessioni s JOIN utenti u ON u.email = s.email
    WHERE s.token = ? AND s.scade > ? AND u.attivo = 1`).bind(await sha(tok), Date.now()).first();
  return r || null;
}
// ADMIN_TOKEN (pagina /aggiorna, script) oppure un utente collegato all'app
export async function autorizzato(request, env) {
  if (env.ADMIN_TOKEN && request.headers.get('authorization') === `Bearer ${env.ADMIN_TOKEN}`) return { email: 'token', nome: 'Sistema', ruolo: 'admin' };
  return utente(request, env);
}
export const cookieSessione = (tok, giorni = 30) => `${COOKIE}=${encodeURIComponent(tok)}; Path=/; Max-Age=${giorni * 86400}; HttpOnly; Secure; SameSite=Lax`;
export const cookieVia = () => `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

// unione profonda come l'archivio di claude.ai: gli oggetti si fondono, {__delete__:true} cancella la chiave
export function fondi(a, b) {
  const out = a && typeof a === 'object' && !Array.isArray(a) ? { ...a } : {};
  for (const k of Object.keys(b || {})) {
    const v = b[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && v.__delete__ === true) delete out[k];
    else if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) out[k] = fondi(out[k], v);
    else out[k] = v;
  }
  return out;
}
// differenza leggibile per il registro: solo i campi cambiati (prima → dopo), al massimo ~6 KB
export function differenza(prima, dopo, pref = '', out = {}, prof = 0) {
  const ks = new Set([...Object.keys(prima || {}), ...Object.keys(dopo || {})]);
  for (const k of ks) {
    const a = prima?.[k], b = dopo?.[k], p = pref ? pref + '.' + k : k;
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    if (prof < 2 && a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) differenza(a, b, p, out, prof + 1);
    else out[p] = [corto(a), corto(b)];
  }
  return out;
}
const corto = (v) => { if (v === undefined) return null; const s = JSON.stringify(v); return s.length > 300 ? s.slice(0, 300) + '…' : v; };

export async function mandaEmail(env, { to, subject, text, html, reply_to }) {
  if (!env.RESEND_API_KEY) return { ok: false, motivo: 'manca RESEND_API_KEY' };
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM || env.EMAIL_FROM_ACCESSO || 'Semi Store <accesso@semistore.it>', to, subject, text, html, reply_to }),
  });
  return r.ok ? { ok: true } : { ok: false, motivo: 'Resend ' + r.status + ' ' + (await r.text()).slice(0, 200) };
}
