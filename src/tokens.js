// Small crypto helpers (Web Crypto works in both Workers and Node 22).
const enc = new TextEncoder();

function base64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomId(bytes = 16) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return base64url(a);
}

const keys = new Map();
function hmacKey(secret) {
  if (!keys.has(secret)) {
    keys.set(secret, crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']));
  }
  return keys.get(secret);
}

// Each option is sent to the browser as a code that is different for every
// game and every decision, so the page never reveals which option is which.
export async function optionToken(secret, gameId, nodeId, optionId) {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(`${gameId}|${nodeId}|${optionId}`));
  return base64url(new Uint8Array(sig).slice(0, 9));
}

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(String(text))));
}

// Compares two strings without leaking how much of them matched.
export async function safeEqual(a, b) {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
