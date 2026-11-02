// Shared pieces of the Class Battle screens (battle.html for the projector,
// join.html for students): the live connection, the countdown, the world map
// of territories, and inline key-term definitions.
import { emblem, SEAL_DEFS } from './emblems.js';
import { MAP, project, LAND } from './map-data.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const minus = (n) => (n < 0 ? `−${Math.abs(n)}` : `${n}`);
export const fmtPts = (n) => (n > 0 ? `+${n}` : minus(n));
export const plural = (n, w) => `${w}${Math.abs(n) === 1 ? '' : 's'}`;
export const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export const ROLE_ICON = { ruler: '♛', general: '⚔', vizier: '✒', adviser: '☞' };

// ---------- loading the game's public data ----------
export async function loadInfo() {
  const [config, info] = await Promise.all([fetch('/api/config').then((r) => r.json()), fetch('/api/battle/info').then((r) => r.json())]);
  const empires = Object.fromEntries(config.empires.map((e) => [e.id, e]));
  return { config, info, empires, order: config.empires.map((e) => e.id) };
}

// ---------- the live connection ----------
// Connects to a battle room and keeps reconnecting; onState gets each view.
export function connect({ code, host, pid, onState, onMessage, onStatus }) {
  let ws = null;
  let tries = 0;
  let closedByUs = false;
  let ping = null;
  let currentPid = pid;
  const open = () => {
    const q = new URLSearchParams({ code });
    if (host) q.set('host', host);
    if (currentPid) q.set('pid', currentPid);
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/battle/ws?${q}`);
    ws.onopen = () => {
      tries = 0;
      onStatus?.('online');
      clearInterval(ping);
      ping = setInterval(() => ws.readyState === 1 && ws.send('ping'), 25000);
    };
    ws.onmessage = (ev) => {
      if (ev.data === 'pong') return;
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.t === 'state') onState(msg);
      else {
        if (msg.t === 'joined') currentPid = msg.pid;
        if (msg.t === 'error' && msg.fatal) closedByUs = true;
        onMessage?.(msg);
      }
    };
    ws.onclose = () => {
      clearInterval(ping);
      if (closedByUs) return onStatus?.('closed');
      onStatus?.('reconnecting');
      tries++;
      setTimeout(open, Math.min(8000, 600 * 2 ** Math.min(tries, 4)));
    };
  };
  open();
  return {
    send: (msg) => {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
      else onMessage?.({ t: 'error', message: 'Reconnecting… try again in a moment.' });
    },
    close: () => {
      closedByUs = true;
      ws?.close();
    },
  };
}

// ---------- the countdown (server time, so every screen agrees) ----------
let clockSkew = 0;
export function syncClock(state) {
  if (state.now) clockSkew = Date.now() - state.now;
}
export function secondsLeft(state) {
  if (state.remaining) return Math.ceil(state.remaining / 1000);
  if (!state.deadline) return null;
  return Math.max(0, Math.ceil((state.deadline - (Date.now() - clockSkew)) / 1000));
}
export const clockText = (s) => (s == null ? '' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);

// ---------- map ----------
// Adds the shared map and seal shapes to the page once, and the map table background.
export function mountMapTable() {
  const defs = document.createElement('div');
  defs.innerHTML = `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs><path id="land-shape" d="${LAND}"/>${SEAL_DEFS}</defs></svg>`;
  document.body.prepend(defs.firstElementChild);
  const table = document.createElement('div');
  table.id = 'maptable';
  table.setAttribute('aria-hidden', 'true');
  table.innerHTML = `<svg class="table-svg" viewBox="0 0 ${MAP.width} ${MAP.height}" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect class="sea" x="-500" y="-500" width="${MAP.width + 1000}" height="${MAP.height + 1000}"/><use href="#land-shape" class="coast"/><use href="#land-shape" class="land"/></svg>`;
  document.body.prepend(table);
}

const r1 = (n) => Math.round(n * 10) / 10;

// The world map of the battle: each team's regions in its color, disputed
// regions in their owner's color, and each empire's seal on its capital.
// `fresh` = { gained: Set, lost: Set } highlights this round's changes.
export function battleMap(G, state, { fresh = null, focus = null } = {}) {
  const { info, empires, order } = G;
  const teams = state.teams || {};
  const shapes = [];
  const labels = [];
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  const grow = (x, y, rx, ry) => {
    box[0] = Math.min(box[0], x - rx);
    box[1] = Math.min(box[1], y - ry);
    box[2] = Math.max(box[2], x + rx);
    box[3] = Math.max(box[3], y + ry);
  };
  const ell = (r, cls, color, title) => {
    const [x, y] = project(r.at[0], r.at[1]);
    const rx = r.size[0] * MAP.scale;
    const ry = r.size[1] * MAP.scale;
    grow(x, y, rx, ry);
    shapes.push(`<ellipse class="${cls}" cx="${r1(x)}" cy="${r1(y)}" rx="${r1(rx)}" ry="${r1(ry)}" style="--c:${color}"><title>${esc(title)}</title></ellipse>`);
  };
  for (const id of order) {
    const e = empires[id];
    const t = teams[id];
    for (const r of info.empires[id].regions) {
      const owned = t ? t.regions.includes(r.id) : r.start;
      const lost = fresh?.lost.has(r.id);
      if (!owned && !lost) continue;
      const cls = ['terr', t ? '' : 'idle', t?.collapsed ? 'fallen' : '', fresh?.gained.has(r.id) ? 'gained' : '', lost ? 'lost' : ''].join(' ');
      ell(r, cls, e.color, `${r.name} (${e.name})`);
    }
  }
  for (const r of info.sharedRegions) {
    const owner = state.owners?.[r.id] || r.owner;
    const e = empires[owner];
    const t = teams[owner];
    const cls = ['terr', 'disputed', !t ? 'idle' : '', t?.collapsed ? 'fallen' : '', fresh?.gained.has(r.id) ? 'gained' : ''].join(' ');
    ell(r, cls, e ? e.color : '#6b6258', `${r.name}: ${e ? e.name : 'held by others'}`);
  }
  for (const id of order) {
    const e = empires[id];
    const [x, y] = project(e.capital.lon, e.capital.lat);
    grow(x, y, 10, 10);
  }
  // Zoom to where the empires are (it widens when Spain reaches the Americas).
  const pad = 26;
  let [x0, y0, x1, y1] = [box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad];
  const minRatio = 2.1;
  if ((x1 - x0) / (y1 - y0) < minRatio) {
    const w = (y1 - y0) * minRatio;
    const cx = (x0 + x1) / 2;
    [x0, x1] = [cx - w / 2, cx + w / 2];
  } else {
    const h = (x1 - x0) / minRatio;
    const cy = (y0 + y1) / 2;
    [y0, y1] = [cy - h / 2, cy + h / 2];
  }
  const vb = [x0, y0, x1 - x0, y1 - y0].map(r1);
  const size = r1(vb[2] * 0.032);
  for (const id of order) {
    const e = empires[id];
    const t = teams[id];
    const [x, y] = project(e.capital.lon, e.capital.lat);
    labels.push(`<g class="map-seal ${t ? '' : 'idle'} ${t?.collapsed ? 'fallen' : ''} ${focus === id ? 'focus' : ''}" transform="translate(${r1(x - size / 2)} ${r1(y - size / 2)})">${emblem(e.emblem, t?.collapsed ? '#6b6258' : e.color, size)}</g>`);
  }
  return `<svg class="battle-map" viewBox="${vb.join(' ')}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="World map of the battle">
    <rect class="sea" x="-500" y="-500" width="${MAP.width + 1000}" height="${MAP.height + 1000}"/>
    <use href="#land-shape" class="coast"/><use href="#land-shape" class="land"/>
    ${shapes.join('')}${labels.join('')}
  </svg>`;
}

// Stability shields, as in the solo game.
export function shields(n, max) {
  let out = '';
  for (let i = 0; i < max; i++) out += `<svg viewBox="0 0 20 22" aria-hidden="true" class="${i < n ? 'on' : 'off'}"><path d="M10 1.5 L18 4.5 V10.5 C18 15.5 14.6 19 10 20.8 C5.4 19 2 15.5 2 10.5 V4.5 Z"/><path class="cross" d="M10 6v10M6 10h8"/></svg>`;
  return `<span class="shields" role="img" aria-label="Stability ${n} of ${max}">${out}</span>`;
}

export const seal = (e, size = 32, gray = false) => emblem(e.emblem, gray ? '#6b6258' : e.color, size);
export const shortName = (name) => String(name).replace(/ (Empire|China|Japan)$/, '');

// ---------- key terms: defined in parentheses the first time they appear ----------
export function makeGlossary(config, empireId) {
  const terms = new Map();
  for (const t of config.glossary) terms.set(t.term.toLowerCase(), t);
  for (const t of config.empires.find((e) => e.id === empireId)?.glossary || []) terms.set(t.term.toLowerCase(), t);
  const variants = new Map();
  for (const t of terms.values()) for (const v of [t.term, ...(t.match || [])]) variants.set(v.toLowerCase(), t);
  const pattern = [...variants.keys()].sort((a, b) => b.length - a.length).map((v) => esc(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = pattern ? new RegExp(`(^|[^\\p{L}\\p{M}])(${pattern})(?![\\p{L}\\p{M}])`, 'giu') : null;
  const seen = new Set();
  const snapshots = {};
  const annotate = (text, local) => {
    const safe = esc(text);
    if (!re) return safe;
    return safe.replace(re, (all, pre, word) => {
      const t = variants.get(word.toLowerCase().replace(/&#39;/g, "'"));
      if (!t || local.has(t.term.toLowerCase())) return all;
      local.add(t.term.toLowerCase());
      return `${pre}<span class="term">${word}</span><span class="def"> (${esc(t.def)})</span>`;
    });
  };
  // Re-rendering the same screen (the page redraws on every update) keeps the same definitions.
  return {
    forScreen(key) {
      if (!snapshots[key]) snapshots[key] = [...seen];
      const local = new Set(snapshots[key]);
      return (text) => {
        const html = annotate(text, local);
        local.forEach((k) => seen.add(k));
        return html;
      };
    },
  };
}

export function toast(message, ms = 5000) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.textContent = message;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}
