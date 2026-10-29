// Rule the Empire: browser client.
// The server decides every score. This file only shows screens, sends the
// student's choices, and remembers unfinished games on this device so a
// refresh doesn't lose progress. Scores are never kept in the browser.
import { emblem } from './emblems.js';

const app = document.getElementById('app');
const SAVE_KEY = 'rte-saved-games-v1';
const PLAYER_KEY = 'rte-player-v1';
const BOARD_REFRESH_MS = 10000;
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
  teacher: null, // password, kept in memory only while the page is open
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
const TIER_PIPS = { easy: 1, medium: 2, hard: 3 };

function shields(n, max) {
  let out = '';
  for (let i = 0; i < max; i++) {
    out += `<svg viewBox="0 0 20 22" aria-hidden="true" class="${i < n ? 'on' : 'off'}"><path d="M10 1.5 L18 4.5 V10.5 C18 15.5 14.6 19 10 20.8 C5.4 19 2 15.5 2 10.5 V4.5 Z"/></svg>`;
  }
  return `<span class="shields" role="img" aria-label="Stability ${n} of ${max}">${out}</span>`;
}

function pips(tier) {
  const n = TIER_PIPS[tier] || 1;
  return `<span class="pips" aria-hidden="true">${[1, 2, 3].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`;
}

function tierTag(tier, label) {
  return `<span class="tier-tag tier-${tier}">${pips(tier)}${esc(label)}</span>`;
}

// A laurel wreath drawn around the end-screen emblem: two leafy branches
// rising from the bottom along a circle.
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
  document.documentElement.style.setProperty('--accent', color || '#8a5a00');
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

// ---------- screen plumbing ----------
function render(html, focusSelector = 'h1') {
  stopBoardTimer();
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
    end: screenEnd,
    leaderboard: screenLeaderboard,
  })[screen]();
}

function practiceBanner() {
  const practice = S.game ? S.game.practice : S.player?.practice;
  if (!practice) return '';
  return `<div class="practice-banner" role="note"><span class="pb-icon" aria-hidden="true">✎</span><div><b>Practice run – doesn't count for the leaderboard</b><span>Only your first game counts. Play as much as you like to review!</span></div></div>`;
}

function hud(decisionNumber, year) {
  const e = empireOf(S.game.empire);
  const v = S.view;
  const span = e.endYear - e.startYear;
  const pct = Math.min(100, Math.max(0, ((year - e.startYear) / span) * 100));
  return `
  <div class="hud" style="--c:${e.color}">
    <div class="hud-who">${emblem(e.emblem, e.color, 44)}<div><b>${esc(e.name)}</b><span>${esc(S.game.name || '')}${S.game.period ? ` · Period ${S.game.period}` : ''}</span></div></div>
    <div class="hud-stats">
      <div class="stat"><b>${decisionNumber}</b><span>Decision</span></div>
      <div class="stat"><b>${minus(v.points)}</b><span>Score</span></div>
      <div class="stat">${shields(v.stability, v.maxStability)}<span>Stability</span></div>
    </div>
  </div>
  <div class="yearline" role="img" aria-label="Year ${year}, between ${e.startYear} and ${e.endYear}">
    <span class="yl-end">${e.startYear}</span>
    <div class="yl-track"><div class="yl-fill" style="width:${pct}%"></div><div class="yl-marker" style="left:clamp(24px, ${pct}%, calc(100% - 24px))"><span>${year}</span></div></div>
    <span class="yl-end">${e.endYear}</span>
  </div>`;
}

