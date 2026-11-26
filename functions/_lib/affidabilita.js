// Affidabilità dei clienti (26/11/2026): rating esterno via OpenAPI.it (API Risk) + archivio dei risultati in D1.
// Il punteggio interno (come paga a noi) si calcola nell'app dai dati che ha già (vendite "paga dopo", Danea).
//
// Servizi usati (prezzi di listino OpenAPI.it, + IVA):
//   start     GET /IT-creditscore-start/{piva}     semaforo a 3 colori              ~0,06 €
//   advanced  GET /IT-creditscore-advanced/{piva}  rating A1–C3, semaforo 7 livelli, fido stimato  ~0,15 €
//   top       GET /IT-creditscore-top/{piva}       come advanced + storico mensile e profili       ~1,10 €
//   negativita POST /IT-negativita {cf_piva} → GET /IT-request/{id}  protesti, pregiudizievoli, procedure  ~0,70 €
// Chiave (Bearer token creato in console.openapi.com con gli scope Risk) salvata cifrata nella tabella `segreti`.
// Il fornitore è isolato qui: per passare a Cerved/Creditsafe basta un'altra funzione `chiedi…` con la stessa uscita.
import { segreto } from './posta.js';

export const VALIDITA = 90 * 86400_000; // un rating salvato vale 90 giorni (poi si può aggiornare)
const BASE = (sb) => (sb ? 'https://test.risk.openapi.com' : 'https://risk.openapi.com');

let pronto = false;
export async function adb(env) {
  const d = env.DB;
  if (!pronto) {
    await d.batch([
      d.prepare(`CREATE TABLE IF NOT EXISTS affidabilita (k TEXT NOT NULL, servizio TEXT NOT NULL, at INTEGER NOT NULL, chi TEXT,
        esito TEXT, dati TEXT, richiesta TEXT, PRIMARY KEY (k, servizio))`),
      d.prepare('CREATE INDEX IF NOT EXISTS aff_at ON affidabilita(at)'),
    ]);
    pronto = true;
  }
  return d;
}

export async function config(env) { return (await segreto(env, 'openapi_risk')) || null; }

const pulisciK = (s) => String(s || '').toUpperCase().replace(/^IT/, '').replace(/[^A-Z0-9]/g, '').slice(0, 16);
export const chiaveValida = (k) => /^\d{11}$/.test(k) || /^[A-Z0-9]{16}$/.test(k);

