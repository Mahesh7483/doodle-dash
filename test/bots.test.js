'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');
const { LIBRARY, doodleOps, doodleWords } = require('../server/doodles');

test('host adds and removes bots in the lobby; bots fill seats like players', () => {
  const env = setup({ players: 2 });
  const { room, ids } = env;
  assert.equal(room.addBot(ids[1]).error, 'Only the host can add bots.');
  const a = room.addBot(ids[0]);
  const b = room.addBot(ids[0]);
  assert.ok(a.ok && b.ok);
  const view = env.lastState(ids[1]);
  const bots = view.players.filter((p) => p.bot);
  assert.equal(bots.length, 2);
  assert.notEqual(bots[0].name, bots[1].name);
  assert.ok(bots.every((p) => p.connected));
  for (let i = 0; i < 4; i++) room.addBot(ids[0]);
  assert.equal(room.players.length, 8);
  assert.equal(room.addBot(ids[0]).error, 'Room is full');
  assert.equal(room.removeBot(ids[1], a.id).error, 'Only the host can remove bots.');
  assert.ok(room.removeBot(ids[0], a.id).ok);
  assert.equal(room.players.length, 7);
  assert.equal(room.removeBot(ids[0], ids[1]).error, 'No such bot.', 'cannot remove people this way');
});

test('a bot never becomes host; the room empties when the last person leaves', () => {
  const env = setup({ players: 2 });
  const { room, ids, manager } = env;
  room.addBot(ids[0]);
  room.addBot(ids[0]);
  room.leave(ids[0]);
  assert.equal(room.hostId, ids[1], 'host goes to the remaining person, not a bot');
  room.leave(ids[1]);
  assert.equal(room.players.length, 0, 'bots leave with the last person');
  env.run(31 * 60 * 1000, 60000);
  assert.equal(manager.getRoom(room.code), null, 'empty room is garbage-collected');
});

test('every doodle is valid drawing data the server accepts', () => {
  const words = doodleWords();
  assert.ok(words.length >= 18);
  for (const d of ['easy', 'medium', 'hard']) assert.ok(doodleWords(d).length >= 4, d);
  for (const w of words) {
    const ops = doodleOps(w);
    let points = 0;
    for (const o of ops) {
      if (o.t === 's') {
        assert.ok([4, 10, 24, 48].includes(o.s), `${w}: size ${o.s}`);
        assert.ok(o.c >= 0 && o.c < 12);
        assert.ok(o.p.length >= 2 && o.p.length % 2 === 0);
        for (let i = 0; i < o.p.length; i += 2) assert.ok(o.p[i] >= 0 && o.p[i] < 800 && o.p[i + 1] >= 0 && o.p[i + 1] < 600);
        points += o.p.length / 2;
      } else {
        assert.equal(o.t, 'f');
      }
    }
    assert.ok(points > 100 && points < 5000, `${w}: ${points} points`);
    assert.match(w, /^[a-z]+( [a-z]+)*$/);
    assert.ok(['easy', 'medium', 'hard'].includes(LIBRARY[w]));
  }
});

