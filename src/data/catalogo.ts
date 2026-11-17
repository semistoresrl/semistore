// Dati condivisi per catalogo, pagine categoria, ricerca e carrello.
import prodotti from './prodotti.json';
import { fotoDi, fotoLocale } from './foto';

export const ORDINE_CAT = ['Trapani e avvitatori', 'Tassellatori e demolitori', 'Smerigliatrici e levigatrici', 'Seghe e troncatrici', 'Kit', 'Batterie e caricabatterie', 'Giardino', 'Chiodatrici e fissaggio', 'Misura e laser', 'Aspirazione e pulizia', 'Compressori e aria compressa', 'Altri utensili', 'Contenitori e organizzazione', 'Utensili manuali', 'Accessori per elettroutensili', 'Punte e inserti', 'Lame, dischi e abrasivi'];
const pos = (c: string) => { const i = ORDINE_CAT.indexOf(c); return i < 0 ? 99 : i; };
// ordine "consigliati": prima i prodotti con dati completi, DEWALT, utensili, poi per prezzo
export const ordinati = [...prodotti].sort((a: any, b: any) => (a.auto ? 1 : 0) - (b.auto ? 1 : 0) || (a.marca === 'DEWALT' ? 0 : 1) - (b.marca === 'DEWALT' ? 0 : 1) || pos(a.categoria) - pos(b.categoria) || b.prezzo - a.prezzo);

// slug "parlante" delle categorie: /categorie/trapani-e-avvitatori/
export const slugCategoria = (c: string) => c.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const urlCategoria = (c: string) => `/categorie/${slugCategoria(c)}/`;

// voce compatta per il JSON /indice.json (usato dal browser)
export const voce = (p: any) => {
  const i = fotoDi(p.slug, 400) || (p.kit ? p.kit.find((k: any) => k.u)?.u : '') || '';
  return {
    s: p.slug, n: p.nome, m: p.modello || '', b: p.marca, c: p.categoria, v: p.volt || '', p: p.prezzo,
    l: p.prezzoListino && p.prezzoListino > p.prezzo ? p.prezzoListino : 0, i, ss: fotoLocale(p.slug) ? 1 : 0, d: p.disponibilita === 'conferma' ? 1 : 0,
  };
};
