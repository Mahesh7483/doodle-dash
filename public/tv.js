// Doodle Dash TV screen: shows a room on a big screen while everyone plays on their phones.
// It connects as a watcher, so the server sends it exactly what a guesser sees (blanks, never
// the word before the reveal) plus the public chat, reactions and the gallery.

import { Board, replay } from './canvas.js';
import { sfx, isMuted, setMuted } from './sound.js';
import { STICKERS, AWARD_ICONS } from './stickers.js';
import { syncCards } from './ui.js';
import { setAvatars, setAvatar } from './avatar.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const MAX_PLAYERS = 8;
const PACK_NAMES = { everyday: 'Everyday', animals: 'Animals', food: 'Food', places: 'Places', actions: 'Actions', mixed: 'Mixed', custom: 'Custom' };
const MULT_LABEL = { 1: '×1', 1.5: '×1.5', 2: '×2' };
const PODIUM_MS = 14000; // podium + awards, then the gallery slideshow, then again
const SLIDE_HOLD_MS = 3500;

const T = {
  code: null,
  view: null,
  offset: 0,
  phaseKey: '',
  phaseTotal: 1,
  lastSecond: null,
  gallery: null,
  awards: [],
  likes: { counts: [], mine: [] },
  overTimer: null,
  showStop: null,
  slide: -1,
};

const pathMatch = /^\/tv\/([A-Za-z]{4})\/?$/.exec(location.pathname);
const board = new Board($('#tvg-board'));

// ---------------------------------------------------------------------------
// Socket

const socket = io({ transports: ['websocket', 'polling'], reconnectionDelayMax: 3000 });

function emit(event, ...args) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ error: 'The server did not answer. Check your connection.' }), 8000);
    socket.emit(event, ...args, (res) => {
      clearTimeout(timer);
      resolve(res || {});
    });
  });
}

async function watch(code) {
  const res = await emit('room:watch', { code });
  if (res.error) {
    showConnect(res.error, code);
    return false;
  }
  T.code = res.code;
  history.replaceState(null, '', `/tv/${res.code}`);
  document.title = `Doodle Dash — room ${res.code} on TV`;
  return true;
}

socket.on('connect', () => {
  $('#conn-banner').hidden = true;
  syncClock();
  const code = T.code || (pathMatch && pathMatch[1].toUpperCase());
  if (code) watch(code);
  else showConnect();
});
socket.on('disconnect', () => {
  if (T.code) $('#conn-banner').hidden = false;
});

socket.on('state', onState);
socket.on('avatars', ({ list }) => setAvatars(list));
socket.on('avatar', (a) => setAvatar(a));
socket.on('chat', (m) => addFeed(m, true));
socket.on('chatHistory', ({ messages }) => {
  $('#tvg-feed').innerHTML = '';
  for (const m of messages || []) addFeed(m, false);
});
socket.on('draw', (op) => board.apply(op));
socket.on('drawSync', ({ turnId, ops }) => {
  if (T.view && T.view.turn && T.view.turn.id === turnId) board.setOps(ops);
});
socket.on('gallery', ({ drawings, awards, likes }) => {
  const fresh = T.gallery !== drawings && (!T.gallery || T.gallery.length !== drawings.length);
  T.gallery = drawings;
  T.awards = awards || [];
  T.likes = likes || { counts: drawings.map(() => 0), mine: [] };
  if (T.view && T.view.phase === 'gameOver') {
    renderOver();
    if (fresh) startOverCycle();
  }
});
socket.on('likes', (likes) => {
  T.likes = likes;
  if (T.view && T.view.phase === 'gameOver') {
    renderAwards();
    updateSlideLikes();
  }
});
socket.on('reaction', ({ emoji, name, color }) => floatReaction(emoji, name, color));
socket.on('roomClosed', () => {
  T.code = null;
  showConnect('That room has closed. Create a new one on your phone.');
});

