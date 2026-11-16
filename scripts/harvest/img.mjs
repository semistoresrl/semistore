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
  const out = { tried: [] };
  const key = b.toLowerCase();
  const shops = [
    (q) => `https://www.toolnation.com/catalogsearch/result/?q=${q}`,
    (q) => `https://www.tooriistamaailm.ee/en/search?query=${q}`,
    (q) => `https://www.misterworker.com/it/search?controller=search&s=${q}`,
    (q) => `https://www.toolstop.co.uk/search?q=${q}`,
    (q) => `https://www.tooled-up.com/search?q=${q}`,
    (q) => `https://www.ffx.co.uk/search?q=${q}`,
  ];
  for (const sh of shops) {
    const s = await get(sh(encodeURIComponent(b)));
    if (!s) { out.tried.push('x'); continue; }
    const host = new URL(s.url).host;
    const links = [...new Set([...s.html.matchAll(/href="([^"#]+)"/g)].map((m) => { try { return new URL(m[1].replace(/&amp;/g, '&'), s.url).href; } catch { return ''; } }).filter((u) => u.includes(host) && u.toLowerCase().replace(/[^a-z0-9]/g, '').includes(key.replace(/[^a-z0-9]/g, '')) && !/search|catalogsearch|review|login|cart/i.test(u)))];
    out.tried.push(host + ':' + links.length);
    for (const l of links.slice(0, 2)) {
      const p = await get(l); if (!p) continue;
      const og = (p.html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i) || p.html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) || [])[1];
      if (og && !/logo|placeholder|default|no_selection/i.test(og)) { const u = new URL(og, p.url).href; if (await head(u)) return { img: u, src: l }; }
    }
  }
  return out;
}
async function worker() { while (i < todo.length) { const t = todo[i++]; res[t.k] = await one(t); } }
await Promise.all(Array.from({ length: 6 }, worker));
await fs.mkdir('harvest-out', { recursive: true });
await fs.writeFile('harvest-out/img.json', JSON.stringify(res));
console.log('foto trovate', Object.values(res).filter((x) => x.img).length, 'su', todo.length);
