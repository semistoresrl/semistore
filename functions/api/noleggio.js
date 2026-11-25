// Richieste di noleggio dal sito (pagina /noleggio/).
// POST JSON → controlla i dati, ricalcola i canoni dal listino noleggio DEWALT (non si fida dei prezzi del browser),
//             salva nell'archivio dell'app (D1, collezione "noleggi", numero NL-AAAA-NNNN) e avvisa per email.
import listino from '../../src/data/noleggio.json';
import { gdb, mandaEmail, oraIT } from '../_lib/gestione.js';
import { pivaValida } from '../_lib/piva.js';

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const PER_CODICE = new Map(listino.map((x) => [x.c, x]));
const t = (v, n = 300) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const eur = (n) => n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const r2 = (n) => Math.round(n * 100) / 100;
const DURATE = [24, 36, 48, 60];

export async function onRequestPost({ request, env }) {
  let b;
  try { b = await request.json(); } catch { return json({ error: 'dati non leggibili' }, 400); }
  if (b.sito_web) return json({ num: 'ok' }); // trappola anti-spam
  if (!b.privacy) return json({ error: 'manca il consenso privacy' }, 400);

  // articoli: solo codici del listino, quantità 1-99, canone dal listino
  const righe = [];
  for (const r of Array.isArray(b.righe) ? b.righe.slice(0, 80) : []) {
    const x = PER_CODICE.get(String(r.c || ''));
    const qty = Math.max(1, Math.min(99, parseInt(r.qty) || 1));
    if (!x) continue;
    const ex = righe.find((y) => y.c === x.c);
    if (ex) ex.qty = Math.min(99, ex.qty + qty);
    else righe.push({ c: x.c, n: x.n, k: x.k, qty });
  }
  if (!righe.length) return json({ error: 'scegli almeno un articolo' }, 400);

  const a = b.azienda || {}, ref = b.referente || {}, uso = b.uso || {};
  const piva = t(a.piva, 20).replace(/\D/g, '');
  const azienda = {
    ragione: t(a.ragione, 160), piva, cf: t(a.cf, 16).toUpperCase(), forma: t(a.forma, 40), attivita: t(a.attivita, 160), inizio: t(a.inizio, 4).replace(/\D/g, ''),
    pec: t(a.pec, 120).toLowerCase(), sdi: t(a.sdi, 7).toUpperCase(), ind: t(a.ind, 160), cap: t(a.cap, 5).replace(/\D/g, ''), citta: t(a.citta, 80), prov: t(a.prov, 2).toUpperCase(),
    legale: t(a.legale, 120), dipendenti: t(a.dipendenti, 20),
  };
  const referente = { nome: t(ref.nome, 120), ruolo: t(ref.ruolo, 80), tel: t(ref.tel, 30), email: t(ref.email, 120).toLowerCase() };
  if (!azienda.ragione || !pivaValida(piva)) return json({ error: 'controlla ragione sociale e partita IVA' }, 400);
  if (!referente.nome || !referente.tel || !/^\S+@\S+\.\S+$/.test(referente.email)) return json({ error: 'servono nome, telefono ed email del referente' }, 400);
  const durata = DURATE.includes(Number(uso.durata)) ? Number(uso.durata) : 36;
  const usoOk = {
    luogo: uso.luogo === 'altro' ? 'altro' : 'sede', ind: t(uso.ind, 200), consegna: uso.consegna === 'consegna' ? 'consegna' : 'ritiro',
    dataInizio: /^\d{4}-\d{2}-\d{2}$/.test(uso.dataInizio || '') ? uso.dataInizio : '', durata, utilizzo: t(uso.utilizzo, 600), note: t(uso.note, 1500),
    batterie: uso.batterie === 'si' ? 'si' : uso.batterie === 'no' ? 'no' : '',
  };
  const canone = r2(righe.reduce((s, r) => s + r.k * r.qty, 0));
  if (!env.DB) return json({ error: 'servizio non configurato' }, 503);

  const db = await gdb(env);
  const now = Date.now(), anno = new Date().getFullYear(), pre = `NL-${anno}-`;
  const esist = await db.prepare("SELECT d FROM docs WHERE c='noleggi'").all();
  let max = 0;
  for (const row of esist.results || []) { try { const n = JSON.parse(row.d).num || ''; if (n.startsWith(pre)) max = Math.max(max, parseInt(n.slice(pre.length)) || 0); } catch {} }
  const num = pre + String(max + 1).padStart(4, '0');
  const id = 'nl' + now.toString(36) + crypto.randomUUID().slice(0, 4);
  const doc = {
    num, at: now, canale: 'sito', stato: 'nuova', by: 'Sito', azienda, referente, uso: usoOk, righe, canone,
    storia: [{ at: now, stato: 'nuova', chi: 'Sito', nota: 'Richiesta dal sito' }], updatedAt: now,
  };
  await db.batch([
    db.prepare('INSERT INTO docs(c,id,d,u,chi) VALUES(?,?,?,?,?)').bind('noleggi', id, JSON.stringify(doc), now, 'Sito'),
    db.prepare('INSERT INTO registro(at,chi,nome,c,docid,op,d) VALUES(?,?,?,?,?,?,?)').bind(now, 'sito', 'Sito', 'noleggi', id, 'set', JSON.stringify({ _nuovo: { num, azienda: azienda.ragione, canone } })),
  ]);

  const base = new URL(request.url).origin;
  const elenco = righe.map((r) => `• ${r.qty} × ${r.n} (${r.c}): ${eur(r.k)} al mese${r.qty > 1 ? ` → ${eur(r2(r.k * r.qty))}` : ''}`).join('\n');
  const testo = [
    `Richiesta di noleggio ${num} dal sito · ${oraIT(now)}`, '',
    `Azienda: ${azienda.ragione} · P.IVA ${piva}${azienda.forma ? ' · ' + azienda.forma : ''}`,
    `Sede: ${[azienda.ind, azienda.cap, azienda.citta, azienda.prov].filter(Boolean).join(' ')}`,
    `Referente: ${referente.nome}${referente.ruolo ? ' (' + referente.ruolo + ')' : ''} · ${referente.tel} · ${referente.email}`, '',
    elenco, '', `Canone mensile a listino: ${eur(canone)} + IVA · durata richiesta ${durata} mesi`,
    usoOk.dataInizio ? `Inizio desiderato: ${usoOk.dataInizio.split('-').reverse().join('/')}` : '',
    usoOk.note ? `Note: ${usoOk.note}` : '', '', `Apri l'app: ${base}/gestione/#noleggi`,
  ].filter((x) => x !== null).join('\n');
  if (env.RESEND_API_KEY) {
    const to = (env.EMAIL_TO || 'info@semistore.it').split(',');
    await mandaEmail(env, { to, reply_to: referente.email, subject: `Noleggio ${num} · ${azienda.ragione} · ${eur(canone)}/mese`, text: testo }).catch(() => null);
    await mandaEmail(env, { to: [referente.email], subject: `Semi Store · richiesta di noleggio ${num} ricevuta`, text:
      `Buongiorno ${referente.nome},\nabbiamo ricevuto la richiesta di noleggio ${num} per ${azienda.ragione}.\n\n${elenco}\n\nCanone mensile indicativo a listino: ${eur(canone)} + IVA, con piano di manutenzione di 3 anni incluso.\n\n` +
      `Ti richiamiamo entro un giorno lavorativo per confermare gli articoli e preparare l'offerta. La pratica di noleggio è soggetta all'approvazione della società di noleggio.\n\nSemi Store · SE.M.I. S.R.L. · 081 553 6604 · info@semistore.it` }).catch(() => null);
  }
  return json({ num, canone, righe: righe.length });
}
