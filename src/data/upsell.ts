// Upselling: cosa serve per far funzionare un utensile e accessori compatibili (e viceversa).
// Dati generati da compat_sito.py a partire dalla compatibilità dell'app (schede + listino DEWALT 2026).
import prodotti from './prodotti.json';
import compat from './compat_sito.json';
const BY = new Map((prodotti as any[]).map((p) => [p.slug, p]));
const C = compat as Record<string, any>;
const prod = (l: string[] = []) => l.map((s) => BY.get(s)).filter((p: any) => p && p.prezzo > 0);
export function upsell(slug: string) {
  const c = C[slug];
  if (!c) return null;
  if (c.t === 'm') return {
    tipo: 'macchina' as const, al: c.al as string, soloCorpo: !!c.sc,
    batterie: prod(c.b), proposta: prod(c.u),
    gruppi: (c.g as [string, string[], number][]).map(([f, l, n]) => ({ famiglia: f, prodotti: prod(l), totale: n })).filter((g) => g.prodotti.length),
  };
  return { tipo: c.t === 'b' ? 'batteria' as const : 'accessorio' as const, famiglia: c.f as string, macchine: prod(c.mac), totale: c.n as number };
}
