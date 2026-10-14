import { env } from '../config/env.js';

export function startKeepAlive({ enabled, url, intervalMinutes } = env.keepAlive) {
  if (!enabled || !url) return null;
  const target = `${url}/api/health`;
  const ping = async () => {
    try {
      const res = await fetch(target, { headers: { 'User-Agent': 'qlc-keep-alive' }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) console.warn(`[keep-alive] ${target} respondió ${res.status}`);
    } catch (err) {
      console.warn(`[keep-alive] sin respuesta de ${target}: ${err.message}`);
    }
  };
  const timer = setInterval(ping, intervalMinutes * 60000);
  console.info(`[keep-alive] activo: ${target} cada ${intervalMinutes} min`);
  return timer;
}
