# Grafiche social Semi Store
- `gen.py`: foto profilo, copertine, copertine storie in evidenza. Funzioni `page()`, `wm()` (logo ufficiale), `products()` riusabili.
- `post1.py`: esempio di carosello 1080x1350 (Offerte Flash 17/11).
- Prima di lanciare: copiare qui `public/logo.svg`, `public/favicon.svg` e le foto prodotto `p_<codice>.webp` da `public/img/prodotti/`.
- Render: Chrome headless (`google-chrome --headless=new --screenshot`).
- Le immagini da pubblicare vanno in `public/social/AAAA-MM-GG/` (commit su main → online su https://semistore.pages.dev/social/...) e da lì si passano a Metricool.
