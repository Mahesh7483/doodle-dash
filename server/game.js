'use strict';

// Pure game logic for Doodle Dash. No sockets, no real timers: time comes from an injectable
// `now()` and the server calls `tick()` regularly. Everything a client sees goes through the
// injected `send(playerId, event, payload)` so tests can inspect every payload.

const crypto = require('crypto');
const { PACKS, PACK_IDS, MULTIPLIERS, parseCustomWords } = require('./words');
const { doodleOps, doodleWords, LIBRARY } = require('./doodles');

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ'; // no I, L, O
const MAX_PLAYERS = 8;
const AVATAR_COLORS = ['#ff595e', '#1982c4', '#ffb000', '#2bb673', '#8e5cf7', '#ff6fb5', '#00b4c6', '#ff8a2a'];
const CANVAS_W = 800;
const CANVAS_H = 600;
const PALETTE_SIZE = 12;
const BRUSH_SIZES = [4, 10, 24, 48];
const DRAW_TIMES = [60, 80, 100];
const MAX_POINTS_PER_TURN = 20000;
const MAX_OPS_PER_TURN = 3000;
const MAX_POINTS_PER_MSG = 300;
const CHAT_MAX_LEN = 100;
const CHAT_PER_SEC = 3;
const DRAW_MSGS_PER_SEC = 80;
const CHAT_HISTORY = 60; // messages kept per player and replayed after a refresh

// Bots let one person try the game alone. They draw pre-made doodles and guess the human's
// drawing a little while after there's something on the canvas.
const BOT_NAMES = ['Doodlebot', 'Pablo Botcasso', 'Vincent van Bot', 'Frida Botlo', 'Botticelli', 'Sketchy Bot', 'Scribble Bot', 'Crayonbot'];
const BOT_INK_POINTS = 30; // bots don't guess a blank canvas
const BOT_GUESS_CHANCE = { easy: 0.95, medium: 0.88, hard: 0.78 };
const BOT_THINK_EXTRA = { easy: 0, medium: 2500, hard: 5000 };
const BOT_REACTIONS = ['nice one!', 'haha', 'gg', 'that was fun', 'wow 🎨', 'love it', 'ooh, tricky', 'again again!'];
const BOT_STUMPED = ['no idea 😅', 'that was a tough one!', 'hmm, what was it?'];

const DEFAULT_TIMING = {
  chooseMs: 15000,
  revealMs: 5000,
  drawerGraceMs: 10000,
  hostGraceMs: 10000,
  seatHoldMs: 60000,
  roomIdleMs: 30 * 60 * 1000,
  drawMs: null, // test override for the host's draw time
};

const DEFAULT_SETTINGS = { rounds: 3, drawTime: 80, pack: 'mixed' };

// ---------------------------------------------------------------------------
// Text helpers

