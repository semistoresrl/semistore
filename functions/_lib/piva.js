// Partita IVA italiana: controllo delle cifre e ricerca automatica dei dati sul servizio VIES della Commissione europea
// (gratuito, ufficiale): ragione sociale e indirizzo della sede. Risultati in cache 30 giorni (KV RICHIESTE).
export function pivaValida(p) {
  if (!/^\d{11}$/.test(p) || /^0{11}$/.test(p)) return false;
  let s = 0;
  for (let i = 0; i < 10; i++) {
    let n = Number(p[i]);
    if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
    s += n;
  }
  return (10 - (s % 10)) % 10 === Number(p[10]);
}

const titolo = (t) => t.toLowerCase().replace(/(^|[\s'.\-/(])([a-zà-ù])/g, (m, a, b) => a + b.toUpperCase())
  .replace(/\b(S\.?r\.?l\.?s?|S\.?p\.?a\.?|S\.?n\.?c\.?|S\.?a\.?s\.?)(?=\s|$)/gi, (m) => m.toUpperCase())
  .replace(/(?<=\s)(A|Di|De|Del|Della|Dei|Delle|In|Sul|Su|E)(?=\s)/g, (m) => m.toLowerCase());

export function leggiIndirizzo(a) {
  const righe = String(a || '').split('\n').map((x) => x.trim()).filter(Boolean);
  const out = { indirizzo: '', cap: '', citta: '', provincia: '' };
  const k = righe.findIndex((r) => /^\d{5}\s/.test(r));
  if (k >= 0) {
    const m = righe[k].match(/^(\d{5})\s+(.+?)(?:\s+([A-Z]{2}))?$/);
    if (m) { out.cap = m[1]; out.citta = titolo(m[2]); out.provincia = m[3] || ''; }
    out.indirizzo = titolo(righe.slice(0, k).join(' '));
  } else out.indirizzo = titolo(righe.join(' '));
  return out;
}

export async function cercaPiva(env, piva) {
  if (!pivaValida(piva)) return { valida: false };
  const chiave = 'piva:' + piva;
  if (env.RICHIESTE) { const c = await env.RICHIESTE.get(chiave, 'json'); if (c) return c; }
  try {
    const r = await fetch(`https://ec.europa.eu/taxation_customs/vies/rest-api/ms/IT/vat/${piva}`, { headers: { accept: 'application/json' }, cf: { cacheTtl: 0 } });
    if (!r.ok) return { valida: true, trovata: false, errore: 'servizio' };
    const j = await r.json();
    if (!j.isValid) return { valida: true, attiva: false, trovata: false };
    const nome = j.name && j.name !== '---' ? j.name.trim() : '';
    const out = { valida: true, attiva: true, trovata: !!nome, ragioneSociale: nome, ...leggiIndirizzo(j.address) };
    if (env.RICHIESTE) await env.RICHIESTE.put(chiave, JSON.stringify(out), { expirationTtl: 30 * 86400 });
    return out;
  } catch { return { valida: true, trovata: false, errore: 'servizio' }; }
}
