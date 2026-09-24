'use strict';

const { RoomManager } = require('../server/game');

// Small deterministic PRNG so tests are repeatable.
function mulberry32(seed) {
  return function rng() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Builds a room with a fake clock and records every payload sent to every player.
function setup({ players = 3, timing = {}, seed = 7 } = {}) {
  let now = 1_700_000_000_000;
  const sent = [];
  const manager = new RoomManager({
    now: () => now,
    rng: mulberry32(seed),
    send: (pid, event, data) => sent.push({ pid, event, data: JSON.parse(JSON.stringify(data ?? null)) }),
    timing,
  });
  const created = manager.createRoom('token-player-0', 'Player 0');
  const room = created.room;
  room.connect(created.player.id);
  const ids = [created.player.id];
  for (let i = 1; i < players; i++) ids.push(join(manager, room.code, `token-player-${i}`, `Player ${i}`).id);

  return {
    manager,
    room,
    ids,
    sent,
    get now() {
      return now;
    },
    advance(ms) {
      now += ms;
      manager.tick();
    },
    // Advance in small steps so each tick sees one change at a time.
    run(ms, step = 100) {
      for (let t = 0; t < ms; t += step) {
        now += Math.min(step, ms - t);
        manager.tick();
      }
    },
    join(token, name) {
      return join(manager, room.code, token, name);
    },
    lastState(pid) {
      for (let i = sent.length - 1; i >= 0; i--) if (sent[i].pid === pid && sent[i].event === 'state') return sent[i].data;
      return null;
    },
    chats(pid) {
      return sent.filter((m) => m.pid === pid && m.event === 'chat').map((m) => m.data);
    },
  };
}

function join(manager, code, token, name) {
  const res = manager.join(code, token, name);
  if (res.error) throw new Error(res.error);
  res.room.connect(res.player.id);
  return res.player;
}

// Start a game and make the current drawer pick a word of the given difficulty.
function startAndChoose(env, difficulty = 'easy') {
  const { room, ids } = env;
  const r = room.start(ids[0]);
  if (r.error) throw new Error(r.error);
  return chooseDifficulty(env, difficulty);
}

function chooseDifficulty(env, difficulty = 'easy') {
  const { room } = env;
  const idx = room.turn.choices.findIndex((c) => c.difficulty === difficulty);
  const res = room.chooseWord(room.turn.drawerId, idx === -1 ? 0 : idx);
  if (res.error) throw new Error(res.error);
  return room.turn.word;
}

module.exports = { setup, mulberry32, startAndChoose, chooseDifficulty };
