import { getImp, setImp } from './db.js';

// Riprova un aggiornamento rimasto in attesa (al massimo ogni 3 minuti, per 2 ore). Chiamata dalle letture delle giacenze.
export async function riprovaRicostruzione(env) {
  if (!env.DEPLOY_HOOK_URL) return;
  const da = await getImp(env, 'ricostruzione_pendente').catch(() => 0);
  if (!da) return;
  if (Date.now() - da > 2 * 3600e3) { await setImp(env, 'ricostruzione_pendente', 0); return; }
  const ult = await getImp(env, 'ricostruzione_tentativo').catch(() => 0);
  if (ult && Date.now() - ult < 180e3) return;
  await setImp(env, 'ricostruzione_tentativo', Date.now());
  const r = await fetch(env.DEPLOY_HOOK_URL, { method: 'POST' }).catch(() => null);
  if (r && r.ok) await setImp(env, 'ricostruzione_pendente', 0);
}
