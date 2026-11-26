// Parti comuni del pannello unico ordini/spedizioni (Ordini online → Evadi e stampa).
// - conti dei marketplace e del corriere, salvati in D1 (impostazioni "mp_conti"), mai restituiti in chiaro all'app
// - ordini dei marketplace → "Ordini online" dell'app (collezione ordiniWeb), senza doppioni
// - "evaso": l'ordine passa a Pronto (etichetta stampata, in attesa del corriere), con tracking, e scala il magazzino dell'app
import { gdb } from '../gestione.js';
import { db, getImp, setImp, movimento } from '../db.js';
import { muovi, prossimoNumero } from '../tiktok-app.js';
import { indiceGiacenze } from '../tiktok-dati.js';

export const eur = (v) => Math.round((Number(v) || 0) * 100) / 100;
const jp = (s) => { try { return JSON.parse(s || 'null'); } catch { return null; } };

// ---------- conti ----------
// mp_conti = { corriere:{...}, ebay:{...}, amazon:{...}, mercati:[{id,nome,tipo:'mirakl'|'manuale',url,apiKey,pannello,...}] }
export async function conti(env) { return (await getImp(env, 'mp_conti')) || {}; }
export async function salvaConti(env, c) { await setImp(env, 'mp_conti', c); }
// i campi segreti non tornano mai all'app: al loro posto "••••1234"
const SEGRETI = ['apiKey', 'clientSecret', 'refreshToken', 'secretKey', 'password'];
export const maschera = (o) => {
  if (Array.isArray(o)) return o.map(maschera);
  if (!o || typeof o !== 'object') return o;
  const out = {};
  for (const [k, v] of Object.entries(o)) out[k] = SEGRETI.includes(k) && v ? '••••' + String(v).slice(-4) : maschera(v);
  return out;
};
// unisce i dati arrivati dall'app: un segreto lasciato mascherato o vuoto resta quello salvato
export function unisciConto(prima = {}, dopo = {}) {
  const out = { ...prima };
  for (const [k, v] of Object.entries(dopo || {})) {
    if (SEGRETI.includes(k) && (v === '' || v == null || String(v).startsWith('••••'))) continue;
    out[k] = typeof v === 'string' ? v.trim() : v;
  }
  return out;
}

// ---------- archivio dell'app ----------
export async function leggiOrdine(env, id) {
  const d = await gdb(env);
  const r = await d.prepare("SELECT id, d FROM docs WHERE c='ordiniWeb' AND id=?").bind(String(id)).first();
  return r ? { id: r.id, ...jp(r.d) } : null;
}
async function scrivi(d, id, g, chi, op = 'aggiorna') {
  const now = Date.now();
  g.updatedAt = now;
  await d.batch([
    d.prepare('INSERT INTO docs(c,id,d,u,chi) VALUES(?,?,?,?,?) ON CONFLICT(c,id) DO UPDATE SET d=excluded.d, u=excluded.u, chi=excluded.chi')
      .bind('ordiniWeb', id, JSON.stringify(g), now, chi),
    d.prepare('INSERT INTO registro(at,chi,nome,c,docid,op,d) VALUES(?,?,?,?,?,?,?)')
      .bind(now, chi, chi, 'ordiniWeb', id, op, JSON.stringify({ num: g.num, stato: g.stato, tracking: g.tracking || null }).slice(0, 4000)),
  ]);
}

const SCALATO = ['Pronto', 'Spedito', 'Consegnato'];
// per gli ordini TikTok vale la regola già in uso: si scala solo per gli ordini nati dopo il primo invio dell'inventario
async function muoveMag(env, o) {
  if (o.canale !== 'tiktok') return true;
  const da = await getImp(env, 'tiktok_scarico_da').catch(() => null);
  return !!da && (Number(o.at) || 0) >= Number(da);
}

// Ordine evaso dal pannello: patch = { tracking, corriere, trackUrl, etichetta:{...}, mp:{...} }
export async function segnaEvaso(env, id, patch, chi = 'Spedizioni') {
  const d = await gdb(env);
  const o = await leggiOrdine(env, id);
  if (!o) throw new Error('ordine non trovato');
  const { id: _, ...g } = o;
  const now = Date.now();
  Object.assign(g, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined && v !== '')));
  g.evaso = { ...(o.evaso || {}), at: o.evaso?.at || now, ultimo: now, da: chi, ...(patch.evaso || {}) };
  delete g.evasoInCorso;
  if (!['Spedito', 'Consegnato', 'Annullato'].includes(g.stato) && g.stato !== 'Pronto') {
    g.stato = 'Pronto';
    g.storico = [...(g.storico || []), { at: now, stato: 'Pronto', by: null, da: 'Etichetta stampata' }];
  }
  if (!g.scaricato && SCALATO.includes(g.stato) && (await muoveMag(env, g))) {
    for (const r of g.righe || []) if ((Number(r.qty) || 0) > 0) await muovi(d, r.codice, -Number(r.qty), 'vendita ' + String(g.canaleNome || g.canale || 'online').toLowerCase(), g.num, chi);
    g.scaricato = true;
  }
  await scrivi(d, id, g, chi, 'evaso');
  return { id, ...g };
}

