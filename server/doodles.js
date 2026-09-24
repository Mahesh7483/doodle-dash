'use strict';

// Pre-made doodles that bots draw, stroke by stroke, on the 800x600 canvas.
// Shapes are built from simple geometry and given a slight hand-drawn wobble, so they look
// drawn rather than pasted. Every doodle is a list of drawing ops (strokes and fills).

const INK = 0, GREY = 1, WHITE = 2, RED = 3, ORANGE = 4, YELLOW = 5, GREEN = 6, SKY = 7, BLUE = 8, PURPLE = 9, PINK = 10, BROWN = 11;
const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Geometry helpers. Points are [x, y] pairs until they become a stroke.

function seeded(seed) {
  let s = 0;
  for (const ch of String(seed)) s = (s * 31 + ch.charCodeAt(0)) | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Parametric curve sampled every ~7 px.
function curve(fn, t0, t1, step = 7) {
  const probe = 64;
  let len = 0;
  let prev = fn(t0);
  for (let i = 1; i <= probe; i++) {
    const p = fn(t0 + ((t1 - t0) * i) / probe);
    len += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    prev = p;
  }
  const n = Math.max(2, Math.ceil(len / step));
  const out = [];
  for (let i = 0; i <= n; i++) out.push(fn(t0 + ((t1 - t0) * i) / n));
  return out;
}

function ellipse(cx, cy, rx, ry, a0 = 0, a1 = TAU) {
  return curve((a) => [cx + rx * Math.cos(a), cy + ry * Math.sin(a)], a0, a1);
}

function circle(cx, cy, r, a0, a1) {
  return ellipse(cx, cy, r, r, a0, a1);
}

// Straight segments through the given corners, subdivided so the wobble has something to bend.
function path(corners, closed = false, step = 7) {
  const list = closed ? [...corners, corners[0]] : corners;
  const out = [list[0]];
  for (let i = 1; i < list.length; i++) {
    const [x0, y0] = list[i - 1];
    const [x1, y1] = list[i];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
    for (let k = 1; k <= n; k++) out.push([x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n]);
  }
  return out;
}

// Polar outline: r(a) around a centre, always closed.
function polar(cx, cy, rFn, a0 = 0, a1 = TAU) {
  return curve((a) => [cx + rFn(a) * Math.cos(a), cy + rFn(a) * Math.sin(a)], a0, a1);
}

// A gentle hand-drawn wobble. Closed loops use periodic noise so they stay closed; open
// strokes keep their end points exactly where they are (so they still meet other lines).
function wobble(points, rng, amp = 2.4) {
  const closed = points.length > 2 && Math.hypot(points[0][0] - points.at(-1)[0], points[0][1] - points.at(-1)[1]) < 1;
  const f1 = 1 + Math.floor(rng() * 3);
  const f2 = 3 + Math.floor(rng() * 4);
  const p1 = rng() * TAU;
  const p2 = rng() * TAU;
  const n = points.length - 1 || 1;
  return points.map(([x, y], i) => {
    const t = i / n;
    const env = closed ? 1 : Math.sin(Math.PI * t);
    const dx = amp * env * (Math.sin(TAU * f1 * t + p1) * 0.7 + Math.sin(TAU * f2 * t + p2) * 0.3);
    const dy = amp * env * (Math.cos(TAU * f1 * t + p2) * 0.7 + Math.sin(TAU * f2 * t + p1) * 0.3);
    return [x + dx, y + dy];
  });
}

function clampPoint([x, y]) {
  return [Math.max(0, Math.min(799, Math.round(x))), Math.max(0, Math.min(599, Math.round(y)))];
}

// ---------------------------------------------------------------------------
// Doodle builder

function builder(seed) {
  const rng = seeded(seed);
  const ops = [];
  return {
    ops,
    rng,
    // Stroke through points; wobble unless told otherwise.
    line(c, s, points, { wobble: wob = true, amp } = {}) {
      const pts = (wob ? wobble(points, rng, amp) : points).map(clampPoint);
      const flat = [];
      for (const [x, y] of pts) {
        if (flat.length && flat.at(-2) === x && flat.at(-1) === y) continue;
        flat.push(x, y);
      }
      ops.push({ t: 's', c, s, p: flat });
    },
    dot(c, s, x, y) {
      ops.push({ t: 's', c, s, p: [Math.round(x), Math.round(y)] });
    },
    fill(c, x, y) {
      ops.push({ t: 'f', x: Math.round(x), y: Math.round(y), c });
    },
  };
}

// Sky above a wavy ground line, filled.
function skyAndGround(d, groundY, groundColor, skyColor = SKY, amp = 10) {
  d.fill(skyColor, 5, 5);
  d.line(INK, 10, curve((x) => [x, groundY + Math.sin(x / 90) * amp], -10, 810), { wobble: false });
  d.fill(groundColor, 400, 596);
}

function sunInCorner(d, x = 690, y = 95, r = 48) {
  d.line(INK, 10, circle(x, y, r));
  d.fill(YELLOW, x, y);
}

// Clouds are painted white first and outlined after, so they cover whatever is behind them.
function cloud(d, cx, cy, s = 1) {
  const r = (a) => s * (48 + 12 * Math.abs(Math.sin(a * 2.5))) * (Math.sin(a) > 0 ? 0.7 : 1);
  for (let y = -40; y <= 40; y += 18) {
    for (let x = -60; x <= 60; x += 18) {
      const a = Math.atan2(y * s, x * s);
      if (Math.hypot(x * s, y * s) < r(a) - 26) d.dot(WHITE, 48, cx + x * s, cy + y * s);
    }
  }
  d.line(INK, 10, polar(cx, cy, r));
}

const DOODLES = {
  sun(d) {
    d.fill(SKY, 5, 5);
    d.line(INK, 10, circle(400, 300, 115));
    d.fill(YELLOW, 400, 300);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU + 0.12;
      d.line(ORANGE, 10, path([[400 + Math.cos(a) * 150, 300 + Math.sin(a) * 150], [400 + Math.cos(a) * 215, 300 + Math.sin(a) * 215]]));
    }
    d.dot(INK, 24, 360, 270);
    d.dot(INK, 24, 440, 270);
    d.line(INK, 10, ellipse(400, 305, 55, 40, 0.35, Math.PI - 0.35));
    d.line(PINK, 10, circle(335, 325, 10));
    d.line(PINK, 10, circle(465, 325, 10));
  },

  house(d) {
    skyAndGround(d, 480, GREEN);
    sunInCorner(d);
    d.line(INK, 10, path([[250, 480], [250, 285], [550, 285], [550, 480]]));
    d.line(INK, 10, path([[228, 285], [400, 150], [572, 285]], false));
    d.line(INK, 10, path([[228, 285], [572, 285]]), { wobble: false });
    d.fill(RED, 400, 230);
    d.line(INK, 10, path([[370, 480], [370, 380], [430, 380], [430, 480]]));
    d.fill(PINK, 300, 450);
    d.fill(BROWN, 400, 440);
    d.dot(YELLOW, 10, 418, 432);
    d.line(INK, 10, path([[285, 320], [355, 320], [355, 370], [285, 370]], true));
    d.fill(YELLOW, 300, 330);
    d.line(INK, 4, path([[320, 320], [320, 370]]));
    d.line(INK, 4, path([[285, 345], [355, 345]]));
    d.line(INK, 10, path([[455, 320], [520, 320], [520, 370], [455, 370]], true));
    d.fill(YELLOW, 470, 330);
    d.line(INK, 10, path([[480, 200], [480, 150], [515, 150], [515, 228]]));
    d.fill(RED, 497, 180);
  },

  tree(d) {
    skyAndGround(d, 500, GREEN);
    sunInCorner(d, 110, 95, 44);
    d.line(INK, 10, polar(400, 245, (a) => 150 + 16 * Math.sin(a * 8)));
    d.fill(GREEN, 400, 245);
    d.line(INK, 10, path([[368, 380], [362, 505]]));
    d.line(INK, 10, path([[432, 380], [438, 505]]));
    d.fill(BROWN, 400, 470);
    for (const [x, y] of [[330, 200], [455, 170], [470, 290], [350, 300], [400, 240]]) d.dot(RED, 24, x, y);
    d.line(INK, 4, path([[380, 470], [390, 430]]));
  },

  fish(d) {
    d.fill(BLUE, 5, 5);
    d.line(INK, 10, ellipse(370, 300, 175, 105));
    d.line(INK, 10, path([[530, 300], [660, 205], [650, 300], [660, 395]], true));
    d.fill(ORANGE, 350, 330);
    d.fill(ORANGE, 610, 300);
    d.line(INK, 10, circle(270, 270, 26));
    d.fill(WHITE, 270, 270);
    d.dot(INK, 24, 275, 272);
    d.line(INK, 10, ellipse(360, 205, 70, 45, Math.PI + 0.3, TAU - 0.3));
    d.line(INK, 10, ellipse(205, 320, 18, 10, -0.6, 1.2));
    d.line(RED, 4, ellipse(380, 300, 60, 70, -1, 1));
    d.line(RED, 4, ellipse(440, 300, 60, 70, -1, 1));
    for (const [x, y, r] of [[170, 190, 14], [140, 130, 18], [175, 70, 12]]) d.line(WHITE, 4, circle(x, y, r));
    d.line(GREEN, 10, curve((t) => [100 + Math.sin(t * 4) * 15, 600 - t * 150], 0, 1));
    d.line(GREEN, 10, curve((t) => [720 + Math.sin(t * 4 + 1) * 15, 600 - t * 190], 0, 1));
  },

  cat(d) {
    const cx = 400, cy = 330, rx = 150, ry = 130;
    const on = (a) => [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
    d.line(INK, 10, ellipse(cx, cy, rx, ry));
    d.line(INK, 10, path([on(3.62), [285, 115], on(4.25)]));
    d.line(INK, 10, path([on(5.17), [515, 115], on(5.8)]));
    d.fill(ORANGE, 400, 420);
    d.fill(ORANGE, 300, 190);
    d.fill(ORANGE, 500, 190);
    d.line(PINK, 10, path([[298, 160], [320, 215]]));
    d.line(PINK, 10, path([[502, 160], [480, 215]]));
    d.line(INK, 10, ellipse(345, 310, 22, 28));
    d.fill(GREEN, 345, 310);
    d.line(INK, 10, ellipse(455, 310, 22, 28));
    d.fill(GREEN, 455, 310);
    d.dot(INK, 10, 348, 312);
    d.dot(INK, 10, 458, 312);
    d.line(INK, 10, path([[385, 355], [415, 355], [400, 372]], true));
    d.fill(PINK, 400, 361);
    d.line(INK, 10, ellipse(380, 385, 20, 16, 0.2, Math.PI - 0.4));
    d.line(INK, 10, ellipse(420, 385, 20, 16, 0.4, Math.PI - 0.2));
    for (const dy of [-12, 8, 28]) {
      d.line(INK, 4, path([[300, 360 + dy * 0.6], [205, 350 + dy * 1.5]]));
      d.line(INK, 4, path([[500, 360 + dy * 0.6], [595, 350 + dy * 1.5]]));
    }
  },

  apple(d) {
    const bump = (a, at, width) => Math.exp(-(1 - Math.cos(a - at)) / width);
    const r = (a) => 150 + 20 * Math.cos(2 * a) - 55 * bump(a, -Math.PI / 2, 0.045) - 18 * bump(a, Math.PI / 2, 0.06);
    d.line(INK, 10, polar(400, 340, r, -Math.PI / 2, (3 * Math.PI) / 2));
    d.fill(RED, 400, 360);
    d.line(WHITE, 10, ellipse(330, 330, 35, 60, Math.PI + 0.4, Math.PI * 1.5));
    d.line(BROWN, 24, path([[400, 262], [410, 215], [425, 170]]));
    d.line(INK, 10, curve((t) => [430 + 90 * t, 200 - 55 * Math.sin(Math.PI * t) - 30 * t], 0, 1));
    d.line(INK, 10, curve((t) => [430 + 90 * t, 200 + 25 * Math.sin(Math.PI * t) - 30 * t], 0, 1));
    d.fill(GREEN, 470, 185);
    d.line(INK, 4, path([[440, 196], [505, 178]]));
  },

  car(d) {
    d.fill(SKY, 5, 5);
    d.line(INK, 10, path([[0, 470], [800, 470]]), { wobble: false });
    d.fill(GREY, 400, 560);
    for (const x of [60, 260, 460, 660]) d.line(WHITE, 10, path([[x, 530], [x + 90, 530]]));
    d.line(INK, 10, path([[130, 400], [130, 320], [245, 305], [315, 225], [525, 225], [600, 305], [680, 320], [680, 400]], true));
    d.fill(RED, 160, 380);
    d.line(INK, 10, path([[265, 300], [328, 240], [405, 240], [405, 300]], true));
    d.line(INK, 10, path([[425, 300], [425, 240], [515, 240], [575, 300]], true));
    d.fill(SKY, 380, 280);
    d.fill(SKY, 460, 280);
    for (const x of [250, 560]) {
      d.line(INK, 10, circle(x, 405, 58));
      d.fill(INK, x, 440);
      d.fill(INK, x, 385);
      d.dot(GREY, 48, x, 405);
    }
    d.dot(YELLOW, 24, 668, 345);
    d.line(INK, 4, path([[415, 320], [440, 320]]));
  },

  boat(d) {
    d.fill(SKY, 5, 5);
    const sea = (x) => 410 + Math.sin(x / 45) * 8;
    d.line(INK, 10, curve((x) => [x, sea(x)], -10, 810), { wobble: false });
    d.fill(BLUE, 400, 590);
    d.line(INK, 10, path([[190, 345], [610, 345], [535, 440], [265, 440]], true));
    d.fill(BROWN, 400, 380);
    d.fill(BROWN, 400, 432);
    d.fill(BROWN, 280, 430);
    d.fill(BROWN, 520, 430);
    d.line(INK, 10, path([[400, 345], [400, 110]]));
    d.line(INK, 10, path([[415, 165], [415, 325], [570, 325]], true));
    d.fill(WHITE, 450, 290);
    d.line(INK, 10, path([[400, 110], [460, 130], [400, 150]], true));
    d.fill(RED, 425, 130);
    for (const [x, y] of [[180, 140], [250, 100]]) d.line(INK, 4, path([[x - 22, y - 10], [x, y], [x + 22, y - 10]]));
    d.line(WHITE, 4, curve((x) => [x, 500 + Math.sin(x / 30) * 6], 80, 260));
    d.line(WHITE, 4, curve((x) => [x, 540 + Math.sin(x / 30) * 6], 520, 720));
    sunInCorner(d, 680, 95, 45);
  },

  flower(d) {
    skyAndGround(d, 500, GREEN);
    d.line(GREEN, 10, path([[400, 330], [405, 420], [398, 505]]));
    d.line(INK, 10, curve((t) => [405 + 110 * t, 440 - 60 * Math.sin(Math.PI * t) - 20 * t], 0, 1));
    d.line(INK, 10, curve((t) => [405 + 110 * t, 440 + 15 * Math.sin(Math.PI * t) - 20 * t], 0, 1));
    d.fill(GREEN, 460, 425);
    d.line(INK, 10, polar(400, 230, (a) => 110 + 42 * Math.cos(6 * a)));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      d.fill(PINK, 400 + Math.cos(a) * 110, 230 + Math.sin(a) * 110);
    }
    d.line(INK, 10, circle(400, 230, 50));
    d.fill(YELLOW, 400, 230);
    d.dot(INK, 10, 385, 222);
    d.dot(INK, 10, 415, 222);
    d.line(INK, 4, ellipse(400, 235, 16, 12, 0.3, Math.PI - 0.3));
    for (const [x, y] of [[150, 150], [640, 120]]) {
      d.line(INK, 4, path([[x - 20, y - 10], [x, y], [x + 20, y - 10]]));
    }
  },

  snowman(d) {
    d.fill(BLUE, 5, 5);
    d.line(INK, 10, curve((x) => [x, 525 + Math.sin(x / 80) * 8], -10, 810), { wobble: false });
    d.fill(WHITE, 400, 590);
    d.line(INK, 10, circle(400, 405, 105));
    d.line(INK, 10, circle(400, 248, 78));
    d.line(INK, 10, circle(400, 128, 57));
    for (const [x, y] of [[400, 420], [400, 312], [400, 248], [400, 176], [400, 120]]) d.fill(WHITE, x, y);
    d.fill(WHITE, 330, 440);
    d.line(INK, 10, path([[292, 90], [508, 90]]), { wobble: false });
    d.line(INK, 10, path([[340, 90], [345, 20], [455, 20], [460, 90]]));
    d.fill(INK, 400, 50);
    d.line(RED, 10, path([[343, 78], [457, 78]]));
    d.dot(INK, 24, 380, 118);
    d.dot(INK, 24, 420, 118);
    d.line(INK, 4, path([[400, 132], [455, 142], [400, 146]], true));
    d.fill(ORANGE, 415, 140);
    for (const y of [220, 255, 290]) d.dot(INK, 24, 400, y);
    d.line(BROWN, 10, path([[327, 240], [250, 190], [225, 160]]));
    d.line(BROWN, 10, path([[250, 190], [228, 205]]));
    d.line(BROWN, 10, path([[473, 240], [550, 190], [575, 160]]));
    d.line(RED, 24, path([[345, 180], [400, 190], [455, 180]]));
    for (const [x, y] of [[90, 90], [160, 300], [650, 70], [720, 260], [600, 380], [110, 450], [250, 60]]) d.dot(WHITE, 10, x, y);
  },

  rainbow(d) {
    d.fill(SKY, 5, 5);
    const colors = [RED, ORANGE, YELLOW, GREEN, BLUE];
    colors.forEach((c, i) => d.line(c, 24, ellipse(400, 470, 250 - i * 22, 230 - i * 22, Math.PI, TAU), { amp: 1.5 }));
    cloud(d, 160, 470, 1.25);
    cloud(d, 640, 470, 1.25);
    sunInCorner(d, 700, 90, 42);
  },

  balloon(d) {
    d.fill(SKY, 5, 5);
    for (const [cx, cy, rx, ry, c] of [[380, 210, 115, 140, RED], [585, 270, 80, 98, YELLOW]]) {
      d.line(INK, 10, ellipse(cx, cy, rx, ry));
      d.fill(c, cx, cy);
      d.line(INK, 10, path([[cx, cy + ry], [cx - 14, cy + ry + 20], [cx + 14, cy + ry + 20]], true));
      d.fill(c, cx, cy + ry + 13);
      d.line(WHITE, 10, ellipse(cx - rx * 0.45, cy - ry * 0.35, rx * 0.2, ry * 0.3, Math.PI + 0.3, Math.PI * 1.6));
    }
    d.line(INK, 4, curve((t) => [380 + Math.sin(t * 9) * 12 + t * 40, 370 + t * 225], 0, 1));
    d.line(INK, 4, curve((t) => [585 + Math.sin(t * 9) * 10 - t * 160, 388 + t * 207], 0, 1));
    cloud(d, 130, 110, 0.9);
  },

  umbrella(d) {
    d.fill(SKY, 5, 5);
    const top = (a) => [400 + 230 * Math.cos(a), 300 + 210 * Math.sin(a)];
    d.line(INK, 10, curve(top, Math.PI, TAU));
    const xs = [170, 285, 400, 515, 630];
    for (let i = 0; i < 4; i++) d.line(INK, 10, ellipse((xs[i] + xs[i + 1]) / 2, 300, 57.5, 30, Math.PI, TAU), { wobble: false });
    for (const x of [285, 515]) d.line(INK, 4, curve((t) => [400 + (x - 400) * t + (x < 400 ? -12 : 12) * Math.sin(Math.PI * t), 90 + 210 * t], 0, 1), { wobble: false });
    d.line(INK, 4, path([[400, 90], [400, 300]]), { wobble: false });
    d.fill(PINK, 250, 240);
    d.fill(YELLOW, 340, 200);
    d.fill(PINK, 460, 200);
    d.fill(YELLOW, 550, 240);
    d.line(INK, 10, path([[400, 300], [400, 500]]));
    d.line(INK, 10, circle(365, 500, 35, 0, Math.PI));
    d.dot(INK, 24, 400, 85);
    for (const [x, y] of [[120, 420], [200, 520], [620, 460], [700, 540], [90, 560], [700, 380]]) d.line(BLUE, 4, path([[x, y], [x - 8, y + 26]]));
  },

  mushroom(d) {
    skyAndGround(d, 510, GREEN);
    d.line(INK, 10, ellipse(400, 310, 215, 175, Math.PI, TAU));
    d.line(INK, 10, curve((t) => [185 + 430 * t, 310 + 30 * Math.sin(Math.PI * t)], 0, 1));
    d.fill(RED, 400, 220);
    for (const [x, y, r] of [[320, 230, 30], [440, 185, 26], [520, 270, 24], [270, 300, 18], [400, 290, 20]]) {
      d.line(INK, 10, circle(x, y, r));
      d.fill(WHITE, x, y);
    }
    d.line(INK, 10, curve((t) => [335 - 20 * Math.sin(Math.PI * t), 334 + 180 * t], 0, 1));
    d.line(INK, 10, curve((t) => [465 + 20 * Math.sin(Math.PI * t), 334 + 180 * t], 0, 1));
    d.fill(YELLOW, 400, 440);
    d.dot(INK, 24, 375, 400);
    d.dot(INK, 24, 425, 400);
    d.line(INK, 4, ellipse(400, 420, 22, 16, 0.3, Math.PI - 0.3));
  },

  crown(d) {
    d.fill(PINK, 5, 5);
    d.line(INK, 10, path([[210, 470], [210, 220], [305, 320], [400, 160], [495, 320], [590, 220], [590, 470]], true));
    d.line(INK, 10, path([[210, 390], [590, 390]]), { wobble: false });
    d.fill(YELLOW, 400, 330);
    d.fill(YELLOW, 250, 440);
    for (const [x, c] of [[300, RED], [400, BLUE], [500, GREEN]]) {
      d.line(INK, 10, circle(x, 430, 22));
      d.fill(c, x, 430);
    }
    for (const [x, y] of [[210, 205], [400, 142], [590, 205]]) {
      d.line(INK, 10, circle(x, y, 20));
      d.fill(RED, x, y);
    }
    d.line(WHITE, 10, path([[245, 300], [245, 360]]));
    for (const [x, y] of [[110, 120], [690, 120], [120, 480], [690, 470]]) {
      d.line(YELLOW, 10, path([[x - 18, y], [x + 18, y]]));
      d.line(YELLOW, 10, path([[x, y - 18], [x, y + 18]]));
    }
  },

  lighthouse(d) {
    d.fill(BLUE, 5, 5);
    const hill = (x) => 478 + (x - 400) ** 2 * 0.00065;
    d.line(INK, 10, curve((x) => [x, hill(x)], -10, 810), { wobble: false });
    d.fill(GREEN, 400, 560);
    const left = (y) => 340 + ((y - hill(340)) * 20) / (200 - hill(340));
    const right = (y) => 460 - ((y - hill(460)) * 20) / (200 - hill(460));
    d.line(INK, 10, path([[340, hill(340)], [360, 200], [440, 200], [460, hill(460)]]), { wobble: false });
    for (const y of [270, 340, 410]) d.line(INK, 10, path([[left(y), y], [right(y), y]]), { wobble: false });
    d.fill(RED, 400, 235);
    d.fill(WHITE, 400, 305);
    d.fill(RED, 400, 375);
    d.fill(WHITE, 400, 450);
    d.line(INK, 10, path([[355, 200], [355, 145], [445, 145], [445, 200]]), { wobble: false });
    d.fill(YELLOW, 400, 172);
    d.line(INK, 10, path([[340, 145], [400, 95], [460, 145]], true), { wobble: false });
    d.fill(RED, 400, 128);
    d.line(YELLOW, 24, path([[340, 160], [120, 110]]));
    d.line(YELLOW, 24, path([[460, 160], [690, 120]]));
    d.line(INK, 10, path([[385, hill(385) + 4], [385, 440], [415, 440], [415, hill(415) + 4]]), { wobble: false });
    d.fill(BROWN, 400, 465);
    for (const [x, y] of [[90, 60], [200, 190], [620, 50], [720, 230], [520, 70]]) d.dot(WHITE, 10, x, y);
  },

  volcano(d) {
    d.fill(SKY, 5, 5);
    d.line(INK, 10, path([[0, 540], [800, 540]]), { wobble: false });
    d.fill(GREEN, 400, 580);
    d.line(INK, 10, path([[110, 540], [330, 230], [360, 250], [400, 238], [440, 250], [470, 230], [690, 540]]));
    d.fill(BROWN, 400, 480);
    d.line(INK, 10, path([[352, 245], [335, 300], [362, 335], [345, 395], [385, 372], [400, 322], [432, 368], [446, 300], [442, 248]]));
    d.fill(RED, 400, 280);
    d.fill(RED, 395, 250);
    for (const [x, y, r, c] of [[400, 160, 34, ORANGE], [335, 110, 22, RED], [470, 95, 26, ORANGE], [410, 70, 16, RED]]) {
      d.line(INK, 10, circle(x, y, r));
      d.fill(c, x, y);
    }
    d.line(ORANGE, 10, path([[380, 225], [360, 190]]));
    d.line(ORANGE, 10, path([[420, 225], [445, 185]]));
    cloud(d, 620, 110, 1.1);
    cloud(d, 150, 150, 0.8);
  },

  'light bulb': (d) => {
    d.fill(PURPLE, 5, 5);
    const a0 = Math.PI * 0.66;
    const a1 = Math.PI * 2.34;
    const glass = circle(400, 230, 145, a0, a1);
    const start = glass[0];
    const end = glass.at(-1);
    d.line(INK, 10, [...path([[345, 405], start]).slice(0, -1), ...glass, ...path([end, [455, 405]]).slice(1)]);
    d.line(INK, 10, path([[340, 405], [460, 405], [460, 480], [340, 480]], true), { wobble: false });
    d.fill(YELLOW, 400, 230);
    d.fill(GREY, 400, 460);
    for (const y of [428, 452]) d.line(INK, 4, path([[340, y], [460, y]]), { wobble: false });
    d.line(INK, 10, path([[375, 480], [390, 505], [410, 505], [425, 480]]), { wobble: false });
    d.fill(INK, 400, 492);
    d.line(ORANGE, 4, path([[375, 405], [375, 290], [390, 260], [400, 290], [410, 260], [425, 290], [425, 405]]));
    d.line(WHITE, 10, ellipse(400, 230, 105, 105, Math.PI + 0.3, Math.PI * 1.45));
    for (let i = 0; i < 9; i++) {
      const a = Math.PI * (0.95 + (i / 8) * 1.1);
      d.line(ORANGE, 10, path([[400 + Math.cos(a) * 175, 230 + Math.sin(a) * 175], [400 + Math.cos(a) * 225, 230 + Math.sin(a) * 225]]));
    }
  },

  'hot air balloon': (d) => {
    d.fill(SKY, 5, 5);
    cloud(d, 140, 420, 1.1);
    cloud(d, 660, 170, 0.9);
    const env = circle(400, 210, 150, Math.PI * 0.8, Math.PI * 2.2);
    d.line(INK, 10, [...env, ...path([env.at(-1), [445, 405], [355, 405], env[0]]).slice(1)]);
    d.line(INK, 10, curve((t) => [400 - 70 * Math.sin(Math.PI * (0.1 + 0.8 * t)) * 1.1, 60 + 345 * t], 0, 1));
    d.line(INK, 10, curve((t) => [400 + 70 * Math.sin(Math.PI * (0.1 + 0.8 * t)) * 1.1, 60 + 345 * t], 0, 1));
    d.fill(RED, 290, 220);
    d.fill(YELLOW, 400, 220);
    d.fill(RED, 510, 220);
    d.line(INK, 4, path([[360, 405], [370, 460]]));
    d.line(INK, 4, path([[440, 405], [430, 460]]));
    d.line(INK, 10, path([[360, 460], [440, 460], [432, 520], [368, 520]], true));
    d.fill(BROWN, 400, 490);
    d.line(INK, 4, path([[372, 480], [428, 480]]));
    d.line(INK, 4, path([[375, 500], [425, 500]]));
  },

  windmill(d) {
    skyAndGround(d, 520, GREEN);
    d.line(INK, 10, path([[340, 525], [370, 300], [430, 300], [460, 525]]));
    d.fill(RED, 400, 420);
    d.line(INK, 10, path([[385, 525], [385, 470], [415, 470], [415, 525]]));
    d.fill(BROWN, 400, 505);
    d.line(INK, 10, path([[370, 300], [400, 265], [430, 300]]));
    d.fill(BROWN, 400, 288);
    d.line(INK, 10, path([[400, 265], [400, 210]]));
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2 - 0.15;
      const ux = Math.cos(a), uy = Math.sin(a);
      const px = -uy, py = ux;
      const p = (along, side) => [400 + ux * along + px * side, 200 + uy * along + py * side];
      d.line(INK, 10, path([p(28, -8), p(190, -8), p(190, 38), p(40, 38), p(28, -8)], false));
      d.fill(WHITE, ...p(110, 15));
      d.line(INK, 4, path([p(80, -8), p(80, 38)]));
      d.line(INK, 4, path([p(135, -8), p(135, 38)]));
    }
    d.line(INK, 10, circle(400, 200, 22));
    d.fill(YELLOW, 400, 200);
    sunInCorner(d, 110, 90, 42);
  },
};


// word -> { difficulty, draw }
const LIBRARY = {
  sun: 'easy', house: 'easy', tree: 'easy', fish: 'easy', cat: 'easy', apple: 'easy', car: 'easy', boat: 'easy', flower: 'easy',
  snowman: 'medium', rainbow: 'medium', balloon: 'medium', umbrella: 'medium', mushroom: 'medium', crown: 'medium', lighthouse: 'medium',
  volcano: 'hard', 'light bulb': 'hard', 'hot air balloon': 'hard', windmill: 'hard',
};

const cache = new Map();

// The ops for a word's doodle (strokes get ids when a bot actually draws them).
function doodleOps(word) {
  if (!cache.has(word)) {
    const d = builder(word);
    DOODLES[word](d);
    cache.set(word, d.ops);
  }
  return cache.get(word).map((o) => (o.t === 's' ? { ...o, p: o.p.slice() } : { ...o }));
}

function doodleWords(difficulty) {
  return Object.keys(LIBRARY).filter((w) => !difficulty || LIBRARY[w] === difficulty);
}

module.exports = { doodleOps, doodleWords, LIBRARY };
