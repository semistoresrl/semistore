// Scarica (una volta sola) le foto prodotto dal vecchio sito e le converte
// in WebP leggeri in 2 misure. Le foto già presenti non vengono riscaricate.
// Consiglio: dopo il primo build riuscito, salvare la cartella public/img/prodotti
// nel repository, così il sito non dipende più dal vecchio server.
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import http from 'node:http';

// semistore.it ora punta al sito nuovo: le foto vecchie si chiedono al vecchio server (IONOS) per IP
const VECCHIO_IP = '194.164.162.85';
function dalVecchioServer(u) {
  return new Promise((ok) => {
    try {
      const url = new URL(u);
      const req = http.get({ host: VECCHIO_IP, path: url.pathname, headers: { host: 'semistore.it', 'user-agent': 'Mozilla/5.0 (SemiStore build)' }, timeout: 15000 }, (r) => {
        if (r.statusCode !== 200) { r.resume(); return ok(null); }
        const c = []; r.on('data', (d) => c.push(d)); r.on('end', () => ok(Buffer.concat(c)));
      });
      req.on('timeout', () => req.destroy()); req.on('error', () => ok(null));
    } catch { ok(null); }
  });
}
// Il vecchio sito ha il certificato HTTPS scaduto: lo accettiamo SOLO per scaricare le sue foto pubbliche.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const prodotti = JSON.parse(await fs.readFile('src/data/prodotti.json', 'utf8'));
const dir = 'public/img/prodotti';
await fs.mkdir(dir, { recursive: true });

const esiste = (f) => fs.access(f).then(() => true, () => false);
let ok = 0, salt = 0, ko = 0;

await Promise.all(prodotti.map(async (p) => {
  const big = path.join(dir, `${p.slug}-800.webp`);
  if (await esiste(big)) { salt++; return; }
  // prodotti importati dal listino: si usa direttamente la foto ufficiale, senza scaricarla
  if (p.soloLink) { salt++; return; }
  // prova prima una foto locale messa a mano (public/img/originali/<slug>.jpg|png)
  let buf = null;
  for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
    const f = `public/img/originali/${p.slug}.${ext}`;
    if (await esiste(f)) { buf = await fs.readFile(f); break; }
  }
  // poi la foto ufficiale DEWALT (fondo bianco), infine quella del vecchio sito
  const fonti = [];
  if (p.immagineDewalt) fonti.push(p.immagineDewalt);
  if (p.immagineOrigine) fonti.push(p.immagineOrigine.replace('http://', 'https://'), p.immagineOrigine);
  if (!buf && fonti.length) {
    for (const u of fonti) {
      try {
        const r = await fetch(u, { signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'Mozilla/5.0 (SemiStore build)' } });
        if (!r.ok) console.warn('Foto', p.slug, r.status, u);
        if (r.ok) { buf = Buffer.from(await r.arrayBuffer()); break; }
      } catch (e) { console.warn('Foto', p.slug, e.cause?.code || e.message); }
    }
  }
  if (!buf && p.immagineOrigine) buf = await dalVecchioServer(p.immagineOrigine);
  if (!buf) { ko++; return; }
  try {
    const base = sharp(buf).flatten({ background: '#ffffff' }).trim({ threshold: 8 });
    const b2 = await base.toBuffer();
    for (const w of [400, 800]) {
      await sharp(b2)
        .resize(w, w, { fit: 'contain', background: '#ffffff' })
        .webp({ quality: 78, effort: 5 })
        .toFile(path.join(dir, `${p.slug}-${w}.webp`));
    }
    ok++;
  } catch (e) { ko++; console.warn('Foto non valida', p.slug, e.message); }
}));

const presenti = {};
// true = WebP locale; se il download non riesce si usa direttamente la foto ufficiale DEWALT
for (const p of prodotti) presenti[p.slug] = (await esiste(path.join(dir, `${p.slug}-800.webp`))) || p.immagineDewalt || false;
await fs.writeFile('src/data/foto.json', JSON.stringify(presenti));
console.log(`Foto: ${ok} nuove, ${salt} già presenti, ${ko} mancanti`);
