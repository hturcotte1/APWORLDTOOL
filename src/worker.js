// Cloudflare Worker entry point. Requests to /api/* go to the game API;
// everything else is a static file from /public.
import { createApi } from './api.js';
import { empires, rules, glossary } from './content.js';

const api = createApi({ empires, rules, glossary });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return api(request, env);
    return env.ASSETS.fetch(request);
  },
};
