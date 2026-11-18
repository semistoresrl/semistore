# Reel 1080x1920 "Offerte Flash – ultime ore" (18/11/2026): sfondo + video negozio + didascalie a tempo
import subprocess, pathlib, sys
exec(open(pathlib.Path(__file__).resolve().parent.joinpath('gen.py')).read().split('# ---------- 1.')[0])
W, H = 1080, 1920
VY = 560  # top del video (1080x607)

def tpage(name, body):  # pagina con sfondo trasparente
    html = f"<!doctype html><html><head><meta charset=utf-8><style>{CSS % (W, H)} body{{background:transparent!important}}</style></head><body>{body}</body></html>"
    f = D / f'{name}.html'; f.write_text(html)
    subprocess.run(['google-chrome', '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
                    '--force-device-scale-factor=1', f'--window-size={W},{H}', '--virtual-time-budget=3000',
                    '--default-background-color=00000000', f'--screenshot={OUT}/{name}.png', f'file://{f}'], check=True, capture_output=True)

# sfondo fisso
b = f"""<div style="position:absolute;left:70px;top:150px">{wm(70)}</div>
<div style="position:absolute;left:70px;right:70px;top:290px">
 <div style="display:inline-block;background:#f5b800;color:#15171a;font-weight:900;font-size:40px;padding:8px 22px;border-radius:10px;transform:skewX(-8deg)">OFFERTE FLASH · ULTIME ORE</div>
 <div style="font-weight:900;font-size:104px;line-height:.95;margin-top:22px">fino al <span class=y>-60%</span></div>
</div>
<div class=stripe style="left:-40px;right:-40px;top:{VY-14}px;bottom:auto;height:14px;transform:none"></div>
<div class=stripe style="left:-40px;right:-40px;top:{VY+607}px;bottom:auto;height:14px;transform:none"></div>"""
page('reel18-bg', W, H, b)

caps = [
 ('Oltre <span class=y>800 utensili</span><br>DEWALT · STANLEY<br>USAG · BLACK+DECKER', ''),
 ('Chiude <span class=y>domani</span><br>giovedì 19/11 · 18:30', 'Quando finisce, finisce.'),
 ('Link in bio<br><span class=y>semistore.it</span>', '📞 081 553 6604 · Viale Marconi 225, Casavatore'),
]
for i, (t, s) in enumerate(caps):
    tpage(f'reel18-cap{i}', f"""<div style="position:absolute;left:70px;right:70px;top:{VY+607+60}px">
 <div style="font-weight:900;font-size:68px;line-height:1.05;white-space:nowrap">{t}</div>
 <div style="font-size:36px;font-weight:600;color:#d6d7d9;margin-top:20px">{s}</div></div>""")
print('ok')
