// Catalogo per Trovaprezzi.it (formato XML dei "Requisiti tecnici Trovaprezzi.it Network", versione 07/10/2026).
// Solo articoli in negozio (giacenza > 0): Trovaprezzi è a pagamento per clic, i "su conferma" restano fuori.
// Prezzi e disponibilità arrivano dall'app con il build (scripts/live.mjs), quindi il file è sempre allineato al sito.
// Indirizzo da comunicare a Trovaprezzi: https://semistore.it/feed-trovaprezzi.xml
import { pubblicabili } from '../lib/feed';
import foto from '../data/foto.json';
import { SITO } from '../data/sito.js';

const BASE = (import.meta.env.PUBLIC_SITO_URL || 'https://semistore.it').replace(/\/$/, '');
const f = foto as Record<string, boolean | string>;
const x = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const eur = (c: number) => (c / 100).toFixed(2);
const corto = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…');

export const GET = () => {
  const lista = pubblicabili().filter((p: any) => p.disponibilita !== 'conferma' && Number(p.giacenza) > 0);
  const offerte = lista.map((p: any) => {
    const img = f[p.slug] === true ? `${BASE}/img/prodotti/${p.slug}-800.webp` : String(f[p.slug]);
    const nome = `${p.marca} ${p.nome}${p.modello && !p.nome.includes(p.modello) ? ' ' + p.modello : ''}`;
    const desc = [p.sottotitolo, ...(p.punti || [])].filter(Boolean).map((s: string) => String(s).trim().replace(/[.;:]+$/, '')).join('. ').replace(/\s+/g, ' ');
    const sped = p.prezzo >= SITO.spedizione.gratisDa ? 0 : SITO.spedizione.costo;
    const q = Math.floor(Number(p.giacenza) || 0);
    return `<Offer>
<Name>${x(corto(nome, 255))}</Name>
<Brand>${x(p.marca)}</Brand>
<Description>${x(corto(desc || nome, 255))}</Description>
<Price>${eur(p.prezzo)}</Price>
<Code>${x(p.codice || p.modello || p.slug)}</Code>
<Link>${BASE}/prodotti/${p.slug}/</Link>
<Stock>${q >= 2 ? 'disponibile' : 'limitata'}</Stock>
<Categories>${x(['Utensileria', p.categoria].filter(Boolean).join(';'))}</Categories>
<Image>${x(img)}</Image>
<ShippingCost>${sped > 0 ? eur(sped) : "0"}</ShippingCost>
<PartNumber>${x(p.codice || p.modello)}</PartNumber>${p.ean ? `\n<EanCode>${x(p.ean)}</EanCode>` : ''}${Number(p.peso) > 0 ? `\n<Weight>${Number(p.peso).toFixed(3)}</Weight>` : ''}
</Offer>`;
  });
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<Products>\n${offerte.join('\n')}\n</Products>`;
  return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8' } });
};
