// Tiny synthesized sound effects (no audio files). Muted state is remembered.

const KEY = 'dd.muted';
let ctx = null;
let muted = false;
try {
  muted = localStorage.getItem(KEY) === '1';
} catch (_) { /* private mode */ }

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// Browsers only allow audio after a user gesture: unlock on the first tap/key.
const unlock = () => {
  if (!muted) audio();
};
window.addEventListener('pointerdown', unlock, { once: true, capture: true });
window.addEventListener('keydown', unlock, { once: true, capture: true });

function tone(freq, { at = 0, dur = 0.12, type = 'sine', gain = 0.16, to = null } = {}) {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + at;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function play(fn) {
  if (muted) return;
  try {
    fn();
  } catch (_) { /* audio is best-effort */ }
}

export const sfx = {
  // You guessed it: bright rising arpeggio.
  correct: () => play(() => [523, 659, 784, 1047].forEach((f, i) => tone(f, { at: i * 0.07, dur: 0.18, type: 'triangle', gain: 0.18 }))),
  // Someone else guessed it: a friendly pop.
  pop: () => play(() => tone(660, { dur: 0.1, type: 'triangle', to: 990, gain: 0.14 })),
  // So close: a little wobble.
  close: () => play(() => { tone(440, { dur: 0.09, type: 'square', gain: 0.05 }); tone(415, { at: 0.1, dur: 0.12, type: 'square', gain: 0.05 }); }),
  // Last 10 seconds.
  tick: () => play(() => tone(1300, { dur: 0.035, type: 'square', gain: 0.045 })),
  // Turn over.
  turnEnd: () => play(() => [784, 622, 523].forEach((f, i) => tone(f, { at: i * 0.11, dur: 0.2, type: 'triangle', gain: 0.14 }))),
  // It's your turn to draw.
  yourTurn: () => play(() => [587, 880].forEach((f, i) => tone(f, { at: i * 0.12, dur: 0.25, type: 'sine', gain: 0.2 }))),
  // Someone joined the lobby.
  join: () => play(() => tone(520, { dur: 0.12, type: 'sine', to: 780, gain: 0.12 })),
  // Game over fanfare.
  fanfare: () => play(() => [523, 659, 784, 659, 784, 1047].forEach((f, i) => tone(f, { at: i * 0.12, dur: i === 5 ? 0.5 : 0.16, type: 'triangle', gain: 0.17 }))),
  // Soft UI click.
  click: () => play(() => tone(900, { dur: 0.03, type: 'sine', gain: 0.06 })),
};

export function isMuted() {
  return muted;
}

export function setMuted(m) {
  muted = !!m;
  try {
    localStorage.setItem(KEY, muted ? '1' : '0');
  } catch (_) { /* ignore */ }
  if (!muted) audio();
}
