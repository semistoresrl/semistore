import sys; sys.argv = ['x']
exec(open(__import__('os').path.join(__import__('os').path.dirname(__file__),'gen.py')).read().split('# ---------- 1.')[0])  # riusa page(), wm()

# Carosello 23/11/2026: consiglio + prodotto "Trapano o avvitatore a impulsi?"
# Prezzi dal sito (src/data/prodotti.json, fonte volantino ONSITE): DCD805NT 213 €, DCF850NT 213 € (solo corpo)
# Prima di lanciare: copiare qui public/logo.svg, public/img/hero/dcd805nt.webp e dcf850nt.webp
W, H = 1080, 1350
N = 5

def dots(i):
    return '<div style="position:absolute;right:70px;top:92px;display:flex;gap:10px">' + ''.join(
        f'<span style="width:{34 if k == i else 12}px;height:12px;border-radius:6px;background:{"#f5b800" if k == i else "#4a4d53"}"></span>' for k in range(N)) + '</div>'

def head(i):
    return f'<div style="position:absolute;left:70px;top:60px">{wm(60)}</div>' + dots(i)

def foot(t='semistore.it · Viale Marconi 225, Casavatore'):
    return f'<div style="position:absolute;left:70px;right:70px;bottom:46px;font-size:26px;color:#9a9ca1;font-weight:600;display:flex;justify-content:space-between"><span>{t}</span><span class=y>Scorri →</span></div>'

glow = lambda x, y, s: f'<div style="position:absolute;left:{x}px;top:{y}px;width:{s}px;height:{s}px;border-radius:50%;background:radial-gradient(circle,#2e3138 0%,#15171a 70%)"></div>'

# 1 — gancio
s1 = head(0) + glow(-120, 470, 700) + glow(500, 470, 700) + f"""
<img src="dcd805nt.webp" style="position:absolute;left:50px;top:650px;width:430px;transform:rotate(-10deg);filter:drop-shadow(0 30px 40px rgba(0,0,0,.6))">
<img src="dcf850nt.webp" style="position:absolute;right:110px;top:650px;width:305px;transform:rotate(8deg);filter:drop-shadow(0 30px 40px rgba(0,0,0,.6))">
<div style="position:absolute;left:470px;top:860px;width:140px;height:140px" class=badge><span style="font-size:58px">VS</span></div>
<div style="position:absolute;left:70px;top:210px;width:940px">
 <div style="font-weight:900;font-size:100px;line-height:.95">Trapano o<br><span class=y>avvitatore a impulsi?</span></div>
 <div style="font-size:40px;font-weight:600;color:#d6d7d9;margin-top:26px">Stesso prezzo. Lavori diversissimi.</div>
</div>""" + foot()

def scheda(i, img, iw, nome, cod, titolo, fa, nonfa, prezzo):
    return head(i) + glow(560, 300, 640) + f"""
<img src="{img}" style="position:absolute;right:40px;top:330px;width:{iw}px;filter:drop-shadow(0 30px 40px rgba(0,0,0,.6))">
<div style="position:absolute;left:70px;top:200px;width:620px">
 <div style="font-size:30px;font-weight:700;color:#9a9ca1;letter-spacing:.08em;text-transform:uppercase">{nome}</div>
 <div style="font-weight:900;font-size:86px;line-height:.95;margin-top:10px">{titolo}</div>
</div>
<div style="position:absolute;left:70px;top:520px;width:560px">
 {''.join(f'<div style="display:flex;gap:18px;align-items:flex-start;margin-bottom:22px"><div class=badge style="width:46px;height:46px;font-size:28px;flex:none">✓</div><div style="font-size:33px;font-weight:600;line-height:1.18">{t}</div></div>' for t in fa)}
 <div style="display:flex;gap:18px;align-items:flex-start;margin-top:8px"><div style="width:46px;height:46px;font-size:28px;flex:none;border:3px solid #6b6e74;color:#9a9ca1;display:grid;place-items:center;border-radius:14%;font-weight:900">✕</div><div style="font-size:30px;font-weight:600;line-height:1.18;color:#9a9ca1">{nonfa}</div></div>
</div>
<div style="position:absolute;left:40px;right:40px;bottom:110px;background:#23262b;border:3px solid #f5b800;border-radius:22px;padding:22px 34px;display:flex;align-items:center;justify-content:space-between">
 <div><div style="font-size:28px;color:#d6d7d9;font-weight:600">DEWALT {cod} · solo corpo</div><div style="font-size:26px;color:#9a9ca1;font-weight:600">su semistore.it</div></div>
 <div style="font-size:78px;font-weight:900" class=y>{prezzo} €</div>
</div>""" + foot()

