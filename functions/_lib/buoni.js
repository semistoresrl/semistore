// Buoni Semi Store: buoni regalo (comprati sul sito, senza scadenza, su tutto il sito) e buoni punti (dai Punti Semi,
// senza scadenza, solo sui prodotti del Catalogo Premi). Codice segreto SEMI-XXXX-XXXX-XXXX: nel database c'è solo
// l'impronta (hash) per cercarlo e le ultime 4 cifre per mostrarlo; il codice intero esiste solo nelle email.
// Il saldo si usa anche in più volte. Durante il pagamento l'importo è "prenotato" per 45 minuti.
import { dbc, hash } from './clienti.js';

const ALFA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function nuovoCodice() {
  const b = crypto.getRandomValues(new Uint8Array(12));
  const c = [...b].map((x) => ALFA[x % ALFA.length]).join('');
  return `SEMI-${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8, 12)}`;
}
export const normCodice = (c) => {
  const s = String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const r = s.startsWith('SEMI') ? s.slice(4) : s;
  return r.length === 12 ? `SEMI-${r.slice(0, 4)}-${r.slice(4, 8)}-${r.slice(8, 12)}` : '';
};
export const PRENOTA_MIN = 45;

let pronto = false;
export async function dbb(env) {
  const d = await dbc(env);
  if (!pronto) {
    await d.batch([
      d.prepare(`CREATE TABLE IF NOT EXISTS buoni (
        id TEXT PRIMARY KEY, h TEXT UNIQUE NOT NULL, fine TEXT, tipo TEXT NOT NULL,
        importo INTEGER NOT NULL, saldo INTEGER NOT NULL, cliente TEXT,
        acquirente TEXT, destinatario TEXT, email_dest TEXT, messaggio TEXT, tema TEXT, mittente TEXT,
        sessione TEXT UNIQUE, creato TEXT, stato TEXT NOT NULL DEFAULT 'attivo')`),
      d.prepare('CREATE INDEX IF NOT EXISTS b_cliente ON buoni(cliente)'),
      d.prepare(`CREATE TABLE IF NOT EXISTS buoni_prenotati (
        sessione TEXT NOT NULL, buono TEXT NOT NULL, importo INTEGER NOT NULL, scade INTEGER NOT NULL, PRIMARY KEY (sessione, buono))`),
      d.prepare(`CREATE TABLE IF NOT EXISTS buoni_mov (
        id TEXT PRIMARY KEY, buono TEXT NOT NULL, delta INTEGER NOT NULL, motivo TEXT, quando TEXT)`),
    ]);
    try { await d.prepare('ALTER TABLE ordini ADD COLUMN base INTEGER').run(); } catch {}
    try { await d.prepare('ALTER TABLE buoni ADD COLUMN pi TEXT').run(); } catch {} // pagamento Stripe del buono regalo (per i rimborsi)
    pronto = true;
  }
  return d;
}

