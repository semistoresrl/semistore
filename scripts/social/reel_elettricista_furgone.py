# Reel 1080x1920 "3 utensili DEWALT che ogni elettricista dovrebbe avere nel furgone" (26/11/2026)
# Solo grafica, 6 schermate a tagli secchi con zoom lento (stile reel_batterie_scelta.py). Prezzi ONSITE dal sito (src/data/prodotti.json, 26/11).
# Prima: copiare qui logo.svg, le 3 foto prodotto -800.webp da public/img/prodotti/ e dch273nt.webp, dce089d1g.webp da public/img/hero/
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


TAS='dewalt-tassellatore-sds-plus-2-1j-dch273nt-800.webp'
MUL='dewalt-utensile-multifunzione-18v-dcs356nt-800.webp'
LAS='dewalt-laser-multilinea-con-raggio-verde-proietta-tre-linee-a-360-2-vertica-dce089ng18-800.webp'
page('el-s0', W, H, bar(0) + f'<div style="position:absolute;left:70px;top:170px">{wm(58)}</div>' + """
<img src="dch273nt.webp" style="position:absolute;left:70px;top:270px;width:560px;transform:rotate(-5deg);filter:drop-shadow(0 30px 50px rgba(0,0,0,.6))">
<img src="dce089d1g.webp" style="position:absolute;left:600px;top:330px;width:400px;transform:rotate(6deg);filter:drop-shadow(0 30px 50px rgba(0,0,0,.6))">
<div style="position:absolute;left:70px;right:70px;bottom:450px">
 <div style="display:inline-block;background:#f5b800;color:#15171a;font-weight:900;font-size:48px;padding:8px 26px;border-radius:12px;transform:skewX(-8deg)">PER ELETTRICISTI</div>
 <div style="font-weight:900;font-size:100px;line-height:.96;margin-top:28px">Se nel furgone<br>ti manca uno<br>di questi <span class=y>3</span>…</div>
 <div style="font-weight:800;font-size:56px;line-height:1.1;margin-top:30px;color:#d6d7d9">…stai lavorando il <span class=y>doppio</span> 👇</div>
</div>""" + FOOT)
page('el-s1', W, H, scheda(1, 'N° 1 · TASSELLATORE DCH273', 'Fori nel <span class=y>cemento</span><br>senza filo', 'Staffe, canaline, scatole a muro:<br>SDS-Plus 2,1 J, 18V XR Brushless.', '347 €', TAS))
page('el-s2', W, H, scheda(2, 'N° 2 · MULTIFUNZIONE DCS356', 'La scatola nel<br><span class=y>cartongesso</span>', 'Taglia a filo, rifila, raschia:<br>entra dove gli altri non entrano.', '233 €', MUL))
page('el-s3', W, H, scheda(3, 'N° 3 · LASER DCE089 VERDE', 'Prese e frutti<br>tutti <span class=y>in bolla</span>', '3 linee a 360° a raggio verde:<br>tracci la stanza in un colpo.', '642 €', LAS))
page('el-s4', W, H, bar(4) + f'<div style="position:absolute;left:70px;top:170px">{wm(58)}</div>' + """
<img src="dch273nt.webp" style="position:absolute;left:80px;top:320px;width:520px;transform:rotate(-6deg);filter:drop-shadow(0 30px 50px rgba(0,0,0,.6))">
<img src="hero184.webp" style="position:absolute;left:600px;top:380px;width:380px;transform:rotate(6deg);filter:drop-shadow(0 30px 50px rgba(0,0,0,.6))">
<div style="position:absolute;left:70px;right:70px;bottom:450px">
 <div style="display:inline-block;background:#f5b800;color:#15171a;font-weight:900;font-size:44px;padding:8px 26px;border-radius:12px;transform:skewX(-8deg)">REGOLA DA FURGONE</div>
 <div style="font-weight:900;font-size:84px;line-height:1;margin-top:28px">Hai già le batterie <span class=y>DEWALT 18V</span>?</div>
 <div style="font-weight:700;font-size:48px;line-height:1.18;color:#d6d7d9;margin-top:30px">Prendi <b style="color:#fff">solo il corpo</b> e risparmi:<br>i prezzi che vedi sono senza batteria.</div>
</div>""" + FOOT)
page('el-s5', W, H, bar(5) + f'<div style="position:absolute;left:70px;top:170px">{wm(58)}</div>' + """
<div style="position:absolute;left:70px;right:70px;top:360px">
 <div style="font-weight:900;font-size:100px;line-height:.98">💬 <span class=y>Commenta</span></div>
 <div style="font-weight:800;font-size:66px;line-height:1.1;margin-top:36px">Quale ti manca?<br>1, 2 o 3</div>
 <div style="font-weight:700;font-size:48px;color:#d6d7d9;margin-top:30px">👷 Tagga l'elettricista che fa ancora le tracce a occhio</div>
</div>
<div style="position:absolute;left:70px;right:70px;bottom:450px;border-top:4px solid #f5b800;padding-top:44px">
 <div style="font-weight:800;font-size:52px;line-height:1.15">Prezzi IVA inclusa su <span class=y>semistore.it</span></div>
 <div style="font-weight:700;font-size:44px;color:#d6d7d9;margin-top:26px">WhatsApp 375 626 6947<br>📍 Viale Marconi 225, Casavatore</div>
</div>
<div style="position:absolute;left:70px;right:70px;bottom:350px;font-size:32px;font-weight:600;color:#9a9ca1">Concessionario DEWALT · Assistenza autorizzata dal 1997</div>""")
dur = [2.6, 2.7, 2.7, 2.7, 2.8, 3.4]
args, filt = [], []
for i, d in enumerate(dur):
    args += ['-loop', '1', '-t', str(d), '-i', str(OUT / f'el-s{i}.png')]
    fr = int(d * 30)
    filt.append(f"[{i}:v]scale=2160:3840,zoompan=z='1+0.035*on/{fr}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={fr}:s={W}x{H}:fps=30,setsar=1[v{i}]")
filt.append(''.join(f'[v{i}]' for i in range(len(dur))) + f'concat=n={len(dur)}:v=1:a=0[v]')
dest = D.parents[1] / 'public/social/2026-11-26'; dest.mkdir(parents=True, exist_ok=True)
subprocess.run(['ffmpeg', '-y', *args, '-f', 'lavfi', '-t', str(sum(dur)), '-i', 'anullsrc=r=44100:cl=stereo',
                '-filter_complex', ';'.join(filt), '-map', '[v]', '-map', f'{len(dur)}:a', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
                '-profile:v', 'high', '-crf', '24', '-c:a', 'aac', '-shortest', '-movflags', '+faststart',
                str(dest / 'reel-elettricista-furgone.mp4')], check=True, capture_output=True)
subprocess.run(['ffmpeg', '-y', '-i', str(OUT / 'el-s0.png'), '-q:v', '3', str(dest / 'reel-copertina.jpg')], check=True, capture_output=True)
print('ok')
