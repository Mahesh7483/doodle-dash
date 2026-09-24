'use strict';

// SPEC 7.3: a scripted 3-player game over real sockets, against the real server process
// started with short test timers (env overrides), run all the way to gameOver.
// Checks every score against the formula and re-runs the leak check at the socket level.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawn } = require('child_process');
const { io } = require('socket.io-client');

const DRAW_MS = 2500;
const CHOOSE_MS = 2000;
const REVEAL_MS = 300;
const ROUNDS = 2;

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
      env: { ...process.env, PORT: '0', DD_DRAW_MS: String(DRAW_MS), DD_CHOOSE_MS: String(CHOOSE_MS), DD_REVEAL_MS: String(REVEAL_MS) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
      const m = /localhost:(\d+)/.exec(out);
      if (m) resolve({ child, url: `http://localhost:${m[1]}` });
    });
    child.stderr.on('data', (d) => process.stderr.write(d));
    child.on('exit', (code) => reject(new Error(`server exited ${code}`)));
    setTimeout(() => reject(new Error('server did not start')), 10000);
  });
}

function textValues(v, out = [], key = '') {
  const ENUM_KEYS = new Set(['kind', 'sub', 'color', 'id', 'from', 'me', 'hostId', 'drawerId', 'code', 'pack', 'phase', 'reason', 'difficulty', 't', 'chaos']);
  if (typeof v === 'string') {
    if (!ENUM_KEYS.has(key)) out.push(v);
  } else if (Array.isArray(v)) {
    if (v.length && v.every((c) => c === null || (typeof c === 'string' && c.length === 1))) out.push(v.map((c) => c ?? '_').join(''));
    else for (const x of v) textValues(x, out, key);
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) textValues(x, out, k);
  }
  return out;
}

