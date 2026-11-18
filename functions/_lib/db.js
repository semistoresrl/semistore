// Database D1 (binding "DB"): giacenze ufficiali, collegamento con TikTok Shop, impostazioni.
// Le tabelle si creano da sole alla prima chiamata.
let pronto = false;
export async function db(env) {
  if (!env.DB) throw new Error('database D1 non collegato (binding DB)');
  if (!pronto) {
    await env.DB.batch([
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS giacenze (
        slug TEXT PRIMARY KEY, codice TEXT, qty INTEGER NOT NULL DEFAULT 0, prezzo INTEGER,
        dati TEXT, aggiornata TEXT,
        tt_product TEXT, tt_sku TEXT, tt_stato TEXT, tt_errore TEXT,
        tt_qty INTEGER, tt_prezzo INTEGER, tt_da_sync INTEGER NOT NULL DEFAULT 0, tt_sync TEXT)`),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS g_sync ON giacenze(tt_da_sync)'),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS g_sku ON giacenze(tt_sku)'),
      env.DB.prepare('CREATE TABLE IF NOT EXISTS impostazioni (k TEXT PRIMARY KEY, v TEXT)'),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS movimenti (
        id TEXT PRIMARY KEY, canale TEXT, slug TEXT, qty INTEGER, quando TEXT)`),
    ]);
    pronto = true;
  }
  return env.DB;
}

export async function getImp(env, k) {
  const r = await (await db(env)).prepare('SELECT v FROM impostazioni WHERE k=?').bind(k).first();
  return r ? JSON.parse(r.v) : null;
}
export async function setImp(env, k, v) {
  await (await db(env)).prepare('INSERT INTO impostazioni(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').bind(k, JSON.stringify(v)).run();
}

// Scarico/carico di giacenza legato a un evento (ordine sito o TikTok): ogni id si applica una volta sola.
// delta negativo = vendita, positivo = annullo. Restituisce false se già registrato.
export async function movimento(env, id, canale, slug, delta) {
  const d = await db(env);
  const r = await d.prepare('INSERT OR IGNORE INTO movimenti(id,canale,slug,qty,quando) VALUES(?,?,?,?,?)')
    .bind(id, canale, slug, delta, new Date().toISOString()).run();
  if (!r.meta.changes) return false;
  // dopo una vendita sul sito TikTok va riallineato; dopo una vendita TikTok la sua giacenza è già giusta
  const allinea = canale === 'tiktok' ? 0 : 1;
  await d.prepare(`UPDATE giacenze SET qty = MAX(0, qty + ?), aggiornata = ?,
      tt_qty = CASE WHEN ? = 0 AND tt_qty IS NOT NULL THEN MAX(0, tt_qty + ?) ELSE tt_qty END,
      tt_da_sync = CASE WHEN ? = 1 AND tt_product IS NOT NULL THEN 1 ELSE tt_da_sync END
    WHERE slug = ?`).bind(delta, new Date().toISOString(), allinea, delta, allinea, slug).run();
  return true;
}

export const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
export const admin = (request, env) => !!env.ADMIN_TOKEN && request.headers.get('authorization') === `Bearer ${env.ADMIN_TOKEN}`;
