// Feed prodotti per Google Merchant Center: Google lo rilegge ogni giorno e pubblica i prodotti
// nella scheda Shopping e nella sezione Prodotti del profilo Google Maps (scheda Business collegata).
import { feed, pubblicabili } from '../lib/feed';
export const GET = () => feed(pubblicabili(), 'google');
