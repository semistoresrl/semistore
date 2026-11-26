# Semi Store · nuovo sito semistore.it

Sito statico (Astro) su **Cloudflare Pages**, pagamenti con **Stripe Checkout**.
Pagine leggerissime (circa 7–10 KB compressi), nessun jQuery, nessun server da mantenere.

## Cosa c'è
- Home, Catalogo con ricerca/filtri, 73 schede prodotto (dati dal vecchio sito), Carrello, Assistenza, Contatti, Chi siamo, Privacy, Condizioni di vendita, 404
- `functions/api/checkout.js` → crea il pagamento Stripe (i prezzi vengono dal server, non modificabili dal browser)
- `functions/api/assistenza.js` → riceve le richieste di riparazione (archivio KV + email opzionale)
- `functions/api/stato.js` → stato riparazione per il cliente; l'app interna lo aggiorna con il token
- `functions/dettagli`, `functions/shop`, `public/_redirects` → 301 dai vecchi link a quelli nuovi (Google non perde nulla)
- `scripts/fetch-images.mjs` → al build scarica le foto dal vecchio sito e le converte in WebP 400/800 px

## Dove si cambiano i dati
- Azienda, telefono, orari, WhatsApp, costi spedizione: `src/data/sito.js`
- Prodotti e prezzi (in centesimi, IVA inclusa): `src/data/prodotti.json`
- Foto migliori: metti `public/img/originali/<slug>.jpg` e cancella le vecchie in `public/img/prodotti/`

## Messa online (circa 30 minuti)
1. **Stripe**: crea l'account su dashboard.stripe.com con i dati di Se.Mi. srl. Attiva Apple Pay/Google Pay in Impostazioni → Metodi di pagamento. Copia la chiave segreta (`sk_live_...`, prima prova con `sk_test_...`).
2. **GitHub**: carica questa cartella in un repository privato.
3. **Cloudflare** → Workers & Pages → Crea → Pages → collega il repository.
   - Build command: `npm run build` · Output: `dist`
   - Variabili (Settings → Variables, tipo *Secret*): `STRIPE_SECRET_KEY`, `ADMIN_TOKEN` (stringa lunga a caso), facoltative `RESEND_API_KEY`, `EMAIL_TO`, `EMAIL_FROM`
   - Settings → Bindings → KV namespace: nome variabile `RICHIESTE` (creane uno nuovo). La configurazione è tutta nel pannello: nel repository non c'è wrangler.toml apposta
4. Prova tutto su `semistore.pages.dev` (con carta di test Stripe 4242 4242 4242 4242).
5. **Cambio dominio**: Pages → Custom domains → aggiungi `semistore.it` e `www.semistore.it`. Cloudflare sostituisce i vecchi record A e attiva HTTPS da solo in pochi minuti.
   - NON toccare i record **MX** e **TXT (SPF)**: servono all'email.
   - Regola consigliata: Rules → Redirect Rules → `www.semistore.it/*` → `https://semistore.it/$1` (301).
6. Dopo il primo build riuscito, salva nel repository la cartella `public/img/prodotti` (le foto), così il sito non dipende più dal vecchio server.
7. Google Search Console: aggiungi il dominio, invia `https://semistore.it/sitemap-index.xml`.

## Ordini
Gli ordini arrivano nella dashboard Stripe (anche app Stripe su telefono) con indirizzo, telefono, eventuale P.IVA e la scelta "SPEDIZIONE" o "RITIRO IN NEGOZIO" nei metadati. Stripe invia al cliente la ricevuta di pagamento. La fattura elettronica (SDI) va emessa come sempre da Danea: Stripe non la invia allo SDI. Nel checkout il cliente può indicare P.IVA e codice SDI/PEC.

## Aggiornare lo stato di una riparazione (dall'app interna o a mano)
```
curl -X POST https://semistore.it/api/stato \
  -H "authorization: Bearer IL_TUO_ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{"scheda":"AS-2026-0142","telefono":"3331234567","stato":"In riparazione","nota":"ricambi arrivati"}'
```
Stati: Ricevuto, In diagnosi, Preventivo inviato, Attesa ricambi, In riparazione, Pronto, Consegnato.

## Sviluppo locale
```
npm install
npm run build
cp .dev.vars.example .dev.vars   # metti le chiavi di test
npx wrangler pages dev dist
```

## Giacenze ufficiali e TikTok Shop
Le giacenze caricate dall'app interna stanno nel database **D1** (binding `DB`). Tutto ciò che ha quantità > 0 va in vendita anche su **TikTok Shop**; le vendite di un canale scalano la giacenza dell'altro.

**Endpoint**
- `POST /api/giacenze` (ADMIN_TOKEN) → `{ "giacenze": [{ "codice": "DCD796P2-QW", "qty": 3, "prezzo": 19900 }] }`. Il codice viene abbinato al catalogo del sito (anche senza `-QW`); per articoli non ancora sul sito invia anche `nome`, `marca`, `immagine` (e se li hai `ean`, `pesoKg`, `descrizione`).
- `GET /api/giacenze` → `{ slug: quantità }` (pubblico). Il checkout blocca gli ordini oltre la giacenza.
- `POST /api/tiktok/sync` (ADMIN_TOKEN) → lavora il prossimo blocco della coda; ripetere finché `restanti` = 0. `{"riprova":true}` rimette in coda gli errori, `{"tutti":true}` riallinea tutto.
- `GET /api/tiktok/stato` (ADMIN_TOKEN) → negozio collegato, conteggi, prodotti con problemi (`?gpsr` elenca fabbricanti/responsabili UE creati in Seller Center).
- `POST /api/tiktok/stato` (ADMIN_TOKEN) → `{ "conformita": { "DEWALT": { "fabbricante": "ID", "responsabile": "ID" }, "STANLEY": {...}, "BLACK+DECKER": {...} } }`
- `POST /api/tiktok/webhook` → ordini TikTok (scala/rimette la giacenza). `POST /api/stripe-webhook` → ordini del sito.

