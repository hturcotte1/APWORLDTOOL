// Class Battle: the student's screen. Join with the code on the board, take a
// seat in an empire, then make your role's decision each round.
import {
  loadInfo, connect, esc, minus, fmtPts, plural, syncClock, secondsLeft, clockText, mountMapTable, shields, seal, shortName, makeGlossary, toast, ROLE_ICON,
} from './battle-common.js';

const app = document.getElementById('app');
const SESSION_KEY = 'rte-battle-player-v1';
const ROMAN = ['', 'I', 'II', 'III', 'IV'];
let G = null;
let link = null;
let state = null;
let session = null; // { code, pid, name }
let pendingName = null;
let formError = '';
let gloss = null;
let lastRender = '';

const readSession = () => {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY)) || null;
  } catch {
    return null;
  }
};
const writeSession = (s) => {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage unavailable: a refresh will just ask to join again */
  }
};

const empire = (id) => G.empires[id];
const titleFor = (empId, role) => (role === 'adviser' ? G.info.adviser.label : G.info.empires[empId]?.titles[role] || G.info.roles[role].label);

function verdict(points, e) {
  if (points === e.pointsMax) return { cls: 'good', word: 'Masterstroke' };
  if (points >= Math.ceil(e.pointsMax * 0.6)) return { cls: 'good', word: 'Wise choice' };
  if (points > 0) return { cls: 'ok', word: 'Doubtful' };
  if (points === 0) return { cls: 'bad', word: 'Weak choice' };
  return { cls: 'bad', word: 'Folly' };
}

// ---------- joining ----------
function joinForm(code = '') {
  return `
  <article class="paper titlepage join-card">
    <p class="imprint">Rule the Empire</p>
    <h1 class="title">Class Battle</h1>
    <p class="subtitle">Join your class: three rulers to an empire, one world map.</p>
    <form id="join-form" class="enlist" novalidate>
      <label class="field" for="code">Battle code (on the board)</label>
      <input id="code" name="code" type="text" class="code-input" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="4" value="${esc(code)}" placeholder="ABCD" required>
      <label class="field" for="name">First name</label>
      <input id="name" name="name" type="text" autocomplete="given-name" autocapitalize="words" spellcheck="false" maxlength="20" value="${esc(pendingName || '')}" required>
      <p class="error" role="alert" ${formError ? '' : 'hidden'}>${esc(formError)}</p>
      <button class="btn btn-main wide" type="submit">Join the battle</button>
    </form>
  </article>`;
}

async function submitJoin(ev) {
  ev.preventDefault();
  const code = app.querySelector('#code').value.trim().toUpperCase();
  const name = app.querySelector('#name').value.trim();
  pendingName = name;
  if (!/^[A-Z]{4}$/.test(code)) return showFormError('Battle codes are 4 letters, like ABCD.');
  if (!name) return showFormError('Please type your first name.');
  const res = await fetch(`/api/battle/check?code=${code}`).then((r) => r.json()).catch(() => ({ ok: false, error: "Couldn't reach the game server." }));
  if (!res.ok) return showFormError(res.error || 'No battle with that code. Check the board.');
  formError = '';
  if (link && session?.code !== code) link.close();
  session = { code, pid: null, name };
  if (!link || link.code !== code) startLink(code, null);
  else link.send({ t: 'join', name });
}

function showFormError(msg) {
  formError = msg;
  const el = app.querySelector('.error');
  if (el) {
    el.textContent = msg;
    el.hidden = false;
  }
}

function startLink(code, pid) {
  link = connect({
    code,
    pid,
    onStatus: (s) => {
      document.body.dataset.link = s;
      if (s === 'online' && session && !session.pid && pendingName) link.send({ t: 'join', name: pendingName });
    },
    onMessage: (msg) => {
      if (msg.t === 'joined') {
        session = { code, pid: msg.pid, name: pendingName };
        writeSession(session);
      } else if (msg.t === 'error') {
        if (msg.fatal) {
          writeSession(null);
          session = null;
          link = null;
          formError = msg.message;
          render(true);
        } else if (state && !state.you) showFormError(msg.message);
        else toast(msg.message);
      }
    },
    onState: (s) => {
      syncClock(s);
      state = s;
      render();
    },
  });
  link.code = code;
}

