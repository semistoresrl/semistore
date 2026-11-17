import sys; sys.argv = ['x']
exec(open(__import__('os').path.join(__import__('os').path.dirname(__file__),'gen.py')).read().split('# ---------- 1.')[0])  # riusa page(), wm(), products()

W, H = 1080, 1350
TOP = f'<div style="position:absolute;left:70px;top:60px">{wm(76)}</div>'
DOTS = lambda i: '<div style="position:absolute;right:70px;top:84px;display:flex;gap:10px">' + ''.join(
    f'<span style="width:{34 if k==i else 12}px;height:12px;border-radius:6px;background:{"#f5b800" if k==i else "#3a3e45"}"></span>' for k in range(5)) + '</div>'
SWIPE = '<div style="position:absolute;right:70px;bottom:60px;font-size:30px;font-weight:800;color:#f5b800">Scorri →</div>'

# 1 — copertina
b = '<div style="position:absolute;left:0;right:0;bottom:0;height:620px;background:#fff"></div>'
b += '<div style="position:absolute;left:0;right:0;bottom:0;height:620px">' + ''.join(
    f'<img src="p_{n}.webp" style="position:absolute;left:{x}px;top:{y}px;width:{s}px;mix-blend-mode:multiply">'
    for n, x, y, s in [('dcs570n', 330, 20, 430), ('dcf887n', 40, 140, 330), ('dcg405nt', 600, 300, 420), ('dcb548', 790, 10, 240)]) + '</div>'
b += '<div class=stripe style="left:-40px;right:-40px;top:712px;bottom:auto;height:22px;transform:skewY(-3deg)"></div>'
b += TOP + DOTS(0) + """
<div style="position:absolute;left:70px;top:190px;right:70px">
 <div style="display:inline-block;background:#f5b800;color:#15171a;font-weight:900;font-size:38px;padding:8px 22px;border-radius:10px;transform:skewX(-8deg)">⚡ OFFERTE FLASH</div>
 <div style="font-weight:900;font-size:150px;line-height:.95;margin-top:26px">fino al <span class=y>-60%</span></div>
 <div style="font-size:40px;font-weight:700;margin-top:22px;color:#e6e7e8">su oltre 800 utensili professionali</div>
 <div style="font-size:34px;font-weight:600;margin-top:10px;color:#b9bbbf">Solo fino a <b style="color:#fff">giovedì ore 18:30</b></div>
</div>"""
page('post1-1', W, H, b)

# 2 — marchi e categorie
cats = ['Trapani e avvitatori', 'Smerigliatrici', 'Seghe circolari', 'Tassellatori', 'Batterie XR e FLEXVOLT', 'Utensili manuali', 'Valigette TSTAK', 'Misura e laser']
b = TOP + DOTS(1) + f"""
<div style="position:absolute;left:70px;top:270px;right:70px">
 <div style="font-weight:900;font-size:92px;line-height:1">I marchi che usi<br><span class=y>in cantiere</span></div>
 <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:50px">
  {''.join(f'<div style="background:#f5b800;color:#15171a;font-weight:900;font-size:46px;padding:22px 26px;border-radius:14px;text-align:center">{m}</div>' for m in ['DEWALT','STANLEY','USAG','BLACK+DECKER'])}
 </div>
 <div style="display:flex;flex-wrap:wrap;gap:16px;margin-top:60px">
  {''.join(f'<span style="border:2px solid #3a3e45;border-radius:40px;padding:12px 24px;font-size:34px;font-weight:600">{c}</span>' for c in cats)}
 </div>
</div>""" + SWIPE
page('post1-2', W, H, b)

# 3 — scadenza
b = TOP + DOTS(2) + """
<div style="position:absolute;left:70px;right:70px;top:330px;text-align:center">
 <div style="font-size:44px;font-weight:700;color:#b9bbbf">Quando finisce, finisce.</div>
 <div style="margin:50px auto 0;width:760px;background:#f5b800;color:#15171a;border-radius:28px;padding:50px 0 44px">
  <div style="font-size:40px;font-weight:800;letter-spacing:.12em">CHIUDE</div>
  <div style="font-size:150px;font-weight:900;line-height:1;margin-top:10px">GIOVEDÌ</div>
  <div style="font-size:64px;font-weight:900;margin-top:16px">19 NOVEMBRE · 18:30</div>
 </div>
 <div style="font-size:42px;font-weight:700;margin-top:60px">Non aspettare<br><span class=y>l'ultimo giorno.</span></div>
</div>""" + SWIPE
page('post1-3', W, H, b)

# 4 — come fare
steps = [('1', 'Link in bio', 'apri <b class=y>semistore.it</b>'), ('2', 'Tocca “Offerte Flash ⚡”', 'scegli e ordina'),
         ('3', 'Preferisci chiedere?', 'chiamaci: <b class=y>081 553 6604</b>'), ('4', 'Oppure passa in negozio', 'Viale Marconi 225, Casavatore')]
b = TOP + DOTS(3) + f"""
<div style="position:absolute;left:70px;top:260px;right:70px">
 <div style="font-weight:900;font-size:92px;line-height:1">Come<br><span class=y>approfittarne</span></div>
 <div style="margin-top:56px;display:flex;flex-direction:column;gap:44px">
 {''.join(f'<div style="display:flex;align-items:center;gap:30px"><div class=badge style="width:96px;height:96px;font-size:54px;flex:none">{n}</div><div><div style="font-size:44px;font-weight:800">{t}</div><div style="font-size:34px;color:#d6d7d9;margin-top:4px">{s}</div></div></div>' for n, t, s in steps)}
 </div>
</div>""" + SWIPE
page('post1-4', W, H, b)

# 5 — chiusura: assistenza + call to action
b = '<div style="position:absolute;left:0;right:0;top:0;height:560px;background:#fff"></div>'
b += '<div style="position:absolute;left:0;right:0;top:0;height:560px"><img src="p_dck4006p3t.webp" style="position:absolute;left:240px;top:30px;width:600px;mix-blend-mode:multiply"></div>'
b += '<div class=stripe style="left:-40px;right:-40px;top:550px;bottom:auto;height:22px;transform:skewY(-3deg)"></div>'
b += DOTS(4) + """
<div style="position:absolute;left:70px;right:70px;top:640px">
 <div style="font-weight:900;font-size:70px;line-height:1.02">E se un giorno si rompe?<br><span class=y>Lo ripariamo noi.</span></div>
 <div style="font-size:34px;color:#d6d7d9;margin-top:24px">Centro assistenza autorizzato DEWALT dal 1997.<br>Ricambi originali, preventivo prima di ogni lavoro.</div>
 <div style="margin-top:46px;background:#23262b;border:2px solid #f5b800;border-radius:18px;padding:26px 30px;font-size:38px;font-weight:800">👇 Tagga il collega che deve cambiare l'avvitatore</div>
</div>
<div style="position:absolute;left:70px;bottom:56px">""" + wm(70) + '</div>'
page('post1-5', W, H, b)
print('ok')
