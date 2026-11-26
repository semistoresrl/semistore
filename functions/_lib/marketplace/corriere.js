// Corriere di Semi per gli ordini che spediamo noi (sito, WhatsApp, telefono, e i marketplace che non danno l'etichetta).
// Due modi, scelti in Impostazioni → Marketplace e spedizioni:
//  - "sendcloud": un solo account per BRT, GLS, Poste, SDA, InPost… L'etichetta vera, con tracking, la crea Sendcloud.
//  - "indirizzo": nessun contratto collegato. L'app stampa un'etichetta mittente/destinatario e il tracking si scrive a mano.
import { chiamaJson, viaCivico, pesoOrdine } from './comune.js';

const SC = 'https://panel.sendcloud.sc/api/v2';
const auth = (c) => 'Basic ' + btoa(`${c.publicKey}:${c.secretKey}`);

export const nomeCorriere = (c) => (c?.tipo === 'sendcloud' ? 'Sendcloud' : 'Etichetta indirizzo (senza corriere collegato)');
export function statoCorriere(c) {
  if (c?.tipo === 'sendcloud') return c.publicKey && c.secretKey ? { ok: true, testo: 'Sendcloud collegato' + (c.metodoNome ? ' · ' + c.metodoNome : '') } : { ok: false, testo: 'Sendcloud: mancano le chiavi' };
  return { ok: true, testo: 'Stampa etichetta indirizzo, tracking a mano' };
}

// metodi di spedizione disponibili su Sendcloud per l'Italia (per la tendina delle impostazioni)
export async function metodi(c) {
  if (c?.tipo !== 'sendcloud') return [];
  const j = await chiamaJson(`${SC}/shipping_methods${c.mittente ? '?sender_address=' + encodeURIComponent(c.mittente) : ''}`, { headers: { authorization: auth(c) } }, 'Sendcloud');
  return (j.shipping_methods || []).filter((m) => (m.countries || []).some((x) => x.iso_2 === 'IT'))
    .map((m) => ({ id: m.id, nome: m.name, corriere: m.carrier, min: Number(m.min_weight) || 0, max: Number(m.max_weight) || 0, prezzo: (m.countries || []).find((x) => x.iso_2 === 'IT')?.price ?? null }));
}
export async function mittenti(c) {
  if (c?.tipo !== 'sendcloud') return [];
  const j = await chiamaJson(`${SC}/user/addresses/sender`, { headers: { authorization: auth(c) } }, 'Sendcloud');
  return (j.sender_addresses || []).map((a) => ({ id: a.id, nome: [a.company_name, a.street, a.house_number, a.city].filter(Boolean).join(' ') }));
}


// Sendcloud ha un servizio per ogni fascia di peso (es. "Poste … Domicilio 0-2kg", "2-5kg"…): scelto il servizio
// predefinito, per ogni pacco si usa quello della stessa famiglia adatto al peso. Se non si trova, resta quello scelto.
const famiglia = (n) => String(n || '').replace(/\s*\d+(?:[.,]\d+)?\s*-\s*\d+(?:[.,]\d+)?\s*kg\s*$/i, '').trim().toLowerCase();
export async function metodoPerPeso(c, metodo, pesoKg) {
  try {
    const tutti = await metodi(c); const scelto = tutti.find((m) => String(m.id) === String(metodo));
    if (!scelto || (pesoKg > scelto.min - 0.0005 && pesoKg <= scelto.max)) return metodo;
    const f = famiglia(scelto.nome);
    const adatto = tutti.filter((m) => famiglia(m.nome) === f && pesoKg > m.min - 0.0005 && pesoKg <= m.max).sort((a, b) => a.max - b.max)[0];
    return adatto ? adatto.id : metodo;
  } catch { return metodo; }
}