// ---------- screens ----------
function render(force = false) {
  // Don't redraw the join form under a student who is typing in it.
  if (!force && !state?.you && !state?.kicked && app.querySelector('#join-form')) return;
  let html;
  if (!state || !state.you) {
    if (state?.kicked) {
      writeSession(null);
      html = `<article class="paper center"><h1 class="rubric">You were removed from this battle</h1><p>Your teacher removed this name. Ask your teacher if this was a mistake.</p><p><a class="btn btn-main" href="/join">Join again</a></p></article>`;
    } else html = joinForm(session?.code || new URLSearchParams(location.search).get('code') || '');
  } else if (state.phase === 'lobby') html = lobby();
  else if (state.phase === 'round') html = roundScreen();
  else if (state.phase === 'results') html = resultsScreen();
  else html = finalScreen();
  if (!force && html === lastRender) return;
  lastRender = html;
  const y = window.scrollY;
  const focusId = document.activeElement?.id;
  app.innerHTML = `<div class="screen">${html}</div>`;
  window.scrollTo(0, y);
  bind();
  if (focusId && app.querySelector(`#${focusId}`)) app.querySelector(`#${focusId}`).focus();
}

function bind() {
  app.querySelector('#join-form')?.addEventListener('submit', submitJoin);
  app.querySelectorAll('[data-seat]').forEach((b) => b.addEventListener('click', () => {
    const [emp, seat] = b.dataset.seat.split(':');
    link.send({ t: 'seat', empire: emp, seat });
  }));
  app.querySelector('#unseat')?.addEventListener('click', () => link.send({ t: 'unseat' }));
  app.querySelectorAll('.choice[data-key]').forEach((b) => b.addEventListener('click', () => {
    link.send({ t: 'choose', round: state.round, role: b.dataset.role, key: b.dataset.key });
    b.classList.add('pending');
  }));
  app.querySelector('#leave')?.addEventListener('click', () => {
    if (!confirm('Leave this battle on this device?')) return;
    writeSession(null);
    location.href = '/join';
  });
}

function header(subtitle = '') {
  const y = state.you;
  const e = y.empire && empire(y.empire);
  const roles = (y.roles?.length ? y.roles : y.seat ? [y.seat] : []).map((r) => `${ROLE_ICON[r]} ${esc(titleFor(y.empire, r))}`).join(' · ');
  const t = state.team;
  return `
  <div class="hud battle-hud">
    <div class="hud-realm">${e ? seal(e, 38, t?.collapsed) : ''}<div><b>${esc(e ? e.name : 'No empire yet')}</b><span>${esc(y.name)}${roles ? ` · ${roles}` : ''}</span></div></div>
    <dl class="hud-stats">
      <div><dt>Battle</dt><dd>${esc(state.code)}</dd></div>
      ${state.round ? `<div><dt>Round</dt><dd>${ROMAN[state.round]} of ${ROMAN[state.rounds]}</dd></div>` : ''}
      ${t ? `<div><dt>Team score</dt><dd>${minus(t.points)}</dd></div><div><dt>Stability</dt><dd>${shields(t.stability, t.maxStability)}</dd></div>` : ''}
      ${state.phase === 'round' ? `<div><dt>Time</dt><dd class="timer" data-timer>${clockText(secondsLeft(state))}</dd></div>` : ''}
    </dl>
  </div>
  ${subtitle}`;
}

