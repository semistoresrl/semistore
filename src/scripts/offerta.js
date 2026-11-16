import { scadenzaMs } from '../data/offerta.js';
// Mostra copertina e barra delle Offerte Flash solo se l'offerta è attiva; le nasconde alla scadenza.
const el = [...document.querySelectorAll('[data-offerta]')];
if (el.length) {
  const scade = scadenzaMs(el[0].dataset.scade);
  const nascondi = () => el.forEach((e) => (e.hidden = true));
  const scaduta = () => scade && Date.now() >= scade;
  if (!scaduta()) {
    fetch('/api/offerta').then((r) => (r.ok ? r.json() : { attiva: false })).then((o) => {
      if (!o.attiva || scaduta()) return;
      el.forEach((e) => (e.hidden = false));
      if (!scade) return;
      const cd = document.querySelectorAll('[data-of-cd]');
      const due = (n) => String(n).padStart(2, '0');
      const tick = () => {
        const s = Math.max(0, Math.floor((scade - Date.now()) / 1000));
        if (!s) { nascondi(); return clearInterval(t); }
        const g = Math.floor(s / 86400), h = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60;
        const txt = `Termina tra <b>${g ? g + 'g ' : ''}${due(h)}:${due(m)}:${due(s % 60)}</b>`;
        cd.forEach((c) => { c.innerHTML = txt; c.hidden = false; });
      };
      const t = setInterval(tick, 1000); tick();
    }).catch(() => {});
  }
}