function normalizeGuess(s) {
  return String(s == null ? '' : s)
    .normalize('NFD')
    .replace(/\p{M}+/gu, '') // strip diacritics
    .toLowerCase()
    .replace(/[-'’]/g, '') // hyphens/apostrophes join words: "t-shirt" -> "tshirt"
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // other punctuation becomes a space
    .replace(/\s+/g, ' ')
    .trim();
}

// Comparison key: spaces removed so "ice cream", "icecream" and "ice-cream" all match.
function guessKey(s) {
  return normalizeGuess(s).replace(/ /g, '');
}

function levenshtein(a, b, max = Infinity) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = new Array(b.length + 1);
  let cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

function isLetter(ch) {
  return /\p{L}/u.test(ch);
}

function letterCount(word) {
  let n = 0;
  for (const ch of word) if (isLetter(ch)) n++;
  return n;
}

// 'correct' | 'close' | 'contains' | 'wrong'
function checkGuess(guess, word) {
  const g = guessKey(guess);
  const w = guessKey(word);
  if (!g || !w) return 'wrong';
  if (g === w) return 'correct';
  if (w.length >= 4 && levenshtein(g, w, 1) === 1) return 'close';
  if (g.includes(w)) return 'contains';
  return 'wrong';
}

function maxHints(word) {
  return Math.floor(letterCount(word) / 2);
}

// Mask sent to guessers: null = hidden letter, otherwise the visible character.
function buildMask(word, revealed) {
  return Array.from(word).map((ch, i) => (!isLetter(ch) || revealed.has(i) ? ch : null));
}

function guesserPoints(timeLeftMs, drawMs, mult) {
  const left = Math.max(0, Math.min(drawMs, timeLeftMs));
  return Math.round((100 + (200 * left) / drawMs) * mult);
}

function drawerPoints(correctCount, mult) {
  return Math.round(50 * correctCount * mult);
}

// Control characters, zero-width characters and bidi overrides.
const INVISIBLE_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g;

function sanitizeName(name) {
  return String(name == null ? '' : name)
    .replace(/\s+/g, ' ')
    .replace(INVISIBLE_CHARS, '')
    .trim()
    .slice(0, 16)
    .trim();
}

function sanitizeChat(text) {
  return String(text == null ? '' : text)
    .replace(/\s+/g, ' ')
    .replace(INVISIBLE_CHARS, '')
    .trim()
    .slice(0, CHAT_MAX_LEN);
}

function validToken(token) {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(token);
}

function normalizeCode(code) {
  return String(code == null ? '' : code).trim().toUpperCase();
}

function validCode(code) {
  return new RegExp(`^[${CODE_ALPHABET}]{4}$`).test(code);
}

function newId() {
  return crypto.randomBytes(6).toString('base64url');
}

// ---------------------------------------------------------------------------
// Room

class Room {
  constructor(code, opts = {}) {
    this.code = code;
    this.now = opts.now || Date.now;
    this.rng = opts.rng || Math.random;
    this.send = opts.send || (() => {});
    this.timing = { ...DEFAULT_TIMING, ...(opts.timing || {}) };
    this.players = []; // seat order
    this.hostId = null;
    this.settings = { ...DEFAULT_SETTINGS };
    this.customWords = [];
    this.phase = 'lobby';
    this.round = 0;
    this.drawOrder = [];
    this.turnIndex = -1;
    this.turnId = 0;
    this.turn = null;
    this.endsAt = 0;
    this.phaseMs = 0;
    this.gallery = [];
    this.usedWords = new Set();
    this.notice = null;
    this.emptySince = this.now();
    this.msgSeq = 0;
  }

  // ---- lookups

  get(pid) {
    return this.players.find((p) => p.id === pid) || null;
  }

  byToken(token) {
    return this.players.find((p) => p.token === token) || null;
  }

  connected() {
    return this.players.filter((p) => p.connected);
  }

  humansConnected() {
    return this.players.filter((p) => p.connected && !p.bot);
  }

  addBot(pid) {
    if (pid !== this.hostId) return { error: 'Only the host can add bots.' };
    if (this.phase !== 'lobby') return { error: 'Bots can only join in the lobby.' };
    if (this.isFull()) return { error: 'Room is full' };
    const taken = new Set(this.players.map((p) => p.name.toLowerCase()));
    const name = BOT_NAMES.find((n) => !taken.has(n.toLowerCase())) || this.uniqueName('Bot');
    const bot = {
      id: newId(),
      token: null,
      name,
      color: this.pickColor(),
      score: 0,
      connected: true,
      disconnectedAt: null,
      guessed: false,
      isNew: false,
      bot: true,
      brain: null,
      history: [],
      chatTimes: [],
      drawTimes: [],
    };
    this.players.push(bot);
    this.system(`${name} (bot) joined`, 'join');
    this.broadcastState();
    return { ok: true, id: bot.id };
  }

  removeBot(pid, botId) {
    if (pid !== this.hostId) return { error: 'Only the host can remove bots.' };
    if (this.phase !== 'lobby') return { error: 'Bots can only leave in the lobby.' };
    const bot = this.get(botId);
    if (!bot || !bot.bot) return { error: 'No such bot.' };
    this.removePlayer(botId, 'left');
    return { ok: true };
  }

  get drawer() {
    return this.turn ? this.get(this.turn.drawerId) : null;
  }

  isFull() {
    return this.players.length >= MAX_PLAYERS;
  }

  // ---- seats

  uniqueName(base) {
    const taken = new Set(this.players.map((p) => p.name.toLowerCase()));
    if (!taken.has(base.toLowerCase())) return base;
    for (let n = 2; ; n++) {
      const suffix = ` ${n}`;
      const candidate = base.slice(0, 16 - suffix.length).trim() + suffix;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }

  pickColor() {
    const used = new Set(this.players.map((p) => p.color));
    return AVATAR_COLORS.find((c) => !used.has(c)) || AVATAR_COLORS[this.players.length % AVATAR_COLORS.length];
  }

  // Creates a seat (not yet connected). Call connect() once a socket is bound to it.
  addPlayer(token, rawName) {
    const name = sanitizeName(rawName);
    if (!name) return { error: 'Please enter a name (1–16 characters).' };
    if (!validToken(token)) return { error: 'Bad session token. Please reload the page.' };
    if (this.isFull()) return { error: 'Room is full' };
    const player = {
      id: newId(),
      token,
      name: this.uniqueName(name),
      color: this.pickColor(),
      score: 0,
      connected: false,
      disconnectedAt: null,
      guessed: false,
      isNew: true,
      history: [],
      chatTimes: [],
      drawTimes: [],
    };
    this.players.push(player);
    if (!this.hostId || !this.get(this.hostId)) this.hostId = player.id;
    return { player };
  }

  connect(pid) {
    const p = this.get(pid);
    if (!p) return;
    p.connected = true;
    p.disconnectedAt = null;
    this.emptySince = null;
    if (p.isNew) {
      p.isNew = false;
      this.system(`${p.name} joined`, 'join');
    } else {
      // Coming back (refresh, phone lock): restore the chat, including what they missed.
      this.send(pid, 'chatHistory', { messages: p.history });
    }
    this.broadcastState();
    this.sendSync(pid);
  }

  disconnect(pid) {
    const p = this.get(pid);
    if (!p || !p.connected) return;
    p.connected = false;
    p.disconnectedAt = this.now();
    if (this.humansConnected().length === 0) this.emptySince = this.now();
    this.checkAllGuessed();
    this.broadcastState();
  }

  leave(pid) {
    this.removePlayer(pid, 'left');
  }

  removePlayer(pid, why = 'left') {
    const idx = this.players.findIndex((p) => p.id === pid);
    if (idx === -1) return;
    const [p] = this.players.splice(idx, 1);
    // Bots never play on their own: when the last person leaves, the room empties.
    if (!p.bot && !this.players.some((q) => !q.bot)) {
      this.players = [];
      this.hostId = null;
      this.phase = 'lobby';
      this.turn = null;
      this.endsAt = 0;
      if (this.emptySince == null) this.emptySince = this.now();
      return;
    }
    this.system(why === 'timeout' ? `${p.name} disconnected` : `${p.name} left`, 'leave');
    if (this.hostId === pid) this.migrateHost();
    if (this.humansConnected().length === 0 && this.emptySince == null) this.emptySince = this.now();

    if (this.phase !== 'lobby' && this.phase !== 'gameOver' && this.players.length < 2) {
      this.backToLobby('Not enough players left — back to the lobby.');
      return;
    }
    if (this.turn && this.turn.drawerId === pid && (this.phase === 'choosing' || this.phase === 'drawing')) {
      this.endTurn('drawerLeft');
      return;
    }
    this.checkAllGuessed();
    this.broadcastState();
  }

  // Longest-seated connected player becomes host (seat order = join order).
  migrateHost() {
    const next = this.players.find((p) => p.connected && !p.bot && p.id !== this.hostId) || null;
    const fallback = this.players.find((p) => !p.bot && p.id !== this.hostId) || null;
    const chosen = next || (this.get(this.hostId) ? null : fallback);
    if (!chosen) {
      if (!this.get(this.hostId)) this.hostId = null;
      return false;
    }
    this.hostId = chosen.id;
    this.system(`${chosen.name} is now the host`, 'system');
    return true;
  }

  // ---- lobby

  updateSettings(pid, patch = {}) {
    if (pid !== this.hostId) return { error: 'Only the host can change settings.' };
    if (this.phase !== 'lobby') return { error: 'Settings can only be changed in the lobby.' };
    if (!patch || typeof patch !== 'object') return { error: 'Bad settings.' };
    const s = this.settings;
    if (patch.rounds != null) {
      const r = Number(patch.rounds);
      if (Number.isInteger(r) && r >= 2 && r <= 5) s.rounds = r;
    }
    if (patch.drawTime != null) {
      const d = Number(patch.drawTime);
      if (DRAW_TIMES.includes(d)) s.drawTime = d;
    }
    if (patch.pack != null && PACK_IDS.includes(patch.pack)) s.pack = patch.pack;
    let error = null;
    if (patch.customWords != null) {
      this.customWords = parseCustomWords(patch.customWords);
      if (this.customWords.length < 10) {
        error = `Add at least 10 custom words (you have ${this.customWords.length}).`;
      }
    }
    this.broadcastState();
    return error ? { error, customCount: this.customWords.length } : { ok: true, customCount: this.customWords.length };
  }

  start(pid) {
    if (pid !== this.hostId) return { error: 'Only the host can start the game.' };
    if (this.phase !== 'lobby') return { error: 'The game has already started.' };
    if (this.connected().length < 2) return { error: 'You need at least 2 players to start.' };
    if (this.settings.pack === 'custom' && this.customWords.length < 10) {
      return { error: 'Add at least 10 custom words, or pick another word pack.' };
    }
    this.notice = null;
    for (const p of this.players) {
      p.score = 0;
      p.guessed = false;
    }
    this.gallery = [];
    this.usedWords = new Set();
    this.round = 1;
    this.drawOrder = this.players.map((p) => p.id);
    this.turnIndex = -1;
    this.system(`Round 1 of ${this.settings.rounds}`, 'round');
    this.nextTurn();
    return { ok: true };
  }

  playAgain(pid) {
    if (pid !== this.hostId) return { error: 'Only the host can restart.' };
    if (this.phase !== 'gameOver') return { error: 'The game is not over yet.' };
    this.backToLobby(null);
    return { ok: true };
  }

  backToLobby(notice) {
    this.phase = 'lobby';
    this.round = 0;
    this.turn = null;
    this.endsAt = 0;
    this.drawOrder = [];
    this.turnIndex = -1;
    this.notice = notice;
    for (const p of this.players) {
      p.score = 0;
      p.guessed = false;
    }
    if (notice) this.system(notice, 'system');
    this.broadcastState();
  }

  // ---- turns

  drawMs() {
    return this.timing.drawMs || this.settings.drawTime * 1000;
  }

  wordPool(difficulty) {
    if (this.settings.pack === 'custom') return this.customWords;
    const pack = PACKS[this.settings.pack] || PACKS.mixed;
    return pack[difficulty];
  }

  pickWord(pool, exclude) {
    let candidates = pool.filter((w) => !this.usedWords.has(w) && !exclude.has(w));
    if (candidates.length === 0) candidates = pool.filter((w) => !exclude.has(w));
    if (candidates.length === 0) candidates = pool;
    const w = candidates[Math.floor(this.rng() * candidates.length)];
    exclude.add(w);
    return w;
  }

  pickChoices(drawer) {
    const taken = new Set();
    if (drawer && drawer.bot) {
      return ['easy', 'medium', 'hard'].map((difficulty) => ({
        word: this.pickWord(doodleWords(difficulty), taken),
        difficulty,
        mult: MULTIPLIERS[difficulty],
      }));
    }
    const levels = this.settings.pack === 'custom' ? ['medium', 'medium', 'medium'] : ['easy', 'medium', 'hard'];
    return levels.map((difficulty) => ({
      word: this.pickWord(this.wordPool(difficulty), taken),
      difficulty,
      mult: MULTIPLIERS[difficulty],
    }));
  }

  nextTurn() {
    if (this.players.length < 2) {
      this.backToLobby('Not enough players left — back to the lobby.');
      return;
    }
    for (;;) {
      this.turnIndex++;
      if (this.turnIndex >= this.drawOrder.length) {
        if (this.round >= this.settings.rounds) {
          this.gameOver();
          return;
        }
        this.round++;
        this.drawOrder = this.players.map((p) => p.id);
        this.turnIndex = 0;
        this.system(`Round ${this.round} of ${this.settings.rounds}`, 'round');
      }
      const drawer = this.get(this.drawOrder[this.turnIndex]);
      if (drawer) {
        this.startChoosing(drawer);
        return;
      }
    }
  }

  startChoosing(drawer) {
    const now = this.now();
    this.turnId++;
    for (const p of this.players) p.guessed = false;
    this.turn = {
      id: this.turnId,
      drawerId: drawer.id,
      drawerName: drawer.name,
      drawerColor: drawer.color,
      drawerBot: !!drawer.bot,
      choices: this.pickChoices(drawer),
      word: null,
      difficulty: null,
      mult: 1,
      startedAt: now,
      drawStartedAt: null,
      drawEndsAt: null,
      hintTimes: [],
      hintsGiven: 0,
      revealed: new Set(),
      ops: [],
      pointsUsed: 0,
      opsCount: 0,
      limitHit: false,
      points: {},
      correct: 0,
      reason: null,
    };
    this.phase = 'choosing';
    this.phaseMs = this.timing.chooseMs;
    this.endsAt = now + this.timing.chooseMs;
    this.system(`${drawer.name} is choosing a word`, 'turn');
    this.broadcastState();
  }

  chooseWord(pid, index) {
    if (this.phase !== 'choosing' || !this.turn || this.turn.drawerId !== pid) return { error: 'Not your turn to choose.' };
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0 || i >= this.turn.choices.length) return { error: 'Bad choice.' };
    this.startDrawing(this.turn.choices[i]);
    return { ok: true };
  }

  startDrawing(choice) {
    const now = this.now();
    const t = this.turn;
    t.word = choice.word;
    t.difficulty = choice.difficulty;
    t.mult = choice.mult;
    t.drawStartedAt = now;
    t.drawEndsAt = now + this.drawMs();
    t.hintTimes = [now + this.drawMs() * 0.5, now + this.drawMs() * 0.75];
    this.usedWords.add(choice.word);
    this.phase = 'drawing';
    this.phaseMs = this.drawMs();
    this.endsAt = t.drawEndsAt;
    this.planBots(now);
    this.broadcastState();
  }

  // ---- bots

  planBots(now) {
    const t = this.turn;
    const drawer = this.drawer;
    const rng = this.rng;
    if (drawer && drawer.bot && LIBRARY[t.word]) {
      const ops = doodleOps(t.word);
      t.botDraw = {
        ops,
        total: ops.reduce((n, o) => n + (o.t === 's' ? o.p.length / 2 : 20), 0),
        done: 0,
        opIndex: 0,
        pointIndex: 0,
        strokeId: 0,
        startAt: now + 800,
        duration: Math.max(6000, Math.min(15000, this.drawMs() * 0.25)),
      };
    }
    const pool = PACKS.mixed.easy.concat(PACKS.mixed.medium, PACKS.mixed.hard, doodleWords());
    for (const bot of this.players) {
      if (!bot.bot || bot.id === t.drawerId) continue;
      const think = 3000 + (BOT_THINK_EXTRA[t.difficulty] || 2500) + rng() * 9000;
      const willGuess = rng() < (BOT_GUESS_CHANCE[t.difficulty] || 0.8);
      const wrongCount = willGuess ? (rng() < 0.4 ? 0 : rng() < 0.7 ? 1 : 2) : 1 + Math.floor(rng() * 2);
      const wrong = [];
      for (let i = 0; i < wrongCount; i++) {
        let w = null;
        for (let k = 0; k < 20 && !w; k++) {
          const cand = pool[Math.floor(rng() * pool.length)];
          if (checkGuess(cand, t.word) === 'wrong') w = cand;
        }
        if (w) wrong.push({ at: 1200 + rng() * Math.max(1500, think - 1500), text: w, sent: false });
      }
      if (!willGuess && rng() < 0.5) wrong.push({ at: think + 4000, text: BOT_STUMPED[Math.floor(rng() * BOT_STUMPED.length)], sent: false });
      bot.brain = { turnId: t.id, willGuess, think, wrong };
    }
  }

  // Runs every tick: bots choose, draw, guess and react.
  tickBots(now) {
    const t = this.turn;
    if (!t || !this.players.some((p) => p.bot)) return;
    const drawer = this.drawer;

    if (this.phase === 'choosing' && drawer && drawer.bot) {
      if (!t.botChooseAt) t.botChooseAt = t.startedAt + 1200 + this.rng() * 1600;
      if (now >= t.botChooseAt) {
        const r = this.rng();
        this.chooseWord(drawer.id, r < 0.4 ? 0 : r < 0.8 ? 1 : 2);
      }
      return;
    }

    if (this.phase === 'drawing') {
      if (t.botDraw && drawer) this.botDrawStep(drawer.id, now);
      if (!t.inkAt && t.pointsUsed >= BOT_INK_POINTS) t.inkAt = now;
      if (!t.inkAt) return;
      for (const bot of this.players) {
        if (this.phase !== 'drawing') return;
        if (!bot.bot || bot.id === t.drawerId || bot.guessed || !bot.brain || bot.brain.turnId !== t.id) continue;
        const since = now - t.inkAt;
        for (const w of bot.brain.wrong) {
          if (!w.sent && since >= w.at) {
            w.sent = true;
            this.chat(bot.id, w.text);
          }
        }
        if (bot.brain.willGuess && since >= bot.brain.think && now - t.drawStartedAt >= 4000) this.chat(bot.id, t.word);
      }
      return;
    }

    if (this.phase === 'reveal' && !t.botReacted && now >= this.endsAt - this.timing.revealMs + 1200) {
      t.botReacted = true;
      const bots = this.players.filter((p) => p.bot);
      if (bots.length && this.rng() < 0.45) {
        const bot = bots[Math.floor(this.rng() * bots.length)];
        const lines = t.correct === 0 && t.word ? BOT_STUMPED : BOT_REACTIONS;
        this.chat(bot.id, lines[Math.floor(this.rng() * lines.length)]);
      }
    }
  }

  // Stream the bot's doodle like a person drawing: strokes begin, extend in chunks, end.
  botDrawStep(botId, now) {
    const bd = this.turn.botDraw;
    const progress = Math.max(0, Math.min(1, (now - bd.startAt) / bd.duration));
    const target = Math.floor(progress * bd.total);
    let budget = 6;
    while (bd.done < target && bd.opIndex < bd.ops.length && budget-- > 0) {
      const op = bd.ops[bd.opIndex];
      if (op.t === 'f') {
        this.draw(botId, { t: 'f', x: op.x, y: op.y, c: op.c });
        bd.done += 20;
        bd.opIndex++;
        continue;
      }
      const n = op.p.length / 2;
      const upto = Math.min(n, bd.pointIndex + Math.max(1, target - bd.done), bd.pointIndex + 120);
      const chunk = op.p.slice(bd.pointIndex * 2, upto * 2);
      if (bd.pointIndex === 0) {
        bd.strokeId++;
        this.draw(botId, { t: 'b', id: bd.strokeId, c: op.c, s: op.s, p: chunk });
      } else {
        this.draw(botId, { t: 'e', id: bd.strokeId, p: chunk });
      }
      bd.done += upto - bd.pointIndex;
      bd.pointIndex = upto;
      if (upto >= n) {
        this.draw(botId, { t: 'x', id: bd.strokeId });
        bd.opIndex++;
        bd.pointIndex = 0;
      }
    }
  }

  revealHint() {
    const t = this.turn;
    if (!t || !t.word) return false;
    if (t.revealed.size >= maxHints(t.word)) return false;
    const hidden = [];
    Array.from(t.word).forEach((ch, i) => {
      if (isLetter(ch) && !t.revealed.has(i)) hidden.push(i);
    });
    if (!hidden.length) return false;
    t.revealed.add(hidden[Math.floor(this.rng() * hidden.length)]);
    return true;
  }

  checkAllGuessed() {
    if (this.phase !== 'drawing' || !this.turn) return false;
    const guessers = this.players.filter((p) => p.id !== this.turn.drawerId && p.connected);
    const anyGuessed = this.players.some((p) => p.guessed);
    if (anyGuessed && guessers.every((p) => p.guessed)) {
      this.endTurn('allGuessed');
      return true;
    }
    return false;
  }

  endTurn(reason) {
    if (this.phase !== 'choosing' && this.phase !== 'drawing') return;
    const t = this.turn;
    t.reason = reason;
    if (t.word) {
      const lastClear = t.ops.map((o) => o.t).lastIndexOf('c');
      const ops = t.ops.slice(lastClear + 1).map(wireOp).filter((o) => o.t !== 'c');
      if (ops.length) {
        this.gallery.push({
          word: t.word,
          difficulty: t.difficulty,
          round: this.round,
          drawerId: t.drawerId,
          drawerName: t.drawerName,
          drawerColor: t.drawerColor,
          drawerBot: t.drawerBot,
          guessedCount: t.correct,
          ops,
        });
      }
    }
    this.phase = 'reveal';
    this.phaseMs = this.timing.revealMs;
    this.endsAt = this.now() + this.timing.revealMs;
    // State first, so every client is in the reveal phase before the word shows up in chat.
    this.broadcastState();
    if (t.word) this.system(`The word was “${t.word}”`, 'reveal');
    else if (reason === 'drawerLeft') this.system(`${t.drawerName} left — skipping their turn`, 'system');
  }

  gameOver() {
    this.phase = 'gameOver';
    this.turn = null;
    this.endsAt = 0;
    this.system('Game over!', 'round');
    this.broadcastState();
    for (const p of this.connected()) this.send(p.id, 'gallery', this.galleryPayload());
  }

  galleryPayload() {
    return { drawings: this.gallery };
  }

  // ---- chat & guessing

  rateLimited(p, key, perSec) {
    const now = this.now();
    p[key] = p[key].filter((t) => now - t < 1000);
    if (p[key].length >= perSec) return true;
    p[key].push(now);
    return false;
  }

  chat(pid, raw) {
    const p = this.get(pid);
    if (!p) return { error: 'Not in room.' };
    const text = sanitizeChat(raw);
    if (!text) return { error: 'Empty message.' };
    if (!p.bot && this.rateLimited(p, 'chatTimes', CHAT_PER_SEC)) return { error: 'Slow down!' };
    const msg = { name: p.name, color: p.color, from: p.id, text };
    const t = this.turn;
    const inTurn = this.phase === 'choosing' || this.phase === 'drawing';

    if (inTurn && (t.drawerId === pid || p.guessed)) {
      // Private channel: drawer + players who already guessed.
      for (const q of this.players) {
        if (q.id === t.drawerId || q.guessed) this.sendChat(q.id, { ...msg, kind: 'private' });
      }
      return { ok: true };
    }

    if (this.phase === 'drawing' && t.word) {
      const result = checkGuess(text, t.word);
      if (result === 'correct') {
        this.correctGuess(p);
        return { ok: true, correct: true };
      }
      if (result === 'close') {
        this.sendChat(pid, { ...msg, kind: 'close' });
        return { ok: true, close: true };
      }
      if (result === 'contains') {
        // Contains the answer but isn't it — show it only to the sender so it can't leak.
        this.sendChat(pid, { ...msg, kind: 'chat', onlyYou: true });
        return { ok: true };
      }
    }
    for (const q of this.players) this.sendChat(q.id, { ...msg, kind: 'chat' });
    return { ok: true };
  }

  correctGuess(p) {
    const t = this.turn;
    const now = this.now();
    const pts = guesserPoints(t.drawEndsAt - now, this.drawMs(), t.mult);
    p.guessed = true;
    p.score += pts;
    t.points[p.id] = (t.points[p.id] || 0) + pts;
    t.correct++;
    const drawer = this.drawer;
    if (drawer) {
      const dp = drawerPoints(1, t.mult);
      drawer.score += dp;
      t.points[drawer.id] = (t.points[drawer.id] || 0) + dp;
    }
    this.sendChat(p.id, { kind: 'you-correct', text: t.word, points: pts, from: p.id, name: p.name, color: p.color });
    for (const q of this.players) {
      if (q.id !== p.id) this.sendChat(q.id, { kind: 'correct', from: p.id, name: p.name, color: p.color, text: `${p.name} guessed it!` });
    }
    if (!this.checkAllGuessed()) this.broadcastState();
  }

  // Every chat line is kept in the recipient's history (even while they're away) and sent
  // live if they're connected.
  sendChat(pid, msg) {
    const m = { id: ++this.msgSeq, ...msg };
    const p = this.get(pid);
    if (!p || p.bot) return;
    p.history.push(m);
    if (p.history.length > CHAT_HISTORY) p.history.splice(0, p.history.length - CHAT_HISTORY);
    if (p.connected) this.send(pid, 'chat', m);
  }

  system(text, kind = 'system') {
    for (const q of this.players) this.sendChat(q.id, { kind: 'system', sub: kind, text });
  }

  // ---- drawing

  draw(pid, op) {
    if (this.phase !== 'drawing' || !this.turn || this.turn.drawerId !== pid) return false;
    if (!op || typeof op !== 'object') return false;
    const p = this.get(pid);
    if (!p || (!p.bot && this.rateLimited(p, 'drawTimes', DRAW_MSGS_PER_SEC))) return false;
    const t = this.turn;
    let out = null;
    switch (op.t) {
      case 'b': {
        const id = toInt(op.id);
        const c = toInt(op.c);
        const s = toInt(op.s);
        const pts = sanitizePoints(op.p);
        if (id == null || c == null || c < 0 || c >= PALETTE_SIZE || !BRUSH_SIZES.includes(s) || !pts || !pts.length) return false;
        if (!this.spend(pid, pts.length / 2, 1)) return false;
        t.ops.push({ t: 's', id, c, s, p: pts, open: true });
        out = { t: 'b', id, c, s, p: pts };
        break;
      }
      case 'e': {
        const id = toInt(op.id);
        const pts = sanitizePoints(op.p);
        if (id == null || !pts || !pts.length) return false;
        const stroke = findOpenStroke(t.ops, id);
        if (!stroke) return false;
        if (!this.spend(pid, pts.length / 2, 0)) return false;
        for (const v of pts) stroke.p.push(v);
        out = { t: 'e', id, p: pts };
        break;
      }
      case 'x': {
        const id = toInt(op.id);
        const stroke = findOpenStroke(t.ops, id);
        if (!stroke) return false;
        stroke.open = false;
        out = { t: 'x', id };
        break;
      }
      case 'f': {
        const x = toInt(op.x);
        const y = toInt(op.y);
        const c = toInt(op.c);
        if (x == null || y == null || x < 0 || y < 0 || x >= CANVAS_W || y >= CANVAS_H) return false;
        if (c == null || c < 0 || c >= PALETTE_SIZE) return false;
        if (!this.spend(pid, 0, 1)) return false;
        t.ops.push({ t: 'f', x, y, c });
        out = { t: 'f', x, y, c };
        break;
      }
      case 'u': {
        if (!t.ops.length) return false;
        t.ops.pop();
        out = { t: 'u' };
        break;
      }
      case 'c': {
        if (!this.spend(pid, 0, 1)) return false;
        t.ops.push({ t: 'c' });
        out = { t: 'c' };
        break;
      }
      default:
        return false;
    }
    for (const q of this.players) {
      if (q.connected && !q.bot && q.id !== pid) this.send(q.id, 'draw', out);
    }
    return true;
  }

  spend(pid, points, ops) {
    const t = this.turn;
    if (t.pointsUsed + points > MAX_POINTS_PER_TURN || t.opsCount + ops > MAX_OPS_PER_TURN) {
      if (!t.limitHit) {
        t.limitHit = true;
        this.send(pid, 'drawLimit', { message: 'Ink limit reached for this turn!' });
      }
      return false;
    }
    t.pointsUsed += points;
    t.opsCount += ops;
    return true;
  }

  sendSync(pid) {
    const p = this.get(pid);
    if (!p || !p.connected) return;
    if (this.turn && (this.phase === 'drawing' || this.phase === 'reveal')) {
      this.send(pid, 'drawSync', { turnId: this.turn.id, ops: this.turn.ops.map(wireOp) });
    }
    if (this.phase === 'gameOver') this.send(pid, 'gallery', this.galleryPayload());
  }

  // ---- views

  viewFor(pid) {
    const me = this.get(pid);
    const t = this.turn;
    const isDrawer = !!(t && t.drawerId === pid);
    const revealed = this.phase === 'reveal';
    const knowsWord = !!(t && t.word && (isDrawer || (me && me.guessed) || revealed));
    const view = {
      code: this.code,
      me: pid,
      hostId: this.hostId,
      phase: this.phase,
      round: this.round,
      rounds: this.settings.rounds,
      settings: {
        rounds: this.settings.rounds,
        drawTime: this.settings.drawTime,
        pack: this.settings.pack,
        customCount: this.customWords.length,
      },
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        score: p.score,
        connected: p.connected,
        guessed: p.guessed,
        bot: !!p.bot,
      })),
      endsAt: this.endsAt,
      phaseMs: this.endsAt ? this.phaseMs : 0,
      serverNow: this.now(),
      notice: this.notice,
      turn: null,
    };
    // Only the host gets the custom word list back, and only while in the lobby.
    if (pid === this.hostId && this.phase === 'lobby') view.customWords = this.customWords.join(', ');
    if (t && this.phase !== 'lobby' && this.phase !== 'gameOver') {
      view.turn = {
        id: t.id,
        drawerId: t.drawerId,
        drawTimeMs: this.drawMs(),
        difficulty: t.difficulty,
        mult: t.word ? t.mult : null,
        word: knowsWord ? t.word : null,
        mask: t.word && !knowsWord ? buildMask(t.word, t.revealed) : null,
        choices: isDrawer && this.phase === 'choosing' ? t.choices : null,
      };
      if (revealed) {
        view.turn.reason = t.reason;
        view.turn.points = t.points;
        view.turn.nextDrawerName = this.peekNextDrawerName();
      }
    }
    return view;
  }

  peekNextDrawerName() {
    for (let i = this.turnIndex + 1; i < this.drawOrder.length; i++) {
      const p = this.get(this.drawOrder[i]);
      if (p) return p.name;
    }
    if (this.round < this.settings.rounds && this.players.length) return this.players[0].name;
    return null;
  }

  broadcastState() {
    for (const p of this.players) {
      if (p.connected && !p.bot) this.send(p.id, 'state', this.viewFor(p.id));
    }
  }

  // ---- clock

  tick() {
    const now = this.now();
    const T = this.timing;

    for (const p of [...this.players]) {
      if (!p.connected && p.disconnectedAt != null && now - p.disconnectedAt >= T.seatHoldMs) {
        this.removePlayer(p.id, 'timeout');
      }
    }

    const host = this.get(this.hostId);
    if (host && !host.connected && now - host.disconnectedAt >= T.hostGraceMs) {
      if (this.migrateHost()) this.broadcastState();
    }

    if (this.phase === 'choosing' || this.phase === 'drawing') {
      const d = this.drawer;
      if (d && !d.connected) {
        const goneSince = Math.max(d.disconnectedAt, this.turn.startedAt);
        if (now - goneSince >= T.drawerGraceMs) {
          this.endTurn('drawerLeft');
          return;
        }
      }
    }

    if (this.phase === 'choosing' && now >= this.endsAt) {
      const choices = this.turn.choices;
      this.startDrawing(choices[Math.floor(this.rng() * choices.length)]);
    } else if (this.phase === 'drawing') {
      const t = this.turn;
      let hinted = false;
      while (t.hintsGiven < t.hintTimes.length && now >= t.hintTimes[t.hintsGiven]) {
        if (this.revealHint()) hinted = true;
        t.hintsGiven++;
      }
      if (now >= this.endsAt) this.endTurn('timeout');
      else if (hinted) this.broadcastState();
    } else if (this.phase === 'reveal' && now >= this.endsAt) {
      this.nextTurn();
    }
    this.tickBots(this.now());
  }
}

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function sanitizePoints(p) {
  if (!Array.isArray(p) || p.length === 0 || p.length % 2 !== 0 || p.length > MAX_POINTS_PER_MSG * 2) return null;
  const out = new Array(p.length);
  for (let i = 0; i < p.length; i += 2) {
    const x = Number(p[i]);
    const y = Number(p[i + 1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    out[i] = Math.max(0, Math.min(CANVAS_W - 1, Math.round(x)));
    out[i + 1] = Math.max(0, Math.min(CANVAS_H - 1, Math.round(y)));
  }
  return out;
}

function findOpenStroke(ops, id) {
  for (let i = ops.length - 1; i >= 0; i--) {
    const o = ops[i];
    if (o.t === 's' && o.id === id) return o.open ? o : null;
  }
  return null;
}

function wireOp(o) {
  if (o.t === 's') return { t: 's', id: o.id, c: o.c, s: o.s, p: o.p.slice() };
  if (o.t === 'f') return { t: 'f', x: o.x, y: o.y, c: o.c };
  return { t: o.t };
}

// ---------------------------------------------------------------------------
// Room manager: codes, seats by token, garbage collection.

class RoomManager {
  constructor(opts = {}) {
    this.opts = opts;
    this.now = opts.now || Date.now;
    this.rng = opts.rng || Math.random;
    this.timing = { ...DEFAULT_TIMING, ...(opts.timing || {}) };
    this.rooms = new Map();
  }

  newCode() {
    for (let attempt = 0; attempt < 1000; attempt++) {
      let code = '';
      for (let i = 0; i < 4; i++) code += CODE_ALPHABET[Math.floor(this.rng() * CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('No free room codes');
  }

  getRoom(code) {
    return this.rooms.get(normalizeCode(code)) || null;
  }

  createRoom(token, name) {
    if (!sanitizeName(name)) return { error: 'Please enter a name (1–16 characters).' };
    if (!validToken(token)) return { error: 'Bad session token. Please reload the page.' };
    const code = this.newCode();
    const room = new Room(code, { ...this.opts, timing: this.timing });
    const res = room.addPlayer(token, name);
    if (res.error) return res;
    this.rooms.set(code, room);
    return { room, player: res.player };
  }

  // Join by code. If this token already has a seat in the room, it's a rejoin of the same seat.
  join(code, token, name) {
    code = normalizeCode(code);
    if (!validCode(code)) return { error: 'Room codes are 4 letters.' };
    const room = this.rooms.get(code);
    if (!room) return { error: `Room ${code} not found. Check the code?` };
    const existing = validToken(token) ? room.byToken(token) : null;
    if (existing) return { room, player: existing, resumed: true };
    const res = room.addPlayer(token, name);
    if (res.error) return res;
    return { room, player: res.player, resumed: false };
  }

  resume(code, token) {
    const room = this.getRoom(code);
    if (!room) return { error: 'That room has closed.' };
    const player = validToken(token) ? room.byToken(token) : null;
    if (!player) return { error: 'Your seat expired. Join again?' };
    return { room, player };
  }

  tick() {
    const now = this.now();
    for (const [code, room] of this.rooms) {
      room.tick();
      if (room.humansConnected().length === 0) {
        if (room.emptySince == null) room.emptySince = now;
        if (now - room.emptySince >= this.timing.roomIdleMs) this.rooms.delete(code);
      } else {
        room.emptySince = null;
      }
    }
  }
}

module.exports = {
  Room,
  RoomManager,
  normalizeGuess,
  guessKey,
  levenshtein,
  checkGuess,
  letterCount,
  maxHints,
  buildMask,
  guesserPoints,
  drawerPoints,
  sanitizeName,
  normalizeCode,
  validCode,
  CODE_ALPHABET,
  MAX_PLAYERS,
  DEFAULT_TIMING,
  BRUSH_SIZES,
  CANVAS_W,
  CANVAS_H,
  MAX_POINTS_PER_TURN,
};
