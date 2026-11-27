# Reel 1080x1920 "Anti-Black Friday" (27/11/2026)
# Struttura "indovina il prezzo": domanda (prezzo consigliato) -> svelamento (prezzo sito), 7 schermate a tagli secchi con zoom lento.
# Prezzi dal sito (src/data/prodotti.json, 27/11, fontePrezzo onsite): DCF922NT 264 € (consigliato 396,50 €), DCS573NT 414 € (consigliato 625,86 €).
# Prima: copiare qui logo.svg, le 2 foto -800.webp da public/img/prodotti/ e dcf922nt.webp da public/img/hero/
import subprocess, pathlib
exec(open(pathlib.Path(__file__).resolve().parent.joinpath('gen.py')).read().split('# ---------- 1.')[0])
W, H = 1080, 1920
TOT = 7
def bar(n): return f'<div style="position:absolute;left:70px;right:70px;top:110px;display:flex;gap:12px">' + ''.join(f'<div style="flex:1;height:10px;border-radius:5px;background:{"#f5b800" if k <= n else "#3a3d42"}"></div>' for k in range(TOT)) + '</div>'
LOGO = f'<div style="position:absolute;left:70px;top:170px">{wm(58)}</div>'
FOOT = '<div style="position:absolute;left:70px;right:70px;bottom:350px;font-size:32px;font-weight:600;color:#9a9ca1">Concessionario DEWALT · Casavatore (NA)</div>'
def card(img, top=330, size=560):
    return f'<div style="position:absolute;left:{(W-size)//2}px;top:{top}px;width:{size}px;height:{size}px;border-radius:40px;background:#fff;overflow:hidden;box-shadow:0 30px 60px rgba(0,0,0,.5)"><img src="{img}" style="width:100%;height:100%;object-fit:contain"></div>'

def domanda(n, nome, img, consigliato):
    return bar(n) + LOGO + card(img) + f"""
<div style="position:absolute;left:70px;right:70px;bottom:450px">
 <div style="display:inline-block;background:#f5b800;color:#15171a;font-weight:900;font-size:44px;padding:8px 26px;border-radius:12px;transform:skewX(-8deg)">{nome}</div>
 <div style="font-weight:700;font-size:46px;color:#d6d7d9;margin-top:34px">Prezzo consigliato <s style="color:#fff">{consigliato}</s></div>
 <div style="font-weight:900;font-size:104px;line-height:.98;margin-top:26px">Da noi quanto<br>lo paghi? <span class=y>🤔</span></div>
</div>""" + FOOT

def svela(n, nome, img, consigliato, prezzo, perc):
    return bar(n) + LOGO + card(img, size=480) + f"""
<div style="position:absolute;right:110px;top:290px;background:#e63322;color:#fff;font-weight:900;font-size:62px;padding:10px 28px;border-radius:16px;transform:rotate(5deg)">{perc}</div>
<div style="position:absolute;left:70px;right:70px;bottom:450px">
 <div style="display:inline-block;background:#f5b800;color:#15171a;font-weight:900;font-size:44px;padding:8px 26px;border-radius:12px;transform:skewX(-8deg)">{nome}</div>
 <div style="font-weight:700;font-size:46px;color:#9a9ca1;margin-top:30px"><s>{consigliato}</s></div>
 <div style="font-weight:900;font-size:220px;line-height:.9;color:#f5b800;margin-top:6px">{prezzo}</div>
 <div style="font-weight:800;font-size:50px;line-height:1.15;margin-top:22px">Oggi. Domani. Fino al 31/12.</div>
</div>""" + FOOT

F922 = 'dewalt-avvitatore-a-impulsi-1-2-18v-xr-brushless-4-modalita-con-perno-di-rit-dcf922nt-800.webp'
S573 = 'dewalt-sega-circolare-190-mm-18v-xr-brushless-dcs573nt-800.webp'
N1, N2 = 'AVVITATORE A IMPULSI DCF922', 'SEGA CIRCOLARE DCS573'

