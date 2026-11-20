// Precompilazione automatica dei moduli del sito.
// 1) Se il cliente è entrato nel suo account, i campi con data-pf="nome|email|telefono|indirizzo|cap|citta|provincia|cf|ordine"
//    si riempiono con i suoi dati. 2) Altrimenti si usano i dati scritti l'ultima volta su questo dispositivo (localStorage).
// 3) Il CAP suggerisce città e provincia. Non sovrascrive mai quello che il cliente ha già scritto.
const CHIAVE = 'semi-dati-v1';
let cacheIo;

// dati dell'account (solo quelli che servono ai moduli), tenuti 5 minuti in questa scheda del browser
export function utente() {
  if (cacheIo) return cacheIo;
  cacheIo = (async () => {
    try {
      const s = sessionStorage.getItem('semi-io');
      if (s) { const j = JSON.parse(s); if (Date.now() - j.t < 5 * 60e3) return j.d; }
    } catch {}
    try {
      const r = await fetch('/api/account/io', { cache: 'no-store' });
      if (!r.ok) return null;
      const d = daAccount(await r.json());
      try { sessionStorage.setItem('semi-io', JSON.stringify({ t: Date.now(), d })); } catch {}
      return d;
    } catch { return null; }
  })();
  return cacheIo;
}
export const dimenticaCache = () => { cacheIo = undefined; try { sessionStorage.removeItem('semi-io'); } catch {} };

function daAccount(io) {
  const p = io?.collegato && io.profilo;
  if (!p) return null;
  return {
    nome: p.tipo === 'azienda' ? p.ragioneSociale : [p.nome, p.cognome].filter(Boolean).join(' '),
    email: p.email, telefono: p.telefono, indirizzo: p.indirizzo, cap: p.cap, citta: p.citta, provincia: p.provincia,
    cf: p.tipo === 'azienda' ? p.piva : p.cf, ordine: io.ordini?.[0]?.id,
  };
}
const locali = () => { try { return JSON.parse(localStorage.getItem(CHIAVE) || '{}'); } catch { return {}; } };

function metti(el, v) {
  if (v == null || v === '' || el.value) return;
  el.value = v;
  el.dataset.pfAuto = '1';
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

export async function precompila(root = document) {
  const campi = [...root.querySelectorAll('[data-pf]')];
  if (!campi.length) return;
  const loc = locali();
  for (const el of campi) metti(el, loc[el.dataset.pf]); // subito, senza aspettare la rete
  const acc = (await utente()) || {};
  for (const el of campi) {
    const v = acc[el.dataset.pf];
    if (v && (!el.value || el.dataset.pfAuto)) { el.value = ''; metti(el, v); }
  }
}

// ricorda sul dispositivo quello che il cliente ha scritto (solo i campi data-pf, mai pagamenti o codici)
export function ricorda(form) {
  const loc = locali();
  for (const el of form.querySelectorAll('[data-pf]')) if (el.value && el.dataset.pf !== 'ordine') loc[el.dataset.pf] = el.value.trim();
  try { localStorage.setItem(CHIAVE, JSON.stringify(loc)); } catch {}
}

// CAP → città e provincia (con elenco di suggerimenti se il CAP copre più località)
export function capAutomatico(root = document) {
  for (const cap of root.querySelectorAll('input[autocomplete="postal-code"]')) {
    const form = cap.form || root;
    const citta = form.querySelector('input[autocomplete="address-level2"]');
    const prov = form.querySelector('input[autocomplete="address-level1"]');
    if (!citta) continue;
    let ultimo = '';
    cap.addEventListener('input', async () => {
      const c = cap.value.replace(/\D/g, '');
      if (c.length !== 5 || c === ultimo) return;
      ultimo = c;
      try {
        const j = await (await fetch('/api/cap?c=' + c)).json();
        if (!j.luoghi?.length) return;
        let dl = document.getElementById('dl-' + (citta.name || 'citta'));
        if (!dl) { dl = document.createElement('datalist'); dl.id = 'dl-' + (citta.name || 'citta'); document.body.append(dl); citta.setAttribute('list', dl.id); }
        dl.innerHTML = j.luoghi.map((l) => `<option value="${l.citta.replace(/"/g, '')}">`).join('');
        if (!citta.value || citta.dataset.pfAuto) { citta.value = j.luoghi[0].citta; citta.dataset.pfAuto = '1'; citta.dispatchEvent(new Event('input', { bubbles: true })); }
        if (prov && (!prov.value || prov.dataset.pfAuto)) { prov.value = j.luoghi[0].provincia; prov.dataset.pfAuto = '1'; }
      } catch {}
    });
  }
}