export async function crea(env, { tipo, importo, cliente = null, acquirente = null, destinatario = null, emailDest = null, messaggio = null, tema = null, mittente = null, sessione = null, pi = null }) {
  const d = await dbb(env);
  const codice = nuovoCodice(), id = 'B' + crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();
  await d.prepare(`INSERT INTO buoni(id,h,fine,tipo,importo,saldo,cliente,acquirente,destinatario,email_dest,messaggio,tema,mittente,sessione,creato)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(id, await hash(codice), codice.slice(-4), tipo, importo, importo, cliente, acquirente, destinatario, emailDest, messaggio, tema, mittente, sessione, new Date().toISOString()).run();
  if (pi) await d.prepare('UPDATE buoni SET pi=? WHERE id=?').bind(pi, id).run();
  await d.prepare('INSERT INTO buoni_mov(id,buono,delta,motivo,quando) VALUES(?,?,?,?,?)').bind(id + ':0', id, importo, tipo === 'punti' ? 'Conversione punti' : 'Acquisto buono regalo', new Date().toISOString()).run();
  return { id, codice };
}

export async function perCodice(env, codice) {
  const c = normCodice(codice);
  if (!c) return null;
  return await (await dbb(env)).prepare('SELECT * FROM buoni WHERE h=?').bind(await hash(c)).first();
}

// saldo meno le prenotazioni ancora valide di altri pagamenti
export async function disponibile(env, b, tranneSessione = '') {
  const r = await (await dbb(env)).prepare('SELECT COALESCE(SUM(importo),0) AS p FROM buoni_prenotati WHERE buono=? AND scade>? AND sessione<>?')
    .bind(b.id, Date.now(), tranneSessione).first();
  return Math.max(0, b.saldo - Number(r?.p || 0));
}

export async function prenota(env, sessione, usi) {
  const d = await dbb(env), scade = Date.now() + PRENOTA_MIN * 60e3;
  for (const u of usi) await d.prepare('INSERT OR REPLACE INTO buoni_prenotati(sessione,buono,importo,scade) VALUES(?,?,?,?)').bind(sessione, u.id, u.importo, scade).run();
}

// pagamento riuscito: scala il saldo una volta sola
export async function conferma(env, sessione, ordineId) {
  const d = await dbb(env);
  const pr = (await d.prepare('SELECT * FROM buoni_prenotati WHERE sessione=?').bind(sessione).all()).results;
  for (const p of pr) {
    const r = await d.prepare('INSERT OR IGNORE INTO buoni_mov(id,buono,delta,motivo,quando) VALUES(?,?,?,?,?)')
      .bind(`${p.buono}:${sessione}`, p.buono, -p.importo, `Ordine ${ordineId}`, new Date().toISOString()).run();
    if (r.meta.changes) await d.prepare("UPDATE buoni SET saldo = MAX(0, saldo - ?), stato = CASE WHEN saldo - ? <= 0 THEN 'esaurito' ELSE stato END WHERE id=?").bind(p.importo, p.importo, p.buono).run();
  }
  await d.prepare('DELETE FROM buoni_prenotati WHERE sessione=?').bind(sessione).run();
  return pr;
}

export const pubblico = (b, disp) => ({
  id: b.id, fine: b.fine, tipo: b.tipo, importo: b.importo, saldo: b.saldo, disponibile: disp ?? b.saldo,
  soloPremi: b.tipo === 'punti', destinatario: b.destinatario, mittente: b.mittente, creato: b.creato, stato: b.stato,
});

// Ordine rimborsato (anche in parte): restituisce ai buoni usati la stessa quota rimborsata. quota = rimborsato / pagato (cumulativa).
export async function ripristina(env, sessione, quota) {
  const d = await dbb(env);
  const usati = (await d.prepare("SELECT buono, -delta AS usato FROM buoni_mov WHERE id = buono || ':' || ? AND delta < 0").bind(sessione).all()).results;
  const out = [];
  for (const u of usati) {
    const dovuto = Math.min(u.usato, Math.round(u.usato * Math.min(1, quota)));
    const gia = await d.prepare('SELECT COALESCE(SUM(delta),0) AS t FROM buoni_mov WHERE buono=? AND id LIKE ?').bind(u.buono, `ripr:${u.buono}:${sessione}:%`).first();
    const x = dovuto - Number(gia?.t || 0);
    if (x <= 0) continue;
    const r = await d.prepare('INSERT OR IGNORE INTO buoni_mov(id,buono,delta,motivo,quando) VALUES(?,?,?,?,?)')
      .bind(`ripr:${u.buono}:${sessione}:${dovuto}`, u.buono, x, `Rimborso ordine ${sessione.slice(-8).toUpperCase()}`, new Date().toISOString()).run();
    if (r.meta.changes) { await d.prepare("UPDATE buoni SET saldo = MIN(importo, saldo + ?), stato = 'attivo' WHERE id=? AND stato<>'annullato'").bind(x, u.buono).run(); out.push({ buono: u.buono, importo: x }); }
  }
  return out;
}

// Pagamento di un buono regalo rimborsato: toglie dal saldo la parte rimborsata; se è tutto, il buono è annullato.
export async function annullaRimborsato(env, pi, rimborsato) {
  const d = await dbb(env);
  const b = await d.prepare("SELECT * FROM buoni WHERE pi=? AND tipo='regalo'").bind(pi).first();
  if (!b) return null;
  const gia = await d.prepare('SELECT COALESCE(-SUM(delta),0) AS t FROM buoni_mov WHERE buono=? AND id LIKE ?').bind(b.id, `rimbb:${b.id}:%`).first();
  const x = Math.min(b.saldo, rimborsato - Number(gia?.t || 0));
  if (x > 0) {
    await d.prepare('INSERT OR IGNORE INTO buoni_mov(id,buono,delta,motivo,quando) VALUES(?,?,?,?,?)').bind(`rimbb:${b.id}:${rimborsato}`, b.id, -x, 'Rimborso del buono', new Date().toISOString()).run();
    await d.prepare('UPDATE buoni SET saldo = MAX(0, saldo - ?) WHERE id=?').bind(x, b.id).run();
  }
  if (rimborsato >= b.importo) await d.prepare("UPDATE buoni SET stato='annullato', saldo=0 WHERE id=?").bind(b.id).run();
  return b;
}