// Ordini consegnati al corriere (dalla distinta): Pronto → Spedito
export async function segnaSpediti(env, ids, chi) {
  const d = await gdb(env); const out = [];
  for (const id of ids) {
    const o = await leggiOrdine(env, id); if (!o || o.stato !== 'Pronto') continue;
    const { id: _, ...g } = o; const now = Date.now();
    g.stato = 'Spedito'; g.speditoAt = g.speditoAt || now;
    g.storico = [...(g.storico || []), { at: now, stato: 'Spedito', by: null, da: 'Consegnato al corriere' }];
    await scrivi(d, id, g, chi, 'spedito'); out.push(id);
  }
  return out;
}

// ---------- ordini dei marketplace nell'app ----------
// x = { canale, canaleNome, rif, at, stato, cliente, tel, email, ind, cap, citta, prov, paese, righe:[{codice,descr,qty,prezzo,lineId}],
//       totale, spedizione, metodo, mp:{...dati per evadere}, annullato }
// Le modifiche fatte a mano nell'app (note, cliente, indirizzo) non vengono sovrascritte: dal marketplace si aggiornano stato e dati tecnici.
export async function ordineMpInApp(env, x) {
  const d = await gdb(env);
  const id = x.canale + '-' + String(x.rif).replace(/[^\w.-]/g, '_');
  let row = await d.prepare("SELECT id, d FROM docs WHERE c='ordiniWeb' AND id=?").bind(id).first();
  if (!row) row = await d.prepare("SELECT id, d FROM docs WHERE c='ordiniWeb' AND json_extract(d,'$.canale')=? AND json_extract(d,'$.rif')=? LIMIT 1").bind(x.canale, String(x.rif)).first();
  const prima = jp(row?.d), docId = row?.id || id, now = Date.now();
  const sub = (x.righe || []).reduce((a, r) => a + (Number(r.qty) || 0) * (Number(r.prezzo) || 0), 0);
  let g, nuovo = false;
  if (!prima) {
    if (x.annullato) return null; // annullato prima di arrivare: non serve
    nuovo = true;
    const diff = eur((Number(x.totale) || sub) - sub - (Number(x.spedizione) || 0));
    g = { canale: x.canale, canaleNome: x.canaleNome, rif: String(x.rif), num: await prossimoNumero(d, x.at || now), at: x.at || now,
      stato: x.stato || 'Confermato', cliente: x.cliente || 'Cliente ' + (x.canaleNome || x.canale), tel: x.tel || '', email: x.email || '',
      ind: x.ind || '', cap: x.cap || '', citta: x.citta || '', prov: x.prov || '', paese: x.paese || 'IT', consegna: 'spedizione',
      righe: x.righe || [], spedizione: eur(x.spedizione), sconto: diff < 0 ? -diff : 0, pagato: true, pagatoAt: x.at || now, metodo: x.metodo || x.canaleNome,
      note: `Ordine ${x.canaleNome || x.canale} ${x.rif} (importato in automatico).`, scaricato: false,
      storico: [{ at: x.at || now, stato: x.stato || 'Confermato', by: null, da: x.canaleNome || x.canale }], mp: x.mp || {} };
  } else {
    g = { ...prima, mp: { ...(prima.mp || {}), ...(x.mp || {}) } };
    for (const k of ['tel', 'email', 'ind', 'cap', 'citta', 'prov']) if (!g[k] && x[k]) g[k] = x[k];
  }
  // stato dal marketplace: solo in avanti (o annullato)
  const ORD = ['Da confermare', 'Confermato', 'Pronto', 'Spedito', 'Consegnato'];
  let st = x.annullato ? 'Annullato' : x.stato;
  if (st && st !== g.stato && g.stato !== 'Annullato' && (st === 'Annullato' || ORD.indexOf(st) > ORD.indexOf(g.stato))) {
    g.stato = st; g.storico = [...(g.storico || []), { at: now, stato: st, by: null, da: x.canaleNome || x.canale }];
    if (st === 'Spedito' && !g.speditoAt) g.speditoAt = now;
    if (st === 'Consegnato' && !g.consegnatoAt) g.consegnatoAt = now;
  }
  if (x.tracking && !g.tracking) g.tracking = x.tracking;
  // giacenze ufficiali del sito (quelle che vanno su sito e TikTok): la vendita sul marketplace le scala subito, una volta sola
  await giacenzeUfficiali(env, g, docId).catch((e) => console.log('giacenze', docId, e.message));
  // magazzino dell'app: rientro se annullato dopo lo scarico
  if (g.stato === 'Annullato' && g.scaricato) {
    for (const r of g.righe || []) if ((Number(r.qty) || 0) > 0) await muovi(d, r.codice, +Number(r.qty), 'ordine annullato', g.num, x.canaleNome || x.canale);
    g.scaricato = false;
  }
  if (!nuovo && JSON.stringify(prima) === JSON.stringify({ ...g, updatedAt: prima.updatedAt })) return { id: docId, nuovo: false, cambiato: false };
  await scrivi(d, docId, g, x.canaleNome || x.canale, nuovo ? 'importa' : 'aggiorna');
  return { id: docId, nuovo, cambiato: true };
}

