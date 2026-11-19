// Funzione di recesso online (art. 54-bis Codice del consumo, D.Lgs. 209/2025, in vigore per i contratti dal 19/06/2026).
// Riceve la dichiarazione di recesso, la salva (KV RICHIESTE) e invia SUBITO al consumatore la conferma su supporto
// durevole (email) con contenuto, data e ora; una copia va al negozio. Variabili: RESEND_API_KEY, EMAIL_FROM, EMAIL_TO.
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function onRequestPost({ request, env }) {
  const fd = await request.formData();
  if (fd.get('sito_web')) return json({ id: 'ok' }); // trappola anti-spam
  const v = (k, n = 500) => String(fd.get(k) || '').slice(0, n).trim();
  const d = { nome: v('nome', 120), ordine: v('ordine', 200), email: v('email', 200), prodotti: v('prodotti', 1000), note: v('note', 1000) };
  if (!d.nome || !d.ordine || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) return json({ error: 'Inserisci nome, riferimento dell\'ordine e un indirizzo email valido.' }, 400);

  const ora = new Date();
  const quando = new Intl.DateTimeFormat('it-IT', { dateStyle: 'full', timeStyle: 'medium', timeZone: 'Europe/Rome' }).format(ora);
  const id = 'REC-' + ora.toISOString().slice(2, 10).replace(/-/g, '') + '-' + crypto.randomUUID().slice(0, 6).toUpperCase();
  const rec = { id, tipo: 'recesso', ricevuta: ora.toISOString(), stato: 'Recesso ricevuto', ...d };

  let salvata = false;
  if (env.RICHIESTE) { await env.RICHIESTE.put(`recesso:${id}`, JSON.stringify(rec)); salvata = true; }

  const righe = [
    ['Numero della dichiarazione', id],
    ['Ricevuta il', quando],
    ['Nome', d.nome],
    ['Ordine', d.ordine],
    ['Prodotti', d.prodotti || 'tutti i prodotti dell\'ordine'],
    ['Email per la conferma', d.email],
    ...(d.note ? [['Note', d.note]] : []),
  ];
  const testo = `Gentile ${d.nome},\n\nconfermiamo di aver ricevuto la tua dichiarazione di recesso.\n\n${righe.map(([k, x]) => `${k}: ${x}`).join('\n')}\n\nCosa succede ora: entro 14 giorni da oggi restituisci i prodotti (integri, con accessori e confezione) a SE.M.I. S.R.L., Viale G. Marconi 225, 80020 Casavatore (NA), oppure portali in negozio. Ti rimborsiamo tutti i pagamenti ricevuti, comprese le spese di consegna standard, entro 14 giorni da oggi, con lo stesso mezzo di pagamento; possiamo trattenere il rimborso finché non riceviamo i prodotti o la prova della spedizione. Le spese di restituzione sono a tuo carico.\n\nConserva questa email: è la conferma del recesso su supporto durevole (art. 54-bis Codice del consumo).\n\nSE.M.I. S.R.L. · Semi Store\nTel. 081 553 6604 · info@semistore.it`;
  const html = `<p>Gentile ${esc(d.nome)},</p><p>confermiamo di aver ricevuto la tua <b>dichiarazione di recesso</b>.</p><table cellpadding="6" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">${righe.map(([k, x]) => `<tr><td style="color:#555">${esc(k)}</td><td><b>${esc(x)}</b></td></tr>`).join('')}</table><p><b>Cosa succede ora</b>: entro 14 giorni da oggi restituisci i prodotti (integri, con accessori e confezione) a SE.M.I. S.R.L., Viale G. Marconi 225, 80020 Casavatore (NA), oppure portali in negozio. Ti rimborsiamo tutti i pagamenti ricevuti, comprese le spese di consegna standard, entro 14 giorni da oggi, con lo stesso mezzo di pagamento; possiamo trattenere il rimborso finché non riceviamo i prodotti o la prova della spedizione. Le spese di restituzione sono a tuo carico.</p><p style="color:#555;font-size:12px">Conserva questa email: è la conferma del recesso su supporto durevole (art. 54-bis Codice del consumo).<br>SE.M.I. S.R.L. · Semi Store · Tel. 081 553 6604 · info@semistore.it</p>`;

  let inviata = false;
  if (env.RESEND_API_KEY) {
    const from = env.EMAIL_FROM || 'Semi Store <onboarding@resend.dev>';
    const manda = (body) => fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const r = await manda({ from, to: [d.email], reply_to: (env.EMAIL_TO || 'info@semistore.it').split(',')[0], subject: `Conferma di recesso ${id}`, text: testo, html });
    inviata = r.ok;
    await manda({ from, to: (env.EMAIL_TO || 'info@semistore.it').split(','), reply_to: d.email, subject: `RECESSO ${id} · ordine ${d.ordine} · ${d.nome}`, text: testo }).catch(() => {});
    salvata = salvata || inviata;
  }
  if (!salvata) return json({ error: 'Servizio momentaneamente non disponibile: scrivi a info@semistore.it indicando nome e ordine, vale come recesso.' }, 503);
  return json({ id, quando, inviata });
}
