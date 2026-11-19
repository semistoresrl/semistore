// Crea le anteprime 1200x630 che compaiono quando si condivide un link (WhatsApp, Facebook, Telegram, LinkedIn, X)
// e nei risultati di Google Discover. Una per prodotto, una per categoria e alcune per le pagine principali.
// Le immagini finiscono in public/og/ (non salvate nel repository: si rigenerano a ogni build, quindi
// prezzi e titoli sono sempre aggiornati). Font Archivo incluso in scripts/fonts, così il risultato è
// identico su qualsiasi computer o server di build.
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { Resvg } from '@resvg/resvg-js';

const W = 1200, H = 630;
const INK = '#15171a', Y = '#f5b800', GRIGIO = '#9a9ca1';
const FONTS = ['Archivo-Black.ttf', 'Archivo-Bold.ttf', 'Archivo-Medium.ttf'].map((f) => path.join('scripts/fonts', f));
const OUT = 'public/og';

const prodotti = JSON.parse(await fs.readFile('src/data/prodotti.json', 'utf8'));
const foto = JSON.parse(await fs.readFile('src/data/foto.json', 'utf8'));
const logoSvg = await fs.readFile('public/logo.svg', 'utf8');
const logo = `data:image/svg+xml;base64,${Buffer.from(logoSvg).toString('base64')}`;

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const euro = (c) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(c / 100).replace(/ /g, ' ');
const slugCat = (c) => c.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// a capo per larghezza stimata (Archivo Black ≈ 0,6 em per carattere)
function righe(testo, size, larg, max) {
  const parole = String(testo).split(/\s+/); const out = []; let r = '';
  const cap = Math.floor(larg / (size * 0.6));
  for (const p of parole) {
    if ((r + ' ' + p).trim().length > cap && r) { out.push(r); r = p; } else r = (r + ' ' + p).trim();
  }
  if (r) out.push(r);
  if (out.length > max) { out.length = max; out[max - 1] = out[max - 1].replace(/[\s,–-]*\S*$/, '').replace(/[.,;:]+$/, '') + '…'; }
  return out;
}

const cacheFoto = new Map();
async function fotoPng(slug, lato = 520) {
  if (foto[slug] !== true) return null;
  const k = slug + lato; if (cacheFoto.has(k)) return cacheFoto.get(k);
  try {
    const buf = await sharp(`public/img/prodotti/${slug}-800.webp`).resize(lato, lato, { fit: 'contain', background: '#ffffff' }).flatten({ background: '#ffffff' }).png().toBuffer();
    const d = `data:image/png;base64,${buf.toString('base64')}`; cacheFoto.set(k, d); return d;
  } catch { return null; }
}

async function salva(svg, file) {
  const png = new Resvg(svg, { font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: 'Archivo' }, fitTo: { mode: 'width', value: W } }).render().asPng();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await sharp(png).jpeg({ quality: 84, mozjpeg: true }).toFile(file);
}

const cornice = (dentro) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="${INK}"/>${dentro}<rect y="${H - 12}" width="${W}" height="12" fill="${Y}"/></svg>`;
const piede = (x, testo) => `<text x="${x}" y="${H - 40}" font-family="Archivo" font-weight="500" font-size="22" fill="${GRIGIO}">${esc(testo)}</text>`;

// ---------- scheda prodotto ----------
async function cardProdotto(p) {
  const img = await fotoPng(p.slug);
  const X = 640, LARG = 1200 - X - 48;
  const kicker = [p.marca, p.modello].filter(Boolean).join(' · ');
  const tit = righe(p.nome, 40, LARG, 4);
  const sconto = p.prezzoListino && p.prezzoListino > p.prezzo ? Math.round((1 - p.prezzo / p.prezzoListino) * 100) : 0;
  let y = 150;
  const titolo = tit.map((r, i) => `<text x="${X}" y="${y + i * 48}" font-family="Archivo" font-weight="900" font-size="40" fill="#fff">${esc(r)}</text>`).join('');
  y += (tit.length - 1) * 48 + 92;
  const prezzo = `<text x="${X}" y="${y}" font-family="Archivo" font-weight="900" font-size="64" fill="${Y}">${esc(euro(p.prezzo))}</text>`;
  const lisTxt = `Listino ${euro(p.prezzoListino || 0)}`;
  const bx = X + Math.round(lisTxt.length * 13.2) + 18;
  const listino = sconto >= 5 ? `<text x="${X}" y="${y + 42}" font-family="Archivo" font-weight="500" font-size="24" fill="${GRIGIO}">Listino <tspan text-decoration="line-through">${esc(euro(p.prezzoListino))}</tspan></text>
<rect x="${bx}" y="${y + 16}" width="92" height="36" rx="6" fill="${Y}"/><text x="${bx + 46}" y="${y + 42}" text-anchor="middle" font-family="Archivo" font-weight="900" font-size="24" fill="${INK}">-${sconto}%</text>` : '';
  const pannello = `<rect x="36" y="36" width="568" height="546" rx="22" fill="#fff"/>` + (img
    ? `<image href="${img}" x="60" y="49" width="520" height="520" preserveAspectRatio="xMidYMid meet"/>`
    : `<image href="${logo}" x="80" y="230" width="480" height="154"/>`);
  const svg = cornice(`${pannello}
