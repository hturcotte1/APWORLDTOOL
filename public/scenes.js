// Turning-point map scenes: a short animation of what actually happened,
// shown after a student answers a turning point (and when an empire falls).
//
// A scene (in the content files) has a view [west, south, east, north] and a
// list of steps: cities, battles, arrows, routes, areas, links, networks, and
// text. The map itself is the shared world map; the steps are drawn on top in
// screen pixels so markers and labels stay readable on any screen size.
import { MAP, project } from './map-data.js';
import { emblem } from './emblems.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const r1 = (n) => Math.round(n * 10) / 10;

const STEP_GAP = 0.8; // seconds between steps
const FIRST_STEP = 0.35;
const DRAW = 0.9; // how long a line takes to draw

// The part of the world map a scene shows, as an SVG viewBox.
export function sceneViewBox(view) {
  const [x0, y0] = project(view[0], view[3]);
  const [x1, y1] = project(view[2], view[1]);
  return [x0, y0, x1 - x0, y1 - y0];
}

// A view around a capital, kept inside the map (used for the fall of an empire).
export function viewAround(capital, halfLon = 14, halfLat = 8) {
  const w = Math.max(MAP.lon0, Math.min(capital.lon - halfLon, MAP.lon1 - 2 * halfLon));
  const s = Math.max(MAP.lat0, Math.min(capital.lat - halfLat, MAP.lat1 - 2 * halfLat));
  return [w, s, w + 2 * halfLon, s + 2 * halfLat];
}

// Maps [lon, lat] to overlay pixels, matching the map's "xMidYMid meet" fit.
function pixelMapper(view, W, H) {
  const [vx, vy, vw, vh] = sceneViewBox(view);
  const s = Math.min(W / vw, H / vh);
  const ox = (W - vw * s) / 2;
  const oy = (H - vh * s) / 2;
  const P = ([lon, lat]) => {
    const [x, y] = project(lon, lat);
    return [ox + (x - vx) * s, oy + (y - vy) * s];
  };
  return { P, pxPerDeg: s * MAP.scale };
}