let _idx = null, _idxAt = 0;
async function giacenzeUfficiali(env, g, docId) {
  if (!_idx || Date.now() - _idxAt > 60000) { _idx = await indiceGiacenze(await db(env)); _idxAt = Date.now(); }
  for (const r of g.righe || []) {
    const t = _idx({ sellerSku: r.codice }); if (!t) continue;
    const q = Number(r.qty) || 0; if (!q) continue;
    await movimento(env, `${docId}|${r.codice}`, g.canale, t.r.slug, -q);
    if (g.stato === 'Annullato') await movimento(env, `${docId}|${r.codice}|annullo`, g.canale, t.r.slug, +q);
  }
}

// peso di un ordine: pesoKg degli articoli (giacenze del sito) + 0,3 kg di imballo; se non noto, il peso predefinito
export async function pesoOrdine(env, o, predefinito = 2) {
  try {
    const righe = (await (await db(env)).prepare("SELECT codice, json_extract(dati,'$.pesoKg') p FROM giacenze").all()).results;
    const norm = (c) => String(c || '').toUpperCase().replace(/-(QW|QZ|XJ|GB|LX|XE|KR)$/, '').replace(/[^A-Z0-9]/g, '');
    const m = new Map(righe.filter((r) => Number(r.p) > 0).map((r) => [norm(r.codice), Number(r.p)]));
    let kg = 0, ignoti = 0;
    for (const r of o.righe || []) { const p = m.get(norm(r.codice)); if (p) kg += p * (Number(r.qty) || 1); else ignoti++; }
    if (!kg) return predefinito;
    return Math.round((kg + 0.3 + ignoti * 1) * 100) / 100;
  } catch { return predefinito; }
}

// file (etichette) nella tabella files dell'app, per ristampare senza richiamare il marketplace
export async function salvaFile(env, id, tipo, nome, bytes, chi) {
  const d = await gdb(env);
  await d.prepare('INSERT INTO files(id,tipo,nome,dati,at,chi) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET tipo=excluded.tipo, nome=excluded.nome, dati=excluded.dati, at=excluded.at, chi=excluded.chi')
    .bind(id, tipo, nome, bytes, Date.now(), chi).run();
}
export async function leggiFile(env, id) {
  const d = await gdb(env);
  const r = await d.prepare('SELECT tipo, nome, dati FROM files WHERE id=?').bind(id).first();
  if (!r) return null;
  return { tipo: r.tipo, nome: r.nome, bytes: r.dati instanceof ArrayBuffer ? new Uint8Array(r.dati) : new Uint8Array(r.dati) };
}

export const b64 = (u8) => { let s = ''; const a = new Uint8Array(u8); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000)); return btoa(s); };
export const daB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const attendi = (ms) => new Promise((r) => setTimeout(r, ms));
// separa "Via Roma 12/B" in via e numero civico (i corrieri lo vogliono a parte)
export function viaCivico(ind) {
  const s = String(ind || '').trim();
  const m = s.match(/^(.*?)[,\s]+(\d+[A-Za-z]?(?:\s*[\/-]\s*\w+)?|snc|s\.n\.c\.)$/i);
  return m ? [m[1].trim(), m[2].replace(/\s+/g, '')] : [s, ''];
}
// fetch con messaggio d'errore leggibile
export async function chiamaJson(url, init = {}, nome = 'servizio') {
  const r = await fetch(url, init);
  const t = await r.text();
  let j = null; try { j = t ? JSON.parse(t) : {}; } catch {}
  if (!r.ok) {
    const msg = j?.errors?.[0]?.message || j?.errors?.[0]?.longMessage || j?.error?.message || j?.message || j?.error_description || (typeof j?.error === 'string' ? j.error : '') || t.slice(0, 200);
    const e = new Error(`${nome}: ${msg || 'errore'} (HTTP ${r.status})`); e.status = r.status; e.dati = j; throw e;
  }
  return j ?? {};
}
