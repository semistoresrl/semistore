// Canali senza collegamento automatico: sito, WhatsApp, telefono, negozio, e qualsiasi marketplace aggiunto "senza API"
// (es. ManoMano finché non dà le chiavi). Evadere = etichetta col nostro corriere; per un marketplace l'app apre la sua pagina ordini
// e prepara il tracking da incollare.
import { creaEtichetta } from './corriere.js';

export async function evadi(env, ordine, opz = {}) {
  const et = opz.etichetta || (await creaEtichetta(env, opz.conti?.corriere, ordine, opz));
  const m = opz.mercato;
  if (et.indirizzo && !opz.tracking) return { ...et, daConfermare: true, nota: 'Scrivi il tracking dopo aver consegnato il pacco' };
  return { ...et, tracking: opz.tracking || et.tracking, corriere: opz.corriere || et.corriere,
    nota: m ? `Ora segna l'ordine come spedito su ${m.nome} incollando il tracking` : 'Etichetta pronta', apri: m?.pannello || '' };
}
