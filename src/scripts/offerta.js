import { scadenzaMs, inizioMs } from '../data/offerta.js';
// Copertina e barra delle Offerte Flash:
// - prima di "inizio": visibili in modalità "in arrivo" con conto alla rovescia all'apertura;
// - all'apertura passano da sole a "attiva ora" (conto alla rovescia alla scadenza, se c'è);
// - alla scadenza, o se la pagina DEWALT non è online, spariscono.
const el = [...document.querySelectorAll('[data-offerta]')];
if (el.length) {
  const ini = inizioMs(el[0].dataset.inizio);
  const fin = scadenzaMs(el[0].dataset.scade);
  const ora = () => Date.now();
  const $$ = (q) => document.querySelectorAll(q);
  const due = (n) => String(n).padStart(2, '0');
  const testo = (q, t) => $$(q).forEach((e) => (e.textContent = t));
  const giorno = (ms) => new Date(ms).toLocaleString('it-IT', { timeZone: 'Europe/Rome', weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
  let t;

  const mostra = (v) => el.forEach((e) => (e.hidden = !v));
  const modo = () => {
    if (fin && ora() >= fin) return 'finita';
    if (ini && ora() < ini) return 'prossima';
    return 'attiva';
  };
  const conta = (bersaglio, prima) => {
    const s = Math.max(0, Math.floor((bersaglio - ora()) / 1000));
    const g = Math.floor(s / 86400), h = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60;
    $$('[data-u="g"]').forEach((e) => (e.textContent = due(g)));
    $$('[data-u="h"]').forEach((e) => (e.textContent = due(h)));
    $$('[data-u="m"]').forEach((e) => (e.textContent = due(m)));
    $$('[data-u="s"]').forEach((e) => (e.textContent = due(s % 60)));
    $$('[data-of-cd]').forEach((c) => { c.innerHTML = `${prima} <b>${g ? g + 'g ' : ''}${due(h)}:${due(m)}:${due(s % 60)}</b>`; c.hidden = false; });
    $$('[data-of-box]').forEach((b) => (b.hidden = false));
  };
  const nascondiConta = () => { $$('[data-of-cd]').forEach((c) => (c.hidden = true)); $$('[data-of-box]').forEach((b) => (b.hidden = true)); };

  const aggiorna = () => {
    const m = modo();
    if (m === 'finita') { mostra(false); clearInterval(t); return; }
    $$('.of').forEach((a) => a.classList.toggle('prossima', m === 'prossima'));
    if (m === 'prossima') {
      testo('[data-of-k]', 'In arrivo · segna la data');
      testo('[data-of-lab]', 'Le offerte aprono tra');
      testo('[data-of-cta]', `Aprono ${giorno(ini)}`);
      testo('[data-of-bar-s]', 'aprono a breve');
      conta(ini, 'Aprono tra');
    } else {
      testo('[data-of-k]', 'Offerta a tempo · attiva ora');
      testo('[data-of-lab]', 'Termina tra');
      testo('[data-of-cta]', 'Scopri le offerte');
      testo('[data-of-bar-s]', 'prezzi speciali a tempo limitato');
      if (fin) conta(fin, 'Termina tra'); else nascondiConta();
    }
  };

  const avvia = () => { mostra(true); aggiorna(); t = setInterval(aggiorna, 1000); };

  // date di apertura e chiusura entrambe note: valgono le date (la pagina DEWALT può essere lenta o bloccare i controlli)
  if (modo() === 'prossima' || (ini && fin && modo() === 'attiva')) avvia();
  else if (modo() === 'attiva') { // senza date: decide il controllo della pagina DEWALT
    fetch('/api/offerta').then((r) => (r.ok ? r.json() : { attiva: false })).catch(() => ({ attiva: false })).then((o) => {
      // appena aperta (prima mezz'ora) si fida della data: il controllo della pagina DEWALT ha 10 minuti di cache
      if (o.attiva || (ini && ora() - ini < 30 * 60 * 1000)) avvia();
    });
  }
}
