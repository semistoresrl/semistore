// Pannello unico spedizioni (app gestione → Ordini online → Evadi e stampa). Utenti collegati all'app; i conti solo l'amministratore.
//  GET                         → canali con stato del collegamento, corriere, impostazioni (segreti mascherati)
//  GET ?etichetta=<id ordine>  → etichette già stampate dell'ordine (ristampa senza richiamare il marketplace)
//  POST {azione:"evadi", id, opz:{formato,colli,pesoKg,metodo,consegna,ristampa,nuova}}
//        → evade l'ordine sul suo marketplace come da Seller Center / Seller Hub, restituisce le etichette PDF (base64)
//  POST {azione:"conferma", id, tracking, corriere} → per le etichette "indirizzo": invia il tracking al marketplace
//  POST {azione:"spediti", ids:[…]}   → consegnati al corriere: Pronto → Spedito
//  POST {azione:"importa", dal?}      → legge i nuovi ordini da eBay, Amazon e dai marketplace Mirakl
//  POST {azione:"accetta", id}        → accetta un ordine Mirakl in attesa
//  POST {azione:"conti", conti}       → solo admin: salva chiavi e impostazioni
//  POST {azione:"metodi"}             → servizi e mittenti Sendcloud per le impostazioni
import { json } from '../_lib/db.js';
import { autorizzato, gdb } from '../_lib/gestione.js';
import { canali, adattatore, slug, RISERVATI } from '../_lib/marketplace/index.js';
import { conti, salvaConti, maschera, unisciConto, leggiOrdine, segnaEvaso, segnaSpediti, ordineMpInApp, salvaFile, leggiFile, b64 } from '../_lib/marketplace/comune.js';
import { metodi, mittenti, nomeCorriere } from '../_lib/marketplace/corriere.js';
import { getImp, setImp } from '../_lib/db.js';

const IMP = { formato: 'A6', pesoKg: 2, consegnaTikTok: 'PICKUP' };

export async function onRequestGet({ request, env }) {
  const u = await autorizzato(request, env); if (!u) return json({ error: 'non collegato' }, 401);
  const c = await conti(env), q = new URL(request.url).searchParams;
  if (q.get('etichetta')) {
    const o = await leggiOrdine(env, q.get('etichetta')); if (!o) return json({ error: 'ordine non trovato' }, 404);
    const n = Number(o.evaso?.pdf) || 0, pdfs = [];
    for (let i = 0; i < n; i++) { const f = await leggiFile(env, `etichetta-${o.id}-${i}`); if (f) pdfs.push(b64(f.bytes)); }
    return json({ pdfs, indirizzo: !!o.evaso?.indirizzo, ordine: riassunto(o) });
  }
  return json({ canali: canali(env, c), corriere: { ...maschera(c.corriere || { tipo: 'indirizzo' }), nome: nomeCorriere(c.corriere) },
    conti: u.ruolo === 'admin' ? maschera({ ebay: c.ebay || {}, amazon: c.amazon || {}, mercati: c.mercati || [] }) : null,
    impostazioni: { ...IMP, ...(c.impostazioni || {}) }, mittente: c.mittenteTesto || '', ultimoImport: (await getImp(env, 'mp_import'))?.at || 0, admin: u.ruolo === 'admin' });
}

const riassunto = (o) => ({ id: o.id, num: o.num, canale: o.canale, stato: o.stato, tracking: o.tracking || '', corriere: o.corriere || '', trackUrl: o.trackUrl || '', evaso: o.evaso || null });

// un ordine alla volta: blocco di 2 minuti, così due persone che premono insieme non comprano due etichette
async function blocca(env, id) {
  const d = await gdb(env), now = Date.now();
  const r = await d.prepare(`UPDATE docs SET d=json_set(d,'$.evasoInCorso',?) WHERE c='ordiniWeb' AND id=? AND (json_extract(d,'$.evasoInCorso') IS NULL OR json_extract(d,'$.evasoInCorso') < ?)`)
    .bind(now, id, now - 120000).run();
  return r.meta.changes === 1;
}
async function sblocca(env, id) { const d = await gdb(env); await d.prepare("UPDATE docs SET d=json_remove(d,'$.evasoInCorso') WHERE c='ordiniWeb' AND id=?").bind(id).run(); }

