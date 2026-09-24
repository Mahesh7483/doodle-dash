'use strict';

// SPEC 7.2: during choosing/drawing, no payload sent to a guesser contains the word.
// A guesser may only learn the word after they guess it themselves, or at reveal.

const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, mulberry32 } = require('./helpers');

// Fixed-vocabulary fields (enums and ids) can't carry the word, and would cause false
// positives ("hat" is inside "chat"). Every other string is checked, and masks are joined
// into one string so a fully revealed mask would count as a leak too.
const ENUM_KEYS = new Set(['kind', 'sub', 'color', 'id', 'from', 'me', 'hostId', 'drawerId', 'code', 'pack', 'phase', 'reason', 'difficulty', 't']);

function textValues(v, out = [], key = '') {
  if (typeof v === 'string') {
    if (!ENUM_KEYS.has(key)) out.push(v);
  } else if (Array.isArray(v)) {
    if (v.length && v.every((c) => c === null || (typeof c === 'string' && c.length === 1))) {
      out.push(v.map((c) => (c === null ? '_' : c)).join(''));
    } else {
      for (const x of v) textValues(x, out, key);
    }
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) textValues(x, out, k);
  }
  return out;
}

// Whole-word match, so "sing" doesn't match "choosing" but "it is a sing!" or "_sing" would.
function wordIn(payload, word) {
  const escaped = word.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|[^\\p{L}])${escaped}($|[^\\p{L}])`, 'iu');
  return textValues(payload).some((s) => re.test(s));
}

// Play a full game with random chatter, drawing, near-misses, hints, reconnects and a late
// joiner, checking every payload each guesser receives while they don't know the word.
function playAndCheck(seed) {
  const env = setup({ players: 4, seed });
  const { room, ids, sent } = env;
  const rnd = mulberry32(seed * 31 + 1);
  room.updateSettings(ids[0], { rounds: 2 });
  room.start(ids[0]);
  let checked = 0;
  let late = null;

  const check = (from) => {
    const t = room.turn;
    const inTurn = room.phase === 'choosing' || room.phase === 'drawing';
    const words = inTurn ? t.choices.map((c) => c.word) : [];
    for (let i = from; i < sent.length; i++) {
      const m = sent[i];
      if (!m.inTurn) continue;
      if (m.pid === m.drawerId) continue;
      for (const w of m.secret) {
        if (m.guessedBefore) continue;
        if (m.event === 'chat' && m.data.kind === 'you-correct') continue; // they just typed it
        if (m.event === 'chat' && m.data.from === m.pid) continue; // their own message echoed back
        assert.ok(!wordIn(m.data, w), `seed ${seed}: "${w}" leaked to ${m.pid} in ${m.event}: ${JSON.stringify(m.data)}`);
        checked++;
      }
    }
    return words;
  };

  // Tag every message with the turn context at send time.
  const origSend = room.send;
  room.send = (pid, event, data) => {
    const t = room.turn;
    const inTurn = room.phase === 'choosing' || room.phase === 'drawing';
    const p = room.get(pid);
    origSend(pid, event, data);
    const m = sent[sent.length - 1];
    m.inTurn = inTurn;
    m.drawerId = t && t.drawerId;
    m.guessedBefore = !!(p && p.guessed && event !== 'chat');
    if (event === 'chat' && data.kind === 'you-correct') m.guessedBefore = true;
    if (p && p.guessed && event === 'chat' && data.kind === 'private') m.guessedBefore = true;
    m.secret = inTurn && t ? (t.word ? [t.word] : t.choices.map((c) => c.word)) : [];
  };

  let cursor = 0;
  let guard = 0;
  while (room.phase !== 'gameOver' && guard++ < 5000) {
    const t = room.turn;
    const guessers = room.players.filter((p) => p.id !== t.drawerId);
    if (room.phase === 'choosing' && rnd() < 0.5) room.chooseWord(t.drawerId, Math.floor(rnd() * 3));
    if (room.phase === 'drawing') {
      const g = guessers[Math.floor(rnd() * guessers.length)];
      const r = rnd();
      const w = t.word;
      if (r < 0.1) room.chat(g.id, w.toUpperCase());
      else if (r < 0.25) room.chat(g.id, w.slice(0, -1)); // near miss
      else if (r < 0.35) room.chat(g.id, `is it ${w}?`); // contains the word
      else if (r < 0.5) room.chat(g.id, 'hmm');
      else if (r < 0.6) room.chat(t.drawerId, `it is a ${w}`); // drawer leaking in private chat
      else if (r < 0.7) room.draw(t.drawerId, { t: 'b', id: Math.floor(rnd() * 1e6), c: 1, s: 10, p: [1, 2, 3, 4] });
      else if (r < 0.75) {
        room.disconnect(g.id);
        room.connect(g.id);
      } else if (r < 0.77 && !late) {
        late = env.join(`token-late-${seed}`, 'Late');
      }
    }
    env.advance(700 + Math.floor(rnd() * 1500));
    check(cursor);
    cursor = sent.length;
  }
  assert.equal(room.phase, 'gameOver');
  return checked;
}

test('the word never reaches a guesser before they guess it or the reveal', () => {
  let checked = 0;
  for (let seed = 1; seed <= 25; seed++) checked += playAndCheck(seed);
  assert.ok(checked > 1000, `checked ${checked} payloads`);
});

test('word choices go only to the drawer', () => {
  const env = setup({ players: 3 });
  const { room, ids, sent } = env;
  room.start(ids[0]);
  const choices = room.turn.choices.map((c) => c.word);
  const toGuessers = sent.filter((m) => m.pid !== ids[0]);
  for (const w of choices) assert.ok(!toGuessers.some((m) => wordIn(m.data, w)), `choice "${w}" leaked`);
  assert.deepEqual(env.lastState(ids[0]).turn.choices.map((c) => c.word), choices);
  assert.equal(env.lastState(ids[1]).turn.choices, null);
});

test('guessers only ever get the mask during drawing', () => {
  const env = setup({ players: 2 });
  const { room, ids } = env;
  room.start(ids[0]);
  room.chooseWord(ids[0], 2);
  const st = env.lastState(ids[1]);
  assert.equal(st.turn.word, null);
  assert.equal(st.turn.mask.length, Array.from(room.turn.word).length);
  assert.equal(env.lastState(ids[0]).turn.word, room.turn.word);
});
