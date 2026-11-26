#!/usr/bin/env python3
"""Pacchetto «Aggiornamento da Danea» per l'app Gestione (semistore.it/gestione → Impostazioni → Aggiorna da Danea).

Uso:  python3 aggiorna.py "<archivio Danea .eft o backup .bef>" [uscita.json.gz]
Serve Firebird 2.5 (embedded) e il modulo fdb. Variabili: FB_LIB = libreria client/embedded (libfbclient.so.2 / libfbembed.so).

Il pacchetto contiene (niente giacenze: il magazzino lo contano in negozio):
- numeri: ultimo numero Danea per tipo e anno (schede G, preventivi Q, DDT D, fatture I/F, note N, banco B)
- aperte: rapporti d'intervento non ancora richiamati in DDT/fattura/banco degli ultimi GIORNI_APERTE giorni → schede aperte nell'app
- chiuse: rapporti richiamati in un altro documento (per chiudere nell'app le schede importate)
- clienti: anagrafica clienti con sconto, listino, pagamento, fatturato per anno, riparazioni
- riparazioni: storico riparazioni per cliente (scheda cliente)
- archivio: rapporti, DDT, fatture e note con tutte le righe (pagina Archivio Danea)
- storicoArt: righe per codice (pagina Storico codice)
"""
import sys, os, json, gzip, zipfile, tempfile, collections, datetime, re
import fdb

GIORNI_APERTE = 90
GIORNI_RECENTI = 120
src = sys.argv[1]
out = sys.argv[2] if len(sys.argv) > 2 else 'aggiornamento_danea.json.gz'
if src.lower().endswith('.bef') or zipfile.is_zipfile(src):
    tmp = tempfile.mkdtemp(); z = zipfile.ZipFile(src)
    eft = [n for n in z.namelist() if n.lower().endswith('.eft')][0]; z.extract(eft, tmp); src = os.path.join(tmp, eft)
lib = os.environ.get('FB_LIB', '/home/claude/fb25/emb/libfbclient.so.2')
con = fdb.connect(database=src, user='SYSDBA', password='masterkey', charset='WIN1252', fb_library_name=lib)
cur = con.cursor()
S = lambda x: (str(x).strip() if x is not None else '')
F = lambda x: float(x or 0)
r2 = lambda x: round(F(x) + 0.0, 2)

# ---------- anagrafica ----------
cur.execute('select "IDListino","NomeListino" from "TListini"'); LIST = {a: S(b) for a, b in cur}
cur.execute('select "IDAnagr","CodAnagr","Nome","Indirizzo","Cap","Citta","Prov","PartitaIva","CodiceFiscale","Tel","Cell","Email","Pec","Referente","ScontiDefault","IDListinoDefault","PagamentoDefault","Cliente","Fornitore","FE_CodUfficio","Note","Fax" from "TAnagrafica"')
ANA = {}
for r in cur:
    ANA[r[0]] = dict(cod=S(r[1]), nome=S(r[2]), ind=S(r[3]), cap=S(r[4]), citta=S(r[5]), prov=S(r[6])[:2].upper(), piva=S(r[7]), cf=S(r[8]), tel=S(r[9]), cell=S(r[10]), email=S(r[11]), pec=S(r[12]),
                     referente=S(r[13]), sconto=S(r[14]), listino=LIST.get(r[15], ''), pagamento=S(r[16]), cliente=bool(r[17]), fornitore=bool(r[18]), sdi=S(r[19]), note=S(r[20])[:300], fax=S(r[21]))
cliDi = lambda ida: ('D' + ANA[ida]['cod']) if ida in ANA and ANA[ida]['cod'] else ''

# ---------- testate ----------
cur.execute('select "IDDoc","TipoDoc","DataDoc","NumDoc","IDAnagr","Anagr_Nome","Anagr_PartitaIva","TotNetto","TotIva","TotDoc","Pagamento","InclusoInIDDoc","Extra1","Extra2","Extra3","Extra4","Note" from "TDocTestate"')
T = {r[0]: r for r in cur}
ultima = max(str(r[2]) for r in T.values() if r[2])[:10]
def nshort(num, dt):
    n = S(num); yy = str(dt)[2:4]
    return str(int(n[2:])) if len(n) == 6 and n.startswith(yy) and n.isdigit() else n
