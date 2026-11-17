import subprocess, pathlib
D = pathlib.Path(__file__).resolve().parent
OUT = D / 'out'; OUT.mkdir(exist_ok=True)

CSS = """
@font-face{font-family:A;src:url(archivo.woff2) format('woff2');font-weight:100 900}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:%dpx;height:%dpx;overflow:hidden}
body{font-family:A,sans-serif;background:#15171a;color:#fff;position:relative}
.badge{background:#f5b800;color:#15171a;display:grid;place-items:center;font-weight:900;border-radius:14%%;transform:skewX(-8deg)}
.wm{display:flex;align-items:center}
.wm .t{display:flex;flex-direction:column;line-height:1.02}
.wm b{font-weight:900;letter-spacing:.04em}
.wm small{letter-spacing:.2em;color:#b9bbbf;font-weight:600}
.y{color:#f5b800}
.prod{position:absolute;inset:0;background:#fff}
.prod img{position:absolute;mix-blend-mode:multiply}
.stripe{position:absolute;top:-10%%;bottom:-10%%;background:#f5b800;transform:skewX(-12deg)}
.ink{position:absolute;top:-10%%;bottom:-10%%;background:#15171a;transform:skewX(-12deg)}
"""

def page(name, w, h, body):
    html = f"<!doctype html><html><head><meta charset=utf-8><style>{CSS % (w, h)}</style></head><body>{body}</body></html>"
    f = D / f'{name}.html'; f.write_text(html)
    subprocess.run(['google-chrome', '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
                    '--force-device-scale-factor=1', f'--window-size={w},{h}', '--virtual-time-budget=3000',
                    f'--screenshot={OUT}/{name}.png', f'file://{f}'], check=True, capture_output=True)

def wm(size):  # logo ufficiale (dado esagonale + SEMI / STORE · ASSISTENZA)
    return f'<img src="logo.svg" style="height:{size*1.25}px;display:block">'

def products(items):
    return '<div class=prod>' + ''.join(
        f'<img src="p_{n}.webp" style="left:{x}px;top:{y}px;width:{s}px">' for n, x, y, s in items) + '</div>'

# ---------- 1. Foto profilo 1080x1080 (sicura anche col ritaglio a cerchio)
page('1-foto-profilo', 1080, 1080, """
<div style="position:absolute;inset:0;background:#15171a;display:grid;place-items:center">
 <img src="favicon.svg" style="width:700px"></div>""")

# ---------- 2. Copertina Facebook 1640x856 (zona sicura centrale per pc e telefono)
W, H = 1640, 856
body = products([('dcs570n', 1050, 170, 430), ('dcg405nt', 1150, 470, 380), ('dcf887n', 950, 400, 300), ('dcb548', 1330, 120, 230)])
body += '<div class=ink style="left:-200px;width:1190px"></div><div class=stripe style="left:975px;width:26px"></div>'
body += f"""<div style="position:absolute;left:240px;top:170px;width:720px">
 {wm(86)}
 <div style="font-weight:850;font-size:58px;line-height:1.05;margin-top:42px">Utensili professionali<br><span class=y>vendita e assistenza</span></div>
 <div style="font-size:27px;color:#d6d7d9;margin-top:22px;font-weight:500">Centro assistenza autorizzato <b style="color:#fff">DEWALT</b><br>Vendita DEWALT · STANLEY · BLACK+DECKER</div>
 <div style="display:flex;gap:26px;margin-top:34px;font-size:25px;font-weight:700">
   <span>📍 Casavatore (NA)</span><span>📞 081 553 6604</span><span class=y>semistore.it</span></div>
</div>"""
page('2-copertina-facebook', W, H, body)

# ---------- 3. Copertina Google Business 1920x1080
W, H = 1920, 1080
body = products([('dcs570n', 1190, 170, 560), ('dcg405nt', 1340, 560, 480), ('dcf887n', 1010, 470, 380), ('dcb548', 1600, 120, 280)])
body += '<div class=ink style="left:-250px;width:1300px"></div><div class=stripe style="left:1035px;width:30px"></div>'
body += f"""<div style="position:absolute;left:150px;top:250px;width:880px">
 {wm(100)}
 <div style="font-weight:850;font-size:76px;line-height:1.05;margin-top:56px">Utensili professionali<br><span class=y>vendita e assistenza</span></div>
 <div style="font-size:33px;color:#d6d7d9;margin-top:26px;font-weight:500">Centro assistenza autorizzato <b style="color:#fff">DEWALT</b><br>Vendita DEWALT · STANLEY · BLACK+DECKER</div>
 <div style="display:flex;gap:34px;margin-top:44px;font-size:31px;font-weight:700"><span>📞 081 553 6604</span><span class=y>semistore.it</span></div>
</div>"""
page('3-copertina-google', W, H, body)

# ---------- 4. Copertine storie in evidenza Instagram 1080x1920
ICONS = {
 'assistenza': '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L3 17.8 6.2 21l6.3-6.3a4 4 0 0 0 5.2-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>',
 'shop': '<path d="M3 4h2l2.4 10.5h10.2L20 7H6.3"/><circle cx="9" cy="19" r="1.6"/><circle cx="17" cy="19" r="1.6"/>',
 'offerte': '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
 'negozio': '<path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.6"/>',
 'recensioni': '<path d="m12 3 2.8 5.8 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.7l6.2-.9z"/>',
 'lavori': '<path d="M4 7h16v12H4z"/><path d="M9 7V5h6v2"/><path d="M4 12h16"/>',
}
for name, path in ICONS.items():
    page(f'4-evidenza-{name}', 1080, 1920, f"""
<div style="position:absolute;inset:0;display:grid;place-items:center">
 <div style="width:620px;height:620px;border-radius:50%;background:#f5b800;display:grid;place-items:center">
  <svg viewBox="0 0 24 24" width="330" height="330" fill="none" stroke="#15171a" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">{path}</svg>
 </div></div>""")
print('ok')
