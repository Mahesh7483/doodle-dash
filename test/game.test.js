'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeGuess,
  checkGuess,
  guesserPoints,
  drawerPoints,
  buildMask,
  maxHints,
  levenshtein,
  sanitizeName,
  CODE_ALPHABET,
} = require('../server/game');
const { PACKS, PACK_IDS, parseCustomWords } = require('../server/words');
const { setup, startAndChoose, chooseDifficulty } = require('./helpers');

// ---------------------------------------------------------------------------
// Scoring

test('guesser points: 300 at full time, 100 at zero, times the multiplier', () => {
  assert.equal(guesserPoints(80000, 80000, 1), 300);
  assert.equal(guesserPoints(0, 80000, 1), 100);
  assert.equal(guesserPoints(40000, 80000, 1), 200);
  assert.equal(guesserPoints(40000, 80000, 1.5), 300);
  assert.equal(guesserPoints(40000, 80000, 2), 400);
  assert.equal(guesserPoints(-500, 80000, 2), 200, 'negative time left clamps to 0');
  assert.equal(guesserPoints(61000, 60000, 1), 300, 'time left above draw time clamps');
  // round((100 + 200 * 33/80) * 1.5) = round(273.75) = 274
  assert.equal(guesserPoints(33000, 80000, 1.5), 274);
});

test('drawer points: 50 per correct guesser times the multiplier, 0 if nobody guessed', () => {
  assert.equal(drawerPoints(0, 2), 0);
  assert.equal(drawerPoints(3, 1), 150);
  assert.equal(drawerPoints(3, 1.5), 225);
  assert.equal(drawerPoints(2, 2), 200);
});

test('in-game scoring applies the chosen difficulty multiplier to guessers and drawer', () => {
  const env = setup({ players: 3 });
  const { room, ids } = env;
  room.start(ids[0]);
  const drawerId = room.turn.drawerId;
  assert.equal(drawerId, ids[0], 'first seat draws first');
  const word = chooseDifficulty(env, 'hard');
  assert.equal(room.turn.mult, 2);

  env.advance(20000); // 60 s of 80 s left
  room.chat(ids[1], word.toUpperCase());
  assert.equal(room.get(ids[1]).score, Math.round((100 + 200 * 60 / 80) * 2)); // 500
  assert.equal(room.get(drawerId).score, 100);

  env.advance(40000); // 20 s left
  room.chat(ids[2], word);
  assert.equal(room.get(ids[2]).score, Math.round((100 + 200 * 20 / 80) * 2)); // 300
  assert.equal(room.get(drawerId).score, drawerPoints(2, 2));
  assert.equal(room.phase, 'reveal', 'everyone guessed so the turn ends early');
  assert.deepEqual(room.viewFor(ids[1]).turn.points, { [ids[1]]: 500, [drawerId]: 200, [ids[2]]: 300 });
});

test('nobody guesses: drawer scores 0 and the turn ends on time', () => {
  const env = setup({ players: 2 });
  startAndChoose(env, 'medium');
  env.run(80000);
  assert.equal(env.room.phase, 'reveal');
  assert.equal(env.room.turn.reason, 'timeout');
  assert.equal(env.room.get(env.ids[0]).score, 0);
  assert.equal(env.room.get(env.ids[1]).score, 0);
});

// ---------------------------------------------------------------------------
// Hints

test('hint schedule: one letter at 50 %, another at 75 %', () => {
  const env = setup({ players: 2 });
  const { room, ids } = env;
  room.start(ids[0]);
  // Force a long word so the cap doesn't interfere.
  room.turn.choices[0] = { word: 'watermelon', difficulty: 'easy', mult: 1 };
  room.chooseWord(ids[0], 0);
  const hidden = (mask) => mask.filter((c) => c === null).length;
  assert.equal(hidden(env.lastState(ids[1]).turn.mask), 10);
  env.run(39900);
  assert.equal(hidden(env.lastState(ids[1]).turn.mask), 10, 'nothing before 50 %');
  env.run(200);
  assert.equal(hidden(env.lastState(ids[1]).turn.mask), 9, 'one letter at 50 %');
  env.run(19800); // 59.9 s
  assert.equal(hidden(env.lastState(ids[1]).turn.mask), 9);
  env.run(200); // 60.1 s = 75 %
  assert.equal(hidden(env.lastState(ids[1]).turn.mask), 8, 'another at 75 %');
  env.run(19000);
  assert.equal(hidden(env.lastState(ids[1]).turn.mask), 8, 'no more after that');
});

test('hints never reveal more than half the letters', () => {
  assert.equal(maxHints('ox'), 1);
  assert.equal(maxHints('cat'), 1);
  assert.equal(maxHints('bee'), 1);
  assert.equal(maxHints('hot dog'), 3);
  const env = setup({ players: 2 });
  const { room, ids } = env;
  room.start(ids[0]);
  room.turn.choices[0] = { word: 'ox', difficulty: 'easy', mult: 1 };
  room.chooseWord(ids[0], 0);
  env.run(79000);
  const mask = env.lastState(ids[1]).turn.mask;
  assert.equal(mask.filter((c) => c === null).length, 1, 'only one of two letters revealed');
});

test('mask shows spaces and hyphens but hides letters', () => {
  assert.deepEqual(buildMask('hot dog', new Set()), [null, null, null, ' ', null, null, null]);
  assert.deepEqual(buildMask('t-shirt', new Set([0])), ['t', '-', null, null, null, null, null]);
});

// ---------------------------------------------------------------------------
// Guess matching

test('guess normalisation: case, whitespace, diacritics, punctuation, hyphens', () => {
  assert.equal(normalizeGuess('  Crème   Brûlée!! '), 'creme brulee');
  assert.equal(checkGuess('ICE CREAM', 'ice cream'), 'correct');
  assert.equal(checkGuess('ice-cream', 'ice cream'), 'correct');
  assert.equal(checkGuess('icecream', 'ice cream'), 'correct');
  assert.equal(checkGuess('T-Shirt', 't-shirt'), 'correct');
  assert.equal(checkGuess('t shirt', 't-shirt'), 'correct');
  assert.equal(checkGuess('café', 'cafe'), 'correct');
  assert.equal(checkGuess('tiger!', 'tiger'), 'correct');
  assert.equal(checkGuess('', 'tiger'), 'wrong');
});

test('"so close" = Levenshtein distance 1 on words of 4+ letters', () => {
  assert.equal(levenshtein('tiger', 'tigre'), 2);
  assert.equal(checkGuess('tigr', 'tiger'), 'close'); // deletion
  assert.equal(checkGuess('tigers', 'tiger'), 'close'); // insertion
  assert.equal(checkGuess('tigor', 'tiger'), 'close'); // substitution
  assert.equal(checkGuess('tigre', 'tiger'), 'wrong'); // distance 2
  assert.equal(checkGuess('ca', 'cat'), 'wrong', 'short words never get "so close"');
  assert.equal(checkGuess('bat', 'cat'), 'wrong');
  assert.equal(checkGuess('lion', 'lino') === 'correct', false);
});

test('correct guess is never echoed; "so close" goes only to the guesser', () => {
  const env = setup({ players: 3 });
  const { room, ids } = env;
  room.start(ids[0]);
  room.turn.choices[1] = { word: 'giraffe', difficulty: 'medium', mult: 1.5 };
  room.chooseWord(ids[0], 1);
  env.sent.length = 0;

  room.chat(ids[1], 'girafe');
  assert.equal(env.chats(ids[1]).at(-1).kind, 'close');
  assert.equal(env.chats(ids[2]).length, 0, 'close guess not shown to others');
  assert.equal(env.chats(ids[0]).length, 0);

  room.chat(ids[1], 'Giraffe');
  const toOtherGuesser = env.sent.filter((m) => m.pid === ids[2]);
  assert.ok(toOtherGuesser.length > 0);
  assert.ok(!JSON.stringify(toOtherGuesser).toLowerCase().includes('giraffe'), 'word not echoed to the other guesser');
  assert.equal(env.chats(ids[2]).at(-1).text, 'Player 1 guessed it!');
  assert.equal(env.chats(ids[1]).at(-1).kind, 'you-correct');
});

test('guessed players and the drawer chat in a private channel', () => {
  const env = setup({ players: 4 });
  const { room, ids } = env;
  const word = startAndChoose(env, 'easy');
  room.chat(ids[1], word);
  env.sent.length = 0;
  room.chat(ids[1], 'that was easy');
  room.chat(ids[0], 'thanks!');
  assert.deepEqual(env.chats(ids[1]).map((m) => m.kind), ['private', 'private']);
  assert.deepEqual(env.chats(ids[0]).map((m) => m.kind), ['private', 'private']);
  assert.equal(env.chats(ids[2]).length, 0);
  assert.equal(env.chats(ids[3]).length, 0);
  room.chat(ids[2], 'is it a house');
  assert.equal(env.chats(ids[3]).at(-1).kind, 'chat', 'normal guesses are public');
});

test('chat limits: 100 chars max and about 3 messages per second', () => {
  const env = setup({ players: 2 });
  const { room, ids } = env;
  env.sent.length = 0;
  room.chat(ids[1], 'x'.repeat(250));
  assert.equal(env.chats(ids[0]).at(-1).text.length, 100);
  room.chat(ids[1], 'a');
  room.chat(ids[1], 'b');
  const res = room.chat(ids[1], 'c');
  assert.equal(res.error, 'Slow down!');
  env.advance(1001);
  assert.ok(room.chat(ids[1], 'd').ok);
});

// ---------------------------------------------------------------------------
// Turns & rounds

