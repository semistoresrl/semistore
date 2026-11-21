import sys; sys.argv = ['x']
exec(open(__import__('os').path.join(__import__('os').path.dirname(__file__),'gen.py')).read().split('# ---------- 1.')[0])  # riusa page(), wm()

# Immagine singola 21/11/2026: assistenza "Il tuo DEWALT non parte? Non buttarlo"
# Prima di lanciare: copiare qui public/logo.svg e public/img/hero/dcd805nt.webp
W, H = 1080, 1350
punti = [('Centro assistenza <b>autorizzato</b>', 'DEWALT · STANLEY · BLACK+DECKER'),
         ('<b>Ricambi originali</b>', 'in garanzia e fuori garanzia'),
         ('<b>Preventivo</b> prima di toccarlo', 'decidi tu se ripararlo')]
b = f"""
<div style="position:absolute;right:-180px;top:330px;width:760px;height:760px;border-radius:50%;background:radial-gradient(circle,#2c2f35 0%,#15171a 70%)"></div>
<img src="dcd805nt.webp" style="position:absolute;right:-40px;top:360px;width:560px;transform:rotate(-14deg);filter:drop-shadow(0 30px 40px rgba(0,0,0,.6))">
<div style="position:absolute;left:70px;top:60px">{wm(72)}</div>
<div style="position:absolute;left:70px;top:230px;width:900px">
 <div style="font-weight:900;font-size:104px;line-height:.95">Il tuo DEWALT<br>non parte?</div>
</div>
<div style="position:absolute;left:0;top:480px;background:#f5b800;color:#15171a;padding:20px 50px 22px 70px;transform:skewY(-3deg)">
 <div style="font-weight:900;font-size:96px;line-height:1;transform:skewY(3deg)">NON BUTTARLO.</div>
</div>
<div style="position:absolute;left:70px;top:690px;width:560px">
 <div style="font-size:44px;font-weight:800;margin-bottom:26px">Lo ripariamo noi <span class=y>dal 1997</span></div>
 {''.join(f'<div style="display:flex;gap:20px;align-items:flex-start;margin-bottom:24px"><div class=badge style="width:50px;height:50px;font-size:32px;flex:none">✓</div><div><div style="font-size:34px;font-weight:600;line-height:1.15">{t}</div><div style="font-size:26px;color:#b9bbbf;margin-top:4px">{s}</div></div></div>' for t, s in punti)}
</div>
<div style="position:absolute;left:40px;right:40px;bottom:50px;background:#23262b;border:3px solid #f5b800;border-radius:22px;padding:26px 34px;display:flex;align-items:center;justify-content:space-between">
 <div><div style="font-size:30px;color:#d6d7d9;font-weight:600">Mandaci foto e modello su WhatsApp</div>
 <div style="font-size:54px;font-weight:900" class=y>375 626 6947</div></div>
 <div style="text-align:right;font-size:26px;color:#d6d7d9;font-weight:600;line-height:1.3">Viale Marconi 225<br>Casavatore (NA)</div>
</div>"""
page('non-buttarlo', W, H, b)
print('ok')
