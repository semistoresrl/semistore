// Raccolta dati prodotto dai siti ufficiali (eseguita da GitHub Actions)
import fs from 'node:fs/promises';
const todo = JSON.parse(await fs.readFile('scripts/harvest/todo5.json', 'utf8'));
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
function sbd(h) {
  const o = {};
  for (const m of h.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    try { const j = JSON.parse(m[1]); if (j['@type'] === 'Product') { o.name = j.name; o.ldesc = j.description; o.img = j.image; o.props = (j.additionalProperty || []).map((p) => [p.name, String(p.value ?? '') + (p.unitCode ? ' ' + p.unitCode : '')]); } } catch {}
  }
  const sec = (a, b) => { const i = h.indexOf('>' + a + '<'); if (i < 0) return []; const j = b ? h.indexOf('>' + b + '<', i + 5) : -1; const seg = h.slice(i, j > i ? j : i + 12000).replace(/<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/g, '');
    return [...seg.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((x) => txt(x[1])).filter((t) => t.length > 2 && t.length < 300); };
  o.feat = sec('Caratteristiche', 'Specifiche');
  o.incl = sec('Include', 'Garanzia');
  return o;
}
function parse(page) {
  const h = page.html;
  const lis = [...h.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => txt(m[1])).filter((t) => t.length > 12 && t.length < 260 && !/cookie|privacy|accedi|newsletter|carrello|login|menu|©|seguici|facebook|instagram/i.test(t));
  const rows = [...h.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => [...m[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => txt(c[1]))).filter((r) => r.length === 2 && r[0] && r[1] && r[0].length < 60 && r[1].length < 120);
  const dts = [...h.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/g)].map((m) => [txt(m[1]), txt(m[2])]).filter((r) => r[0] && r[1] && r[1].length < 120);
  const paras = [...h.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((m) => txt(m[1])).filter((t) => t.length > 60 && t.length < 900 && !/cookie|privacy|newsletter|©|iscriviti|registra/i.test(t));
  return { ...sbd(h), url: page.url, title: txt((h.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || ''), og: meta(h, 'og:image'), desc: meta(h, 'description') || meta(h, 'og:description'), specs: [...rows, ...dts].slice(0, 40) };
}
const base = (c) => c.replace(/-(XJ|QZ|QS|QW|IT|GB|LX|KS|B5|B6|0|1)$/i, '');
async function sitemapUrls(host) {
  const seen = new Set(), out = [];
  const rob = await get(`https://${host}/robots.txt`);
  let queue = rob ? [...rob.html.matchAll(/Sitemap:\s*(\S+)/gi)].map((m) => m[1]) : [];
  queue.push(`https://${host}/sitemap.xml`);
  while (queue.length && seen.size < 400) {
    const u = queue.shift(); if (seen.has(u)) continue; seen.add(u);
    const r = await get(u); if (!r) continue;
    for (const m of r.html.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
      const l = m[1].replace(/&amp;/g, '&');
      if (/\.xml(\?|$)/.test(l)) { if (!/\/(page|article|campaign|event|dealer|static|system|global-content)\//.test(l)) queue.push(l); } else out.push(l);
    }
  }
  return { n: out.length, maps: seen.size, urls: out };
}
const HOSTS = ['www.dewalt.ch', 'www.blackanddecker.ch', 'www.stanley.ch', 'www.blackanddecker.co.uk', 'www.dewalt.co.uk', 'www.stanley.co.uk', 'www.blackanddecker.fr', 'www.blackanddecker.de', 'www.blackanddecker.es', 'www.dewalt.de', 'www.lenoxtools.com', 'www.blackanddecker.it'];
const IDX = {}; const dbg = {};
const rank = (u) => (/\/it-/.test(u) ? 0 : /\/en-/.test(u) ? 1 : 2);
for (const h of HOSTS) {
  const sm = await sitemapUrls(h); dbg[h] = { n: sm.n, maps: sm.maps, sample: sm.urls.filter((u) => /product|prodott|produit|produkt/i.test(u)).slice(0, 4) };
  for (const u of sm.urls) {
    const seg = decodeURIComponent(u.split(/[?#]/)[0].replace(/\/$/, '')).split('/').slice(-2).join('/').toUpperCase();
    for (const m of seg.matchAll(/[A-Z0-9]{0,6}\d[A-Z0-9]*(?:-[A-Z0-9]{1,6})?/g)) {
      for (const code of [m[0], m[0].replace(/-(XJ|QZ|QS|QW|IT|GB|LX|KS|B5|B6|GB)$/i, '')]) {
        (IDX[code] ||= []).push(u);
      }
    }
  }
}
for (const k in IDX) IDX[k] = [...new Set(IDX[k])].sort((a, b) => rank(a) - rank(b)).slice(0, 3);
const shops = [
  (q) => `https://www.toolnation.com/catalogsearch/result/?q=${q}`,
  (q) => `https://www.toolnation.de/catalogsearch/result/?q=${q}`,
  (q) => `https://www.toolnation.fr/catalogsearch/result/?q=${q}`,
  (q) => `https://www.ukplanettools.co.uk/search.php?search_query=${q}`,
  (q) => `https://www.toolden.co.uk/search?q=${q}`,
  (q) => `https://www.tooled-up.com/search/?term=${q}`,
  (q) => `https://www.contorion.de/search?q=${q}`,
  (q) => `https://www.svh24.de/search?sSearch=${q}`,
  (q) => `https://www.bol.com/nl/nl/s/?searchtext=${q}`,
];
const headImg = async (u) => { try { const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(15000) }); const ct = r.headers.get('content-type') || ''; if (r.ok && ct.startsWith('image')) return r.url; } catch {} return null; };
async function shopImg(c, b) {
  const tried = [];
  for (const key of [c, b]) for (const sh of shops) {
    const s = await get(sh(encodeURIComponent(key)));
    if (!s) { tried.push('x'); continue; }
    const host = new URL(s.url).host; const k = b.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (/\/product|\/p\/|\.html$/.test(s.url) && s.url.toLowerCase().replace(/[^a-z0-9]/g, '').includes(k)) { const og = meta(s.html, 'og:image'); if (og && await headImg(new URL(og, s.url).href)) return { img: new URL(og, s.url).href, src: s.url, tried }; }
    const links = [...new Set([...s.html.matchAll(/href="([^"#]+)"/g)].map((m) => { try { return new URL(m[1].replace(/&amp;/g, '&'), s.url).href; } catch { return ''; } }).filter((u) => u.includes(host) && u.toLowerCase().replace(/[^a-z0-9]/g, '').includes(k) && !/search|catalogsearch|review|login|cart|compare|wishlist/i.test(u)))];
    tried.push(host + ':' + links.length);
    for (const l of links.slice(0, 2)) {
      const p = await get(l); if (!p) continue;
      const og = meta(p.html, 'og:image');
      if (og && !/logo|placeholder|default|no_selection/i.test(og)) { const u = new URL(og, p.url).href; if (await headImg(u)) return { img: u, src: l, title: txt((p.html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || '').slice(0, 160), desc: (meta(p.html, 'og:description') || meta(p.html, 'description') || '').slice(0, 600), tried }; }
    }
  }
  return { tried };
}
const res = {}; let i = 0;
async function one(t) {
  const out = {};
  const c = t.c.toUpperCase(), b = base(t.c).toUpperCase();
  const urls = IDX[c] || IDX[b] || [];
  for (const u of urls) { const p = await get(u); if (p) { const o = parse(p); if (o.name || o.feat?.length || o.props?.length) { Object.assign(out, o); break; } } }
  if (!t.img && !(out.img)) Object.assign(out, { shop: await shopImg(t.c, base(t.c)) });
  return out;
}
async function worker() { while (i < todo.length) { const t = todo[i++]; res[t.k] = await one(t); } }
await Promise.all(Array.from({ length: 10 }, worker));
await fs.mkdir('harvest-out', { recursive: true });
await fs.writeFile('harvest-out/r5.json', JSON.stringify(res));
await fs.writeFile('harvest-out/d5.json', JSON.stringify(dbg));
console.log('ok', Object.values(res).filter((x) => x.url).length);
