// Allinea TikTok Shop con le giacenze ufficiali del sito.
// Ogni chiamata lavora un blocco di prodotti (limite di richieste di Cloudflare): l'app interna
// richiama /api/tiktok/sync finché "restanti" arriva a 0.
import prodotti from '../../src/data/prodotti.json';
import { db, getImp } from './db.js';
import { chiama, magazzino, caricaFoto, categoriaConsigliata, marchio, attributi } from './tiktok.js';
import { prodottoTikTokPer, ttProdottiLetti } from './tiktok-dati.js';

const SI = (v) => ['1', 'true', 'si', 'sì'].includes(String(v || '').toLowerCase());
// Scelta del cliente (23/11): all'invio dell'inventario TUTTO il magazzino con giacenza > 0 va su TikTok.
// Se il prodotto c'è già (anche caricato a mano) si collega; altrimenti si crea. TIKTOK_CREA_NUOVI=0 per spegnere la creazione.

const PER_SLUG = Object.fromEntries(prodotti.map((p) => [p.slug, p]));
const eur = (cent) => (cent / 100).toFixed(2);
const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Scheda completa: dati del sito + quelli inviati dall'app (che hanno la precedenza)
export function scheda(riga) {
  const extra = riga.dati ? JSON.parse(riga.dati) : {};
  return { ...(PER_SLUG[riga.slug] || {}), ...extra, slug: riga.slug };
}

// Prezzo TikTok calcolato per incassare ESATTAMENTE lo stesso netto del sito:
//   netto sito   = prezzo − commissione Stripe (1,5% + 0,25 € carte UE standard)
//   netto TikTok = prezzo TikTok × (1 − commissione TikTok − commissione creator)
//   prezzo TikTok = netto sito / (1 − commissione TikTok − creator), arrotondato per eccesso al centesimo
// Variabili (facoltative): TIKTOK_COMMISSIONE_PERCENTO (9), TIKTOK_AFFILIATI_PERCENTO (0),
// STRIPE_PERCENTO (1.5), STRIPE_FISSO_CENT (25). TIKTOK_RICARICO_PERCENTO, se impostata, sostituisce il calcolo.
const num = (v, d) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));
export function prezzoTikTok(env, centesimi) {
  if (!centesimi) return 0;
  if (env.TIKTOK_RICARICO_PERCENTO) return Math.ceil(centesimi * (1 + Number(env.TIKTOK_RICARICO_PERCENTO) / 100));
  const tt = num(env.TIKTOK_COMMISSIONE_PERCENTO, 9) / 100;
  const aff = num(env.TIKTOK_AFFILIATI_PERCENTO, 0) / 100;
  const netto = centesimi - centesimi * num(env.STRIPE_PERCENTO, 1.5) / 100 - num(env.STRIPE_FISSO_CENT, 25);
  return Math.max(centesimi, Math.ceil(netto / (1 - tt - aff) - 1e-9)); // mai sotto il prezzo del sito
}

function pesoKg(p) {
  if (p.pesoKg) return Number(p.pesoKg);
  const riga = (p.caratteristiche || []).find((c) => /^peso/i.test(c));
  const m = riga && riga.replace(',', '.').match(/([\d.]+)\s*kg/i);
  return m ? Math.round((Number(m[1]) + 0.5) * 10) / 10 : Number(p.peso || 3); // +0,5 kg di imballo
}

