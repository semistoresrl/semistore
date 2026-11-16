// Foto mancanti: motori di ricerca (Mojeek, DuckDuckGo lite, Brave) + pagine prodotto note
import fs from 'node:fs/promises';
const todo = JSON.parse(await fs.readFile('scripts/harvest/img-todo.json', 'utf8'));
const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36', 'accept-language': 'it-IT,it;q=0.9,en;q=0.8' };
const get = async (u) => { try { const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(20000) }); return r.ok ? { url: r.url, html: await r.text() } : { url: u, html: '', status: r.status }; } catch (e) { return { url: u, html: '', status: 'err' }; } };
const headImg = async (u) => { try { const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(15000) }); const ct = r.headers.get('content-type') || ''; const b = r.ok ? await r.arrayBuffer() : null; if (r.ok && ct.startsWith('image') && b.byteLength > 5000) return r.url; } catch {} return null; };
const meta = (h, p) => (h.match(new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]+content=["']([^"']*)`, 'i')) || h.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${p}["']`, 'i')) || [])[1];
const base = (c) => c.replace(/-(XJ|QZ|QS|QW|IT|GB|LX|KS|B5|B6|0|1)$/i, '');
const EXTRA = {
  '10507827': ['https://towntools.co.uk/products/lenox-diamond-holesaw-29mm', 'https://its.co.uk/pd/10507827-Lenox-Diamond-Holesaw---29mm-_LEN10507827.htm', 'https://sardco.com/en/lenox10507827-diamondtm-holesaw-29mm.html', 'https://angliatoolcentre.co.uk/lenox-10507827-diamond-holesaw-29mm-pid48325.html'],
  'X33091': ['https://www.tooled-up.com/black-and-decker-piranha-sanding-belts-75mm-x-457mm/prod/104840'],
};
const engines = [
  (q) => `https://search.brave.com/search?q=${q}`,
  (q) => `https://www.bing.com/search?q=${q}&setlang=it`,
  (q) => `https://www.startpage.com/do/search?q=${q}`,
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BAN = /mojeek|duckduckgo|brave\.com|qwant|amazon\.|ebay\.|youtube|facebook|pinterest|wikipedia|\.pdf(\?|$)|manualslib|google\./i;
const res = {}; let i = 0; const dbg = {};
async function one(t) {
  const b = base(t.c); const key = b.toLowerCase().replace(/[^a-z0-9]/g, '');
  const out = { tried: [] };
  let pages = [...(EXTRA[b] || [])];
  for (const e of engines) {
    for (const q of [`${b} ${t.b.replace('+', ' ')}`, `${t.c}`]) {
      if (pages.length > 2) break;
      await sleep(25000);
      const s = await get(e(encodeURIComponent(q)));
      const links = [...new Set([...s.html.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&')).filter((u) => !BAN.test(u)))];
      out.tried.push(`${new URL(e('x')).host}:${s.status || 'ok'}:${links.length}`);
      if (!dbg[new URL(e('x')).host]) dbg[new URL(e('x')).host] = s.html.slice(0, 1500);
      pages.push(...links.filter((u) => u.toLowerCase().replace(/[^a-z0-9]/g, '').includes(key)).slice(0, 6));
    }
    if (pages.length > 2) break;
  }
  pages = [...new Set(pages)].slice(0, 15);
  out.pages = pages;
  for (const l of pages) {
    const p = await get(l); if (!p.html) continue;
    if (!p.html.toLowerCase().replace(/[^a-z0-9]/g, '').includes(key)) continue;
    let og = meta(p.html, 'og:image') || meta(p.html, 'twitter:image');
    if (og && !/logo|placeholder|default|no_selection|favicon/i.test(og)) {
      try { const u = new URL(og, p.url).href; if (await headImg(u)) { out.img = u; out.src = l; out.title = (meta(p.html, 'og:title') || '').slice(0, 150); out.desc = (meta(p.html, 'og:description') || meta(p.html, 'description') || '').slice(0, 500); break; } } catch {}
    }
  }
  return out;
}
async function worker() { while (i < todo.length) { const t = todo[i++]; res[t.k] = await one(t); } }
await Promise.all(Array.from({ length: 1 }, worker));
await fs.mkdir('harvest-out', { recursive: true });
await fs.writeFile('harvest-out/img6.json', JSON.stringify({ res, dbg }));
console.log('foto', Object.values(res).filter((x) => x.img).length, '/', todo.length);
