// Ricerca istantanea nelle caselle "Cerca" dell'intestazione: mentre scrivi mostra fino a 6 prodotti con foto e prezzo.
// L'elenco (/indice.json) si scarica solo al primo tocco sulla casella.
import { indice, cerca, eur, esc } from './card.js';

document.querySelectorAll('form.search').forEach((form) => {
  const inp = form.querySelector('input');
  if (!inp) return;
  const box = document.createElement('div');
  box.className = 'sug'; box.hidden = true; box.setAttribute('role', 'listbox');
  box.id = inp.id + '-sug';
  form.append(box);
  inp.setAttribute('role', 'combobox'); inp.setAttribute('aria-autocomplete', 'list');
  inp.setAttribute('aria-controls', box.id); inp.setAttribute('aria-expanded', 'false');
  let sel = -1, t;
  const chiudi = () => { box.hidden = true; inp.setAttribute('aria-expanded', 'false'); sel = -1; };
  const evidenzia = () => [...box.querySelectorAll('a')].forEach((a, i) => a.classList.toggle('on', i === sel));
  const mostra = async () => {
    const q = inp.value.trim();
    if (q.length < 2) return chiudi();
    const tutti = await indice();
    const r = cerca(tutti, q);
    if (!r.length) { box.innerHTML = `<p class="sug-0">Nessun prodotto per “${esc(q)}”. <a href="/contatti/">Chiedicelo</a>: lo ordiniamo noi.</p>`; }
    else box.innerHTML = r.slice(0, 6).map((x) => `<a href="/prodotti/${x.s}/" role="option">${x.i ? `<img src="${esc(x.i)}" alt="" width="48" height="48" loading="lazy">` : '<span class="sug-ph"></span>'}<span class="sug-t"><b>${esc(x.n)}</b><small>${esc([x.m, x.b].filter(Boolean).join(' · '))}</small></span><b class="sug-p">${eur(x.p)}</b></a>`).join('')
      + `<a class="sug-all" href="/catalogo/?q=${encodeURIComponent(q)}">Vedi tutti i ${r.length} risultati →</a>`;
    box.hidden = false; inp.setAttribute('aria-expanded', 'true'); sel = -1;
  };
  inp.addEventListener('focus', () => indice(), { once: true });
  inp.addEventListener('input', () => { clearTimeout(t); t = setTimeout(mostra, 120); });
  inp.addEventListener('keydown', (e) => {
    const n = box.querySelectorAll('a').length;
    if (box.hidden || !n) return;
    if (e.key === 'ArrowDown') { sel = (sel + 1) % n; evidenzia(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = (sel - 1 + n) % n; evidenzia(); e.preventDefault(); }
    else if (e.key === 'Enter' && sel >= 0) { e.preventDefault(); box.querySelectorAll('a')[sel].click(); }
    else if (e.key === 'Escape') chiudi();
  });
  document.addEventListener('click', (e) => { if (!form.contains(e.target)) chiudi(); });
});
