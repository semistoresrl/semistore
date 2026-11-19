import { SITO } from './sito.js';

// Dati strutturati Product per Google (risultati con prezzo, disponibilità, spedizione e reso).
// Le regole di spedizione e reso sono le stesse di condizioni-di-vendita e del feed Merchant Center.
const anno = new Date().getFullYear();
const fineAnno = `${anno}-12-31`;

const spedizione = (cent) => ({
  '@type': 'OfferShippingDetails',
  shippingRate: { '@type': 'MonetaryAmount', value: cent >= SITO.spedizione.gratisDa ? '0.00' : (SITO.spedizione.costo / 100).toFixed(2), currency: 'EUR' },
  shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'IT' },
  deliveryTime: {
    '@type': 'ShippingDeliveryTime',
    handlingTime: { '@type': 'QuantitativeValue', minValue: 0, maxValue: 2, unitCode: 'DAY' },
    transitTime: { '@type': 'QuantitativeValue', minValue: 2, maxValue: 4, unitCode: 'DAY' },
  },
});

const reso = {
  '@type': 'MerchantReturnPolicy',
  applicableCountry: 'IT',
  returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
  merchantReturnDays: 14,
  returnMethod: ['https://schema.org/ReturnByMail', 'https://schema.org/ReturnInStore'],
  returnFees: 'https://schema.org/ReturnShippingFees',
  merchantReturnLink: `${SITO.url}/condizioni-di-vendita/`,
};

const assoluta = (u) => (u ? (u.startsWith('http') ? u : SITO.url + u) : undefined);

export function productLd(p, img) {
  const url = `${SITO.url}/prodotti/${p.slug}/`;
  const foto = assoluta(img);
  const immagini = foto ? [foto, foto.replace(/-800\.webp$/, '-400.webp')].filter((v, i, a) => a.indexOf(v) === i) : undefined;
  const prezzo = (p.prezzo / 100).toFixed(2);
  const offer = {
    '@type': 'Offer', url, price: prezzo, priceCurrency: 'EUR', priceValidUntil: fineAnno,
    itemCondition: 'https://schema.org/NewCondition',
    availability: p.disponibilita === 'conferma' ? 'https://schema.org/BackOrder' : 'https://schema.org/InStock',
    seller: { '@id': SITO.url + '/#negozio' },
    shippingDetails: spedizione(p.prezzo),
    hasMerchantReturnPolicy: reso,
  };
  // prezzo di listino mostrato barrato (Google lo legge come prezzo "prima")
  if (p.prezzoListino && p.prezzoListino > p.prezzo) {
    offer.priceSpecification = [
      { '@type': 'UnitPriceSpecification', price: prezzo, priceCurrency: 'EUR' },
      { '@type': 'UnitPriceSpecification', priceType: 'https://schema.org/StrikethroughPrice', price: (p.prezzoListino / 100).toFixed(2), priceCurrency: 'EUR' },
    ];
  }
  const ld = {
    '@context': 'https://schema.org', '@type': 'Product', '@id': url + '#prodotto',
    name: `${p.marca} ${p.modello ? p.modello + ' ' : ''}${p.nome}`.replace(/\s+/g, ' '),
    description: p.descrizione || p.sottotitolo || undefined,
    sku: p.modello || String(p.id), mpn: p.modello || undefined,
    brand: { '@type': 'Brand', name: p.marca },
    image: immagini, category: p.categoria, url,
    offers: offer,
  };
  const props = (p.caratteristiche || []).map((s) => { const i = s.indexOf(': '); return i > 0 && i < 40 ? { '@type': 'PropertyValue', name: s.slice(0, i), value: s.slice(i + 2) } : null; }).filter(Boolean).slice(0, 15);
  if (props.length) ld.additionalProperty = props;
  if (p.video && p.video.id) {
    ld.subjectOf = { '@type': 'VideoObject', name: p.video.it || p.video.t || ld.name, description: `Video di utilizzo: ${ld.name}`, thumbnailUrl: `https://i.ytimg.com/vi/${p.video.id}/hqdefault.jpg`, embedUrl: `https://www.youtube-nocookie.com/embed/${p.video.id}`, contentUrl: `https://www.youtube.com/watch?v=${p.video.id}`, uploadDate: p.video.d || undefined };
    if (!ld.subjectOf.uploadDate) delete ld.subjectOf; // Google vuole la data di caricamento: senza, niente VideoObject
  }
  return ld;
}
