// Cerca le foto mancanti: prima schemi di URL ufficiali, poi una ricerca web sul codice
import fs from 'node:fs/promises';
const todo = JSON.parse(await fs.readFile('scripts/harvest/img-todo.json', 'utf8'));
const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36', 'accept-language': 'it-IT,it;q=0.9' };
const head = async (u) => { try { const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(15000) }); const ct = r.headers.get('content-type') || ''; const len = Number(r.headers.get('content-length') || 0); if (r.ok && ct.startsWith('image') && (len === 0 || len > 4000)) return r.url; } catch {} return null; };
const get = async (u) => { try { const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(20000) }); return r.ok ? { url: r.url, html: await r.text() } : null; } catch { return null; } };
const base = (c) => c.replace(/-(XJ|QZ|QS|QW|IT|GB|LX|KS|B5|B6|0|1)$/i, '');
const res = {};
let i = 0;
async function one(t) {
  const b = base(t.c);
  const cand = [];
  for (const host of ['assets.dewalt.it', 'assets.blackanddecker.it', 'www.blackanddecker.it', 'assets.stanley.it']) {
    for (const f of [`WHITEBG/${b}_1.jpg`, `WHITEBG/${b}_K1.jpg`, `WHITEBG/${b}_1_1280.webp`, `WHITEBG/${b}_2_1280.webp`, `WHITEBG/${b}_K1_1280.webp`, `${b}_1.jpg`, `${b}_K1.jpg`, `${b}_2.jpg`]) cand.push(`https://${host}/EMEA/PRODUCT/IMAGES/HIRES/${f}`);
  }
  const out = {};
  for (const q of [`${t.c} ${t.b}`, `${b} ${t.b}`]) {
    const s = await get(`https://www.bing.com/images/search?q=${encodeURIComponent(q)}&form=HDRSC2&first=1`);
    if (!s) { out.err = 'bing'; continue; }
    const items = [...s.html.matchAll(/\sm="([^"]+)"/g)].map((m) => { try { return JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')); } catch { return null; } }).filter(Boolean);
    out.n = items.length;
    const key = b.toLowerCase().replace(/[^a-z0-9]/g, '');
    const good = items.filter((it) => it.murl && !/amazon|ebay|aliexpress|pinterest|alamy|shutterstock/i.test(it.murl + it.purl) && ((it.purl || '') + (it.murl || '') + (it.t || '')).toLowerCase().replace(/[^a-z0-9]/g, '').includes(key));
    out.cands = good.slice(0, 4).map((it) => [it.murl, it.purl, it.t]);
    for (const it of good.slice(0, 4)) { if (await head(it.murl)) return { img: it.murl, src: it.purl, t: it.t }; }
  }
  return out;
}
async function worker() { while (i < todo.length) { const t = todo[i++]; res[t.k] = await one(t); } }
await Promise.all(Array.from({ length: 6 }, worker));
await fs.mkdir('harvest-out', { recursive: true });
await fs.writeFile('harvest-out/img.json', JSON.stringify(res));
console.log('foto trovate', Object.values(res).filter((x) => x.img).length, 'su', todo.length);