<image href="${logo}" x="${X}" y="34" width="150" height="48"/>
<text x="${X}" y="${108}" font-family="Archivo" font-weight="700" font-size="22" letter-spacing="2" fill="${Y}">${esc(kicker.toUpperCase())}</text>
${titolo}${prezzo}${listino}
${piede(X, p.prezzo >= 9900 ? 'Spedizione gratis · Ritiro a Casavatore (NA)' : 'Spedizione in tutta Italia · Ritiro a Casavatore (NA)')}`);
  await salva(svg, `${OUT}/prodotti/${p.slug}.jpg`);
}

// ---------- pagine con mosaico di foto (home, categorie, catalogo, assistenza) ----------
async function cardMosaico(file, { kicker, titolo, sotto, slugs, immagine }) {
  const imgs = (await Promise.all(slugs.map((s) => fotoPng(s, 260)))).filter(Boolean).slice(0, 4);
  if (immagine) {
    const b = await sharp(immagine).resize(520, 520, { fit: 'cover', position: 'centre' }).jpeg({ quality: 85 }).toBuffer();
    imgs.length = 0; imgs.push('BIG:data:image/jpeg;base64,' + b.toString('base64'));
  }
  const tiles = imgs[0]?.startsWith('BIG:') ? `<clipPath id="cp"><rect x="640" y="56" width="520" height="520" rx="22"/></clipPath><image href="${imgs[0].slice(4)}" x="640" y="56" width="520" height="520" clip-path="url(#cp)" preserveAspectRatio="xMidYMid slice"/>` : imgs.map((d, i) => {
    const x = 640 + (i % 2) * 268, y = 56 + Math.floor(i / 2) * 268;
    return `<rect x="${x}" y="${y}" width="252" height="252" rx="18" fill="#fff"/><image href="${d}" x="${x + 16}" y="${y + 16}" width="220" height="220" preserveAspectRatio="xMidYMid meet"/>`;
  }).join('');
  const t = righe(titolo, 52, imgs.length ? 560 : 1080, 3);
  const titoloSvg = t.map((r, i) => `<text x="56" y="${250 + i * 62}" font-family="Archivo" font-weight="900" font-size="52" fill="#fff">${esc(r)}</text>`).join('');
  const sottoSvg = righe(sotto, 26, imgs.length ? 560 : 1080, 3).map((r, i) => `<text x="56" y="${250 + t.length * 62 + 22 + i * 36}" font-family="Archivo" font-weight="500" font-size="26" fill="#c9cbcf">${esc(r)}</text>`).join('');
  const svg = cornice(`<image href="${logo}" x="56" y="52" width="200" height="64"/>
<text x="56" y="${170}" font-family="Archivo" font-weight="700" font-size="20" letter-spacing="1.5" fill="${Y}">${esc(righe(kicker.toUpperCase(), 21, imgs.length ? 560 : 1080, 1)[0])}</text>
${titoloSvg}${sottoSvg}${tiles}${piede(56, 'semistore.it · Viale G. Marconi 225, Casavatore (NA)')}`);
  await salva(svg, `${OUT}/${file}`);
}

const conFoto = (lista) => { const ok = lista.filter((p) => foto[p.slug] === true).sort((a, b) => (a.auto ? 1 : 0) - (b.auto ? 1 : 0) || b.prezzo - a.prezzo); return ok.map((p) => p.slug); };
const vetrina = (modelli) => modelli.map((m) => prodotti.find((p) => p.modello === m)?.slug).filter(Boolean);

const t0 = Date.now();
await fs.rm(OUT, { recursive: true, force: true });
await cardMosaico('semi.jpg', { kicker: 'Centro assistenza autorizzato DEWALT', titolo: 'Utensili professionali a Napoli', sotto: 'Oltre 1.200 prodotti DEWALT, STANLEY e BLACK+DECKER. Spedizione in tutta Italia.', slugs: vetrina(['DCD805P2T', 'DCF850P2T', 'DCK2050E2T', 'DCH273P2T']) });
await cardMosaico('assistenza.jpg', { kicker: 'Centro assistenza autorizzato DEWALT', titolo: 'Riparazioni e ricambi originali', sotto: 'Garanzia gestita in sede, preventivo prima di riparare. Casavatore, Napoli.', slugs: vetrina(['DCH273P2T', 'DCF900P2T', 'DCS438E2T', 'DCD805P2T']) });
await cardMosaico('catalogo.jpg', { kicker: 'Catalogo Semi Store', titolo: 'Utensili, batterie e kit', sotto: 'Prezzi sotto listino, spedizione gratis da 99 € o ritiro in negozio.', slugs: vetrina(['DCK2050E2T', 'DCB184', 'DCE089D1G', 'DCS438E2T']) });
await cardMosaico('contatti.jpg', { kicker: 'Vieni a trovarci', titolo: 'Negozio e laboratorio a Casavatore', sotto: 'Viale G. Marconi 225 (NA) · Lun–Ven 8:30–13:00 e 14:30–18:00 · Tel. 081 553 6604', slugs: [], immagine: 'public/video/negozio-poster.jpg' });
for (const c of [...new Set(prodotti.map((p) => p.categoria))]) {
  const lista = prodotti.filter((p) => p.categoria === c);
  const min = Math.min(...lista.map((p) => p.prezzo));
  await cardMosaico(`categorie/${slugCat(c)}.jpg`, { kicker: `${lista.length} prodotti · da ${euro(min)}`, titolo: c, sotto: 'DEWALT, STANLEY e BLACK+DECKER sotto listino. Spedizione o ritiro a Casavatore.', slugs: conFoto(lista) });
}
let n = 0;
for (const p of process.env.OG_TEST ? prodotti.slice(0, 3) : prodotti) { await cardProdotto(p); n++; }
console.log(`Anteprime social: ${n} prodotti + categorie e pagine in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
