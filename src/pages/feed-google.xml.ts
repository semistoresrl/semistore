// Feed prodotti per Google Merchant Center: Google lo rilegge ogni giorno e pubblica i prodotti
// nella scheda Shopping e nella sezione Prodotti del profilo Google Maps (scheda Business collegata).
import prodotti from '../data/prodotti.json';
import foto from '../data/foto.json';
import { SITO } from '../data/sito.js';

// Indirizzo pubblico del sito: quando semistore.it punterà al nuovo sito impostare PUBLIC_SITO_URL=https://semistore.it su Cloudflare
const BASE = (import.meta.env.PUBLIC_SITO_URL || 'https://semistore.pages.dev').replace(/\/$/, '');
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

export function GET() {
  const items = (prodotti as any[]).filter((p) => p.prezzo > 0 && f[p.slug]).map((p) => {
    const img = f[p.slug] === true ? `${BASE}/img/prodotti/${p.slug}-800.webp` : String(f[p.slug]);
    const conferma = p.disponibilita === 'conferma';
    const desc = [p.sottotitolo, p.descrizione, ...(p.punti || [])].filter(Boolean).map((s: string) => String(s).trim().replace(/[.;:]+$/, '')).join('. ').replace(/\s+/g, ' ').slice(0, 4900);
    const sale = p.prezzoListino && p.prezzoListino > p.prezzo;
    return `<item>
<g:id>${x(p.codice || p.modello || p.slug)}</g:id>
<g:title>${x(`${p.marca} ${p.nome}${p.modello && !p.nome.includes(p.modello) ? ' ' + p.modello : ''}`.slice(0, 150))}</g:title>
<g:description>${x(desc)}</g:description>
<g:link>${BASE}/prodotti/${p.slug}/</g:link>
<g:image_link>${x(img)}</g:image_link>
<g:availability>${conferma ? 'backorder' : 'in_stock'}</g:availability>${conferma ? `\n<g:availability_date>${fra7()}</g:availability_date>` : ''}
<g:price>${eur(sale ? p.prezzoListino : p.prezzo)}</g:price>${sale ? `\n<g:sale_price>${eur(p.prezzo)}</g:sale_price>` : ''}
<g:condition>new</g:condition>
<g:brand>${x(p.marca)}</g:brand>
<g:mpn>${x(p.codice || p.modello)}</g:mpn>${p.ean ? `\n<g:gtin>${x(p.ean)}</g:gtin>` : '\n<g:identifier_exists>no</g:identifier_exists>'}
<g:google_product_category>${CAT[p.categoria] || '1167'}</g:google_product_category>
<g:product_type>${x(p.categoria)}</g:product_type>
<g:shipping><g:country>IT</g:country><g:price>${eur(p.prezzo >= SITO.spedizione.gratisDa ? 0 : SITO.spedizione.costo)}</g:price></g:shipping>
</item>`;
  });
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel>
<title>${x(SITO.nome)}</title><link>${BASE}/</link><description>Catalogo ${x(SITO.nome)} – ${x(SITO.ragioneSociale)}</description>
${items.join('\n')}
</channel></rss>`;
  return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8' } });
}
