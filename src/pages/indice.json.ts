// Elenco compatto di tutti i prodotti (ricerca istantanea, catalogo, carrello). Generato al build.
import { ordinati, voce } from '../data/catalogo';
export const GET = () => new Response(JSON.stringify(ordinati.map(voce)), { headers: { 'content-type': 'application/json; charset=utf-8' } });
