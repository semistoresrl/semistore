import fs from 'node:fs/promises';
import sharp from 'sharp';
const todo = JSON.parse(await fs.readFile('scripts/harvest/todo7.json', 'utf8'));
const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36', 'accept-language': 'it-IT,it;q=0.9' };
await fs.mkdir('harvest-out/img', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = (c) => c.replace(/-(XJ|QZ|QS|QW|IT|GB|LX|KS|B5|B6|0|1)$/i, '');
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
let okI = 0, koI = 0, okV = 0; const vids = {};
async function img(t) {
  if (!t.u) return;
  try {
    const r = await fetch(t.u.replace(/^http:/, 'https:'), { headers: UA, signal: AbortSignal.timeout(30000) });
    if (!r.ok) { koI++; return; }
    const buf = Buffer.from(await r.arrayBuffer());
    const b2 = await sharp(buf).flatten({ background: '#ffffff' }).trim({ threshold: 8 }).toBuffer();
    for (const w of [400, 800]) await sharp(b2).resize(w, w, { fit: 'contain', background: '#ffffff' }).webp({ quality: 76, effort: 5 }).toFile(`harvest-out/img/${t.k}-${w}.webp`);
    okI++;
  } catch { koI++; }
}
async function video(t) {
  const b = base(t.m || t.c); if (b.length < 5 || !/\d/.test(b) || t.b === 'USAG') return;
  const q = `${t.b === 'BLACK+DECKER' ? 'Black Decker' : t.b} ${b}`;
  try {
    const r = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&hl=it&gl=IT`, { headers: UA, signal: AbortSignal.timeout(20000) });
    const h = await r.text();
    const m = h.match(/var ytInitialData = (\{[\s\S]*?\});<\/script>/); if (!m) { vids[t.k] = { err: r.status }; return; }
    const out = [];
    const walk = (o) => { if (!o || typeof o !== 'object') return; if (o.videoRenderer) { const v = o.videoRenderer; out.push({ id: v.videoId, t: (v.title?.runs || []).map((x) => x.text).join(''), len: v.lengthText?.simpleText || '', ch: v.ownerText?.runs?.[0]?.text || '', views: v.viewCountText?.simpleText || '' }); } for (const k in o) walk(o[k]); };
    walk(JSON.parse(m[1]));
    const key = norm(b);
    const hit = out.find((v) => norm(v.t).includes(key) && !/#shorts/i.test(v.t) && v.len && v.len.split(':').length <= 2 && Number(v.len.split(':')[0]) < 30);
    if (hit) { vids[t.k] = hit; okV++; }
  } catch (e) { vids[t.k] = { err: String(e).slice(0, 60) }; }
}
let i = 0;
async function wi() { while (i < todo.length) await img(todo[i++]); }
let j = 0;
async function wv() { while (j < todo.length) { await video(todo[j++]); await sleep(700); } }
await Promise.all([...Array.from({ length: 8 }, wi), ...Array.from({ length: 2 }, wv)]);
await fs.writeFile('harvest-out/videos.json', JSON.stringify(vids));
console.log('immagini', okI, 'errori', koI, 'video', okV);
