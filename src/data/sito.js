// Dati dell'azienda: modificare qui, si aggiornano in tutto il sito.
// Valori presi dal vecchio sito semistore.it: CONFERMARE prima di andare online.
export const SITO = {
  nome: 'Semi Store',
  ragioneSociale: 'Se.Mi. srl',
  piva: '07149740636',
  indirizzo: 'Viale G. Marconi 225',
  cap: '80020',
  citta: 'Casavatore',
  provincia: 'NA',
  telefono: '081 553 6604',
  telefonoLink: '+390815536604',
  whatsapp: '', // es. '39333xxxxxxx' (senza +). Vuoto = pulsante nascosto
  email: 'info@semistore.it',
  orari: [
    // { giorni: 'Lun–Ven', ore: '8:30–13:00 · 15:30–19:30' },
    // { giorni: 'Sab', ore: '8:30–13:00' },
  ],
  instagram: 'https://www.instagram.com/semistore.it',
  facebook: 'https://www.facebook.com/profile.php?id=61555435472986',
  spedizione: { costo: 990, gratisDa: 9900, giorni: '2–4' }, // centesimi
  url: 'https://semistore.it',
};

export const euro = (cent) =>
  new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(cent / 100);