function lobby() {
  const y = state.you;
  const cards = state.seats.map((row) => {
    const e = empire(row.id);
    const seatBtn = (r) => {
      const who = row.seats[r];
      const mine = who && who.pid === y.pid;
      return `<button class="seat ${mine ? 'mine' : ''} ${who && !mine ? 'taken' : ''}" data-seat="${row.id}:${r}" ${who && !mine ? 'disabled' : ''}>
        <span class="seat-role">${ROLE_ICON[r]} ${esc(titleFor(row.id, r))}</span>
        <span class="seat-who">${who ? esc(who.name) : 'Open seat'}</span></button>`;
    };
    const advisers = row.advisers.map((a) => esc(a.name)).join(', ');
    const meAdviser = row.advisers.some((a) => a.pid === y.pid);
    return `
    <section class="seat-card" style="--realm:${e.color}">
      <header>${seal(e, 34)}<div><b>${esc(e.name)}</b><span class="diff diff-${e.tier}">${esc(e.tierLabel)}</span></div></header>
      ${seatBtn('ruler')}${seatBtn('general')}${seatBtn('vizier')}
      <button class="seat adviser ${meAdviser ? 'mine' : ''}" data-seat="${row.id}:adviser" ${row.advisers.length >= 2 && !meAdviser ? 'disabled' : ''}>
        <span class="seat-role">${ROLE_ICON.adviser} Adviser</span><span class="seat-who">${advisers || 'optional'}</span></button>
    </section>`;
  }).join('');
  const where = y.empire ? `You're the <b>${esc(titleFor(y.empire, y.seat))}</b> of the <b>${esc(empire(y.empire).name)}</b>.` : 'Pick an open seat. Each empire needs a Ruler, a General, and a Vizier.';
  return `
  ${header()}
  <article class="paper lobby">
    <h1 class="rubric-title">Take your seat, ${esc(y.name)}</h1>
    <p class="lead-in">${where} ${y.empire ? '<button class="btn-link" id="unseat">Change seat</button>' : ''}</p>
    <p class="fine">Your teacher will start the battle soon. If you don't pick, you'll be placed where you're needed.</p>
    <div class="seat-grid">${cards}</div>
    <div class="roles-key">${Object.entries(G.info.roles).map(([r, x]) => `<p><b>${ROLE_ICON[r]} ${esc(x.label)}:</b> ${esc(x.blurb)}</p>`).join('')}<p><b>${ROLE_ICON.adviser} ${esc(G.info.adviser.label)}:</b> ${esc(G.info.adviser.blurb)}</p></div>
  </article>`;
}

function exileBanner() {
  if (!state.team?.collapsed) return '';
  return `<div class="exile" role="note"><b>Your empire has fallen.</b> You are in exile now: keep making decisions for half points. Your answers still count for your own score.</div>`;
}

function roundScreen() {
  const y = state.you;
  const e = empire(y.empire);
  const info = G.info.empires[y.empire];
  const r = info.rounds[state.round - 1];
  gloss ||= makeGlossary(G.config, y.empire);
  const cards = (state.decisions || []).map((d) => {
    const rich = gloss.forScreen(`r${state.round}-${d.role}`);
    const who = d.adviser ? `${ROLE_ICON.adviser} Your advice to the ${esc(titleFor(y.empire, d.role))}` : `${ROLE_ICON[d.role]} The ${esc(titleFor(y.empire, d.role))}'s decision`;
    const opp = d.kind === 'clash' ? `<p class="clash-banner">⚔ Clash: ${d.opponent.kind === 'ai' ? `against ${esc(d.opponent.name)}` : `${esc(e.name)} vs. the ${esc(d.opponent.name)}`}. Your choice and theirs decide who wins.</p>` : '';
    const context = d.context.map((c) => `<aside class="marginalia"><span class="manicule" aria-hidden="true">☞</span><span><b>Because of your team's earlier choices:</b> ${rich(c)}</span></aside>`).join('');
    const options = d.options.map((o, i) => `
      <li><button class="choice ${d.chosen === o.key ? 'chosen' : ''}" data-key="${esc(o.key)}" data-role="${d.role}" aria-pressed="${d.chosen === o.key}">
        <span class="choice-num" aria-hidden="true">${ROMAN[i + 1] || i + 1}.</span><span class="otext">${rich(o.text)}</span></button></li>`).join('');
    return `
    <article class="paper event battle-event" style="--realm:${e.color}">
      <p class="role-tag">${who}</p>
      <header class="event-head"><h1>${esc(d.title)}</h1><span class="anno">Anno ${d.year}</span></header>
      ${opp}
      <p class="lead">${rich(d.text)}</p>
      ${context}
      <h2 class="rubric choose-head">${d.adviser ? 'What do you advise?' : 'What will you do?'}</h2>
      <ol class="choices">${options}</ol>
      <p class="fine locked">${d.chosen ? '✓ Locked in. You can change your answer until time runs out.' : 'Talk it over with your team, then choose.'}</p>
    </article>`;
  }).join('');
  return `
  ${header(`<p class="round-title light">Round ${ROMAN[state.round]} · ${esc(r.title)} <span>${esc(r.years)}</span></p>`)}
  ${exileBanner()}
  ${cards || '<article class="paper center"><p>Waiting for your decision…</p></article>'}
  ${team()}`;
}