test('turn and round transitions run through every player then end the game', () => {
  const env = setup({ players: 3 });
  const { room, ids } = env;
  room.updateSettings(ids[0], { rounds: 2 });
  room.start(ids[0]);
  const drawers = [];
  for (let i = 0; i < 6; i++) {
    assert.equal(room.phase, 'choosing');
    drawers.push([room.round, room.turn.drawerId]);
    env.run(15000); // auto-picks a word
    assert.equal(room.phase, 'drawing');
    assert.ok(room.turn.word);
    env.run(80000);
    assert.equal(room.phase, 'reveal');
    env.run(5000);
  }
  assert.equal(room.phase, 'gameOver');
  assert.deepEqual(drawers, [
    [1, ids[0]], [1, ids[1]], [1, ids[2]],
    [2, ids[0]], [2, ids[1]], [2, ids[2]],
  ]);
  const galleryMsg = env.sent.filter((m) => m.event === 'gallery' && m.pid === ids[1]).at(-1);
  assert.ok(galleryMsg, 'gallery sent at game over');
});

test('choosing times out after 15 s and picks one of the three words', () => {
  const env = setup({ players: 2 });
  const { room, ids } = env;
  room.start(ids[0]);
  const choices = room.turn.choices.map((c) => c.word);
  assert.deepEqual(room.turn.choices.map((c) => c.difficulty), ['easy', 'medium', 'hard']);
  env.run(14900);
  assert.equal(room.phase, 'choosing');
  env.run(200);
  assert.equal(room.phase, 'drawing');
  assert.ok(choices.includes(room.turn.word));
});

test('all guessers guessing ends the turn early; reveal lasts 5 s', () => {
  const env = setup({ players: 3 });
  const { room, ids } = env;
  const word = startAndChoose(env, 'easy');
  env.advance(5000);
  room.chat(ids[1], word);
  assert.equal(room.phase, 'drawing');
  room.chat(ids[2], word);
  assert.equal(room.phase, 'reveal');
  assert.equal(room.turn.reason, 'allGuessed');
  assert.equal(env.lastState(ids[2]).turn.word, word, 'word revealed to everyone');
  env.run(4900);
  assert.equal(room.phase, 'reveal');
  env.run(200);
  assert.equal(room.phase, 'choosing');
  assert.equal(room.turn.drawerId, ids[1]);
});

test('play again returns everyone to the lobby with scores reset', () => {
  const env = setup({ players: 2 });
  const { room, ids } = env;
  room.updateSettings(ids[0], { rounds: 2 });
  room.start(ids[0]);
  for (let i = 0; i < 4; i++) {
    const w = chooseDifficulty(env, 'easy');
    room.chat(room.players.find((p) => p.id !== room.turn.drawerId).id, w);
    env.run(5000);
  }
  assert.equal(room.phase, 'gameOver');
  assert.ok(room.get(ids[0]).score > 0);
  assert.equal(room.playAgain(ids[1]).error, 'Only the host can restart.');
  assert.ok(room.playAgain(ids[0]).ok);
  assert.equal(room.phase, 'lobby');
  assert.equal(room.get(ids[0]).score, 0);
  assert.equal(room.get(ids[1]).score, 0);
});

// ---------------------------------------------------------------------------
// Connections

test('reconnect within 60 s keeps the seat and score', () => {
  const env = setup({ players: 3 });
  const { room, ids, manager } = env;
  const word = startAndChoose(env, 'easy');
  room.chat(ids[1], word);
  const score = room.get(ids[1]).score;
  assert.ok(score > 0);

  room.disconnect(ids[1]);
  assert.equal(env.lastState(ids[0]).players[1].connected, false, 'shown as reconnecting');
  env.run(59000);
  const res = manager.resume(room.code, 'token-player-1');
  assert.equal(res.player.id, ids[1]);
  room.connect(ids[1]);
  assert.equal(room.get(ids[1]).score, score);
  assert.equal(room.players.length, 3);

  // Joining again with the same token (e.g. opening the invite link again) also resumes.
  const again = manager.join(room.code, 'token-player-1', 'Someone Else');
  assert.equal(again.resumed, true);
  assert.equal(again.player.id, ids[1]);
  assert.equal(again.player.name, 'Player 1');
});

test('rejoining restores the chat, including messages missed while away', () => {
  const env = setup({ players: 3 });
  const { room, ids } = env;
  room.chat(ids[0], 'hello before');
  room.disconnect(ids[2]);
  room.chat(ids[1], 'said while you were away');
  env.sent.length = 0;
  room.connect(ids[2]);
  const hist = env.sent.find((m) => m.pid === ids[2] && m.event === 'chatHistory');
  assert.ok(hist, 'history sent on rejoin');
  const texts = hist.data.messages.map((m) => m.text);
  assert.ok(texts.includes('hello before'));
  assert.ok(texts.includes('said while you were away'));
  assert.ok(!env.sent.some((m) => m.pid === ids[2] && m.event === 'chat' && m.data.text === 'said while you were away'), 'not re-sent live');
  // New players don't get anyone else's history.
  const late = env.join('token-late-hist', 'Late');
  assert.ok(!env.sent.some((m) => m.pid === late.id && m.event === 'chatHistory'));
});

test('the view carries the full length of the current phase (timer ring after a refresh)', () => {
  const env = setup({ players: 2 });
  const { room, ids } = env;
  assert.equal(env.lastState(ids[1]).phaseMs, 0);
  room.start(ids[0]);
  assert.equal(env.lastState(ids[1]).phaseMs, 15000);
  chooseDifficulty(env, 'easy');
  env.advance(30000);
  room.disconnect(ids[1]);
  room.connect(ids[1]);
  const st = env.lastState(ids[1]);
  assert.equal(st.phaseMs, 80000);
  assert.equal(st.endsAt - st.serverNow, 50000);
});

test('a seat is removed after 60 s disconnected', () => {
  const env = setup({ players: 3 });
  const { room, ids, manager } = env;
  room.disconnect(ids[2]);
  env.run(59900);
  assert.equal(room.players.length, 3);
  env.run(200);
  assert.equal(room.players.length, 2);
  assert.equal(manager.resume(room.code, 'token-player-2').error, 'Your seat expired. Join again?');
});

test('reconnecting mid-turn resyncs the drawing', () => {
  const env = setup({ players: 2 });
  const { room, ids } = env;
  startAndChoose(env, 'easy');
  room.draw(ids[0], { t: 'b', id: 1, c: 0, s: 10, p: [10, 10, 20, 20] });
  room.draw(ids[0], { t: 'e', id: 1, p: [30, 30] });
  room.disconnect(ids[1]);
  env.sent.length = 0;
  room.connect(ids[1]);
  const sync = env.sent.find((m) => m.pid === ids[1] && m.event === 'drawSync');
  // Still being drawn, so it's marked open (the client keeps extending it).
  assert.deepEqual(sync.data.ops, [{ t: 's', id: 1, c: 0, s: 10, p: [10, 10, 20, 20, 30, 30], open: true }]);
  room.draw(ids[0], { t: 'x', id: 1 });
  room.disconnect(ids[1]);
  env.sent.length = 0;
  room.connect(ids[1]);
  const closed = env.sent.find((m) => m.pid === ids[1] && m.event === 'drawSync');
  assert.deepEqual(closed.data.ops, [{ t: 's', id: 1, c: 0, s: 10, p: [10, 10, 20, 20, 30, 30] }]);
});

test('host migration: host leaves -> longest-seated connected player becomes host', () => {
  const env = setup({ players: 4 });
  const { room, ids } = env;
  room.disconnect(ids[1]); // seat 1 is away, so seat 2 should get host
  room.leave(ids[0]);
  assert.equal(room.hostId, ids[2]);
  assert.equal(env.lastState(ids[3]).hostId, ids[2]);
});

test('host migration: host disconnected for 10 s hands over host', () => {
  const env = setup({ players: 3 });
  const { room, ids } = env;
  room.disconnect(ids[0]);
  env.run(9900);
  assert.equal(room.hostId, ids[0], 'short blips keep the host');
  env.run(200);
  assert.equal(room.hostId, ids[1]);
  assert.equal(room.updateSettings(ids[1], { rounds: 4 }).ok, true);
  assert.equal(room.updateSettings(ids[0], { rounds: 2 }).error, 'Only the host can change settings.');
});

test('drawer disconnects and is not back within 10 s: the turn ends, points kept', () => {
  const env = setup({ players: 3 });
  const { room, ids } = env;
  const word = startAndChoose(env, 'easy');
  room.chat(ids[1], word);
  const s1 = room.get(ids[1]).score;
  const s0 = room.get(ids[0]).score;
  room.disconnect(ids[0]);
  env.run(9900);
  assert.equal(room.phase, 'drawing');
  env.run(200);
  assert.equal(room.phase, 'reveal');
  assert.equal(room.turn.reason, 'drawerLeft');
  assert.equal(room.get(ids[1]).score, s1);
  assert.equal(room.get(ids[0]).score, s0);
});

test('drawer back within 10 s keeps drawing', () => {
  const env = setup({ players: 2 });
  const { room, ids } = env;
  startAndChoose(env, 'easy');
  room.disconnect(ids[0]);
  env.run(8000);
  room.connect(ids[0]);
  env.run(5000);
  assert.equal(room.phase, 'drawing');
});

test('drawer disconnect during choosing skips the turn', () => {
  const env = setup({ players: 3 });
  const { room, ids } = env;
  room.start(ids[0]);
  room.disconnect(ids[0]);
  env.run(10100);
  assert.equal(room.phase, 'reveal');
  assert.equal(room.turn.word, null);
  env.run(5000);
  assert.equal(room.turn.drawerId, ids[1]);
});