**Attivazione (una volta)**
1. Cloudflare → Storage & Databases → D1 → crea `semistore` → Pages → Settings → Bindings → D1 database, nome variabile `DB`.
2. TikTok Shop Partner Center (partner.tiktokshop.com) → App & Service → crea **Custom app** per il negozio di Se.Mi. srl. Redirect URL: `https://semistore.it/api/tiktok/callback`. Permessi: Shop Authorized Information, Product (base), Order Information, Logistics. Webhook "Order status change": `https://semistore.it/api/tiktok/webhook`.
3. Cloudflare → Variabili (Secret): `TIKTOK_APP_KEY`, `TIKTOK_APP_SECRET`, `TIKTOK_SERVICE_ID`; facoltative per il prezzo: `TIKTOK_COMMISSIONE_PERCENTO` (9), `TIKTOK_AFFILIATI_PERCENTO` (0), `STRIPE_PERCENTO` (1.5), `STRIPE_FISSO_CENT` (25).
   **Prezzo TikTok** = (prezzo sito − Stripe 1,5% − 0,25 €) ÷ (1 − commissione TikTok − creator), arrotondato per eccesso: su TikTok incassi lo stesso netto del sito (es. 296,00 € → 320,13 €). Se un giorno vuoi un ricarico fisso, `TIKTOK_RICARICO_PERCENTO` sostituisce il calcolo.
   Spedizione in Seller Center (TikTok prende la commissione anche su quella): 10,72 € invece di 9,90 €, gratis da 106,89 € invece di 99 €.
4. Apri `https://semistore.it/api/tiktok/collega?token=ADMIN_TOKEN` dal browser in cui sei entrato in Seller Center e conferma.
5. Stripe → Sviluppatori → Webhook → `https://semistore.it/api/stripe-webhook`, evento `checkout.session.completed`; copia il `whsec_...` nella variabile `STRIPE_WEBHOOK_SECRET`.

**Prodotti già caricati a mano in Seller Center**: prima di creare un prodotto il sito lo cerca su TikTok per codice (seller SKU = modello, con o senza `-QW`). Se lo trova lo **collega** senza crearne un doppione e da lì allinea **solo la quantità**: il prezzo messo a mano resta com'è. Per far applicare anche a questi la regola del prezzo impostare `TIKTOK_ALLINEA_PREZZI=1`. Perché l'abbinamento funzioni, in Seller Center il campo "SKU venditore" deve contenere il codice del modello (es. DCD796P2).
   Finché semistore.it non punta al nuovo sito, negli indirizzi qui sopra usare `https://semistore.pages.dev` al posto di `https://semistore.it`.

**Come crea i prodotti su TikTok**: categoria suggerita da TikTok in base al titolo, marchio (deve essere autorizzato con la Brand Qualification), fino a 3 foto, descrizione e caratteristiche del sito, peso dalle caratteristiche (+0,5 kg di imballo, altrimenti 3 kg), scatola 45×35×15 cm se non indicata. Se TikTok chiede dati che mancano (attributi, certificazioni) il prodotto viene creato **in bozza**: si completa in Seller Center e da lì in poi giacenza e prezzo restano allineati da soli.

## Affidabilità clienti (rating, protesti, fido) – 26/11/2026
- **Dove**: nell'app, scheda cliente → riquadro "Affidabilità"; passo "Entro quando paga?" di ogni "paga dopo" (vendita al banco, scaffale consegne); Impostazioni → Clienti → "Affidabilità clienti" (solo admin).
- **Storico interno** (calcolato nell'app): anzianità, fatturato Danea, vendite "paga dopo" pagate puntuali o in ritardo, scaduto aperto.
- **Rating esterno** OpenAPI.it (API Risk, `functions/_lib/affidabilita.js`): `IT-creditscore-advanced|top/{piva}` → rating A1–C3, semaforo, fido stimato; `IT-negativita` + `IT-request/{id}` → protesti, pregiudizievoli, procedure (anche per C.F. dei privati). Risultati in D1 tabella `affidabilita`, validi 90 giorni (si riusano senza pagare). Token salvato cifrato in `segreti` (chiave `openapi_risk`), mai rimandato al browser.
- **Giudizio** = il peggiore tra storico interno, rating esterno, protesti e fido concesso. Se è rosso gli operatori non possono registrare il "paga dopo"; l'admin può autorizzare (collezione `affAutorizzazioni`, nel registro).
- **API** `/api/gestione/affid`: `GET ?k=` (dati salvati), `GET tutti` (riepilogo), `POST {k,servizio,forza}` (forza solo admin), `GET/POST chiave` (solo admin: token, sandbox, auto, soloAdmin).
- **Sito**: quando un'azienda salva il profilo con una P.IVA nuova, se la chiave c'è e "auto" è attivo, parte un rating advanced in background (il cliente non vede nulla).
- Per cambiare fornitore (Cerved, Creditsafe…): nuova funzione in `affidabilita.js` con la stessa uscita (`semaforo`, `rating`, `fido`).
