// Scheda prodotto creata nel browser: stesso markup di src/components/ProductCard.astro
const eur = (c) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(c / 100);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export { eur, esc };
export function card(x) {
  const sc = x.l ? Math.round((1 - x.p / x.l) * 100) : 0;
  const srcset = x.ss ? ` srcset="/img/prodotti/${x.s}-400.webp 400w, /img/prodotti/${x.s}-800.webp 800w" sizes="(max-width:600px) 50vw, 260px"` : '';
  const img = x.i ? `<img src="${esc(x.i)}"${srcset} width="400" height="400" alt="${esc(x.n)}" data-ph="${esc(x.m || x.b)}" loading="lazy" decoding="async">` : `<span class="mono pc-ph">${esc(x.m || x.b)}</span>`;
  return `<a href="/prodotti/${x.s}/" class="pc card"><span class="pc-img">${img}<span class="pc-tags">${x.v ? `<span class="t-k">${esc(x.v)}</span>` : ''}<span class="t-w">${esc(x.b)}</span></span></span>`
    + `<span class="pc-b">${x.m ? `<span class="mono pc-code">${esc(x.m)}</span>` : ''}<b class="pc-n">${esc(x.n)}</b>`
    + `<span class="pc-f"><span class="pc-prz"><span class="pc-pr">${eur(x.p)}</span>${sc >= 5 ? `<s class="pc-li"><span class="sr">Prezzo di listino </span>${eur(x.l)}</s><span class="pc-sc">-${sc}%</span>` : ''}</span>`
    + `${x.d ? '<span class="pc-ok pc-cf">Su conferma</span>' : '<span class="pc-ok">Disponibile</span>'}</span></span></a>`;
}
let cache;
export const indice = () => (cache ||= fetch('/indice.json').then((r) => r.json()));
// testo normalizzato per la ricerca (senza accenti, spazi e trattini nei codici)
export const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
export const cerca = (lista, q) => {
  const w = norm(q).split(/\s+/).filter(Boolean);
  if (!w.length) return lista;
  const out = [];
  for (const x of lista) {
    const t = x._t ||= (() => { const b = norm(`${x.n} ${x.m} ${x.b} ${x.c} ${x.v}`); return b + ' ' + b.replace(/(\d+),0\s*(ah)/g, '$1$2').replace(/(\d+(?:,\d+)?)\s+(ah|v|mm|w|nm)\b/g, '$1$2'); })(); const c = x._c ||= t.replace(/[\s-]/g, '');
    if (!w.every((k) => t.includes(k) || c.includes(k.replace(/-/g, '')))) continue;
    // punteggio: codice che inizia con la parola > parola intera nel nome > parola dentro il testo
    const m = norm(x.m), n = ' ' + t.replace(/[^a-z0-9,]+/g, ' ') + ' ';
    let sc = 0;
    for (const k of w) { if (m === k) sc += 20; else if (m.startsWith(k)) sc += 8; if (n.includes(' ' + k + ' ') || n.includes(' ' + k + ',')) sc += 4; else if (n.includes(' ' + k)) sc += 2; }
    out.push([sc, x]);
  }
  return out.sort((a, b) => b[0] - a[0]).map((r) => r[1]);
};
