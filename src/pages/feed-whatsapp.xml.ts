// Feed per il catalogo WhatsApp Business (max 500 articoli nell'app): selezione da src/lib/feed.ts.
// Si carica in un secondo catalogo di Commerce Manager, collegato al numero WhatsApp 375 626 6947.
import { feed, selezioneWhatsApp } from '../lib/feed';
export const GET = () => feed(selezioneWhatsApp(), 'meta');
