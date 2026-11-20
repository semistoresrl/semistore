// Regole del programma punti, usate sia dal sito (anteprima nel carrello e nell'account) sia dal server (accredito).
// Tutti gli importi in centesimi.
import { SITO } from '../data/sito.js';
const P = SITO.punti;

export function livelloDi(spesa = 0) {
  const L = P.livelli;
  let i = 0;
  for (let k = 0; k < L.length; k++) if (spesa >= L[k].da) i = k;
  const prossimo = L[i + 1] || null;
  return { ...L[i], indice: i, prossimo, manca: prossimo ? prossimo.da - spesa : 0 };
}

export function turboAttivo(quando = new Date()) {
  const g = new Date(quando).toISOString().slice(0, 10);
  return (P.turbo || []).find((t) => g >= t.da && g <= t.a) || null;
}

export function bonusCarrello(base) {
  let b = null;
  for (const s of P.bonusCarrello) if (base >= s.da) b = s;
  return b;
}

// base = prodotti al netto di sconti e buoni punti; spesaPrima = spesa nel programma prima di questo ordine
export function calcolaPunti({ base, spesaPrima = 0, primo = false, quando = new Date() }) {
  const euro = Math.max(0, Math.floor(base / 100));
  const dett = [];
  const bp = euro * P.perEuro;
  if (bp) dett.push({ voce: `${P.perEuro} punto per ogni euro`, punti: bp });
  const liv = livelloDi(spesaPrima);
  if (liv.x > 1 && bp) dett.push({ voce: `Livello ${liv.nome} ×${String(liv.x).replace('.', ',')}`, punti: Math.round(bp * (liv.x - 1)) });
  const bc = bonusCarrello(base);
  if (bc && bp) dett.push({ voce: `Bonus carrello +${bc.pct}%`, punti: Math.round(bp * bc.pct / 100) });
  const t = turboAttivo(quando);
  if (t && bp) dett.push({ voce: `${t.nome || 'Punti turbo'} ×${t.x}`, punti: Math.round(bp * (t.x - 1)) });
  if (primo && P.primoOrdine) dett.push({ voce: 'Bonus primo ordine', punti: P.primoOrdine });
  return { punti: dett.reduce((s, d) => s + d.punti, 0), dettaglio: dett, livello: liv };
}

// Prossima soglia del bonus carrello (per il suggerimento "aggiungi X € per +Y% punti")
export function prossimoBonus(base) {
  return P.bonusCarrello.find((s) => base < s.da) || null;
}

export const catalogoAperto = (quando = new Date()) => new Date(quando) >= new Date(P.catalogo + 'T00:00:00+01:00');