// A smooth path through the points: a gentle curve for two points, a
// Catmull-Rom spline for more. Returns the path and the direction at the end.
function smoothPath(pts) {
  if (pts.length === 2) {
    const [[ax, ay], [bx, by]] = pts;
    const len = Math.hypot(bx - ax, by - ay);
    const bend = Math.min(0.14 * len, 40);
    const cx = (ax + bx) / 2 + ((by - ay) / (len || 1)) * bend;
    const cy = (ay + by) / 2 - ((bx - ax) / (len || 1)) * bend;
    return { d: `M${r1(ax)} ${r1(ay)}Q${r1(cx)} ${r1(cy)} ${r1(bx)} ${r1(by)}`, angle: Math.atan2(by - cy, bx - cx), mid: [(ax + 2 * cx + bx) / 4, (ay + 2 * cy + by) / 4] };
  }
  let d = `M${r1(pts[0][0])} ${r1(pts[0][1])}`;
  let c2 = pts[0];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${r1(c1[0])} ${r1(c1[1])} ${r1(c2[0])} ${r1(c2[1])} ${r1(p2[0])} ${r1(p2[1])}`;
  }
  const end = pts[pts.length - 1];
  const mid = pts[Math.floor((pts.length - 1) / 2)];
  const next = pts[Math.floor((pts.length - 1) / 2) + 1];
  return { d, angle: Math.atan2(end[1] - c2[1], end[0] - c2[0]), mid: [(mid[0] + next[0]) / 2, (mid[1] + next[1]) / 2] };
}

const t = (s) => `animation-delay:${r1(s * 100) / 100}s`;
let drawings = 0; // makes mask ids unique on the page

// Text with a paper-colored halo; flips sides to stay inside the overlay.
function label(x, y, text, { pos = 'right', cls = 'sc-name', note = '', delay = 0, W }) {
  const size = cls === 'sc-name' ? 7.2 : 6.4; // rough px per character
  const width = Math.max(text.length * size, note.length * 6);
  let anchor = 'start';
  let lx = x + 10;
  let ly = y + 4;
  if (pos === 'left' || (pos === 'right' && lx + width > W - 6)) { anchor = 'end'; lx = x - 10; }
  if (anchor === 'end' && lx - width < 6) { anchor = 'start'; lx = x + 10; }
  if (pos === 'above' || pos === 'below') {
    anchor = 'middle';
    lx = Math.min(Math.max(x, width / 2 + 6), W - width / 2 - 6);
    ly = pos === 'above' ? y - (note ? 24 : 11) : y + 19;
  }
  const noteLine = note ? `<tspan x="${r1(lx)}" dy="13" class="sc-note">${esc(note)}</tspan>` : '';
  return `<text class="sc-label ${cls}" x="${r1(lx)}" y="${r1(ly)}" text-anchor="${anchor}" style="${t(delay)}">${esc(text)}${noteLine}</text>`;
}

function lineLabel(mid, text, delay, W) {
  return text ? label(mid[0], mid[1] - 2, text, { pos: 'above', cls: 'sc-line-label', delay, W }) : '';
}

// One path that "draws itself": the visible stroke is revealed by a mask.
function drawnPath(id, d, cls, delay, width) {
  return `<mask id="${id}" maskUnits="userSpaceOnUse"><path class="sc-reveal" d="${d}" pathLength="1" stroke="#fff" stroke-width="${width + 14}" fill="none" style="${t(delay)}"/></mask>
    <g class="${cls}" mask="url(#${id})"><path class="sc-casing" d="${d}"/><path class="sc-stroke" d="${d}"/></g>`;
}

function arrowHead(x, y, angle, cls, delay) {
  const deg = (angle * 180) / Math.PI;
  return `<g class="sc-pop" style="${t(delay)}"><polygon class="${cls}" points="0,0 -13,-6.5 -13,6.5" transform="translate(${r1(x)} ${r1(y)}) rotate(${r1(deg)})"/></g>`;
}

function stopBar(x, y, angle, delay) {
  const deg = (angle * 180) / Math.PI + 90;
  return `<g class="sc-pop" style="${t(delay)}"><line class="sc-bar" x1="-9" y1="0" x2="9" y2="0" transform="translate(${r1(x)} ${r1(y)}) rotate(${r1(deg)})"/></g>`;
}

const CITY_SHAPES = {
  home: '<circle r="6.5" class="m-own"/><circle r="2.2" class="m-dot"/>',
  taken: '<circle r="6.5" class="m-own"/><circle r="2.2" class="m-dot"/>',
  new: '<rect x="-5.5" y="-5.5" width="11" height="11" transform="rotate(45)" class="m-own"/>',
  ally: '<circle r="6" class="m-ally"/>',
  foe: '<circle r="6" class="m-foe"/>',
  lost: '<circle r="6.5" class="m-foe"/><circle r="2.2" class="m-lostdot"/>',
  plain: '<circle r="4" class="m-plain"/>',
  revolt: '<circle r="6.5" class="m-revolt"/>',
};

// Renders a scene's steps as an SVG overlay of W x H pixels.
export function sceneOverlay(scene, W, H, { animate = true } = {}) {
  const { P, pxPerDeg } = pixelMapper(scene.view, W, H);
  const out = { under: '', lines: '', marks: '', labels: '' };
  const cities = new Map(); // name -> lines of label already used
  let legend = '';
  const uid = `sc${++drawings}`;
  scene.steps.forEach((st, i) => {
    const at = FIRST_STEP + i * STEP_GAP;
    const id = `${uid}-${i}`;
    if ('city' in st) {
      const [x, y] = P(st.at);
      const pulse = ['taken', 'new', 'lost', 'revolt'].includes(st.mark)
        ? `<circle class="sc-pulse ${st.mark === 'lost' ? 'p-foe' : st.mark === 'revolt' ? 'p-revolt' : 'p-own'}" cx="${r1(x)}" cy="${r1(y)}" r="7" style="${t(at + 0.15)}"/>`
        : '';
      out.marks += `${pulse}<g class="sc-pop" style="${t(at)}"><g transform="translate(${r1(x)} ${r1(y)})">${CITY_SHAPES[st.mark] || CITY_SHAPES.plain}</g></g>`;
      if (st.mark === 'revolt') out.marks += `<circle class="sc-flicker" cx="${r1(x)}" cy="${r1(y)}" r="9" style="${t(at + 0.6)}"/>`;
      if (cities.has(st.city)) {
        // The same place again (it changed hands): add the new note on its own line.
        const lines = cities.get(st.city);
        if (st.note) out.labels += label(x, y + (st.pos === 'above' ? -13 : 13) * lines, st.note, { pos: st.pos || 'right', cls: 'sc-note', delay: at + 0.2, W });
        cities.set(st.city, lines + (st.note ? 1 : 0));
        return;
      } else if (st.was) {
        out.labels += `<g class="sc-was" style="${t(at + 1.1)}">${label(x, y, st.was, { pos: st.pos || 'right', delay: at, W })}</g>`;
        out.labels += label(x, y, st.city, { pos: st.pos || 'right', note: st.note || '', delay: at + 1.15, W });
      } else {
        out.labels += label(x, y, st.city, { pos: st.pos || 'right', note: st.note || '', delay: at + 0.1, W });
      }
      cities.set(st.city, st.note ? 2 : 1);
    } else if ('battle' in st) {
      const [x, y] = P(st.at);
      const side = st.won ? 'b-won' : 'b-lost';
      out.marks += `<circle class="sc-burst ${side}" cx="${r1(x)}" cy="${r1(y)}" r="10" style="${t(at + 0.1)}"/>
        <g class="sc-pop sc-shake" style="${t(at)}"><g transform="translate(${r1(x)} ${r1(y)})"><circle r="10.5" class="${side}"/><path class="sc-swords" d="M-5 -5L5 5M5 -5L-5 5"/></g></g>`;
      if (st.battle || st.note) out.labels += label(x, y, st.battle || '', { pos: st.pos || 'right', note: st.note || '', delay: at + 0.2, W });
    } else if ('arrow' in st || 'route' in st || 'link' in st) {
      const raw = st.arrow || st.route || st.link;
      const pts = raw.map(P);
      const { d, angle, mid } = smoothPath(pts);
      const end = pts[pts.length - 1];
      if ('arrow' in st) {
        const style = st.style || 'solid';
        const cls = `sc-line a-${st.side} s-${style}`;
        out.lines += drawnPath(id, d, cls, at, 4);
        if (style === 'repelled') out.lines += stopBar(end[0], end[1], angle, at + DRAW - 0.1);
        else out.lines += arrowHead(end[0], end[1], angle, `sc-head h-${st.side}${style === 'exile' ? ' h-exile' : ''}`, at + DRAW - 0.12);
        out.labels += lineLabel(mid, st.label, at + 0.45, W);
      } else if ('route' in st) {
        out.lines += drawnPath(id, d, `sc-line r-${st.kind}`, at, 5);
        out.labels += lineLabel(mid, st.label, at + 0.45, W);
      } else {
        out.lines += drawnPath(id, d, 'sc-line l-link', at, 3);
        out.labels += lineLabel(mid, st.label, at + 0.45, W);
      }
    } else if ('area' in st) {
      const [x, y] = P(st.at);
      const rx = st.size[0] * pxPerDeg;
      const ry = st.size[1] * pxPerDeg;
      out.under += `<g class="sc-grow" style="${t(at)}"><ellipse class="sc-area ar-${st.side}" cx="${r1(x)}" cy="${r1(y)}" rx="${r1(rx)}" ry="${r1(ry)}"/></g>`;
      out.labels += `<text class="sc-label sc-area-label" x="${r1(x)}" y="${r1(y + 4)}" text-anchor="middle" style="${t(at + 0.3)}">${esc(st.area)}</text>`;
    } else if ('text' in st) {
      const [x, y] = P(st.at);
      out.labels += `<text class="sc-label ${st.kind === 'event' ? 'sc-event' : 'sc-geo'}" x="${r1(x)}" y="${r1(y)}" text-anchor="middle" style="${t(at)}">${esc(st.text)}</text>`;
    } else if ('network' in st) {
      const hub = P(st.network);
      st.to.forEach((p, j) => {
        const q = P(p);
        const delay = at + j * 0.09;
        const d = st.flow === 'in' ? `M${r1(q[0])} ${r1(q[1])}L${r1(hub[0])} ${r1(hub[1])}` : `M${r1(hub[0])} ${r1(hub[1])}L${r1(q[0])} ${r1(q[1])}`;
        out.lines += drawnPath(`${id}-${j}`, d, `sc-line n-line${st.flow === 'in' ? ' n-in' : ''}`, delay, 2);
        out.marks += `<g class="sc-pop" style="${t(delay + 0.5)}"><circle class="m-net" cx="${r1(q[0])}" cy="${r1(q[1])}" r="3.6"/></g>`;
      });
      if (st.label) legend = `<g class="sc-legend sc-label" style="${t(at + 0.6)}" transform="translate(12 ${r1(H - 14)})"><line class="n-line" x1="0" y1="-4" x2="18" y2="-4"/><circle class="m-net" cx="18" cy="-4" r="3.6"/><text x="27" y="0">${esc(st.label)}</text></g>`;
    }
  });
  return `<svg class="scene-ov${animate ? '' : ' static'}" viewBox="0 0 ${r1(W)} ${r1(H)}" width="${r1(W)}" height="${r1(H)}" aria-hidden="true" focusable="false">
    ${out.under}${out.lines}${out.marks}${out.labels}${legend}
  </svg>`;
}

// How long a scene's animation runs, in seconds.
export function sceneLength(scene) {
  return FIRST_STEP + (scene.steps.length - 1) * STEP_GAP + DRAW + 0.4;
}

// The fall of an empire: its seal cracks and fades, and the map goes dark.
export function fallOverlay(empire, view, W, H, { animate = true } = {}) {
  const { P, pxPerDeg } = pixelMapper(view, W, H);
  const [x, y] = P([empire.capital.lon, empire.capital.lat]);
  const size = Math.min(110, Math.max(70, W / 6));
  const half = size / 2;
  return `<svg class="scene-ov fall-ov${animate ? '' : ' static'}" viewBox="0 0 ${r1(W)} ${r1(H)}" width="${r1(W)}" height="${r1(H)}" aria-hidden="true" focusable="false">
    <defs><radialGradient id="fall-dark-${++drawings}" cx="${r1((x / W) * 100)}%" cy="${r1((y / H) * 100)}%" r="75%"><stop offset="0" stop-color="#1a120c" stop-opacity=".15"/><stop offset="1" stop-color="#1a120c" stop-opacity=".78"/></radialGradient></defs>
    <ellipse class="fall-glow" cx="${r1(x)}" cy="${r1(y)}" rx="${r1(7 * pxPerDeg)}" ry="${r1(4.5 * pxPerDeg)}"/>
    <rect class="fall-dark" x="0" y="0" width="${r1(W)}" height="${r1(H)}" fill="url(#fall-dark-${drawings})"/>
    <circle class="sc-burst b-lost fall-ring" cx="${r1(x)}" cy="${r1(y)}" r="${r1(half)}" style="${t(0.9)}"/>
    <circle class="sc-burst b-lost fall-ring" cx="${r1(x)}" cy="${r1(y)}" r="${r1(half)}" style="${t(1.3)}"/>
    <g transform="translate(${r1(x - half)} ${r1(y - half)})">
      <g class="fall-seal">${emblem(empire.emblem, empire.color, size)}</g>
      <circle class="fall-gray" cx="${r1(half)}" cy="${r1(half)}" r="${r1(half * 0.94)}"/>
      <path class="fall-crack" pathLength="1" d="M${r1(half * 0.95)} ${r1(size * 0.05)} L${r1(half * 0.8)} ${r1(size * 0.3)} L${r1(half * 1.12)} ${r1(size * 0.46)} L${r1(half * 0.86)} ${r1(size * 0.66)} L${r1(half * 1.05)} ${r1(size * 0.95)}"/>
    </g>
  </svg>`;
}
