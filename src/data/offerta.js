// Offerte flash DEWALT: pagina preparata da DEWALT per Semi, ogni tanto con nuove promo.
// La copertina in home e la barra in alto compaiono SOLO se l'offerta è attiva:
//  1) se "scade" è compilato, spariscono da sole a quell'ora (anche senza ripubblicare il sito);
//  2) se le date NON sono compilate, il sito controlla ogni 10 minuti (/api/offerta) che la pagina DEWALT risponda:
//     se DEWALT la toglie o la mette in "offerta terminata", la copertina sparisce da sola.
// Con "inizio" compilato, prima dell'apertura copertina e barra mostrano "Aprono tra …" e all'ora giusta passano da sole a "attiva ora".
// Per una nuova offerta basta cambiare "inizio" e "scade" (ed eventualmente i testi). Per spegnerla a mano: attiva:false.
export const OFFERTA = {
  attiva: false, // spenta il 19/11/2026 a fine Flash Offer
  url: 'https://semi.flashoffer.it/',
  titolo: 'Flash Offer',
  sottotitolo: 'Oltre 800 prodotti con sconti fino al 60%. Approfittane, è solo per tre giorni!',
  marchi: ['DEWALT', 'USAG', 'STANLEY', 'BLACK+DECKER'],
  sconto: '-60%', // testo del bollino rosso ("fino al")
  inizio: '2026-11-17T08:30', // es. '2026-11-20T10:00' (ora italiana). Prima di quest'ora la copertina mostra il conto alla rovescia all'apertura
  scade: '2026-11-19T18:30', // es. '2026-11-30T23:59' (ora italiana). Vuoto = resta finché la pagina DEWALT è online
};

// "scade" in ora italiana (gestisce ora solare/legale) -> millisecondi; 0 se non impostata
export const scadenzaMs = (s = OFFERTA.scade) => oraRoma(s);
export const inizioMs = (s = OFFERTA.inizio) => oraRoma(s);
function oraRoma(s) {
  if (!s) return 0;
  if (/[zZ]|[+-]\d\d:\d\d$/.test(s)) return Date.parse(s);
  const utc = Date.parse(s + 'Z');
  const roma = new Date(new Date(utc).toLocaleString('en-US', { timeZone: 'Europe/Rome' }));
  const qui = new Date(new Date(utc).toLocaleString('en-US', { timeZone: 'UTC' }));
  return utc - (roma - qui);
}

// Al momento del build l'offerta è da mostrare? (date note e non ancora scaduta) -> la copertina esce già nell'HTML,
// così la pagina non "salta" quando lo script la mostra. Alla scadenza la nasconde lo script.
export const visibileAlBuild = () => !!(OFFERTA.attiva && OFFERTA.inizio && OFFERTA.scade && Date.now() < scadenzaMs());
