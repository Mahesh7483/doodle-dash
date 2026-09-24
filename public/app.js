import { Board, DrawInput, PALETTE, COLOR_NAMES, replay, exportPng, exportPoster } from './canvas.js';
import { sfx, isMuted, setMuted } from './sound.js';
import { STICKERS, STICKER_IDS, REACT_ICON, AWARD_ICONS } from './stickers.js';
import { syncCards } from './ui.js';
import { AvatarPad, setAvatars, setAvatar } from './avatar.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const PACKS = [
  ['everyday', 'Everyday'],
  ['animals', 'Animals'],
  ['food', 'Food'],
  ['places', 'Places'],
  ['actions', 'Actions'],
  ['mixed', 'Mixed'],
  ['custom', 'Custom'],
];
const DIFF_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
const MULT_LABEL = { 1: '×1', 1.5: '×1.5', 2: '×2' };
const MAX_PLAYERS = 8;

// ---------------------------------------------------------------------------
// Storage & identity

const ls = safeStorage(() => window.localStorage);
const ss = safeStorage(() => window.sessionStorage);

function safeStorage(get) {
  let s = null;
  try {
    s = get();
    s.setItem('dd.probe', '1');
    s.removeItem('dd.probe');
  } catch (_) {
    s = null;
  }
  return {
    get: (k) => (s ? s.getItem(k) : null),
    set: (k, v) => {
      if (!s) return;
      try {
        if (v == null) s.removeItem(k);
        else s.setItem(k, v);
      } catch (_) { /* full or blocked */ }
    },
  };
}

const TOKEN_RE = /^[A-Za-z0-9_-]{8,64}$/;
function newToken() {
  const a = new Uint8Array(18);
  crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// The token lives in localStorage so closing and reopening the link gets your seat back.
// A second tab of the same browser must not steal that seat, so each live tab holds a
// Web Lock on its token; a tab that can't get the lock uses its own per-tab token.
function lockToken(t, waitMs) {
  if (!navigator.locks || !navigator.locks.request) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    const ctrl = new AbortController();
    // Give up after waitMs even if this browser ignores the abort signal.
    const timer = setTimeout(() => {
      ctrl.abort();
      done(false);
    }, waitMs);
    try {
      navigator.locks
        .request(`dd-token-${t}`, { signal: ctrl.signal }, () => {
          if (settled) return undefined; // too late: release straight away
          clearTimeout(timer);
          done(true);
          return new Promise(() => {}); // hold until the page goes away
        })
        .catch(() => done(false));
    } catch (_) {
      clearTimeout(timer);
      done(true);
    }
  });
}

async function claimToken() {
  const fromTab = ss.get('dd.token');
  const durable = ls.get('dd.token');
  if (fromTab && TOKEN_RE.test(fromTab)) {
    // This tab's own identity from before a reload. Use it straight away: while reloading,
    // some browsers still hold the old page's lock for a moment. Take the lock in the
    // background so other tabs won't adopt this token.
    lockToken(fromTab, 10000);
    if (!durable || !TOKEN_RE.test(durable)) ls.set('dd.token', fromTab);
    return fromTab;
  }
  let t = durable && TOKEN_RE.test(durable) ? durable : newToken();
  if (!(await lockToken(t, 600))) {
    t = newToken();
    await lockToken(t, 50);
  }
  ss.set('dd.token', t);
  if (!durable || !TOKEN_RE.test(durable)) ls.set('dd.token', t);
  return t;
}

// ---------------------------------------------------------------------------
// App state

const S = {
  token: null,
  view: null,
  code: null,
  offset: 0,
  gallery: null,
  lastGallery: null,
  galleryCode: null,
  gameOverScreen: 'podium',
  viewingLastGallery: false,
  awards: [],
  likes: { counts: [], mine: [] },
  lastLikes: null,
  phaseKey: '',
  phaseTotal: 1,
  lastSecond: null,
  invite: null,
  busy: false,
  inkWarned: false,
};

const inviteMatch = /^\/r\/([A-Za-z]{4})\/?$/.exec(location.pathname);
S.invite = inviteMatch ? inviteMatch[1].toUpperCase() : null;

// ---------------------------------------------------------------------------
// Socket

const socket = io({ transports: ['websocket', 'polling'], reconnectionDelayMax: 3000 });
const tokenReady = claimToken().then((t) => (S.token = t));

function emit(event, ...args) {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) resolve({ error: 'The server did not answer. Check your connection.' });
    }, 8000);
    socket.emit(event, ...args, (res) => {
      done = true;
      clearTimeout(timer);
      resolve(res || {});
    });
  });
}

socket.on('connect', async () => {
  hideConn();
  syncClock();
  await tokenReady;
  // Reconnect to the room we were in; an invite link for a different room wins over a
  // remembered one (if we still hold a seat in the invited room, this rejoins it).
  const wasIn = S.code;
  let code = wasIn || ss.get('dd.room') || lastRoomFor(S.token);
  if (!wasIn && S.invite && code !== S.invite) code = S.invite;
  if (code) {
    const res = await emit('room:resume', { token: S.token, code });
    if (res.ok) {
      enterRoom(res.code);
      return;
    }
    if (wasIn) toast(res.error || 'Could not rejoin the room.');
    forgetRoom();
    // Seat expired: offer to join that room again. Room closed (e.g. server restart): start fresh.
    const closed = /closed/.test(res.error || '');
    showHome(S.invite || (closed ? null : code));
    return;
  }
  if (!S.view) showHome(S.invite);
});

socket.on('disconnect', () => {
  if (S.code) showConnSoon();
});
socket.io.on('reconnect_attempt', () => {
  if (S.code) showConnSoon();
});

socket.on('state', onState);
socket.on('avatars', ({ list }) => setAvatars(list));
socket.on('avatar', (a) => setAvatar(a));
socket.on('chat', (m) => renderChat(m, true));
socket.on('chatHistory', ({ messages }) => {
  chatLog.innerHTML = '';
  for (const m of messages || []) renderChat(m, false);
  chatLog.scrollTop = chatLog.scrollHeight;
  chatPinned = true;
});
socket.on('draw', (op) => board.apply(op));
socket.on('drawSync', ({ turnId, ops }) => {
  if (S.view && S.view.turn && S.view.turn.id === turnId) board.setOps(ops);
});
socket.on('gallery', ({ drawings, awards, likes }) => {
  S.gallery = drawings;
  S.galleryCode = S.code;
  S.awards = awards || [];
  S.likes = likes || { counts: drawings.map(() => 0), mine: [] };
  if (!$('#screen-gallery').hidden) renderGallery();
  renderPodium();
});
socket.on('likes', (likes) => {
  S.likes = likes;
  updateLikes();
  renderAwards();
});
socket.on('drawLimit', ({ message }) => toast(message));
socket.on('reaction', ({ from, emoji, name, color }) => {
  if (S.view && from === S.view.me) return; // already shown when tapped
  floatReaction(emoji, name, color);
});
socket.on('kicked', () => {
  S.code = null;
  S.view = null;
  S.lastGallery = null;
  forgetRoom();
  showHome(null);
  toast('The host removed you from the room.');
});
socket.on('replaced', () => {
  S.code = null;
  S.view = null;
  forgetRoom();
  showHome(null);
  toast('This room was opened in another tab.');
  // The server closed this connection; open a fresh one for whatever the player does next.
  setTimeout(() => socket.connect(), 500);
});

async function syncClock() {
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    const serverNow = await new Promise((resolve) => socket.emit('time', resolve));
    const t1 = Date.now();
    if (typeof serverNow === 'number' && t1 - t0 < best) {
      best = t1 - t0;
      S.offset = serverNow - (t0 + (t1 - t0) / 2);
    }
  }
}
const serverNow = () => Date.now() + S.offset;

function rememberRoom(code) {
  ss.set('dd.room', code);
  if (S.token === ls.get('dd.token')) ls.set('dd.last', JSON.stringify({ code, t: Date.now() }));
}
function forgetRoom() {
  ss.set('dd.room', null);
  if (S.token === ls.get('dd.token')) ls.set('dd.last', null);
}
function lastRoomFor(token) {
  if (token !== ls.get('dd.token')) return null;
  try {
    const last = JSON.parse(ls.get('dd.last') || 'null');
    if (last && Date.now() - last.t < 2 * 60 * 60 * 1000) return last.code;
  } catch (_) { /* ignore */ }
  return null;
}

