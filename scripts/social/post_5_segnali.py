import sys; sys.argv = ['x']
exec(open(__import__('os').path.join(__import__('os').path.dirname(__file__),'gen.py')).read().split('# ---------- 1.')[0])  # riusa page(), wm()

# Carosello 25/11/2026: assistenza "5 segnali che il tuo utensile va portato in assistenza"
# Solo indicazioni generali (nessun prezzo). Prima di lanciare: copiare qui public/logo.svg
# e da public/img/hero/: dcg405nt, dcd996nt, dch273nt, dcs573nt, dcf922nt (.webp)
W, H = 1080, 1350
N = 7

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
<img src="dcg405nt.webp" style="position:absolute;left:20px;top:820px;width:520px;transform:rotate(-12deg);filter:drop-shadow(0 30px 40px rgba(0,0,0,.6))">
<img src="dcd996nt.webp" style="position:absolute;right:40px;top:760px;width:400px;transform:rotate(6deg);filter:drop-shadow(0 30px 40px rgba(0,0,0,.6))">
<div style="position:absolute;left:70px;top:200px;width:950px">
 <div class=badge style="display:inline-grid;font-size:34px;padding:10px 24px;margin-bottom:28px">ATTENZIONE</div>
 <div style="font-weight:900;font-size:92px;line-height:.98">5 segnali che<br>il tuo utensile<br><span class=y>sta per lasciarti<br>a piedi</span></div>
 <div style="font-size:38px;font-weight:600;color:#d6d7d9;margin-top:26px">Il n. 3 lo ignorano quasi tutti.</div>
</div>""" + foot()

def segnale(i, num, titolo, perche, fai, img, iw, rot, top=700):
    return head(i) + glow(420, top - 80, 700) + f"""
<img src="{img}" style="position:absolute;right:30px;top:{top}px;width:{iw}px;transform:rotate({rot}deg);filter:drop-shadow(0 30px 40px rgba(0,0,0,.6));opacity:.95">
<div style="position:absolute;left:70px;top:190px;width:940px">
 <div style="font-weight:900;font-size:230px;line-height:.8" class=y>{num}</div>
 <div style="font-weight:900;font-size:84px;line-height:.98;margin-top:20px">{titolo}</div>
</div>
<div style="position:absolute;left:70px;top:{top + 10}px;width:520px">
 <div style="font-size:28px;font-weight:700;color:#9a9ca1;letter-spacing:.08em;text-transform:uppercase">Cosa può essere</div>
 <div style="font-size:36px;font-weight:600;line-height:1.22;margin-top:10px">{perche}</div>
</div>
<div style="position:absolute;left:40px;right:40px;bottom:110px;background:#23262b;border-left:12px solid #f5b800;border-radius:18px;padding:24px 32px">
 <div style="font-size:26px;font-weight:700;color:#f5b800;letter-spacing:.08em;text-transform:uppercase">Cosa fare</div>
 <div style="font-size:36px;font-weight:700;line-height:1.2;margin-top:6px">{fai}</div>
</div>""" + foot()

s2 = segnale(1, '1', 'Puzza di<br>bruciato', 'Motore che si surriscalda, avvolgimenti sotto sforzo o polvere che lo soffoca.',
             'Spegnilo e lascialo raffreddare. Se torna, fallo controllare.', 'dcg405nt.webp', 470, -8, 650)
s3 = segnale(2, '2', 'Scintille che<br>prima non c\'erano', 'Spazzole consumate o collettore rovinato (sui motori a spazzole).',
             'Non aspettare che si fermi del tutto: costa meno intervenire prima.', 'dcd996nt.webp', 400, 8, 640)
s4 = segnale(3, '3', 'Perde forza<br>sotto sforzo', 'Batteria stanca, contatti sporchi, elettronica o motore. Non è "normale vecchiaia".',
             'Prova con un\'altra batteria: se lo fa ancora, è l\'utensile.', 'dcf922nt.webp', 330, 6, 640)
s5 = segnale(4, '4', 'Rumore metallico<br>o vibra di più', 'Cuscinetti o ingranaggi consumati. Se continui, si rovina il resto.',
             'Fermati: un cuscinetto costa poco, un motore no.', 'dch273nt.webp', 420, -6, 720)
s6 = segnale(5, '5', 'La lama o la punta<br>"balla"', 'Mandrino, albero o flangia usurati: tagli storti e lavoro pericoloso.',
             'Non usarlo così: è anche una questione di sicurezza.', 'dcs573nt.webp', 440, 4, 660)

# 7 — CTA
s7 = head(6) + glow(260, 700, 560) + f"""
<div style="position:absolute;left:70px;top:200px;width:940px">
 <div style="font-weight:900;font-size:92px;line-height:.95">Ne hai notato<br><span class=y>almeno uno?</span></div>
 <div style="font-size:38px;font-weight:600;color:#d6d7d9;margin-top:26px">Scrivi nei commenti il <b class=y>numero</b> che ti è capitato 👇</div>
</div>
<div style="position:absolute;left:70px;top:560px;display:flex;flex-direction:column;gap:22px;width:940px">
 <div style="font-size:35px;font-weight:600">🔧 Centro assistenza <b>autorizzato DEWALT</b> dal 1997</div>
 <div style="font-size:35px;font-weight:600">✅ Ricambi originali, in garanzia e fuori garanzia</div>
 <div style="font-size:35px;font-weight:600">💬 <b>Preventivo prima</b> di ogni intervento</div>
 <div style="font-size:35px;font-weight:600">🔖 <b>Salva</b> il post · 🏷️ <b>tagga</b> il collega col trapano che fuma</div>
</div>
<div style="position:absolute;left:40px;right:40px;bottom:150px;background:#f5b800;color:#15171a;border-radius:22px;padding:28px 34px">
 <div style="font-size:30px;font-weight:700">Mandaci foto e modello, ti diciamo come procedere</div>
 <div style="font-size:58px;font-weight:900">WhatsApp 375 626 6947</div>
</div>
<div style="position:absolute;left:70px;right:70px;bottom:60px;font-size:25px;color:#9a9ca1;font-weight:600">Viale Marconi 225, Casavatore (NA) · semistore.it/assistenza</div>"""

for i, s in enumerate([s1, s2, s3, s4, s5, s6, s7], 1):
    page(f'5-segnali-{i}', W, H, s)
print('ok')
