// Webhook Stripe (Dashboard → Sviluppatori → Webhook → evento checkout.session.completed):
// https://semistore.it/api/stripe-webhook — scala la giacenza dei prodotti venduti sul sito e aggiorna TikTok.
// Variabile: STRIPE_WEBHOOK_SECRET (whsec_...).
import { movimento } from '../_lib/db.js';
import { configurato } from '../_lib/tiktok.js';
import { sincronizza } from '../_lib/sincronizza.js';
import { dbc, aggiungiPunti, email as inviaEmail, cornice, bottone, linkAccesso } from '../_lib/clienti.js';
import { dbb, crea as creaBuono, conferma as confermaBuoni, ripristina as ripristinaBuoni, annullaRimborsato } from '../_lib/buoni.js';
import { calcolaPunti } from '../../src/lib/punti.js';
import { SITO } from '../../src/data/sito.js';

const enc = new TextEncoder();
async function verifica(segreto, corpo, header) {
  const p = Object.fromEntries(String(header || '').split(',').map((x) => x.split('=')));
  if (!p.t || !p.v1 || Math.abs(Date.now() / 1000 - Number(p.t)) > 600) return false;
  const k = await crypto.subtle.importKey('raw', enc.encode(segreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const s = [...new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(`${p.t}.${corpo}`)))].map((b) => b.toString(16).padStart(2, '0')).join('');
  return s === p.v1;
}

