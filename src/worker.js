// Cloudflare Worker entry point. Requests to /api/* go to the game API (or, for
// Class Battle connections, to that battle's room); everything else is a
// static file from /public.
import { createApi } from './api.js';
import { empires, rules, glossary } from './content.js';
import { battleInfo } from './battle-content.js';
export { BattleRoom } from './battle-room.js';

const api = createApi({ empires, rules, glossary });
const CODE = /^[A-Z]{4}$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/battle/info') return Response.json(battleInfo, { headers: { 'cache-control': 'public, max-age=300' } });
    // Class Battle: /api/battle/ws?code=ABCD (WebSocket) and /api/battle/check?code=ABCD
    if (url.pathname === '/api/battle/ws' || url.pathname === '/api/battle/check') {
      const code = String(url.searchParams.get('code') || '').toUpperCase();
      if (!CODE.test(code)) return Response.json({ ok: false, error: 'Battle codes are 4 letters.' }, { status: 400 });
      const stub = env.BATTLE.get(env.BATTLE.idFromName(code));
      if (url.pathname === '/api/battle/check') return stub.fetch(new Request('https://battle/exists'));
      return stub.fetch(request);
    }
    if (url.pathname.startsWith('/api/')) return api(request, env);
    return env.ASSETS.fetch(request);
  },
};