// ---------------------------------------------------------------------------
// Screens

function showScreen(name) {
  for (const el of $$('.screen')) el.hidden = el.id !== `screen-${name}`;
  document.body.dataset.screen = name;
  closeMenu();
}

function currentScreen() {
  return document.body.dataset.screen;
}

// ---- Home

function showHome(inviteCode) {
  document.body.classList.remove('rejoining');
  S.view = null;
  S.code = null;
  board.reset();
  drawInput.setEnabled(false);
  history.replaceState(null, '', inviteCode ? `/r/${inviteCode}` : '/');
  S.invite = inviteCode || null;
  const invite = !!inviteCode;
  $('#invite-banner').hidden = !invite;
  $('#home-invite').hidden = !invite;
  $('#home-create').hidden = invite;
  $('#screen-home').classList.toggle('is-invite', invite);
  if (invite) {
    $('#invite-code').textContent = inviteCode;
    $('#invite-join-btn').textContent = `Join room ${inviteCode}`;
  }
  $('#name-input').value = ls.get('dd.name') || $('#name-input').value || '';
  setHomeError(null);
  showScreen('home');
  if (!$('#name-input').value && !matchMedia('(pointer: coarse)').matches) $('#name-input').focus();
}

function setHomeError(msg) {
  const el = $('#home-error');
  el.hidden = !msg;
  el.textContent = msg || '';
}

function readName() {
  const name = $('#name-input').value.replace(/\s+/g, ' ').trim();
  if (!name) {
    setHomeError('Pick a name first — anything up to 16 letters.');
    $('#name-input').focus();
    return null;
  }
  ls.set('dd.name', name);
  return name;
}

async function createRoom() {
  if (S.busy) return;
  const name = readName();
  if (!name) return;
  S.busy = true;
  await tokenReady;
  const res = await emit('room:create', { name, token: S.token });
  S.busy = false;
  if (res.error) return setHomeError(res.error);
  enterRoom(res.code);
}

async function joinRoom(code) {
  if (S.busy) return;
  const name = readName();
  if (!name) return;
  code = (code || '').trim().toUpperCase();
  if (!/^[A-Z]{4}$/.test(code)) {
    setHomeError('Room codes are 4 letters, like ABCD.');
    $('#code-input').focus();
    return;
  }
  S.busy = true;
  await tokenReady;
  const res = await emit('room:join', { name, token: S.token, code });
  S.busy = false;
  if (res.error) return setHomeError(res.error);
  enterRoom(res.code);
}

function enterRoom(code) {
  if (S.code !== code) {
    S.gallery = null;
    S.gameOverScreen = 'podium';
    $('#chat-log').innerHTML = '';
  }
  S.code = code;
  S.invite = null;
  rememberRoom(code);
  history.replaceState(null, '', `/r/${code}`);
}

async function leaveRoom() {
  if (S.view && S.view.phase !== 'lobby' && S.view.phase !== 'gameOver') {
    if (!confirm('Leave the game? Your score will be lost.')) return;
  }
  await emit('room:leave');
  forgetRoom();
  S.lastGallery = null;
  showHome(null);
}

$('#create-btn').addEventListener('click', createRoom);
$('#join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  joinRoom($('#code-input').value);
});
$('#invite-join-btn').addEventListener('click', () => joinRoom(S.invite));
$('#invite-other-btn').addEventListener('click', () => showHome(null));
$('#name-input').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  if (S.invite) joinRoom(S.invite);
  else if ($('#code-input').value.trim().length === 4) joinRoom($('#code-input').value);
  else createRoom();
});
$('#code-input').addEventListener('input', (e) => {
  const v = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  if (v !== e.target.value) e.target.value = v;
});
$('#name-input').addEventListener('input', () => setHomeError(null));

// ---------------------------------------------------------------------------
// State updates

function onState(v) {
  document.body.classList.remove('rejoining');
  const prev = S.view;
  S.view = v;
  S.code = v.code;
  const me = player(v.me);
  const turn = v.turn;
  const key = `${v.phase}:${turn ? turn.id : ''}`;
  if (key !== S.phaseKey) {
    S.phaseKey = key;
    S.phaseTotal = v.phaseMs || Math.max(1, v.endsAt - v.serverNow);
    S.lastSecond = null;
    onPhaseChange(prev, v);
  }
  if (prev && prev.phase === 'lobby' && v.phase === 'lobby' && v.players.length > prev.players.length) sfx.join();
  if (prev && me && prev.hostId !== v.hostId && v.hostId === v.me) toast('You are now the host.');
  autoAvatar(v, me);
  hideConn();
  render();
}

function onPhaseChange(prev, v) {
  const turn = v.turn;
  const live = !!prev; // false right after a refresh/rejoin: no fanfare for things that already happened
  const newTurn = turn && (!prev || !prev.turn || prev.turn.id !== turn.id);
  if (newTurn) {
    board.reset();
    S.inkWarned = false;
  }
  if (live && v.phase === 'choosing' && turn && turn.drawerId === v.me && newTurn) {
    sfx.yourTurn();
    vibrate(60);
  }
  if (v.phase === 'drawing' && turn && turn.drawerId === v.me) {
    drawInput.tool = drawInput.tool || 'brush';
  }
  if (v.phase === 'reveal' && prev && prev.phase === 'drawing') sfx.turnEnd();
  if (v.phase === 'gameOver') {
    S.gameOverScreen = 'podium';
    if (prev && prev.phase !== 'gameOver') {
      sfx.fanfare();
      setTimeout(confetti, 150);
    }
  }
  if (v.phase === 'lobby' && prev && prev.phase === 'gameOver' && S.gallery && S.gallery.length) {
    S.lastGallery = S.gallery;
    S.lastLikes = S.likes;
  }
  if (v.phase === 'lobby') {
    S.gallery = null;
    S.viewingLastGallery = false;
  }
}

function render() {
  const v = S.view;
  if (!v) return;
  if (v.phase === 'lobby') {
    if (!S.viewingLastGallery) showScreen('lobby');
    renderLobby();
  } else if (v.phase === 'gameOver') {
    showScreen(S.gameOverScreen);
    renderPodium();
    if (S.gameOverScreen === 'gallery') renderGallery();
  } else {
    showScreen('game');
    renderGame();
  }
  updateMuteButtons();
}

function player(id) {
  return S.view ? S.view.players.find((p) => p.id === id) || null : null;
}
const isHost = () => S.view && S.view.hostId === S.view.me;

// ---------------------------------------------------------------------------
// Lobby

const shareUrl = () => `${location.origin}/r/${S.code}`;