export async function onRequestPost({ request, env, waitUntil }) {
  if (!env.STRIPE_WEBHOOK_SECRET || !env.STRIPE_SECRET_KEY || !env.DB) return new Response('non configurato', { status: 503 });
  const corpo = await request.text();
  if (!(await verifica(env.STRIPE_WEBHOOK_SECRET, corpo, request.headers.get('stripe-signature')))) return new Response('firma non valida', { status: 400 });
  const ev = JSON.parse(corpo);
  // rimborso (anche parziale) o recesso: si tolgono i punti in proporzione. Evento da attivare in Stripe: charge.refunded
  // rimborso (anche parziale): toglie i punti, restituisce ai buoni usati la quota rimborsata, annulla i buoni regalo rimborsati
  if (ev.type === 'charge.refunded') {
    const ch = ev.data.object;
    try {
      const b = ch.payment_intent && await annullaRimborsato(env, ch.payment_intent, Number(ch.amount_refunded || 0));
      if (!b) {
        await togliPunti(env, ch);
        const o = ch.payment_intent && await (await dbc(env)).prepare('SELECT sessione FROM ordini WHERE pi=?').bind(ch.payment_intent).first();
        if (o && ch.amount) await ripristinaBuoni(env, o.sessione, Number(ch.amount_refunded || 0) / Number(ch.amount));
      }
    } catch (e) { console.error('rimborso', e); }
    return new Response('ok');
  }
  if (ev.type !== 'checkout.session.completed' || !['paid', 'no_payment_required'].includes(ev.data?.object?.payment_status)) return new Response('ok');
  const sid = ev.data.object.id;
  if (ev.data.object.metadata?.tipo === 'buono_regalo') {
    try { await buonoRegalo(env, ev.data.object, new URL(request.url).origin); } catch (e) { console.error('buono regalo', e); return new Response('errore', { status: 500 }); }
    return new Response('ok');
  }
  const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sid}/line_items?limit=100&expand[]=data.price.product`, { headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } });
  if (!r.ok) return new Response('stripe non raggiungibile', { status: 502 }); // Stripe riprova da solo
  const righe = (await r.json()).data || [];
  for (const li of righe) {
    const slug = li.price?.product?.metadata?.slug;
    if (slug) await movimento(env, `st:${sid}:${slug}`, 'sito', slug, -Number(li.quantity || 1));
  }
  try { await registraOrdine(env, ev.data.object, righe); } catch (e) { console.error('ordine', e); }
  if (ev.data.object.metadata?.mk === '1' && SITO.pixelMeta && env.META_CAPI_TOKEN) waitUntil(acquistoMeta(env, ev.data.object, righe, new URL(request.url).origin).catch((e) => console.error('meta capi', e)));
  if (configurato(env)) waitUntil(sincronizza(env, new URL(request.url).origin, { limite: 30 }).catch(() => {}));
  return new Response('ok');
}

// Ordine nell'account del cliente, punti (1 per euro sui prodotti, spedizione esclusa) e avviso al negozio
// con i dati per la fattura elettronica (solo clienti con partita IVA).
async function registraOrdine(env, o, righe) {
  const d = await dbb(env);
  const md = o.metadata || {};
  const email = String(o.customer_details?.email || o.customer_email || '').toLowerCase();
  let cl = md.cliente ? await d.prepare('SELECT * FROM clienti WHERE id=?').bind(md.cliente).first() : null;
  if (!cl && email) cl = await d.prepare('SELECT * FROM clienti WHERE email=?').bind(email).first();
  const sped = Number(o.total_details?.amount_shipping || 0), tot = Number(o.amount_total || 0);
  const base = md.base_punti != null ? Number(md.base_punti) : Math.max(0, tot - sped);
  let punti = 0, dettaglio = [];
  if (cl) {
    const st = await d.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(COALESCE(base, totale - spedizione)),0) AS spesa FROM ordini WHERE cliente=? AND quando>=?')
      .bind(cl.id, SITO.punti.inizio).first();
    const c = calcolaPunti({ base, spesaPrima: Number(st?.spesa || 0), primo: !Number(st?.n || 0) });
    punti = c.punti; dettaglio = c.dettaglio;
  }
  const fattura = md.fattura === 'SI' ? 1 : 0;
  const datiF = fattura ? { ragioneSociale: md.ragione_sociale, piva: md.piva, sdi: md.sdi, pec: md.pec, sede: md.sede } : null;
  const el = righe.map((li) => ({ nome: li.description, q: li.quantity, tot: li.amount_total, slug: li.price?.product?.metadata?.slug }));
  const nuovo = await d.prepare(`INSERT OR IGNORE INTO ordini(sessione,cliente,email,totale,spedizione,punti,fattura,dati_fattura,consegna,righe,quando,pi,base)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(o.id, cl?.id || null, email, tot, sped, punti, fattura, datiF ? JSON.stringify(datiF) : null,
      md.consegna || '', JSON.stringify(el), new Date().toISOString(), o.payment_intent || null, base).run();
  await confermaBuoni(env, o.id, o.id.slice(-8).toUpperCase()); // scala il saldo dei buoni usati (una volta sola)
  if (!nuovo.meta.changes) return; // già registrato (Stripe a volte riprova)
  if (cl) { // completa il profilo con telefono e indirizzo usati al pagamento, solo dove è ancora vuoto
    const a = o.customer_details?.address || {}, tel = o.customer_details?.phone;
    if ((tel && !cl.telefono) || (a.line1 && !cl.indirizzo)) {
      const ok = a.line1 && !cl.indirizzo && a.country === 'IT';
      await d.prepare(`UPDATE clienti SET telefono=COALESCE(NULLIF(telefono,''),?), indirizzo=CASE WHEN ? THEN ? ELSE indirizzo END,
          cap=CASE WHEN ? THEN ? ELSE cap END, citta=CASE WHEN ? THEN ? ELSE citta END, provincia=CASE WHEN ? THEN ? ELSE provincia END, aggiornato=? WHERE id=?`)
        .bind(tel || null, ok ? 1 : 0, [a.line1, a.line2].filter(Boolean).join(' '), ok ? 1 : 0, a.postal_code || '', ok ? 1 : 0, a.city || '', ok ? 1 : 0, a.state || '', new Date().toISOString(), cl.id).run().catch(() => {});
    }
  }
  if (cl && punti) await aggiungiPunti(env, cl.id, 'ord:' + o.id, punti, `Ordine ${o.id.slice(-8).toUpperCase()}`);
  const eur = (c) => (c / 100).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
  const ind = o.shipping_details?.address || o.customer_details?.address || {};
  const testo = [
    `Nuovo ordine dal sito: ${o.id.slice(-8).toUpperCase()} (${eur(tot)})`,
    `Cliente: ${o.customer_details?.name || ''} <${email}> ${o.customer_details?.phone || ''}`,
    `Consegna: ${md.consegna || ''}${ind.line1 ? ` – ${ind.line1} ${ind.line2 || ''}, ${ind.postal_code || ''} ${ind.city || ''} (${ind.state || ''})` : ''}`,
    '', ...el.map((x) => `${x.q} × ${x.nome} – ${eur(x.tot)}`), `Spedizione: ${eur(sped)}`,
    md.codice_sconto ? `Codice sconto gioco: ${md.codice_sconto} (−${md.sconto_gioco} €)` : '',
    md.sconto_buono_punti ? `Buono punti (sconto, riduce l'imponibile): −${md.sconto_buono_punti} €` : '',
    md.pagato_con_buono_regalo ? `PAGATO IN PARTE CON BUONO REGALO: ${md.pagato_con_buono_regalo} € (buono multiuso: in fattura/corrispettivo il prezzo pieno, il buono è un mezzo di pagamento)` : '',
    md.buoni ? `Buoni usati: ${md.buoni}` : '',
    '', fattura ? `FATTURA ELETTRONICA DA EMETTERE\nRagione sociale: ${md.ragione_sociale}\nP.IVA: ${md.piva}\nCodice destinatario SDI: ${md.sdi}${md.pec ? `\nPEC: ${md.pec}` : ''}\nSede: ${md.sede}`
      : 'Cliente privato: niente fattura, vale la ricevuta (corrispettivo).',
    cl ? `Account: ${cl.id} · punti accreditati: ${punti}${dettaglio.length ? ' (' + dettaglio.map((x) => `${x.voce}: ${x.punti}`).join('; ') + ')' : ''}` : 'Ordine senza account.',
    o.custom_fields?.[0]?.text?.value ? `Note: ${o.custom_fields[0].text.value}` : '',
  ].filter((x) => x !== '').join('\n');
  await inviaEmail(env, { a: (env.EMAIL_TO || SITO.email).split(','), da: env.EMAIL_FROM || 'Semi Store <info@semistore.it>',
    oggetto: `${fattura ? '[FATTURA] ' : ''}Ordine ${o.id.slice(-8).toUpperCase()} · ${eur(tot)}`, testo, html: `<pre style="font:14px/1.5 Arial,sans-serif;white-space:pre-wrap">${testo.replace(/</g, '&lt;')}</pre>` });
}