async function chiama(cfg, metodo, path, body) {
  const r = await fetch(BASE(cfg.sandbox) + path, {
    method: metodo,
    headers: { authorization: 'Bearer ' + cfg.token, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* risposta non JSON */ }
  if (!r.ok || (j && j.success === false)) {
    const msg = (j && (j.message || j.error)) || t.slice(0, 200) || 'errore';
    const e = new Error(r.status === 401 || r.status === 403 ? 'Chiave OpenAPI non valida o senza permesso per questo servizio' :
      r.status === 402 ? 'Credito OpenAPI esaurito: ricarica il conto su openapi.it' :
      r.status === 404 ? 'Azienda non trovata nelle banche dati' : `OpenAPI ${r.status}: ${msg}`);
    e.status = r.status; throw e;
  }
  return j || {};
}
const primo = (x) => (Array.isArray(x) ? x[0] : x) || {};

// colore unico per l'app: verde / giallo / rosso (il semaforo OpenAPI ha fino a 7 livelli)
export function semaforo(risk, rating) {
  const s = String(risk || '').toUpperCase();
  if (/ROSSO|RED/.test(s)) return 'rosso';
  if (/GIALLO|YELLOW/.test(s)) return 'giallo';
  if (/VERDE|GREEN/.test(s)) return 'verde';
  const r = String(rating || '').toUpperCase(); // A1..A3 bene, B1..B3 medio, C1..C3 male
  if (/^A/.test(r)) return 'verde'; if (/^B/.test(r)) return 'giallo'; if (/^C/.test(r)) return 'rosso';
  return '';
}

function riassumiScore(servizio, j) {
  const d = primo(j.data);
  const h = d.history || {};
  const storia = (arr) => (Array.isArray(arr) ? arr.slice(0, 12) : []);
  const fido = Number(d.operational_credit_limit);
  return {
    ragioneSociale: d.organization_name || d.company_name || '',
    piva: d.vat || d.vatCode || '', cf: d.tax || d.taxCode || '',
    rischio: d.risk_score || '', rischioTesto: d.risk_score_description || '',
    rating: d.rating || '', gravita: d.risk_severity ?? null,
    fido: Number.isFinite(fido) ? fido : null,
    ultimoBilancio: d.last_balance_year || d.date_last_balance || '',
    semaforo: semaforo(d.risk_score, d.rating),
    storico: servizio === 'top' ? { rischio: storia(h.risk_score), rating: storia(h.public_rating), fido: storia(h.operational_credit_limit) } : undefined,
    profili: servizio === 'top' ? (d.profiles || null) : undefined,
    aggiornatoFonte: d.requested_at || d.time_stamp || null,
  };
}

function riassumiNeg(j) {
  const d = primo(j.data), s = d.soggetto || d, n = s.negativita || s;
  const v = (x) => (x === true || x === 1 || (Array.isArray(x) && x.length > 0) ? true : x === false || x === 0 || (Array.isArray(x) && !x.length) ? false : null);
  const out = {
    stato: d.status || 'COMPLETED',
    protesti: v(n.protesti ?? n.presenzaProtesti), pregiudizievoli: v(n.pregiudizievoli ?? n.atti_pre ?? n.presenzaPregiudizievoli),
    procedure: v(n.procedure ?? n.proc ?? n.presenzaProcedure ?? n.coinvoltoInProcedura),
  };
  out.semaforo = out.stato !== 'COMPLETED' ? '' : (out.protesti || out.pregiudizievoli || out.procedure) ? 'rosso' : 'verde';
  return out;
}

export async function leggi(env, k) {
  const d = await adb(env);
  const r = (await d.prepare('SELECT servizio, at, chi, esito, dati, richiesta FROM affidabilita WHERE k=?').bind(k).all()).results;
  const out = {};
  for (const x of r) out[x.servizio] = { at: x.at, chi: x.chi, esito: x.esito, richiesta: x.richiesta, ...(x.dati ? JSON.parse(x.dati) : {}) };
  return out;
}
async function scrivi(env, k, servizio, chi, esito, dati, richiesta = null) {
  const d = await adb(env);
  await d.prepare(`INSERT INTO affidabilita(k,servizio,at,chi,esito,dati,richiesta) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(k,servizio) DO UPDATE SET at=excluded.at, chi=excluded.chi, esito=excluded.esito, dati=excluded.dati, richiesta=excluded.richiesta`)
    .bind(k, servizio, Date.now(), chi || '', esito, JSON.stringify(dati || {}), richiesta).run();
}

// richiesta di un rating. Ritorna sempre l'archivio aggiornato di quella P.IVA / C.F.
export async function chiedi(env, kRaw, servizio, chi, { forza = false } = {}) {
  const k = pulisciK(kRaw);
  if (!chiaveValida(k)) throw Object.assign(new Error('Serve una partita IVA (11 cifre) o un codice fiscale (16 caratteri)'), { status: 400 });
  if (!['start', 'advanced', 'top', 'negativita'].includes(servizio)) throw Object.assign(new Error('servizio non valido'), { status: 400 });
  if (servizio !== 'negativita' && !/^\d{11}$/.test(k)) throw Object.assign(new Error('Il rating si chiede con la partita IVA: per i privati c\'è solo il controllo protesti'), { status: 400 });
  const cfg = await config(env);
  if (!cfg?.token) throw Object.assign(new Error('Manca la chiave OpenAPI: Impostazioni → Affidabilità clienti'), { status: 412 });
  const prima = await leggi(env, k);
  const p = prima[servizio];
  if (!forza && p && p.esito === 'ok' && Date.now() - p.at < VALIDITA) return { ...prima, _cache: true };
  try {
    if (servizio === 'negativita') {
      const j = await chiama(cfg, 'POST', '/IT-negativita', { cf_piva: k });
      const d = primo(j.data);
      if (d.id && d.status !== 'COMPLETED') await scrivi(env, k, servizio, chi, 'attesa', { stato: d.status || 'PENDING' }, d.id);
      else await scrivi(env, k, servizio, chi, 'ok', riassumiNeg(j));
    } else {
      const j = await chiama(cfg, 'GET', `/IT-creditscore-${servizio}/${k}`);
      await scrivi(env, k, servizio, chi, 'ok', riassumiScore(servizio, j));
    }
  } catch (e) {
    await scrivi(env, k, servizio, chi, 'errore', { errore: e.message });
    if (e.status === 401 || e.status === 403 || e.status === 402) throw e;
  }
  return leggi(env, k);
}

// controllo protesti asincrono: se è in attesa, chiede a OpenAPI se ha finito (si chiama quando si apre la scheda)
export async function aggiornaAttese(env, k) {
  const tutto = await leggi(env, k), n = tutto.negativita;
  if (!n || n.esito !== 'attesa' || !n.richiesta) return tutto;
  const cfg = await config(env); if (!cfg?.token) return tutto;
  try {
    const j = await chiama(cfg, 'GET', '/IT-request/' + encodeURIComponent(n.richiesta));
    const r = riassumiNeg(j);
    if (r.stato === 'COMPLETED') await scrivi(env, k, 'negativita', n.chi, 'ok', r);
  } catch (e) { if (Date.now() - n.at > 86400_000) await scrivi(env, k, 'negativita', n.chi, 'errore', { errore: e.message }); }
  return leggi(env, k);
}

// riepilogo per l'elenco (semaforo e rating più recenti) di tutte le chiavi controllate
export async function riepilogo(env) {
  const d = await adb(env);
  const r = (await d.prepare("SELECT k, servizio, at, dati FROM affidabilita WHERE esito='ok'").all()).results;
  const out = {};
  for (const x of r) { const v = JSON.parse(x.dati || '{}'); const o = (out[x.k] = out[x.k] || {});
    if (x.servizio === 'negativita') o.neg = { s: v.semaforo, at: x.at };
    else if (!o.at || x.at > o.at) Object.assign(o, { s: v.semaforo, rating: v.rating, fido: v.fido, at: x.at }); }
  return out;
}