page('bf-s0', W, H, bar(0) + LOGO + """
<div style="position:absolute;left:70px;top:330px;font-weight:900;font-size:150px;line-height:.9;color:#3a3d42;transform:rotate(-4deg)"><s style="text-decoration-thickness:14px;text-decoration-color:#e63322">BLACK<br>FRIDAY</s></div>
<img src="dcf922nt.webp" style="position:absolute;right:40px;top:300px;width:430px;transform:rotate(8deg);filter:drop-shadow(0 30px 50px rgba(0,0,0,.6))">
<div style="position:absolute;left:70px;right:70px;bottom:450px">
 <div style="font-weight:900;font-size:104px;line-height:.96">Oggi tutti fanno<br>lo sconto.<br><span class=y>Noi no.</span></div>
 <div style="font-weight:800;font-size:54px;line-height:1.12;margin-top:34px;color:#d6d7d9">E ti spiego perché 👇</div>
</div>""" + FOOT)
page('bf-s1', W, H, bar(1) + LOGO + """
<div style="position:absolute;left:70px;right:70px;top:420px">
 <div style="font-weight:900;font-size:96px;line-height:1">I nostri prezzi<br>sono <span class=y>già bassi</span>.<br>Tutti i giorni.</div>
 <div style="font-weight:700;font-size:52px;line-height:1.2;color:#d6d7d9;margin-top:44px">Niente conto alla rovescia.<br>Niente "ultime ore".<br>Stesso prezzo per tutti.</div>
</div>
<div style="position:absolute;left:70px;right:70px;bottom:450px;font-weight:800;font-size:56px">Prova a indovinare 👀</div>""" + FOOT)
page('bf-s2', W, H, domanda(2, N1, F922, '396,50 €'))
page('bf-s3', W, H, svela(3, N1, F922, '396,50 €', '264 €', '−33%'))
page('bf-s4', W, H, domanda(4, N2, S573, '625,86 €'))
page('bf-s5', W, H, svela(5, N2, S573, '625,86 €', '414 €', '−34%'))
page('bf-s6', W, H, bar(6) + LOGO + """
<div style="position:absolute;left:70px;right:70px;top:340px">
 <div style="font-weight:900;font-size:96px;line-height:.98">Il tuo <span class=y>Black Friday</span><br>dura fino al 31/12</div>
 <div style="font-weight:800;font-size:60px;line-height:1.12;margin-top:40px">💬 Commenta l'utensile<br>che vuoi sapere quanto costa</div>
 <div style="font-weight:700;font-size:46px;color:#d6d7d9;margin-top:28px">👷 Tagga il collega che aspetta il Black Friday per comprare</div>
</div>
<div style="position:absolute;left:70px;right:70px;bottom:450px;border-top:4px solid #f5b800;padding-top:40px">
 <div style="font-weight:800;font-size:50px;line-height:1.15">Prezzi IVA inclusa, solo corpo, su <span class=y>semistore.it</span></div>
 <div style="font-weight:700;font-size:44px;color:#d6d7d9;margin-top:24px">WhatsApp 375 626 6947<br>📍 Viale Marconi 225, Casavatore</div>
</div>
<div style="position:absolute;left:70px;right:70px;bottom:350px;font-size:32px;font-weight:600;color:#9a9ca1">Concessionario DEWALT · Assistenza autorizzata dal 1997</div>""")

dur = [2.4, 2.8, 2.0, 2.4, 2.0, 2.4, 3.6]
args, filt = [], []
for i, d in enumerate(dur):
    args += ['-loop', '1', '-t', str(d), '-i', str(OUT / f'bf-s{i}.png')]
    fr = int(d * 30)
    filt.append(f"[{i}:v]scale=2160:3840,zoompan=z='1+0.035*on/{fr}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={fr}:s={W}x{H}:fps=30,setsar=1[v{i}]")
filt.append(''.join(f'[v{i}]' for i in range(len(dur))) + f'concat=n={len(dur)}:v=1:a=0[v]')
dest = D.parents[1] / 'public/social/2026-11-27'; dest.mkdir(parents=True, exist_ok=True)
subprocess.run(['ffmpeg', '-y', *args, '-f', 'lavfi', '-t', str(sum(dur)), '-i', 'anullsrc=r=44100:cl=stereo',
                '-filter_complex', ';'.join(filt), '-map', '[v]', '-map', f'{len(dur)}:a', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
                '-profile:v', 'high', '-crf', '24', '-c:a', 'aac', '-shortest', '-movflags', '+faststart',
                str(dest / 'reel-anti-black-friday.mp4')], check=True, capture_output=True)
subprocess.run(['ffmpeg', '-y', '-i', str(OUT / 'bf-s0.png'), '-q:v', '3', str(dest / 'reel-copertina.jpg')], check=True, capture_output=True)
print('ok')
