// Class Battle: the teacher's projector screen. Opens a battle (teacher
// password), shows the join code and seats, runs the rounds with a timer, and
// shows the world map and results between rounds.
import {
  loadInfo, connect, esc, minus, fmtPts, syncClock, secondsLeft, clockText, mountMapTable, shields, seal, shortName, battleMap, toast, ROLE_ICON, reducedMotion,
} from './battle-common.js';
import { sceneViewBox, sceneOverlay } from './scenes.js';
import { MAP } from './map-data.js';
import { RIVERS } from './river-data.js';

const app = document.getElementById('app');
const HOST_KEY = 'rte-battle-host-v1';
const ROMAN = ['', 'I', 'II', 'III', 'IV'];
let G = null;
let link = null;
let state = null;
let session = null; // { code, hostKey }
let lastRender = '';

const readSession = () => {
  try {
    return JSON.parse(localStorage.getItem(HOST_KEY)) || null;
  } catch {
    return null;
  }
};
const writeSession = (s) => {
  try {
    if (s) localStorage.setItem(HOST_KEY, JSON.stringify(s));
    else localStorage.removeItem(HOST_KEY);
  } catch {
    /* ignore */
  }
};
const empire = (id) => G.empires[id];
const titleFor = (empId, role) => G.info.empires[empId]?.titles[role] || G.info.roles[role].label;
const joinUrl = () => `${location.host}/join`;

// ---------- opening a battle ----------
function setupScreen(error = '') {
  const prev = readSession();
  app.innerHTML = `
  <div class="screen">
  <header class="board-head">
    <h1 class="title light">Class Battle</h1>
    <p class="subtitle light">Eight empires, three rulers each, one world map · about 45 minutes</p>
  </header>
  <article class="paper battle-setup">
    ${prev ? `<div class="resume-row"><p>Battle <b>${esc(prev.code)}</b> was running on this computer.</p><button class="btn btn-main" id="resume">Return to battle ${esc(prev.code)}</button></div>` : ''}
    <h2 class="rubric">Start a new battle</h2>
    <form id="new-battle" class="enlist" novalidate>
      <label class="field" for="pw">Teacher password</label>
      <input id="pw" type="password" autocomplete="current-password" required>
      <fieldset>
        <legend class="field">Class period</legend>
        <div class="periods">${[1, 2, 3].map((p) => `<label><input type="radio" name="period" value="${p}" ${p === 1 ? 'checked' : ''}><span><i aria-hidden="true"></i>Period ${p}</span></label>`).join('')}</div>
      </fieldset>
      <fieldset>
        <legend class="field">Time for each round</legend>
        <div class="periods">${G.info.timer.choices.map((s) => `<label><input type="radio" name="timer" value="${s}" ${s === G.info.timer.default ? 'checked' : ''}><span><i aria-hidden="true"></i>${s / 60} min</span></label>`).join('')}</div>
      </fieldset>
      <p class="error" role="alert" ${error ? '' : 'hidden'}>${esc(error)}</p>
      <button class="btn btn-main wide" type="submit">Open the battle</button>
    </form>
    <section class="how">
      <h2 class="rubric">How it works</h2>
      <ol>
        <li><b>Students join</b> at <b>${esc(joinUrl())}</b> with the 4-letter code and take a seat: Ruler, General, or Vizier of an empire. Empty seats are filled automatically.</li>
        <li><b>Four rounds.</b> Everyone decides at the same time, each on their own role's decision. Teammates should talk it over.</li>
        <li><b>Between rounds</b>, this screen shows the world map, the clashes between empires, and the scores. Each student's screen shows what really happened.</li>
      </ol>
    </section>
  </article></div>`;
  app.querySelector('#new-battle').addEventListener('submit', openBattle);
  app.querySelector('#resume')?.addEventListener('click', () => start(prev));
}

