// Drawing board shared by the game, the gallery and PNG export.
// Every client draws at the same fixed 800x600 internal resolution, so strokes and
// flood fills look the same on every screen; CSS scales the canvas to fit.

export const W = 800;
export const H = 600;

export const PALETTE = [
  '#1d1a2b', // ink
  '#8a8697', // grey
  '#ffffff', // white (also the eraser)
  '#e8384f', // red
  '#ff8a2a', // orange
  '#ffd23f', // yellow
  '#2bb673', // green
  '#5ec8f2', // sky
  '#2f6fe4', // blue
  '#8e5cf7', // purple
  '#ff7eb6', // pink
  '#8b5a3c', // brown
];
export const COLOR_NAMES = ['Black', 'Grey', 'White', 'Red', 'Orange', 'Yellow', 'Green', 'Sky blue', 'Blue', 'Purple', 'Pink', 'Brown'];
export const WHITE = 2;
export const BRUSH_SIZES = [4, 10, 24];
export const ERASER_SIZES = [10, 24, 48];
export const MAX_POINTS = 20000;

const BG = [255, 255, 255];
const RGB = PALETTE.map((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));

// ---------------------------------------------------------------------------
// Low-level rendering

function paintBackground(ctx) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

// Draw a stroke's segments starting at point index `from` (0 = include the starting dot).
// Live drawing and full redraws use the same per-segment calls, so they match exactly.
function drawStroke(ctx, op, from = 0) {
  const p = op.p;
  const n = p.length / 2;
  if (!n) return;
  ctx.strokeStyle = PALETTE[op.c] || PALETTE[0];
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = op.s;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (from === 0) {
    ctx.beginPath();
    ctx.arc(p[0], p[1], op.s / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = Math.max(1, from); i < n; i++) {
    ctx.beginPath();
    ctx.moveTo(p[2 * i - 2], p[2 * i - 1]);
    ctx.lineTo(p[2 * i], p[2 * i + 1]);
    ctx.stroke();
  }
}

// Scanline flood fill with a colour tolerance, then a 1px pass over the anti-aliased fringe
// so fills tuck neatly under the outline instead of leaving a light halo.
export function floodFill(ctx, x0, y0, colorIndex) {
  x0 = Math.max(0, Math.min(W - 1, x0 | 0));
  y0 = Math.max(0, Math.min(H - 1, y0 | 0));
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const start = (y0 * W + x0) * 4;
  const tr = d[start];
  const tg = d[start + 1];
  const tb = d[start + 2];
  const [fr, fg, fb] = RGB[colorIndex] || RGB[0];
  if (Math.abs(tr - fr) + Math.abs(tg - fg) + Math.abs(tb - fb) < 6) return;

  const TOL = 120;
  const FRINGE = 330;
  const filled = new Uint8Array(W * H);
  const diff = (i) => {
    const q = i * 4;
    return Math.abs(d[q] - tr) + Math.abs(d[q + 1] - tg) + Math.abs(d[q + 2] - tb);
  };
  const ok = (i) => !filled[i] && diff(i) <= TOL;

  const stack = [x0, y0];
  let minX = x0, maxX = x0, minY = y0, maxY = y0;
  while (stack.length) {
    const y = stack.pop();
    const x = stack.pop();
    const row = y * W;
    if (!ok(row + x)) continue;
    let l = x;
    let r = x;
    while (l > 0 && ok(row + l - 1)) l--;
    while (r < W - 1 && ok(row + r + 1)) r++;
    for (let i = l; i <= r; i++) filled[row + i] = 1;
    if (l < minX) minX = l;
    if (r > maxX) maxX = r;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    for (const ny of [y - 1, y + 1]) {
      if (ny < 0 || ny >= H) continue;
      const nrow = ny * W;
      let inRun = false;
      for (let i = l; i <= r; i++) {
        if (ok(nrow + i)) {
          if (!inRun) {
            stack.push(i, ny);
            inRun = true;
          }
        } else {
          inRun = false;
        }
      }
    }
  }

  // Paint the region plus a 1px fringe of "in-between" pixels next to it.
  const x1 = Math.max(0, minX - 1), x2 = Math.min(W - 1, maxX + 1);
  const y1 = Math.max(0, minY - 1), y2 = Math.min(H - 1, maxY + 1);
  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      const i = y * W + x;
      let paint = filled[i] === 1;
      if (!paint) {
        const near =
          (x > 0 && filled[i - 1] === 1) || (x < W - 1 && filled[i + 1] === 1) ||
          (y > 0 && filled[i - W] === 1) || (y < H - 1 && filled[i + W] === 1);
        paint = near && diff(i) <= FRINGE;
      }
      if (paint) {
        const q = i * 4;
        d[q] = fr;
        d[q + 1] = fg;
        d[q + 2] = fb;
        d[q + 3] = 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

function drawOp(ctx, op) {
  if (op.t === 's') drawStroke(ctx, op, 0);
  else if (op.t === 'f') floodFill(ctx, op.x, op.y, op.c);
  else if (op.t === 'c') paintBackground(ctx);
}

export function renderOps(ctx, ops) {
  paintBackground(ctx);
  for (const op of ops) drawOp(ctx, op);
}

function getCtx(canvas) {
  return canvas.getContext('2d', { willReadFrequently: true });
}

// ---------------------------------------------------------------------------
// Board: the op list for the current turn, kept identical on every client.

export class Board {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = getCtx(canvas);
    this.ops = [];
    this.points = 0;
    paintBackground(this.ctx);
  }

  reset() {
    this.ops = [];
    this.points = 0;
    paintBackground(this.ctx);
  }

  setOps(ops) {
    this.ops = ops.map((o) => (o.t === 's' ? { ...o, p: o.p.slice() } : { ...o }));
    this.points = this.ops.reduce((n, o) => n + (o.t === 's' ? o.p.length / 2 : 0), 0);
    renderOps(this.ctx, this.ops);
  }

  findStroke(id) {
    for (let i = this.ops.length - 1; i >= 0; i--) if (this.ops[i].t === 's' && this.ops[i].id === id) return this.ops[i];
    return null;
  }

  // Apply a wire op (b/e/x/f/u/c) from the drawer or the server.
  apply(op) {
    switch (op.t) {
      case 'b': {
        const stroke = { t: 's', id: op.id, c: op.c, s: op.s, p: op.p.slice() };
        this.ops.push(stroke);
        this.points += stroke.p.length / 2;
        drawStroke(this.ctx, stroke, 0);
        break;
      }
      case 'e': {
        const stroke = this.findStroke(op.id);
        if (!stroke) return;
        const from = stroke.p.length / 2;
        for (const v of op.p) stroke.p.push(v);
        this.points += op.p.length / 2;
        drawStroke(this.ctx, stroke, from);
        break;
      }
      case 'f':
        this.ops.push({ t: 'f', x: op.x, y: op.y, c: op.c });
        floodFill(this.ctx, op.x, op.y, op.c);
        break;
      case 'u':
        if (this.ops.length) {
          this.ops.pop();
          renderOps(this.ctx, this.ops);
        }
        break;
      case 'c':
        this.ops.push({ t: 'c' });
        paintBackground(this.ctx);
        break;
      default:
        break;
    }
  }

  // Share of non-white pixels (handy for tests and for "empty drawing" checks).
  inkRatio() {
    const d = this.ctx.getImageData(0, 0, W, H).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 16) if (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245) n++;
    return n / (d.length / 16);
  }
}

// ---------------------------------------------------------------------------
// Pointer input for the drawer. Streams strokes as begin / extend (~40 ms chunks) / end.

export class DrawInput {
  constructor(board, canvas, send, hooks = {}) {
    this.board = board;
    this.canvas = canvas;
    this.send = send;
    this.hooks = hooks;
    this.enabled = false;
    this.tool = 'brush';
    this.color = 0;
    this.sizeIndex = 1;
    this.chaos = null; // the turn's chaos twist, if any (the server enforces the same rules)
    this.active = null;
    this.pending = [];
    this.flushTimer = null;
    this.lastX = 0;
    this.lastY = 0;

    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', (e) => this.up(e));
    canvas.addEventListener('lostpointercapture', (e) => this.up(e));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // The tool actually used under the current chaos twist.
  get activeTool() {
    const c = this.chaos;
    if (c === 'oneline' || c === 'tiny') return 'brush';
    if (c === 'noundo' && this.tool === 'eraser') return 'brush';
    return this.tool;
  }

  get size() {
    if (this.chaos === 'tiny') return BRUSH_SIZES[0];
    return (this.activeTool === 'eraser' ? ERASER_SIZES : BRUSH_SIZES)[this.sizeIndex];
  }

  get strokeColor() {
    if (this.activeTool === 'eraser') return WHITE;
    return this.chaos === 'ink' ? 0 : this.color;
  }

  // One line: once there's a stroke, that's it.
  get lineUsed() {
    return this.chaos === 'oneline' && this.board.ops.some((o) => o.t === 's');
  }

  setEnabled(on) {
    if (!on) this.finish();
    this.enabled = on;
  }

  toCanvas(e) {
    const r = this.canvas.getBoundingClientRect();
    let x = Math.round(((e.clientX - r.left) / r.width) * W);
    const y = Math.round(((e.clientY - r.top) / r.height) * H);
    x = Math.max(0, Math.min(W - 1, x));
    if (this.chaos === 'mirror') x = W - 1 - x;
    return [x, Math.max(0, Math.min(H - 1, y))];
  }

  down(e) {
    if (!this.enabled || this.active) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    if (this.lineUsed) {
      this.hooks.onOneLine && this.hooks.onOneLine();
      return;
    }
    const [x, y] = this.toCanvas(e);
    if (this.activeTool === 'fill') {
      const op = { t: 'f', x, y, c: this.strokeColor };
      this.board.apply(op);
      this.send(op);
      return;
    }
    if (this.board.points >= MAX_POINTS) {
      this.hooks.onLimit && this.hooks.onLimit();
      return;
    }
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch (_) { /* ignore */ }
    const id = Math.floor(Math.random() * 2 ** 31);
    this.active = { pointerId: e.pointerId, id };
    this.lastX = x;
    this.lastY = y;
    const op = { t: 'b', id, c: this.strokeColor, s: this.size, p: [x, y] };
    this.board.apply(op);
    this.send(op);
    this.flushTimer = setInterval(() => this.flush(), 40);
  }

  move(e) {
    if (!this.active || e.pointerId !== this.active.pointerId) return;
    e.preventDefault();
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
    for (const ev of events.length ? events : [e]) this.addPoint(...this.toCanvas(ev));
  }

  addPoint(x, y) {
    const dx = x - this.lastX;
    const dy = y - this.lastY;
    if (dx * dx + dy * dy < 4) return; // skip sub-2px jitter
    if (this.board.points >= MAX_POINTS) {
      this.hooks.onLimit && this.hooks.onLimit();
      this.finish();
      return;
    }
    this.lastX = x;
    this.lastY = y;
    this.pending.push(x, y);
    this.board.apply({ t: 'e', id: this.active.id, p: [x, y] });
    if (this.pending.length >= 400) this.flush();
  }

  flush() {
    if (!this.active || !this.pending.length) return;
    this.send({ t: 'e', id: this.active.id, p: this.pending });
    this.pending = [];
  }

  up(e) {
    if (!this.active || (e && e.pointerId !== this.active.pointerId)) return;
    if (e && e.type === 'pointerup') this.addPoint(...this.toCanvas(e));
    this.finish();
  }

  finish() {
    if (!this.active) return;
    this.flush();
    this.send({ t: 'x', id: this.active.id });
    clearInterval(this.flushTimer);
    this.flushTimer = null;
    this.active = null;
    if (this.hooks.onStrokeEnd) this.hooks.onStrokeEnd();
  }

  get canTakeBack() {
    return this.chaos !== 'oneline' && this.chaos !== 'noundo';
  }

  undo() {
    if (!this.enabled || !this.board.ops.length || !this.canTakeBack) return;
    this.finish();
    this.board.apply({ t: 'u' });
    this.send({ t: 'u' });
  }

  clear() {
    if (!this.enabled || !this.canTakeBack) return;
    this.finish();
    const last = this.board.ops[this.board.ops.length - 1];
    if (!this.board.ops.length || (last && last.t === 'c')) return;
    this.board.apply({ t: 'c' });
    this.send({ t: 'c' });
  }
}

// ---------------------------------------------------------------------------
// Gallery replay: redraws a finished drawing stroke-by-stroke in about `duration` ms.

export function replay(canvas, ops, { duration = 4500, onDone } = {}) {
  const ctx = getCtx(canvas);
  paintBackground(ctx);
  const FILL_COST = 40;
  const total = ops.reduce((n, o) => n + (o.t === 's' ? o.p.length / 2 : FILL_COST), 0) || 1;
  let opIndex = 0;
  let pointIndex = 0;
  let done = 0;
  let cancelled = false;
  let raf = 0;
  const t0 = performance.now();

  function step(now) {
    if (cancelled) return;
    const target = Math.min(total, ((now - t0) / duration) * total);
    while (done < target && opIndex < ops.length) {
      const op = ops[opIndex];
      if (op.t === 's') {
        const n = op.p.length / 2;
        const upto = Math.min(n, pointIndex + Math.max(1, Math.ceil(target - done)));
        drawStrokeRange(ctx, op, pointIndex, upto);
        done += upto - pointIndex;
        pointIndex = upto;
        if (pointIndex >= n) {
          opIndex++;
          pointIndex = 0;
        }
      } else {
        drawOp(ctx, op);
        done += FILL_COST;
        opIndex++;
      }
    }
    if (opIndex < ops.length) raf = requestAnimationFrame(step);
    else if (onDone) onDone();
  }
  raf = requestAnimationFrame(step);
  return () => {
    cancelled = true;
    cancelAnimationFrame(raf);
  };
}

function drawStrokeRange(ctx, op, from, to) {
  const partial = { ...op, p: op.p.slice(0, to * 2) };
  drawStroke(ctx, partial, from);
}

// ---------------------------------------------------------------------------
// PNG export: the drawing plus a caption band with the word and the artist.

export function exportPng(drawing, { roomCode } = {}) {
  const FOOT = 132;
  const PAD = 28;
  const c = document.createElement('canvas');
  c.width = W + PAD * 2;
  c.height = H + PAD * 2 + FOOT;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff6e5';
  ctx.fillRect(0, 0, c.width, c.height);

  const art = document.createElement('canvas');
  art.width = W;
  art.height = H;
  renderOps(getCtx(art), drawing.ops);
  ctx.fillStyle = '#1d1a2b';
  roundRect(ctx, PAD - 4, PAD - 4, W + 8, H + 8, 18);
  ctx.fill();
  ctx.save();
  roundRect(ctx, PAD, PAD, W, H, 14);
  ctx.clip();
  ctx.drawImage(art, PAD, PAD);
  ctx.restore();

  const font = getComputedStyle(document.body).getPropertyValue('--font').trim() || 'sans-serif';
  const y = PAD * 2 + H;
  ctx.fillStyle = '#1d1a2b';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `700 50px ${font}`;
  ctx.fillText(fitText(ctx, drawing.word.toUpperCase(), W - 180), PAD, y + 56);
  ctx.font = `500 26px ${font}`;
  ctx.fillStyle = '#5b5670';
  const by = `drawn by ${drawing.drawerName}`;
  ctx.beginPath();
  ctx.arc(PAD + 10, y + 94, 10, 0, Math.PI * 2);
  ctx.fillStyle = drawing.drawerColor || '#ff5c39';
  ctx.fill();
  ctx.fillStyle = '#5b5670';
  ctx.fillText(by, PAD + 30, y + 103);

  ctx.textAlign = 'right';
  ctx.font = `700 30px ${font}`;
  ctx.fillStyle = '#ff5c39';
  ctx.fillText('Doodle Dash', c.width - PAD, y + 56);
  ctx.font = `500 20px ${font}`;
  ctx.fillStyle = '#8a8697';
  if (roomCode) ctx.fillText(`room ${roomCode}`, c.width - PAD, y + 100);
  return c.toDataURL('image/png');
}

function fitText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
  return t + '…';
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export { paintBackground, BG };

// ---------------------------------------------------------------------------
// Poster: every drawing of the game on one shareable image.

const HEART = new Path2D('M24 41.5S5.5 30.5 5.5 17a9.3 9.3 0 0 1 18.5-3 9.3 9.3 0 0 1 18.5 3c0 13.5-18.5 24.5-18.5 24.5z');

export function exportPoster(drawings, { roomCode = '', likes = [], favourite = -1, winner = null, host = location.host } = {}) {
  const cols = drawings.length <= 4 ? 2 : 3;
  const rows = Math.ceil(drawings.length / cols);
  const CW = 400, ART_W = 360, ART_H = 270, CH = ART_H + 128;
  const PAD = 48, GAP = 34, HEAD = 230, FOOT = 110;
  const width = PAD * 2 + cols * CW + (cols - 1) * GAP;
  const height = HEAD + rows * CH + (rows - 1) * GAP + FOOT;
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d');
  const font = getComputedStyle(document.body).getPropertyValue('--font').trim() || 'sans-serif';
  const INKC = '#1d1a2b';

  ctx.fillStyle = '#fff6e5';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#efdcb8';
  for (let y = 14; y < height; y += 28) for (let x = 14; x < width; x += 28) ctx.fillRect(x, y, 2.4, 2.4);

  // Header
  ctx.textBaseline = 'alphabetic';
  ctx.font = `700 76px ${font}`;
  const doodleW = ctx.measureText('Doodle').width;
  ctx.fillStyle = '#ffd23f';
  roundRect(ctx, PAD - 8, 70, doodleW + 16, 30, 12);
  ctx.fill();
  ctx.fillStyle = INKC;
  ctx.fillText('Doodle', PAD, 100);
  ctx.fillStyle = '#ff5c39';
  ctx.strokeStyle = INKC;
  ctx.lineWidth = 5;
  ctx.lineJoin = 'round';
  ctx.strokeText('Dash', PAD + doodleW + 22, 100);
  ctx.fillText('Dash', PAD + doodleW + 22, 100);
  ctx.fillStyle = '#57526b';
  ctx.font = `600 28px ${font}`;
  const date = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const artists = new Set(drawings.map((d) => d.drawerName)).size;
  ctx.fillText(`The Gallery · ${drawings.length} drawing${drawings.length === 1 ? '' : 's'} by ${artists} artist${artists === 1 ? '' : 's'}${roomCode ? ` · room ${roomCode}` : ''} · ${date}`, PAD, 150);
  if (winner) {
    ctx.fillStyle = INKC;
    ctx.font = `700 30px ${font}`;
    ctx.fillText(`Winner: ${winner.name} · ${winner.score} pts`, PAD, 196);
  }

  // Cards
  const art = document.createElement('canvas');
  art.width = W;
  art.height = H;
  const actx = getCtx(art);
  drawings.forEach((d, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = PAD + col * (CW + GAP);
    const y = HEAD + row * (CH + GAP);
    ctx.save();
    ctx.translate(x + CW / 2, y + CH / 2);
    ctx.rotate(((i % 2 ? 1 : -1) * (0.6 + (i % 3) * 0.3) * Math.PI) / 180);
    ctx.translate(-CW / 2, -CH / 2);
    ctx.fillStyle = 'rgba(29,26,43,0.9)';
    roundRect(ctx, 0, 6, CW, CH, 8);
    ctx.fill();
    ctx.fillStyle = '#fffdf8';
    ctx.strokeStyle = INKC;
    ctx.lineWidth = 4;
    roundRect(ctx, 0, 0, CW, CH, 8);
    ctx.fill();
    ctx.stroke();
    renderOps(actx, d.ops);
    ctx.drawImage(art, 20, 20, ART_W, ART_H);
    ctx.lineWidth = 3;
    ctx.strokeRect(20, 20, ART_W, ART_H);
    ctx.fillStyle = 'rgba(255,210,63,0.8)';
    ctx.save();
    ctx.translate(CW / 2, 4);
    ctx.rotate(((i % 2 ? -1 : 1) * 3 * Math.PI) / 180);
    ctx.fillRect(-55, -14, 110, 28);
    ctx.restore();
    ctx.fillStyle = INKC;
    ctx.font = `700 34px ${font}`;
    const word = d.word.replace(/\b\w/g, (m) => m.toUpperCase());
    ctx.fillText(fitText(ctx, word, ART_W - 90), 20, ART_H + 66);
    ctx.beginPath();
    ctx.arc(31, ART_H + 97, 10, 0, Math.PI * 2);
    ctx.fillStyle = d.drawerColor || '#ff5c39';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.fillStyle = '#3f3a52';
    ctx.font = `600 22px ${font}`;
    ctx.fillText(fitText(ctx, `by ${d.drawerName}`, ART_W - 90), 50, ART_H + 105);
    const n = likes[i] || 0;
    if (n) {
      ctx.save();
      ctx.translate(CW - 108, ART_H + 58);
      ctx.scale(0.8, 0.8);
      ctx.fillStyle = '#e8384f';
      ctx.fill(HEART);
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = INKC;
      ctx.stroke(HEART);
      ctx.restore();
      ctx.fillStyle = INKC;
      ctx.font = `700 30px ${font}`;
      ctx.fillText(String(n), CW - 62, ART_H + 88);
    }
    if (i === favourite) {
      ctx.fillStyle = '#ffd23f';
      ctx.strokeStyle = INKC;
      ctx.lineWidth = 3;
      roundRect(ctx, CW - 214, 30, 186, 40, 20);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = INKC;
      ctx.font = `700 21px ${font}`;
      ctx.fillText('Crowd favourite', CW - 198, 57);
    }
    ctx.restore();
  });

  ctx.fillStyle = '#57526b';
  ctx.font = `600 28px ${font}`;
  ctx.textAlign = 'center';
  ctx.fillText(`Play free at ${host}`, width / 2, height - 44);
  return c.toDataURL('image/png');
}