function renderLobby() {
  const v = S.view;
  const host = isHost();
  const codeEl = $('#lobby-code');
  if (codeEl.dataset.code !== v.code) {
    codeEl.dataset.code = v.code;
    codeEl.innerHTML = [...v.code].map((c) => `<span>${c}</span>`).join('');
    $('#lobby-qr').src = `/qr/${v.code}.svg`;
    $('#qr-big').src = `/qr/${v.code}.svg`;
    $('#qr-dialog-code').textContent = v.code;
    $('#qr-link').textContent = shareUrl().replace(/^https?:\/\//, '');
  }

  const connected = v.players.filter((p) => p.connected).length;
  $('#lobby-count').textContent = `${v.players.length}/${MAX_PLAYERS}`;
  const hostPlayer = player(v.hostId);
  const items = v.players.map((p) => {
    const tags = [];
    if (p.id === v.hostId) tags.push('<span class="tag tag-host"><svg class="icon icon-xs"><use href="#i-crown"/></svg>host</span>');
    if (p.id === v.me) tags.push('<span class="tag tag-you">you</span>');
    if (p.bot) tags.push('<span class="tag tag-bot">bot</span>');
    if (!p.connected) tags.push('<span class="tag tag-away">reconnecting…</span>');
    let remove = '';
    if (host && p.bot) remove = `<button type="button" class="lp-remove" data-remove-bot="${esc(p.id)}" aria-label="Remove ${esc(p.name)}"><svg class="icon icon-sm"><use href="#i-close"/></svg></button>`;
    else if (host && p.id !== v.me) remove = `<button type="button" class="lp-remove" data-kick="${esc(p.id)}" data-name="${esc(p.name)}" aria-label="Remove ${esc(p.name)} from the room"><svg class="icon icon-sm"><use href="#i-close"/></svg></button>`;
    const face = p.id === v.me
      ? `<button type="button" class="lp-av-btn" data-edit-avatar aria-label="Draw your avatar">${avatar(p)}<span class="lp-av-pen"><svg class="icon icon-xs"><use href="#i-brush"/></svg></span></button>`
      : avatar(p);
    if (p.id === v.me && !p.av) tags.unshift('<button type="button" class="tag tag-draw" data-edit-avatar>draw yourself!</button>');
    return `<li class="lp ${p.connected ? '' : 'away'} ${p.bot ? 'lp-bot' : ''}">${face}<span class="lp-name">${esc(p.name)}</span><span class="lp-tags">${tags.join('')}</span>${remove}</li>`;
  });
  const slots = Math.min(MAX_PLAYERS, Math.max(4, v.players.length + 1)) - v.players.length;
  for (let i = 0; i < slots; i++) items.push('<li class="lp lp-empty"><span class="avatar avatar-empty"></span><span class="lp-name">Waiting for a friend…</span></li>');
  $('#lobby-players').innerHTML = items.join('');
  $('#add-bot-btn').hidden = !host || v.players.length >= MAX_PLAYERS;
  $('#tv-link').href = `/tv/${v.code}`;
  $('#tv-on').hidden = !v.screens;
  $('#solo-hint').hidden = !(host && v.players.length === 1);

  // Settings
  seg($('#set-rounds'), [2, 3, 4, 5].map((n) => [n, String(n)]), v.settings.rounds, host, (n) => updateSettings({ rounds: n }));
  seg($('#set-time'), [60, 80, 100].map((n) => [n, `${n}s`]), v.settings.drawTime, host, (n) => updateSettings({ drawTime: n }));
  seg($('#set-pack'), PACKS, v.settings.pack, host, (id) => updateSettings({ pack: id }), 'chip');
  $('#settings-lock').hidden = host;
  const custom = v.settings.pack === 'custom';
  $('#custom-box').hidden = !(custom && host);
  $('#custom-readonly').hidden = !(custom && !host);
  $('#custom-readonly').textContent = `${v.settings.customCount} custom words added by the host.`;
  if (custom && host) {
    const ta = $('#custom-words');
    if (document.activeElement !== ta && typeof v.customWords === 'string' && ta.dataset.synced !== v.customWords) {
      ta.value = v.customWords;
      ta.dataset.synced = v.customWords;
    }
    const n = v.settings.customCount;
    $('#custom-count').textContent = n >= 10 ? `${n} words saved ✓` : `${n} saved — need at least 10`;
  }

  // Start
  const notice = $('#lobby-notice');
  notice.hidden = !v.notice;
  notice.textContent = v.notice || '';
  const start = $('#start-btn');
  start.hidden = !host;
  const needCustom = custom && v.settings.customCount < 10;
  start.disabled = connected < 2 || needCustom;
  let hint = '';
  if (host) {
    if (connected < 2) hint = 'You need at least 2 players — share the code or add a bot!';
    else if (needCustom) hint = 'Add at least 10 custom words, or pick another pack.';
    else hint = `${connected} players ready. Let's go!`;
  } else {
    hint = `Waiting for ${hostPlayer ? esc(hostPlayer.name) : 'the host'} to start the game…`;
  }
  $('#start-hint').innerHTML = hint;
  $('#last-gallery-btn').hidden = !(S.lastGallery && S.lastGallery.length);
}

function seg(root, options, value, enabled, onPick, cls = 'seg-btn') {
  const sig = JSON.stringify([options, value, enabled]);
  if (root.dataset.sig === sig) return;
  root.dataset.sig = sig;
  root.innerHTML = '';
  for (const [val, label] of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls + (val === value ? ' on' : '');
    b.textContent = label;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(val === value));
    b.disabled = !enabled;
    b.addEventListener('click', () => {
      if (val !== value) onPick(val);
    });
    root.appendChild(b);
  }
}

async function updateSettings(patch) {
  sfx.click();
  const res = await emit('settings', patch);
  if (res.error && !patch.customWords) toast(res.error);
  return res;
}

$('#custom-save').addEventListener('click', async () => {
  const ta = $('#custom-words');
  const res = await updateSettings({ customWords: ta.value });
  ta.dataset.synced = '';
  if (res.error) toast(res.error);
  else toast(`Saved ${res.customCount} custom words`);
});

$('#add-bot-btn').addEventListener('click', async () => {
  sfx.click();
  const res = await emit('bot:add');
  if (res.error) toast(res.error);
});
$('#lobby-players').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-remove-bot]');
  const k = e.target.closest('[data-kick]');
  if (e.target.closest('[data-edit-avatar]')) {
    openAvatarEditor();
  } else if (b) {
    const res = await emit('bot:remove', b.dataset.removeBot);
    if (res.error) toast(res.error);
  } else if (k) {
    if (!confirm(`Remove ${k.dataset.name} from the room? They won't be able to rejoin.`)) return;
    const res = await emit('kick', k.dataset.kick);
    if (res.error) toast(res.error);
  }
});

$('#start-btn').addEventListener('click', async () => {
  const res = await emit('start');
  if (res.error) toast(res.error);
});

$('#share-btn').addEventListener('click', async () => {
  const url = shareUrl();
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Doodle Dash', text: `Join my Doodle Dash room ${S.code}! 🎨`, url });
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }
  copyText(url);
});
$('#copy-btn').addEventListener('click', () => copyText(shareUrl()));
$('#qr-btn').addEventListener('click', () => $('#qr-dialog').showModal());
// On a phone, opening the TV page right here isn't useful: explain what to open on the big screen.
$('#tv-link').addEventListener('click', async (e) => {
  if (!matchMedia('(pointer: coarse)').matches) return;
  e.preventDefault();
  try {
    await navigator.clipboard.writeText(`${location.origin}/tv/${S.code}`);
  } catch (_) { /* the instructions are enough */ }
  toast(`On the TV or laptop, open ${location.host}/tv and type ${S.code}`, 6000);
});
$('#last-gallery-btn').addEventListener('click', () => {
  S.viewingLastGallery = true;
  showScreen('gallery');
  renderGallery();
  window.scrollTo(0, 0);
});

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Link copied — paste it to your friends!');
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (_) { /* ignore */ }
    ta.remove();
    toast(ok ? 'Link copied!' : text);
  }
}

// ---------------------------------------------------------------------------
// Game screen

const canvas = $('#board');
const board = new Board(canvas);
const drawInput = new DrawInput(board, canvas, (op) => socket.emit('draw', op), {
  onLimit: () => {
    if (!S.inkWarned) toast('Ink limit reached for this turn!');
    S.inkWarned = true;
  },
});