async function openBattle(ev) {
  ev.preventDefault();
  const btn = ev.currentTarget.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    const res = await fetch('/api/teacher/battle/new', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-teacher-password': app.querySelector('#pw').value },
      body: JSON.stringify({ period: Number(app.querySelector('input[name=period]:checked').value), timer: Number(app.querySelector('input[name=timer]:checked').value) }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not open a battle.');
    const s = { code: data.code, hostKey: data.hostKey };
    writeSession(s);
    start(s);
  } catch (e) {
    setupScreen(e.message);
  } finally {
    btn.disabled = false;
  }
}

function start(s) {
  session = s;
  link?.close();
  link = connect({
    code: s.code,
    host: s.hostKey,
    onStatus: (st) => { document.body.dataset.link = st; },
    onMessage: (msg) => {
      if (msg.t === 'error' && msg.fatal) {
        writeSession(null);
        setupScreen(msg.message);
      } else if (msg.t === 'error') toast(msg.message);
    },
    onState: (st) => {
      syncClock(st);
      state = st;
      render();
    },
  });
}

const send = (msg) => link.send(msg);

// ---------- screens ----------
function render() {
  let html;
  if (state.phase === 'lobby') html = lobby();
  else if (state.phase === 'round') html = roundScreen();
  else if (state.phase === 'results') html = resultsScreen();
  else html = finalScreen();
  if (html === lastRender) return;
  lastRender = html;
  const y = window.scrollY;
  app.innerHTML = `<div class="screen host-screen">${html}</div>`;
  window.scrollTo(0, y);
  bind();
}

function bind() {
  const on = (sel, fn) => app.querySelector(sel)?.addEventListener('click', fn);
  on('#start', () => send({ t: 'start' }));
  on('#autofill', () => send({ t: 'autofill' }));
  on('#pause', () => send({ t: 'pause' }));
  on('#resume-timer', () => send({ t: 'resume' }));
  on('#add-time', () => send({ t: 'addTime' }));
  on('#reveal', () => { if (confirm('End this round now? Unanswered decisions score nothing.')) send({ t: 'reveal' }); });
  on('#next', () => send({ t: 'next' }));
  on('#end', () => { if (confirm('End the whole battle now and show the final results?')) send({ t: 'end' }); });
  on('#new', () => { writeSession(null); link?.close(); setupScreen(); });
  app.querySelector('#timer-select')?.addEventListener('change', (e) => send({ t: 'timer', seconds: Number(e.target.value) }));
  app.querySelectorAll('[data-kick]').forEach((b) => b.addEventListener('click', () => {
    if (confirm(`Remove ${b.dataset.name} from this battle?`)) send({ t: 'kick', pid: b.dataset.kick });
  }));
  app.querySelectorAll('[data-scene]').forEach((b) => b.addEventListener('click', () => showScene(b.dataset.scene)));
}

function topBar(title, extra = '') {
  return `
  <header class="host-top">
    <div><p class="imprint light">Class Battle · Period ${state.period} · code ${esc(state.code)}</p><h1 class="title light">${title}</h1></div>
    ${extra}
  </header>`;
}

function lobby() {
  const players = state.players.length;
  const cards = state.seats.map((row) => {
    const e = empire(row.id);
    const seat = (r) => {
      const p = row.seats[r];
      return `<li class="${p ? 'filled' : ''}"><span class="seat-role">${ROLE_ICON[r]} ${esc(titleFor(row.id, r))}</span>${p ? `<span class="seat-who"><i class="dot ${p.online ? 'on' : ''}"></i>${esc(p.name)} <button class="kick" data-kick="${p.pid}" data-name="${esc(p.name)}" aria-label="Remove ${esc(p.name)}">✕</button></span>` : '<span class="seat-who open">open</span>'}</li>`;
    };
    return `
    <section class="seat-card host" style="--realm:${e.color}">
      <header>${seal(e, 34)}<div><b>${esc(shortName(e.name))}</b><span class="diff diff-${e.tier}">${esc(e.tierLabel)}</span></div></header>
      <ul class="seat-list">${seat('ruler')}${seat('general')}${seat('vizier')}
      ${row.advisers.map((a) => `<li class="filled"><span class="seat-role">${ROLE_ICON.adviser} Adviser</span><span class="seat-who"><i class="dot ${a.online ? 'on' : ''}"></i>${esc(a.name)} <button class="kick" data-kick="${a.pid}" data-name="${esc(a.name)}" aria-label="Remove ${esc(a.name)}">✕</button></span></li>`).join('')}</ul>
    </section>`;
  }).join('');
  const unseated = state.players.filter((p) => !p.empire);
  return `
  ${topBar('Join the battle')}
  <section class="join-box">
    <p class="join-step">Go to <b>${esc(joinUrl())}</b> and enter the code</p>
    <p class="join-code" aria-label="Battle code ${esc(state.code.split('').join(' '))}">${esc(state.code)}</p>
    <p class="join-count">${players} ${players === 1 ? 'student has' : 'students have'} joined</p>
  </section>
  <div class="seat-grid host">${cards}</div>
  ${unseated.length ? `<p class="unseated light">Still choosing: ${unseated.map((p) => `${esc(p.name)} <button class="kick" data-kick="${p.pid}" data-name="${esc(p.name)}" aria-label="Remove ${esc(p.name)}">✕</button>`).join(' · ')}</p>` : ''}
  <div class="host-controls">
    <label class="light">Time per round <select id="timer-select">${G.info.timer.choices.map((s) => `<option value="${s}" ${s === state.timer ? 'selected' : ''}>${s / 60} min</option>`).join('')}</select></label>
    <button class="btn btn-ghost-light" id="autofill">Fill empty seats</button>
    <button class="btn btn-main" id="start" ${players ? '' : 'disabled'}>Start the battle</button>
  </div>`;
}

function roundScreen() {
  const left = secondsLeft(state);
  const paused = !!state.remaining;
  const rows = Object.entries(state.teams).map(([id, t]) => {
    const e = empire(id);
    const ans = state.answered[id];
    const chips = ['ruler', 'general', 'vizier'].map((r) => `<span class="chip-role ${ans[r] ? 'done' : ''}" title="${esc(titleFor(id, r))}: ${esc(t.roles[r] || 'nobody')}">${ROLE_ICON[r]} ${ans[r] ? '✓' : '…'}</span>`).join('');
    return `<li class="${t.collapsed ? 'fallen' : ''}">${seal(e, 26, t.collapsed)}<b>${esc(shortName(e.name))}</b><span class="chips">${chips}</span></li>`;
  }).join('');
  const total = Object.values(state.answered).reduce((n, a) => n + Object.values(a).filter(Boolean).length, 0);
  const all = Object.values(state.answered).length * 3;
  const clashes = Object.entries(G.info.clashes).filter(([, c]) => c.round === state.round && c.sides.some((s) => state.teams[s]));
  return `
  ${topBar(`Round ${ROMAN[state.round]} of ${ROMAN[state.rounds]}`, `<div class="big-timer ${left != null && left <= 15 ? 'low' : ''} ${paused ? 'paused' : ''}" data-timer>${clockText(left)}</div>`)}
  <div class="host-grid">
    <div class="map-frame">${battleMap(G, state)}</div>
    <aside class="paper status-card">
      <h2 class="rubric">Decisions in: ${total} of ${all}</h2>
      <ul class="answered">${rows}</ul>
      ${clashes.length ? `<h2 class="rubric">Clashes this round</h2><ul class="clash-list">${clashes.map(([, c]) => `<li>⚔ <b>${esc(c.title)}</b> (${c.year}): ${c.sides.map((s) => esc(shortName(empire(s).name))).join(' vs. ')}${c.ai ? ` vs. ${esc(c.ai.name)}` : ''}</li>`).join('')}</ul>` : ''}
    </aside>
  </div>
  <div class="host-controls">
    ${paused ? '<button class="btn btn-main" id="resume-timer">Resume</button>' : '<button class="btn btn-ghost-light" id="pause">Pause</button>'}
    <button class="btn btn-ghost-light" id="add-time">+1 minute</button>
    <button class="btn btn-ghost-light" id="reveal">End round now</button>
    <button class="btn btn-ghost-light" id="end">End battle</button>
  </div>`;
}

const regionName = (id) => {
  const shared = G.info.sharedRegions.find((r) => r.id === id);
  if (shared) return shared.name;
  for (const e of Object.values(G.info.empires)) {
    const r = e.regions.find((x) => x.id === id);
    if (r) return r.name;
  }
  return id;
};

function resultsScreen() {
  const rep = state.report;
  const fresh = { gained: new Set(), lost: new Set() };
  for (const t of Object.values(rep.teams)) {
    t.gained.forEach((g) => fresh.gained.add(g));
    t.lost.forEach((l) => fresh.lost.add(l));
  }
  for (const c of rep.clashes) if (c.ownerAfter !== c.ownerBefore) fresh.gained.add(c.prize);
  const clashCards = rep.clashes.map((c) => {
    const info = G.info.clashes[c.id];
    const side = (k) => {
      const s = c.sides[k];
      const name = s.ai ? s.name : empire(k).name;
      const dots = '●'.repeat(Math.max(0, s.power)) + '○'.repeat(Math.max(0, 5 - s.power));
      const note = s.ai ? 'computer-run enemy' : !s.played ? 'not in play: history decides' : s.collapsed ? 'fallen empire' : s.prep.length ? `+${s.prep.length} from preparation` : 'no extra preparation';
      return `<div class="side ${c.winner === k ? 'winner' : ''}" ${!s.ai ? `style="--realm:${empire(k).color}"` : ''}>
        ${!s.ai ? seal(empire(k), 30) : '<span class="ai-seal">⚔</span>'}<b>${esc(shortName(name))}</b>
        <span class="power" aria-label="strength ${s.power}">${dots}</span><span class="fine">${esc(note)}</span></div>`;
    };
    const [a, b] = Object.keys(c.sides);
    const winnerName = c.sides[c.winner].ai ? c.sides[c.winner].name : empire(c.winner).name;
    return `
    <article class="paper clash-card">
      <h2 class="rubric">⚔ ${esc(c.title)} · ${c.year}</h2>
      <div class="sides">${side(a)}<span class="vs">vs.</span>${side(b)}</div>
      <p class="clash-outcome">Winner: <b>${esc(winnerName)}</b>. Control of ${esc(regionName(c.prize))} ${c.ownerAfter === c.ownerBefore ? 'stays the same' : 'changes hands'}.</p>
      ${info.scene ? `<button class="btn btn-ghost" data-scene="${c.id}">What really happened</button>` : ''}
    </article>`;
  }).join('');
  const order = Object.entries(state.teams).sort((x, y) => y[1].points - x[1].points);
  const rows = order.map(([id, t], i) => {
    const e = empire(id);
    const r = rep.teams[id];
    const changes = [...r.gained.map((g) => `<span class="gain">+ ${esc(regionName(g))}</span>`), ...r.lost.map((l) => `<span class="loss">− ${esc(regionName(l))}</span>`)].join(' ');
    return `<tr class="${t.collapsed ? 'fallen' : ''}">
      <td class="rank">${i + 1}</td>
      <td><span class="realm">${seal(e, 26, t.collapsed)}<span>${esc(shortName(e.name))}</span></span>${rep.collapsed.includes(id) ? ' <span class="fell-tag">fell this round</span>' : t.collapsed ? ' <span class="fell-tag">in exile</span>' : ''}${changes ? `<span class="changes">${changes}</span>` : ''}</td>
      <td class="num delta ${r.points >= 0 ? 'pos' : 'neg'}">${fmtPts(r.points)}</td>
      <td class="num">${minus(t.points)}</td>
      <td>${shields(t.stability, t.maxStability)}</td>
    </tr>`;
  }).join('');
  return `
  ${topBar(`Round ${ROMAN[state.round]}: what happened`)}
  ${rep.collapsed.length ? `<div class="exile fell" role="alert"><b>${rep.collapsed.map((id) => esc(empire(id).name)).join(', ')} ${rep.collapsed.length === 1 ? 'has' : 'have'} fallen!</b> Their rulers play on in exile for half points.</div>` : ''}
  ${clashCards ? `<div class="clash-grid">${clashCards}</div>` : ''}
  <div class="host-grid">
    <div class="map-frame">${battleMap(G, state, { fresh })}</div>
    <article class="paper register scoreboard">
      <table class="rolls"><thead><tr><th>#</th><th>Empire</th><th class="num">Round</th><th class="num">Total</th><th>Stability</th></tr></thead><tbody>${rows}</tbody></table>
    </article>
  </div>
  <div class="host-controls">
    <button class="btn btn-main" id="next">${state.round >= state.rounds ? 'Final results' : `Start round ${ROMAN[state.round + 1]}`}</button>
  </div>`;
}

function finalScreen() {
  const f = state.final;
  if (!f) return topBar('The battle is over');
  const podium = f.teams.slice(0, 3).map((t, i) => {
    const e = empire(t.empire);
    return `<div class="podium-spot p${i + 1} ${t.collapsed ? 'fallen' : ''}" style="--realm:${e.color}">${seal(e, i === 0 ? 96 : 70, t.collapsed)}<b>${esc(shortName(e.name))}</b><span class="score">${minus(t.finalScore)}</span><span class="fine">${esc(t.rating)}</span><span class="place">${['1st', '2nd', '3rd'][i]}</span></div>`;
  }).join('');
  const rows = f.teams.map((t, i) => {
    const e = empire(t.empire);
    return `<tr class="${t.collapsed ? 'fallen' : ''}"><td class="rank">${i + 1}</td><td><span class="realm">${seal(e, 24, t.collapsed)}<span>${esc(shortName(e.name))}</span></span><span class="changes fine">${esc(t.rating)}</span></td><td class="num">${minus(t.points)}</td><td class="num"><b>${minus(t.finalScore)}</b>${t.penalty ? `<span class="changes fine">after −${t.penalty}</span>` : ''}</td></tr>`;
  }).join('');
  const mvp = Object.entries(f.mvps).filter(([, m]) => m).map(([role, m]) => `<div class="mvp">${ROLE_ICON[role]}<b>Best ${esc(G.info.roles[role].label)}</b><span>${esc(m.name)}</span><span class="fine">${esc(shortName(empire(m.empire).name))} · ${fmtPts(m.points)}</span></div>`).join('');
  return `
  ${topBar('Final results')}
  <div class="podium">${podium}</div>
  <div class="mvps-row">${mvp}</div>
  <div class="host-grid">
    <div class="map-frame">${battleMap(G, state)}</div>
    <article class="paper register scoreboard">
      <table class="rolls"><thead><tr><th>#</th><th>Empire</th><th class="num">Points</th><th class="num">Final</th></tr></thead><tbody>${rows}</tbody></table>
      <h2 class="rubric">Every ruler</h2>
      <ol class="student-scores">${f.players.map((p, i) => `<li><span class="rk">${i + 1}.</span> <b>${esc(p.name)}</b> <span class="fine">${esc(shortName(empire(p.empire).name))} · ${p.roles.map((r) => ROLE_ICON[r] || '').join('')}</span> <span class="num">${minus(p.score)}</span></li>`).join('')}</ol>
    </article>
  </div>
  <div class="host-controls"><a class="btn btn-ghost-light" href="/#teacher">Class Report</a><button class="btn btn-main" id="new">Start a new battle</button></div>`;
}

// ---------- "what really happened": the clash's map scene ----------
function showScene(id) {
  const sc = G.info.clashes[id].scene;
  const color = sc.realm && empire(sc.realm) ? empire(sc.realm).color : '#7a2e1d';
  const box = document.createElement('div');
  box.className = 'scene-modal';
  box.innerHTML = `
    <article class="paper event scene" role="dialog" aria-modal="true" aria-label="${esc(sc.title)}" style="--realm:${color}">
      <header class="event-head"><h1>${esc(sc.title)}</h1><span class="anno">Anno ${esc(sc.year)}</span></header>
      <p class="turning"><span aria-hidden="true">✠</span> As it truly happened</p>
      <figure class="scene-map"><svg class="scene-svg" viewBox="${sceneViewBox(sc.view).join(' ')}" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><rect class="sea" x="-500" y="-500" width="${MAP.width + 1000}" height="${MAP.height + 1000}"/><use href="#land-shape" class="coast"/><use href="#land-shape" class="land"/><use href="#river-shape" class="river"/></svg><div class="scene-ov-wrap"></div></figure>
      <p class="scene-caption">${esc(sc.caption)}</p>
      <div class="btn-row end"><button class="btn btn-main" id="close-scene">Back to the results</button></div>
    </article>`;
  document.body.appendChild(box);
  const fig = box.querySelector('.scene-map');
  const { width, height } = fig.getBoundingClientRect();
  const vb = fig.querySelector('.scene-svg').viewBox.baseVal;
  fig.style.setProperty('--u', Math.max(vb.width / width, vb.height / height).toFixed(4));
  fig.querySelector('.scene-ov-wrap').innerHTML = sceneOverlay(sc, width, height, { animate: !reducedMotion });
  const close = () => box.remove();
  box.querySelector('#close-scene').addEventListener('click', close);
  box.addEventListener('click', (e) => { if (e.target === box) close(); });
  box.querySelector('#close-scene').focus();
}

// ---------- start up ----------
async function init() {
  mountMapTable();
  const defs = document.querySelector('svg defs');
  defs.insertAdjacentHTML('beforeend', `<path id="river-shape" d="${RIVERS}"/>`);
  try {
    G = await loadInfo();
  } catch {
    app.innerHTML = `<article class="paper"><p class="empty"><b>The game couldn't load.</b> Check the internet connection and refresh.</p></article>`;
    return;
  }
  const s = readSession();
  if (s && new URLSearchParams(location.search).get('resume') !== null) start(s);
  else setupScreen();
  setInterval(() => {
    const el = app.querySelector('[data-timer]');
    if (el && state?.phase === 'round') {
      const left = secondsLeft(state);
      el.textContent = clockText(left);
      el.classList.toggle('low', left != null && left <= 15);
    }
  }, 500);
}

init();