const CORR = { brt: 'BRT', bartolini: 'BRT', gls: 'GLS', gls_it: 'GLS', poste: 'Poste', poste_italiane: 'Poste', sda: 'SDA', dhl: 'DHL', ups: 'UPS', inpost: 'InPost', fedex: 'FedEx', tnt: 'TNT' };
const nomeCor = (code) => { const k = String(code || '').toLowerCase(); return CORR[k] || Object.entries(CORR).find(([x]) => k.includes(x))?.[1] || String(code || '').toUpperCase(); };

// Crea la spedizione e restituisce { pdf, tracking, corriere, trackUrl, rifCorriere } (pdf = Uint8Array, formato A6 10×15)
// oppure { indirizzo:true } se l'etichetta la disegna l'app.
export async function creaEtichetta(env, c, o, opz = {}) {
  if (c?.tipo !== 'sendcloud') return { indirizzo: true };
  if (!c.publicKey || !c.secretKey) throw new Error('Sendcloud non collegato: inserisci le chiavi in Impostazioni → Marketplace e spedizioni');
  let metodo = opz.metodo || c.metodo;
  if (!metodo) throw new Error('Sendcloud: scegli il servizio di spedizione predefinito in Impostazioni → Marketplace e spedizioni');
  for (const [k, t] of [['cliente', 'nome del destinatario'], ['ind', 'indirizzo'], ['cap', 'CAP'], ['citta', 'città']]) if (!String(o[k] || '').trim()) throw new Error('manca ' + t);
  const [via, civ] = viaCivico(o.ind);
  const peso = Number(opz.pesoKg) || (await pesoOrdine(env, o, Number(c.pesoKg) || 2));
  const colli = Math.max(1, Math.min(10, parseInt(opz.colli) || 1));
  metodo = await metodoPerPeso(c, metodo, peso / colli);
  const totale = (o.righe || []).reduce((a, r) => a + (Number(r.qty) || 0) * (Number(r.prezzo) || 0), 0);
  const parcel = {
    name: String(o.cliente).slice(0, 75), company_name: o.azienda || '', address: via, house_number: civ || 'snc', address_2: o.ind2 || '',
    city: o.citta, postal_code: String(o.cap).trim(), country: o.paese || 'IT', telephone: o.tel || '', email: o.email || '',
    ...(o.prov && (o.paese || 'IT') === 'IT' ? { to_state: String(o.prov).toUpperCase() } : {}),
    weight: (peso / colli).toFixed(3), order_number: o.num || o.rif || '', request_label: true, shipment: { id: Number(metodo) },
    total_order_value_currency: 'EUR', total_order_value: totale.toFixed(2), quantity: colli,
    ...(c.mittente ? { sender_address: Number(c.mittente) } : {}),
  };
  const j = await chiamaJson(`${SC}/parcels`, { method: 'POST', headers: { authorization: auth(c), 'content-type': 'application/json' }, body: JSON.stringify({ parcel }) }, 'Sendcloud');
  const pacchi = j.parcels || (j.parcel ? [j.parcel] : []);
  if (!pacchi.length) throw new Error('Sendcloud non ha restituito la spedizione');
  const pdfs = [];
  for (const p of pacchi) {
    const url = p.label?.label_printer || (p.documents || []).find((x) => x.type === 'label')?.link;
    if (!url) throw new Error('Sendcloud: etichetta non pronta per la spedizione ' + p.id);
    const r = await fetch(url, { headers: { authorization: auth(c) } });
    if (!r.ok) throw new Error('Sendcloud: etichetta non scaricabile (HTTP ' + r.status + ')');
    pdfs.push(new Uint8Array(await r.arrayBuffer()));
  }
  const p0 = pacchi[0];
  return { pdfs, tracking: pacchi.map((p) => p.tracking_number).filter(Boolean).join(' '), corriere: nomeCor(p0.carrier?.code || p0.carrier),
    trackUrl: p0.tracking_url || '', rifCorriere: pacchi.map((p) => p.id).join(','), pesoKg: peso, colli };
}
