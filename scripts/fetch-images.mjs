// Scarica (una volta sola) le foto prodotto dal vecchio sito e le converte
// in WebP leggeri in 2 misure. Le foto già presenti non vengono riscaricate.
// Consiglio: dopo il primo build riuscito, salvare la cartella public/img/prodotti
// nel repository, così il sito non dipende più dal vecchio server.
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const prodotti = JSON.parse(await fs.readFile('src/data/prodotti.json', 'utf8'));
const dir = 'public/img/prodotti';
await fs.mkdir(dir, { recursive: true });

const esiste = (f) => fs.access(f).then(() => true, () => false);
let ok = 0, salt = 0, ko = 0;

await Promise.all(prodotti.map(async (p) => {
  const big = path.join(dir, `${p.slug}-800.webp`);
  if (await esiste(big)) { salt++; return; }
  // prova prima una foto locale messa a mano (public/img/originali/<slug>.jpg|png)
  let buf = null;
  for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
    const f = `public/img/originali/${p.slug}.${ext}`;
    if (await esiste(f)) { buf = await fs.readFile(f); break; }
  }
  if (!buf && p.immagineOrigine) {
    for (const u of [p.immagineOrigine, p.immagineOrigine.replace('http://', 'https://')]) {
      try {
        const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
        if (r.ok) { buf = Buffer.from(await r.arrayBuffer()); break; }
      } catch {}
    }
  }
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
for (const p of prodotti) presenti[p.slug] = await esiste(path.join(dir, `${p.slug}-800.webp`));
await fs.writeFile('src/data/foto.json', JSON.stringify(presenti));
console.log(`Foto: ${ok} nuove, ${salt} già presenti, ${ko} mancanti`);