function titolo(p) {
  // 24/11: TikTok rifiuta il titolo con simboli come × e Ø (punte «Ø 12 × 160 mm»): li scrivo in lettere
  const t = `${p.marca || ''} ${p.modello || p.codice || ''} ${p.nome || ''}`
    .replace(/\s*×\s*/g, ' x ').replace(/[ØøⲐ⌀]\s*/g, 'diam. ').replace(/[–—]/g, '-')
    .replace(/[^\p{L}\p{N}\s.,;:()\/'"+&%°#-]/gu, ' ').replace(/\s+/g, ' ').trim();
  return t.slice(0, 255);
}

function descrizione(p) {
  const parti = [];
  if (p.sottotitolo) parti.push(`<p><strong>${esc(p.sottotitolo)}</strong></p>`);
  if (p.descrizione) parti.push(`<p>${esc(p.descrizione)}</p>`);
  const elenco = [...(p.caratteristiche || []), ...(p.punti || [])].slice(0, 15);
  if (elenco.length) parti.push('<ul>' + elenco.map((c) => `<li>${esc(c)}</li>`).join('') + '</ul>');
  if (p.dotazione) parti.push(`<p>Dotazione: ${esc(p.dotazione)}</p>`);
  parti.push('<p>Venduto da Se.Mi. srl, concessionario DEWALT, STANLEY e BLACK+DECKER per Lazio, Campania e Molise e centro assistenza autorizzato. Prodotto originale con garanzia ufficiale.</p>');
  return parti.join('');
}

function foto(p, origin) {
  const l = [];
  if (p.immagineDewalt) l.push(p.immagineDewalt);
  for (const u of p.immagini || []) l.push(u);
  if (p.immagine) l.push(p.immagine);
  return [...new Set(l.map((u) => (u.startsWith('/') ? origin + u : u)))].slice(0, 5);
}

// Attributi obbligatori: prova ad abbinare i valori ai testi del prodotto (es. "Brushless", "18V")
function attributiDa(lista, p) {
  const testo = [p.nome, p.sottotitolo, p.descrizione, ...(p.caratteristiche || []), p.volt].join(' ').toUpperCase();
  const out = [];
  for (const a of lista) {
    if (a.type !== 'PRODUCT_PROPERTY' || !(a.is_requried || a.is_required)) continue;
    const v = (a.values || []).find((x) => x.name && testo.includes(String(x.name).toUpperCase()));
    if (v) out.push({ id: a.id, values: [{ id: v.id, name: v.name }] });
    else if (/marca|brand/i.test(a.name) && p.marca) out.push({ id: a.id, values: [{ name: p.marca }] });
  }
  return out;
}

// conformità UE (GPSR): id del fabbricante e del responsabile UE per marca, salvati in impostazioni
async function conformita(env, marca) {
  const c = (await getImp(env, 'tiktok_conformita')) || {};
  const m = c[String(marca || '').toUpperCase()] || c['*'] || {};
  const o = {};
  if (m.fabbricante) o.manufacturer_ids = [String(m.fabbricante)];
  if (m.responsabile) o.responsible_person_ids = [String(m.responsabile)];
  return o;
}

// Prodotti già caricati a mano in Seller Center: li cerco per codice (seller_sku), con e senza "-QW",
// così il sito li collega invece di crearne un doppione.
const varianti = (c) => { const b = String(c || '').trim().toUpperCase(); if (!b) return []; const s = b.replace(/-(QW|XJ|GB|LX)$/,''); return [...new Set([b, s, s + '-QW'])]; };
export async function cercaEsistente(env, p, slug) {
  const codici = [...new Set([...varianti(p.modello), ...varianti(p.codice), slug].filter(Boolean))];
  const d = await chiama(env, 'POST', '/product/202309/products/search', { query: { page_size: 20 }, body: { seller_skus: codici } });
  for (const pr of d.products || []) {
    const sku = (pr.skus || []).find((k) => codici.includes(String(k.seller_sku || '').toUpperCase())) || (pr.skus || [])[0];
    if (sku) return { product: pr.id, sku: sku.id, prezzo: Math.round(Number(sku.price?.tax_exclusive_price || sku.price?.sale_price || 0) * 100) || null };
  }
  return null;
}

async function crea(env, riga, origin) {
  const p = scheda(riga);
  if (!p.nome) throw new Error('Prodotto senza nome: invia nome e marca dall\'app');
  if (!prezzoTikTok(env, riga.prezzo ?? p.prezzo)) throw new Error('Prodotto senza prezzo: mettilo nell\'app (solo amministratore) e reinvia');
  const immagini = foto(p, origin);
  if (!immagini.length) throw new Error('Prodotto senza foto: TikTok ne richiede almeno una');
  const tit = titolo(p);
  const categoria = p.tiktokCategoria || await categoriaConsigliata(env, tit);
  const brand = p.marca ? await marchio(env, categoria, p.marca) : undefined;
  const attr = attributiDa(await attributi(env, categoria).catch(() => []), p);
  const uri = [];
  for (const u of immagini.slice(0, 3)) { try { uri.push({ uri: await caricaFoto(env, u) }); } catch {} }
  if (!uri.length) throw new Error('Nessuna foto caricata su TikTok (link non raggiungibili)');
  const sellerSku = String(p.modello || p.codice || riga.slug).slice(0, 50);
  const prezzo = prezzoTikTok(env, riga.prezzo ?? p.prezzo);
  const sku = {
    seller_sku: sellerSku,
    price: { amount: eur(prezzo), currency: 'EUR' },
    inventory: [{ warehouse_id: await magazzino(env), quantity: riga.qty }],
  };
  if (p.ean) sku.identifier_code = { code: String(p.ean), type: 'EAN' };
  const corpo = {
    title: tit, description: descrizione(p), category_id: String(categoria), main_images: uri, skus: [sku],
    package_weight: { value: String(pesoKg(p)), unit: 'KILOGRAM' },
    package_dimensions: { length: String(p.lunghezzaCm || 45), width: String(p.larghezzaCm || 35), height: String(p.altezzaCm || 15), unit: 'CENTIMETER' },
    is_cod_allowed: false, ...(await conformita(env, p.marca)),
  };
  if (brand) corpo.brand_id = String(brand);
  if (attr.length) corpo.product_attributes = attr;

  let d, nota = null;
  try {
    d = await chiama(env, 'POST', '/product/202309/products', { body: corpo });
  } catch (e) {
    // mancano dati che TikTok vuole (attributi, certificazioni…): lo creo come bozza da completare in Seller Center
    d = await chiama(env, 'POST', '/product/202309/products', { body: { ...corpo, save_mode: 'AS_DRAFT' } });
    nota = 'Bozza: completala in Seller Center. Motivo: ' + e.message;
  }
  return { product: d.product_id, sku: d.skus?.[0]?.id, prezzo, nota };
}

export async function sincronizza(env, origin, { limite = 40 } = {}) {
  const d = await db(env);
  const conta = async () => (await d.prepare('SELECT COUNT(*) n FROM giacenze WHERE tt_da_sync = 1').first()).n;
  const t = await getImp(env, 'tiktok_token');
  if (!t?.access_token) return { creati: 0, aggiornati: 0, errori: 0, restanti: await conta(), attesa: 'TikTok Shop non ancora collegato: i prodotti restano in coda' };
  const righe = (await d.prepare('SELECT * FROM giacenze WHERE tt_da_sync = 1 ORDER BY (tt_product IS NULL), aggiornata LIMIT 30').all()).results;
  const letti = await ttProdottiLetti(d);
  let budget = limite; // richieste esterne a disposizione in questa chiamata
  const esito = { creati: 0, aggiornati: 0, errori: 0, dettagli: [] };
  const ora = () => new Date().toISOString();

  for (const r of righe) {
    const nuovo = !r.tt_product;
    const creaNuovi = !['0', 'false', 'no'].includes(String(env.TIKTOK_CREA_NUOVI ?? '').toLowerCase()) || (() => { try { return JSON.parse(r.dati || '{}').tiktok === true; } catch { return false; } })();
    const costo = nuovo ? (creaNuovi ? 13 : letti ? 0 : 1) : 3;
    if (budget < costo) break;
    budget -= costo;
    try {
      if (nuovo && r.qty <= 0) {
        await d.prepare('UPDATE giacenze SET tt_da_sync=0 WHERE slug=?').bind(r.slug).run();
        continue;
      }
      if (nuovo) {
        // già presente su TikTok (caricato a mano)? lo collego e allineo solo la quantità
        const sc = scheda(r);
        const es = letti ? await prodottoTikTokPer(d, [sc.modello, sc.codice, r.codice, r.slug]) : await cercaEsistente(env, sc, r.slug).catch(() => null);
        if (es) {
          await d.prepare('UPDATE giacenze SET tt_product=?, tt_sku=?, tt_qty=NULL, tt_prezzo=?, tt_stato=?, tt_errore=NULL, tt_da_sync=1, tt_sync=?, tt_esistente=1 WHERE slug=?')
            .bind(es.product, es.sku, es.prezzo, 'in vendita', ora(), r.slug).run();
          esito.collegati = (esito.collegati || 0) + 1; esito.dettagli.push({ slug: r.slug, esito: 'già su TikTok: collegato' });
          continue;
        }
        if (!creaNuovi) { // non è su TikTok: resta solo sul sito
          await d.prepare("UPDATE giacenze SET tt_da_sync=0, tt_stato='non su TikTok', tt_errore=NULL, tt_sync=? WHERE slug=?").bind(ora(), r.slug).run();
          continue;
        }
        const c = await crea(env, r, origin);
        await d.prepare('UPDATE giacenze SET tt_product=?, tt_sku=?, tt_qty=?, tt_prezzo=?, tt_stato=?, tt_errore=?, tt_da_sync=0, tt_sync=? WHERE slug=?')
          .bind(c.product, c.sku, r.qty, c.prezzo, c.nota ? 'bozza' : 'in vendita', c.nota, ora(), r.slug).run();
        esito.creati++; esito.dettagli.push({ slug: r.slug, esito: c.nota ? 'bozza' : 'creato' });
        continue;
      }
      const p = scheda(r);
      const prezzo = prezzoTikTok(env, r.prezzo ?? p.prezzo);
      if (r.qty !== r.tt_qty) {
        await chiama(env, 'POST', `/product/202309/products/${r.tt_product}/inventory/update`, {
          body: { skus: [{ id: r.tt_sku, inventory: [{ warehouse_id: await magazzino(env), quantity: Math.max(0, r.qty) }] }] },
        });
      }
      const prezzoManuale = SI(env.TIKTOK_PREZZI_MANUALI); // scelta del cliente 22/11: i prezzi si allineano anche per i prodotti caricati a mano
      if (prezzo && prezzo !== r.tt_prezzo && !prezzoManuale) {
        await chiama(env, 'POST', `/product/202309/products/${r.tt_product}/prices/update`, {
          body: { skus: [{ id: r.tt_sku, price: { amount: eur(prezzo), currency: 'EUR' } }] },
        });
      }
      await d.prepare('UPDATE giacenze SET tt_qty=?, tt_prezzo=?, tt_da_sync=0, tt_sync=?, tt_errore=NULL, tt_stato=? WHERE slug=?')
        .bind(r.qty, prezzoManuale || !prezzo ? r.tt_prezzo : prezzo, ora(), r.qty > 0 ? (r.tt_stato === 'bozza' ? 'bozza' : 'in vendita') : 'esaurito', r.slug).run();
      esito.aggiornati++;
    } catch (e) {
      await d.prepare('UPDATE giacenze SET tt_errore=?, tt_stato=?, tt_da_sync=0, tt_sync=? WHERE slug=?')
        .bind(String(e.message).slice(0, 500), 'errore', ora(), r.slug).run();
      esito.errori++; esito.dettagli.push({ slug: r.slug, errore: e.message });
    }
  }
  esito.restanti = await conta();
  return esito;
}