// ---------- start ----------
function screenStart() {
  setAccent(null);
  S.game = null;
  const saved = readSaved();
  const last = S.player || loadPlayer();
  const emblems = S.config.empires.map((e, i) => `<span class="float" style="--i:${i}">${emblem(e.emblem, e.color, 46, e.name)}</span>`).join('');
  render(`
  <section class="hero">
    <div class="hero-emblems">${emblems}</div>
    <p class="eyebrow">AP World History · Unit 3</p>
    <h1 class="logo">Rule the Empire</h1>
    <p class="tagline">Land-Based Empires, 1450–1750. Eight empires. Three centuries. Every choice counts.</p>
    <div class="orn" aria-hidden="true"><span></span><i></i><span></span></div>
  </section>
  ${saved.length ? `
  <section class="card resume-card">
    <h2>Continue a game</h2>
    ${saved.map((g) => {
      const e = empireOf(g.empire);
      return `<div class="saved">${emblem(e.emblem, e.color, 40)}<div class="grow"><b>${esc(g.name || 'Player')}</b> · ${esc(e.name)}<br><span class="small muted">Period ${esc(g.period || '?')} · Decision ${g.decision || 1}${g.practice ? ' · Practice run' : ''}</span></div><button class="btn btn-primary" data-resume="${esc(g.id)}">Continue</button></div>`;
    }).join('')}
  </section>` : ''}
  <form class="card start-card" id="start-form" novalidate>
    <h2>Who's ruling today?</h2>
    <label class="field" for="name">Your first name</label>
    <input id="name" name="name" type="text" maxlength="20" autocomplete="given-name" autocapitalize="words" spellcheck="false" value="${esc(last?.name || '')}" required>
    <p class="hint">First name only. If someone in your class has the same name, add your last initial (like “Maya R”).</p>
    <fieldset class="period-field">
      <legend class="field">Class period</legend>
      <div class="periods">${[1, 2, 3].map((p) => `<label><input type="radio" name="period" value="${p}" ${Number(last?.period) === p ? 'checked' : ''}><span>Period ${p}</span></label>`).join('')}</div>
    </fieldset>
    <p class="error" id="start-error" role="alert" hidden></p>
    <button class="btn btn-primary btn-big" type="submit">Choose your empire <span aria-hidden="true">→</span></button>
  </form>
  <section class="how">
    <div class="how-item"><span class="how-num">1</span><b>Pick an empire</b><p>Easy, Medium, or Hard. Harder empires can score higher, but they collapse faster.</p></div>
    <div class="how-item"><span class="how-num">2</span><b>Make about 8 decisions</b><p>Earn points for choices that help your empire gain, keep, and legitimize power.</p></div>
    <div class="how-item"><span class="how-num">3</span><b>See what really happened</b><p>After every choice, compare your decision with real history.</p></div>
  </section>
  <p class="center small muted">Only your <b>first</b> game counts for the leaderboard. Every game after that is practice.</p>`, 'h1');

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

// ---------- empire select ----------
function screenEmpires() {
  setAccent(null);
  S.game = null;
  const groups = ['easy', 'medium', 'hard'].map((t) => {
    const tier = S.config.tiers[t];
    const list = S.config.empires.filter((e) => e.tier === t);
    return `
    <section class="tier-group">
      <div class="tier-head">
        <h2 class="tier-${t}">${pips(t)} ${esc(tier.label)}</h2>
        <p>${esc(tier.blurb)}</p>
        <div class="tier-meta"><span>${rangeText(tier)} points per decision</span><span>${shields(tier.stability, tier.stability)} stability</span></div>
      </div>
      <div class="empire-grid">${list.map(empireCard).join('')}</div>
    </section>`;
  });
  render(`
  <div class="page-head">
    <p class="eyebrow">Period ${esc(S.player.period)}</p>
    <h1>Choose your empire, ${esc(S.player.name)}</h1>
    <p class="muted">Each empire is rated by how hard it is to rule well. Classmates can pick the same one.</p>
  </div>
  ${practiceBanner()}
  ${groups.join('')}
  <div class="btn-row"><button class="btn btn-ghost" data-go="start">← Change name or period</button></div>`);
  app.querySelectorAll('[data-empire]').forEach((b) => b.addEventListener('click', () => {
    S.introEmpire = b.dataset.empire;
    go('intro');
  }));
}

function empireCard(e) {
  return `
  <button class="empire-card" style="--c:${e.color}" data-empire="${e.id}" aria-label="${esc(e.name)}, ${esc(e.tierLabel)}: ${esc(e.tierReason)}">
    <div class="ec-banner">${emblem(e.emblem, e.color, 64)}${tierTag(e.tier, e.tierLabel)}</div>
    <div class="ec-body">
      <h3>${esc(e.name)}</h3>
      <div class="ec-years">${e.startYear}–${e.endYear}</div>
      <p class="ec-why"><b>Why ${esc(e.tierLabel.toLowerCase())}?</b> ${esc(e.tierReason)}</p>
      <p class="ec-sum">${esc(e.summary)}</p>
      <span class="ec-cta">Rule this empire <span aria-hidden="true">→</span></span>
    </div>
  </button>`;
}

// ---------- intro ----------
function screenIntro() {
  const e = empireOf(S.introEmpire);
  setAccent(e.color);
  render(`
  ${practiceBanner()}
  <section class="briefing" style="--c:${e.color}">
    <div class="br-banner">
      <div class="br-emblem">${emblem(e.emblem, e.color, 96, e.name)}</div>
      <div>
        <p class="eyebrow light">${e.startYear}–${e.endYear}</p>
        <h1>${esc(e.name)}</h1>
        ${tierTag(e.tier, e.tierLabel)}
      </div>
    </div>
    <div class="br-body">
      <p class="story">${esc(e.intro)}</p>
      <div class="facts">
        <div class="fact"><b>Points per decision</b><span class="fact-big">${rangeText(e)}</span></div>
        <div class="fact"><b>Stability</b>${shields(e.stability, e.stability)}<span class="small">Bad choices can cost stability. Lose it all and your empire collapses.</span></div>
        <div class="fact"><b>Why ${esc(e.tierLabel.toLowerCase())}?</b><span class="small">${esc(e.tierReason)}</span></div>
      </div>
      <p class="small muted">${esc(S.config.collapsePenalty)} A full reign is about 8 decisions.</p>
      <div class="btn-row">
        <button class="btn btn-primary btn-big" id="begin">Begin your reign <span aria-hidden="true">→</span></button>
        <button class="btn btn-ghost" data-go="empires">Choose a different empire</button>
      </div>
    </div>
  </section>`);
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

// ---------- decision ----------
function screenDecision() {
  const e = empireOf(S.game.empire);
  setAccent(e.color);
  const n = S.view.node;
  const r = richFor(`node:${S.choices.length}`);
  const story = r(n.text);
  const context = n.context.map((c) => `<div class="context"><b>Because of your earlier choices</b>${r(c)}</div>`).join('');
  const options = n.options.map((o, i) => `
    <button class="option" data-key="${esc(o.key)}">
      <span class="letter" aria-hidden="true">${'ABC'[i]}</span>
      <span class="otext">${r(o.text)}</span>
    </button>`).join('');
  render(`
  ${hud(S.view.decision, n.year)}
  ${practiceBanner()}
  <article class="scroll">
    <header class="scroll-head">
      <div class="big-year" aria-hidden="true">${n.year}</div>
      <div>
        <p class="kicker"><span class="sr-only">Year ${n.year}. </span>${n.milestone ? '<span class="star" aria-hidden="true">★</span> Turning point' : `Decision ${S.view.decision}`}</p>
        <h1>${esc(n.title)}</h1>
      </div>
    </header>
    ${context}
    <p class="story">${story}</p>
  </article>
  <h2 class="choose-head">What will you do?</h2>
  <div class="options">${options}</div>`);
  app.querySelectorAll('.option').forEach((b) => b.addEventListener('click', () => choose(b)));
}

async function choose(btn) {
  if (S.busy) return;
  S.busy = true;
  const buttons = app.querySelectorAll('.option');
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

// ---------- result ----------
function screenResult() {
  const e = empireOf(S.game.empire);
  const tier = S.config.tiers[e.tier];
  const v = S.view;
  const r = v.lastResult;
  const rich2 = richFor(`result:${S.choices.length}`);
  const cls = r.points >= Math.ceil(tier.pointsMax * 0.6) ? 'good' : r.points > 0 ? 'ok' : 'bad';
  const label = r.points === tier.pointsMax ? 'Excellent choice!' : cls === 'good' ? 'Strong choice' : r.points > 0 ? 'Not the best choice' : r.points === 0 ? 'Weak choice' : 'Costly mistake';
  const decisionNum = S.choices.length;
  const ending = v.ending;
  let warning = '';
  if (ending?.type === 'collapsed') {
    warning = ending.cause === 'stability'
      ? `<div class="collapse-warning"><span aria-hidden="true">⚠</span> Your stability has run out. One mistake too many: your empire is collapsing.</div>`
      : `<div class="collapse-warning"><span aria-hidden="true">⚠</span> This choice was a disaster. Your empire is collapsing.</div>`;
  }
  render(`
  ${hud(decisionNum, r.year)}
  ${practiceBanner()}
  <section class="result" aria-live="polite">
    <div class="verdict ${cls}">
      <div class="medal"><span>${fmtPts(r.points)}</span></div>
      <div>
        <p class="kicker">Decision ${decisionNum} · ${r.year}</p>
        <h1>${label}</h1>
        <p class="verdict-sub">${fmtPts(r.points)} ${plural(r.points, 'point')}${r.stabilityDelta ? ` · <span class="stab-change">Stability ${fmtPts(r.stabilityDelta)}</span>` : ''}</p>
      </div>
    </div>
    ${warning}
    <div class="chose"><b>You chose</b><p>${rich2(r.choice)}</p></div>
    <div class="history"><b><span aria-hidden="true">📜</span> What actually happened</b><p class="story">${rich2(r.explanation)}</p></div>
    <div class="btn-row end"><button class="btn btn-primary btn-big" id="next">${ending ? 'See how your story ends' : 'Next decision'} <span aria-hidden="true">→</span></button></div>
  </section>`);
  app.querySelector('#next').addEventListener('click', () => go(ending ? 'end' : 'decision'));
}

// ---------- ending ----------
function screenEnd() {
  const e = empireOf(S.game.empire);
  setAccent(e.color);
  const end = S.view.ending;
  const collapsed = end.type === 'collapsed';
  const recap = end.recap.map((h) => {
    const cls = h.points > 0 ? 'pos' : h.points === 0 ? 'zero' : 'neg';
    return `
    <li>
      <span class="rc-year">${h.year}</span>
      <div class="rc-main">
        <b>${esc(h.title)}</b>
        <p>${esc(h.choice)}</p>
        ${h.best ? `<p class="rc-best">Best choice: ${esc(h.best.text)} <span>(${fmtPts(h.best.points)})</span></p>` : '<p class="rc-best ok">✓ You made the best choice.</p>'}
        ${h.stabilityDelta ? `<p class="rc-best">Stability ${fmtPts(h.stabilityDelta)}</p>` : ''}
      </div>
      <span class="pill ${cls}">${fmtPts(h.points)}</span>
    </li>`;
  }).join('');
  const timeline = end.timeline.map((t) => `<li><span class="tl-year">${esc(t.year)}</span><p>${esc(t.text)}</p></li>`).join('');
  render(`
  <section class="finale ${collapsed ? 'collapsed' : 'survived'}" style="--c:${e.color}">
    <div class="finale-emblem">${collapsed ? '' : laurel()}${emblem(e.emblem, collapsed ? '#57534e' : e.color, 96)}${collapsed ? '<span class="crack" aria-hidden="true"></span>' : ''}</div>
    <p class="eyebrow light">${esc(e.name)}</p>
    <h1>${collapsed ? `Your empire collapsed in ${end.year}` : `Your empire endured to ${end.year}!`}</h1>
    <p>${esc(end.text)}</p>
  </section>
  <section class="card scorecard">
    <div class="final">
      <span class="small muted">Final score</span>
      <b id="final-score" data-to="${end.finalScore}">${minus(end.finalScore)}</b>
      <span class="rating ${collapsed ? 'bad' : ''}">${esc(end.rating)}</span>
    </div>
    <div class="score-detail">
      <ul class="breakdown">
        <li><span>Points from ${end.recap.length} decisions</span><b>${minus(end.points)}</b></li>
        ${collapsed ? `<li class="neg"><span>Collapse penalty</span><b>−${end.penalty}</b></li>` : ''}
        <li class="total"><span>Final score</span><b>${minus(end.finalScore)}</b></li>
        <li class="muted"><span>Best possible with this empire</span><span>${end.maxScore}</span></li>
      </ul>
      ${S.game.recorded
        ? `<p class="saved-note"><span aria-hidden="true">✓</span> Saved to the Period ${esc(S.game.period)} leaderboard</p>`
        : `<div class="practice-banner slim"><span class="pb-icon" aria-hidden="true">✎</span><div><b>Practice run – doesn't count for the leaderboard</b></div></div>`}
      <div class="btn-row">
        <button class="btn btn-primary" data-go="leaderboard">View leaderboard</button>
        <button class="btn btn-ghost" id="again">Play again (practice)</button>
      </div>
    </div>
  </section>
  <div class="two-col">
    <section class="card">
      <h2>Your choices</h2>
      <ol class="recap">${recap}</ol>
    </section>
    <section class="card">
      <h2>What really happened</h2>
      <ol class="timeline">${timeline}</ol>
    </section>
  </div>`);
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

// ---------- leaderboard ----------
function screenLeaderboard() {
  setAccent(S.game ? empireOf(S.game.empire).color : null);
  const tabs = [['1', 'Period 1'], ['2', 'Period 2'], ['3', 'Period 3'], ['all', 'All Classes']];
  render(`
  <div class="page-head">
    <p class="eyebrow">Hall of Rulers</p>
    <h1>Leaderboard</h1>
    <p class="muted">First attempts only. <span class="live"><i></i> Updates automatically</span></p>
  </div>
  ${S.teacher ? teacherBar() : ''}
  <div class="tabs" role="tablist" aria-label="Choose a class period">
    ${tabs.map(([k, l]) => `<button class="tab" role="tab" aria-selected="${String(S.board.period) === k}" data-period="${k}">${l}</button>`).join('')}
  </div>
  <div id="board">${boardHtml()}</div>
  <div class="btn-row"><button class="btn btn-ghost" id="board-back">← Back</button></div>`);
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
    const el = app.querySelector('#board');
    if (el) {
      el.innerHTML = boardHtml();
      bindBoard();
    }
  } catch (e) {
    const el = app.querySelector('#board');
    if (el && !S.board.data) el.innerHTML = `<div class="card empty">${esc(e.message)}</div>`;
  }
}

function isMe(row) {
  return S.player && keyOfName(row.name) === keyOfName(S.player.name) && Number(row.period) === Number(S.player.period);
}

function boardHtml() {
  const d = S.board.data;
  if (!d) return '<div class="card loading">Loading the leaderboard…</div>';
  const all = d.period === 'all';
  const teacher = !!S.teacher;
  if (!d.entries.length && !d.playing.length) {
    return `<div class="card empty"><div class="empty-crown" aria-hidden="true">♛</div><b>No rulers yet.</b><p>Finish a game to claim the first spot!</p></div>`;
  }
  const empCell = (r) => {
    const e = empireOf(r.empire);
    return `<span class="emp">${e ? emblem(e.emblem, e.color, 26) : ''}<span>${esc(r.empireName)}</span></span>`;
  };
  const podium = d.entries.filter((r) => r.rank <= 3).slice(0, 3).map((r) => `
    <div class="podium-card place-${r.rank} ${isMe(r) ? 'me' : ''}">
      <div class="medal-ring">${r.rank}</div>
      <b class="pc-name">${esc(r.name)}</b>
      <span class="pc-emp">${empCell(r)}</span>
      <span class="pc-score">${minus(r.score)}</span>
      <span class="pc-meta">${tierTag(r.tier, r.tierLabel)}${all ? ` · P${r.period}` : ''}</span>
    </div>`).join('');
  const rows = d.entries.map((r) => `
    <tr class="${isMe(r) ? 'me' : ''}">
      <td class="rank">${r.rank <= 3 ? `<span class="rank-medal place-${r.rank}">${r.rank}</span>` : r.rank}</td>
      <td class="name">${esc(r.name)}${isMe(r) ? ' <span class="you">you</span>' : ''}</td>
      ${all ? `<td class="hide-sm">P${r.period}</td>` : ''}
      <td>${empCell(r)}</td>
      <td class="hide-sm">${tierTag(r.tier, r.tierLabel)}</td>
      <td class="num">${minus(r.score)}</td>
      <td>${r.outcome === 'survived' ? '<span class="outcome survived">Survived</span>' : '<span class="outcome collapsed">Collapsed</span>'}</td>
      ${teacher ? `<td><button class="del" data-del="${r.id}" data-label="${esc(`${r.name} (Period ${r.period}, ${r.empireName}, ${r.score} points)`)}" aria-label="Delete ${esc(r.name)}"><span aria-hidden="true">✕</span><span class="del-word" aria-hidden="true"> Delete</span></button></td>` : ''}
    </tr>`).join('');
  const playing = d.playing.length ? `
    <section class="card playing">
      <h2>Still playing</h2>
      <div class="playing-list">${d.playing.map((r) => `<span class="chip">${empCell(r)} <b>${esc(r.name)}</b>${all ? ` · P${r.period}` : ''}${teacher ? ` <button class="del small" data-del="${r.id}" data-label="${esc(`${r.name} (Period ${r.period}, still playing)`)}" aria-label="Delete ${esc(r.name)}">✕</button>` : ''}</span>`).join('')}</div>
      <p class="small muted">${teacher ? 'If a game was abandoned, delete it so the student can start over officially.' : 'These rulers are still in the middle of their first game.'}</p>
    </section>` : '';
  return `
    ${d.entries.length ? `<div class="podium">${podium}</div>` : ''}
    ${d.entries.length ? `
    <section class="card table-card">
      <div class="table-wrap"><table class="board">
        <thead><tr><th>Rank</th><th>Name</th>${all ? '<th class="hide-sm">Period</th>' : ''}<th>Empire</th><th class="hide-sm">Tier</th><th class="num">Score</th><th>Result</th>${teacher ? '<th><span class="sr-only">Delete</span></th>' : ''}</tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </section>` : ''}
    ${playing}
    <p class="small muted center">Updated ${S.board.updated ? S.board.updated.toLocaleTimeString() : ''}</p>`;
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
  <div class="teacher-bar">
    <div><b>Teacher mode is on.</b> Use the ✕ Delete buttons to remove a single entry (for example, a joke name), or clear a whole leaderboard.</div>
    <div class="btn-row">
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
    toast(`Cleared ${res.deleted} ${plural(res.deleted, 'entry').replace('entrys', 'entries')}.`);
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
    go('leaderboard');
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
  } finally {
    btn.disabled = false;
  }
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

async function init() {
  document.getElementById('teacher-link').addEventListener('click', () => S.config && openTeacher());
  document.getElementById('teacher-form').addEventListener('submit', submitTeacher);
  document.getElementById('teacher-cancel').addEventListener('click', () => document.getElementById('teacher-dialog').close());
  try {
    S.config = await api('/api/config');
  } catch (e) {
    app.innerHTML = `<div class="card empty"><b>The game couldn't load.</b><p>${esc(e.message)}</p><button class="btn btn-primary" id="reload">Try again</button></div>`;
    app.querySelector('#reload').addEventListener('click', () => location.reload());
    return;
  }
  S.empires = Object.fromEntries(S.config.empires.map((e) => [e.id, e]));
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