function renderGame() {
  const v = S.view;
  const t = v.turn;
  const me = player(v.me);
  const amDrawer = !!(t && t.drawerId === v.me);
  const drawer = t ? player(t.drawerId) : null;
  const drawing = v.phase === 'drawing';
  document.body.classList.toggle('is-drawer', amDrawer && drawing);

  // Word area
  const label = $('#word-label');
  const disp = $('#word-display');
  const roundTxt = `Round ${v.round} of ${v.rounds}`;
  if (v.phase === 'choosing') {
    label.textContent = roundTxt;
    disp.innerHTML = amDrawer ? '<span class="word-note">Pick a word!</span>' : `<span class="word-note">${esc(drawer ? drawer.name : 'Someone')} is choosing…</span>`;
  } else if (drawing && t.word) {
    label.innerHTML = amDrawer ? `Draw this · <span class="diff diff-${t.difficulty}">${DIFF_LABEL[t.difficulty]} ${MULT_LABEL[t.mult]}</span>` : `<span class="got">You got it!</span> · ${roundTxt}`;
    disp.innerHTML = wordHtml(t.word);
  } else if (drawing && t.mask) {
    const lens = maskLengths(t.mask);
    label.innerHTML = `<span class="hide-narrow">Guess the word · </span>${lens.join(' + ')} letters${t.mult ? ` · <span class="diff diff-${t.difficulty}">${MULT_LABEL[t.mult]}</span>` : ''}`;
    disp.innerHTML = maskHtml(t.mask);
  } else if (v.phase === 'reveal') {
    label.textContent = t && t.word ? 'The word was' : roundTxt;
    disp.innerHTML = t && t.word ? wordHtml(t.word) : '<span class="word-note">Turn skipped</span>';
  }
  fitWord();

  renderPlayers();
  renderOverlay();

  // Toolbar + input
  const canDraw = amDrawer && drawing;
  $('#toolbar').hidden = !canDraw;
  drawInput.setEnabled(canDraw);
  canvas.classList.toggle('can-draw', canDraw);
  if (canDraw) renderToolbar();

  const input = $('#chat-input');
  const inTurn = v.phase === 'choosing' || drawing;
  const privateChat = inTurn && t && (amDrawer || (me && me.guessed));
  input.classList.toggle('private', !!privateChat);
  $('#chat-form').classList.toggle('private', !!privateChat);
  if (privateChat) input.placeholder = 'Chat with players who guessed…';
  else if (drawing) input.placeholder = 'Type your guess…';
  else input.placeholder = 'Say something…';
}

function wordHtml(word) {
  return `<span class="word">${[...word].map((ch) => (ch === ' ' ? '<span class="gap"></span>' : `<span class="ch">${esc(ch)}</span>`)).join('')}</span>`;
}

