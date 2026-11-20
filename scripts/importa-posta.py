#!/usr/bin/env python3
"""Copia tutte le email di una casella del vecchio server (IMAP) nella Posta dell'app su Cloudflare.
Lo lancia la GitHub Action "Importa posta dal vecchio server". Le email già copiate non vengono duplicate."""
import imaplib, os, re, ssl, sys, time, urllib.request, urllib.parse, email.utils

HOST = os.environ.get('IMPORT_HOST') or 'mail.semistore.it'
UTENTE = os.environ['IMPORT_USER']
PASS = os.environ['IMPORT_PASS']
CASELLA = (os.environ.get('CASELLA') or UTENTE.split('@')[0]).lower()
TOKEN = os.environ['ADMIN_TOKEN']
SITO = os.environ.get('SITO') or 'https://semistore.it'

def connetti():
    if os.environ.get('IMPORT_PROVA'):  # solo per le prove in locale
        m = imaplib.IMAP4(HOST, int(os.environ['IMPORT_PROVA'])); m.login(UTENTE, PASS); return m
    try:
        m = imaplib.IMAP4_SSL(HOST, 993, ssl_context=ssl.create_default_context())
        print('Connessione SSL verificata a', HOST)
    except ssl.SSLError as e:
        print('Certificato del vecchio server non valido (' + str(e)[:80] + '): copio lo stesso con connessione cifrata non verificata')
        ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
        m = imaplib.IMAP4_SSL(HOST, 993, ssl_context=ctx)
    m.login(UTENTE, PASS)
    return m

def cartella_di(flags, nome):
    f, n = flags.lower(), nome.lower().split('.')[-1].split('/')[-1]
    if '\\junk' in f or n in ('spam', 'junk', 'posta indesiderata'): return 'spam'
    if '\\sent' in f or n.startswith('sent') or 'inviat' in n: return 'inviati'
    if '\\trash' in f or n in ('trash', 'cestino', 'deleted messages', 'deleted items'): return 'cestino'
    if '\\drafts' in f or n in ('drafts', 'bozze'): return None
    if nome.upper() == 'INBOX': return 'arrivo'
    return 'archivio'

def invia(raw, cartella, letto, data):
    q = urllib.parse.urlencode({'importa': 1, 'casella': CASELLA, 'cartella': cartella, 'letto': 1 if letto else 0, 'data': data})
    req = urllib.request.Request(f'{SITO}/api/posta/in?{q}', data=raw, method='POST', headers={'x-posta-token': TOKEN, 'content-type': 'message/rfc822', 'user-agent': 'semistore-importa/1'})
    for t in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as r: return r.read().decode()
        except Exception as e:
            if t == 3: raise
            time.sleep(3 * (t + 1))

m = connetti()
typ, lista = m.list()
tot = copiate = doppie = errori = 0
for riga in lista:
    r = riga.decode(errors='replace')
    mm = re.match(r'\((?P<f>[^)]*)\) (?:"[^"]*"|NIL) (?P<n>.+)$', r)
    if not mm: continue
    flags, nome = mm.group('f'), mm.group('n').strip().strip('"')
    if '\\noselect' in flags.lower(): continue
    cart = cartella_di(flags, nome)
    if not cart: continue
    typ, dati = m.select('"' + nome + '"', readonly=True)
    if typ != 'OK': continue
    n = int(dati[0])
    print(f'{nome} → {cart}: {n} email')
    for i in range(1, n + 1):
        tot += 1
        try:
            typ, d = m.fetch(str(i), '(FLAGS INTERNALDATE RFC822.SIZE BODY.PEEK[])')
            meta = d[0][0].decode(errors='replace'); raw = d[0][1]
            if len(raw) > 24_000_000: print('  troppo grande, saltata:', i); continue
            letto = '\\Seen' in meta
            dt = re.search(r'INTERNALDATE "([^"]+)"', meta)
            data = 0
            if dt:
                tt = imaplib.Internaldate2tuple(('INTERNALDATE "' + dt.group(1) + '"').encode())
                if tt: data = int(time.mktime(tt) * 1000)
            res = invia(raw, cart, letto, data)
            if '"doppione":true' in res: doppie += 1
            else: copiate += 1
        except Exception as e:
            errori += 1; print('  errore email', i, str(e)[:120])
        if tot % 50 == 0: print(f'  … {tot} lette, {copiate} copiate, {doppie} già presenti, {errori} errori')
m.logout()
print(f'FATTO: {tot} email lette, {copiate} copiate, {doppie} già presenti, {errori} errori')
sys.exit(1 if errori and not copiate else 0)
