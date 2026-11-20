// GET /api/cap?c=80020 → { luoghi: [{ citta, provincia }] } dai dati pubblici dei CAP italiani (Zippopotam), in cache 90 giorni.
// Provincia dalle prime due cifre del CAP, solo dove il prefisso appartiene a una sola provincia di oggi
const PROV = { '00':'RM','01':'VT','02':'RI','03':'FR','04':'LT','05':'TR','06':'PG','10':'TO','11':'AO','12':'CN','14':'AT','15':'AL','16':'GE','17':'SV','18':'IM','19':'SP',
  '21':'VA','24':'BG','25':'BS','27':'PV','29':'PC','30':'VE','31':'TV','32':'BL','35':'PD','36':'VI','37':'VR','38':'TN','39':'BZ','40':'BO','41':'MO','42':'RE','43':'PR','44':'FE','45':'RO','46':'MN','48':'RA',
  '50':'FI','51':'PT','52':'AR','53':'SI','54':'MS','55':'LU','56':'PI','57':'LI','58':'GR','59':'PO','60':'AN','61':'PU','62':'MC','64':'TE','65':'PE','66':'CH','67':'AQ',
  '70':'BA','71':'FG','72':'BR','73':'LE','74':'TA','75':'MT','76':'BT','80':'NA','81':'CE','82':'BN','83':'AV','84':'SA','85':'PZ','87':'CS','90':'PA','91':'TP','92':'AG','93':'CL','94':'EN','95':'CT','96':'SR','97':'RG','98':'ME' };

export async function onRequestGet({ request, env }) {
  const c = String(new URL(request.url).searchParams.get('c') || '').replace(/\D/g, '');
  const out = (o) => new Response(JSON.stringify(o), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=86400' } });
  if (c.length !== 5) return out({ luoghi: [] });
  if (env.RICHIESTE) { const k = await env.RICHIESTE.get('cap2:' + c, 'json'); if (k) return out(k); }
  try {
    const r = await fetch(`https://api.zippopotam.us/it/${c}`, { cf: { cacheTtl: 86400 * 30 } });
    if (!r.ok) return out({ luoghi: [] });
    const j = await r.json();
    const titolo = (t) => t.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
    const luoghi = [...new Map((j.places || []).map((p) => [p['place name'], { citta: titolo(p['place name']), provincia: p['state abbreviation'] || PROV[c.slice(0, 2)] || '' }])).values()];
    const o = { luoghi };
    if (env.RICHIESTE && luoghi.length) await env.RICHIESTE.put('cap2:' + c, JSON.stringify(o), { expirationTtl: 90 * 86400 });
    return out(o);
  } catch { return out({ luoghi: [] }); }
}