function maskHtml(mask) {
  return `<span class="word mask">${mask
    .map((ch) => {
      if (ch === null) return '<span class="ch blank"></span>';
      if (ch === ' ') return '<span class="gap"></span>';
      if (/[\p{L}]/u.test(ch)) return `<span class="ch hint">${esc(ch)}</span>`;
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
    } else if (ch === null || /[\p{L}]/u.test(ch)) n++;
  }
  if (n) lens.push(n);
  return lens;
}

// Shrink long words so they always fit on one line.
function fitWord() {
  const disp = $('#word-display');
  const word = disp.querySelector('.word');
  disp.style.setProperty('--wscale', '1');
  if (!word) return;
  const avail = disp.clientWidth;
  const need = word.scrollWidth;
  if (need > avail && avail > 0) disp.style.setProperty('--wscale', String(Math.max(0.45, avail / need)));
}
window.addEventListener('resize', () => {
  if (currentScreen() === 'game') fitWord();
});

function renderPlayers() {
  const v = S.view;
  const t = v.turn;
  const pts = v.phase === 'reveal' && t && t.points ? t.points : null;
  const sorted = [...v.players].sort((a, b) => b.score - a.score);
  const ranks = new Map();
  sorted.forEach((p, i) => ranks.set(p.id, i > 0 && sorted[i - 1].score === p.score ? ranks.get(sorted[i - 1].id) : i + 1));
  $('#player-list').innerHTML = sorted
    .map((p) => {
      const isDrawer = t && t.drawerId === p.id && v.phase !== 'reveal';
      const cls = ['pl', p.connected ? '' : 'away', p.guessed ? 'guessed' : '', isDrawer ? 'drawing' : '', p.id === v.me ? 'me' : ''].join(' ');
      let status = '';
      if (isDrawer) status = '<span class="pl-status" title="Drawing"><svg class="icon icon-xs"><use href="#i-brush"/></svg></span>';
      else if (p.guessed) status = '<span class="pl-status ok" title="Guessed it"><svg class="icon icon-xs"><use href="#i-check"/></svg></span>';
      const gain = pts && pts[p.id] ? ` <span class="pl-gain">+${pts[p.id]}</span>` : '';
      return `<li class="${cls}" data-pid="${esc(p.id)}">
        <span class="pl-rank">#${ranks.get(p.id)}</span>
        <span class="pl-av">${avatar(p)}${status}</span>
        <span class="pl-main"><span class="pl-name">${esc(p.name)}${p.id === v.me ? ' <span class="you">(you)</span>' : ''}</span>
        <span class="pl-score">${p.connected ? `${p.score} pts` : 'reconnecting…'}${gain}</span></span>
      </li>`;
    })
    .join('');
}

function renderOverlay() {
  const v = S.view;
  const t = v.turn;
  const ov = $('#overlay');
  const amDrawer = t && t.drawerId === v.me;
  const drawer = t ? player(t.drawerId) : null;
  let html = '';
  let key = `${v.phase}:${t ? t.id : ''}`;
  if (v.phase === 'choosing') {
    if (amDrawer && t.choices) {
      html = `<div class="ov-card ov-choose">
        <div class="ov-kicker">Round ${v.round} of ${v.rounds} · Your turn!</div>
        <h2 class="ov-title">Pick a word to draw</h2>
        <div class="choices">${t.choices
          .map((c, i) => `<button type="button" class="choice choice-${c.difficulty}" data-choice="${i}">
              <span class="choice-word">${esc(c.word)}</span>
              <span class="choice-meta">${DIFF_LABEL[c.difficulty]} · ${MULT_LABEL[c.mult]} points</span>
            </button>`)
          .join('')}</div>
        <div class="ov-foot">Harder words score more — for you and the guessers.</div>
      </div>`;
    } else {
      html = `<div class="ov-card ov-wait">
        <div class="ov-kicker">Round ${v.round} of ${v.rounds}</div>
        ${drawer ? avatar(drawer, 'avatar-xl') : ''}
        <h2 class="ov-title">${esc(drawer ? drawer.name : 'Someone')} is picking a word<span class="dots"><i>.</i><i>.</i><i>.</i></span></h2>
        <div class="ov-foot">Get ready to guess!</div>
      </div>`;
    }
  } else if (v.phase === 'reveal' && t) {
    const pts = t.points || {};
    const rows = v.players
      .filter((p) => pts[p.id])
      .sort((a, b) => pts[b.id] - pts[a.id])
      .map((p) => `<li>${avatar(p, 'avatar-sm')}<span class="rv-name">${esc(p.name)}${p.id === t.drawerId ? ' <span class="muted">(drew)</span>' : ''}</span><span class="rv-pts">+${pts[p.id]}</span></li>`)
      .join('');
    let title = '';
    if (t.reason === 'drawerLeft' && !t.word) title = `<h2 class="ov-title">${esc(drawer ? drawer.name : 'The drawer')} left — turn skipped</h2>`;
    else title = `<div class="ov-kicker">The word was</div><h2 class="ov-word">${esc(t.word || '')}</h2>`;
    const sub = t.reason === 'allGuessed' ? '<div class="ov-badge">Everyone got it! 🎉</div>' : t.reason === 'drawerLeft' && t.word ? '<div class="ov-badge">The drawer disconnected</div>' : '';
    html = `<div class="ov-card ov-reveal">
      ${title}${sub}
      ${rows ? `<ul class="rv-list">${rows}</ul>` : t.word ? '<p class="ov-empty">Nobody guessed it this time 😅</p>' : ''}
      ${t.nextDrawerName ? `<div class="ov-foot">Up next: <b>${esc(t.nextDrawerName)}</b></div>` : '<div class="ov-foot">Final scores coming up…</div>'}
    </div>`;
  } else {
    key = '';
  }
  if (ov.dataset.key !== key || (v.phase === 'reveal' && ov.dataset.html !== html)) {
    ov.dataset.key = key;
    ov.dataset.html = html;
    ov.innerHTML = html;
    ov.hidden = !html;
  }
}

$('#overlay').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-choice]');
  if (!btn) return;
  $$('[data-choice]').forEach((b) => (b.disabled = true));
  const res = await emit('choose', Number(btn.dataset.choice));
  if (res.error) toast(res.error);
});

// ---- Toolbar

function renderToolbar() {
  const pal = $('#palette');
  if (!pal.childElementCount) {
    PALETTE.forEach((hex, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.style.setProperty('--c', hex);
      b.dataset.color = i;
      b.setAttribute('aria-label', COLOR_NAMES[i]);
      b.setAttribute('role', 'radio');
      pal.appendChild(b);
    });
  }
  for (const b of $$('.swatch', pal)) {
    const on = Number(b.dataset.color) === drawInput.color && drawInput.tool !== 'eraser';
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  }
  for (const b of $$('[data-tool]')) b.classList.toggle('on', b.dataset.tool === drawInput.tool);
  for (const b of $$('[data-size]')) b.classList.toggle('on', Number(b.dataset.size) === drawInput.sizeIndex);
  $('#toolbar').style.setProperty('--cur', PALETTE[drawInput.color]);
  updateBrushCursor();
}

$('#palette').addEventListener('click', (e) => {
  const b = e.target.closest('[data-color]');
  if (!b) return;
  drawInput.color = Number(b.dataset.color);
  if (drawInput.tool === 'eraser') drawInput.tool = 'brush';
  renderToolbar();
});
for (const b of $$('[data-tool]')) {
  b.addEventListener('click', () => {
    drawInput.tool = b.dataset.tool;
    renderToolbar();
  });
}
for (const b of $$('[data-size]')) {
  b.addEventListener('click', () => {
    drawInput.sizeIndex = Number(b.dataset.size);
    if (drawInput.tool === 'fill') drawInput.tool = 'brush';
    renderToolbar();
  });
}
$('#undo-btn').addEventListener('click', () => drawInput.undo());
$('#clear-btn').addEventListener('click', () => drawInput.clear());

// Desktop shortcuts for the drawer.
document.addEventListener('keydown', (e) => {
  if (currentScreen() !== 'game') return;
  const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
  if (drawInput.enabled && !typing) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      drawInput.undo();
      return;
    }
    const map = { b: 'brush', e: 'eraser', f: 'fill' };
    if (map[e.key]) {
      drawInput.tool = map[e.key];
      renderToolbar();
      return;
    }
    if (['1', '2', '3'].includes(e.key)) {
      drawInput.sizeIndex = Number(e.key) - 1;
      renderToolbar();
      return;
    }
  }
  // Start typing anywhere to guess.
  if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1 && !drawInput.enabled) {
    $('#chat-input').focus();
  }
});

// Brush-size cursor preview on devices with a mouse.
const cursorEl = $('#brush-cursor');
function updateBrushCursor(e) {
  if (!drawInput.enabled || drawInput.tool === 'fill' || matchMedia('(pointer: coarse)').matches) {
    cursorEl.hidden = true;
    return;
  }
  const r = canvas.getBoundingClientRect();
  const d = Math.max(4, (drawInput.size * r.width) / 800);
  cursorEl.style.width = cursorEl.style.height = `${d}px`;
  cursorEl.style.setProperty('--c', drawInput.tool === 'eraser' ? '#ffffff' : PALETTE[drawInput.color]);
  if (e) {
    cursorEl.style.transform = `translate(${e.clientX - r.left - d / 2}px, ${e.clientY - r.top - d / 2}px)`;
    cursorEl.hidden = false;
  }
}
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'mouse') updateBrushCursor(e);
});
canvas.addEventListener('pointerleave', () => (cursorEl.hidden = true));

// ---- Timer

setInterval(updateTimer, 200);
function updateTimer() {
  const v = S.view;
  if (!v || currentScreen() !== 'game') return;
  const left = Math.max(0, v.endsAt - serverNow());
  const secs = Math.ceil(left / 1000);
  $('#timer-num').textContent = v.endsAt ? String(secs) : '–';
  const frac = Math.max(0, Math.min(1, left / S.phaseTotal));
  const ring = $('#timer-ring');
  const C = 2 * Math.PI * 19;
  ring.style.strokeDasharray = `${C}`;
  ring.style.strokeDashoffset = `${C * (1 - frac)}`;
  const urgent = v.phase === 'drawing' && secs <= 10;
  $('#timer').classList.toggle('urgent', urgent);
  if (urgent && secs > 0 && secs !== S.lastSecond) sfx.tick();
  S.lastSecond = secs;
}

// ---- Chat

// Keep the chat pinned to the newest message unless the reader scrolled up, including
// when the log changes size (toolbar appearing, keyboard opening).
const chatLog = $('#chat-log');
let chatPinned = true;
chatLog.addEventListener('scroll', () => {
  chatPinned = chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 40;
});
new ResizeObserver(() => {
  if (chatPinned) chatLog.scrollTop = chatLog.scrollHeight;
}).observe(chatLog);

// live = arrived just now (plays sounds); false when restoring history after a refresh.
function renderChat(m, live) {
  const log = chatLog;
  const atBottom = chatPinned;
  const li = document.createElement('li');
  li.className = `msg msg-${m.kind}${m.sub ? ` msg-${m.sub}` : ''}`;
  const who = m.name ? `<b class="msg-name" style="--pc:${esc(m.color || '#888')}">${esc(m.name)}</b>` : '';
  switch (m.kind) {
    case 'chat':
      li.innerHTML = `${who}<span class="msg-text">${esc(m.text)}</span>${m.onlyYou ? '<span class="msg-note">only you can see this</span>' : ''}`;
      break;
    case 'private':
      li.innerHTML = `<svg class="icon icon-xs"><use href="#i-lock"/></svg>${who}<span class="msg-text">${esc(m.text)}</span>`;
      break;
    case 'close':
      li.innerHTML = `${who}<span class="msg-text">${esc(m.text)}</span><span class="close-tag">So close!</span>`;
      if (live) sfx.close();
      break;
    case 'you-correct':
      li.innerHTML = `<svg class="icon icon-sm"><use href="#i-check"/></svg><span>You guessed it! <b>${esc(m.text)}</b> · +${m.points}</span>`;
      if (live) {
        sfx.correct();
        vibrate([30, 40, 30]);
        burst($('#chat-input'));
      }
      break;
    case 'correct':
      li.innerHTML = `<svg class="icon icon-sm"><use href="#i-check"/></svg><span>${esc(m.text)}</span>`;
      if (live) {
        sfx.pop();
        pulsePlayer(m.from);
      }
      break;
    default:
      li.innerHTML = `<span>${esc(m.text)}</span>`;
  }
  log.appendChild(li);
  while (log.childElementCount > 150) log.firstElementChild.remove();
  if (atBottom || m.from === (S.view && S.view.me)) {
    log.scrollTop = log.scrollHeight;
    chatPinned = true;
  }
}

$('#chat-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#chat-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  const res = await emit('chat', text);
  if (res.error === 'Slow down!') {
    toast('Whoa, slow down a little!');
    if (!input.value) input.value = text;
  }
});

// ---------------------------------------------------------------------------
// Podium

function renderPodium() {
  const v = S.view;
  if (!v || v.phase !== 'gameOver') {
    renderPlayAgain();
    return;
  }
  const sorted = [...v.players].sort((a, b) => b.score - a.score);
  const top = sorted.slice(0, 3);
  const tie = sorted.length > 1 && sorted[0].score === sorted[1].score;
  $('#winner-title').innerHTML = tie ? "It's a tie!" : `${esc(sorted[0] ? sorted[0].name : '')} wins!`;
  const order = [top[1], top[0], top[2]];
  const place = ['second', 'first', 'third'];
  const label = ['2nd', '1st', '3rd'];
  $('#podium').style.setProperty('--places', String(top.length));
  $('#podium').innerHTML = order
    .map((p, i) =>
      p
        ? `<div class="pod pod-${place[i]}">
            <div class="pod-who">${i === 1 ? '<svg class="icon pod-crown"><use href="#i-crown"/></svg>' : ''}${avatar(p, 'avatar-lg')}
              <div class="pod-name">${esc(p.name)}${p.id === v.me ? ' <span class="you">(you)</span>' : ''}</div>
              <div class="pod-score">${p.score} pts</div></div>
            <div class="pod-block"><span>${label[i]}</span></div>
          </div>`
        : ''
    )
    .join('');
  $('#rest-list').innerHTML = sorted
    .slice(3)
    .map((p, i) => `<li><span class="rest-rank">${i + 4}</span>${avatar(p, 'avatar-sm')}<span class="rest-name">${esc(p.name)}</span><span class="rest-score">${p.score} pts</span></li>`)
    .join('');
  const n = S.gallery ? S.gallery.length : 0;
  renderAwards();
  $('#to-gallery-btn').disabled = !S.gallery;
  $('#to-gallery-btn').lastChild.textContent = S.gallery ? ` Open the gallery (${n})` : ' Loading the gallery…';
  renderPlayAgain();
}

function renderPlayAgain() {
  const v = S.view;
  const host = isHost();
  const over = v && v.phase === 'gameOver';
  const hostP = v ? player(v.hostId) : null;
  for (const b of $$('[data-play-again]')) b.hidden = !(over && host);
  for (const p of $$('[data-wait-host]')) {
    p.hidden = !over || host;
    p.textContent = `Waiting for ${hostP ? hostP.name : 'the host'} to start a new game…`;
  }
}

$('#to-gallery-btn').addEventListener('click', () => {
  S.gameOverScreen = 'gallery';
  showScreen('gallery');
  renderGallery();
  window.scrollTo(0, 0);
});
$('#gallery-back').addEventListener('click', () => {
  if (S.view && S.view.phase === 'gameOver') {
    S.gameOverScreen = 'podium';
    showScreen('podium');
  } else {
    S.viewingLastGallery = false;
    showScreen('lobby');
    renderLobby();
  }
});
for (const b of $$('[data-play-again]')) {
  b.addEventListener('click', async () => {
    const res = await emit('playAgain');
    if (res.error) toast(res.error);
  });
}

// ---------------------------------------------------------------------------
// Gallery

let galleryStops = [];
let galleryObserver = null;
let galleryRendered = null;

function galleryData() {
  return (S.view && S.view.phase === 'gameOver' ? S.gallery : S.lastGallery || S.gallery) || [];
}

function renderGallery() {
  const drawings = galleryData();
  if (galleryRendered === drawings) {
    renderPlayAgain();
    return;
  }
  galleryRendered = drawings;
  galleryStops.forEach((stop) => stop());
  galleryStops = [];
  if (galleryObserver) galleryObserver.disconnect();
  const grid = $('#gallery-grid');
  const artists = new Set(drawings.map((d) => d.drawerName)).size;
  $('#gallery-sub').textContent = drawings.length
    ? `${drawings.length} masterpiece${drawings.length === 1 ? '' : 's'} by ${artists} artist${artists === 1 ? '' : 's'} · tap one to see it big`
    : 'No drawings this game — nobody picked up the pencil!';
  grid.innerHTML = drawings
    .map(
      (d, i) => `<figure class="frame" style="--tilt:${[-1.4, 1.1, -0.6, 1.5, -1.1, 0.7][i % 6]}deg" data-index="${i}">
        <div class="frame-tape" aria-hidden="true"></div>
        <div class="fav-ribbon" hidden>${AWARD_ICONS.crowd}<span>Crowd favourite</span></div>
        <button type="button" class="frame-art" data-view="${i}" aria-label="View ${esc(d.word)} by ${esc(d.drawerName)}">
          <canvas width="800" height="600"></canvas>
        </button>
        <figcaption>
          <div class="frame-word">${esc(d.word)}</div>
          <div class="frame-by">${avatar({ id: d.drawerId, name: d.drawerName, color: d.drawerColor, bot: d.drawerBot }, 'avatar-xs')} <span>${esc(d.drawerName)}</span></div>
          <div class="frame-meta">Round ${d.round} · ${d.guessedCount ? `${d.guessedCount} guessed it` : 'nobody guessed it'}</div>
        </figcaption>
        <div class="frame-actions">
          <button type="button" class="like-btn" data-like="${i}" aria-pressed="false" aria-label="Like ${esc(d.word)}">${STICKERS.love.svg}<span class="like-n">0</span></button>
          <button type="button" class="btn btn-secondary btn-sm" data-replay="${i}" aria-label="Replay"><svg class="icon icon-sm"><use href="#i-replay"/></svg><span class="hide-narrow">Replay</span></button>
          <button type="button" class="btn btn-primary btn-sm" data-save="${i}"><svg class="icon icon-sm"><use href="#i-download"/></svg> Save PNG</button>
        </div>
      </figure>`
    )
    .join('');
  const canvases = $$('.frame canvas', grid);
  const started = new Set();
  const play = (i) => {
    if (galleryStops[i]) galleryStops[i]();
    galleryStops[i] = replay(canvases[i], drawings[i].ops, { duration: replayDuration(drawings[i]) });
  };
  galleryObserver = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        const i = Number(en.target.closest('.frame').dataset.index);
        if (en.isIntersecting && !started.has(i)) {
          started.add(i);
          play(i);
        }
      }
    },
    { threshold: 0.35 }
  );
  canvases.forEach((c) => galleryObserver.observe(c));
  grid.onclick = async (e) => {
    const r = e.target.closest('[data-replay]');
    const s = e.target.closest('[data-save]');
    const view = e.target.closest('[data-view]');
    const like = e.target.closest('[data-like]');
    if (like) {
      if (like.disabled) return;
      const i = Number(like.dataset.like);
      const on = like.getAttribute('aria-pressed') !== 'true';
      // Optimistic: flip it now, the server's count follows.
      const mine = new Set(S.likes.mine);
      if (on) mine.add(i);
      else mine.delete(i);
      S.likes = { counts: S.likes.counts.map((n, k) => (k === i ? n + (on ? 1 : -1) : n)), mine: [...mine] };
      updateLikes();
      if (on) {
        sfx.pop();
        vibrate(12);
      }
      const res = await emit('like', i, on);
      if (res.error) toast(res.error);
    } else if (r) play(Number(r.dataset.replay));
    else if (s) savePng(drawings[Number(s.dataset.save)]);
    else if (view) openViewer(Number(view.dataset.view));
  };
  updateLikes();
  renderPlayAgain();
}

function galleryLikes() {
  return (S.view && S.view.phase === 'gameOver' ? S.likes : S.lastLikes) || { counts: [], mine: [] };
}

function favouriteIndex(counts) {
  let best = -1;
  counts.forEach((n, i) => {
    if (n > 0 && (best === -1 || n > counts[best])) best = i;
  });
  return best;
}

// Update hearts and the Crowd favourite ribbon in place (without restarting replays).
function updateLikes() {
  const drawings = galleryData();
  const { counts, mine } = galleryLikes();
  const live = !!(S.view && S.view.phase === 'gameOver');
  const fav = favouriteIndex(counts);
  $$('#gallery-grid .frame').forEach((frame) => {
    const i = Number(frame.dataset.index);
    const btn = frame.querySelector('.like-btn');
    const own = S.view && drawings[i] && drawings[i].drawerId === S.view.me;
    btn.querySelector('.like-n').textContent = String(counts[i] || 0);
    btn.setAttribute('aria-pressed', String(mine.includes(i)));
    btn.disabled = !live || !!own;
    btn.title = own ? 'Your drawing' : live ? 'Like' : '';
    frame.querySelector('.fav-ribbon').hidden = i !== fav;
    frame.classList.toggle('is-fav', i === fav);
  });
  $('#like-hint').hidden = !live || !drawings.length;
}

function renderAwards() {
  const v = S.view;
  const awards = (v && v.awards) || S.awards || [];
  const wrap = $('#awards-wrap');
  if (!v || v.phase !== 'gameOver') {
    wrap.hidden = true;
    $('#awards').innerHTML = ''; // next game's cards pop in fresh
    return;
  }
  const drawings = S.gallery || [];
  const { counts } = S.likes;
  const fav = favouriteIndex(counts || []);
  const cards = awards.map(
    (a, k) => `<div class="award" data-key="${a.id}" style="--delay:${0.9 + k * 0.12}s">
      <span class="award-icon">${AWARD_ICONS[a.id] || ''}</span>
      <div class="award-body"><div class="award-title">${esc(a.title)}</div>
        <div class="award-who">${avatar({ id: a.playerId, name: a.name, color: a.color, bot: a.bot }, 'avatar-xs')} ${esc(a.name)}</div>
        <div class="award-detail">${esc(a.detail)}</div></div>
    </div>`
  );
  if (drawings.length) {
    const d = drawings[fav];
    cards.push(`<div class="award award-crowd" data-key="crowd" style="--delay:${0.9 + awards.length * 0.12}s">
      <span class="award-icon">${AWARD_ICONS.crowd}</span>
      <div class="award-body"><div class="award-title">Crowd favourite</div>
        ${
          d
            ? `<div class="award-who">${avatar({ id: d.drawerId, name: d.drawerName, color: d.drawerColor, bot: d.drawerBot }, 'avatar-xs')} ${esc(d.drawerName)}</div>
               <div class="award-detail">“${esc(d.word)}” · ${counts[fav]} like${counts[fav] === 1 ? '' : 's'}</div>`
            : '<div class="award-detail">Nobody has voted yet. Open the gallery and tap ♥ on your favourites!</div>'
        }</div>
    </div>`);
  }
  wrap.hidden = !cards.length;
  // In place, so likes coming in don't replay every card's pop-in.
  syncCards($('#awards'), cards.map((html) => ({ key: /data-key="([^"]+)"/.exec(html)[1], html })));
}

function replayDuration(d) {
  const pts = d.ops.reduce((n, o) => n + (o.t === 's' ? o.p.length / 2 : 30), 0);
  return Math.max(1800, Math.min(6500, pts * 6));
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'drawing';
}

function dataUrlToFile(dataUrl, name) {
  const bin = atob(dataUrl.split(',')[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type: 'image/png' });
}

async function savePng(d) {
  const url = exportPng(d, { roomCode: S.galleryCode || S.code });
  await saveImage(url, `doodle-dash-${slug(d.word)}.png`, `${d.word} — Doodle Dash`);
}

async function savePoster() {
  const drawings = galleryData();
  if (!drawings.length) return;
  const { counts } = galleryLikes();
  const players = S.view ? [...S.view.players].sort((a, b) => b.score - a.score) : [];
  const btn = $('#poster-btn');
  btn.disabled = true;
  await new Promise((r) => setTimeout(r, 30)); // let the button update before the heavy render
  const url = exportPoster(drawings, {
    roomCode: S.galleryCode || S.code,
    likes: counts,
    favourite: favouriteIndex(counts),
    winner: S.view && S.view.phase === 'gameOver' && players[0] ? players[0] : null,
  });
  btn.disabled = false;
  await saveImage(url, `doodle-dash-${S.galleryCode || 'game'}-gallery.png`, 'Our Doodle Dash gallery');
}

async function saveImage(url, name, title) {
  // On phones, the share sheet is the natural way to put an image in Photos.
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare) {
    try {
      const file = dataUrlToFile(url, name);
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title });
        return;
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  toast('Saved!');
}

// Full-screen viewer
let viewerIndex = 0;
let viewerStop = null;
let slideshow = false;
let slideTimer = null;
function openViewer(i, auto = slideshow) {
  slideshow = auto;
  clearTimeout(slideTimer);
  const drawings = galleryData();
  if (!drawings.length) return;
  viewerIndex = (i + drawings.length) % drawings.length;
  const d = drawings[viewerIndex];
  $('#viewer').hidden = false;
  document.body.classList.add('viewer-open');
  $('#viewer-word').textContent = d.word;
  $('#viewer-by').innerHTML = `${avatar({ id: d.drawerId, name: d.drawerName, color: d.drawerColor, bot: d.drawerBot }, 'avatar-xs')} drawn by ${esc(d.drawerName)} · ${viewerIndex + 1} / ${drawings.length}`;
  $('#viewer').classList.toggle('is-slideshow', slideshow);
  if (viewerStop) viewerStop();
  viewerStop = replay($('#viewer-canvas'), d.ops, {
    duration: replayDuration(d),
    onDone: () => {
      if (slideshow && viewerIndex < drawings.length - 1) slideTimer = setTimeout(() => openViewer(viewerIndex + 1, true), 1800);
    },
  });
}
function closeViewer() {
  slideshow = false;
  clearTimeout(slideTimer);
  if (viewerStop) viewerStop();
  $('#viewer').hidden = true;
  document.body.classList.remove('viewer-open');
}
$('#viewer-close').addEventListener('click', closeViewer);
$('#viewer').addEventListener('click', (e) => {
  if (e.target.id === 'viewer') closeViewer();
});
$('#viewer-prev').addEventListener('click', () => openViewer(viewerIndex - 1));
$('#viewer-next').addEventListener('click', () => openViewer(viewerIndex + 1));
$('#viewer-replay').addEventListener('click', () => openViewer(viewerIndex));
$('#viewer-save').addEventListener('click', () => savePng(galleryData()[viewerIndex]));
$('#slideshow-btn').addEventListener('click', () => openViewer(0, true));
$('#poster-btn').addEventListener('click', savePoster);
document.addEventListener('keydown', (e) => {
  if ($('#viewer').hidden) return;
  if (e.key === 'Escape') closeViewer();
  if (e.key === 'ArrowLeft') openViewer(viewerIndex - 1);
  if (e.key === 'ArrowRight') openViewer(viewerIndex + 1);
});

// ---------------------------------------------------------------------------
// Reactions: tap an emoji, it floats up over the drawing on every screen.

const reactTray = $('#react-tray');
reactTray.innerHTML = STICKER_IDS.map((id) => `<button type="button" data-react="${id}" aria-label="${STICKERS[id].label}">${STICKERS[id].svg}</button>`).join('');
$('#react-btn').innerHTML = REACT_ICON;
let trayTimer = null;
function setTray(open) {
  reactTray.hidden = !open;
  $('#react-btn').setAttribute('aria-expanded', String(open));
  clearTimeout(trayTimer);
  if (open) trayTimer = setTimeout(() => setTray(false), 5000);
}
$('#react-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  setTray(reactTray.hidden);
});
reactTray.addEventListener('click', async (e) => {
  e.stopPropagation();
  const b = e.target.closest('[data-react]');
  if (!b) return;
  setTray(true); // keep it open for rapid taps
  const me = S.view && player(S.view.me);
  floatReaction(b.dataset.react, me ? me.name : '', me ? me.color : '#999');
  vibrate(10);
  const res = await emit('react', b.dataset.react);
  if (res.error === 'Slow down!') toast('Easy there!');
});
document.addEventListener('click', (e) => {
  if (!reactTray.hidden && !e.target.closest('#react-tray, #react-btn')) setTray(false);
});

const floatLayer = $('#float-layer');
function floatReaction(id, name, color) {
  const sticker = STICKERS[id];
  if (!sticker || floatLayer.childElementCount > 40) return;
  const onGame = currentScreen() === 'game';
  const r = onGame ? $('#canvas-wrap').getBoundingClientRect() : { left: innerWidth * 0.2, width: innerWidth * 0.6, bottom: innerHeight - 90 };
  const el = document.createElement('span');
  el.className = 'floater';
  el.style.left = `${r.left + r.width * (0.12 + Math.random() * 0.76)}px`;
  el.style.top = `${r.bottom - 36}px`;
  el.style.setProperty('--dx', `${Math.round((Math.random() - 0.5) * 70)}px`);
  el.style.setProperty('--rot', `${Math.round((Math.random() - 0.5) * 30)}deg`);
  el.innerHTML = `<span class="fe">${sticker.svg}</span>${name ? `<span class="fn" style="--pc:${esc(color)}">${esc(name)}</span>` : ''}`;
  el.addEventListener('animationend', () => el.remove());
  floatLayer.appendChild(el);
}

function pulsePlayer(pid) {
  const li = pid && document.querySelector(`#player-list [data-pid="${CSS.escape(pid)}"]`);
  if (!li) return;
  li.classList.remove('pulse');
  void li.offsetWidth;
  li.classList.add('pulse');
}

