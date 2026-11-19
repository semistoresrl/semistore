// Generatore comune dei feed prodotti (Google Merchant Center e Meta Commerce Manager).
// Meta legge lo stesso formato RSS di Google, cambiano solo alcuni valori (disponibilità).
import prodotti from '../data/prodotti.json';
import foto from '../data/foto.json';
import { SITO } from '../data/sito.js';

// Indirizzo pubblico del sito (dominio collegato a Cloudflare Pages il 19/11/2026)
const BASE = (import.meta.env.PUBLIC_SITO_URL || 'https://semistore.it').replace(/\/$/, '');
const f = foto as Record<string, boolean | string>;
const x = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const eur = (c: number) => (c / 100).toFixed(2) + ' EUR';
const CAT: Record<string, string> = {
  'Trapani e avvitatori': '1167', 'Tassellatori e demolitori': '1167', 'Smerigliatrici e levigatrici': '1167', 'Seghe e troncatrici': '1167',
  'Altri utensili': '1167', 'Kit': '1167', 'Giardino': '3798', 'Batterie e caricabatterie': '6907', 'Punte e inserti': '3944',
  'Lame, dischi e abrasivi': '3944', 'Accessori per elettroutensili': '3944', 'Chiodatrici e fissaggio': '1167', 'Misura e laser': '1193',
  'Aspirazione e pulizia': '619', 'Compressori e aria compressa': '1167', 'Contenitori e organizzazione': '3974', 'Utensili manuali': '1167',
};
const fra7 = () => { const d = new Date(Date.now() + 7 * 864e5); return d.toISOString().slice(0, 10) + 'T12:00+01:00'; };

export type Canale = 'google' | 'meta';

/** Prodotti pubblicabili: con prezzo e foto. */
export const pubblicabili = () => (prodotti as any[]).filter((p) => p.prezzo > 0 && f[p.slug]);

/**
 * Selezione per il catalogo WhatsApp (l'app WhatsApp Business ne mostra al massimo 500):
 * fuori punte, lame e dischi (tanti articoli piccoli, si chiedono in chat), prima i prodotti in sconto, poi i più cari.
 */
export const selezioneWhatsApp = (max = 500) =>
  pubblicabili()
    .filter((p) => !['Punte e inserti', 'Lame, dischi e abrasivi'].includes(p.categoria))
    .sort((a, b) => Number(!!(b.prezzoListino > b.prezzo)) - Number(!!(a.prezzoListino > a.prezzo)) || b.prezzo - a.prezzo)
    .slice(0, max);

export function feed(lista: any[], canale: Canale) {
  const items = lista.map((p) => {
    const img = f[p.slug] === true ? `${BASE}/img/prodotti/${p.slug}-800.webp` : String(f[p.slug]);
    const conferma = p.disponibilita === 'conferma';
    const desc = [p.sottotitolo, p.descrizione, ...(p.punti || [])].filter(Boolean).map((s: string) => String(s).trim().replace(/[.;:]+$/, '')).join('. ').replace(/\s+/g, ' ').slice(0, 4900);
    const sale = p.prezzoListino && p.prezzoListino > p.prezzo;
    // Google: punti di forza (max 10, 150 caratteri) e scheda tecnica (max 15 voci) mostrati nella scheda prodotto Shopping
    const extra = canale !== 'google' ? '' : [
      ...(p.punti || []).map((t: string) => String(t).trim().replace(/[.;]+$/, '')).filter((t: string) => t.length >= 10 && t.length <= 150).slice(0, 10)
        .map((t: string) => `\n<g:product_highlight>${x(t)}</g:product_highlight>`),
      ...(p.caratteristiche || []).map((c: string) => { const i = String(c).indexOf(': '); return i > 0 && i < 40 ? [c.slice(0, i), c.slice(i + 2)] : null; }).filter(Boolean).slice(0, 15)
        .map(([n, v]: string[]) => `\n<g:product_detail><g:section_name>Caratteristiche tecniche</g:section_name><g:attribute_name>${x(n.slice(0, 140))}</g:attribute_name><g:attribute_value>${x(v.slice(0, 1000))}</g:attribute_value></g:product_detail>`),
    ].join('');
    // Google: backorder + data; Meta: "available for order" (backorder non è accettato)
    const disp = conferma
      ? canale === 'google' ? `backorder</g:availability>\n<g:availability_date>${fra7()}</g:availability_date>` : 'available for order</g:availability>'
      : `${canale === 'google' ? 'in_stock' : 'in stock'}</g:availability>`;
    return `<item>
<g:id>${x(p.codice || p.modello || p.slug)}</g:id>
<g:title>${x(`${p.marca} ${p.nome}${p.modello && !p.nome.includes(p.modello) ? ' ' + p.modello : ''}`.slice(0, 150))}</g:title>
<g:description>${x(desc)}</g:description>
<g:link>${BASE}/prodotti/${p.slug}/</g:link>
<g:image_link>${x(img)}</g:image_link>
<g:availability>${disp}
<g:price>${eur(p.prezzo)}</g:price>
<g:condition>new</g:condition>
<g:brand>${x(p.marca)}</g:brand>
<g:mpn>${x(p.codice || p.modello)}</g:mpn>${p.ean ? `\n<g:gtin>${x(p.ean)}</g:gtin>` : ''}${extra}
<g:google_product_category>${CAT[p.categoria] || '1167'}</g:google_product_category>
<g:product_type>${x(p.categoria)}</g:product_type>
<g:shipping><g:country>IT</g:country><g:price>${eur(p.prezzo >= SITO.spedizione.gratisDa ? 0 : SITO.spedizione.costo)}</g:price><g:min_transit_time>2</g:min_transit_time><g:max_transit_time>4</g:max_transit_time></g:shipping>${canale === 'google' ? '\n<g:min_handling_time>0</g:min_handling_time>\n<g:max_handling_time>2</g:max_handling_time>' : ''}
</item>`;
  });
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel>
<title>${x(SITO.nome)}</title><link>${BASE}/</link><description>Catalogo ${x(SITO.nome)} – ${x(SITO.ragioneSociale)}</description>
${items.join('\n')}
</channel></rss>`;
  return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8' } });
}