K = {'F': 'I'}
ARCH = set('GDIFN')
def did(r): return K.get(r[1], r[1]) + str(r[2])[:4] + '-' + nshort(r[3], r[2])
ID = {i: did(r) for i, r in T.items() if r[1] in ARCH and r[2]}
TIPO_NOME = {'G': "Rapporto d'intervento", 'D': 'DDT', 'I': 'Fattura', 'F': 'Fattura', 'B': 'Vendita al banco', 'N': 'Nota di credito'}

# numeri: ultimo numero per tipo e anno
numeri = collections.defaultdict(dict)
for r in T.values():
    if not r[2] or r[1] not in 'GQDIFNB': continue
    n = nshort(r[3], r[2])
    if not n.isdigit(): continue
    k = K.get(r[1], r[1]); y = str(r[2])[:4]
    numeri[k][y] = max(numeri[k].get(y, 0), int(n))

# ---------- righe ----------
cur.execute('select "IDDoc","CodArticolo","Desc","Qta","PrezzoNetto","Sconti","ImportoNettoRiga","IDDocRigaIncluso","MovMagazz","Note" from "TDocRighe" order by "IDDoc","IDDocRiga"')
RW = collections.defaultdict(list)
for x in cur:
    if x[0] in T: RW[x[0]].append(x)

# documenti richiamati (rapporto → DDT → fattura)
inc = collections.defaultdict(list)
for i, r in T.items():
    if r[11] and r[1] in 'BDFGI': inc[r[11]].append(i)

# ---------- storico per codice (stessa regola del 26/11: righe ricopiate contate una volta) ----------
sa = []; codici = set()
for idd, rl in RW.items():
    d = T[idd]
    if d[1] not in 'BDFGINHQ' or not d[2]: continue
    haInc = idd in inc and d[1] in 'BDFGI'
    for _, cod, de, q, pn, sc, imp, ri, mov, no in rl:
        if not S(cod): continue
        if ri is not None: continue
        if haInc and not mov: continue
        c = S(cod).upper(); codici.add(c)
        sa.append([c, d[1], str(d[2])[:10], S(d[3]), cliDi(d[4]) or ('F' + ANA[d[4]]['cod'] if d[4] in ANA and ANA[d[4]]['fornitore'] else ''), S(d[5]) or (ANA.get(d[4], {}).get('nome', '')),
                   F(q), r2(pn), S(sc), r2(imp), S(de)[:60]])
sa.sort(key=lambda x: x[2])

# ---------- archivio documenti ----------
cmp = collections.defaultdict(list)
for i, r in T.items():
    if i in ID and r[11] in ID: cmp[r[11]].append(ID[i])
arch = []; seen = set()
for i, r in T.items():
    if i not in ID: continue
    righe = []
    for _, cod, de, q, pn, sc, imp, ri, mov, no in RW.get(i, []):
        de = S(de); cod = S(cod)
        if S(no): de = (de + ' — ' + S(no)).strip(' —')
        if not cod and not de: continue
        righe.append([cod, de[:200], F(q), r2(pn), r2(imp)])
    s = -1 if r[1] == 'N' else 1
    x = dict(i=ID[i], k=K.get(r[1], r[1]), n=nshort(r[3], r[2]), d=str(r[2])[:10], cli=cliDi(r[4]), nm=S(r[5]) or ANA.get(r[4], {}).get('nome', ''), pi=S(r[6]),
             acc=S(r[12]), esi=S(r[13]), dif=S(r[14]), acq=S(r[15]), note=S(r[16])[:500], inc=ID.get(r[11], ''), cmp=cmp.get(i, []), pg=S(r[10]),
             imp=s * abs(r2(r[7])), iva=s * abs(r2(r[8])), tot=s * abs(r2(r[9])), r=righe)
    if x['i'] in seen: x['i'] += 'b' + str(i)
    seen.add(x['i']); arch.append(x)