// A small confetti pop from an element (used when you guess right).
function burst(fromEl) {
  const c = $('#burst');
  if (!c || !fromEl || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const r = fromEl.getBoundingClientRect();
  const ctx = c.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = innerWidth * dpr;
  c.height = innerHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const colors = ['#ff5c39', '#ffd23f', '#2bb673', '#2f6fe4', '#8e5cf7', '#ff7eb6'];
  const parts = Array.from({ length: 46 }, () => ({
    x: r.left + r.width * (0.2 + Math.random() * 0.6),
    y: r.top,
    vx: (Math.random() - 0.5) * 9,
    vy: -Math.random() * 10 - 5,
    r: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.5,
    w: 5 + Math.random() * 7,
    h: 3 + Math.random() * 5,
    c: colors[Math.floor(Math.random() * colors.length)],
  }));
  const t0 = performance.now();
  (function frame(now) {
    const t = now - t0;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += 0.42;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.globalAlpha = Math.max(0, 1 - t / 1300);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (t < 1300) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, innerWidth, innerHeight);
  })(t0);
}

// ---------------------------------------------------------------------------
// Confetti

function confetti() {
  const c = $('#confetti');
  if (!c || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const ctx = c.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = innerWidth * dpr;
  c.height = innerHeight * dpr;
  ctx.scale(dpr, dpr);
  const colors = ['#ff5c39', '#ffd23f', '#2bb673', '#2f6fe4', '#8e5cf7', '#ff7eb6'];
  const parts = Array.from({ length: 140 }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * innerWidth * 0.3,
    y: innerHeight * 0.35,
    vx: (Math.random() - 0.5) * 14,
    vy: -Math.random() * 14 - 4,
    r: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.4,
    w: 6 + Math.random() * 8,
    h: 4 + Math.random() * 6,
    c: colors[Math.floor(Math.random() * colors.length)],
  }));
  const t0 = performance.now();
  function frame(now) {
    const t = now - t0;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += 0.35;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.globalAlpha = Math.max(0, 1 - t / 3500);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (t < 3500) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, innerWidth, innerHeight);
  }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Shared UI bits