test('mid-game join: guesser immediately, draws from the next round', () => {
  const env = setup({ players: 2 });
  const { room, ids } = env;
  room.updateSettings(ids[0], { rounds: 2 });
  const word = startAndChoose(env, 'easy');
  const late = env.join('token-late-1', 'Late');
  const st = env.lastState(late.id);
  assert.equal(st.phase, 'drawing');
  assert.ok(st.turn.mask && !st.turn.word, 'late joiner is a guesser and sees only the mask');
  assert.ok(env.sent.some((m) => m.pid === late.id && m.event === 'drawSync'), 'gets the canvas');
  room.chat(ids[1], word);
  assert.equal(room.phase, 'drawing', 'turn waits for the late joiner too');
  room.chat(late.id, word);
  assert.equal(room.phase, 'reveal');
  assert.ok(room.get(late.id).score > 0);

  const drawers = [];
  let lastTurn = room.turn.id;
  while (room.phase !== 'gameOver') {
    if (room.phase === 'choosing' && room.turn.id !== lastTurn) {
      lastTurn = room.turn.id;
      drawers.push([room.round, room.turn.drawerId]);
    }
    env.run(1000, 1000);
  }
  assert.deepEqual(drawers, [
    [1, ids[1]],
    [2, ids[0]], [2, ids[1]], [2, late.id],
  ]);
});

test('room is full at 8 players', () => {
  const env = setup({ players: 8 });
  const res = env.manager.join(env.room.code, 'token-ninth-1', 'Ninth');
  assert.equal(res.error, 'Room is full');
});

test('start needs at least 2 connected players and only the host can start', () => {
  const env = setup({ players: 2 });
  const { room, ids } = env;
  assert.equal(room.start(ids[1]).error, 'Only the host can start the game.');
  room.disconnect(ids[1]);
  assert.equal(room.start(ids[0]).error, 'You need at least 2 players to start.');
});

test('everyone else leaving mid-game returns to the lobby', () => {
  const env = setup({ players: 2 });
  const { room, ids } = env;
  startAndChoose(env, 'easy');
  room.leave(ids[1]);
  assert.equal(room.phase, 'lobby');
  assert.ok(room.notice);
});

// ---------------------------------------------------------------------------
// Rooms, names, drawing, words

