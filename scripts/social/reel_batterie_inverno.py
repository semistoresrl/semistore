# Reel 1080x1920 "Batterie d'inverno: 4 errori che le uccidono" (22/11/2026)
# Solo grafica (niente video negozio): 6 schermate a tagli veloci con leggero zoom, montate con ffmpeg.
# Prima: copiare qui logo.svg e le foto scontornate dcb184.webp, dcb548.webp, dcb118.webp da public/img/hero/
import subprocess, pathlib
exec(open(pathlib.Path(__file__).resolve().parent.joinpath('gen.py')).read().split('# ---------- 1.')[0])
W, H = 1080, 1920

def frame(n, tot, num, titolo, testo, img, iw, ix, iy):
    bar = ''.join(f'<div style="flex:1;height:10px;border-radius:5px;background:{"#f5b800" if k <= n else "#3a3d42"}"></div>' for k in range(tot))
    tag = f'<div style="display:inline-block;background:#f5b800;color:#15171a;font-weight:900;font-size:46px;padding:8px 26px;border-radius:12px;transform:skewX(-8deg)">ERRORE N° {num}</div>' if num else ''
    return f"""<div style="position:absolute;left:70px;right:70px;top:110px;display:flex;gap:12px">{bar}</div>
<div style="position:absolute;left:70px;top:170px">{wm(58)}</div>
<img src="{img}" style="position:absolute;left:{ix}px;top:{iy}px;width:{iw}px;filter:drop-shadow(0 30px 50px rgba(0,0,0,.6))">
<div style="position:absolute;left:70px;right:70px;bottom:450px">
 {tag}
 <div style="font-weight:900;font-size:96px;line-height:.98;letter-spacing:-.01em;margin-top:30px">{titolo}</div>
 <div style="font-weight:700;font-size:50px;line-height:1.15;color:#d6d7d9;margin-top:34px">{testo}</div>
</div>
<div style="position:absolute;left:70px;right:70px;bottom:350px;font-size:32px;font-weight:600;color:#9a9ca1">Centro assistenza autorizzato DEWALT · Casavatore (NA)</div>"""

scene = [
 (0, "D'inverno<br>queste <span class=y>4 abitudini</span><br>uccidono le<br>tue batterie", "Il n° 3 lo fanno quasi tutti 👇", 'dcb184.webp', 820, 130, 300),
 (1, "Lasciarle nel<br><span class=y>furgone</span> di notte", "Il gelo le stressa.<br>La sera portale a casa o in officina.", 'dcb184.webp', 700, 190, 330),
 (2, "Caricarle appena<br>tolte dal <span class=y>freddo</span>", "Prima falle tornare<br>a temperatura ambiente.", 'dcb118.webp', 760, 160, 310),
 (3, "Usarle fino<br>a <span class=y>zero</span>", "Mettile in carica<br>prima che si scarichino del tutto.", 'dcb548.webp', 700, 190, 280),
 (4, "Lasciarle <span class=y>ferme</span><br>per mesi scariche", "Se non le usi, conservale<br>a metà carica, all'asciutto.", 'dcb548.webp', 640, 220, 300),
]
for i, (num, t, s, img, iw, ix, iy) in enumerate(scene):
    page(f'reel22-s{i}', W, H, frame(i, 6, num, t, s, img, iw, ix, iy))

page('reel22-s5', W, H, f"""<div style="position:absolute;left:70px;right:70px;top:110px;display:flex;gap:12px">{''.join('<div style="flex:1;height:10px;border-radius:5px;background:#f5b800"></div>' for _ in range(6))}</div>
<div style="position:absolute;left:70px;top:170px">{wm(58)}</div>
<div style="position:absolute;left:70px;right:70px;top:360px">
 <div style="font-weight:900;font-size:104px;line-height:.98">📌 <span class=y>Salva</span> il video</div>
 <div style="font-weight:800;font-size:66px;line-height:1.08;margin-top:40px">e mandalo al collega che lascia le batterie <span class=y>nel furgone</span></div>
</div>
<img src="dcb184.webp" style="position:absolute;left:540px;top:830px;width:430px;transform:rotate(-8deg);filter:drop-shadow(0 30px 50px rgba(0,0,0,.6))">
<div style="position:absolute;left:70px;right:70px;bottom:450px;border-top:4px solid #f5b800;padding-top:44px">
 <div style="font-weight:800;font-size:52px;line-height:1.15">Batteria o utensile DEWALT<br>che non va? <span class=y>Scrivici.</span></div>
 <div style="font-weight:700;font-size:44px;color:#d6d7d9;margin-top:26px">WhatsApp 375 626 6947<br>📍 Viale Marconi 225, Casavatore</div>
</div>
<div style="position:absolute;left:70px;right:70px;bottom:350px;font-size:32px;font-weight:600;color:#9a9ca1">Assistenza autorizzata dal 1997 · semistore.it</div>""")

# montaggio: tagli secchi, zoom lento su ogni schermata, traccia audio muta
dur = [2.8, 2.6, 2.6, 2.6, 2.6, 3.4]
args, filt = [], []
for i, d in enumerate(dur):
    args += ['-loop', '1', '-t', str(d), '-i', str(OUT / f'reel22-s{i}.png')]
    fr = int(d * 30)
    filt.append(f"[{i}:v]scale=2160:3840,zoompan=z='1+0.035*on/{fr}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={fr}:s={W}x{H}:fps=30,setsar=1[v{i}]")
filt.append(''.join(f'[v{i}]' for i in range(len(dur))) + f'concat=n={len(dur)}:v=1:a=0[v]')
dest = D.parents[1] / 'public/social/2026-11-22'; dest.mkdir(parents=True, exist_ok=True)
subprocess.run(['ffmpeg', '-y', *args, '-f', 'lavfi', '-t', str(sum(dur)), '-i', 'anullsrc=r=44100:cl=stereo',
                '-filter_complex', ';'.join(filt), '-map', '[v]', '-map', f'{len(dur)}:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
                '-profile:v', 'high', '-crf', '20', '-c:a', 'aac', '-shortest', '-movflags', '+faststart',
                str(dest / 'reel-batterie-inverno.mp4')], check=True, capture_output=True)
subprocess.run(['ffmpeg', '-y', '-i', str(OUT / 'reel22-s0.png'), '-q:v', '3', str(dest / 'reel-copertina.jpg')], check=True, capture_output=True)
print('ok')