arch.sort(key=lambda x: x['d'])

# ---------- clienti ----------
fatt = collections.defaultdict(lambda: collections.defaultdict(float)); ult = {}; nrip = collections.Counter(); ultrip = {}; art = collections.defaultdict(collections.Counter)
for i, r in T.items():
    if not r[2] or r[4] not in ANA: continue
    y = str(r[2])[:4]; dd = str(r[2])[:10]
    if r[1] in 'IFNB': fatt[r[4]][y] += (-abs(F(r[7])) if r[1] == 'N' else F(r[7]))
    if r[1] in 'BDFGIN': ult[r[4]] = max(ult.get(r[4], ''), dd)
    if r[1] == 'G': nrip[r[4]] += 1; ultrip[r[4]] = max(ultrip.get(r[4], ''), dd)
clienti = []
for ida, a in ANA.items():
    if not a['cliente'] or not a['nome']: continue
    o = {k: v for k, v in a.items() if v and k not in ('cliente', 'fornitore')}
    for y in ('2024', '2025', '2026'):
        v = round(fatt[ida].get(y, 0), 2)
        if v: o['fatt' + y] = ('%.2f' % v).replace('.', ',')
    if ida in ult: o['ultimoDoc'] = ult[ida]
    if nrip[ida]: o['nRip'] = str(nrip[ida]); o['ultimaRip'] = ultrip[ida]
    o['fontePag'] = 'anagrafica Danea'
    clienti.append(o)

# ---------- storico riparazioni per cliente (scheda cliente) ----------
rip = collections.defaultdict(list)
LAV = re.compile(r'^(MAN|RIP|GAR|MANUALE|TRASP|SPESE)$', re.I)
def utensile(rl):
    for x in rl:
        if S(x[1]) and not LAV.match(S(x[1])) and not F(x[4]): return S(x[1]), S(x[2])
    for x in rl:
        if S(x[1]) and not LAV.match(S(x[1])): return S(x[1]), S(x[2])
    return '', ''
for i, r in T.items():
    if r[1] != 'G' or r[4] not in ANA or not ANA[r[4]]['cod']: continue
    rl = RW.get(i, []); u, ud = utensile(rl)
    rip[ANA[r[4]]['cod']].append(dict(n=S(r[3]), d=str(r[2])[:10], u=u or ud, acc=S(r[12]), es=S(r[13]), g=' · '.join(v for v in (S(r[14]), S(r[15])) if v), t=r2(r[7]),
                                     r=[[S(x[1]), F(x[3])] for x in rl if S(x[1]) and S(x[1]) != u and not LAV.match(S(x[1]))]))
for k in rip: rip[k].sort(key=lambda x: x['d'], reverse=True)

# ---------- schede aperte e chiuse ----------
oggi = datetime.date.fromisoformat(ultima); da = (oggi - datetime.timedelta(days=GIORNI_APERTE)).isoformat()
def statoDa(esi):
    e = esi.upper()
    if 'PREVENTIV' in e: return 'Preventivo inviato'
    if 'ATTESA' in e: return 'Attesa ricambi'
    if 'RIPARAT' in e or 'RESO' in e or 'RIP.' in e or 'NON RIP' in e: return 'Pronto'
    return 'Ricevuto'
def dataAcq(t):
    m = re.search(r'(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})', t or '')
    if not m: return ''
    g, mm, a = m.groups(); a = ('20' + a) if len(a) == 2 else a
    try: return datetime.date(int(a), int(mm), int(g)).isoformat()
    except Exception: return ''
