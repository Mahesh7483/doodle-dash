'use strict';

// Load test: starts the real server, fills it with rooms of players and audience over
// Socket.IO, and has every room play at once (drawers stream strokes like a finger on a
// phone, guessers guess, everyone reacts). Reports how fast the server answers and what it
// costs in CPU and memory.
//
//   npm run loadtest                       # 40 rooms x (4 players + 2 audience), 30 s
//   ROOMS=80 AUDIENCE=10 SECONDS=60 npm run loadtest

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { io } = require('socket.io-client');

const ROOMS = Number(process.env.ROOMS || 40);
const PLAYERS = Number(process.env.PLAYERS || 4);
const AUDIENCE = Number(process.env.AUDIENCE || 2);
const SECONDS = Number(process.env.SECONDS || 30);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ask = (s, ev, ...a) => new Promise((r) => s.emit(ev, ...a, r));

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
      env: { ...process.env, PORT: '0', DD_CHOOSE_MS: '3000', DD_DRAW_MS: '20000', DD_REVEAL_MS: '2000' },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
      const m = /localhost:(\d+)/.exec(out);
      if (m) resolve({ child, url: `http://localhost:${m[1]}` });
    });
    child.on('exit', (code) => reject(new Error(`server exited ${code}`)));
  });
}

// CPU seconds and memory of the server process, from /proc (Linux).
function usage(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
    const ticks = Number(stat[11]) + Number(stat[12]);
    const rss = /VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8'))[1];
    return { cpu: ticks / 100, rssMb: Number(rss) / 1024 };
  } catch (_) {
    return null;
  }
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const s = io(url, { transports: ['websocket'], forceNew: true, reconnection: false });
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
}

const pct = (arr, p) => {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))];
};

(async () => {
  const { child, url } = await startServer();
  const sockets = [];
  const latencies = [];
  let received = 0;
  let drawSent = 0;
  let running = true;

  console.log(`Setting up ${ROOMS} rooms x (${PLAYERS} players + ${AUDIENCE} audience) = ${ROOMS * (PLAYERS + AUDIENCE)} sockets...`);
  for (let r = 0; r < ROOMS; r++) {
    const room = [];
    for (let i = 0; i < PLAYERS + AUDIENCE; i++) {
      const s = await connect(url);
      s.onAny(() => received++);
      sockets.push(s);
      room.push(s);
    }
    const token = (i) => `loadtest-${r}-${i}-${'x'.repeat(8)}`;
    const created = await ask(room[0], 'room:create', { name: `Host ${r}`, token: token(0) });
    for (let i = 1; i < PLAYERS; i++) await ask(room[i], 'room:join', { name: `P${i}`, token: token(i), code: created.code });
    for (let i = PLAYERS; i < PLAYERS + AUDIENCE; i++) await ask(room[i], 'room:audience', { name: `Fan${i}`, token: token(i), code: created.code });

    // Players: choose, draw (40 ms chunks of 6 points), guess every ~3 s, react now and then.
    for (let i = 0; i < PLAYERS; i++) {
      const s = room[i];
      let me = null;
      let drawingTurn = null;
      s.on('state', (st) => {
        me = st.me;
        const t = st.turn;
        if (!t) return;
        if (st.phase === 'choosing' && t.drawerId === me && t.choices) s.emit('choose', 0, () => {});
        if (st.phase === 'drawing' && t.drawerId === me && drawingTurn !== t.id) {
          drawingTurn = t.id;
          let id = 1;
          let n = 0;
          let x = 400;
          let y = 300;
          s.emit('draw', { t: 'b', id, c: 0, s: 10, p: [x, y] });
          const timer = setInterval(() => {
            if (!running || drawingTurn !== t.id) return clearInterval(timer);
            const p = [];
            for (let k = 0; k < 6; k++) {
              x = Math.max(0, Math.min(799, x + Math.round((Math.random() - 0.5) * 20)));
              y = Math.max(0, Math.min(599, y + Math.round((Math.random() - 0.5) * 20)));
              p.push(x, y);
            }
            s.emit('draw', { t: 'e', id, p });
            drawSent++;
            if (++n % 40 === 0) {
              s.emit('draw', { t: 'x', id });
              id++;
              s.emit('draw', { t: 'b', id, c: Math.floor(Math.random() * 12), s: 10, p: [x, y] });
            }
          }, 40);
        }
      });
      if (i === 0) await ask(s, 'start');
      (async () => {
        await sleep(Math.random() * 3000);
        while (running) {
          const t0 = performance.now();
          await ask(s, 'chat', `guess ${Math.floor(Math.random() * 1000)}`);
          latencies.push(performance.now() - t0);
          if (Math.random() < 0.3) s.emit('react', 'lol', () => {});
          await sleep(2500 + Math.random() * 1000);
        }
      })();
    }
    // Audience: react every few seconds.
    for (let i = PLAYERS; i < PLAYERS + AUDIENCE; i++) {
      const s = room[i];
      (async () => {
        while (running) {
          await sleep(2000 + Math.random() * 3000);
          const t0 = performance.now();
          await ask(s, 'react', 'fire');
          latencies.push(performance.now() - t0);
        }
      })();
    }
  }

  console.log(`All rooms playing. Measuring for ${SECONDS} s...`);
  await sleep(3000); // warm up
  latencies.length = 0;
  received = 0;
  drawSent = 0;
  const u0 = usage(child.pid);
  const t0 = Date.now();
  await sleep(SECONDS * 1000);
  const secs = (Date.now() - t0) / 1000;
  const u1 = usage(child.pid);
  running = false;

  const r = (v) => Math.round(v * 10) / 10;
  console.log('');
  console.log(`Rooms: ${ROOMS}, sockets: ${sockets.length} (${ROOMS * PLAYERS} players, ${ROOMS * AUDIENCE} audience)`);
  console.log(`Drawing chunks sent: ${Math.round(drawSent / secs)}/s, messages delivered to clients: ${Math.round(received / secs)}/s`);
  console.log(`Chat/reaction round trip: p50 ${r(pct(latencies, 50))} ms, p95 ${r(pct(latencies, 95))} ms, p99 ${r(pct(latencies, 99))} ms (${latencies.length} samples)`);
  if (u0 && u1) console.log(`Server CPU: ${r(((u1.cpu - u0.cpu) / secs) * 100)}% of one core, memory: ${Math.round(u1.rssMb)} MB`);

  for (const s of sockets) s.close();
  child.kill();
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
