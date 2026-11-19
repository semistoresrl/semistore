import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://semistore.it',
  trailingSlash: 'always',
  output: 'static',
  build: { format: 'directory', inlineStylesheets: 'always' },
  compressHTML: true,
  prefetch: { prefetchAll: true, defaultStrategy: 'hover' },
  integrations: [
    sitemap({
      filter: (p) => !/\/(carrello|grazie|404|aggiorna)\//.test(p),
      // data dell'ultimo aggiornamento (= questo build): Google ripassa prima le pagine cambiate
      serialize: (item) => ({ ...item, lastmod: new Date().toISOString() }),
    }),
  ],
});
