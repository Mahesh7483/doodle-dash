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
  assert.deepEqual(sync.data.ops, [{ t: 's', id: 1, c: 0, s: 10, p: [10, 10, 20, 20, 30, 30] }]);
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

test('word packs: 5 packs with 90+ words split into easy/medium/hard, Mixed has them all', () => {
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
  assert.deepEqual(PACK_IDS, ['everyday', 'animals', 'food', 'places', 'actions', 'mixed', 'custom']);
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
  assert.deepEqual(room.settings, { rounds: 3, drawTime: 80, pack: 'mixed' });
  room.updateSettings(ids[0], { rounds: 9, drawTime: 75, pack: 'nope' });
  assert.deepEqual(room.settings, { rounds: 3, drawTime: 80, pack: 'mixed' });
  room.updateSettings(ids[0], { rounds: 5, drawTime: 100, pack: 'food' });
  assert.deepEqual(room.settings, { rounds: 5, drawTime: 100, pack: 'food' });
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
