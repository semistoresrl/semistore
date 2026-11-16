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
  for (const u of cand) { const ok = await head(u); if (ok) return { img: ok, src: 'pattern' }; }
  // ricerca web
  const q = encodeURIComponent(`${t.c} ${t.b}`);
  const s = await get(`https://html.duckduckgo.com/html/?q=${q}`);
  const links = s ? [...s.html.matchAll(/class="result__a" href="([^"]+)"/g)].map((m) => { const u = m[1]; const mm = u.match(/uddg=([^&]+)/); return mm ? decodeURIComponent(mm[1]) : u; }) : [];
  const out = { links: links.slice(0, 6) };
  for (const l of links.slice(0, 5)) {
    if (/amazon\.|ebay\.|youtube|facebook|pinterest|\.pdf$/i.test(l)) continue;
    const p = await get(l); if (!p) continue;
    const page = p.html;
    if (!page.toUpperCase().includes(b.toUpperCase())) continue;
    const og = (page.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i) || page.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) || [])[1];
    if (og && !/logo|placeholder|default/i.test(og)) { const u = new URL(og, p.url).href; if (await head(u)) return { img: u, src: l, links: out.links }; }
  }
  return out;
}
async function worker() { while (i < todo.length) { const t = todo[i++]; res[t.k] = await one(t); } }
await Promise.all(Array.from({ length: 6 }, worker));
await fs.mkdir('harvest-out', { recursive: true });
await fs.writeFile('harvest-out/img.json', JSON.stringify(res));
console.log('foto trovate', Object.values(res).filter((x) => x.img).length, 'su', todo.length);
