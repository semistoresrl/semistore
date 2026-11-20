# Reel 1080x1920 "Concessionario esclusivo DEWALT, STANLEY e BLACK+DECKER" (20/11/2026)
# sfondo + video negozio (ritagliato senza le vecchie scritte) + testi a tempo; gancio dal primo fotogramma
import subprocess, pathlib
exec(open(pathlib.Path(__file__).resolve().parent.joinpath('gen.py')).read().split('# ---------- 1.')[0])
W, H = 1080, 1920
VY, VH = 640, 611  # video 1080x611 (ritaglio 640x362 del video 854x480)

def tpage(name, body):
    html = f"<!doctype html><html><head><meta charset=utf-8><style>{CSS % (W, H)} body{{background:transparent!important}}</style></head><body>{body}</body></html>"
    f = D / f'{name}.html'; f.write_text(html)
    subprocess.run(['google-chrome', '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
                    '--force-device-scale-factor=1', f'--window-size={W},{H}', '--virtual-time-budget=3000',
                    '--default-background-color=00000000', f'--screenshot={OUT}/{name}.png', f'file://{f}'], check=True, capture_output=True)

page('reel20-bg', W, H, f"""<div style="position:absolute;left:70px;top:120px">{wm(64)}</div>
<div class=stripe style="left:-40px;right:-40px;top:{VY-14}px;bottom:auto;height:14px;transform:none"></div>
<div class=stripe style="left:-40px;right:-40px;top:{VY+VH}px;bottom:auto;height:14px;transform:none"></div>
<div style="position:absolute;left:70px;right:70px;bottom:120px;font-size:32px;font-weight:600;color:#b9bbbf">📍 Viale Marconi 225, Casavatore (NA) · semistore.it</div>""")

caps = [  # (titolo sopra il video, testo sotto)
 ('Cerchi <span class=y>DEWALT</span><br>in Campania?', 'Il concessionario<br><span class=y>esclusivo</span> è a Casavatore'),
 ('Concessionario<br><span class=y>esclusivo</span>', 'DEWALT · STANLEY<br>BLACK+DECKER'),
 ('Campania · Lazio<br>Molise · Basilicata', 'Un solo punto di riferimento<br><span class=y>per 4 regioni</span>'),
 ('Vendita <span class=y>+</span><br>assistenza autorizzata', 'Ricambi originali<br><span class=y>dal 1997</span>'),
 ('Tagga il collega<br>che <span class=y>giura su DEWALT</span>', 'Shop online <span class=y>semistore.it</span><br>📞 081 553 6604'),
]
for i, (t, s) in enumerate(caps):
    tpage(f'reel20-cap{i}', f"""<div style="position:absolute;left:70px;right:70px;top:250px;height:{VY-14-250}px;display:flex;align-items:center">
 <div style="font-weight:900;font-size:{100 if i==0 else 88}px;line-height:.98;letter-spacing:-.01em">{t}</div></div>
<div style="position:absolute;left:70px;right:70px;top:{VY+VH+70}px">
 <div style="font-weight:800;font-size:66px;line-height:1.08">{s}</div></div>""")
print('ok')
