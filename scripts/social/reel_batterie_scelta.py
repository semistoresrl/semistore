# Reel 1080x1920 "2 Ah, 5 Ah o POWERSTACK? Quale batteria DEWALT 18V" (24/11/2026)
# Solo grafica, 6 schermate a tagli secchi con zoom lento (stile reel_batterie_inverno.py). Prezzi dal sito (src/data/prodotti.json, 24/11).
import subprocess, pathlib
exec(open(pathlib.Path(__file__).resolve().parent.joinpath('gen.py')).read().split('# ---------- 1.')[0])
W, H = 1080, 1920
TOT = 6
def bar(n): return f'<div style="position:absolute;left:70px;right:70px;top:110px;display:flex;gap:12px">' + ''.join(f'<div style="flex:1;height:10px;border-radius:5px;background:{"#f5b800" if k <= n else "#3a3d42"}"></div>' for k in range(TOT)) + '</div>'
FOOT = '<div style="position:absolute;left:70px;right:70px;bottom:350px;font-size:32px;font-weight:600;color:#9a9ca1">Centro assistenza autorizzato DEWALT · Casavatore (NA)</div>'
def card(img, top=330, size=600):
    return f'<div style="position:absolute;left:{(W-size)//2}px;top:{top}px;width:{size}px;height:{size}px;border-radius:40px;background:#fff;overflow:hidden;box-shadow:0 30px 60px rgba(0,0,0,.5)"><img src="{img}" style="width:100%;height:100%;object-fit:contain"></div>'
def scheda(n, tag, titolo, testo, prezzo, img):
    return bar(n) + f'<div style="position:absolute;left:70px;top:170px">{wm(58)}</div>' + card(img) + f"""
<div style="position:absolute;right:120px;top:300px;background:#f5b800;color:#15171a;font-weight:900;font-size:64px;padding:10px 30px;border-radius:16px;transform:rotate(4deg)">{prezzo}</div>
<div style="position:absolute;left:70px;right:70px;bottom:450px">
 <div style="display:inline-block;background:#f5b800;color:#15171a;font-weight:900;font-size:44px;padding:8px 26px;border-radius:12px;transform:skewX(-8deg)">{tag}</div>
 <div style="font-weight:900;font-size:92px;line-height:.98;margin-top:28px">{titolo}</div>
 <div style="font-weight:700;font-size:48px;line-height:1.18;color:#d6d7d9;margin-top:30px">{testo}</div>
</div>""" + FOOT

