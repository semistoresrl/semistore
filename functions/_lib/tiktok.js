// Client minimo per la TikTok Shop Open API (versione 202309).
// Variabili Cloudflare: TIKTOK_APP_KEY, TIKTOK_APP_SECRET (Secret), TIKTOK_SERVICE_ID.
// I token del negozio stanno nel database D1 (tabella impostazioni), non nelle variabili.
import { getImp, setImp } from './db.js';

const API = 'https://open-api.tiktokglobalshop.com';
const AUTH = 'https://auth.tiktok-shops.com';
const enc = new TextEncoder();

async function hmacHex(secret, testo) {
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const s = await crypto.subtle.sign('HMAC', k, enc.encode(testo));
  return [...new Uint8Array(s)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Firma: secret + path + (chiavi ordinate + valori, esclusi sign e access_token) + body (se non multipart) + secret
export async function firma(secret, path, params, body = '') {
  const chiavi = Object.keys(params).filter((k) => k !== 'sign' && k !== 'access_token').sort();
  const base = secret + path + chiavi.map((k) => k + params[k]).join('') + body + secret;
  return hmacHex(secret, base);
}

// Verifica firma dei webhook: HMAC-SHA256(app_secret, app_key + body grezzo), header Authorization
export async function verificaWebhook(env, corpo, header) {
  if (!header) return false;
  const atteso = await hmacHex(env.TIKTOK_APP_SECRET, env.TIKTOK_APP_KEY + corpo);
  if (atteso.length !== header.length) return false;
  let d = 0; for (let i = 0; i < atteso.length; i++) d |= atteso.charCodeAt(i) ^ header.charCodeAt(i);
  return d === 0;
}

export const configurato = (env) => !!(env.TIKTOK_APP_KEY && env.TIKTOK_APP_SECRET && env.DB);

// ---- token ----
async function salvaToken(env, d) {
  const prev = (await getImp(env, 'tiktok_token')) || {};
  const t = {
    ...prev,
    access_token: d.access_token, access_exp: Number(d.access_token_expire_in) || 0,
    refresh_token: d.refresh_token, refresh_exp: Number(d.refresh_token_expire_in) || 0,
    seller_name: d.seller_name || prev.seller_name || '', aggiornato: new Date().toISOString(),
  };
  await setImp(env, 'tiktok_token', t);
  return t;
}

export async function tokenDaCodice(env, code) {
  const u = `${AUTH}/api/v2/token/get?app_key=${encodeURIComponent(env.TIKTOK_APP_KEY)}&app_secret=${encodeURIComponent(env.TIKTOK_APP_SECRET)}&auth_code=${encodeURIComponent(code)}&grant_type=authorized_code`;
  const r = await (await fetch(u)).json();
  if (r.code !== 0 || !r.data?.access_token) throw new Error('TikTok token: ' + (r.message || 'errore'));
  return salvaToken(env, r.data);
}

async function token(env) {
  let t = await getImp(env, 'tiktok_token');
  if (!t?.access_token) throw new Error('TikTok Shop non collegato: apri /api/tiktok/collega');
  const ora = Math.floor(Date.now() / 1000);
  if (t.access_exp && t.access_exp - ora < 86400) { // rinnova un giorno prima della scadenza
    const u = `${AUTH}/api/v2/token/refresh?app_key=${encodeURIComponent(env.TIKTOK_APP_KEY)}&app_secret=${encodeURIComponent(env.TIKTOK_APP_SECRET)}&refresh_token=${encodeURIComponent(t.refresh_token)}&grant_type=refresh_token`;
    const r = await (await fetch(u)).json();
    if (r.code !== 0 || !r.data?.access_token) throw new Error('Rinnovo token TikTok fallito: ricollega il negozio (' + (r.message || '') + ')');
    t = await salvaToken(env, r.data);
  }
  return t;
}

// ---- chiamate ----
// opts: { query, body (oggetto JSON), form (FormData), negozio: true se serve shop_cipher }
export async function chiama(env, metodo, path, opts = {}) {
  const t = await token(env);
  const q = { app_key: env.TIKTOK_APP_KEY, timestamp: String(Math.floor(Date.now() / 1000)), ...(opts.query || {}) };
  if (opts.negozio !== false && path !== '/authorization/202309/shops') {
    if (!t.shop_cipher) throw new Error('Negozio TikTok non ancora letto: apri /api/tiktok/stato');
    q.shop_cipher = t.shop_cipher;
  }
  for (const k of Object.keys(q)) if (q[k] === undefined || q[k] === null || q[k] === '') delete q[k]; else q[k] = String(q[k]);
  const corpo = opts.body ? JSON.stringify(opts.body) : '';
  q.sign = await firma(env.TIKTOK_APP_SECRET, path, q, opts.form ? '' : corpo);
  const headers = { 'x-tts-access-token': t.access_token };
  if (!opts.form) headers['content-type'] = 'application/json';
  const r = await fetch(`${API}${path}?${new URLSearchParams(q)}`, { method: metodo, headers, body: opts.form || (metodo === 'GET' ? undefined : corpo || '{}') });
  let j; try { j = await r.json(); } catch { throw new Error(`TikTok ${path}: risposta non valida (HTTP ${r.status})`); }
  if (j.code !== 0) { const e = new Error(`TikTok ${path}: ${j.message || 'errore'} (codice ${j.code})`); e.tiktok = j; throw e; }
  return j.data || {};
}

// Legge il negozio autorizzato (shop_cipher) e lo salva
export async function leggiNegozio(env) {
  const d = await chiama(env, 'GET', '/authorization/202309/shops', { negozio: false });
  const s = (d.shops || []).find((x) => x.region === 'IT') || (d.shops || [])[0];
  if (!s) throw new Error('Nessun negozio TikTok autorizzato per questa app');
  const t = await getImp(env, 'tiktok_token');
  await setImp(env, 'tiktok_token', { ...t, shop_cipher: s.cipher, shop_id: s.id, shop_name: s.name, region: s.region });
  return s;
}

export async function magazzino(env) {
  const salvato = await getImp(env, 'tiktok_magazzino');
  if (salvato) return salvato;
  const d = await chiama(env, 'GET', '/logistics/202309/warehouses');
  const w = (d.warehouses || []).filter((x) => x.type === 'SALES_WAREHOUSE');
  const scelto = w.find((x) => x.is_default) || w[0];
  if (!scelto) throw new Error('Nessun magazzino di vendita su TikTok: crealo in Seller Center → Impostazioni → Magazzini');
  await setImp(env, 'tiktok_magazzino', scelto.id);
  return scelto.id;
}

// Carica una foto (scaricata dall'URL) e restituisce l'uri TikTok
export async function caricaFoto(env, url) {
  const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (semistore.it)' } });
  if (!r.ok) throw new Error('foto non scaricabile: ' + url);
  const tipo = r.headers.get('content-type') || 'image/jpeg';
  const est = tipo.includes('webp') ? 'webp' : tipo.includes('png') ? 'png' : 'jpg';
  const f = new FormData();
  f.append('data', new Blob([await r.arrayBuffer()], { type: tipo }), `foto.${est}`);
  f.append('use_case', 'MAIN_IMAGE');
  const d = await chiama(env, 'POST', '/product/202309/images/upload', { form: f, negozio: false });
  return d.uri;
}

export const categoriaConsigliata = async (env, titolo) =>
  (await chiama(env, 'POST', '/product/202309/categories/recommend', { body: { product_title: titolo } })).leaf_category_id;

const pulisci = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export async function marchio(env, categoria, nome) {
  const d = await chiama(env, 'GET', '/product/202309/brands', { query: { category_id: categoria, brand_name: nome, page_size: 50 } });
  const b = (d.brands || []).find((x) => pulisci(x.name) === pulisci(nome));
  if (!b) throw new Error(`Marchio ${nome} non trovato su TikTok per questa categoria`);
  if (b.authorized_status && b.authorized_status !== 'AUTHORIZED') throw new Error(`Marchio ${nome} non ancora autorizzato: serve la Brand Qualification in Seller Center`);
  return b.id;
}

export const attributi = async (env, categoria) =>
  (await chiama(env, 'GET', `/product/202309/categories/${categoria}/attributes`)).attributes || [];
