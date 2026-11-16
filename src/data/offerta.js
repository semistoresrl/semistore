// Offerte flash DEWALT: pagina preparata da DEWALT per Semi, ogni tanto con nuove promo.
// La copertina in home e la barra in alto compaiono SOLO se l'offerta è attiva:
//  1) se "scade" è compilato, spariscono da sole a quell'ora (anche senza ripubblicare il sito);
//  2) in ogni caso il sito controlla ogni 10 minuti (/api/offerta) che la pagina DEWALT risponda:
//     se DEWALT la toglie o la mette in "offerta terminata", la copertina sparisce da sola.
// Per una nuova offerta basta cambiare "scade" (ed eventualmente i testi). Per spegnerla a mano: attiva:false.
export const OFFERTA = {
  attiva: true,
  url: 'https://semi.flashoffer.it/',
  titolo: 'Offerte Flash DEWALT',
  sottotitolo: 'Prezzi speciali per un tempo limitato, solo da Semi Store. Quando finiscono, finiscono.',
  scade: '', // es. '2026-11-30T23:59' (ora italiana). Vuoto = resta finché la pagina DEWALT è online
};

// "scade" in ora italiana (gestisce ora solare/legale) -> millisecondi; 0 se non impostata
export const scadenzaMs = (s = OFFERTA.scade) => {
  if (!s) return 0;
  if (/[zZ]|[+-]\d\d:\d\d$/.test(s)) return Date.parse(s);
  const utc = Date.parse(s + 'Z');
  const roma = new Date(new Date(utc).toLocaleString('en-US', { timeZone: 'Europe/Rome' }));
  const qui = new Date(new Date(utc).toLocaleString('en-US', { timeZone: 'UTC' }));
  return utc - (roma - qui);
};