function team() {
  const t = state.team;
  if (!t) return '';
  const e = empire(t.empire);
  const regionNames = t.regions.map((id) => G.info.empires[t.empire].regions.find((r) => r.id === id)?.name).filter(Boolean);
  return `
  <aside class="paper team-card" style="--realm:${e.color}">
    <h2 class="rubric">Your council</h2>
    <ul class="council">${t.members.map((m) => `<li class="${m.you ? 'you' : ''}">${m.roles.map((r) => ROLE_ICON[r]).join('')} <b>${esc(m.name)}</b> <span class="fine">${m.roles.map((r) => esc(titleFor(t.empire, r))).join(', ')}</span></li>`).join('')}</ul>
    <p class="fine">Lands: ${regionNames.length ? regionNames.map(esc).join(' · ') : 'none'}</p>
  </aside>`;
}

function resultsScreen() {
  const y = state.you;
  const e = empire(y.empire);
  const res = state.results;
  gloss ||= makeGlossary(G.config, y.empire);
  const items = (res?.items || []).map((it, i) => {
    const rich = gloss.forScreen(`res${res.round}-${i}`);
    const v = it.missed ? { cls: 'bad', word: 'No answer' } : verdict(it.points, e);
    const name = (id) => G.info.empires[y.empire].regions.find((r) => r.id === id)?.name || id;
    const changes = [...(it.gained || []).map((g) => `<span class="gain">+ ${esc(name(g))}</span>`), ...(it.lost || []).map((l) => `<span class="loss">− ${esc(name(l))}</span>`)];
    return `
    <article class="paper event outcome" style="--realm:${e.color}">
      <p class="role-tag">${it.adviser ? `${ROLE_ICON.adviser} Your advice to the ${esc(titleFor(y.empire, it.role))}` : `${ROLE_ICON[it.role]} The ${esc(titleFor(y.empire, it.role))}'s decision`}</p>
      <header class="event-head"><h1>${esc(it.title)}</h1></header>
      ${it.clash ? `<p class="clash-result ${it.clash.won ? 'won' : 'lost'}">⚔ ${esc(it.clash.title)}: ${esc(it.clash.text)}</p>` : ''}
      <div class="verdict">
        <div class="stamp ${v.cls}" role="img" aria-label="${v.word}, ${fmtPts(it.points)} ${plural(it.points, 'point')}"><b>${fmtPts(it.points)}</b><span>${v.word}</span></div>
        <div class="decree">
          <p class="rubric">${it.adviser ? 'Your advice' : 'Your decree'}</p>
          <blockquote>${it.choice ? rich(it.choice) : '<i>No decision in time.</i>'}</blockquote>
          ${it.adviser && it.teamChoice ? `<p class="fine">Your team chose: ${esc(it.teamChoice)}</p>` : ''}
          ${changes.length ? `<p class="effects">${changes.join(' ')}</p>` : ''}
          ${it.stabilityDelta ? `<p class="effects">Stability ${fmtPts(it.stabilityDelta)}</p>` : ''}
        </div>
      </div>
      <section class="history"><h2 class="rubric">What actually happened</h2><p>${rich(it.explanation)}</p>
      ${it.best ? `<p class="wiser"><i>The wiser course:</i> ${esc(it.best.text)} (${fmtPts(it.best.points)})</p>` : ''}</section>
    </article>`;
  }).join('');
  const t = res?.team;
  return `
  ${header(`<p class="round-title light">Round ${ROMAN[state.round]} results</p>`)}
  ${t?.collapsed ? '<div class="exile fell" role="alert"><b>Your empire has fallen!</b> Stability ran out. Keep playing in exile for half points.</div>' : exileBanner()}
  ${items}
  <article class="paper center">
    <p>Your team ${t ? `earned <b>${fmtPts(t.points)}</b> this round` : 'is waiting'}. ${state.round < state.rounds ? 'Look at the board for the class results. The next round starts soon.' : 'Final results are coming up on the board.'}</p>
    <p class="fine">Your own score: <b>${minus(y.score)}</b></p>
  </article>`;
}

function finalScreen() {
  const y = state.you;
  const f = state.final;
  if (!f) return `${header()}<article class="paper center"><p>The battle is over.</p></article>`;
  const rank = f.teams.findIndex((t) => t.empire === y.empire) + 1;
  const mine = f.teams.find((t) => t.empire === y.empire);
  const e = empire(y.empire);
  const mvp = Object.entries(f.mvps).filter(([, m]) => m).map(([role, m]) => `<li>${ROLE_ICON[role]} <b>Best ${esc(G.info.roles[role].label)}:</b> ${esc(m.name)} (${esc(shortName(empire(m.empire).name))}, ${fmtPts(m.points)})</li>`).join('');
  return `
  ${header()}
  <article class="paper chronicle ${mine?.collapsed ? 'reign-fallen' : 'reign-endured'}" style="--realm:${e.color}">
    <header class="chron-head">
      <p class="imprint">The battle is over</p>
      <h1>${esc(e.name)}</h1>
      <div class="chron-seal">${seal(e, 84, mine?.collapsed)}</div>
      <p class="fate">${mine ? `${rank === 1 ? 'Victory! ' : ''}${ordinal(rank)} of ${f.teams.length} empires` : ''}</p>
      ${mine ? `<p class="fate-text">${esc(mine.rating)} · team score ${minus(mine.finalScore)}${mine.penalty ? ` (after a ${mine.penalty}-point collapse penalty)` : ''}</p>` : ''}
    </header>
    <section class="reckoning single">
      <div class="final"><span class="rubric">Your score</span><b>${minus(f.you.score)}</b><span class="rating">${ordinal(f.you.rank)} of ${f.players.length} students</span></div>
    </section>
    <h2 class="rubric center">Champions of the battle</h2>
    <ul class="mvps">${mvp}</ul>
    <p class="center"><a class="btn btn-ghost" href="/">Play the solo game to review more</a></p>
  </article>`;
}

const ordinal = (n) => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 >= 11 && n % 100 <= 13) ? 0 : n % 10] || 'th'}`;

// ---------- start up ----------
async function init() {
  mountMapTable();
  try {
    G = await loadInfo();
  } catch {
    app.innerHTML = `<article class="paper"><p class="empty"><b>The game couldn't load.</b> Check your internet connection and refresh.</p></article>`;
    return;
  }
  const urlCode = (new URLSearchParams(location.search).get('code') || '').toUpperCase();
  session = readSession();
  if (session && urlCode && urlCode !== session.code) session = null;
  if (session?.pid) {
    pendingName = session.name;
    startLink(session.code, session.pid);
  } else render(true);
  setInterval(() => {
    const el = app.querySelector('[data-timer]');
    if (el && state) el.textContent = clockText(secondsLeft(state));
  }, 500);
}

init();
