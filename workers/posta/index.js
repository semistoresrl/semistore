// Riceve ogni email per @semistore.it (Email Routing → "Invia a un Worker") e la consegna all'app.
// Se l'app non risponde riprova; se proprio non riesce la rifiuta con errore temporaneo,
// così il server di chi scrive la rimanda più tardi e non si perde nulla.
export default {
  async email(message, env) {
    const raw = await new Response(message.raw).arrayBuffer();
    let ultimo = '';
    for (let i = 0; i < 4; i++) {
      try {
        const r = await fetch((env.SITO || 'https://semistore.it') + '/api/posta/in', {
          method: 'POST',
          headers: { 'content-type': 'message/rfc822', 'x-posta-token': env.POSTA_TOKEN || env.ADMIN_TOKEN || '', 'x-da': message.from, 'x-a': message.to },
          body: raw,
        });
        if (r.ok) return;
        ultimo = r.status + ' ' + (await r.text()).slice(0, 200);
        if (r.status === 401) break;
      } catch (e) { ultimo = e.message; }
      await new Promise((ok) => setTimeout(ok, 800 * (i + 1)));
    }
    console.log('consegna non riuscita', message.to, ultimo);
    throw new Error('Consegna temporaneamente non riuscita, riprova più tardi');
  },
  async fetch() { return new Response('Posta Semi Store: questo indirizzo non ha pagine.', { status: 404 }); },
};
