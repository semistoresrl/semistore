// Raccolta dati prodotto dai siti ufficiali (eseguita da GitHub Actions)
import fs from 'node:fs/promises';
const todo = JSON.parse(await fs.readFile('scripts/harvest/todo.json', 'utf8'));
const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36', 'accept-language': 'it-IT,it;q=0.9' };
const get = async (u, head = false) => {
  try {
    const r = await fetch(u, { method: head ? 'HEAD' : 'GET', headers: UA, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    if (!r.ok) return null;
    if (head) return (r.headers.get('content-type') || '').startsWith('image') ? r.url : null;
    return { url: r.url, html: await r.text() };
  } catch { return null; }
};
const txt = (s) => s.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '').replace(/<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, "'").replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
const meta = (h, p) => (h.match(new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]+content=["']([^"']*)`, 'i')) || h.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${p}["']`, 'i')) || [])[1];
function parse(page) {
  const h = page.html;
  const lis = [...h.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => txt(m[1])).filter((t) => t.length > 12 && t.length < 260 && !/cookie|privacy|accedi|newsletter|carrello|login|menu|©|seguici|facebook|instagram/i.test(t));
  const rows = [...h.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => [...m[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => txt(c[1]))).filter((r) => r.length === 2 && r[0] && r[1] && r[0].length < 60 && r[1].length < 120);
  const dts = [...h.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/g)].map((m) => [txt(m[1]), txt(m[2])]).filter((r) => r[0] && r[1] && r[1].length < 120);
  const paras = [...h.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((m) => txt(m[1])).filter((t) => t.length > 60 && t.length < 900 && !/cookie|privacy|newsletter|©|iscriviti|registra/i.test(t));
  return { url: page.url, title: txt((h.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || ''), og: meta(h, 'og:image'), desc: meta(h, 'description') || meta(h, 'og:description'), li: [...new Set(lis)].slice(0, 40), specs: [...rows, ...dts].slice(0, 40), p: [...new Set(paras)].slice(0, 8) };
}
const base = (c) => c.replace(/-(XJ|QZ|QS|QW|IT|GB|LX|KS|B5|B6|0|1)$/i, '');
async function one(t) {
  const out = {};
  const c = t.c, b = base(c);
  if (t.b === 'USAG') {
    const q = (t.n.match(/USAG\s+(.+)$/) || [])[1] || c;
    for (const query of [c, q]) {
      const s = await get(`https://usag.it/it/search/view/${encodeURIComponent(query).replace(/%20/g, '+')}`);
      const link = s && (s.html.match(/href="(https:\/\/usag\.it\/catalog\/it\/products\/details\/[^"]+)"/) || [])[1];
      if (link) { const p = await get(link); if (p) { Object.assign(out, parse(p)); out.imgs = [...p.html.matchAll(/(?:src|href|data-src)="([^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi)].map((m) => m[1]).filter((u) => !/logo|icon|flag|banner/i.test(u)).slice(0, 8); } break; }
    }
    return out;
  }
  const site = { DEWALT: ['www.dewalt.it', 'assets.dewalt.it'], 'BLACK+DECKER': ['www.blackanddecker.it', 'assets.blackanddecker.it'], STANLEY: ['www.stanley.it', 'assets.stanley.it'], LENOX: ['www.lenoxtools.com', null] }[t.b] || ['www.dewalt.it', 'assets.dewalt.it'];
  const sites = /^DT|^DE|^DW/.test(c) && t.b !== 'DEWALT' ? [site, ['www.dewalt.it', 'assets.dewalt.it']] : [site];
  for (const [w] of sites) {
    for (const u of [`https://${w}/it-it/product/${c.toLowerCase()}`, `https://${w}/it-it/product/${b.toLowerCase()}`]) {
      const p = await get(u);
      if (p && /\/product\//.test(p.url)) { Object.assign(out, parse(p)); break; }
    }
    if (out.url) break;
  }
  if (!t.img) {
    const cand = [];
    for (const [w, a] of sites) {
      if (a) for (const n of [1, 2]) for (const s of [1280, 1680, 800]) cand.push(`https://${a}/EMEA/PRODUCT/IMAGES/HIRES/WHITEBG/${b}_${n}_${s}.webp`);
      cand.push(`https://${w}/EMEA/PRODUCT/IMAGES/HIRES/${b}_1.jpg`);
    }
    for (const u of cand) { const ok = await get(u, true); if (ok) { out.img = ok; break; } }
  }
  return out;
}
const res = {}; let i = 0;
const t0 = Date.now();
async function worker() { while (i < todo.length && Date.now() - t0 < 40 * 60e3) { const t = todo[i++]; res[t.k] = await one(t); } }
await Promise.all(Array.from({ length: 10 }, worker));
await fs.mkdir('harvest-out', { recursive: true });
await fs.writeFile('harvest-out/result.json', JSON.stringify(res));
const n = Object.values(res);
console.log('pagine', n.filter((x) => x.url).length, 'foto nuove', n.filter((x) => x.img).length, 'su', todo.length);