// A drawn avatar shows through the av-<id> class as soon as it's known (see avatar.js).
function avatar(p, cls = '') {
  const initial = p.bot ? '🤖' : esc([...(p.name || '?').trim()][0] || '?').toUpperCase();
  const art = !p.bot && p.id && /^[A-Za-z0-9_-]+$/.test(p.id) ? ` av-${p.id}` : '';
  return `<span class="avatar ${cls}${p.bot ? ' avatar-bot' : ''}${art}" style="--pc:${esc(p.color || '#999')}" aria-hidden="true">${initial}</span>`;
}

// ---------------------------------------------------------------------------
// Avatar editor

const pad = new AvatarPad($('#av-pad'));
function savedAvatar() {
  try {
    const a = JSON.parse(ls.get('dd.avatar') || 'null');
    return Array.isArray(a) && a.length ? a : null;
  } catch (_) {
    return null;
  }
}

function openAvatarEditor() {
  const me = S.view && player(S.view.me);
  if (!me) return;
  $('#av-pad-wrap').style.setProperty('--pc', me.color);
  pad.load(savedAvatar() || []);
  renderAvatarTools();
  $('#avatar-dialog').showModal();
}

function renderAvatarTools() {
  const pal = $('#av-palette');
  if (!pal.childElementCount) {
    PALETTE.forEach((hex, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.style.setProperty('--c', hex);
      b.dataset.avColor = i;
      b.setAttribute('aria-label', COLOR_NAMES[i]);
      pal.appendChild(b);
    });
  }
  for (const b of $$('[data-av-color]')) b.classList.toggle('on', Number(b.dataset.avColor) === pad.color);
  for (const b of $$('[data-av-size]')) b.classList.toggle('on', Number(b.dataset.avSize) === pad.sizeIndex);
}