test('room codes: 4 letters, no I/L/O, case-insensitive join', () => {
  const env = setup({ players: 1 });
  const code = env.room.code;
  assert.match(code, /^[ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/);
  assert.ok(!/[ILO]/.test(CODE_ALPHABET));
  const p = env.join('token-lower-1', 'Lower');
  assert.ok(p.id);
  const res = env.manager.join(code.toLowerCase(), 'token-lower-2', 'Lower2');
  assert.ok(res.player);
  assert.match(env.manager.join('ZZZZ', 'token-x-12345', 'X').error || '', /not found/);
  assert.equal(env.manager.join('AB', 'token-x-12345', 'X').error, 'Room codes are 4 letters.');
});

test('names: trimmed, 1–16 chars, duplicates get a suffix', () => {
  assert.equal(sanitizeName('   Ana   '), 'Ana');
  assert.equal(sanitizeName('A very long name indeed'), 'A very long name');
  const env = setup({ players: 1 });
  const a = env.join('token-sam-0001', 'Sam');
  const b = env.join('token-sam-0002', 'sam');
  const c = env.join('token-sam-0003', 'Sam');
  assert.deepEqual([a.name, b.name, c.name], ['Sam', 'sam 2', 'Sam 3']);
  assert.equal(env.manager.join(env.room.code, 'token-sam-0004', '   ').error, 'Please enter a name (1–16 characters).');
  const colors = new Set(env.room.players.map((p) => p.color));
  assert.equal(colors.size, env.room.players.length, 'each player gets a distinct avatar colour');
});

test('only the current drawer can draw; ops are validated and capped', () => {
  const env = setup({ players: 3 });
  const { room, ids } = env;
  startAndChoose(env, 'easy');
  env.sent.length = 0;
  assert.equal(room.draw(ids[1], { t: 'b', id: 1, c: 0, s: 10, p: [1, 1] }), false, 'guesser cannot draw');
  assert.equal(room.draw(ids[0], { t: 'b', id: 1, c: 99, s: 10, p: [1, 1] }), false, 'bad colour');
  assert.equal(room.draw(ids[0], { t: 'b', id: 1, c: 0, s: 7, p: [1, 1] }), false, 'bad size');
  assert.equal(room.draw(ids[0], { t: 'b', id: 1, c: 0, s: 10, p: [5000, -3] }), true);
  assert.deepEqual(room.turn.ops[0].p, [799, 0], 'points clamped to the 800x600 canvas');
  assert.equal(room.draw(ids[0], { t: 'f', x: 10, y: 10, c: 3 }), true);
  assert.equal(room.draw(ids[0], { t: 'u' }), true);
  assert.equal(room.turn.ops.length, 1);
  assert.equal(room.draw(ids[0], { t: 'c' }), true);
  const forwarded = env.sent.filter((m) => m.event === 'draw');
  assert.ok(forwarded.every((m) => m.pid !== ids[0]), 'ops are not echoed to the drawer');
  assert.equal(forwarded.filter((m) => m.pid === ids[1]).length, 4);

  // Point cap: ~20 000 points per turn.
  let accepted = 0;
  for (let i = 0; i < 100; i++) {
    env.advance(20);
    const pts = new Array(600).fill(5);
    if (room.draw(ids[0], { t: 'b', id: 100 + i, c: 0, s: 4, p: pts })) accepted++;
  }
  assert.ok(accepted < 100 && accepted >= 60);
  assert.ok(env.sent.some((m) => m.pid === ids[0] && m.event === 'drawLimit'));
});

test('word packs: 5 English packs with 90+ words split into easy/medium/hard, Mixed has them all', () => {
  const ids = ['everyday', 'animals', 'food', 'places', 'actions'];
  let total = 0;
  for (const id of ids) {
    const p = PACKS[id];
    const n = p.easy.length + p.medium.length + p.hard.length;
    assert.ok(n >= 90, `${id} has ${n} words`);
    for (const d of ['easy', 'medium', 'hard']) {
      assert.ok(p[d].length >= 25, `${id}.${d}`);
      for (const w of p[d]) assert.match(w, /^[a-z]+([ -][a-z]+)*$/, `bad word "${w}"`);
    }
    total += n;
  }
  const mixed = PACKS.mixed.easy.length + PACKS.mixed.medium.length + PACKS.mixed.hard.length;
  assert.ok(mixed > 400 && mixed <= total);
  assert.deepEqual(PACK_IDS, ['everyday', 'animals', 'food', 'places', 'actions', 'mixed', 'spanish', 'custom']);
});

test('Spanish pack: 90 words, accents optional when guessing, and bots draw in Spanish too', () => {
  const es = PACKS.spanish;
  for (const d of ['easy', 'medium', 'hard']) {
    assert.equal(es[d].length, 30);
    for (const w of es[d]) {
      assert.match(w, /^\p{Ll}+([ -]\p{Ll}+)*$/u, `bad word "${w}"`);
      assert.equal(w, w.normalize('NFC'));
      assert.ok(!PACKS.mixed[d].includes(w) || ['robot'].includes(w), `"${w}" leaked into Mixed`);
    }
  }
  assert.equal(checkGuess('arbol', 'árbol'), 'correct');
  assert.equal(checkGuess('Pinguino', 'pingüino'), 'correct');
  assert.equal(checkGuess('muneco de nieve', 'muñeco de nieve'), 'correct');
  assert.deepEqual(buildMask('piña', new Set()), [null, null, null, null]);

  // A solo game in Spanish against a bot: the bot's words are Spanish, and it still draws them.
  const env = setup({ players: 1, seed: 3 });
  const { room, ids } = env;
  room.addBot(ids[0]);
  assert.ok(room.updateSettings(ids[0], { pack: 'spanish', rounds: 2 }).ok);
  room.start(ids[0]);
  const all = [...es.easy, ...es.medium, ...es.hard];
  while (room.phase !== 'gameOver') {
    const t = room.turn;
    if (room.phase === 'choosing') for (const c of t.choices) assert.ok(all.includes(c.word), c.word);
    if (room.phase === 'choosing' && t.drawerId === ids[0]) chooseDifficulty(env, 'easy');
    if (room.phase === 'drawing' && t.drawerId !== ids[0]) {
      env.run(20000);
      assert.equal(room.chat(ids[0], t.word.normalize('NFD').replace(/\p{M}/gu, '')).correct, true);
    }
    env.run(1000);
  }
  const bot = room.gallery.filter((d) => d.drawerBot);
  assert.equal(bot.length, 2);
  for (const d of bot) assert.ok(all.includes(d.word) && d.ops.length > 3, d.word);
});

test('family-friendly filter: whole words, look-alikes, names always, chat when on', () => {
  const { isRude, censor } = require('../server/filter');
  assert.equal(censor('what the sh1t'), 'what the ****');
  assert.equal(censor('FUUUCK this'), '****** this');
  assert.equal(censor('you @sshole'), 'you *******');
  assert.equal(censor('qué mierda'), 'qué ******');
  for (const ok of ['class', 'Scunthorpe', 'passes', 'bass', 'cocky', 'Dickens', 'assess', 'grass is green']) assert.equal(isRude(ok), false, ok);

  const env = setup({ players: 3 });
  const { room, ids, manager } = env;
  assert.equal(manager.join(room.code, 'token-rude-1', 'b1tch').error, 'Please pick a friendlier name.');
  assert.equal(manager.createRoom('token-rude-2', 'Big Shit').error, 'Please pick a friendlier name.');
  assert.equal(manager.joinAudience(room.code, 'token-rude-3', 'Fuckface').error, 'Please pick a friendlier name.');
  assert.equal(room.settings.clean, true);
  room.chat(ids[1], 'this is shit');
  assert.equal(env.chats(ids[2]).at(-1).text, 'this is ****');
  assert.equal(env.lastState(ids[1]).settings.clean, true);
  assert.equal(room.updateSettings(ids[1], { clean: false }).error, 'Only the host can change settings.');
  room.updateSettings(ids[0], { clean: false });
  room.chat(ids[1], 'this is shit');
  assert.equal(env.chats(ids[2]).at(-1).text, 'this is shit');

  // Guesses are checked as typed: a filtered word can still be the answer's neighbour.
  room.updateSettings(ids[0], { clean: true, pack: 'animals' });
  startAndChoose(env, 'easy');
  const t = room.turn;
  const guesser = ids.find((id) => id !== t.drawerId);
  assert.equal(room.chat(guesser, t.word).correct, true);
});

test('wins are tallied across games in the same room (ties count for everyone on top)', () => {
  const env = setup({ players: 3 });
  const { room, ids } = env;
  const play = () => {
    room.updateSettings(ids[0], { rounds: 2 });
    room.start(ids[0]);
    while (room.phase !== 'gameOver') {
      const t = room.turn;
      if (room.phase === 'choosing') chooseDifficulty(env, 'easy');
      if (room.phase === 'drawing' && !room.get(ids[1]).guessed && t.drawerId !== ids[1]) room.chat(ids[1], t.word);
      env.run(1000);
    }
  };
  play();
  const wins = () => env.lastState(ids[0]).players.map((p) => p.wins);
  assert.deepEqual(wins(), [0, 1, 0]);
  room.playAgain(ids[0]);
  assert.deepEqual(wins(), [0, 1, 0]);
  play();
  assert.deepEqual(wins(), [0, 2, 0]);
  // A game where nobody scores gives no wins.
  room.playAgain(ids[0]);
  room.updateSettings(ids[0], { rounds: 2 });
  room.start(ids[0]);
  while (room.phase !== 'gameOver') env.run(1000);
  assert.deepEqual(wins(), [0, 2, 0]);
});

test('robustness: a room whose tick throws does not stop the others; rooms are capped', () => {
  const { RoomManager, MAX_ROOMS } = require('../server/game');
  const env = setup({ players: 2 });
  const { manager, room, ids } = env;
  const other = manager.createRoom('token-other-0', 'Other').room;
  other.connect(other.players[0].id);
  const broken = manager.createRoom('token-broken', 'Broken').room;
  broken.tick = () => {
    throw new Error('boom');
  };
  // Make sure the broken room comes first in the loop.
  manager.rooms.delete(room.code);
  manager.rooms.set(room.code, room);
  const err = console.error;
  console.error = () => {};
  try {
    room.start(ids[0]);
    const ends = room.endsAt;
    env.run(ends - env.now + 200);
    assert.equal(room.phase, 'drawing');
  } finally {
    console.error = err;
  }

  const m = new RoomManager();
  for (let i = 0; i < MAX_ROOMS; i++) m.rooms.set(`R${i}`, { players: [{}] });
  assert.match(m.createRoom('token-cap-1', 'Late').error, /very busy/);
  assert.match(m.createEmptyRoom().error, /Try again/);
});

test('custom words: at least 10, each 2–30 chars, all count as medium', () => {
  assert.deepEqual(parseCustomWords('a, bb, ccc,  Dog , dog, ' + 'x'.repeat(31) + ', ice-cream'), ['bb', 'ccc', 'dog', 'ice-cream']);
  const env = setup({ players: 2 });
  const { room, ids } = env;
  const few = room.updateSettings(ids[0], { pack: 'custom', customWords: 'one, two, three' });
  assert.match(few.error, /at least 10/);
  assert.match(room.start(ids[0]).error, /custom words/);
  const words = 'apple, banana, cherry, dog, eel, fox, goat, hat, igloo, jam, kite';
  assert.ok(room.updateSettings(ids[0], { customWords: words }).ok);
  assert.equal(env.lastState(ids[1]).settings.customCount, 11);
  assert.equal(env.lastState(ids[1]).customWords, undefined, 'non-hosts never get the custom list');
  room.start(ids[0]);
  assert.deepEqual(room.turn.choices.map((c) => [c.difficulty, c.mult]), [['medium', 1.5], ['medium', 1.5], ['medium', 1.5]]);
  const all = words.split(', ');
  for (const c of room.turn.choices) assert.ok(all.includes(c.word));
});

test('settings are validated: rounds 2–5, draw time 60/80/100', () => {
  const env = setup({ players: 2 });
  const { room, ids } = env;
  assert.deepEqual(room.settings, { rounds: 3, drawTime: 80, pack: 'mixed', chaos: false, clean: true, mode: 'classic' });
  room.updateSettings(ids[0], { rounds: 9, drawTime: 75, pack: 'nope', chaos: 'yes', clean: 'no', mode: 'battle' });
  assert.deepEqual(room.settings, { rounds: 3, drawTime: 80, pack: 'mixed', chaos: false, clean: true, mode: 'classic' });
  room.updateSettings(ids[0], { rounds: 5, drawTime: 100, pack: 'spanish', chaos: true, clean: false, mode: 'impostor' });
  assert.deepEqual(room.settings, { rounds: 5, drawTime: 100, pack: 'spanish', chaos: true, clean: false, mode: 'impostor' });
});

test('rooms are garbage-collected after 30 min with no connected players', () => {
  const env = setup({ players: 2 });
  const { room, ids, manager } = env;
  room.disconnect(ids[0]);
  room.disconnect(ids[1]);
  env.run(29 * 60 * 1000, 60000);
  assert.ok(manager.getRoom(room.code));
  env.run(2 * 60 * 1000, 60000);
  assert.equal(manager.getRoom(room.code), null);
});

test('gallery keeps every finished drawing (after the last clear) with word and artist', () => {
  const env = setup({ players: 2 });
  const { room, ids } = env;
  room.updateSettings(ids[0], { rounds: 2 });
  room.start(ids[0]);
  for (let i = 0; i < 4; i++) {
    const drawer = room.turn.drawerId;
    chooseDifficulty(env, 'easy');
    room.draw(drawer, { t: 'b', id: 1, c: 0, s: 10, p: [1, 1] });
    room.draw(drawer, { t: 'c' });
    room.draw(drawer, { t: 'b', id: 2, c: 3, s: 24, p: [50, 50, 60, 60] });
    room.draw(drawer, { t: 'f', x: 5, y: 5, c: 5 });
    env.run(80000);
    env.run(5000);
  }
  assert.equal(room.phase, 'gameOver');
  const gallery = env.sent.filter((m) => m.pid === ids[1] && m.event === 'gallery').at(-1).data.drawings;
  assert.equal(gallery.length, 4);
  assert.equal(gallery[0].drawerName, 'Player 0');
  assert.ok(gallery[0].word);
  assert.deepEqual(gallery[0].ops, [
    { t: 's', id: 2, c: 3, s: 24, p: [50, 50, 60, 60] },
    { t: 'f', x: 5, y: 5, c: 5 },
  ]);
});

test('reactions: a fixed emoji set, sent to everyone, rate-limited', () => {
  const env = setup({ players: 3 });
  const { room, ids, sent } = env;
  sent.length = 0;
  assert.ok(room.react(ids[1], 'fire').ok);
  for (const pid of ids) {
    const r = sent.find((m) => m.pid === pid && m.event === 'reaction');
    assert.deepEqual({ from: r.data.from, emoji: r.data.emoji, name: r.data.name }, { from: ids[1], emoji: 'fire', name: 'Player 1' });
  }
  assert.equal(room.react(ids[1], 'hello').error, 'Unknown reaction.', 'no free text through reactions');
  assert.equal(room.react(ids[1], '<b>').error, 'Unknown reaction.');
  for (let i = 0; i < 4; i++) room.react(ids[1], 'lol');
  assert.equal(room.react(ids[1], 'lol').error, 'Slow down!');
  env.advance(2100);
  assert.ok(room.react(ids[1], 'lol').ok);
});

test('awards at game over: fastest guess, best artist, early bird, near misses, abstract artist', () => {
  const env = setup({ players: 3 });
  const { room, ids } = env;
  room.updateSettings(ids[0], { rounds: 2 });
  room.start(ids[0]);
  const draw = (pid) => room.draw(pid, { t: 'b', id: 1, c: 0, s: 10, p: [10, 10, 20, 20] });
  // Turn 1 (P0 draws): P1 guesses fast and first, P2 later.
  let w = chooseDifficulty(env, 'easy');
  draw(ids[0]);
  env.advance(2000);
  room.chat(ids[1], w);
  env.advance(6000);
  room.chat(ids[2], w);
  env.run(5000);
  // Turn 2 (P1 draws): P2 has two near misses, nobody guesses.
  w = chooseDifficulty(env, 'medium');
  draw(ids[1]);
  const near = w.slice(0, -1) + (w.endsWith('z') ? 'y' : 'z');
  if (w.replace(/ /g, '').length >= 4) {
    room.chat(ids[2], near);
    env.advance(1100);
    room.chat(ids[2], w.slice(0, -1));
  }
  env.run(80000);
  env.run(5000);
  // Everything else: nobody draws or guesses.
  while (room.phase !== 'gameOver') env.run(1000, 1000);
  const view = env.lastState(ids[0]);
  const byId = Object.fromEntries(view.awards.map((a) => [a.id, a]));
  assert.equal(byId.fastest.playerId, ids[1]);
  assert.match(byId.fastest.detail, /in 2\.0 s/);
  assert.equal(byId.artist.playerId, ids[0]);
  assert.match(byId.artist.detail, /2 correct guesses/);
  assert.equal(byId.first.playerId, ids[1]);
  if (byId.close) assert.equal(byId.close.playerId, ids[2]);
  assert.equal(byId.abstract.playerId, ids[1], 'the drawing nobody guessed');
});

test('gallery likes: after the game only, not your own drawing, live counts for everyone', () => {
  const env = setup({ players: 2 });
  const { room, ids, sent } = env;
  room.updateSettings(ids[0], { rounds: 2 });
  room.start(ids[0]);
  for (let i = 0; i < 4; i++) {
    const drawer = room.turn.drawerId;
    chooseDifficulty(env, 'easy');
    room.draw(drawer, { t: 'b', id: 1, c: 0, s: 10, p: [10, 10, 20, 20] });
    assert.equal(room.like(ids[0], 0).error, 'You can like drawings after the game.');
    env.run(80000);
    env.run(5000);
  }
  assert.equal(room.phase, 'gameOver');
  assert.equal(room.gallery.length, 4);
  const mine = room.gallery.findIndex((d) => d.drawerId === ids[0]);
  const theirs = room.gallery.findIndex((d) => d.drawerId === ids[1]);
  assert.equal(room.like(ids[0], mine).error, "You can't like your own drawing.");
  sent.length = 0;
  assert.equal(room.like(ids[0], theirs).count, 1);
  const forThem = sent.filter((m) => m.pid === ids[1] && m.event === 'likes').at(-1).data;
  assert.equal(forThem.counts[theirs], 1);
  assert.deepEqual(forThem.mine, []);
  const forMe = sent.filter((m) => m.pid === ids[0] && m.event === 'likes').at(-1).data;
  assert.deepEqual(forMe.mine, [theirs]);
  assert.equal(room.like(ids[0], theirs, false).count, 0, 'unlike');
  assert.equal(room.like(ids[0], 99).error, 'No such drawing.');
  // Rejoining during game over gets the gallery with likes and awards.
  room.disconnect(ids[1]);
  sent.length = 0;
  room.connect(ids[1]);
  const g = sent.find((m) => m.pid === ids[1] && m.event === 'gallery').data;
  assert.equal(g.drawings.length, 4);
  assert.ok(Array.isArray(g.awards));
  assert.equal(g.likes.counts.length, 4);
});

test('TV screen: sees what a guesser sees, public chat only, and holds no seat', () => {
  const env = setup({ players: 3 });
  const { room, ids, sent, manager } = env;
  room.chat(ids[1], 'hello before the TV');
  const tv = manager.watch(room.code.toLowerCase());
  assert.ok(tv.id);
  sent.length = 0;
  room.connectWatcher(tv.id);
  const history = sent.find((m) => m.pid === tv.id && m.event === 'chatHistory').data.messages;
  assert.ok(history.some((m) => m.text === 'hello before the TV'), 'gets the recent public chat');
  assert.equal(env.lastState(tv.id).watching, true);
  assert.equal(env.lastState(ids[0]).screens, 1, 'players see that a TV is connected');
  assert.equal(room.players.length, 3, 'a TV is not a player');
  assert.equal(env.lastState(tv.id).customWords, undefined);

  const w = startAndChoose(env, 'medium');
  const st = env.lastState(tv.id);
  assert.equal(st.turn.word, null);
  assert.equal(st.turn.choices, null);
  assert.equal(st.turn.mask.length, Array.from(w).length);

  sent.length = 0;
  const drawer = room.turn.drawerId;
  const guessers = ids.filter((id) => id !== drawer);
  room.draw(drawer, { t: 'b', id: 1, c: 0, s: 10, p: [10, 10, 20, 20] });
  env.advance(1100); // chat rate limit
  room.chat(guessers[0], 'a wrong guess');
  room.chat(guessers[0], `is it ${w}?`); // contains the word: only the sender sees it
  room.chat(guessers[0], w); // correct
  env.advance(1100);
  room.chat(guessers[0], 'secret chat after guessing'); // private channel
  room.chat(drawer, 'drawer hint'); // private channel
  room.react(guessers[1], 'fire');
  const toTv = sent.filter((m) => m.pid === tv.id);
  assert.deepEqual(toTv.find((m) => m.event === 'draw').data, { t: 'b', id: 1, c: 0, s: 10, p: [10, 10, 20, 20] });
  const chats = toTv.filter((m) => m.event === 'chat').map((m) => m.data);
  assert.deepEqual(chats.map((m) => m.kind), ['chat', 'correct']);
  assert.equal(chats[0].text, 'a wrong guess');
  assert.ok(!JSON.stringify(toTv).toLowerCase().includes(w.toLowerCase()), 'the word never reaches the TV mid-turn');
  assert.equal(toTv.find((m) => m.event === 'reaction').data.emoji, 'fire');

  // A TV that connects mid-turn gets the drawing so far.
  const tv2 = manager.watch(room.code);
  sent.length = 0;
  room.connectWatcher(tv2.id);
  assert.equal(sent.find((m) => m.pid === tv2.id && m.event === 'drawSync').data.ops.length, 1);

  // At the reveal the TV sees the word, and at the end the gallery.
  env.run(80000);
  assert.equal(env.lastState(tv.id).turn.word, w);
  while (room.phase !== 'gameOver') env.run(90000, 1000);
  const gallery = sent.filter((m) => m.pid === tv.id && m.event === 'gallery').at(-1).data;
  assert.ok(gallery.drawings.length >= 1);
  assert.deepEqual(gallery.likes.mine, []);
  const fan = ids.find((id) => id !== room.gallery[0].drawerId);
  assert.ok(room.like(fan, 0).ok);
  assert.equal(sent.filter((m) => m.pid === tv.id && m.event === 'likes').at(-1).data.counts[0], 1);

  room.removeWatcher(tv.id);
  room.removeWatcher(tv2.id);
  assert.equal(env.lastState(ids[0]).screens, 0);
  assert.equal(manager.watch('ZZZZ').error, 'Room ZZZZ not found. Check the code?');
});

test('TV screens: limited per room, and they alone do not keep a room alive', () => {
  const env = setup({ players: 1, timing: { roomIdleMs: 1000 } });
  const { room, ids, manager, sent } = env;
  const tvs = [];
  for (let i = 0; i < 6; i++) tvs.push(manager.watch(room.code).id);
  assert.match(manager.watch(room.code).error, /Too many screens/);
  room.leave(ids[0]);
  env.run(1500);
  assert.equal(manager.getRoom(room.code), null);
  assert.ok(sent.some((m) => m.pid === tvs[0] && m.event === 'roomClosed'));
});

test('the host can remove a player, who then cannot rejoin', () => {
  const env = setup({ players: 3 });
  const { room, ids, sent, manager } = env;
  assert.equal(room.kick(ids[1], ids[2]).error, 'Only the host can remove players.');
  assert.match(room.kick(ids[0], ids[0]).error, /yourself/);
  sent.length = 0;
  assert.ok(room.kick(ids[0], ids[2]).ok);
  assert.ok(sent.some((m) => m.pid === ids[2] && m.event === 'kicked'));
  assert.equal(room.players.length, 2);
  assert.ok(env.chats(ids[1]).some((m) => m.text === 'Player 2 was removed by the host'));
  assert.equal(manager.join(room.code, 'token-player-2', 'Again').error, 'The host removed you from this room.');
  assert.equal(manager.resume(room.code, 'token-player-2').error, 'The host removed you from this room.');
  assert.ok(manager.join(room.code, 'token-someone-new', 'New').player, 'others can still join');

  // Mid-game: removing the drawer skips their turn.
  const env2 = setup({ players: 3 });
  env2.room.start(env2.ids[0]);
  const drawer = env2.room.turn.drawerId;
  const target = drawer === env2.ids[0] ? env2.ids[1] : drawer;
  if (drawer !== env2.ids[0]) {
    env2.room.kick(env2.ids[0], target);
    assert.equal(env2.room.phase, 'reveal');
  }
  // Removing a bot works like the bot's remove button.
  const bot = env.room.addBot(ids[0]);
  assert.ok(env.room.kick(ids[0], bot.id).ok);
  assert.equal(env.room.get(bot.id), null);
});

test('drawn avatars: validated, lobby or game over only, sent to everyone and to newcomers', () => {
  const { sanitizeAvatar } = require('../server/game');
  const env = setup({ players: 2 });
  const { room, ids, sent, manager } = env;
  const face = [[0, 8, 30, 40, 31, 41, 32, 42], [3, 14, 60, 80]];
  sent.length = 0;
  assert.ok(room.setAvatar(ids[0], face).ok);
  const msg = sent.find((m) => m.pid === ids[1] && m.event === 'avatar').data;
  assert.deepEqual(msg, { id: ids[0], av: 1, data: face });
  assert.equal(env.lastState(ids[1]).players[0].av, 1);

  // Validation: sizes, colours, grid, limits.
  assert.equal(sanitizeAvatar([[0, 7, 1, 1]]), undefined, 'size not allowed');
  assert.equal(sanitizeAvatar([[12, 4, 1, 1]]), undefined, 'no such colour');
  assert.equal(sanitizeAvatar([[0, 4, 1]]), undefined, 'odd coordinates');
  assert.equal(sanitizeAvatar('<svg>'), undefined);
  assert.deepEqual(sanitizeAvatar([[0, 4, -5, 500]]), [[0, 4, 0, 119]], 'clamped to the grid');
  assert.equal(sanitizeAvatar(Array.from({ length: 61 }, () => [0, 4, 1, 1])), undefined, 'too many strokes');
  assert.equal(sanitizeAvatar([[0, 4, ...Array.from({ length: 5000 }, () => 5)]]), undefined, 'too many points');
  assert.equal(sanitizeAvatar(null), null);
  assert.equal(sanitizeAvatar([]), null);
  assert.equal(room.setAvatar(ids[1], [[0, 99, 1, 1]]).error, 'That drawing is too big.');

  // Someone joining later gets everyone's avatars.
  sent.length = 0;
  const late = env.join('token-late-avatar', 'Late');
  assert.deepEqual(sent.find((m) => m.pid === late.id && m.event === 'avatars').data.list, [{ id: ids[0], av: 1, data: face }]);

  // Not during a turn (a guesser could draw the word).
  env.advance(2500);
  room.start(ids[0]);
  assert.match(room.setAvatar(ids[1], face).error, /lobby/);

  // Kept after the player leaves, so the gallery still shows their face.
  room.leave(ids[0]);
  const tv = manager.watch(room.code);
  sent.length = 0;
  room.connectWatcher(tv.id);
  assert.equal(sent.find((m) => m.pid === tv.id && m.event === 'avatars').data.list[0].id, ids[0]);
});

test('chaos rounds: off by default; when on, every turn gets a twist, never the same twice in a row', () => {
  const { CHAOS } = require('../server/game');
  const env = setup({ players: 3 });
  const { room, ids } = env;
  room.start(ids[0]);
  assert.equal(room.turn.chaos, null);
  assert.equal(env.lastState(ids[1]).turn.chaos, null);

  const env2 = setup({ players: 3, seed: 11 });
  env2.room.updateSettings(env2.ids[0], { chaos: true, rounds: 5 });
  env2.room.start(env2.ids[0]);
  const seen = [];
  while (env2.room.phase !== 'gameOver') {
    if (env2.room.phase === 'choosing') {
      const c = env2.room.turn.chaos;
      assert.ok(CHAOS.includes(c));
      if (seen.at(-1) !== undefined && seen.at(-1).turn !== env2.room.turn.id) {
        assert.notEqual(c, seen.at(-1).c, 'no repeats');
      }
      if (!seen.length || seen.at(-1).turn !== env2.room.turn.id) seen.push({ turn: env2.room.turn.id, c });
      // Everyone sees the twist (it's not a secret), including during choosing.
      for (const id of env2.ids) assert.equal(env2.lastState(id).turn.chaos, c);
    }
    env2.run(20000, 1000);
  }
  assert.equal(seen.length, 15);
  assert.ok(new Set(seen.map((x) => x.c)).size >= 4, 'a mix of twists');
});

test('chaos rules the server enforces: one line, tiny brush, no take-backs, ink only', () => {
  const env = setup({ players: 2 });
  const { room, ids } = env;
  room.updateSettings(ids[0], { chaos: true });
  room.start(ids[0]);
  const drawer = room.turn.drawerId;
  const stroke = (id, extra = {}) => room.draw(drawer, { t: 'b', id, c: 0, s: 10, p: [10, 10, 20, 20], ...extra });
  const tryRule = (rule) => {
    room.turn.chaos = rule;
    room.turn.strokes = 0;
    room.turn.ops = [];
  };
  chooseDifficulty(env, 'easy');

  tryRule('oneline');
  assert.ok(stroke(1));
  assert.ok(room.draw(drawer, { t: 'x', id: 1 }));
  assert.equal(stroke(2), false, 'only one stroke');
  assert.equal(room.draw(drawer, { t: 'u' }), false, 'no undo');
  assert.equal(room.draw(drawer, { t: 'c' }), false, 'no clear');
  assert.equal(room.draw(drawer, { t: 'f', x: 5, y: 5, c: 3 }), false, 'no fill');

  tryRule('tiny');
  assert.equal(stroke(3), false, 'only the thinnest brush');
  assert.ok(stroke(4, { s: 4 }));
  assert.equal(room.draw(drawer, { t: 'f', x: 5, y: 5, c: 3 }), false);

  tryRule('noundo');
  assert.ok(stroke(5));
  assert.equal(room.draw(drawer, { t: 'u' }), false);
  assert.equal(room.draw(drawer, { t: 'c' }), false);

  tryRule('ink');
  assert.equal(stroke(6, { c: 3 }), false, 'black only');
  assert.ok(stroke(7, { c: 0 }));
  assert.ok(stroke(8, { c: 2, s: 24 }), 'the eraser still works');

  for (const rule of ['mirror', 'blind']) {
    tryRule(rule);
    assert.ok(stroke(9, { c: 3 }));
    assert.ok(room.draw(drawer, { t: 'u' }));
  }
});

test('chaos: bots follow every twist, and the gallery remembers it', () => {
  const { CHAOS, chaosOps } = require('../server/game');
  const { doodleOps, doodleWords } = require('../server/doodles');
  const { mulberry32 } = require('./helpers');
  const rng = mulberry32(5);
  for (const word of doodleWords()) {
    const ops = doodleOps(word);
    const one = chaosOps(ops, 'oneline', rng);
    assert.equal(one.length, 1);
    assert.equal(one[0].p.length, ops.filter((o) => o.t === 's').reduce((n, s) => n + s.p.length, 0));
    assert.ok(chaosOps(ops, 'tiny', rng).every((o) => o.t === 's' && o.s === 4));
    assert.ok(chaosOps(ops, 'ink', rng).every((o) => o.t === 's' && (o.c === 0 || o.c === 2)));
    const m = chaosOps(ops, 'mirror', rng);
    assert.equal(m.length, ops.length);
    const firstStroke = ops.findIndex((o) => o.t === 's');
    assert.equal(m[firstStroke].p[0], 799 - ops[firstStroke].p[0]);
    assert.ok(chaosOps(ops, 'blind', rng).every((o) => o.t === 's' && o.p.every((v, i) => v >= 0 && v < (i % 2 ? 600 : 800))));
  }
  // A whole solo game with chaos on: the bot's drawings all get through the rules.
  for (let seed = 1; seed <= 6; seed++) {
    const env = setup({ players: 1, seed });
    const { room, ids } = env;
    room.addBot(ids[0]);
    room.updateSettings(ids[0], { chaos: true, rounds: 3 });
    room.start(ids[0]);
    while (room.phase !== 'gameOver') {
      const t = room.turn;
      if (room.phase === 'choosing' && t.drawerId === ids[0]) chooseDifficulty(env, 'easy');
      if (room.phase === 'drawing' && t.drawerId === ids[0] && !t.ops.length) {
        room.draw(ids[0], { t: 'b', id: 1, c: 0, s: 4, p: [100, 100, 200, 200] });
        room.draw(ids[0], { t: 'x', id: 1 });
      }
      env.run(1000);
    }
    const botDrawings = room.gallery.filter((d) => d.drawerBot);
    assert.equal(botDrawings.length, 3, `seed ${seed}`);
    for (const d of room.gallery) {
      assert.ok(CHAOS.includes(d.chaos));
      if (d.drawerBot && d.chaos === 'oneline') assert.equal(d.ops.filter((o) => o.t === 's').length, 1);
      if (d.drawerBot) assert.ok(d.ops.filter((o) => o.t === 's').reduce((n, s) => n + s.p.length / 2, 0) > 60, `${d.word} (${d.chaos}) was drawn`);
    }
  }
});

test('audience: joins a full room, sees what a guesser sees, reacts and likes, cannot chat or draw', () => {
  const env = setup({ players: 8 });
  const { room, ids, sent, manager } = env;
  const full = manager.join(room.code, 'token-ninth-person', 'Nine');
  assert.equal(full.error, 'Room is full');
  assert.equal(full.full, true);
  const res = manager.joinAudience(room.code.toLowerCase(), 'token-ninth-person', 'Nine');
  assert.ok(res.member);
  const fan = res.member.id;
  sent.length = 0;
  room.connectAudience(fan);
  const view = env.lastState(fan);
  assert.deepEqual(view.audience, { name: 'Nine', color: res.member.color, points: 0, hits: 0, pick: null });
  assert.equal(view.players.length, 8, 'not a player');
  assert.equal(env.lastState(ids[0]).crowd, 1, 'players see the audience count');
  assert.ok(sent.some((m) => m.pid === fan && m.event === 'chatHistory'));

  room.updateSettings(ids[0], { rounds: 2 });
  const w = startAndChoose(env, 'hard');
  const st = env.lastState(fan);
  assert.equal(st.turn.word, null);
  assert.equal(st.turn.mask.length, Array.from(w).length);
  assert.equal(room.chat(fan, w).error, 'Not in room.', 'no guessing or chatting');
  assert.equal(room.draw(fan, { t: 'b', id: 1, c: 0, s: 10, p: [1, 1] }), false);
  assert.equal(room.start(fan).error, 'Only the host can start the game.');
  sent.length = 0;
  assert.ok(room.react(fan, 'love').ok);
  assert.equal(sent.find((m) => m.pid === ids[0] && m.event === 'reaction').data.name, 'Nine');
  const drawer = room.turn.drawerId;
  room.draw(drawer, { t: 'b', id: 1, c: 0, s: 10, p: [10, 10, 20, 20] });
  assert.ok(sent.some((m) => m.pid === fan && m.event === 'draw'), 'sees the drawing live');

  // Refresh: the same browser token gets the same audience spot back.
  room.disconnectAudience(fan);
  assert.equal(env.lastState(ids[0]).crowd, 0);
  const back = manager.resume(room.code, 'token-ninth-person');
  assert.equal(back.member.id, fan);
  room.connectAudience(fan);
  assert.equal(env.lastState(ids[0]).crowd, 1);

  // After the game the audience votes for the Crowd favourite.
  while (room.phase !== 'gameOver') env.run(90000, 1000);
  assert.ok(room.gallery.length >= 1);
  assert.equal(room.like(fan, 0).count, 1);
  assert.deepEqual(sent.filter((m) => m.pid === fan && m.event === 'likes').at(-1).data.mine, [0]);

  // Gone for longer than the seat hold: their spot is dropped.
  room.disconnectAudience(fan);
  env.run(61000, 1000);
  assert.equal(room.audience.size, 0);
});

test('audience: takes a free seat in the lobby; the host can remove them; capped at 50', () => {
  const env = setup({ players: 2 });
  const { room, ids, manager } = env;
  const res = manager.joinAudience(room.code, 'token-watcher-1', 'Watcher');
  room.connectAudience(res.member.id);
  // A seat is free, so joining as a player takes it and leaves the audience.
  const seat = manager.join(room.code, 'token-watcher-1', 'Watcher');
  assert.ok(seat.player);
  assert.equal(room.audience.size, 0);
  assert.equal(room.players.length, 3);
  // Someone who already has a seat stays a player.
  assert.ok(manager.joinAudience(room.code, 'token-watcher-1', 'Watcher').player);

  const fan = manager.joinAudience(room.code, 'token-watcher-2', 'Heckler').member;
  room.connectAudience(fan.id);
  assert.ok(room.kick(ids[0], fan.id).ok);
  assert.equal(room.audience.size, 0);
  assert.equal(manager.joinAudience(room.code, 'token-watcher-2', 'Heckler').error, 'The host removed you from this room.');

  for (let i = 0; i < 50; i++) assert.ok(manager.joinAudience(room.code, `token-crowd-${i}`, `Fan ${i}`).member);
  assert.match(manager.joinAudience(room.code, 'token-crowd-51', 'Late').error, /audience is full/);
});

test('share links: the server makes an empty room; the first to join hosts; unused ones close', () => {
  const { MAX_EMPTY_ROOMS } = require('../server/game');
  const env = setup({ players: 1, timing: { roomIdleMs: 30 * 60 * 1000 } });
  const { manager } = env;
  const made = manager.createEmptyRoom();
  const code = made.room.code;
  assert.match(code, /^[A-HJKMNP-Z]{4}$/);
  assert.equal(made.room.players.length, 0);
  const tv = manager.watch(code);
  assert.ok(tv.id, 'a TV can show it before anyone joins');
  const first = manager.join(code, 'token-link-first', 'First');
  made.room.connect(first.player.id);
  assert.equal(made.room.hostId, first.player.id);
  const second = manager.join(code, 'token-link-second', 'Second');
  assert.notEqual(made.room.hostId, second.player.id);

  // Nobody ever joins: it closes like any empty room.
  const unused = manager.createEmptyRoom().room.code;
  env.run(31 * 60 * 1000, 60000);
  assert.equal(manager.getRoom(unused), null);

  // Too many waiting rooms at once is refused.
  for (let i = 0; i < MAX_EMPTY_ROOMS; i++) manager.createEmptyRoom();
  assert.match(manager.createEmptyRoom().error, /Try again/);
});

test('game over: any player can play again after 30 s; "did you have fun?" votes and stats', () => {
  const env = setup({ players: 3 });
  const { room, ids, manager } = env;
  const fan = manager.joinAudience(room.code, 'token-fun-fan', 'Fan').member;
  room.connectAudience(fan.id);
  room.updateSettings(ids[0], { rounds: 2, chaos: true });
  assert.equal(room.feedback(ids[1], 3).error, 'You can vote after the game.');
  room.start(ids[0]);
  assert.equal(manager.stats.gamesStarted, 1);
  assert.equal(manager.stats.chaosGames, 1);
  while (room.phase !== 'gameOver') env.run(1000, 1000);
  assert.equal(manager.stats.gamesFinished, 1);
  assert.equal(manager.stats.players, 3);

  // Only the host at first...
  assert.equal(room.playAgain(ids[1]).error, 'Only the host can restart.');
  const view = env.lastState(ids[1]);
  assert.equal(view.anyoneRestartMs, 30000);
  assert.ok(view.gameOverAt);

  // Votes: players and the audience, one each (changing your mind replaces it).
  assert.ok(room.feedback(ids[1], 3).ok);
  assert.ok(room.feedback(ids[1], 2).ok);
  assert.ok(room.feedback(ids[2], 3).ok);
  assert.ok(room.feedback(fan.id, 1).ok);
  assert.equal(room.feedback(ids[0], 5).error, 'Bad vote.');
  assert.deepEqual(manager.stats.fun, { 1: 1, 2: 1, 3: 1 });

  // ...then anyone (but not the audience) after 30 s.
  env.run(30000, 1000);
  assert.equal(room.playAgain(fan.id).error, 'Only the host can restart.');
  assert.ok(room.playAgain(ids[2]).ok);
  assert.equal(room.phase, 'lobby');
});

// ---------------------------------------------------------------------------
// Impostor mode

// The current artist adds one line (any player can be passed; only the artist's line counts).
function line(room, pid, id = 1, x = 100) {
  const a = room.draw(pid, { t: 'b', id, c: 5, s: 48, p: [x, 100, x + 50, 150] });
  const b = room.draw(pid, { t: 'e', id, p: [x + 80, 200] });
  const c = room.draw(pid, { t: 'x', id });
  return a && b && c;
}

function sketchAll(env) {
  const { room } = env;
  while (room.phase === 'sketch') {
    assert.ok(line(room, room.turn.artistId, room.turn.step + 1));
    env.run(800);
  }
}

test('impostor mode: one line each for two laps, the word hidden from the impostor, then a vote', () => {
  const env = setup({ players: 4 });
  const { room, ids, manager } = env;
  const tv = manager.watch(room.code);
  room.connectWatcher(tv.id);
  const fan = manager.joinAudience(room.code, 'token-fan-imp', 'Fan').member;
  room.connectAudience(fan.id);
  room.updateSettings(ids[0], { mode: 'impostor', rounds: 2 });
  assert.ok(room.start(ids[0]).ok);
  assert.equal(room.phase, 'sketch');
  const t = room.turn;
  assert.notEqual(t.order[0], t.impostorId, 'the impostor never draws first');
  assert.equal(t.steps, 8);

  // Everyone but the impostor sees the word; all see the category.
  for (const id of ids) {
    const v = env.lastState(id).turn;
    assert.equal(v.category.length > 0, true);
    if (id === t.impostorId) {
      assert.equal(v.word, null);
      assert.equal(v.role, 'impostor');
    } else {
      assert.equal(v.word, t.word);
      assert.equal(v.role, 'artist');
    }
  }
  assert.equal(env.lastState(tv.id).turn.word, null);
  assert.equal(env.lastState(fan.id).turn.word, null);
  assert.equal(env.lastState(fan.id).turn.role, 'watcher');

  // Only the artist draws, one line, in their own ink and a fixed brush; no fill, undo or clear.
  const artist = t.artistId;
  const other = ids.find((id) => id !== artist);
  assert.equal(line(room, other), false);
  assert.equal(room.draw(artist, { t: 'f', x: 5, y: 5, c: 3 }), false);
  assert.equal(room.draw(artist, { t: 'c' }), false);
  assert.equal(room.draw(artist, { t: 'u' }), false);
  assert.ok(line(room, artist, 7));
  assert.equal(room.draw(artist, { t: 'b', id: 8, c: 0, s: 4, p: [1, 1] }), false, 'one line only');
  assert.deepEqual([t.ops[0].c, t.ops[0].s], [t.inks[artist], 10]);
  const seen = env.sent.filter((m) => m.pid === other && m.event === 'draw').map((m) => m.data.t);
  assert.deepEqual(seen, ['b', 'e', 'x']);
  env.run(800);
  assert.equal(room.turn.step, 1, 'next artist after a short beat');

  // A turn nobody draws in times out; the rest draw, then the vote starts.
  env.run(20000 + 200);
  assert.equal(room.turn.step, 2);
  sketchAll(env);
  assert.equal(room.phase, 'vote');
  assert.equal(t.ops.filter((o) => o.t === 's').length, 7);

  // Votes: not for yourself; others see who voted, not whom.
  assert.equal(room.vote(ids[0], ids[0]).error, "You can't vote for yourself.");
  assert.equal(room.vote(fan.id, ids[1]).error, 'Only players can vote.');
  const innocent = ids.filter((id) => id !== t.impostorId);
  room.vote(innocent[0], t.impostorId);
  const v = env.lastState(innocent[1]).turn;
  assert.deepEqual(v.voted, [innocent[0]]);
  assert.equal(v.myVote, null);
  assert.equal(v.votes, undefined);

  // Caught (clear majority) -> the impostor's last chance; a wrong guess means the artists win.
  room.vote(innocent[1], t.impostorId);
  room.vote(innocent[2], innocent[0]);
  room.vote(t.impostorId, innocent[1]);
  assert.equal(room.phase, 'lastChance');
  assert.equal(env.lastState(t.impostorId).turn.word, null, 'still hidden from the impostor');
  assert.equal(env.lastState(t.impostorId).turn.caughtId, t.impostorId);
  const before = room.players.map((p) => p.score);
  assert.equal(room.chat(t.impostorId, 'definitely not it').correct, false);
  assert.equal(room.phase, 'unmask');
  const after = room.players.map((p) => p.score);
  const pts = Object.fromEntries(room.players.map((p, i) => [p.id, after[i] - before[i]]));
  assert.equal(pts[t.impostorId], 0);
  assert.equal(pts[innocent[0]], 200); // spotted them + the artists win
  assert.equal(pts[innocent[1]], 200);
  assert.equal(pts[innocent[2]], 100); // voted wrong, but the team won
  const u = env.lastState(fan.id).turn;
  assert.equal(u.word, t.word);
  assert.equal(u.impostorId, t.impostorId);
  assert.equal(u.outcome, 'caught');
  assert.equal(room.gallery.at(-1).impostor.id, t.impostorId);

  // Round 2 has a different impostor; after it, game over with impostor awards.
  env.run(9000 + 200);
  assert.equal(room.phase, 'sketch');
  assert.equal(room.round, 2);
  assert.notEqual(room.turn.impostorId, t.impostorId);
  const t2 = room.turn;
  sketchAll(env);
  // A tie: nobody is caught, so the impostor escapes.
  const inn2 = ids.filter((id) => id !== t2.impostorId);
  room.vote(inn2[0], inn2[1]);
  room.vote(inn2[1], inn2[0]);
  room.vote(inn2[2], t2.impostorId);
  room.vote(t2.impostorId, inn2[2]);
  assert.equal(room.phase, 'unmask');
  assert.equal(room.turn.outcome, 'escaped');
  assert.equal(room.turn.points[t2.impostorId], 300);
  env.run(9000 + 200);
  assert.equal(room.phase, 'gameOver');
  const titles = room.awards.map((a) => a.title);
  assert.ok(titles.includes('Master of disguise') && titles.includes('Sharp eye'), titles.join());
  assert.equal(room.gallery.length, 2);
});

test('impostor mode: needs 3 players; a right guess steals the win; nobody can give the word away', () => {
  const env = setup({ players: 3 });
  const { room, ids } = env;
  room.updateSettings(ids[0], { mode: 'impostor', rounds: 2 });
  room.disconnect(ids[2]);
  assert.match(room.start(ids[0]).error, /at least 3 players/);
  const back = env.join('token-player-2', 'Player 2');
  assert.equal(back.id, ids[2]);
  assert.ok(room.start(ids[0]).ok);
  const t = room.turn;
  const innocent = ids.filter((id) => id !== t.impostorId);
  // Artists can't type the word (or something containing it); the impostor's chat always goes through.
  assert.equal(room.chat(innocent[0], `is it ${t.word}?`).error, 'Careful, that gives the word away!');
  assert.ok(room.chat(innocent[0], 'nice line!').ok);
  assert.ok(room.chat(t.impostorId, t.word).ok);
  sketchAll(env);
  room.vote(innocent[0], t.impostorId);
  room.vote(innocent[1], t.impostorId);
  room.vote(t.impostorId, innocent[0]);
  assert.equal(room.phase, 'lastChance');
  // Only the impostor's guess counts, and only once.
  assert.equal(room.impostorGuess(innocent[0], t.word).error, 'Not your guess to make.');
  assert.equal(room.chat(t.impostorId, t.word.toUpperCase()).correct, true);
  assert.equal(room.turn.outcome, 'stole');
  assert.equal(room.turn.points[t.impostorId], 200);
  assert.equal(room.turn.points[innocent[0]], 100);
  assert.match(env.chats(innocent[0]).at(-1).text, /guessed the word!/);
});

test('impostor mode: players leaving (artist, impostor, too few) and bots playing along', () => {
  const env = setup({ players: 4 });
  const { room, ids } = env;
  room.updateSettings(ids[0], { mode: 'impostor', rounds: 3 });
  room.start(ids[0]);
  let t = room.turn;
  // The artist leaves mid-turn: the next player goes.
  const artist = t.artistId;
  room.draw(artist, { t: 'b', id: 1, c: 0, s: 10, p: [10, 10] });
  const step = t.step;
  if (artist !== ids[0]) {
    room.leave(artist);
    assert.equal(room.turn.step, step + 1);
    assert.ok(t.ops[0] && t.ops[0].open === false, 'their line is closed off');
  }
  // The impostor leaves: the round ends and is unmasked.
  t = room.turn;
  if (t.impostorId !== ids[0] && room.players.length > 3) {
    room.leave(t.impostorId);
    assert.equal(room.phase, 'unmask');
    assert.equal(room.turn.outcome, 'left');
  }
  // Fewer than 3 players: back to the lobby.
  while (room.players.length > 2) room.leave(room.players.at(-1).id);
  assert.equal(room.phase, 'lobby');
  assert.match(room.notice, /needs 3 players/);

  // One person and two bots play a whole game: bots draw lines, vote and guess.
  for (let seed = 1; seed <= 4; seed++) {
    const solo = setup({ players: 1, seed });
    solo.room.addBot(solo.ids[0]);
    solo.room.addBot(solo.ids[0]);
    solo.room.updateSettings(solo.ids[0], { mode: 'impostor', rounds: 3, pack: seed % 2 ? 'mixed' : 'spanish' });
    assert.ok(solo.room.start(solo.ids[0]).ok);
    const me = solo.ids[0];
    let guard = 0;
    while (solo.room.phase !== 'gameOver' && guard++ < 2000) {
      const rt = solo.room.turn;
      if (solo.room.phase === 'sketch' && rt.artistId === me && !rt.lineDone) line(solo.room, me, rt.step + 1);
      if (solo.room.phase === 'vote' && !rt.votes.has(me)) solo.room.vote(me, solo.room.players.find((p) => p.id !== me).id);
      if (solo.room.phase === 'lastChance' && rt.impostorId === me) solo.room.chat(me, 'banana');
      solo.run(500);
    }
    assert.equal(solo.room.phase, 'gameOver', `seed ${seed}`);
    assert.equal(solo.room.gallery.length, 3);
    for (const d of solo.room.gallery) assert.ok(d.ops.length >= 5, `${d.word}: ${d.ops.length} lines`);
    assert.ok(solo.room.players.some((p) => p.score > 0));
  }
});

// ---------------------------------------------------------------------------
// Audience predictions

test('audience predictions: who guesses first, who the impostor is; points and a crowd top 3', () => {
  const env = setup({ players: 3 });
  const { room, ids, manager } = env;
  const fans = ['A', 'B', 'C'].map((n) => {
    const m = manager.joinAudience(room.code, `token-fan-${n}-x`, `Fan ${n}`).member;
    room.connectAudience(m.id);
    return m;
  });
  assert.equal(room.predict(fans[0].id, ids[1]).error, 'Predictions are closed right now.');
  room.start(ids[0]);
  const t = room.turn;
  const guessers = ids.filter((id) => id !== t.drawerId);
  assert.equal(room.predict(ids[1], ids[2]).error, 'Predictions are for the audience.');
  assert.equal(room.predict(fans[0].id, t.drawerId).error, 'Pick one of the players.');
  assert.ok(room.predict(fans[0].id, guessers[0]).ok); // while the word is being picked
  assert.ok(room.predict(fans[1].id, guessers[1]).ok);
  assert.ok(room.predict(fans[2].id, guessers[1]).ok);
  assert.ok(room.predict(fans[2].id, guessers[0]).ok); // changed their mind
  assert.deepEqual(env.lastState(ids[0]).turn.crowdPicks, { [guessers[0]]: 2, [guessers[1]]: 1 });
  assert.equal(env.lastState(fans[2].id).audience.pick, guessers[0]);
  room.chooseWord(t.drawerId, 0);
  room.chat(guessers[0], t.word);
  // Locked after the first correct guess.
  assert.equal(room.predict(fans[1].id, guessers[0]).error, 'Predictions are closed right now.');
  assert.equal(env.lastState(fans[0].id).audience.points, 100);
  assert.equal(env.lastState(fans[1].id).audience.points, 0);
  assert.deepEqual(env.lastState(ids[0]).crowdTop.map((f) => f.points), [100, 100]);

  // Classic picks also close a few seconds into the drawing.
  while (room.phase !== 'choosing') env.run(1000);
  room.chooseWord(room.turn.drawerId, 0);
  env.run(13000);
  assert.equal(room.predict(fans[1].id, room.players.find((p) => p.id !== room.turn.drawerId).id).error, 'Predictions are closed right now.');

  // Impostor mode: pick the impostor during the drawing or the vote.
  const env2 = setup({ players: 3 });
  const fan = env2.manager.joinAudience(env2.room.code, 'token-fan-imp-2', 'Sherlock').member;
  env2.room.connectAudience(fan.id);
  env2.room.updateSettings(env2.ids[0], { mode: 'impostor', rounds: 2 });
  env2.room.start(env2.ids[0]);
  const t2 = env2.room.turn;
  assert.ok(env2.room.predict(fan.id, t2.impostorId).ok);
  sketchAll(env2);
  for (const id of env2.ids) env2.room.vote(id, env2.ids.find((x) => x !== id));
  assert.equal(env2.room.phase, 'unmask');
  assert.equal(env2.lastState(fan.id).audience.points, 150);
  assert.equal(env2.manager.stats.predictions, 1);
});
