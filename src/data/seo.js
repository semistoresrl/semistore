import { SITO } from './sito.js';
export function productLd(p, img) {
  return {
    '@context': 'https://schema.org', '@type': 'Product', name: p.nome, description: p.descrizione || p.sottotitolo || undefined, sku: p.modello || String(p.id), mpn: p.modello || undefined,
    brand: { '@type': 'Brand', name: p.marca }, image: img ? (img.startsWith('http') ? img : SITO.url + img) : undefined, category: p.categoria,
    offers: {
      '@type': 'Offer', price: (p.prezzo / 100).toFixed(2), priceCurrency: 'EUR', availability: p.disponibilita === 'conferma' ? 'https://schema.org/BackOrder' : 'https://schema.org/InStock',
      url: `${SITO.url}/prodotti/${p.slug}/`, seller: { '@type': 'Organization', name: SITO.ragioneSociale },
    },
  };
}
