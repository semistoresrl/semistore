// Elenco dei canali di vendita e del loro "adattatore" per il pannello unico Ordini online → Evadi e stampa.
// Aggiungere un marketplace:
//  - su Mirakl (Leroy Merlin e simili) o senza API: dall'app, Impostazioni → Marketplace e spedizioni → Aggiungi (niente codice);
//  - con un'API diversa: un file in questa cartella con info/stato/ordini/evadi come ebay.js, più una riga in FISSI.
import * as tiktok from './tiktok.js';
import * as ebay from './ebay.js';
import * as amazon from './amazon.js';
import * as mirakl from './mirakl.js';
import * as manuale from './manuale.js';
import { statoCorriere } from './corriere.js';

const NOSTRI = [['sito', 'Sito'], ['whatsapp', 'WhatsApp'], ['telefono', 'Telefono'], ['banco', 'Negozio']];
export const RISERVATI = new Set([...NOSTRI.map((x) => x[0]), 'tiktok', 'ebay', 'amazon']);
export const slug = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '').slice(0, 20);

export function canali(env, conti = {}) {
  const cor = statoCorriere(conti.corriere);
  const out = NOSTRI.map(([id, nome]) => ({ id, nome, tipo: 'nostro', etichettaDalMarketplace: false, stato: cor, importa: false }));
  out.push({ ...tiktok.info, tipo: 'api', stato: tiktok.stato(env), importa: false, nota: 'Gli ordini arrivano da soli (webhook)' });
  out.push({ ...ebay.info, tipo: 'api', stato: ebay.stato(conti.ebay), importa: true });
  out.push({ ...amazon.info, tipo: 'api', stato: amazon.stato(conti.amazon), importa: true });
  for (const m of conti.mercati || []) {
    if (m.spento) continue;
    out.push({ id: m.id, nome: m.nome, tipo: m.tipo, etichettaDalMarketplace: false, pannello: m.pannello || '', importa: m.tipo === 'mirakl',
      stato: m.tipo === 'mirakl' ? mirakl.stato(m) : { ok: true, testo: 'Senza collegamento: etichetta nostra, tracking da incollare sul marketplace' } });
  }
  return out;
}

// funzioni per un canale: { evadi(env, ordine, opz), ordini?(env, dal), accetta?, mercato? }
export function adattatore(canale, conti = {}) {
  if (canale === 'tiktok') return { evadi: tiktok.evadi };
  if (canale === 'ebay') return { evadi: ebay.evadi, ordini: (env, dal) => ebay.ordini(env, conti.ebay, dal) };
  if (canale === 'amazon') return { evadi: amazon.evadi, ordini: (env, dal) => amazon.ordini(env, conti.amazon, dal) };
  const m = (conti.mercati || []).find((x) => x.id === canale);
  if (m?.tipo === 'mirakl') return { mercato: m, evadi: mirakl.evadi, ordini: (env, dal) => mirakl.ordini(env, m, dal), accetta: (env, o) => mirakl.accetta(env, m, o) };
  return { mercato: m || null, evadi: manuale.evadi };
}