test('solo game: one person + a bot plays to the end; the bot draws and guesses', () => {
  const env = setup({ players: 1 });
  const { room, ids, sent } = env;
  const me = ids[0];
  assert.equal(room.start(me).error, 'You need at least 2 players to start.');
  const { id: botId } = room.addBot(me);
  room.updateSettings(me, { rounds: 2 });
  assert.ok(room.start(me).ok);

  let myTurns = 0;
  let botTurns = 0;
  let botGuessed = 0;
  let lastTurn = null;
  let guard = 0;
  while (room.phase !== 'gameOver' && guard++ < 5000) {
    const t = room.turn;
    if (t && t.id !== lastTurn && room.phase === 'choosing') {
      lastTurn = t.id;
      if (t.drawerId === me) {
        myTurns++;
        room.chooseWord(me, 0);
        // Nothing drawn yet: the bot must not guess a blank canvas.
        env.run(8000);
        assert.equal(room.get(botId).guessed, false, 'bot waits for some ink');
        for (let i = 0; i < 8; i++) room.draw(me, { t: 'b', id: i + 1, c: 0, s: 10, p: Array.from({ length: 20 }, (_, k) => 100 + i * 20 + k) });
        const inkAt = env.now;
        while (room.phase === 'drawing') env.run(100, 100);
        if (room.turn.correct) {
          botGuessed++;
          assert.ok(room.turn.points[botId] > 0, 'bot scored');
          assert.ok(room.turn.points[me] > 0, 'I scored as the drawer');
          assert.equal(room.turn.reason, 'allGuessed', 'the bot guessing ends my turn early');
        }
        assert.ok(env.now - inkAt >= 3000, 'bot takes a moment to guess');
      } else {
        botTurns++;
        assert.equal(t.drawerId, botId);
        for (const c of t.choices) assert.ok(LIBRARY[c.word], `bot choice "${c.word}" has a doodle`);
        // The bot picks within a few seconds, then draws its doodle stroke by stroke.
        env.run(3500);
        assert.equal(room.phase, 'drawing');
        const before = sent.filter((m) => m.pid === me && m.event === 'draw').length;
        env.run(4000);
        const mid = sent.filter((m) => m.pid === me && m.event === 'draw').length;
        assert.ok(mid > before, 'strokes stream in');
        env.run(20000);
        room.chat(me, room.turn.word);
        assert.ok(room.turn.points[me] > 0 || room.phase !== 'drawing');
      }
    }
    env.run(100, 100);
  }
  assert.equal(room.phase, 'gameOver');
  assert.equal(myTurns, 2);
  assert.equal(botTurns, 2);
  assert.ok(botGuessed >= 1, 'the bot guessed my drawing');
  const gallery = sent.filter((m) => m.pid === me && m.event === 'gallery').at(-1).data.drawings;
  const botDrawings = gallery.filter((d) => d.drawerId === botId);
  assert.equal(botDrawings.length, 2);
  for (const d of botDrawings) {
    const original = doodleOps(d.word).filter((o) => o.t !== 'c');
    assert.equal(d.ops.length, original.length, `${d.word}: whole doodle drawn`);
  }
  assert.ok(room.get(me).score > 0);
  // After the game the bot likes one of my drawings.
  env.run(12000);
  const likes = sent.filter((m) => m.pid === me && m.event === 'likes').at(-1);
  assert.ok(likes && likes.data.counts.some((n) => n > 0), 'bot liked a drawing');
  gallery.forEach((d, i) => {
    if (d.drawerId === botId) assert.equal(likes.data.counts[i], 0, 'bots never like their own drawings');
  });
});

test('bots talk in chat but never leak the word or spam', () => {
  const env = setup({ players: 1, seed: 11 });
  const { room, ids, sent } = env;
  const me = ids[0];
  room.addBot(me);
  room.addBot(me);
  room.updateSettings(me, { rounds: 2 });
  room.start(me);
  let guard = 0;
  while (room.phase !== 'gameOver' && guard++ < 20000) {
    const t = room.turn;
    if (room.phase === 'choosing' && t.drawerId === me) room.chooseWord(me, 1);
    if (room.phase === 'drawing' && t.drawerId === me && t.pointsUsed < 100) {
      room.draw(me, { t: 'b', id: 1, c: 0, s: 10, p: Array.from({ length: 240 }, (_, k) => 50 + (k % 200)) });
    }
    if (room.phase === 'drawing' && t.drawerId !== me) {
      // While I haven't guessed, nothing the bots say may contain the word.
      const word = t.word.toLowerCase();
      for (const m of sent.filter((x) => x.pid === me && x.event === 'chat' && x.data.from !== me)) {
        if (m.checked) continue;
        m.checked = true;
        if (room.phase === 'drawing' && !room.get(me).guessed) assert.ok(!String(m.data.text).toLowerCase().includes(word), m.data.text);
      }
    }
    env.run(100, 100);
  }
  assert.equal(room.phase, 'gameOver');
  const botChat = sent.filter((m) => m.pid === me && m.event === 'chat' && m.data.kind === 'chat' && room.players.find((p) => p.id === m.data.from && p.bot));
  assert.ok(botChat.length >= 2, 'bots say something');
  const botReactions = sent.filter((m) => m.pid === me && m.event === 'reaction' && room.players.find((p) => p.id === m.data.from && p.bot));
  assert.ok(botReactions.length >= 1, 'bots react to drawings');
  assert.ok(botChat.length < 60, `not spammy (${botChat.length} lines)`);
});