async function syncClock() {
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    const now = await new Promise((resolve) => socket.emit('time', resolve));
    const t1 = Date.now();
    if (typeof now === 'number' && t1 - t0 < best) {
      best = t1 - t0;
      T.offset = now - (t0 + (t1 - t0) / 2);
    }
  }
}
const serverNow = () => Date.now() + T.offset;

// ---------------------------------------------------------------------------
// Screens

function showScreen(name) {
  for (const el of $$('.tv-screen')) el.hidden = el.id !== `tv-${name}`;
  document.body.dataset.screen = name;
}

function showConnect(error, code) {
  T.view = null;
  T.phaseKey = '';
  stopOverCycle();
  if (!code) history.replaceState(null, '', '/tv');
  showScreen('connect');
  const err = $('#tv-error');
  err.hidden = !error;
  err.textContent = error || '';
  const input = $('#tv-code');
  if (code) input.value = code;
  input.focus();
}

$('#tv-code').addEventListener('input', (e) => {
  const v = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  if (v !== e.target.value) e.target.value = v;
  $('#tv-error').hidden = true;
});
$('#tv-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const code = $('#tv-code').value.trim().toUpperCase();
  if (!/^[A-Z]{4}$/.test(code)) {
    $('#tv-error').hidden = false;
    $('#tv-error').textContent = 'Room codes are 4 letters, like ABCD.';
    return;
  }
  watch(code);
});

function onState(v) {
  const prev = T.view;
  T.view = v;
  const key = `${v.phase}:${v.turn ? v.turn.id : ''}`;
  if (key !== T.phaseKey) {
    T.phaseKey = key;
    T.phaseTotal = v.phaseMs || Math.max(1, v.endsAt - v.serverNow);
    T.lastSecond = null;
    onPhaseChange(prev, v);
  }
  if (prev && prev.phase === 'lobby' && v.phase === 'lobby' && v.players.length > prev.players.length) sfx.join();
  render();
}

function onPhaseChange(prev, v) {
  const newTurn = v.turn && (!prev || !prev.turn || prev.turn.id !== v.turn.id);
  if (newTurn) board.reset();
  if (!prev) return; // just connected: no fanfare for what already happened
  if (v.phase === 'drawing' && prev.phase === 'choosing') sfx.yourTurn();
  if (v.phase === 'reveal' && prev.phase === 'drawing') sfx.turnEnd();
  if (v.phase === 'gameOver' && prev.phase !== 'gameOver') {
    sfx.fanfare();
    setTimeout(confetti, 150);
  }
  if (v.phase !== 'gameOver') {
    stopOverCycle();
    T.gallery = null;
    $('#tvo-awards').innerHTML = ''; // next game's cards pop in fresh
  }
}

function render() {
  const v = T.view;
  if (!v) return;
  if (v.phase === 'lobby') {
    showScreen('lobby');
    renderLobby();
  } else if (v.phase === 'gameOver') {
    showScreen('over');
    renderOver();
    if (!T.overTimer && !T.showStop) startOverCycle();
  } else {
    showScreen('game');
    renderGame();
  }
}

const player = (id) => (T.view ? T.view.players.find((p) => p.id === id) || null : null);

// ---------------------------------------------------------------------------
// Lobby

