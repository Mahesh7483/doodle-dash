'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const { RoomManager, normalizeCode, validCode } = require('./game');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// Timer overrides (used by the automated tests to play a whole game in seconds).
function timingFromEnv(env = process.env) {
  const t = {};
  const map = {
    DD_CHOOSE_MS: 'chooseMs',
    DD_REVEAL_MS: 'revealMs',
    DD_DRAW_MS: 'drawMs',
    DD_DRAWER_GRACE_MS: 'drawerGraceMs',
    DD_HOST_GRACE_MS: 'hostGraceMs',
    DD_SEAT_HOLD_MS: 'seatHoldMs',
  };
  for (const [key, field] of Object.entries(map)) {
    const n = Number(env[key]);
    if (env[key] != null && Number.isFinite(n) && n > 0) t[field] = n;
  }
  return t;
}

function createServer(options = {}) {
  const app = express();
  app.set('trust proxy', true);
  app.disable('x-powered-by');

  const server = http.createServer(app);
  const io = new Server(server, {
    maxHttpBufferSize: 64 * 1024,
    pingInterval: 10000,
    pingTimeout: 10000,
    connectionStateRecovery: undefined,
  });

  const sockets = new Map(); // playerId -> socket
  const send = (pid, event, payload) => {
    const s = sockets.get(pid);
    if (s) s.emit(event, payload);
  };
  const manager = new RoomManager({
    send,
    timing: { ...timingFromEnv(), ...(options.timing || {}) },
    now: options.now,
    rng: options.rng,
  });

  // ---------------------------------------------------------------- HTTP

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  app.get('/healthz', (req, res) => {
    res.status(200).type('text/plain').send('ok');
  });

  app.get('/qr/:file', async (req, res) => {
    const m = /^([A-Za-z]{4})\.svg$/.exec(req.params.file);
    const code = m ? normalizeCode(m[1]) : '';
    if (!validCode(code)) return res.status(404).type('text/plain').send('Not found');
    const url = `${req.protocol}://${req.get('host')}/r/${code}`;
    try {
      const svg = await QRCode.toString(url, {
        type: 'svg',
        margin: 1,
        errorCorrectionLevel: 'M',
        color: { dark: '#1d1a2b', light: '#ffffff' },
      });
      res.type('image/svg+xml').set('Cache-Control', 'public, max-age=3600').send(svg);
    } catch (err) {
      res.status(500).type('text/plain').send('QR error');
    }
  });

  // index.html with an absolute link-preview image (chat apps ignore relative ones) and,
  // for invite links, a preview title naming the room.
  const indexHtml = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  const sendIndex = (req, res) => {
    const host = /^[A-Za-z0-9.:-]+$/.test(req.get('host') || '') ? req.get('host') : 'localhost';
    let html = indexHtml.replace('content="/og.png"', `content="${req.protocol}://${host}/og.png"`);
    const code = req.params.code ? normalizeCode(req.params.code) : '';
    if (validCode(code)) {
      html = html.replace(
        '<meta property="og:title" content="Doodle Dash — draw, guess, laugh">',
        `<meta property="og:title" content="Join my Doodle Dash room ${code}!">`
      );
    }
    res.set('Cache-Control', 'no-cache').type('html').send(html);
  };
  app.get('/', sendIndex);
  app.get('/index.html', sendIndex);
  app.get('/r/:code', sendIndex);

  app.use(
    '/fonts',
    express.static(path.join(PUBLIC_DIR, 'fonts'), { maxAge: '30d', immutable: true })
  );
  app.use(
    express.static(PUBLIC_DIR, {
      setHeaders(res) {
        res.setHeader('Cache-Control', 'no-cache');
      },
    })
  );
  app.use((req, res) => res.status(404).type('text/plain').send('Not found'));

  // ---------------------------------------------------------------- Sockets

  io.on('connection', (socket) => {
    socket.data.pid = null;
    socket.data.code = null;
    let createTimes = [];
    let joinTimes = [];

    const reply = (ack, payload) => {
      if (typeof ack === 'function') ack(payload);
    };
    const current = () => {
      const room = socket.data.code ? manager.getRoom(socket.data.code) : null;
      const pid = socket.data.pid;
      if (!room || !pid || !room.get(pid) || sockets.get(pid) !== socket) return null;
      return { room, pid };
    };

    // Leave whatever seat this socket currently holds (switching rooms from the same tab).
    const detach = () => {
      const cur = current();
      if (cur) {
        sockets.delete(cur.pid);
        cur.room.leave(cur.pid);
      }
      socket.data.pid = null;
      socket.data.code = null;
    };

    const bind = (room, player) => {
      const cur = current();
      if (cur && cur.pid !== player.id) detach();
      const prev = sockets.get(player.id);
      if (prev && prev !== socket) {
        prev.data.pid = null;
        prev.data.code = null;
        prev.emit('replaced');
        prev.disconnect(true);
      }
      sockets.set(player.id, socket);
      socket.data.pid = player.id;
      socket.data.code = room.code;
      room.connect(player.id);
    };

    socket.on('time', (ack) => reply(ack, Date.now()));

    socket.on('room:create', (data, ack) => {
      const now = Date.now();
      createTimes = createTimes.filter((t) => now - t < 60000);
      if (createTimes.length >= 6) return reply(ack, { error: 'Too many rooms — try again in a minute.' });
      createTimes.push(now);
      const { name, token } = data || {};
      const res = manager.createRoom(token, name);
      if (res.error) return reply(ack, { error: res.error });
      reply(ack, { ok: true, code: res.room.code, playerId: res.player.id });
      bind(res.room, res.player);
    });

    socket.on('room:join', (data, ack) => {
      // Enough for typos, too slow to scan for room codes.
      const now = Date.now();
      joinTimes = joinTimes.filter((t) => now - t < 60000);
      if (joinTimes.length >= 20) return reply(ack, { error: 'Too many tries — wait a minute and check the code.' });
      joinTimes.push(now);
      const { name, token, code } = data || {};
      const res = manager.join(code, token, name);
      if (res.error) return reply(ack, { error: res.error });
      reply(ack, { ok: true, code: res.room.code, playerId: res.player.id, resumed: res.resumed });
      bind(res.room, res.player);
    });

    socket.on('room:resume', (data, ack) => {
      const { token, code } = data || {};
      const res = manager.resume(code, token);
      if (res.error) return reply(ack, { error: res.error });
      reply(ack, { ok: true, code: res.room.code, playerId: res.player.id });
      bind(res.room, res.player);
    });

    socket.on('room:leave', (ack) => {
      detach();
      reply(ack, { ok: true });
    });

    socket.on('settings', (patch, ack) => {
      const cur = current();
      if (!cur) return reply(ack, { error: 'Not in a room.' });
      reply(ack, cur.room.updateSettings(cur.pid, patch));
    });

    socket.on('bot:add', (ack) => {
      const cur = current();
      if (!cur) return reply(ack, { error: 'Not in a room.' });
      reply(ack, cur.room.addBot(cur.pid));
    });

    socket.on('bot:remove', (botId, ack) => {
      const cur = current();
      if (!cur) return reply(ack, { error: 'Not in a room.' });
      reply(ack, cur.room.removeBot(cur.pid, String(botId)));
    });

    socket.on('start', (ack) => {
      const cur = current();
      if (!cur) return reply(ack, { error: 'Not in a room.' });
      reply(ack, cur.room.start(cur.pid));
    });

    socket.on('choose', (index, ack) => {
      const cur = current();
      if (!cur) return reply(ack, { error: 'Not in a room.' });
      reply(ack, cur.room.chooseWord(cur.pid, index));
    });

    socket.on('draw', (op) => {
      const cur = current();
      if (cur) cur.room.draw(cur.pid, op);
    });

    socket.on('chat', (text, ack) => {
      const cur = current();
      if (!cur) return reply(ack, { error: 'Not in a room.' });
      reply(ack, cur.room.chat(cur.pid, text));
    });

    socket.on('react', (emoji, ack) => {
      const cur = current();
      if (!cur) return reply(ack, { error: 'Not in a room.' });
      reply(ack, cur.room.react(cur.pid, String(emoji)));
    });

    socket.on('playAgain', (ack) => {
      const cur = current();
      if (!cur) return reply(ack, { error: 'Not in a room.' });
      reply(ack, cur.room.playAgain(cur.pid));
    });

    socket.on('disconnect', () => {
      const cur = current();
      if (!cur) return;
      sockets.delete(cur.pid);
      cur.room.disconnect(cur.pid);
    });
  });

  const tickMs = options.tickMs || 100;
  const ticker = setInterval(() => {
    try {
      manager.tick();
    } catch (err) {
      console.error('tick error', err);
    }
  }, tickMs);
  ticker.unref();

  function listen(port = process.env.PORT || 3000) {
    return new Promise((resolve) => {
      server.listen(port, () => resolve(server.address().port));
    });
  }

  async function close() {
    clearInterval(ticker);
    io.close();
    await new Promise((resolve) => server.close(() => resolve()));
  }

  return { app, server, io, manager, listen, close };
}

if (require.main === module) {
  const { listen } = createServer();
  listen().then((port) => {
    console.log(`Doodle Dash listening on http://localhost:${port}`);
  });
}

module.exports = { createServer, timingFromEnv };
