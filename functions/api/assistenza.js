// Richieste di assistenza e di valutazione riparazione dal sito.
// POST (form)  → salva nell'archivio dell'app (D1, collezione "richieste"), in KV (se c'è) e avvisa per email.
//                Se l'utensile arriva con un pacco (spedisce il cliente o ritiriamo noi) risponde con il link
//                alla pagina di conferma con il DDT da stampare.
// GET ?id&k    → dati della richiesta per la pagina di conferma/DDT (k = chiave segreta data al cliente).
import { gdb, mandaEmail } from '../_lib/gestione.js';
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const CAMPI = ['modello', 'seriale', 'garanzia', 'problema', 'nome', 'telefono', 'email', 'consegna', 'indirizzo', 'cap', 'citta', 'prov', 'cf', 'colli', 'accessori', 'disponibilita'];
const MODI = { negozio: 'Porta in negozio', spedisco: 'Spedisce il cliente', ritiro: 'Ritiriamo noi' };
const PUBBLICI = ['id', 'at', 'nome', 'tel', 'email', 'modello', 'seriale', 'garanzia', 'messaggio', 'arrivo', 'ind', 'cap', 'citta', 'prov', 'cf', 'colli', 'accessori', 'disponibilita', 'pacco'];

export async function onRequestPost({ request, env }) {
  const fd = await request.formData();
  if (fd.get('sito_web')) return json({ id: 'ok' }); // trappola anti-spam
  const d = Object.fromEntries(CAMPI.map((k) => [k, String(fd.get(k) || '').slice(0, 2000).trim()]));
  if (!d.modello || !d.problema || !d.nome || !d.telefono || !fd.get('privacy')) return json({ error: 'campi mancanti' }, 400);
  // compatibilità con il vecchio modulo
  const arrivo = d.consegna === 'Spedisco' ? 'spedisco' : MODI[d.consegna] ? d.consegna : 'negozio';
  if (arrivo !== 'negozio' && (!d.indirizzo || !d.cap || !d.citta)) return json({ error: "manca l'indirizzo da cui parte il pacco" }, 400);
  const now = new Date();
  const id = 'WEB-' + now.toISOString().slice(2, 10).replace(/-/g, '') + '-' + crypto.randomUUID().slice(0, 4).toUpperCase();
  const k = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const rich = {
    at: now.getTime(), tipo: 'assistenza', canale: 'sito', gestita: false, k,
    nome: d.nome, tel: d.telefono, email: d.email, modello: d.modello, seriale: d.seriale, garanzia: d.garanzia, messaggio: d.problema,
    arrivo, ...(arrivo !== 'negozio' ? { ind: d.indirizzo, cap: d.cap, citta: d.citta, prov: d.prov.toUpperCase(), cf: d.cf.toUpperCase(), colli: Math.max(1, Math.min(20, parseInt(d.colli) || 1)), accessori: d.accessori,
      disponibilita: arrivo === 'ritiro' ? d.disponibilita : '', pacco: { stato: arrivo === 'ritiro' ? 'ritiro da prenotare' : 'in attesa del pacco', at: now.getTime() } } : {}),
  };
  let salvata = false;
  if (env.DB) {
    const db = await gdb(env);
    await db.batch([
      db.prepare('INSERT INTO docs(c,id,d,u,chi) VALUES(?,?,?,?,?)').bind('richieste', id, JSON.stringify(rich), now.getTime(), 'Sito'),
      db.prepare('INSERT INTO registro(at,chi,nome,c,docid,op,d) VALUES(?,?,?,?,?,?,?)').bind(now.getTime(), 'sito', 'Sito', 'richieste', id, 'set', JSON.stringify({ _nuovo: { nome: d.nome, modello: d.modello, arrivo } })),
    ]);
    salvata = true;
  }
  if (env.RICHIESTE) { await env.RICHIESTE.put(`richiesta:${id}`, JSON.stringify({ id, ricevuta: now.toISOString(), stato: 'Richiesta dal sito', ...d, arrivo })); salvata = true; }
  const ddt = arrivo !== 'negozio' ? `/assistenza/richiesta/?id=${id}&k=${k}` : '';
  const base = new URL(request.url).origin;
  if (env.RESEND_API_KEY) {
    const to = (env.EMAIL_TO || 'info@semistore.it').split(',');
    const testo = [`Richiesta ${id} · ${MODI[arrivo]}`, '', ...Object.entries(d).filter(([, v]) => v).map(([k2, v]) => `${k2}: ${v}`), ddt ? `\nDDT: ${base}${ddt}` : '', '\nApri l\'app: ' + base + '/gestione/#richieste'].join('\n');
    const r = await mandaEmail(env, { to, reply_to: d.email || undefined, subject: `Assistenza ${id} · ${MODI[arrivo]} · ${d.modello} · ${d.nome}`, text: testo }).catch(() => null);
    salvata = salvata || !!(r && r.ok);
    if (d.email && ddt) await mandaEmail(env, { to: [d.email], subject: `Semi Store · richiesta ${id}: il tuo DDT`, text:
      `Ciao ${d.nome},\nabbiamo ricevuto la tua richiesta di valutazione riparazione per ${d.modello}.\n\n` +
      (arrivo === 'ritiro' ? 'Prenotiamo noi il corriere e ti avvisiamo con il giorno del ritiro. Il costo del ritiro si paga dopo, insieme alla riparazione.\n' : 'Spedisci il pacco (spese a tuo carico) a: SE.M.I. S.R.L., Viale G. Marconi 225, 80020 Casavatore (NA).\n') +
      `\nStampa il DDT e mettilo nel pacco:\n${base}${ddt}\n\nSemi Store · 081 553 6604` }).catch(() => null);
  }
  if (!salvata) return json({ error: 'servizio non configurato' }, 503);
  return json({ id, ddt });
}

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url), id = String(u.searchParams.get('id') || ''), k = String(u.searchParams.get('k') || '');
  if (!env.DB || !/^WEB-[\w-]+$/.test(id) || k.length < 10) return json({ error: 'non trovata' }, 404);
  const db = await gdb(env);
  const r = await db.prepare("SELECT d FROM docs WHERE c='richieste' AND id=?").bind(id).first();
  const v = r && r.d ? JSON.parse(r.d) : null;
  if (!v || v.k !== k) return json({ error: 'non trovata' }, 404);
  const out = { id }; PUBBLICI.forEach((c) => { if (v[c] !== undefined) out[c] = v[c]; });
  if (v.ticketNum) out.scheda = v.ticketNum;
  return json(out);
}