function renderLobby() {
  const v = T.view;
  const codeEl = $('#tvl-code');
  if (codeEl.dataset.code !== v.code) {
    codeEl.dataset.code = v.code;
    codeEl.innerHTML = [...v.code].map((c) => `<span>${c}</span>`).join('');
    $('#tvl-qr').src = `/qr/${v.code}.svg`;
    $('#tvg-qr').src = `/qr/${v.code}.svg`;
    // Long hostnames may wrap, but only after a dot.
    const host = esc(location.host).replace(/\./g, '.<wbr>');
    $('#tvl-host').innerHTML = host;
    $('#tvg-host').innerHTML = host;
    $('#tvg-code').textContent = v.code;
  }
  $('#tvl-count').textContent = `${v.players.length}/${MAX_PLAYERS}`;
  const list = $('#tvl-list');
  const sig = JSON.stringify(v.players.map((p) => [p.id, p.name, p.connected, p.id === v.hostId]));
  if (list.dataset.sig !== sig) {
    list.dataset.sig = sig;
    const items = v.players.map((p) => {
      const tags = [];
      if (p.id === v.hostId) tags.push('<span class="tag tag-host"><svg class="icon icon-xs"><use href="#i-crown"/></svg>host</span>');
      if (p.bot) tags.push('<span class="tag tag-bot">bot</span>');
      return `<li class="tvl-p${p.connected ? '' : ' away'}">${avatar(p)}<span class="tvl-name">${esc(p.name)}</span>${tags.join('')}</li>`;
    });
    const empty = Math.min(MAX_PLAYERS, Math.max(4, v.players.length + 1)) - v.players.length;
    for (let i = 0; i < empty; i++) items.push('<li class="tvl-p tvl-empty"><span class="avatar avatar-empty"></span><span class="tvl-name">Open seat</span></li>');
    list.innerHTML = items.join('');
  }
  const s = v.settings;
  $('#tvl-settings').innerHTML = [`${s.rounds} rounds`, `${s.drawTime} s to draw`, `${PACK_NAMES[s.pack] || 'Mixed'} words`].map((t) => `<span class="tv-pill">${esc(t)}</span>`).join('');
  const host = player(v.hostId);
  const ready = v.players.filter((p) => p.connected).length;
  let wait;
  if (!v.players.length) wait = 'Waiting for players to join';
  else if (ready < 2) wait = 'Waiting for more players';
  else wait = `Waiting for ${esc(host ? host.name : 'the host')} to start`;
  $('#tvl-wait').innerHTML = `${wait}<span class="dots"><i>.</i><i>.</i><i>.</i></span>`;
}

// ---------------------------------------------------------------------------
// Game

function renderGame() {
  const v = T.view;
  const t = v.turn;
  const drawer = t ? player(t.drawerId) : null;
  $('#tvg-round').textContent = `Round ${v.round} of ${v.rounds}`;
  const label = $('#tvg-label');
  const disp = $('#tvg-word');
  if (v.phase === 'choosing') {
    label.textContent = 'Get ready';
    disp.innerHTML = `<span class="word-note">${esc(drawer ? drawer.name : 'Someone')} is choosing…</span>`;
  } else if (v.phase === 'drawing' && t && t.mask) {
    const lens = maskLengths(t.mask);
    label.innerHTML = `Guess the word · ${lens.join(' + ')} letters${t.mult ? ` · <span class="diff diff-${t.difficulty}">${MULT_LABEL[t.mult]}</span>` : ''}`;
    disp.innerHTML = maskHtml(t.mask);
  } else if (v.phase === 'reveal') {
    label.textContent = t && t.word ? 'The word was' : `Round ${v.round} of ${v.rounds}`;
    disp.innerHTML = t && t.word ? wordHtml(t.word) : '<span class="word-note">Turn skipped</span>';
  }
  fitWord();

  const chip = $('#tvg-drawer');
  chip.hidden = !(v.phase === 'drawing' && drawer);
  if (drawer) chip.innerHTML = `${avatar(drawer)}<span>${esc(drawer.name)} is drawing</span>`;

  renderPlayers();
  renderOverlay();
}

function renderPlayers() {
  const v = T.view;
  const t = v.turn;
  const pts = v.phase === 'reveal' && t && t.points ? t.points : null;
  const sorted = [...v.players].sort((a, b) => b.score - a.score);
  const ranks = new Map();
  sorted.forEach((p, i) => ranks.set(p.id, i > 0 && sorted[i - 1].score === p.score ? ranks.get(sorted[i - 1].id) : i + 1));
  $('#tvg-players').innerHTML = sorted
    .map((p) => {
      const drawing = t && t.drawerId === p.id && v.phase !== 'reveal';
      const cls = ['tvg-pl', p.connected ? '' : 'away', p.guessed ? 'guessed' : '', drawing ? 'drawing' : ''].join(' ');
      let status = '';
      if (drawing) status = '<span class="tvg-status" title="Drawing"><svg class="icon"><use href="#i-brush"/></svg></span>';
      else if (p.guessed) status = '<span class="tvg-status ok" title="Guessed it"><svg class="icon"><use href="#i-check"/></svg></span>';
      const gain = pts && pts[p.id] ? ` <span class="tvg-gain">+${pts[p.id]}</span>` : '';
      return `<li class="${cls}" data-pid="${esc(p.id)}"><span class="tvg-rank">#${ranks.get(p.id)}</span>${avatar(p)}
        <span class="tvg-pl-main"><span class="tvg-pl-name">${esc(p.name)}</span><span class="tvg-pl-score">${p.score} pts${gain}</span></span>${status}</li>`;
    })
    .join('');
}

