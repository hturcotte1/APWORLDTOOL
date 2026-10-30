// Rule the Empire: browser client.
// The server decides every score. This file only shows screens, sends the
// student's choices, and remembers unfinished games on this device so a
// refresh doesn't lose progress. Scores are never kept in the browser.
import { emblem, SEAL_DEFS } from './emblems.js';
import { MAP, project, LAND } from './map-data.js';
import { RIVERS } from './river-data.js';
import { sceneViewBox, sceneOverlay, viewAround, fallOverlay } from './scenes.js';

const app = document.getElementById('app');
const SAVE_KEY = 'rte-saved-games-v1';
const PLAYER_KEY = 'rte-player-v1';
const BOARD_REFRESH_MS = 10000;
const REPORT_REFRESH_MS = 30000;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const S = {
  config: null,
  empires: {},
  player: null, // { name, period, practice }
  game: null, // { id, empire, name, period, practice, recorded }
  choices: [],
  view: null,
  seen: new Set(), // glossary terms already defined in this game
  seenAt: {}, // snapshot of `seen` per screen, so re-rendering keeps definitions
  screen: 'start',
  returnTo: 'start',
  board: { period: 'all', data: null, timer: null, updated: null },
  report: { period: 'all', data: null, timer: null, updated: null, showAll: false },
  teacher: null, // password, kept in memory only while the page is open
  redraw: null, // redraws the current map scene after a resize
  busy: false,
};

// ---------- small helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const minus = (n) => (n < 0 ? `−${Math.abs(n)}` : `${n}`);
const fmtPts = (n) => (n > 0 ? `+${n}` : minus(n));
const rangeText = (t) => `${fmtPts(t.pointsMin).replace('+0', '0')} to ${fmtPts(t.pointsMax)}`;
const plural = (n, word) => `${word}${Math.abs(n) === 1 ? '' : 's'}`;
const keyOfName = (n) => String(n || '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
const empireOf = (id) => S.empires[id];
const shortName = (name) => String(name).replace(/ (Empire|China|Japan)$/, '');
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
const TIER_NUM = { easy: 1, medium: 2, hard: 3 };

function shields(n, max) {
  let out = '';
  for (let i = 0; i < max; i++) {
    out += `<svg viewBox="0 0 20 22" aria-hidden="true" class="${i < n ? 'on' : 'off'}"><path d="M10 1.5 L18 4.5 V10.5 C18 15.5 14.6 19 10 20.8 C5.4 19 2 15.5 2 10.5 V4.5 Z"/><path class="cross" d="M10 6v10M6 10h8"/></svg>`;
  }
  return `<span class="shields" role="img" aria-label="Stability ${n} of ${max}">${out}</span>`;
}

function difficulty(tier, label) {
  return `<span class="diff diff-${tier}"><span class="diff-num">${ROMAN[TIER_NUM[tier]]}</span> ${esc(label)}</span>`;
}

// A laurel wreath drawn around the end-screen seal.
function laurel() {
  let leaves = '';
  for (let i = 0; i < 10; i++) {
    const deg = 112 + i * 14;
    const a = (deg * Math.PI) / 180;
    const x = 70 + 61 * Math.cos(a);
    const y = 70 + 61 * Math.sin(a);
    const rot = deg + 18;
    leaves += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="4.4" ry="10" transform="rotate(${rot} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
    leaves += `<ellipse cx="${(140 - x).toFixed(1)}" cy="${y.toFixed(1)}" rx="4.4" ry="10" transform="rotate(${-rot} ${(140 - x).toFixed(1)} ${y.toFixed(1)})"/>`;
  }
  return `<svg class="laurel" viewBox="0 0 140 140" aria-hidden="true">${leaves}</svg>`;
}

function toast(message, ms = 5000) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.textContent = message;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

function setAccent(color) {
  document.documentElement.style.setProperty('--realm', color || '#7a2e1d');
}

// ---------- maps ----------
const GRATICULE = (() => {
  let d = '';
  for (let lon = -120; lon <= 165; lon += 15) d += `M${project(lon, 0)[0]} 0V${MAP.height}`;
  for (let lat = -45; lat <= 75; lat += 15) d += `M0 ${project(0, lat)[1]}H${MAP.width}`;
  return d;
})();

function mapSvg(viewBox, cls, extra = '', fit = 'slice') {
  return `<svg class="${cls}" viewBox="${viewBox}" preserveAspectRatio="xMidYMid ${fit}" aria-hidden="true" focusable="false">
    <rect class="sea" x="-500" y="-500" width="${MAP.width + 1000}" height="${MAP.height + 1000}"/>
    <path class="grat" d="${GRATICULE}"/>
    <use href="#land-shape" class="coast"/>
    <use href="#land-shape" class="land"/>
    ${extra}
  </svg>`;
}

// A crop of the world map centered on a capital: [x, y, w, h].
function cropAround(capital, w, h) {
  const [cx, cy] = project(capital.lon, capital.lat);
  const x = Math.min(Math.max(cx - w / 2, 0), MAP.width - w);
  const y = Math.min(Math.max(cy - h / 2, 0), MAP.height - h);
  return [x, y, w, h];
}

// The big map behind every screen; during a game it shows the empire's region.
function focusTable(empire) {
  const svg = document.querySelector('#maptable svg');
  if (!svg) return;
  const vb = empire?.capital ? cropAround(empire.capital, 520, 300).join(' ') : `0 0 ${MAP.width} ${MAP.height}`;
  if (svg.getAttribute('viewBox') === vb) return;
  svg.classList.add('fading');
  setTimeout(() => {
    svg.setAttribute('viewBox', vb);
    svg.classList.remove('fading');
  }, reducedMotion ? 0 : 250);
}

// ---------- device storage (only to resume unfinished games) ----------
function readSaved() {
  try {
    const list = JSON.parse(localStorage.getItem(SAVE_KEY));
    return Array.isArray(list) ? list.filter((g) => g && g.id && empireOf(g.empire)) : [];
  } catch {
    return [];
  }
}
function writeSaved(list) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(list.slice(0, 5)));
  } catch {
    /* storage unavailable: resuming just won't work */
  }
}
function saveGame() {
  if (!S.game) return;
  const list = readSaved().filter((g) => g.id !== S.game.id);
  if (!S.view?.ending) {
    list.unshift({ ...S.game, choices: S.choices, seen: [...S.seen], screen: S.screen, decision: S.view?.decision || 1 });
  }
  writeSaved(list);
}
function forgetGame(id) {
  writeSaved(readSaved().filter((g) => g.id !== id));
}
function loadPlayer() {
  try {
    return JSON.parse(localStorage.getItem(PLAYER_KEY)) || null;
  } catch {
    return null;
  }
}
function savePlayer(p) {
  try {
    localStorage.setItem(PLAYER_KEY, JSON.stringify({ name: p.name, period: p.period }));
  } catch {
    /* ignore */
  }
}