function containsWord(payload, word) {
  const esc = word.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|[^\\p{L}])${esc}($|[^\\p{L}])`, 'iu');
  return textValues(payload).some((s) => re.test(s));
}

const guesserPoints = (left, d, mult) => Math.round((100 + (200 * Math.max(0, Math.min(d, left))) / d) * mult);

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = io(url, { transports: ['websocket'], forceNew: true, reconnection: false });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

const ask = (socket, event, ...args) => new Promise((resolve) => socket.emit(event, ...args, resolve));

test('3 players play a full game over sockets; scores match the formula; no leaks', { timeout: 90000 }, async (t) => {
  const { child, url } = await startServer();
  t.after(() => child.kill());

  const names = ['Ana', 'Ben', 'Cy'];
  const players = [];
  for (let i = 0; i < 3; i++) {
    const socket = await connect(url);
    const p = { i, name: names[i], token: `integration-token-${i}-${Date.now()}`, socket, log: [], state: null, id: null };
    socket.onAny((event, data) => p.log.push({ event, data: JSON.parse(JSON.stringify(data ?? null)) }));
    players.push(p);
  }

  // Create + join (P2 uses lowercase code to check case-insensitivity).
  const created = await ask(players[0].socket, 'room:create', { name: 'Ana', token: players[0].token });
  assert.ok(created.ok, JSON.stringify(created));
  const code = created.code;
  assert.match(code, /^[A-HJKMNP-Z]{4}$/);
  players[0].id = created.playerId;
  const j1 = await ask(players[1].socket, 'room:join', { name: 'Ben', token: players[1].token, code });
  const j2 = await ask(players[2].socket, 'room:join', { name: 'Cy', token: players[2].token, code: code.toLowerCase() });
  assert.ok(j1.ok && j2.ok);
  players[1].id = j1.playerId;
  players[2].id = j2.playerId;

  // A TV screen watches the whole game.
  const tv = { socket: await connect(url), log: [] };
  tv.socket.onAny((event, data) => tv.log.push({ event, data: JSON.parse(JSON.stringify(data ?? null)) }));
  const watching = await ask(tv.socket, 'room:watch', { code: code.toLowerCase() });
  assert.ok(watching.ok, JSON.stringify(watching));
  assert.equal(watching.code, code);

  const byId = (id) => players.find((p) => p.id === id);
  const turns = new Map(); // turnId -> record
  let turnCount = 0;
  let gameOver;
  const done = new Promise((resolve) => (gameOver = resolve));
  const overSeen = new Set();

  tv.socket.on('gallery', () => {
    overSeen.add('tv');
    if (overSeen.size === 4) gameOver();
  });
  for (const p of players) {
    // Done once everyone (and the TV) has the gallery (it follows the gameOver state).
    p.socket.on('gallery', () => {
      overSeen.add(p.i);
      if (overSeen.size === 4) gameOver();
    });
    p.socket.on('state', (s) => {
      p.state = s;
      const turn = s.turn;
      if (!turn || turn.drawerId !== p.id) return;
      let rec = turns.get(turn.id);
      if (!rec) {
        rec = { id: turn.id, k: turnCount++, drawerId: p.id, words: new Set(), guesses: [], started: false, reveal: null, opsSent: 0 };
        turns.set(turn.id, rec);
      }
      if (s.phase === 'choosing' && turn.choices) {
        for (const c of turn.choices) rec.words.add(c.word);
        // Pattern 2: let the 15 s (here 2 s) choosing timer pick a random word.
        if (rec.k % 3 !== 2 && !rec.choseAt) {
          rec.choseAt = Date.now();
          // Choices are [easy, medium, hard]: pick hard, medium, -, easy, medium, -.
          const pick = rec.k % 3 === 1 ? 1 : rec.k < 3 ? 2 : 0;
          setTimeout(() => p.socket.emit('choose', pick, () => {}), 30);
        }
      }
      if (s.phase === 'drawing' && !rec.started) {
        rec.started = true;
        rec.word = turn.word;
        rec.mult = turn.mult;
        rec.difficulty = turn.difficulty;
        rec.drawMs = turn.drawTimeMs;
        rec.endsAt = s.endsAt;
        rec.words.add(turn.word);
        // Draw a little.
        p.socket.emit('draw', { t: 'b', id: 7, c: 0, s: 10, p: [100, 100, 120, 110] });
        p.socket.emit('draw', { t: 'e', id: 7, p: [140, 130, 160, 150] });
        p.socket.emit('draw', { t: 'x', id: 7 });
        p.socket.emit('draw', { t: 'f', x: 5, y: 5, c: 5 });
        rec.opsSent = 4;
        // Guess patterns: 0 = both guess (early end), 1 = one guesses, 2 = nobody guesses.
        const guessers = players.filter((q) => q.id !== p.id);
        // (Spaced out so nobody trips the ~3 messages/second chat limit across turns.)
        const plan = rec.k % 3 === 0 ? [[guessers[0], 150], [guessers[1], 700]] : rec.k % 3 === 1 ? [[guessers[1], 1300]] : [];
        for (const [g, delay] of plan) {
          setTimeout(async () => {
            g.socket.emit('chat', `${turn.word}zz`, () => {}); // not close, not correct
            const sentAt = Date.now();
            const res = await ask(g.socket, 'chat', turn.word.toUpperCase());
            rec.guesses.push({ id: g.id, sentAt, ackAt: Date.now(), res });
          }, delay);
        }
      }
      if (s.phase === 'reveal') rec.reveal = s.turn;
    });
  }

  await ask(players[0].socket, 'settings', { rounds: ROUNDS });
  const started = await ask(players[0].socket, 'start');
  assert.ok(started.ok, JSON.stringify(started));
  await done;

  // ---- turn order and coverage
  const recs = [...turns.values()].sort((a, b) => a.id - b.id);
  assert.equal(recs.length, 3 * ROUNDS, 'every player drew once per round');
  assert.deepEqual(recs.map((r) => byId(r.drawerId).name), ['Ana', 'Ben', 'Cy', 'Ana', 'Ben', 'Cy']);

  // ---- scores vs formula
  const expected = new Map(players.map((p) => [p.id, 0]));
  for (const r of recs) {
    assert.ok(r.reveal, `turn ${r.id} was revealed`);
    const pts = r.reveal.points;
    for (const g of r.guesses) assert.ok(!g.res.error, `guess rejected: ${g.res.error}`);
    const correct = r.guesses.filter((g) => g.res.correct);
    assert.equal(correct.length, [2, 1, 0][r.k % 3], `turn ${r.id} guess count`);
    for (const g of correct) {
      const guesser = byId(g.id);
      const you = guesser.log.find((m) => m.event === 'chat' && m.data.kind === 'you-correct' && m.data.text === r.word);
      assert.ok(you, 'guesser got a private "you guessed it"');
      const hi = guesserPoints(r.endsAt - g.sentAt, r.drawMs, r.mult);
      const lo = guesserPoints(r.endsAt - g.ackAt, r.drawMs, r.mult);
      assert.ok(you.data.points >= lo && you.data.points <= hi, `turn ${r.id}: ${you.data.points} within [${lo}, ${hi}]`);
      assert.equal(pts[g.id], you.data.points);
      expected.set(g.id, expected.get(g.id) + pts[g.id]);
    }
    const drawerPts = 50 * correct.length * r.mult;
    assert.equal(pts[r.drawerId] || 0, drawerPts, `drawer points turn ${r.id} (${r.difficulty})`);
    expected.set(r.drawerId, expected.get(r.drawerId) + drawerPts);
    assert.equal(r.reveal.reason, r.k % 3 === 0 ? 'allGuessed' : 'timeout');
  }
  assert.ok(recs.some((r) => r.mult === 2) && recs.some((r) => r.mult === 1.5) && recs.some((r) => r.mult === 1), 'all multipliers exercised');

  const final = players[0].state.players;
  for (const fp of final) assert.equal(fp.score, expected.get(fp.id), `${fp.name} final score`);
  assert.ok(final.some((fp) => fp.score > 0));

  // ---- gallery arrived for everyone with every drawing
  for (const p of players) {
    const g = p.log.filter((m) => m.event === 'gallery').at(-1);
    assert.ok(g, `${p.name} got the gallery`);
    assert.equal(g.data.drawings.length, recs.length);
    assert.deepEqual(g.data.drawings.map((d) => d.word), recs.map((r) => r.word));
  }

  // ---- drawing ops reached every guesser
  for (const r of recs) {
    for (const p of players.filter((q) => q.id !== r.drawerId)) {
      const syncOrLive = p.log.filter((m) => m.event === 'draw').length;
      assert.ok(syncOrLive >= r.opsSent, `${p.name} received drawing ops`);
    }
  }

  // ---- leak check: replay each client's own message stream
  let checked = 0;
  for (const p of players) {
    let phase = 'lobby';
    let turnId = null;
    let isDrawer = false;
    let guessed = false;
    for (const { event, data } of p.log) {
      if (event === 'state') {
        phase = data.phase;
        const newTurn = data.turn ? data.turn.id : null;
        if (newTurn !== turnId) guessed = false;
        turnId = newTurn;
        isDrawer = !!(data.turn && data.turn.drawerId === p.id);
        const me = data.players.find((x) => x.id === p.id);
        if (me && me.guessed) guessed = true;
      }
      if (event === 'chat' && data.kind === 'you-correct') guessed = true;
      const secret = (phase === 'choosing' || phase === 'drawing') && !isDrawer && !guessed && turns.get(turnId);
      if (!secret) continue;
      if (event === 'chat' && data.from === p.id) continue; // own message echoed back
      for (const w of secret.words) {
        assert.ok(!containsWord(data, w), `"${w}" leaked to ${p.name} in ${event}: ${JSON.stringify(data)}`);
        checked++;
      }
    }
  }
  assert.ok(checked > 50, `checked ${checked} payload/word pairs`);

  // ---- the TV saw the game like a guesser who never guesses
  let tvPhase = 'lobby';
  let tvTurn = null;
  let tvChecked = 0;
  for (const { event, data } of tv.log) {
    if (event === 'state') {
      assert.equal(data.watching, true);
      tvPhase = data.phase;
      tvTurn = data.turn ? data.turn.id : null;
    }
    const rec = (tvPhase === 'choosing' || tvPhase === 'drawing') && turns.get(tvTurn);
    if (!rec) continue;
    for (const w of rec.words) {
      assert.ok(!containsWord(data, w), `"${w}" leaked to the TV in ${event}: ${JSON.stringify(data)}`);
      tvChecked++;
    }
  }
  assert.ok(tvChecked > 30, `checked ${tvChecked} TV payload/word pairs`);
  assert.ok(tv.log.filter((m) => m.event === 'draw').length >= recs.length * 4, 'the TV got the drawing ops');
  assert.ok(tv.log.some((m) => m.event === 'chat' && m.data.kind === 'correct'), 'the TV shows who guessed');
  assert.ok(!tv.log.some((m) => m.event === 'chat' && ['private', 'close', 'you-correct'].includes(m.data.kind)), 'no private chat on the TV');
  const tvGallery = tv.log.filter((m) => m.event === 'gallery').at(-1);
  assert.deepEqual(tvGallery.data.drawings.map((d) => d.word), recs.map((r) => r.word));
  assert.equal(players[0].state.screens, 1, 'players see the TV');

  tv.socket.close();
  for (const p of players) p.socket.close();
});

test('9th player gets "Room is full"; bad codes are rejected', { timeout: 30000 }, async (t) => {
  const { child, url } = await startServer();
  t.after(() => child.kill());
  const sockets = [];
  const host = await connect(url);
  sockets.push(host);
  const created = await ask(host, 'room:create', { name: 'Host', token: 'full-test-token-0' });
  for (let i = 1; i < 8; i++) {
    const s = await connect(url);
    sockets.push(s);
    const r = await ask(s, 'room:join', { name: `P${i}`, token: `full-test-token-${i}`, code: created.code });
    assert.ok(r.ok);
  }
  const ninth = await connect(url);
  sockets.push(ninth);
  const refused = await ask(ninth, 'room:join', { name: 'Nine', token: 'full-test-token-9', code: created.code });
  assert.equal(refused.error, 'Room is full');
  assert.equal(refused.full, true);
  assert.match((await ask(ninth, 'room:join', { name: 'Nine', token: 'full-test-token-9', code: 'QQQQ' })).error, /not found/);

  // The 9th person joins the audience instead: they see the room and can react, but not chat.
  const audienceState = new Promise((resolve) => ninth.on('state', (st) => st.audience && resolve(st)));
  const inAudience = await ask(ninth, 'room:audience', { name: 'Nine', token: 'full-test-token-9', code: created.code });
  assert.ok(inAudience.ok && inAudience.audience, JSON.stringify(inAudience));
  const st = await audienceState;
  assert.equal(st.audience.name, 'Nine');
  assert.equal(st.players.length, 8);
  const hostSees = new Promise((resolve) => host.on('reaction', resolve));
  assert.ok((await ask(ninth, 'react', 'star')).ok);
  assert.equal((await hostSees).name, 'Nine');
  assert.equal((await ask(ninth, 'chat', 'hi')).error, 'Not in room.');

  // The host removes P1, who is told and can't come back in.
  const joinedP1 = await ask(sockets[1], 'room:join', { name: 'P1', token: 'full-test-token-1', code: created.code });
  const kickedEvent = new Promise((resolve) => sockets[1].once('kicked', resolve));
  assert.ok((await ask(host, 'kick', joinedP1.playerId)).ok);
  assert.deepEqual(await kickedEvent, { code: created.code });
  assert.equal((await ask(sockets[1], 'chat', 'still here?')).error, 'Not in a room.');
  assert.equal((await ask(sockets[1], 'room:join', { name: 'P1', token: 'full-test-token-1', code: created.code })).error, 'The host removed you from this room.');
  const seated = await ask(ninth, 'room:join', { name: 'Nine', token: 'full-test-token-9', code: created.code });
  assert.ok(seated.ok && !seated.resumed, 'someone in the audience takes the free seat');
  assert.equal((await ask(sockets[2], 'kick', created.playerId)).error, 'Only the host can remove players.');
  for (const s of sockets) s.close();
});

test('HTTP: health check, QR code, invite links, static files', { timeout: 20000 }, async (t) => {
  const { child, url } = await startServer();
  t.after(() => child.kill());
  const health = await fetch(`${url}/healthz`);
  assert.equal(health.status, 200);
  const qr = await fetch(`${url}/qr/ABCD.svg`);
  assert.equal(qr.status, 200);
  assert.match(qr.headers.get('content-type'), /image\/svg\+xml/);
  assert.match(await qr.text(), /<svg/);
  assert.equal((await fetch(`${url}/qr/AB1.svg`)).status, 404);
  const invite = await fetch(`${url}/r/abcd`);
  assert.equal(invite.status, 200);
  const html = await invite.text();
  assert.match(html, /Join my Doodle Dash room ABCD!/);
  assert.match(html, new RegExp(`content="${url}/og.png"`));
  const tvPage = await fetch(`${url}/tv/abcd`);
  assert.equal(tvPage.status, 200);
  assert.match(await tvPage.text(), /src="\/tv\.js"/);
  assert.equal((await fetch(`${url}/tv`)).status, 200);
  for (const f of ['/tv.js', '/tv.css', '/stickers.js', '/ui.js', '/', '/og.png', '/icon-192.png', '/manifest.webmanifest', '/app.js', '/canvas.js', '/style.css', '/sound.js', '/favicon.svg', '/socket.io/socket.io.min.js']) {
    assert.equal((await fetch(url + f)).status, 200, f);
  }
});
