// Foto prodotto: true = WebP locale in /img/prodotti, stringa = foto ufficiale esterna (fallback), false = nessuna foto
import foto from './foto.json';
const f = foto as Record<string, boolean | string>;
export function fotoDi(slug: string, w = 800): string | undefined {
  const v = f[slug];
  if (v === true) return `/img/prodotti/${slug}-${w}.webp`;
  if (typeof v === 'string') return v;
  return undefined;
}
export const fotoLocale = (slug: string) => f[slug] === true;