page('rb-s0', W, H, bar(0) + f'<div style="position:absolute;left:70px;top:170px">{wm(58)}</div>' + """
<img src="hero184.webp" style="position:absolute;left:150px;top:300px;width:780px;filter:drop-shadow(0 30px 50px rgba(0,0,0,.6))">
<div style="position:absolute;left:70px;right:70px;bottom:450px">
 <div style="font-weight:900;font-size:104px;line-height:.96"><span class=y>2 Ah, 5 Ah</span><br>o <span class=y>POWERSTACK?</span></div>
 <div style="font-weight:800;font-size:58px;line-height:1.1;margin-top:34px">Quale batteria DEWALT 18V ti serve davvero</div>
 <div style="font-weight:700;font-size:46px;color:#d6d7d9;margin-top:26px">La regola da cantiere è alla fine 👇</div>
</div>""" + FOOT)
page('rb-s1', W, H, scheda(1, '2,0 Ah · DCB183', 'Leggera,<br>per lavori <span class=y>brevi</span>', 'Avvitare, forare piccolo,<br>lavorare in alto senza fatica.', '63 €', 'dewalt-batteria-18v-xr-litio-2-0-ah-dcb183-800.webp'))
page('rb-s2', W, H, scheda(2, '5,0 Ah · DCB184', 'Quella da<br><span class=y>tutta la giornata</span>', 'Smerigliatrici, seghe, tassellatori:<br>più autonomia tra una carica e l\'altra.', '155 €', 'dewalt-batteria-18v-xr-litio-5-0-ah-dcb184-800.webp'))
page('rb-s3', W, H, scheda(3, 'POWERSTACK 5,0 Ah · DCBP518', 'Celle <span class=y>impilate</span>,<br>più compatta', 'Stessa capacità della 5 Ah<br>in meno ingombro.', '221 €', 'dewalt-batteria-18v-xr-powerstack-5-0-ah-dcbp518-800.webp'))
page('rb-s4', W, H, bar(4) + f'<div style="position:absolute;left:70px;top:170px">{wm(58)}</div>' + """
<img src="hero805.webp" style="position:absolute;left:110px;top:270px;width:430px;transform:rotate(-6deg);filter:drop-shadow(0 30px 50px rgba(0,0,0,.6))">
<img src="hero850.webp" style="position:absolute;left:540px;top:300px;width:410px;transform:rotate(6deg);filter:drop-shadow(0 30px 50px rgba(0,0,0,.6))">
<div style="position:absolute;left:70px;right:70px;bottom:450px">
 <div style="display:inline-block;background:#f5b800;color:#15171a;font-weight:900;font-size:44px;padding:8px 26px;border-radius:12px;transform:skewX(-8deg)">REGOLA DA CANTIERE</div>
 <div style="font-weight:900;font-size:86px;line-height:1;margin-top:28px">Vanno tutte su ogni utensile <span class=y>18V XR</span></div>
 <div style="font-weight:700;font-size:48px;line-height:1.18;color:#d6d7d9;margin-top:30px">Scegli la batteria in base al <b style="color:#fff">lavoro</b>, non all'utensile.</div>
</div>""" + FOOT)
page('rb-s5', W, H, bar(5) + f'<div style="position:absolute;left:70px;top:170px">{wm(58)}</div>' + """
<div style="position:absolute;left:70px;right:70px;top:360px">
 <div style="font-weight:900;font-size:100px;line-height:.98">💬 <span class=y>Commenta</span></div>
 <div style="font-weight:800;font-size:66px;line-height:1.1;margin-top:36px">2, 5 o POWER:<br>quale hai nel furgone?</div>
 <div style="font-weight:700;font-size:48px;color:#d6d7d9;margin-top:30px">📌 Salva il video per la prossima batteria</div>
</div>
<div style="position:absolute;left:70px;right:70px;bottom:450px;border-top:4px solid #f5b800;padding-top:44px">
 <div style="font-weight:800;font-size:52px;line-height:1.15">Prezzi IVA inclusa su <span class=y>semistore.it</span></div>
 <div style="font-weight:700;font-size:44px;color:#d6d7d9;margin-top:26px">WhatsApp 375 626 6947<br>📍 Viale Marconi 225, Casavatore</div>
</div>
<div style="position:absolute;left:70px;right:70px;bottom:350px;font-size:32px;font-weight:600;color:#9a9ca1">Assistenza autorizzata dal 1997 · semistore.it</div>""")

dur = [2.8, 2.7, 2.7, 2.7, 2.8, 3.4]
args, filt = [], []
for i, d in enumerate(dur):
    args += ['-loop', '1', '-t', str(d), '-i', str(OUT / f'rb-s{i}.png')]
    fr = int(d * 30)
    filt.append(f"[{i}:v]scale=2160:3840,zoompan=z='1+0.035*on/{fr}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={fr}:s={W}x{H}:fps=30,setsar=1[v{i}]")
filt.append(''.join(f'[v{i}]' for i in range(len(dur))) + f'concat=n={len(dur)}:v=1:a=0[v]')
dest = D.parents[1] / 'public/social/2026-11-24'; dest.mkdir(parents=True, exist_ok=True)
subprocess.run(['ffmpeg', '-y', *args, '-f', 'lavfi', '-t', str(sum(dur)), '-i', 'anullsrc=r=44100:cl=stereo',
                '-filter_complex', ';'.join(filt), '-map', '[v]', '-map', f'{len(dur)}:a', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
                '-profile:v', 'high', '-crf', '24', '-c:a', 'aac', '-shortest', '-movflags', '+faststart',
                str(dest / 'reel-batterie-scelta.mp4')], check=True, capture_output=True)
subprocess.run(['ffmpeg', '-y', '-i', str(OUT / 'rb-s0.png'), '-q:v', '3', str(dest / 'reel-copertina.jpg')], check=True, capture_output=True)
print('ok')
