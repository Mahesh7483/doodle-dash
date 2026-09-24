// Drawn avatars: a tiny drawing (120x120 grid) shown inside the avatar circle everywhere.
// Data format: one array per stroke, [colour, size, x0, y0, x1, y1, ...].

import { PALETTE } from './canvas.js';

export const GRID = 120;
export const SIZES = [4, 8, 14];
const MAX_POINTS = 2400;
const SCALE = 2; // rendered at 240x240 so it stays crisp on big screens

function drawStrokes(ctx, strokes) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const s of strokes) {
    const [c, size] = s;
    ctx.strokeStyle = PALETTE[c] || PALETTE[0];
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = size;
    ctx.beginPath();
    ctx.arc(s[2], s[3], size / 2, 0, Math.PI * 2);
    ctx.fill();
    if (s.length > 4) {
      ctx.beginPath();
      ctx.moveTo(s[2], s[3]);
      for (let i = 4; i < s.length; i += 2) ctx.lineTo(s[i], s[i + 1]);
      ctx.stroke();
    }
  }
}

export function avatarDataUrl(strokes) {
  const c = document.createElement('canvas');
  c.width = c.height = GRID * SCALE;
  const ctx = c.getContext('2d');
  ctx.scale(SCALE, SCALE);
  drawStrokes(ctx, strokes);
  return c.toDataURL('image/png');
}

// Each avatar becomes one CSS class (.av-<id>), so the image isn't repeated in every list.
const known = new Map(); // id -> av
let styleEl = null;
const rules = new Map(); // id -> css rule

export function setAvatars(list) {
  for (const a of list || []) setAvatar(a);
}

export function setAvatar({ id, av, data }) {
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) return false;
  if (known.get(id) === av) return false;
  known.set(id, av);
  if (data && data.length) rules.set(id, `.av-${id}{background-image:url(${avatarDataUrl(data)});font-size:0!important}`);
  else rules.delete(id);
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'avatar-styles';
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = [...rules.values()].join('\n');
  return true;
}

export const hasAvatar = (id) => !!id && rules.has(id);

// ---------------------------------------------------------------------------
// The editor pad.

export class AvatarPad {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.strokes = [];
    this.color = 0;
    this.sizeIndex = 1;
    this.active = null;
    this.onChange = null;
    canvas.width = canvas.height = GRID * SCALE;
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(t, (e) => this.up(e));
  }

  points() {
    return this.strokes.reduce((n, s) => n + (s.length - 2) / 2, 0);
  }

  load(strokes) {
    this.strokes = (strokes || []).map((s) => s.slice());
    this.redraw();
  }

  redraw() {
    const { ctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.scale(SCALE, SCALE);
    drawStrokes(ctx, this.strokes);
    if (this.onChange) this.onChange();
  }

  at(e) {
    const r = this.canvas.getBoundingClientRect();
    const x = Math.round(((e.clientX - r.left) / r.width) * GRID);
    const y = Math.round(((e.clientY - r.top) / r.height) * GRID);
    return [Math.max(0, Math.min(GRID - 1, x)), Math.max(0, Math.min(GRID - 1, y))];
  }

  down(e) {
    if (this.active || this.strokes.length >= 60 || this.points() >= MAX_POINTS) return;
    e.preventDefault();
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch (_) { /* ignore */ }
    const [x, y] = this.at(e);
    this.active = { id: e.pointerId, stroke: [this.color, SIZES[this.sizeIndex], x, y] };
    this.strokes.push(this.active.stroke);
    this.redraw();
  }

  move(e) {
    if (!this.active || e.pointerId !== this.active.id) return;
    e.preventDefault();
    const s = this.active.stroke;
    const [x, y] = this.at(e);
    const lx = s[s.length - 2];
    const ly = s[s.length - 1];
    if ((x - lx) ** 2 + (y - ly) ** 2 < 2 || this.points() >= MAX_POINTS) return;
    s.push(x, y);
    this.redraw();
  }

  up(e) {
    if (!this.active || (e && e.pointerId !== this.active.id)) return;
    this.active = null;
  }

  undo() {
    this.active = null;
    this.strokes.pop();
    this.redraw();
  }

  clear() {
    this.active = null;
    this.strokes = [];
    this.redraw();
  }
}