async function togliPunti(env, ch) {
  if (!ch.payment_intent || !ch.amount) return;
  const d = await dbc(env);
  const o = await d.prepare('SELECT * FROM ordini WHERE pi=?').bind(ch.payment_intent).first();
  if (!o || !o.cliente || !o.punti) return;
  const daTogliere = Math.min(o.punti, Math.ceil(o.punti * Number(ch.amount_refunded || 0) / Number(ch.amount)));
  const gia = await d.prepare("SELECT COALESCE(-SUM(delta),0) AS t FROM punti_mov WHERE cliente=? AND id LIKE ?").bind(o.cliente, `rimb:${o.sessione}:%`).first();
  const delta = daTogliere - Number(gia?.t || 0);
  if (delta > 0) await aggiungiPunti(env, o.cliente, `rimb:${o.sessione}:${ch.amount_refunded}`, -delta, `Rimborso ordine ${o.sessione.slice(-8).toUpperCase()}`);
}

// Buono regalo pagato: crea il codice segreto e lo manda a chi l'ha comprato (e a chi lo riceve, se c'è l'email)
async function buonoRegalo(env, o, origin) {
  const d = await dbb(env);
  if (await d.prepare('SELECT id FROM buoni WHERE sessione=?').bind(o.id).first()) return; // già creato
  const md = o.metadata || {};
  const importo = Number(o.amount_subtotal || o.amount_total || 0);
  const email = String(o.customer_details?.email || o.customer_email || '').toLowerCase();
  const regalo = md.per === 'regalo';
  const clienti = await dbc(env);
  let cl = md.cliente ? await clienti.prepare('SELECT * FROM clienti WHERE id=?').bind(md.cliente).first() : null;
  if (!cl && email && !regalo) cl = await clienti.prepare('SELECT * FROM clienti WHERE email=?').bind(email).first();
  const { codice } = await creaBuono(env, {
    tipo: 'regalo', importo, cliente: regalo ? null : cl?.id || null, acquirente: email,
    destinatario: md.destinatario || null, emailDest: md.emailDest || null, messaggio: md.messaggio || null, tema: md.tema || null, mittente: md.mittente || null, sessione: o.id, pi: o.payment_intent || null,
  });
  const eur = (c) => (c / 100).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
  const esc = (t) => String(t || '').replace(/[<>&]/g, '');
  const ED = { natale: 'Edizione Natale', compleanno: 'Edizione Compleanno', grazie: 'Edizione Grazie', cantiere: 'Edizione Buon lavoro' }[md.tema] || 'Buono regalo';
  // carta "targhetta tecnica" (solo tabelle e stili in linea, per tutti i programmi di posta)
  const carta = `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:separate;margin:0 0 16px;text-align:left"><tr>
      <td width="14" style="background:#f5b800 repeating-linear-gradient(-45deg,#f5b800 0 8px,#15171a 8px 16px);border-radius:14px 0 0 14px">&nbsp;</td>
      <td style="background:#1d2024;color:#fff;border-radius:0 14px 14px 0;padding:18px 20px;font-family:Arial,sans-serif">
        <div style="font:700 11px monospace;letter-spacing:2px;color:#f5b800;text-transform:uppercase">Semi Store · Buono regalo</div>
        <div style="font-size:11px;color:#c9cbcf;text-transform:uppercase;letter-spacing:1px;margin-top:2px">${ED}</div>
        <div style="font-size:44px;font-weight:900;line-height:1.1;margin:6px 0 4px">${eur(importo)}</div>
        ${md.destinatario ? `<div style="font-size:15px">Per <b>${esc(md.destinatario)}</b>${md.mittente ? ` · da <b>${esc(md.mittente)}</b>` : ''}</div>` : ''}
        ${md.messaggio ? `<div style="margin-top:10px;font-style:italic;color:#e8e9eb;border-left:3px solid #f5b800;padding-left:10px">“${esc(md.messaggio)}”</div>` : ''}
        <div style="margin-top:14px;padding-top:10px;border-top:1px dashed #ffffff33;font:11px monospace;color:#9a9da3;text-transform:uppercase;letter-spacing:1px">Validità <b style="color:#fff">senza scadenza</b> &nbsp;·&nbsp; Uso <b style="color:#fff">tutto il sito</b></div>
      </td></tr></table>
    <p style="margin:0 0 8px">Il tuo codice segreto:</p>
    <div style="display:inline-block;background:#fff;border:2px dashed #f5b800;padding:12px 18px;border-radius:10px;font:700 20px monospace;letter-spacing:1px">${codice}</div>
    <p style="margin:14px 0 6px;font-size:14px">Si usa su tutto <b>semistore.it</b>, anche in più volte, <b>senza scadenza</b>. Scrivilo nel carrello alla voce "Hai un codice sconto o un buono?", oppure aggiungilo al tuo account per non perderlo.</p>
    <p style="margin:0 0 18px;font-size:13px;color:#5c5f65">Il codice è come denaro: non condividerlo e non pubblicarlo. Chi lo conosce può usarlo.</p>`;
  const vai = await linkAccesso(env, origin, regalo && md.emailDest ? md.emailDest : email, `/account/?buono=1`, { riusabileGg: 30 }).catch(() => `${origin}/account/`);
  const da = env.EMAIL_FROM_SCONTI || 'Semi Store Sconti <sconti@semistore.it>';
  if (regalo && md.emailDest) {
    await inviaEmail(env, { a: md.emailDest, da, oggetto: `${md.mittente || 'Qualcuno'} ti ha regalato un buono Semi Store da ${eur(importo)}`,
      html: cornice('Hai ricevuto un regalo!', carta + bottone(vai, 'Salva il buono nel mio account')),
      testo: `Hai ricevuto un buono regalo Semi Store da ${eur(importo)}${md.mittente ? ' da ' + md.mittente : ''}.\nCodice segreto: ${codice}\nSi usa su tutto semistore.it, anche in più volte, senza scadenza. Non condividere il codice.\n${md.messaggio ? '\nMessaggio: ' + md.messaggio : ''}` });
  }
  if (email) {
    await inviaEmail(env, { a: email, da, oggetto: regalo ? `Il buono regalo per ${md.destinatario} è pronto` : `Il tuo buono Semi Store da ${eur(importo)}`,
      html: cornice(regalo ? 'Il tuo regalo è pronto' : 'Il tuo buono è pronto', (regalo ? `<p style="margin:0 0 14px">${md.emailDest ? `L'abbiamo appena inviato a <b>${esc(md.emailDest)}</b>. Ecco una copia da stampare o inoltrare:` : 'Ecco il buono da stampare, inoltrare o consegnare a mano:'}</p>` : '') + carta + (regalo ? '' : bottone(vai, 'Salva il buono nel mio account'))),
      testo: `Buono regalo Semi Store da ${eur(importo)}${md.destinatario ? ' per ' + md.destinatario : ''}.\nCodice segreto: ${codice}\nSi usa su tutto semistore.it, anche in più volte, senza scadenza. Non condividere il codice.` });
  }
  await inviaEmail(env, { a: (env.EMAIL_TO || SITO.email).split(','), da: env.EMAIL_FROM || 'Semi Store <info@semistore.it>',
    oggetto: `Venduto buono regalo ${eur(importo)}`,
    testo: `Venduto un buono regalo da ${eur(importo)} (pagamento ${o.id.slice(-8).toUpperCase()}) a ${email}${regalo ? ` per ${md.destinatario}${md.emailDest ? ' <' + md.emailDest + '>' : ''}` : ''}.\nBuono multiuso (art. 6-quater DPR 633/72): l'IVA si applica quando viene speso, non ora.` });
}

// API Conversions di Meta: l'acquisto confermato da Stripe arriva a Meta anche se il browser blocca il Pixel.
// Solo con consenso marketing (metadata mk = 1). Stesso event_id del Pixel nella pagina «grazie», così Meta lo conta una volta.
// Email, telefono e dati personali partono solo come hash SHA-256, come chiede Meta. Token: variabile segreta META_CAPI_TOKEN su Cloudflare.
async function acquistoMeta(env, o, righe, origin) {
  const h = async (s) => { s = String(s || '').trim().toLowerCase(); if (!s) return undefined; const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join(''); };
  let ids = {};
  try { const l = await (await fetch(`${origin}/indice.json`)).json(); ids = Object.fromEntries((Array.isArray(l) ? l : []).map((v) => [v.s, v.k || v.m || v.s])); } catch {}
  const contents = righe.map((li) => { const slug = li.price?.product?.metadata?.slug; return slug ? { id: ids[slug] || slug, quantity: Number(li.quantity || 1), item_price: (li.price?.unit_amount || 0) / 100 } : null; }).filter(Boolean);
  if (!contents.length) return;
  const cd = o.customer_details || {}, ad = cd.address || {}, md = o.metadata || {};
  const nome = String(cd.name || '').trim().split(/\s+/);
  const tel = String(cd.phone || '').replace(/\D/g, '');
  const user_data = {
    em: [await h(cd.email)].filter(Boolean), ph: tel ? [await h(tel.length === 10 ? '39' + tel : tel)] : undefined,
    fn: nome[0] ? [await h(nome[0])] : undefined, ln: nome.length > 1 ? [await h(nome.slice(1).join(' '))] : undefined,
    ct: ad.city ? [await h(ad.city.replace(/\s+/g, ''))] : undefined, zp: ad.postal_code ? [await h(ad.postal_code)] : undefined,
    country: [await h(ad.country || 'it')], external_id: md.cliente ? [await h(md.cliente)] : undefined,
    client_ip_address: md.ip || undefined, client_user_agent: md.ua || undefined, fbp: md.fbp || undefined, fbc: md.fbc || undefined,
  };
  const valore = contents.reduce((t, c) => t + c.item_price * c.quantity, 0);
  const evento = {
    event_name: 'Purchase', event_time: Math.floor((o.created || Date.now() / 1000)), event_id: String(o.id).slice(-20), action_source: 'website',
    event_source_url: `${SITO.url}/grazie/`, user_data,
    custom_data: { currency: 'EUR', value: Math.round(valore * 100) / 100, content_type: 'product', content_ids: contents.map((c) => c.id), contents, num_items: contents.reduce((n, c) => n + c.quantity, 0), order_id: String(o.id).slice(-20) },
  };
  const r = await fetch(`https://graph.facebook.com/v21.0/${SITO.pixelMeta}/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: [evento], access_token: env.META_CAPI_TOKEN }) });
  if (!r.ok) console.error('meta capi', r.status, (await r.text()).slice(0, 300));
}
