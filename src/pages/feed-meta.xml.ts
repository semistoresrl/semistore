// Feed per Meta Commerce Manager (catalogo di Facebook e Instagram): tutti i prodotti con foto e prezzo.
// In Commerce Manager: Catalogo → Origini dati → Feed di dati → URL programmato, ogni giorno.
import { feed, pubblicabili } from '../lib/feed';
export const GET = () => feed(pubblicabili(), 'meta');
