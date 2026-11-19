// Dati dell'azienda: modificare qui, si aggiornano in tutto il sito.
// Valori presi dal vecchio sito semistore.it: CONFERMARE prima di andare online.
export const SITO = {
  nome: 'Semi Store',
  // Prima cosa da far leggere in titoli, anteprime dei link e testi (richiesta del cliente 19/11/2026)
  concessionario: 'Concessionario DEWALT Lazio, Campania, Molise',
  ragioneSociale: 'Se.Mi. srl',
  piva: '07149740636',
  // Dati legali (visura CCIAA): obbligatori sul sito per art. 2250 c.c. e art. 7 D.Lgs. 70/2003
  denominazione: 'SE.M.I. S.R.L.',
  sedeLegale: 'Centro Direzionale Isola E7, 80143 Napoli (NA)',
  rea: 'NA-583904',
  pec: 'semi@pec.it',
  capitaleSociale: '', // es. '10.000,00 € i.v.' — da inserire quando il cliente lo conferma (art. 2250 c.c.)
  indirizzo: 'Viale G. Marconi 225',
  cap: '80020',
  citta: 'Casavatore',
  provincia: 'NA',
  telefono: '081 553 6604',
  telefonoLink: '+390815536604',
  whatsapp: '393756266947', // es. '39333xxxxxxx' (senza +). Vuoto = pulsante nascosto
  email: 'info@semistore.it',
  // Orari presi dalla scheda Google Business il 16/11/2026: se cambiano lì, aggiornarli anche qui.
  orari: [
    { giorni: 'Lun–Ven', ore: '8:30–13:00 · 14:30–18:00' },
    { giorni: 'Sab–Dom', ore: 'Chiuso' },
  ],
  // Fasce per il calcolo "Aperto ora" (0 = domenica … 6 = sabato)
  fasce: {
    1: [['08:30', '13:00'], ['14:30', '18:00']],
    2: [['08:30', '13:00'], ['14:30', '18:00']],
    3: [['08:30', '13:00'], ['14:30', '18:00']],
    4: [['08:30', '13:00'], ['14:30', '18:00']],
    5: [['08:30', '13:00'], ['14:30', '18:00']],
  },
  // Scheda Google Business "SE.M.I. srl Professional"
  googlePlaceId: 'ChIJpQmSJREIOxMRsHBGmNErdn0',
  instagram: 'https://www.instagram.com/semistore.it',
  // Pagina in uso (18/11/2026): "Se.m.i srl concessionario…" (id 101931669444798), l'unica a cui il cliente ha accesso.
  // La pagina "semistore.it" (profile.php?id=61555435472986, 121 follower) per ora non si usa: se torna accessibile, valutare l'unione.
  facebook: 'https://www.facebook.com/101931669444798',
  tiktok: 'https://www.tiktok.com/@semistore.it',
  spedizione: { costo: 990, gratisDa: 9900, giorni: '2–4' }, // centesimi
  url: 'https://semistore.it',
  // Statistiche e pubblicità (partono solo dopo il consenso nel banner cookie). Vuoti = niente banner, niente script.
  ga4: '', // ID misurazione Google Analytics 4, es. 'G-XXXXXXXXXX'
  pixelMeta: '', // ID Pixel Meta (solo cifre)
};

export const GOOGLE = {
  // link della scheda Google fornito dal cliente (16/11/2026): da qui si leggono e si lasciano le recensioni
  scheda: 'https://www.google.com/maps/place/SE.M.I.+srl+Professional+vendita+e+assistenza+tecnica+BLACK%2BDECKER+DEWALT+STANLEY,+Viale+Guglielmo+Marconi,+225,+80020+Casavatore+NA/@40.8934602,14.2784996,15z/data=!4m6!3m5!1s0x133b0811259209a5:0x7d762bd1984670b0!8m2!3d40.8934602!4d14.2784996!16s%2Fg%2F1w9355gw',
  indicazioni: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${SITO.indirizzo}, ${SITO.cap} ${SITO.citta}`)}&destination_place_id=${SITO.googlePlaceId}`,
  // apre direttamente la finestra "scrivi una recensione" della scheda
  recensione: `https://search.google.com/local/writereview?placeid=${SITO.googlePlaceId}`,
  // mappa incorporata (non serve chiave)
  mappa: `https://maps.google.com/maps?q=${encodeURIComponent('SE.M.I. srl Professional, Viale Guglielmo Marconi 225, 80020 Casavatore NA')}&hl=it&z=17&output=embed`,
};

export const euro = (cent) =>
  new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(cent / 100);