function renderOverlay() {
  const v = T.view;
  const t = v.turn;
  const ov = $('#tvg-overlay');
  const drawer = t ? player(t.drawerId) : null;
  let html = '';
  if (v.phase === 'choosing') {
    html = `<div class="tvo-card">
      <div class="tvo-kicker">Round ${v.round} of ${v.rounds}</div>
      ${drawer ? avatar(drawer) : ''}
      <h2>${esc(drawer ? drawer.name : 'Someone')} is picking a word<span class="dots"><i>.</i><i>.</i><i>.</i></span></h2>
      <div class="tvo-foot-line">Phones out, get ready to guess!</div>
    </div>`;
  } else if (v.phase === 'reveal' && t) {
    // Compact, at the bottom, so everyone can still see the drawing (points are on the scoreboard).
    const pts = t.points || {};
    const guessed = v.players.filter((p) => pts[p.id] && p.id !== t.drawerId).length;
    const title = t.reason === 'drawerLeft' && !t.word
      ? `<h2>${esc(drawer ? drawer.name : 'The drawer')} left, turn skipped</h2>`
      : `<div class="tvo-kicker">The word was</div><h2 class="tvo-reveal-word">${esc(t.word || '')}</h2>`;
    let badge = '';
    if (t.reason === 'allGuessed') badge = '<div class="tvo-badge">Everyone got it!</div>';
    else if (t.word) badge = `<div class="tvo-badge${guessed ? '' : ' none'}">${guessed ? `${guessed} guessed it` : 'Nobody got it!'}</div>`;
    html = `<div class="tvo-card tvo-reveal">
      <div class="tvo-reveal-main">${title}</div>
      <div class="tvo-reveal-side">${badge}
        <div class="tvo-foot-line">${t.nextDrawerName ? `Up next: <b>${esc(t.nextDrawerName)}</b>` : 'Final scores coming up…'}</div></div>
    </div>`;
  }
  if (ov.dataset.html !== html) {
    ov.dataset.html = html;
    ov.innerHTML = html;
    ov.hidden = !html;
    ov.classList.toggle('is-reveal', v.phase === 'reveal');
  }
}

function wordHtml(word) {
  return `<span class="word">${[...word].map((ch) => (ch === ' ' ? '<span class="gap"></span>' : `<span class="ch">${esc(ch)}</span>`)).join('')}</span>`;
}

function maskHtml(mask) {
  return `<span class="word mask">${mask
    .map((ch) => {
      if (ch === null) return '<span class="ch blank"></span>';
      if (ch === ' ') return '<span class="gap"></span>';
      if (/\p{L}/u.test(ch)) return `<span class="ch hint">${esc(ch)}</span>`;
      return `<span class="ch sym">${esc(ch)}</span>`;
    })
    .join('')}</span>`;
}

function maskLengths(mask) {
  const lens = [];
  let n = 0;
  for (const ch of mask) {
    if (ch === ' ') {
      if (n) lens.push(n);
      n = 0;
    } else if (ch === null || /\p{L}/u.test(ch)) n++;
  }
  if (n) lens.push(n);
  return lens;
}