async function salvaPdf(env, id, pdfs, chi) { for (let i = 0; i < pdfs.length; i++) await salvaFile(env, `etichetta-${id}-${i}`, 'application/pdf', `etichetta ${id} ${i + 1}.pdf`, pdfs[i], chi); }

export async function onRequestPost({ request, env }) {
  const u = await autorizzato(request, env); if (!u) return json({ error: 'non collegato' }, 401);
  const b = await request.json().catch(() => ({}));
  const c = await conti(env);
  const chi = u.nome || u.email;
  try {
    if (b.azione === 'evadi' || b.azione === 'conferma') {
      const o = await leggiOrdine(env, b.id); if (!o) return json({ error: 'ordine non trovato' }, 404);
      if (o.stato === 'Annullato') return json({ error: 'ordine annullato: non si spedisce' }, 409);
      if (o.consegna === 'ritiro' && ['sito', 'whatsapp', 'telefono', 'banco'].includes(o.canale || 'sito')) return json({ error: 'ordine con ritiro in negozio: niente etichetta' }, 409);
      const opz = { ...(c.impostazioni || {}), ...(b.opz || {}), conti: c };
      if (b.azione === 'evadi' && opz.formato === undefined) opz.formato = 'A6';
      // già evaso: si ristampa quello che c'è, non si compra un'altra etichetta (a meno di "nuova")
      if (b.azione === 'evadi' && o.evaso?.at && !opz.nuova) {
        const n = Number(o.evaso.pdf) || 0, pdfs = [];
        for (let i = 0; i < n; i++) { const f = await leggiFile(env, `etichetta-${o.id}-${i}`); if (f) pdfs.push(b64(f.bytes)); }
        if (pdfs.length || o.evaso.indirizzo) return json({ ok: true, ristampa: true, pdfs, indirizzo: !!o.evaso.indirizzo, daConfermare: !!o.evaso.daConfermare, ordine: riassunto(o), nota: 'Ristampa: etichetta già creata il ' + new Date(o.evaso.at).toLocaleString('it-IT', { timeZone: 'Europe/Rome' }) });
        if (o.canale !== 'tiktok') return json({ error: 'etichetta già creata ma non più in archivio: se serve davvero un\'altra spedizione usa "Nuova etichetta"' }, 409);
      }
      if (!(await blocca(env, o.id))) return json({ error: 'un\'altra persona sta già stampando questo ordine: aspetta un attimo' }, 409);
      try {
        const a = adattatore(o.canale, c);
        if (a.mercato) opz.mercato = a.mercato;
        if (b.azione === 'conferma') {
          const trk = String(b.tracking || '').trim(); if (!trk) return json({ error: 'scrivi il numero di tracking' }, 400);
          opz.etichetta = { indirizzo: true }; opz.tracking = trk; opz.corriere = String(b.corriere || '').trim();
        }
        const r = await a.evadi(env, o, opz);
        const pdfs = r.pdfs || (r.pdf ? [r.pdf] : []);
        if (pdfs.length) await salvaPdf(env, o.id, pdfs, chi);
        const patch = { tracking: r.tracking || o.tracking, corriere: r.corriere || o.corriere, trackUrl: r.trackUrl || o.trackUrl,
          evaso: { ...(r.evaso || {}), pdf: pdfs.length || Number(o.evaso?.pdf) || 0, indirizzo: !!r.indirizzo || (b.azione === 'conferma' ? !!o.evaso?.indirizzo : false),
            daConfermare: !!r.daConfermare, formato: r.formato || opz.formato || 'A6', nota: r.nota || '', rifCorriere: r.rifCorriere || o.evaso?.rifCorriere || '',
            pesoKg: r.pesoKg || o.evaso?.pesoKg || null, colli: r.colli || o.evaso?.colli || 1, ...(b.azione === 'conferma' ? { confermato: Date.now() } : {}) } };
        const g = await segnaEvaso(env, o.id, patch, chi);
        return json({ ok: true, pdfs: pdfs.map(b64), indirizzo: !!r.indirizzo, daConfermare: !!r.daConfermare, nota: r.nota || '', apri: r.apri || '', ordine: riassunto(g) });
      } finally { await sblocca(env, o.id); }
    }
    if (b.azione === 'spediti') return json({ ok: true, spediti: await segnaSpediti(env, (b.ids || []).map(String).slice(0, 200), chi) });
    if (b.azione === 'accetta') {
      const o = await leggiOrdine(env, b.id); if (!o) return json({ error: 'ordine non trovato' }, 404);
      const a = adattatore(o.canale, c); if (!a.accetta) return json({ error: 'su questo canale non serve accettare' }, 400);
      return json({ ok: true, ...(await a.accetta(env, o)) });
    }
    if (b.azione === 'importa') {
      const prima = (await getImp(env, 'mp_import')) || {};
      const dal = b.dal || (prima.at ? prima.at - 3 * 864e5 : Date.now() - 30 * 864e5);
      const esito = {};
      for (const k of canali(env, c).filter((x) => x.importa && x.stato.ok)) {
        const a = adattatore(k.id, c); const e = { letti: 0, nuovi: 0, aggiornati: 0 };
        try {
          for (const x of await a.ordini(env, dal)) { e.letti++; const r = await ordineMpInApp(env, x); if (r?.nuovo) e.nuovi++; else if (r?.cambiato) e.aggiornati++; }
        } catch (er) { e.errore = er.message; }
        esito[k.id] = e;
      }
      await setImp(env, 'mp_import', { at: Date.now(), esito });
      return json({ ok: true, esito });
    }
    if (b.azione === 'conti') {
      if (u.ruolo !== 'admin') return json({ error: "solo per l'amministratore" }, 403);
      const n = b.conti || {}, out = { ...c };
      if (n.corriere) out.corriere = unisciConto(c.corriere, n.corriere);
      if (n.ebay) out.ebay = unisciConto(c.ebay, n.ebay);
      if (n.amazon) out.amazon = unisciConto(c.amazon, n.amazon);
      if (n.impostazioni) out.impostazioni = { ...(c.impostazioni || {}), ...n.impostazioni };
      if (n.mittenteTesto !== undefined) out.mittenteTesto = String(n.mittenteTesto).slice(0, 400);
      if (Array.isArray(n.mercati)) {
        out.mercati = n.mercati.filter((m) => m && m.nome).map((m) => {
          const id = m.id || slug(m.nome); if (RISERVATI.has(id)) throw new Error(`"${m.nome}" esiste già tra i canali`);
          const vecchio = (c.mercati || []).find((x) => x.id === id) || {};
          return unisciConto(vecchio, { ...m, id, tipo: m.tipo === 'mirakl' ? 'mirakl' : 'manuale' });
        });
        const ids = out.mercati.map((m) => m.id); if (new Set(ids).size !== ids.length) throw new Error('due marketplace con lo stesso nome');
      }
      await salvaConti(env, out);
      return json({ ok: true, canali: canali(env, out), corriere: { ...maschera(out.corriere || { tipo: 'indirizzo' }), nome: nomeCorriere(out.corriere) }, conti: maschera({ ebay: out.ebay || {}, amazon: out.amazon || {}, mercati: out.mercati || [] }), impostazioni: { ...IMP, ...(out.impostazioni || {}) } });
    }
    if (b.azione === 'metodi') return json({ ok: true, metodi: await metodi(c.corriere), mittenti: await mittenti(c.corriere) });
    return json({ error: 'azione non valida' }, 400);
  } catch (e) {
    return json({ error: e.message }, 502);
  }
}