// ---------- server ----------
async function api(path, body, headers = {}) {
  const opts = body === undefined
    ? { headers }
    : { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) };
  let res;
  try {
    res = await fetch(path, opts);
  } catch {
    throw new Error("Couldn't reach the game server. Check your internet connection and try again.");
  }
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const err = new Error(data.error || `Something went wrong (error ${res.status}). Please try again.`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// ---------- glossary: define key terms the first time they appear ----------
let annotator = null;
function setGlossary(empireId) {
  const terms = new Map();
  for (const t of S.config.glossary) terms.set(t.term.toLowerCase(), t);
  for (const t of empireOf(empireId)?.glossary || []) terms.set(t.term.toLowerCase(), t);
  const variants = new Map();
  for (const t of terms.values()) for (const v of [t.term, ...(t.match || [])]) variants.set(v.toLowerCase(), t);
  const pattern = [...variants.keys()]
    .sort((a, b) => b.length - a.length)
    .map((v) => esc(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const re = pattern ? new RegExp(`(^|[^\\p{L}\\p{M}])(${pattern})(?![\\p{L}\\p{M}])`, 'giu') : null;
  annotator = { re, variants };
}
function rich(text, seen) {
  const safe = esc(text);
  if (!annotator || !annotator.re) return safe;
  return safe.replace(annotator.re, (all, pre, word) => {
    const t = annotator.variants.get(word.toLowerCase().replace(/&#39;/g, "'"));
    if (!t) return all;
    const key = t.term.toLowerCase();
    if (seen.has(key)) return all;
    seen.add(key);
    return `${pre}<span class="term">${word}</span><span class="def"> (${esc(t.def)})</span>`;
  });
}
// Returns a rich() for one screen: re-rendering the same screen shows the same definitions.
function richFor(screenKey) {
  if (!S.seenAt[screenKey]) S.seenAt[screenKey] = [...S.seen];
  const seen = new Set(S.seenAt[screenKey]);
  return (text) => {
    const html = rich(text, seen);
    seen.forEach((k) => S.seen.add(k));
    return html;
  };
}
// Splits the first letter off so it can be set as a large initial.
function dropCap(html) {
  const m = html.match(/^(\s*)([A-Za-z])/);
  if (!m) return `<p class="lead">${html}</p>`;
  return `<p class="lead"><span class="initial" aria-hidden="true">${m[2]}</span><span class="sr-only">${m[2]}</span>${html.slice(m[0].length)}</p>`;
}

// ---------- screen plumbing ----------
function render(html, focusSelector = 'h1') {
  stopBoardTimer();
  stopReportTimer();
  S.redraw = null;
  app.innerHTML = `<div class="screen ${reducedMotion ? '' : 'enter'}">${html}</div>`;
  window.scrollTo(0, 0);
  const target = app.querySelector(focusSelector);
  if (target) {
    target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  }
}

function go(screen) {
  if (screen !== 'leaderboard') S.returnTo = screen;
  S.screen = screen;
  ({
    start: screenStart,
    empires: screenEmpires,
    intro: screenIntro,
    decision: screenDecision,
    result: screenResult,
    scene: screenScene,
    fall: screenFall,
    end: screenEnd,
    leaderboard: screenLeaderboard,
    report: screenReport,
  })[screen]();
}

function practiceNote() {
  const practice = S.game ? S.game.practice : S.player?.practice;
  if (!practice) return '';
  return `<div class="practice" role="note"><b>Practice run – doesn't count for the leaderboard</b><span>Only your first game counts. Play as often as you like to review.</span></div>`;
}

// The strategy-game bar across the top of every in-game screen.
function hud(decisionNumber, year) {
  const e = empireOf(S.game.empire);
  const v = S.view;
  return `
  <div class="hud">
    <div class="hud-realm">${emblem(e.emblem, e.color, 38)}<div><b>${esc(e.name)}</b><span>${esc(S.game.name || '')}${S.game.period ? ` · Period ${S.game.period}` : ''}</span></div></div>
    <dl class="hud-stats">
      <div><dt>Year</dt><dd>${year}</dd></div>
      <div><dt>Decision</dt><dd>${decisionNumber}</dd></div>
      <div><dt>Score</dt><dd>${minus(v.points)}</dd></div>
      <div><dt>Stability</dt><dd>${shields(v.stability, v.maxStability)}</dd></div>
    </dl>
  </div>
  ${ruler(e, year)}`;
}

// A timeline ruler with a tick every 50 years and a pointer at the current year.
function ruler(e, year) {
  const span = e.endYear - e.startYear;
  const at = (y) => (((y - e.startYear) / span) * 100).toFixed(2);
  let ticks = '';
  for (let y = Math.ceil(e.startYear / 50) * 50; y <= e.endYear; y += 50) {
    ticks += `<span class="tick" style="left:${at(y)}%"><i>${y}</i></span>`;
  }
  for (let y = Math.ceil(e.startYear / 10) * 10; y <= e.endYear; y += 10) {
    if (y % 50) ticks += `<span class="tick minor" style="left:${at(y)}%"></span>`;
  }
  return `<div class="ruler" role="img" aria-label="Year ${year}, on a timeline from ${e.startYear} to ${e.endYear}">
    <div class="ruler-track"><div class="ruler-done" style="width:${at(year)}%"></div>${ticks}<span class="ruler-ptr" style="left:${at(year)}%"><b>${year}</b></span></div>
  </div>`;
}

// ---------- start: the title page ----------
// The maker's mark at the foot of the title page, like a printer's device in an old book.
function makersMark() {
  return `<figure class="makers-mark">
    <svg viewBox="0 0 120 120" width="104" height="104" role="img" aria-label="Created by Henry Turcotte">
      <defs>
        <path id="mark-top" d="M17 60 A43 43 0 0 1 103 60"/>
        <path id="mark-bottom" d="M10.5 60 A49.5 49.5 0 0 0 109.5 60"/>
      </defs>
      <circle cx="60" cy="60" r="56"/>
      <circle cx="60" cy="60" r="53" class="thin"/>
      <circle cx="60" cy="60" r="33"/>
      <circle cx="13" cy="60" r="1.7" class="dot"/>
      <circle cx="107" cy="60" r="1.7" class="dot"/>
      <text class="mark-ring" text-anchor="middle"><textPath href="#mark-top" startOffset="50%">Created by</textPath></text>
      <text class="mark-ring" text-anchor="middle"><textPath href="#mark-bottom" startOffset="50%">Henry Turcotte</textPath></text>
      <text class="mark-initials" x="60" y="71" text-anchor="middle">HT</text>
    </svg>
  </figure>`;
}

function screenStart() {
  setAccent(null);
  focusTable(null);
  S.game = null;
  const saved = readSaved();
  const last = S.player || loadPlayer();
  render(`
  <article class="paper titlepage">
    <p class="imprint">AP World History · Unit 3</p>
    <h1 class="title">Rule the Empire</h1>
    <p class="subtitle">A game of choices among the great land empires, 1450–1750</p>
    <div class="seal-row" aria-hidden="true">${S.config.empires.map((e) => emblem(e.emblem, e.color, 34)).join('')}</div>
    ${saved.length ? `
    <section class="unfinished">
      <h2 class="rubric">Unfinished reigns</h2>
      ${saved.map((g) => {
        const e = empireOf(g.empire);
        return `<div class="saved-row">${emblem(e.emblem, e.color, 36)}<div class="grow"><b>${esc(g.name || 'Player')}</b>, ${esc(e.name)}<br><span class="fine">Period ${esc(g.period || '?')} · Decision ${g.decision || 1}${g.practice ? ' · Practice run' : ''}</span></div><button class="btn" data-resume="${esc(g.id)}">Resume</button></div>`;
      }).join('')}
    </section>` : ''}
    <form id="start-form" class="enlist" novalidate>
      <h2 class="rubric">Who rules today?</h2>
      <label class="field" for="name">First name</label>
      <input id="name" name="name" type="text" maxlength="20" autocomplete="given-name" autocapitalize="words" spellcheck="false" value="${esc(last?.name || '')}" required>
      <p class="fine">First name only. If a classmate in your period has the same name, add your last initial (“Maya R”).</p>
      <fieldset>
        <legend class="field">Class period</legend>
        <div class="periods">${[1, 2, 3].map((p) => `<label><input type="radio" name="period" value="${p}" ${Number(last?.period) === p ? 'checked' : ''}><span><i aria-hidden="true"></i>Period ${p}</span></label>`).join('')}</div>
      </fieldset>
      <p class="error" id="start-error" role="alert" hidden></p>
      <button class="btn btn-main" type="submit">Choose your realm</button>
    </form>
    <section class="rules">
      <h2 class="rubric">How to play</h2>
      <ol>
        <li><b>Choose a realm.</b> Easy, Medium, or Hard. Harder empires can score higher, but they collapse faster.</li>
        <li><b>Make about eight decisions.</b> Each choice earns points for how well it helped your empire gain, keep, and legitimize power.</li>
        <li><b>Learn what really happened.</b> After every choice, compare your decision with the history.</li>
      </ol>
      <p class="fine">Only your first game counts for the leaderboard. Every game after that is practice.</p>
    </section>
    ${makersMark()}
  </article>`);

  app.querySelector('#start-form').addEventListener('submit', submitStart);
  app.querySelectorAll('[data-resume]').forEach((b) => b.addEventListener('click', () => resume(b.dataset.resume, b)));
}

async function submitStart(ev) {
  ev.preventDefault();
  const form = ev.currentTarget;
  const errEl = form.querySelector('#start-error');
  const name = form.name.value;
  const period = form.period.value;
  const showErr = (m) => {
    errEl.textContent = m;
    errEl.hidden = false;
  };
  if (!name.trim()) return showErr('Please type your first name.');
  if (!period) return showErr('Please pick your class period.');
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    const res = await api('/api/check', { name, period: Number(period) });
    S.player = { name: res.name, period: res.period, practice: res.practice };
    savePlayer(S.player);
    go('empires');
  } catch (e) {
    showErr(e.message);
    btn.disabled = false;
  }
}

// ---------- realm select: the world map ----------
function screenEmpires() {
  setAccent(null);
  focusTable(null);
  S.game = null;
  const pins = S.config.empires.map((e) => {
    const [x, y] = project(e.capital.lon, e.capital.lat);
    return `<button class="pin pin-${e.capital.label || 'below'} diff-${e.tier}" style="left:${((x / MAP.width) * 100).toFixed(2)}%;top:${((y / MAP.height) * 100).toFixed(2)}%" data-empire="${e.id}" aria-label="${esc(e.name)} (${esc(e.tierLabel)}), capital ${esc(e.capital.name)}">
      ${emblem(e.emblem, e.color, 40)}
      <span class="pin-label"><b>${esc(shortName(e.name))}</b><span class="diff-num">${ROMAN[TIER_NUM[e.tier]]}</span></span>
    </button>`;
  }).join('');
  const columns = ['easy', 'medium', 'hard'].map((t) => {
    const tier = S.config.tiers[t];
    return `
    <section class="reg-col diff-${t}">
      <h3>${difficulty(t, tier.label)}</h3>
      <p class="fine">${esc(tier.blurb)}<br>${rangeText(tier)} points per decision · ${tier.stability} stability</p>
      ${S.config.empires.filter((e) => e.tier === t).map((e) => `
        <button class="reg-entry" data-empire="${e.id}">
          ${emblem(e.emblem, e.color, 44)}
          <span><b>${esc(e.name)}</b><span class="fine">${e.startYear}–${e.endYear} · ${esc(e.capital.name)}</span><span class="reg-why">${esc(e.tierReason)}</span></span>
        </button>`).join('')}
    </section>`;
  }).join('');
  render(`
  <header class="board-head">
    <p class="imprint light">Period ${esc(S.player.period)} · ${esc(S.player.name)}</p>
    <h1 class="title light">Choose your realm</h1>
    <p class="subtitle light">Select a capital on the map, or pick from the register below. Classmates may choose the same realm.</p>
  </header>
  ${practiceNote()}
  <div class="worldmap">
    ${mapSvg(`0 0 ${MAP.width} ${MAP.height}`, 'worldmap-svg')}
    <div class="pins">${pins}</div>
    <p class="map-legend"><span class="diff-num">I</span> Easy <span class="diff-num">II</span> Medium <span class="diff-num">III</span> Hard</p>
  </div>
  <article class="paper register-of-empires">
    <h2 class="rubric center">Register of Empires</h2>
    <div class="reg-cols">${columns}</div>
  </article>
  <div class="btn-row"><button class="btn btn-ghost-light" data-go="start">Change name or period</button></div>`);
  app.querySelectorAll('[data-empire]').forEach((b) => b.addEventListener('click', () => {
    S.introEmpire = b.dataset.empire;
    go('intro');
  }));
}

// ---------- dossier ----------
function screenIntro() {
  const e = empireOf(S.introEmpire);
  setAccent(e.color);
  focusTable(e);
  const [x, y, w, h] = cropAround(e.capital, 340, 120);
  const [px, py] = project(e.capital.lon, e.capital.lat);
  render(`
  ${practiceNote()}
  <article class="paper dossier">
    <div class="vignette">${mapSvg(`${x} ${y} ${w} ${h}`, 'vignette-svg', `<circle class="city" cx="${px}" cy="${py}" r="2.2"/><text class="city-name" x="${px + 4}" y="${py - 4}">${esc(e.capital.name)}</text>`)}</div>
    <header class="dossier-head">
      ${emblem(e.emblem, e.color, 92, e.name)}
      <div>
        <p class="imprint">The realm of the</p>
        <h1>${esc(e.name)}</h1>
        <p class="dossier-meta">${e.startYear}–${e.endYear} · ${difficulty(e.tier, e.tierLabel)}</p>
      </div>
    </header>
    ${dropCap(esc(e.intro))}
    <table class="terms">
      <caption class="rubric">Terms of rule</caption>
      <tr><th>Points per decision</th><td>${rangeText(e)}</td></tr>
      <tr><th>Stability</th><td>${shields(e.stability, e.stability)} <span class="fine">Bad choices can cost stability. Lose it all and your empire collapses.</span></td></tr>
      <tr><th>If you collapse</th><td>${esc(S.config.collapsePenalty)}</td></tr>
      <tr><th>Why ${esc(e.tierLabel.toLowerCase())}?</th><td>${esc(e.tierReason)}</td></tr>
      <tr><th>Length</th><td>About 8 decisions</td></tr>
    </table>
    <div class="btn-row">
      <button class="btn btn-main" id="begin">Take the throne</button>
      <button class="btn btn-ghost" data-go="empires">Back to the map</button>
    </div>
  </article>`);
  app.querySelector('#begin').addEventListener('click', begin);
}

async function begin(ev) {
  const btn = ev.currentTarget;
  btn.disabled = true;
  try {
    const res = await api('/api/start', { name: S.player.name, period: S.player.period, empire: S.introEmpire });
    S.game = res.game;
    S.choices = res.choices;
    S.view = res.view;
    S.seen = new Set();
    S.seenAt = {};
    S.player.practice = res.game.practice;
    setGlossary(res.game.empire);
    go('decision');
    saveGame();
  } catch (e) {
    toast(e.message);
    btn.disabled = false;
  }
}

// ---------- decision: the event window ----------
function eventMap(e) {
  const [x, y, w, h] = cropAround(e.capital, 380, 105);
  const [px, py] = project(e.capital.lon, e.capital.lat);
  return `<div class="vignette">${mapSvg(`${x} ${y} ${w} ${h}`, 'vignette-svg', `<circle class="city" cx="${px}" cy="${py}" r="2.2"/><text class="city-name" x="${px + 4}" y="${py - 4}">${esc(e.capital.name)}</text>`)}</div>`;
}

function screenDecision() {
  const e = empireOf(S.game.empire);
  setAccent(e.color);
  focusTable(e);
  const n = S.view.node;
  const r = richFor(`node:${S.choices.length}`);
  const story = dropCap(r(n.text));
  const context = n.context.map((c) => `<aside class="marginalia"><span class="manicule" aria-hidden="true">☞</span><span><b>Because of your earlier choices:</b> ${r(c)}</span></aside>`).join('');
  const options = n.options.map((o, i) => `
    <li><button class="choice" data-key="${esc(o.key)}">
      <span class="choice-num" aria-hidden="true">${ROMAN[i + 1]}.</span>
      <span class="otext">${r(o.text)}</span>
    </button></li>`).join('');
  render(`
  ${hud(S.view.decision, n.year)}
  ${practiceNote()}
  <article class="paper event">
    <header class="event-head">
      <h1>${esc(n.title)}</h1>
      <span class="anno">Anno ${n.year}</span>
    </header>
    ${eventMap(e)}
    ${n.milestone ? '<p class="turning"><span aria-hidden="true">✠</span> A turning point of the age</p>' : ''}
    ${story}
    ${context}
    <h2 class="rubric choose-head">What will you do?</h2>
    <ol class="choices">${options}</ol>
  </article>`);
  app.querySelectorAll('.choice').forEach((b) => b.addEventListener('click', () => choose(b)));
}

async function choose(btn) {
  if (S.busy) return;
  S.busy = true;
  const buttons = app.querySelectorAll('.choice');
  buttons.forEach((b) => (b.disabled = true));
  btn.classList.add('chosen');
  try {
    const res = await api('/api/play', {
      gameId: S.game.id,
      empire: S.game.empire,
      official: !S.game.practice,
      choices: [...S.choices, btn.dataset.key],
    });
    applyPlay(res, true);
  } catch (e) {
    toast(e.message);
    buttons.forEach((b) => (b.disabled = false));
    btn.classList.remove('chosen');
    if (e.status === 409) {
      forgetGame(S.game.id);
      go('start');
    }
  } finally {
    S.busy = false;
  }
}

function applyPlay(res, justChose) {
  if (res.notice === 'removed') toast('Your teacher removed this game from the leaderboard, so it now continues as a practice run.', 8000);
  S.game = { ...S.game, ...res.game, name: res.game.name || S.game.name, period: res.game.period || S.game.period };
  S.choices = res.choices;
  S.view = res.view;
  let screen;
  if (res.resync) {
    toast('Your game was updated to match your saved progress.');
    screen = res.view.ending ? 'end' : 'decision';
  } else if (justChose) screen = 'result';
  else screen = res.view.ending ? 'end' : 'decision';
  if (res.view.ending) {
    forgetGame(S.game.id);
    if (S.player && !S.game.practice) S.player.practice = true;
  }
  go(screen);
  saveGame();
}

// ---------- result: the verdict ----------
function verdictFor(points, tier) {
  if (points === tier.pointsMax) return { cls: 'good', word: 'Masterstroke' };
  if (points >= Math.ceil(tier.pointsMax * 0.6)) return { cls: 'good', word: 'Wise choice' };
  if (points > 0) return { cls: 'ok', word: 'Doubtful' };
  if (points === 0) return { cls: 'bad', word: 'Weak choice' };
  return { cls: 'bad', word: 'Folly' };
}

function screenResult() {
  const e = empireOf(S.game.empire);
  const tier = S.config.tiers[e.tier];
  const v = S.view;
  const r = v.lastResult;
  const rich2 = richFor(`result:${S.choices.length}`);
  const ending = v.ending;
  const verdict = ending?.type === 'collapsed' ? { cls: 'bad', word: 'Ruin' } : verdictFor(r.points, tier);
  const decisionNum = S.choices.length;
  const effects = [`${fmtPts(r.points)} ${plural(r.points, 'point')}`];
  if (r.stabilityDelta) effects.push(`stability ${fmtPts(r.stabilityDelta)}`);
  let fall = '';
  if (ending?.type === 'collapsed') {
    fall = `<div class="fall"><b>The realm is falling.</b> ${ending.cause === 'stability' ? 'Your stability has run out. One mistake too many.' : 'This choice was a disaster.'}</div>`;
  }
  render(`
  ${hud(decisionNum, r.year)}
  ${practiceNote()}
  <article class="paper event outcome" aria-live="polite">
    <header class="event-head">
      <h1>${esc(r.title)}</h1>
      <span class="anno">Anno ${r.year}</span>
    </header>
    <div class="verdict">
      <div class="stamp ${verdict.cls}" role="img" aria-label="${verdict.word}, ${fmtPts(r.points)} ${plural(r.points, 'point')}"><b>${fmtPts(r.points)}</b><span>${verdict.word}</span></div>
      <div class="decree">
        <p class="rubric">Your decree</p>
        <blockquote>${rich2(r.choice)}</blockquote>
        <p class="effects">${effects.join(' · ')}</p>
      </div>
    </div>
    ${fall}
    <section class="history">
      <h2 class="rubric">What actually happened</h2>
      <p>${rich2(r.explanation)}</p>
    </section>
    <div class="btn-row end"><button class="btn btn-main" id="next">${ending ? 'See how your reign ends' : 'Next decision'}</button></div>
  </article>`);
  app.querySelector('#next').addEventListener('click', () => {
    if (ending?.type === 'collapsed') go('fall');
    else if (r.scene) go('scene');
    else go(ending ? 'end' : 'decision');
  });
}

// ---------- scenes: a turning point's map of what actually happened ----------
function sceneMap(view, cls = '') {
  return `<figure class="scene-map ${cls}">${mapSvg(sceneViewBox(view).join(' '), 'scene-svg', '<use href="#river-shape" class="river"/>', 'meet')}<div class="scene-ov-wrap"></div></figure>`;
}

// Draws (or redraws) the animated layer to fit the map's current size.
function drawScene(make, animate) {
  const fig = app.querySelector('.scene-map');
  if (!fig) return;
  const { width, height } = fig.getBoundingClientRect();
  // Keep coastlines and rivers the same thickness at any zoom: --u is map units per pixel.
  const vb = fig.querySelector('.scene-svg').viewBox.baseVal;
  fig.style.setProperty('--u', Math.max(vb.width / width, vb.height / height).toFixed(4));
  fig.querySelector('.scene-ov-wrap').innerHTML = make(width, height, { animate: animate && !reducedMotion });
}

function screenScene() {
  const e = empireOf(S.game.empire);
  setAccent(e.color);
  focusTable(e);
  const r = S.view.lastResult;
  const sc = r.scene;
  const ending = S.view.ending;
  const rich3 = richFor(`scene:${S.choices.length}`);
  render(`
  ${hud(S.choices.length, parseInt(sc.year, 10) || r.year)}
  ${practiceNote()}
  <article class="paper event scene">
    <header class="event-head">
      <h1>${esc(sc.title)}</h1>
      <span class="anno">Anno ${esc(sc.year)}</span>
    </header>
    <p class="turning"><span aria-hidden="true">✠</span> As it truly happened</p>
    ${sceneMap(sc.view)}
    <p class="scene-caption">${rich3(sc.caption)}</p>
    <div class="btn-row end">
      <button class="btn btn-ghost" id="replay"><span aria-hidden="true">↻</span> Replay</button>
      <button class="btn btn-main" id="scene-next">${ending ? 'See how your reign ends' : 'Next decision'}</button>
    </div>
  </article>`);
  const draw = (animate) => drawScene((W, H, o) => sceneOverlay(sc, W, H, o), animate);
  draw(true);
  S.redraw = () => draw(false);
  app.querySelector('#replay').addEventListener('click', () => draw(true));
  app.querySelector('#scene-next').addEventListener('click', () => go(ending ? 'end' : 'decision'));
}

// The fall of an empire: its seal cracks and the map goes dark, then the chronicle.
function screenFall() {
  const e = empireOf(S.game.empire);
  setAccent(e.color);
  focusTable(e);
  const end = S.view.ending;
  const view = viewAround(e.capital);
  render(`
  ${hud(S.choices.length, end.year)}
  ${practiceNote()}
  <article class="paper event scene fall-scene">
    <header class="event-head">
      <h1>The Realm Falls</h1>
      <span class="anno">Anno ${end.year}</span>
    </header>
    ${sceneMap(view, 'fallen')}
    <p class="scene-caption">Your ${esc(shortName(e.name))} realm collapses in ${end.year}. Your reign is over, but your chronicle will show how the real story went.</p>
    <div class="btn-row end"><button class="btn btn-main" id="scene-next">Read your chronicle</button></div>
  </article>`);
  const draw = (animate) => drawScene((W, H, o) => fallOverlay(e, view, W, H, o), animate);
  draw(true);
  S.redraw = () => draw(false);
  app.querySelector('#scene-next').addEventListener('click', () => go('end'));
}

// ---------- ending: the chronicle ----------
function screenEnd() {
  const e = empireOf(S.game.empire);
  setAccent(e.color);
  focusTable(e);
  const end = S.view.ending;
  const collapsed = end.type === 'collapsed';
  const recap = end.recap.map((h) => {
    const cls = h.points > 0 ? 'pos' : h.points === 0 ? 'zero' : 'neg';
    return `
    <tr>
      <td class="yr">${h.year}</td>
      <td>
        <b>${esc(h.title)}</b>
        <span class="you-chose">${esc(h.choice)}</span>
        ${h.best ? `<span class="wiser"><i>The wiser course:</i> ${esc(h.best.text)} (${fmtPts(h.best.points)})</span>` : '<span class="wiser best">You chose the wisest course.</span>'}
      </td>
      <td class="pts ${cls}">${fmtPts(h.points)}${h.stabilityDelta ? `<span class="stab">${shields(1, 1)}${fmtPts(h.stabilityDelta)}</span>` : ''}</td>
    </tr>`;
  }).join('');
  const timeline = end.timeline.map((t) => `<li><span class="tl-year">${esc(t.year)}</span><p>${esc(t.text)}</p></li>`).join('');
  render(`
  <article class="paper chronicle ${collapsed ? 'reign-fallen' : 'reign-endured'}">
    <header class="chron-head">
      <p class="imprint">The chronicle of the</p>
      <h1>${esc(e.name)}</h1>
      <div class="chron-seal">${collapsed ? '' : laurel()}${emblem(e.emblem, collapsed ? '#6b6258' : e.color, 96)}${collapsed ? '<span class="crack" aria-hidden="true"></span>' : ''}</div>
      <p class="fate">${collapsed ? `Fell in ${end.year}` : `Endured to ${end.year}`}</p>
      <p class="fate-text">${esc(end.text)}</p>
    </header>
    <section class="reckoning">
      <div class="final">
        <span class="rubric">Final score</span>
        <b id="final-score" data-to="${end.finalScore}">${minus(end.finalScore)}</b>
        <span class="rating">${esc(end.rating)}</span>
      </div>
      <table class="sums">
        <tr><th>Points from ${end.recap.length} decisions</th><td>${minus(end.points)}</td></tr>
        ${collapsed ? `<tr class="neg"><th>Collapse penalty</th><td>−${end.penalty}</td></tr>` : ''}
        <tr class="total"><th>Final score</th><td>${minus(end.finalScore)}</td></tr>
        <tr class="best-line"><th>Best possible with this empire</th><td>${end.maxScore}</td></tr>
      </table>
    </section>
    ${S.game.recorded
      ? `<p class="entered">Entered in the Period ${esc(S.game.period)} register.</p>`
      : `<div class="practice"><b>Practice run – doesn't count for the leaderboard</b></div>`}
    <div class="btn-row center">
      <button class="btn btn-main" data-go="leaderboard">View the leaderboard</button>
      <button class="btn btn-ghost" id="again">Play again (practice)</button>
    </div>
    <div class="chron-cols">
      <section>
        <h2 class="rubric">Your reign, decision by decision</h2>
        <table class="ledger"><tbody>${recap}</tbody></table>
      </section>
      <section>
        <h2 class="rubric">As it truly happened</h2>
        <ol class="timeline">${timeline}</ol>
      </section>
    </div>
    <p class="fleuron" aria-hidden="true">❦</p>
  </article>`);
  countUp(app.querySelector('#final-score'));
  app.querySelector('#again').addEventListener('click', () => {
    S.player = { name: S.game.name, period: S.game.period, practice: true };
    go('empires');
  });
}

function countUp(el) {
  const to = Number(el.dataset.to);
  if (reducedMotion || !Number.isFinite(to)) return;
  const start = performance.now();
  const dur = 900;
  const step = (now) => {
    const p = Math.min(1, (now - start) / dur);
    el.textContent = minus(Math.round(to * (1 - Math.pow(1 - p, 3))));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------- resume ----------
async function resume(id, btn) {
  const g = readSaved().find((x) => x.id === id);
  if (!g) return;
  btn.disabled = true;
  S.game = { id: g.id, empire: g.empire, name: g.name, period: g.period, practice: g.practice };
  S.player = { name: g.name, period: g.period, practice: g.practice };
  S.seen = new Set(g.seen || []);
  S.seenAt = {};
  setGlossary(g.empire);
  try {
    const res = await api('/api/play', { gameId: g.id, empire: g.empire, official: !g.practice, choices: g.choices || [] });
    const showResult = g.screen === 'result' && !res.resync && res.view.lastResult && !res.view.ending;
    applyPlay(res, showResult);
  } catch (e) {
    toast(e.status === 400 || e.status === 409 ? 'That saved game can no longer be continued. Please start a new one.' : e.message);
    if (e.status === 400 || e.status === 409) forgetGame(id);
    S.game = null;
    go('start');
  }
}

// ---------- leaderboard: the register of rulers ----------
function screenLeaderboard() {
  setAccent(S.game ? empireOf(S.game.empire).color : null);
  focusTable(null);
  const tabs = [['1', 'Period 1'], ['2', 'Period 2'], ['3', 'Period 3'], ['all', 'All classes']];
  render(`
  <header class="board-head">
    <h1 class="title light">Leaderboard</h1>
    <p class="subtitle light">The register of rulers · first games only · <span class="live"><i></i>updates automatically</span></p>
  </header>
  <section class="standings" id="standings" aria-label="Class standings">${standingsHtml()}</section>
  ${S.teacher ? teacherBar() : ''}
  <div class="tabs" role="tablist" aria-label="Choose a class period">
    ${tabs.map(([k, l]) => `<button class="tab" role="tab" aria-selected="${String(S.board.period) === k}" data-period="${k}">${l}</button>`).join('')}
  </div>
  <article class="paper register" id="board">${boardHtml()}</article>
  <div class="btn-row"><button class="btn btn-ghost-light" id="board-back">Back</button></div>`);
  app.querySelectorAll('[data-period]').forEach((b) => b.addEventListener('click', () => {
    S.board.period = b.dataset.period;
    S.board.data = null;
    go('leaderboard');
  }));
  app.querySelector('#board-back').addEventListener('click', () => go(S.returnTo === 'leaderboard' ? 'start' : S.returnTo));
  bindTeacherBar();
  loadBoard();
  S.board.timer = setInterval(() => {
    if (document.visibilityState === 'visible') loadBoard();
  }, BOARD_REFRESH_MS);
}

function stopBoardTimer() {
  if (S.board.timer) clearInterval(S.board.timer);
  S.board.timer = null;
}

async function loadBoard() {
  const period = S.board.period;
  try {
    const data = await api(`/api/leaderboard?period=${period}`);
    if (S.screen !== 'leaderboard' || S.board.period !== period) return;
    S.board.data = data;
    S.board.updated = new Date();
    const st = app.querySelector('#standings');
    if (st) st.innerHTML = standingsHtml();
    const el = app.querySelector('#board');
    if (el) {
      el.innerHTML = boardHtml();
      bindBoard();
    }
  } catch (e) {
    const el = app.querySelector('#board');
    if (el && !S.board.data) el.innerHTML = `<p class="empty">${esc(e.message)}</p>`;
  }
}

// Class against class: each period's average score.
function standingsHtml() {
  const list = S.board.data?.standings;
  if (!list) return '';
  const played = list.filter((p) => p.games);
  const top = played.length ? Math.max(...played.map((p) => p.average)) : null;
  const leaders = played.filter((p) => p.average === top);
  return `<h2 class="sr-only">Class standings</h2>${list.map((p) => {
    const lead = played.length > 1 && leaders.length === 1 && leaders[0] === p;
    return `<div class="stand${lead ? ' lead' : ''}">
      <span class="stand-p">Period ${p.period}${lead ? ' <span class="stand-crown">leads</span>' : ''}</span>
      <b>${p.games ? minus(p.average) : '—'}</b>
      <span class="stand-sub">${p.games ? `average of ${p.games} ${plural(p.games, 'game')}` : 'no games yet'}</span>
    </div>`;
  }).join('')}`;
}

function isMe(row) {
  return S.player && keyOfName(row.name) === keyOfName(S.player.name) && Number(row.period) === Number(S.player.period);
}

function boardHtml() {
  const d = S.board.data;
  if (!d) return '<p class="empty">Opening the register…</p>';
  const all = d.period === 'all';
  const teacher = !!S.teacher;
  if (!d.entries.length && !d.playing.length) {
    return `<p class="empty"><b>No rulers yet.</b> Finish a game to claim the first line of the register.</p>`;
  }
  const realm = (r) => {
    const e = empireOf(r.empire);
    return `<span class="realm">${e ? emblem(e.emblem, e.color, 26) : ''}<span>${esc(shortName(r.empireName))}</span></span>`;
  };
  const crown = (rank) => (rank <= 3 ? `<svg class="crown c${rank}" viewBox="0 0 24 18" aria-hidden="true"><path d="M2 15 L1 4 L7 9 L12 1 L17 9 L23 4 L22 15 Z"/><rect x="2" y="15.5" width="20" height="2.5"/></svg>` : '');
  const rows = d.entries.map((r) => `
    <tr class="${isMe(r) ? 'me' : ''} ${r.rank <= 3 ? 'top' : ''}">
      <td class="rank">${crown(r.rank)}<span>${r.rank}</span></td>
      <td class="who">${esc(r.name)}${isMe(r) ? ' <span class="you">you</span>' : ''}</td>
      ${all ? `<td class="hide-sm">${r.period}</td>` : ''}
      <td class="realm-cell">${realm(r)}<span class="show-sm">${difficulty(r.tier, r.tierLabel)}</span></td>
      <td class="hide-sm">${difficulty(r.tier, r.tierLabel)}</td>
      <td class="num">${minus(r.score)}</td>
      <td class="fate-cell">${r.outcome === 'survived' ? '<span class="fate-survived">Survived</span>' : '<span class="fate-collapsed">Collapsed</span>'}</td>
      ${teacher ? `<td><button class="del" data-del="${r.id}" data-label="${esc(`${r.name} (Period ${r.period}, ${r.empireName}, ${r.score} points)`)}" aria-label="Delete ${esc(r.name)}"><span aria-hidden="true">✕</span><span class="del-word" aria-hidden="true"> Delete</span></button></td>` : ''}
    </tr>`).join('');
  const playing = d.playing.length ? `
    <section class="in-progress">
      <h2 class="rubric">Reigns in progress</h2>
      <p class="playing-list">${d.playing.map((r) => `<span class="chip">${realm(r)} <b>${esc(r.name)}</b>${all ? ` · P${r.period}` : ''}${teacher ? ` <button class="del small" data-del="${r.id}" data-label="${esc(`${r.name} (Period ${r.period}, still playing)`)}" aria-label="Delete ${esc(r.name)}">✕</button>` : ''}</span>`).join('')}</p>
      <p class="fine">${teacher ? 'If a game was abandoned, delete it so the student can start over officially.' : 'These rulers are still in the middle of their first game.'}</p>
    </section>` : '';
  return `
    ${d.entries.length ? `
    <div class="table-wrap"><table class="rolls">
      <thead><tr><th>Rank</th><th>Name</th>${all ? '<th class="hide-sm">Period</th>' : ''}<th>Empire<span class="show-sm"> &amp; tier</span></th><th class="hide-sm">Tier</th><th class="num">Score</th><th>Result</th>${teacher ? '<th><span class="sr-only">Delete</span></th>' : ''}</tr></thead>
      <tbody>${rows}</tbody>
    </table></div>` : ''}
    ${playing}
    <p class="fine center updated">Updated ${S.board.updated ? S.board.updated.toLocaleTimeString() : ''}</p>`;
}

function bindBoard() {
  app.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(`Delete ${b.dataset.label}? This can't be undone. The student will be able to play again for an official score.`)) return;
    try {
      await api('/api/teacher/delete', { id: Number(b.dataset.del) }, { 'x-teacher-password': S.teacher });
      toast('Entry deleted.');
      loadBoard();
    } catch (e) {
      teacherError(e);
    }
  }));
}

// ---------- teacher ----------
function teacherBar() {
  const p = S.board.period;
  return `
  <div class="paper teacher-bar">
    <p><b>Teacher mode is on.</b> Use the ✕ Delete buttons to remove a single entry (for example, a joke name), or clear a whole leaderboard.</p>
    <div class="btn-row">
      <button class="btn" data-go="report">Class report</button>
      ${p !== 'all' ? `<button class="btn btn-danger" id="clear-period">Clear Period ${p} leaderboard</button>` : ''}
      <button class="btn btn-danger" id="clear-all">Clear ALL leaderboards</button>
      <button class="btn btn-ghost" id="lock">Exit teacher mode</button>
    </div>
  </div>`;
}

function bindTeacherBar() {
  bindBoard();
  const cp = app.querySelector('#clear-period');
  const ca = app.querySelector('#clear-all');
  const lock = app.querySelector('#lock');
  if (cp) cp.addEventListener('click', () => clearBoard(Number(S.board.period)));
  if (ca) ca.addEventListener('click', () => clearBoard('all'));
  if (lock) lock.addEventListener('click', () => {
    S.teacher = null;
    toast('Teacher mode is off.');
    go('leaderboard');
  });
}

async function clearBoard(period) {
  const what = period === 'all' ? 'ALL leaderboards for every period' : `the entire Period ${period} leaderboard`;
  if (!confirm(`Clear ${what}? Every score in it will be deleted. This can't be undone.`)) return;
  if (period === 'all' && !confirm('Are you sure? This deletes every score in every period.')) return;
  try {
    const res = await api('/api/teacher/clear', { period }, { 'x-teacher-password': S.teacher });
    toast(`Cleared ${res.deleted} ${res.deleted === 1 ? 'entry' : 'entries'}.`);
    loadBoard();
  } catch (e) {
    teacherError(e);
  }
}

function teacherError(e) {
  if (e.status === 401) {
    S.teacher = null;
    toast('The teacher password was not accepted. Please unlock teacher mode again.');
    go('leaderboard');
  } else toast(e.message);
}

function openTeacher() {
  const dlg = document.getElementById('teacher-dialog');
  const input = document.getElementById('teacher-password');
  const err = document.getElementById('teacher-error');
  err.hidden = true;
  input.value = '';
  if (typeof dlg.showModal === 'function') dlg.showModal();
  else dlg.setAttribute('open', '');
  input.focus();
}

async function submitTeacher(ev) {
  ev.preventDefault();
  const dlg = document.getElementById('teacher-dialog');
  const input = document.getElementById('teacher-password');
  const err = document.getElementById('teacher-error');
  const btn = ev.currentTarget.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    await api('/api/teacher/login', {}, { 'x-teacher-password': input.value });
    S.teacher = input.value;
    dlg.close();
    toast('Teacher mode is on.');
    go('report');
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
  } finally {
    btn.disabled = false;
  }
}

// ---------- teacher: the class report ----------
const pct = (n, d) => (d ? Math.round((100 * n) / d) : 0);

function stopReportTimer() {
  if (S.report.timer) clearInterval(S.report.timer);
  S.report.timer = null;
}

function screenReport() {
  if (!S.teacher) return go('leaderboard');
  setAccent(null);
  focusTable(null);
  const tabs = [['1', 'Period 1'], ['2', 'Period 2'], ['3', 'Period 3'], ['all', 'All classes']];
  render(`
  <header class="board-head">
    <h1 class="title light">Class Report</h1>
    <p class="subtitle light">For the teacher only · first games only · <span class="live"><i></i>updates automatically</span></p>
  </header>
  <div class="paper teacher-bar">
    <p><b>Teacher mode is on.</b> This report comes from students' first games. Practice runs aren't saved, so they aren't counted.</p>
    <div class="btn-row">
      <button class="btn btn-main" data-go="leaderboard">Manage the leaderboard</button>
      <button class="btn btn-ghost" id="lock">Exit teacher mode</button>
    </div>
  </div>
  <div class="tabs" role="tablist" aria-label="Choose a class period">
    ${tabs.map(([k, l]) => `<button class="tab" role="tab" aria-selected="${String(S.report.period) === k}" data-period="${k}">${l}</button>`).join('')}
  </div>
  <article class="paper register report" id="report">${reportHtml()}</article>
  <div class="btn-row"><button class="btn btn-ghost-light" id="report-back">Back</button></div>`);
  app.querySelectorAll('[data-period]').forEach((b) => b.addEventListener('click', () => {
    S.report.period = b.dataset.period;
    S.report.showAll = false;
    go('report');
  }));
  app.querySelector('#report-back').addEventListener('click', () => go('start'));
  app.querySelector('#lock').addEventListener('click', () => {
    S.teacher = null;
    toast('Teacher mode is off.');
    go('leaderboard');
  });
  bindReport();
  loadReport();
  S.report.timer = setInterval(() => {
    if (document.visibilityState === 'visible') loadReport();
  }, REPORT_REFRESH_MS);
}

async function loadReport() {
  try {
    const data = await api('/api/teacher/report', {}, { 'x-teacher-password': S.teacher });
    if (S.screen !== 'report') return;
    S.report.data = data;
    S.report.updated = new Date();
    const el = app.querySelector('#report');
    if (el) {
      el.innerHTML = reportHtml();
      bindReport();
    }
  } catch (e) {
    if (e.status === 401) return teacherError(e);
    const el = app.querySelector('#report');
    if (el && !S.report.data) el.innerHTML = `<p class="empty">${esc(e.message)}</p>`;
  }
}

function bindReport() {
  const more = app.querySelector('#show-all');
  if (more) more.addEventListener('click', () => {
    S.report.showAll = !S.report.showAll;
    app.querySelector('#report').innerHTML = reportHtml();
    bindReport();
  });
}

// A thin horizontal bar with its value written beside it.
function hbar(value, max, cls, title) {
  const w = value > 0 && max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return `<span class="hbar" title="${esc(title)}"><span class="fill ${cls}" style="width:${w}%"></span></span>`;
}

function reportHtml() {
  const d = S.report.data;
  if (!d) return '<p class="empty">Gathering the reports…</p>';
  const period = S.report.period;
  const g = d.periods[period];
  const where = period === 'all' ? 'any class' : `Period ${period}`;
  const updated = `<p class="fine center updated">Updated ${S.report.updated ? S.report.updated.toLocaleTimeString() : ''}</p>`;
  if (!g.games && !g.playing) {
    return `<p class="empty"><b>No games yet.</b> Nobody in ${where} has started a first game.</p>${periodsHtml(d)}${updated}`;
  }
  const tiles = `
    <section class="tiles" aria-label="At a glance">
      <div class="tile"><b>${g.games}</b><span>finished ${plural(g.games, 'game')}</span></div>
      <div class="tile"><b>${g.playing}</b><span>still playing</span></div>
      <div class="tile"><b>${g.average === null ? '—' : minus(g.average)}</b><span>average score</span></div>
      <div class="tile"><b>${g.games ? `${pct(g.survived, g.games)}%` : '—'}</b><span>survived</span></div>
      <div class="tile"><b>${g.best === null ? '—' : minus(g.best)}</b><span>top score</span></div>
    </section>`;
  return `${tiles}${missedHtml(d, g)}${periodsHtml(d)}${empiresHtml(g)}${updated}`;
}

// Period against period: average score, games, and survival rate.
function periodsHtml(d) {
  const rows = ['1', '2', '3'].map((k) => ({ k, ...d.periods[k] }));
  const max = Math.max(1, ...rows.map((r) => r.average || 0));
  return `
    <section class="report-sec">
      <h2 class="rubric">Period against period</h2>
      <table class="vs">
        <thead><tr><th>Class</th><th>Average score</th><th class="num">Games</th><th class="num">Survived</th></tr></thead>
        <tbody>${rows.map((r) => `
          <tr class="${S.report.period === r.k ? 'sel' : ''}">
            <th scope="row">Period ${r.k}</th>
            <td class="bar-cell">${r.games ? `${hbar(r.average, max, 'f-score', `Period ${r.k}: average ${r.average}`)}<b>${minus(r.average)}</b>` : '<span class="fine">no games yet</span>'}</td>
            <td class="num">${r.games}</td>
            <td class="num">${r.games ? `${pct(r.survived, r.games)}%` : '—'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </section>`;
}

// The decisions students missed most often, with how the class answered.
function missedHtml(d, g) {
  const list = g.decisions
    .map((x) => ({ ...x, node: d.nodes[x.key] }))
    .filter((x) => x.node && empireOf(x.node.empire))
    .sort((a, b) => (b.answered >= 3) - (a.answered >= 3) || a.best / a.answered - b.best / b.answered || b.answered - a.answered);
  if (!list.length) return '';
  const shown = S.report.showAll ? list : list.slice(0, 6);
  const items = shown.map((x) => {
    const n = x.node;
    const e = empireOf(n.empire);
    // "Most picked" marks one wrong answer that more students chose than any other answer.
    const top = Math.max(...Object.values(x.counts));
    const leaders = Object.keys(x.counts).filter((id) => x.counts[id] === top);
    const opts = n.options.filter((o) => x.counts[o.id] || n.best.includes(o.id)).map((o) => {
      const c = x.counts[o.id] || 0;
      const isBest = n.best.includes(o.id);
      const mostPicked = !isBest && leaders.length === 1 && leaders[0] === o.id;
      return `
        <li class="opt${isBest ? ' is-best' : ''}">
          <p class="opt-text">${isBest ? '<span class="tag tag-best">✓ Best</span> ' : ''}${mostPicked ? '<span class="tag tag-wrong">Most picked</span> ' : ''}${esc(o.text)}</p>
          <div class="opt-meter">${hbar(c, x.answered, isBest ? 'f-best' : 'f-other', `${c} of ${x.answered} ${plural(x.answered, 'student')}`)}<span class="opt-val">${pct(c, x.answered)}% <span class="fine">(${c})</span></span><span class="pts">${fmtPts(o.points)}</span></div>
        </li>`;
    }).join('');
    return `
      <li class="miss">
        <div class="miss-head">
          ${emblem(e.emblem, e.color, 30)}
          <div class="miss-title"><b>${esc(n.title)}</b><span class="fine">${esc(e.name)} · ${n.year}${n.milestone ? ' · turning point' : ''}</span></div>
          <div class="miss-rate"><b>${pct(x.best, x.answered)}%</b><span>chose the best</span></div>
        </div>
        <ul class="opts">${opts}</ul>
        <p class="fine miss-foot">${x.answered} ${plural(x.answered, 'student')} answered${x.answered < 3 ? ' · only a few answers so far' : ''}</p>
      </li>`;
  }).join('');
  return `
    <section class="report-sec">
      <h2 class="rubric">Most-missed decisions</h2>
      <p class="fine">Sorted so the decisions the fewest students got right come first. Good topics to review in class.</p>
      <ol class="misses">${items}</ol>
      ${list.length > 6 ? `<div class="btn-row center"><button class="btn btn-ghost" id="show-all">${S.report.showAll ? 'Show fewer' : `Show all ${list.length} decisions`}</button></div>` : ''}
    </section>`;
}

function empiresHtml(g) {
  if (!g.empires.length) return '';
  const rows = [...g.empires].sort((a, b) => b.games - a.games).map((r) => {
    const e = empireOf(r.id);
    return `
      <tr>
        <td><span class="realm">${emblem(e.emblem, e.color, 26)}<span>${esc(shortName(e.name))}</span></span></td>
        <td class="hide-sm">${difficulty(e.tier, e.tierLabel)}</td>
        <td class="num">${r.games}</td>
        <td class="num">${minus(r.average)}</td>
        <td class="num">${pct(r.survived, r.games)}%</td>
      </tr>`;
  }).join('');
  return `
    <section class="report-sec">
      <h2 class="rubric">Empires chosen</h2>
      <div class="table-wrap"><table class="rolls emp-table">
        <thead><tr><th>Empire</th><th class="hide-sm">Tier</th><th class="num">Games</th><th class="num">Average</th><th class="num">Survived</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </section>`;
}

// ---------- start up ----------
document.addEventListener('click', (ev) => {
  const t = ev.target.closest('[data-go]');
  if (!t || !S.config) return;
  ev.preventDefault();
  const where = t.dataset.go;
  if (where === 'empires' && !S.player) return go('start');
  go(where);
});

function mountMapTable() {
  // Shared shapes (the world's land and the seal shading) used by every map and seal.
  const defs = document.createElement('div');
  defs.innerHTML = `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs><path id="land-shape" d="${LAND}"/><path id="river-shape" d="${RIVERS}"/>${SEAL_DEFS}</defs></svg>`;
  document.body.prepend(defs.firstElementChild);
  const table = document.createElement('div');
  table.id = 'maptable';
  table.setAttribute('aria-hidden', 'true');
  table.innerHTML = mapSvg(`0 0 ${MAP.width} ${MAP.height}`, 'table-svg');
  document.body.prepend(table);
}

async function init() {
  mountMapTable();
  document.getElementById('teacher-link').addEventListener('click', () => S.config && openTeacher());
  document.getElementById('teacher-form').addEventListener('submit', submitTeacher);
  document.getElementById('teacher-cancel').addEventListener('click', () => document.getElementById('teacher-dialog').close());
  try {
    S.config = await api('/api/config');
  } catch (e) {
    app.innerHTML = `<article class="paper"><p class="empty"><b>The game couldn't load.</b> ${esc(e.message)}</p><button class="btn btn-main" id="reload">Try again</button></article>`;
    app.querySelector('#reload').addEventListener('click', () => location.reload());
    return;
  }
  S.empires = Object.fromEntries(S.config.empires.map((e) => [e.id, e]));
  // Map scenes are drawn in screen pixels, so redraw them when the window changes size.
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => S.redraw && S.redraw(), 150);
  });
  if (location.hash === '#leaderboard') go('leaderboard');
  else go('start');
  if (location.hash === '#teacher') openTeacher();
  // Links like .../#leaderboard or .../#teacher also work in a tab that's already open.
  window.addEventListener('hashchange', () => {
    if (location.hash === '#leaderboard') go('leaderboard');
    if (location.hash === '#teacher') openTeacher();
  });
}

init();