function fitWord() {
  const disp = $('#tvg-word');
  const word = disp.querySelector('.word');
  disp.style.setProperty('--wscale', '1');
  if (!word) return;
  const avail = disp.clientWidth;
  const need = word.scrollWidth;
  if (need > avail && avail > 0) disp.style.setProperty('--wscale', String(Math.max(0.4, avail / need)));
}
window.addEventListener('resize', fitWord);

// Timer ring + last-10-seconds ticks.
setInterval(() => {
  const v = T.view;
  if (!v || document.body.dataset.screen !== 'game') return;
  const left = Math.max(0, v.endsAt - serverNow());
  const secs = Math.ceil(left / 1000);
  $('#tvg-num').textContent = v.endsAt ? String(secs) : '–';
  const C = 2 * Math.PI * 19;
  const ring = $('#tvg-ring');
  ring.style.strokeDasharray = `${C}`;
  ring.style.strokeDashoffset = `${C * (1 - Math.max(0, Math.min(1, left / T.phaseTotal)))}`;
  const urgent = v.phase === 'drawing' && secs <= 10;
  $('#tvg-timer').classList.toggle('urgent', urgent);
  if (urgent && secs > 0 && secs !== T.lastSecond) sfx.tick();
  T.lastSecond = secs;
}, 200);

// Feed: guesses, "Ana guessed it!" and game events.
function addFeed(m, live) {
  const feed = $('#tvg-feed');
  const li = document.createElement('li');
  li.className = `tvf tvf-${m.kind}${m.sub ? ` tvf-${m.sub}` : ''}`;
  if (m.kind === 'chat') {
    li.innerHTML = `<span class="tvf-dot" style="--pc:${esc(m.color || '#999')}"></span><b>${esc(m.name)}</b> ${esc(m.text)}`;
  } else if (m.kind === 'correct') {
    li.innerHTML = `<svg class="icon"><use href="#i-check"/></svg>${esc(m.text)}`;
    if (live) {
      sfx.pop();
      pulsePlayer(m.from);
    }
  } else {
    li.textContent = m.text;
  }
  feed.appendChild(li);
  while (feed.childElementCount > 40) feed.firstElementChild.remove();
}

function pulsePlayer(pid) {
  const li = pid && document.querySelector(`#tvg-players [data-pid="${CSS.escape(pid)}"]`);
  if (!li) return;
  li.classList.remove('pulse');
  void li.offsetWidth;
  li.classList.add('pulse');
}

// ---------------------------------------------------------------------------
// Game over: podium and awards, then every drawing replays on a loop.

function renderOver() {
  const v = T.view;
  const sorted = [...v.players].sort((a, b) => b.score - a.score);
  const top = sorted.slice(0, 3);
  const tie = sorted.length > 1 && sorted[0].score === sorted[1].score;
  $('#tvo-title').textContent = tie ? "It's a tie!" : `${sorted[0] ? sorted[0].name : 'Nobody'} wins!`;
  const order = [top[1], top[0], top[2]];
  const place = ['second', 'first', 'third'];
  const label = ['2nd', '1st', '3rd'];
  const podium = $('#tvo-podium');
  const sig = JSON.stringify(top.map((p) => [p.id, p.score]));
  if (podium.dataset.sig !== sig) {
    podium.dataset.sig = sig;
    podium.style.setProperty('--places', String(top.length));
    podium.innerHTML = order
      .map((p, i) =>
        p
          ? `<div class="tvo-pod tvo-${place[i]}">
              <div class="tvo-who">${i === 1 ? '<svg class="icon tvo-crown"><use href="#i-crown"/></svg>' : ''}${avatar(p)}
                <div class="tvo-name">${esc(p.name)}</div><div class="tvo-score">${p.score} pts</div></div>
              <div class="tvo-block"><span>${label[i]}</span></div>
            </div>`
          : ''
      )
      .join('');
  }
  renderAwards();
  const host = player(v.hostId);
  $('#tvo-foot').textContent = host ? `${host.name}: tap “Play again” on your phone for another round!` : 'Thanks for playing!';
}

function favouriteIndex(counts) {
  let best = -1;
  counts.forEach((n, i) => {
    if (n > 0 && (best === -1 || n > counts[best])) best = i;
  });
  return best;
}

