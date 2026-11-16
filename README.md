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
   - Settings → Bindings → KV namespace: nome `RICHIESTE` (creane uno nuovo)
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