aperte = []; chiuse = {}; vecchie = 0
for i, r in T.items():
    if r[1] != 'G' or not r[2]: continue
    if r[11]:
        p = T.get(r[11])
        if p and str(r[2])[:4] >= str(oggi.year - 1): chiuse[ID[i]] = '%s %s del %s' % (TIPO_NOME.get(p[1], p[1]), nshort(p[3], p[2]), str(p[2])[:10])
        continue
    if str(r[2])[:10] < da:
        if str(r[2])[:4] == str(oggi.year): vecchie += 1
        continue
    rl = RW.get(i, []); u, ud = utensile(rl); a = ANA.get(r[4], {})
    ric = []; mo = 0.0; moD = []; gar = False
    for _, cod, de, q, pn, sc, imp, ri, mov, no in rl:
        cod = S(cod); de = S(de)
        if cod == u and not F(imp): continue
        if cod.upper() == 'GAR': gar = True; continue
        if not cod or LAV.match(cod):
            if F(imp): mo += F(imp)
            if de: moD.append(de)
            continue
        qq = F(q) or 1
        ric.append(dict(codice=cod.upper(), descr=de[:120], qty=qq, prezzo=round(F(imp) / qq * 1.22, 2) if F(imp) else round(F(pn) * 1.22, 2), daDanea=1))
    esi = S(r[13])
    if 'GARANZ' in esi.upper(): gar = True
    acq = dataAcq(S(r[15]))
    aperte.append(dict(danea=ID[i], dnum=S(r[3]), d=str(r[2])[:10], n=nshort(r[3], r[2]), cliente=S(r[5]) or a.get('nome', ''), cliId=cliDi(r[4]),
                       tel=a.get('cell') or a.get('tel') or '', email=a.get('email', ''), piva=a.get('piva') or a.get('cf') or '', ind=a.get('ind', ''), cap=a.get('cap', ''), citta=a.get('citta', ''), prov=a.get('prov', ''),
                       modello=(u or ud or 'UTENSILE').upper(), descrUt=ud, accessori=S(r[12]), difetto=S(r[14]), esito=esi, acquisto=S(r[15]), dataAcquisto=acq,
                       tipo='garanzia' if (gar or acq) else 'pagamento', stato=statoDa(esi), ricambi=ric,
                       manodopera=round(mo * 1.22, 2), manodoperaDescr=', '.join(moD)[:200], note=S(r[16])[:300], sconto=a.get('sconto', '')))
aperte.sort(key=lambda x: (x['d'], x['n']))

# rapporti recenti (aperti e chiusi): servono a riconoscere le riparazioni registrate sia in Danea sia nell'app
recenti = []
da_rec = (oggi - datetime.timedelta(days=GIORNI_RECENTI)).isoformat()
for i, r in T.items():
    if r[1] != 'G' or not r[2] or str(r[2])[:10] < da_rec: continue
    u, ud = utensile(RW.get(i, [])); a = ANA.get(r[4], {})
    recenti.append(dict(danea=ID[i], dnum=S(r[3]), d=str(r[2])[:10], n=nshort(r[3], r[2]), cliId=cliDi(r[4]), cliente=S(r[5]) or a.get('nome', ''),
                        tel=a.get('cell') or a.get('tel') or '', tel2=a.get('tel') or '', modello=(u or ud).upper(), chiusa=chiuse.get(ID[i], '') if r[11] else ''))
recenti.sort(key=lambda x: x['d'])

pac = dict(tipo='aggiornamento_danea', versione=1, al=ultima, creato=datetime.datetime.now().isoformat(timespec='seconds'), giorniAperte=GIORNI_APERTE,
           numeri=numeri, aperte=aperte, recenti=recenti, vecchieNonChiuse=vecchie, chiuse=chiuse, clienti=clienti, riparazioni=rip, archivio=arch,
           storicoArt=dict(righe=sa, info=dict(codici=len(codici), da=sa[0][2] if sa else '', a=sa[-1][2] if sa else '', righe=len(sa))))
with gzip.open(out, 'wt', encoding='utf-8') as f: json.dump(pac, f, ensure_ascii=False, separators=(',', ':'))
print(json.dumps(dict(al=ultima, numeri=numeri, aperte=len(aperte), recenti=len(recenti), statiAperte=collections.Counter(x['stato'] for x in aperte), tipiAperte=collections.Counter(x['tipo'] for x in aperte),
                      vecchieNonChiuse=vecchie, chiuse=len(chiuse), clienti=len(clienti), clientiRip=len(rip), archivio=len(arch), storicoArt=len(sa), file=out, MB=round(os.path.getsize(out) / 1e6, 1)), ensure_ascii=False, indent=1))