s2 = scheda(1, 'dcd805nt.webp', 440, 'Trapano avvitatore a percussione', 'DCD805NT', 'Fora<br><span class=y>e avvita</span>',
            ['Buchi in legno, ferro e <b>muratura</b> (percussione)', '<b>Frizione</b> regolabile: non spani le viti piccole', 'Mandrino: punte tonde, frese, fruste'],
            'Viti lunghe a raffica: ti stanca il polso', 213)
s3 = scheda(2, 'dcf850nt.webp', 330, 'Avvitatore a impulsi', 'DCF850NT', 'Avvita<br><span class=y>senza fatica</span>',
            ['<b>Viti lunghe</b>, tirafondi e bulloni', 'Colpi a impulsi: <b>niente strattoni</b> al polso', 'Compatto, 3 velocità, attacco 1/4"'],
            'Niente frizione: non è fatto per forare', 213)

# 4 — regola veloce
righe = [('Devi fare <b>buchi</b>?', 'Trapano'), ('Monti <b>cartongesso, pedane, tetti</b>?', 'Impulsi'),
         ('Mobili e <b>viti delicate</b>?', 'Trapano'), ('<b>Bulloni</b> e viti da 100 mm in su?', 'Impulsi')]
s4 = head(3) + f"""
<div style="position:absolute;left:70px;top:200px;width:940px">
 <div style="font-weight:900;font-size:92px;line-height:.95">La regola<br><span class=y>da cantiere</span></div>
</div>
<div style="position:absolute;left:70px;right:70px;top:470px">
 {''.join(f'<div style="display:flex;justify-content:space-between;align-items:center;padding:26px 0;border-bottom:2px solid #2e3138"><div style="font-size:38px;font-weight:600">{q}</div><div style="background:#f5b800;color:#15171a;font-weight:900;font-size:34px;padding:10px 22px;border-radius:12px;transform:skewX(-8deg)">{a}</div></div>' for q, a in righe)}
 <div style="margin-top:44px;background:#23262b;border-radius:22px;padding:28px 34px;font-size:34px;font-weight:600;line-height:1.3">Chi lavora sul serio li ha <span class=y><b>tutti e due</b></span>: stessa batteria <b>18V XR</b>, la sposti dall'uno all'altro.</div>
</div>""" + foot()

# 5 — CTA
s5 = head(4) + glow(260, 760, 560) + f"""
<div style="position:absolute;left:70px;top:210px;width:940px">
 <div style="font-weight:900;font-size:96px;line-height:.95">E tu quale<br><span class=y>usi di più?</span></div>
 <div style="font-size:40px;font-weight:600;color:#d6d7d9;margin-top:26px">Scrivilo nei commenti: <b class=y>trapano</b> o <b class=y>impulsi</b> 👇</div>
</div>
<div style="position:absolute;left:70px;top:600px;display:flex;flex-direction:column;gap:22px;width:940px">
 <div style="font-size:36px;font-weight:600">🔖 <b>Salva</b> il post per quando devi comprare</div>
 <div style="font-size:36px;font-weight:600">🏷️ <b>Tagga</b> il collega che fora col tassellatore pure i mobili</div>
</div>
<div style="position:absolute;left:40px;right:40px;bottom:150px;background:#f5b800;color:#15171a;border-radius:22px;padding:28px 34px;display:flex;align-items:center;justify-content:space-between">
 <div><div style="font-size:30px;font-weight:700">Dubbi? Chiedi a chi li ripara dal 1997</div>
 <div style="font-size:58px;font-weight:900">WhatsApp 375 626 6947</div></div>
</div>
<div style="position:absolute;left:70px;right:70px;bottom:60px;font-size:25px;color:#9a9ca1;font-weight:600">Concessionario DEWALT · Viale Marconi 225, Casavatore (NA) · semistore.it</div>"""

for i, s in enumerate([s1, s2, s3, s4, s5], 1):
    page(f'trapano-o-impulsi-{i}', W, H, s)
print('ok')
