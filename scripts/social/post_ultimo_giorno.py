import sys; sys.argv = ['x']
exec(open(__import__('os').path.join(__import__('os').path.dirname(__file__),'gen.py')).read().split('# ---------- 1.')[0])  # riusa page(), wm()

# Carosello 19/11/2026: Offerte Flash, ultimo giorno (chiude alle 18:30)
W, H = 1080, 1350
N = 4
TOP = f'<div style="position:absolute;left:70px;top:60px">{wm(76)}</div>'
DOTS = lambda i: '<div style="position:absolute;right:70px;top:84px;display:flex;gap:10px">' + ''.join(
    f'<span style="width:{34 if k==i else 12}px;height:12px;border-radius:6px;background:{"#f5b800" if k==i else "#3a3e45"}"></span>' for k in range(N)) + '</div>'
SWIPE = '<div style="position:absolute;right:70px;bottom:60px;font-size:30px;font-weight:800;color:#f5b800">Scorri →</div>'

# 1 — copertina: fascia gialla "OGGI ULTIMO GIORNO"
b = '<div style="position:absolute;left:0;right:0;bottom:0;height:560px;background:#fff"></div>'
b += '<div style="position:absolute;left:0;right:0;bottom:0;height:560px">' + ''.join(
    f'<img src="p_{n}.webp" style="position:absolute;left:{x}px;top:{y}px;width:{s}px;mix-blend-mode:multiply">'
    for n, x, y, s in [('dcf887n', 40, 70, 300), ('dcs570n', 330, 30, 420), ('dch273nt', 700, 120, 340)]) + '</div>'
b += '<div class=stripe style="left:-40px;right:-40px;top:775px;bottom:auto;height:22px;transform:skewY(-3deg)"></div>'
b += TOP + DOTS(0) + """
<div style="position:absolute;left:0;right:0;top:200px;background:#f5b800;color:#15171a;padding:26px 70px 30px;transform:skewY(-3deg)">
 <div style="font-weight:900;font-size:112px;line-height:.92;transform:skewY(3deg)">OGGI<br>ULTIMO GIORNO</div>
</div>
<div style="position:absolute;left:70px;right:70px;top:600px">
 <div style="font-size:52px;font-weight:900">Offerte Flash fino al <span class=y>-60%</span></div>
 <div style="font-size:40px;font-weight:700;margin-top:14px;color:#e6e7e8">Chiude alle <b style="color:#fff;background:#c62828;padding:2px 14px;border-radius:8px">18:30</b> · poi non tornano</div>
</div>"""
page('ug-1', W, H, b)

# 2 — cosa trovi
cats = ['Trapani e avvitatori', 'Smerigliatrici', 'Seghe circolari', 'Tassellatori', 'Batterie XR e FLEXVOLT', 'Utensili manuali', 'Valigette TSTAK', 'Misura e laser']
b = TOP + DOTS(1) + f"""
<div style="position:absolute;left:70px;top:300px;right:70px">
 <div style="font-weight:900;font-size:200px;line-height:.9" class=y>800+</div>
 <div style="font-weight:900;font-size:66px;line-height:1.05;margin-top:10px">utensili professionali<br>scontati fino a stasera</div>
 <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:44px">
  {''.join(f'<div style="background:#f5b800;color:#15171a;font-weight:900;font-size:42px;padding:18px 20px;border-radius:14px;text-align:center">{m}</div>' for m in ['DEWALT','STANLEY','USAG','BLACK+DECKER'])}
 </div>
 <div style="display:flex;flex-wrap:wrap;gap:14px;margin-top:44px">
  {''.join(f'<span style="border:2px solid #3a3e45;border-radius:40px;padding:10px 22px;font-size:32px;font-weight:600">{c}</span>' for c in cats)}
 </div>
</div>""" + SWIPE
page('ug-2', W, H, b)

# 3 — come fare prima delle 18:30
steps = [('1', 'Link in bio', 'apri <b class=y>semistore.it</b>'), ('2', 'Tocca “Offerte Flash”', 'scegli e ordina entro le 18:30'),
         ('3', 'Hai un dubbio?', 'WhatsApp <b class=y>375 626 6947</b>'), ('4', 'Preferisci chiamare?', '<b class=y>081 553 6604</b> · Viale Marconi 225')]
b = TOP + DOTS(2) + f"""
<div style="position:absolute;left:70px;top:250px;right:70px">
 <div style="font-weight:900;font-size:92px;line-height:1">Hai tempo<br><span class=y>fino alle 18:30</span></div>
 <div style="margin-top:60px;display:flex;flex-direction:column;gap:44px">
 {''.join(f'<div style="display:flex;align-items:center;gap:30px"><div class=badge style="width:96px;height:96px;font-size:54px;flex:none">{n}</div><div><div style="font-size:44px;font-weight:800">{t}</div><div style="font-size:34px;color:#d6d7d9;margin-top:4px">{s}</div></div></div>' for n, t, s in steps)}
 </div>
</div>""" + SWIPE
page('ug-3', W, H, b)

# 4 — chiusura: tagga il collega
b = DOTS(3) + """
<div style="position:absolute;left:70px;right:70px;top:250px;text-align:center">
 <div style="font-size:44px;font-weight:700;color:#b9bbbf">C'è sempre uno che dice</div>
 <div style="font-weight:900;font-size:110px;line-height:1;margin-top:20px">“lo compro<br><span class=y>domani”</span></div>
 <div style="font-size:44px;font-weight:700;margin-top:40px">Domani è tardi.</div>
 <div style="margin:60px auto 0;background:#23262b;border:3px solid #f5b800;border-radius:20px;padding:30px 34px;font-size:42px;font-weight:800">👇 Taggalo nei commenti<br>prima delle 18:30</div>
</div>
<div style="position:absolute;left:0;right:0;bottom:70px;display:flex;justify-content:center">""" + wm(80) + '</div>'
page('ug-4', W, H, b)
print('ok')