function renderAwards() {
  const v = T.view;
  const awards = (v && v.awards) || T.awards || [];
  const drawings = T.gallery || [];
  const counts = T.likes.counts || [];
  const fav = favouriteIndex(counts);
  const cards = awards.map(
    (a, k) => `<div class="award" data-key="${a.id}" style="--delay:${0.9 + k * 0.12}s">
      <span class="award-icon">${AWARD_ICONS[a.id] || ''}</span>
      <div class="award-body"><div class="award-title">${esc(a.title)}</div>
        <div class="award-who">${avatar({ id: a.playerId, name: a.name, color: a.color, bot: a.bot })} ${esc(a.name)}</div>
        <div class="award-detail">${esc(a.detail)}</div></div>
    </div>`
  );
  if (drawings.length && fav >= 0) {
    const d = drawings[fav];
    cards.push(`<div class="award award-crowd" data-key="crowd" style="--delay:${0.9 + awards.length * 0.12}s">
      <span class="award-icon">${AWARD_ICONS.crowd}</span>
      <div class="award-body"><div class="award-title">Crowd favourite</div>
        <div class="award-who">${avatar({ id: d.drawerId, name: d.drawerName, color: d.drawerColor, bot: d.drawerBot })} ${esc(d.drawerName)}</div>
        <div class="award-detail">“${esc(d.word)}” · ${counts[fav]} like${counts[fav] === 1 ? '' : 's'}</div></div>
    </div>`);
  }
  // In place, so likes coming in don't replay every card's pop-in.
  syncCards($('#tvo-awards'), cards.map((html) => ({ key: /data-key="([^"]+)"/.exec(html)[1], html })));
}

function stopOverCycle() {
  clearTimeout(T.overTimer);
  T.overTimer = null;
  if (T.showStop) T.showStop();
  T.showStop = null;
  T.slide = -1;
  $('#tvo-show').hidden = true;
  $('#tvo-podium-view').hidden = false;
}

// Podium for a while, then each drawing in turn, then back to the podium.
function startOverCycle() {
  stopOverCycle();
  T.overTimer = setTimeout(() => showSlide(0), PODIUM_MS);
}

function showSlide(i) {
  const drawings = T.gallery || [];
  if (!T.view || T.view.phase !== 'gameOver') return;
  if (!drawings.length || i >= drawings.length) {
    startOverCycle();
    return;
  }
  T.slide = i;
  const d = drawings[i];
  $('#tvo-podium-view').hidden = true;
  $('#tvo-show').hidden = false;
  $('#tvo-count').textContent = `${i + 1} of ${drawings.length}`;
  $('#tvo-word').textContent = d.word;
  const frame = $('.tvo-frame');
  frame.style.animation = 'none';
  void frame.offsetWidth;
  frame.style.animation = '';
  updateSlideLikes();
  if (T.showStop) T.showStop();
  const pts = d.ops.reduce((n, o) => n + (o.t === 's' ? o.p.length / 2 : 30), 0);
  T.showStop = replay($('#tvo-canvas'), d.ops, {
    duration: Math.max(2500, Math.min(8000, pts * 7)),
    onDone: () => {
      T.overTimer = setTimeout(() => showSlide(i + 1), SLIDE_HOLD_MS);
    },
  });
}

function updateSlideLikes() {
  const drawings = T.gallery || [];
  const d = drawings[T.slide];
  if (!d) return;
  const counts = T.likes.counts || [];
  const n = counts[T.slide] || 0;
  const fav = favouriteIndex(counts) === T.slide;
  $('#tvo-by').innerHTML = `${avatar({ id: d.drawerId, name: d.drawerName, color: d.drawerColor, bot: d.drawerBot })} drawn by ${esc(d.drawerName)}${
    n ? ` · <span class="tvo-likes">${STICKERS.love.svg}${n}</span>` : ''
  }`;
  const ribbon = $('#tvo-fav');
  ribbon.hidden = !fav;
  ribbon.innerHTML = `${AWARD_ICONS.crowd}<span>Crowd favourite</span>`;
  $('.tvo-frame').classList.toggle('is-fav', fav);
}

// ---------------------------------------------------------------------------
// Reactions float up over the drawing (or the middle of the screen).

function floatReaction(id, name, color) {
  const sticker = STICKERS[id];
  const layer = $('#float-layer');
  if (!sticker || layer.childElementCount > 40) return;
  const wrap = document.body.dataset.screen === 'game' ? $('#tvg-canvas-wrap') : null;
  const r = wrap ? wrap.getBoundingClientRect() : { left: innerWidth * 0.2, width: innerWidth * 0.6, bottom: innerHeight - 60 };
  const el = document.createElement('span');
  el.className = 'floater';
  el.style.left = `${r.left + r.width * (0.1 + Math.random() * 0.8)}px`;
  el.style.top = `${r.bottom - 70}px`;
  el.style.setProperty('--dx', `${Math.round((Math.random() - 0.5) * 120)}px`);
  el.style.setProperty('--rot', `${Math.round((Math.random() - 0.5) * 30)}deg`);
  el.innerHTML = `<span class="fe">${sticker.svg}</span>${name ? `<span class="fn" style="--pc:${esc(color)}">${esc(name)}</span>` : ''}`;
  el.addEventListener('animationend', () => el.remove());
  layer.appendChild(el);
}

function confetti() {
  const c = $('#confetti');
  if (!c || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const ctx = c.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = innerWidth * dpr;
  c.height = innerHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const colors = ['#ff5c39', '#ffd23f', '#2bb673', '#2f6fe4', '#8e5cf7', '#ff7eb6'];
  const k = Math.max(1, innerWidth / 900);
  const parts = Array.from({ length: 220 }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * innerWidth * 0.5,
    y: innerHeight * 0.3,
    vx: (Math.random() - 0.5) * 16 * k,
    vy: (-Math.random() * 14 - 4) * k,
    r: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.4,
    w: (6 + Math.random() * 8) * k,
    h: (4 + Math.random() * 6) * k,
    c: colors[Math.floor(Math.random() * colors.length)],
  }));
  const t0 = performance.now();
  (function frame(now) {
    const t = now - t0;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += 0.35 * k;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.globalAlpha = Math.max(0, 1 - t / 4000);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (t < 4000) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, innerWidth, innerHeight);
  })(t0);
}