$('#av-palette').addEventListener('click', (e) => {
  const b = e.target.closest('[data-av-color]');
  if (!b) return;
  pad.color = Number(b.dataset.avColor);
  renderAvatarTools();
});
for (const b of $$('[data-av-size]')) {
  b.addEventListener('click', () => {
    pad.sizeIndex = Number(b.dataset.avSize);
    renderAvatarTools();
  });
}
$('#av-undo').addEventListener('click', () => pad.undo());
$('#av-clear').addEventListener('click', () => pad.clear());
$('#av-save').addEventListener('click', async () => {
  const data = pad.strokes.length ? pad.strokes : null;
  ls.set('dd.avatar', data ? JSON.stringify(data) : null);
  const res = await emit('avatar', data);
  if (res.error) {
    toast(res.error);
    return;
  }
  $('#avatar-dialog').close();
  sfx.pop();
  toast(data ? 'Looking good!' : 'Avatar removed');
});

// Bring your saved avatar into each new room (only allowed in the lobby or after a game).
let avatarSentFor = null;
function autoAvatar(v, me) {
  if (!me || me.av || (v.phase !== 'lobby' && v.phase !== 'gameOver')) return;
  const key = `${v.code}:${me.id}`;
  const saved = savedAvatar();
  if (!saved || avatarSentFor === key) return;
  avatarSentFor = key;
  emit('avatar', saved);
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let toastTimer = null;
function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => (el.hidden = true), 250);
  }, ms);
}

let connTimer = null;
function showConnSoon() {
  clearTimeout(connTimer);
  connTimer = setTimeout(() => ($('#conn-banner').hidden = false), 900);
}
function hideConn() {
  clearTimeout(connTimer);
  $('#conn-banner').hidden = true;
}

function vibrate(pattern) {
  try {
    if (navigator.vibrate && !isMuted()) navigator.vibrate(pattern);
  } catch (_) { /* ignore */ }
}

// Mute buttons
function updateMuteButtons() {
  const m = isMuted();
  for (const b of $$('[data-mute]')) {
    b.querySelector('use').setAttribute('href', m ? '#i-mute' : '#i-sound');
    b.setAttribute('aria-label', m ? 'Unmute sounds' : 'Mute sounds');
    b.setAttribute('aria-pressed', String(m));
    b.classList.toggle('is-muted', m);
  }
}
for (const b of $$('[data-mute]')) {
  b.addEventListener('click', () => {
    setMuted(!isMuted());
    updateMuteButtons();
    if (!isMuted()) sfx.click();
    toast(isMuted() ? 'Sound off' : 'Sound on');
  });
}
updateMuteButtons();

// Menu
function closeMenu() {
  $('#menu').hidden = true;
  $('#menu-btn').setAttribute('aria-expanded', 'false');
}
$('#menu-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  const open = $('#menu').hidden;
  $('#menu').hidden = !open;
  $('#menu-btn').setAttribute('aria-expanded', String(open));
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#menu')) closeMenu();
});

// Help + dialogs
for (const b of $$('[data-open-help]')) {
  b.addEventListener('click', () => {
    closeMenu();
    $('#help').showModal();
  });
}
for (const d of $$('dialog')) {
  d.addEventListener('click', (e) => {
    if (e.target === d || e.target.closest('[data-close]')) d.close();
  });
}
for (const b of $$('[data-leave]')) b.addEventListener('click', leaveRoom);

// Keep the layout the size of the visible viewport (handles on-screen keyboards).
function fitViewport() {
  const vv = window.visualViewport;
  const h = vv ? vv.height : window.innerHeight;
  document.documentElement.style.setProperty('--app-h', `${Math.round(h)}px`);
  const kb = vv && document.activeElement && document.activeElement.id === 'chat-input' && matchMedia('(pointer: coarse)').matches && vv.height < window.screen.height * 0.62;
  document.body.classList.toggle('kb-open', !!kb);
  if (currentScreen() === 'game' && vv && vv.offsetTop > 0) window.scrollTo(0, 0);
}
if (window.visualViewport) {
  visualViewport.addEventListener('resize', fitViewport);
  visualViewport.addEventListener('scroll', fitViewport);
}
window.addEventListener('resize', fitViewport);
$('#chat-input').addEventListener('focus', () => setTimeout(fitViewport, 50));
$('#chat-input').addEventListener('blur', () => setTimeout(fitViewport, 50));
fitViewport();

// Coming back to the tab: reconnect straight away instead of waiting for backoff.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !socket.connected) socket.connect();
});

// Test hooks (used by the automated browser tests).
window.__dd = { board, S, drawInput };

// First paint: show the home screen until the socket decides where we belong.
if (!ss.get('dd.room') && !lastRoomFor(ls.get('dd.token'))) {
  showHome(S.invite);
} else {
  document.body.classList.add('rejoining');
  showScreen('home');
}
