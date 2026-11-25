// Modelli per i suggerimenti del modulo di assistenza: solo utensili e macchine (niente punte, lame, accessori).
// Catalogo del sito + listino noleggio DEWALT (anche modelli a filo non in vendita online). Generato al build.
import prodotti from '../../data/prodotti.json';
import noleggio from '../../data/noleggio.json';
import { fotoDi } from '../../data/foto';
const ESCLUSE = new Set(['Punte e inserti', 'Lame, dischi e abrasivi', 'Accessori per elettroutensili', 'Contenitori e organizzazione', 'Utensili manuali']);
export const GET = () => {
  const out = new Map<string, any>();
  for (const p of prodotti as any[]) {
    if (ESCLUSE.has(p.categoria) || !p.modello) continue;
    const m = String(p.modello).toUpperCase();
    if (!out.has(m)) out.set(m, { m, n: p.nome, b: p.marca, i: fotoDi(p.slug, 400) || '' });
  }
  for (const x of noleggio as any[]) {
    if (/^(DE0|DE7|DWH|DCMAS[A-Z]|D2598)/.test(x.m) || x.cat === 'Batterie e caricabatterie' && !/^DCB\d/.test(x.m)) continue;
    if (!out.has(x.m)) out.set(x.m, { m: x.m, n: x.n, b: 'DEWALT', i: x.img || '' });
  }
  return new Response(JSON.stringify([...out.values()]), { headers: { 'content-type': 'application/json; charset=utf-8' } });
};