// ---------------------------------------------------------------------------
// Sound: browsers only allow it after a click or key press on the page.

let audioUnlocked = false;
function updateSound() {
  const m = isMuted();
  const b = $('#tv-sound');
  b.querySelector('use').setAttribute('href', m ? '#i-mute' : '#i-sound');
  b.setAttribute('aria-label', m ? 'Unmute sounds' : 'Mute sounds');
  b.classList.toggle('is-muted', m);
  $('#tv-sound-hint').hidden = m || audioUnlocked;
}
const unlock = () => {
  audioUnlocked = true;
  updateSound();
};
window.addEventListener('pointerdown', unlock, { once: true });
window.addEventListener('keydown', unlock, { once: true });
$('#tv-sound').addEventListener('click', () => {
  setMuted(!isMuted());
  updateSound();
  if (!isMuted()) sfx.click();
});
updateSound();

// ---------------------------------------------------------------------------
// Helpers

// A drawn avatar shows through the av-<id> class as soon as it's known (see avatar.js).
function avatar(p, cls = '') {
  const initial = p.bot ? '🤖' : esc([...(p.name || '?').trim()][0] || '?').toUpperCase();
  const art = !p.bot && p.id && /^[A-Za-z0-9_-]+$/.test(p.id) ? ` av-${p.id}` : '';
  return `<span class="avatar ${cls}${p.bot ? ' avatar-bot' : ''}${art}" style="--pc:${esc(p.color || '#999')}" aria-hidden="true">${initial}</span>`;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !socket.connected) socket.connect();
});

// Test hook.
window.__tv = { T, board };

if (!pathMatch) showConnect();
