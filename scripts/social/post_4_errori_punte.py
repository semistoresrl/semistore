import sys; sys.argv = ['x']
exec(open(__import__('os').path.join(__import__('os').path.dirname(__file__),'gen.py')).read().split('# ---------- 1.')[0])  # riusa page(), wm()

# Carosello 28/11/2026: consiglio pratico "4 errori che bruciano punte e dischi"
# Solo indicazioni generali (nessun prezzo). Prima di lanciare: copiare qui public/logo.svg
# e da public/img/hero/: dcg405nt, dcd996nt, dch273nt (.webp); hero805.webp e' gia' qui.
W, H = 1080, 1350
N = 6

def dots(i):
    return '<div style="position:absolute;right:70px;top:92px;display:flex;gap:10px">' + ''.join(
        f'<span style="width:{34 if k == i else 12}px;height:12px;border-radius:6px;background:{"#f5b800" if k == i else "#4a4d53"}"></span>' for k in range(N)) + '</div>'

def head(i):
    return f'<div style="position:absolute;left:70px;top:60px">{wm(60)}</div>' + dots(i)

def foot(t='semistore.it · Viale Marconi 225, Casavatore'):
    return f'<div style="position:absolute;left:70px;right:70px;bottom:46px;font-size:26px;color:#9a9ca1;font-weight:600;display:flex;justify-content:space-between"><span>{t}</span><span class=y>Scorri →</span></div>'

glow = lambda x, y, s: f'<div style="position:absolute;left:{x}px;top:{y}px;width:{s}px;height:{s}px;border-radius:50%;background:radial-gradient(circle,#2e3138 0%,#15171a 70%)"></div>'

# 1 — gancio
s1 = head(0) + glow(160, 560, 820) + f"""
<img src="dcg405nt.webp" style="position:absolute;left:10px;top:860px;width:540px;transform:rotate(-12deg);filter:drop-shadow(0 30px 40px rgba(0,0,0,.6))">
<img src="dcd996nt.webp" style="position:absolute;right:40px;top:740px;width:400px;transform:rotate(6deg);filter:drop-shadow(0 30px 40px rgba(0,0,0,.6))">
<div style="position:absolute;left:70px;top:200px;width:950px">
 <div class=badge style="display:inline-grid;font-size:34px;padding:10px 24px;margin-bottom:28px">DA SALVARE</div>
 <div style="font-weight:900;font-size:90px;line-height:.98">Punte e dischi<br>durano poco?<br><span class=y>Li stai bruciando<br>tu. Ecco come.</span></div>
 <div style="font-size:38px;font-weight:600;color:#d6d7d9;margin-top:26px">4 errori che vediamo ogni giorno.<br>Il n. 2 lo fanno quasi tutti.</div>
</div>""" + foot()

def errore(i, num, titolo, succede, fai, img, iw, rot, top=700):
    return head(i) + glow(420, top - 80, 700) + f"""
<img src="{img}" style="position:absolute;right:30px;top:{top}px;width:{iw}px;transform:rotate({rot}deg);filter:drop-shadow(0 30px 40px rgba(0,0,0,.6));opacity:.95">
<div style="position:absolute;left:70px;top:190px;width:940px">
 <div style="display:flex;align-items:flex-end;gap:26px"><div style="font-weight:900;font-size:230px;line-height:.8" class=y>{num}</div>
 <div style="font-size:32px;font-weight:800;color:#e5484d;letter-spacing:.08em;padding-bottom:8px">✕ ERRORE</div></div>
 <div style="font-weight:900;font-size:84px;line-height:.98;margin-top:20px">{titolo}</div>
</div>
<div style="position:absolute;left:70px;top:{top + 10}px;width:520px">
 <div style="font-size:28px;font-weight:700;color:#9a9ca1;letter-spacing:.08em;text-transform:uppercase">Cosa succede</div>
 <div style="font-size:36px;font-weight:600;line-height:1.22;margin-top:10px">{succede}</div>
</div>
<div style="position:absolute;left:40px;right:40px;bottom:110px;background:#23262b;border-left:12px solid #f5b800;border-radius:18px;padding:24px 32px">
 <div style="font-size:26px;font-weight:700;color:#f5b800;letter-spacing:.08em;text-transform:uppercase">✓ Fai così</div>
 <div style="font-size:36px;font-weight:700;line-height:1.2;margin-top:6px">{fai}</div>
</div>""" + foot()

s2 = errore(1, '1', 'Spingi con<br>tutto il peso', 'La punta si scalda, perde il filo e diventa blu. Fori lenti e punta da buttare.',
            'Pressione costante e moderata: lascia lavorare l\'utensile. Deve uscire truciolo, non fumo.', 'dcd996nt.webp', 400, 8, 660)
s3 = errore(2, '2', 'Giri al massimo<br>sul ferro', 'Sul metallo la velocità alta surriscalda la punta: si spunta dopo pochi fori.',
            'Sul ferro giri bassi e una goccia d\'olio da taglio. Più grande il foro, più bassi i giri.', 'hero805.webp', 320, -6, 600)
s4 = errore(3, '3', 'Percussione su<br>piastrelle e gres', 'La piastrella si crepa e la punta si rovina. La percussione serve solo su muro e cemento.',
            'Su ceramica e gres: punta per piastrelle o diamantata, percussione spenta.', 'dch273nt.webp', 420, -6, 720)
s5 = errore(4, '4', 'Sbavare col disco<br>da taglio', 'Il disco da taglio è sottile: usato di piatto si può spaccare mentre gira.',
            'Per sbavare usa il disco da sbavo. E sempre con la protezione montata.', 'dcg405nt.webp', 470, -8, 650)

# 6 — CTA
s6 = head(5) + glow(260, 700, 560) + f"""
<div style="position:absolute;left:70px;top:200px;width:940px">
 <div style="font-weight:900;font-size:92px;line-height:.95">Quale facevi<br><span class=y>anche tu?</span></div>
 <div style="font-size:38px;font-weight:600;color:#d6d7d9;margin-top:26px">Scrivi nei commenti il <b class=y>numero</b> 👇 (vale anche "tutti e 4")</div>
</div>
<div style="position:absolute;left:70px;top:580px;display:flex;flex-direction:column;gap:22px;width:940px">
 <div style="font-size:35px;font-weight:600">🔖 <b>Salva</b> il post: ti serve al prossimo foro</div>
 <div style="font-size:35px;font-weight:600">🏷️ <b>Tagga</b> il collega che spacca una punta al giorno</div>
 <div style="font-size:35px;font-weight:600">🛒 Punte, dischi e accessori <b>DEWALT</b> su semistore.it</div>
 <div style="font-size:35px;font-weight:600">🔧 Concessionario e assistenza autorizzata dal 1997</div>
</div>
<div style="position:absolute;left:40px;right:40px;bottom:150px;background:#f5b800;color:#15171a;border-radius:22px;padding:28px 34px">
 <div style="font-size:30px;font-weight:700">Non sai quale punta o disco ti serve? Chiedi a noi</div>
 <div style="font-size:58px;font-weight:900">WhatsApp 375 626 6947</div>
</div>
<div style="position:absolute;left:70px;right:70px;bottom:60px;font-size:25px;color:#9a9ca1;font-weight:600">Viale Marconi 225, Casavatore (NA) · semistore.it</div>"""

for i, s in enumerate([s1, s2, s3, s4, s5, s6], 1):
    page(f'4-errori-{i}', W, H, s)
print('ok')
