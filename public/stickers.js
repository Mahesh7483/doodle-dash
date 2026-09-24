// Reaction stickers, drawn in the game's ink style so they look the same on every device
// (emoji fonts vary a lot between phones and computers).

const INK = '#1d1a2b';
const s = (body) => `<svg viewBox="0 0 48 48" aria-hidden="true">${body}</svg>`;

export const STICKERS = {
  lol: {
    label: 'Laughing',
    svg: s(`<circle cx="24" cy="24" r="19" fill="#ffd23f" stroke="${INK}" stroke-width="3"/>
      <path d="M13.5 19.5q3.5-4.5 7 0M27.5 19.5q3.5-4.5 7 0" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
      <path d="M13 26h22q-1.5 11.5-11 11.5T13 26z" fill="#e8384f" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
      <path d="M17 26.5h14" stroke="#fff" stroke-width="3"/>
      <path d="M8.5 21.5q-4.5 5-1.2 8 3.4.8 3-3.8zM39.5 21.5q4.5 5 1.2 8-3.4.8-3-3.8z" fill="#5ec8f2" stroke="${INK}" stroke-width="2"/>`),
  },
  fire: {
    label: 'Fire',
    svg: s(`<path d="M24 3.5c3 8 12.5 12.5 12.5 24.5a12.5 12.5 0 0 1-25 0c0-6.3 3-9.5 5.2-12.3 1 4 3 6.2 5 6.3-3.2-6.3 0-13.5 2.3-18.5z" fill="#ff8a2a" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
      <path d="M24 22.5c2 4 6.2 6.3 6.2 12.3a6.2 6.2 0 0 1-12.4 0c0-3.2 1.8-5.2 3-7 1 2 2.2 3.2 3.2 3.2-1-3.2 0-6.3 0-8.5z" fill="#ffd23f"/>`),
  },
  love: {
    label: 'Love it',
    svg: s(`<path d="M24 41.5S5.5 30.5 5.5 17a9.3 9.3 0 0 1 18.5-3 9.3 9.3 0 0 1 18.5 3c0 13.5-18.5 24.5-18.5 24.5z" fill="#e8384f" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
      <path d="M12.5 16q1.8-4.5 6.5-3.6" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`),
  },
  wow: {
    label: 'Wow',
    svg: s(`<circle cx="24" cy="24" r="19" fill="#ffd23f" stroke="${INK}" stroke-width="3"/>
      <circle cx="17" cy="20" r="3.2" fill="${INK}"/><circle cx="31" cy="20" r="3.2" fill="${INK}"/>
      <ellipse cx="24" cy="32.5" rx="5" ry="6" fill="${INK}"/>
      <path d="M11.5 13q4.5-3.5 8.5-1.5M28 11.5q4-2 8.5 1.5" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>`),
  },
  hmm: {
    label: 'Hmm?',
    svg: s(`<path d="M8 9h32a4.5 4.5 0 0 1 4.5 4.5v18.5a4.5 4.5 0 0 1-4.5 4.5H22.5l-9.5 7.5v-7.5H8A4.5 4.5 0 0 1 3.5 32V13.5A4.5 4.5 0 0 1 8 9z" fill="#fff" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
      <path d="M18.8 17.8a5.3 5.3 0 1 1 7.6 4.8c-2 1-2.4 2.2-2.4 4.4" fill="none" stroke="#8e5cf7" stroke-width="3.6" stroke-linecap="round"/>
      <circle cx="24" cy="31.6" r="2.3" fill="#8e5cf7"/>`),
  },
  star: {
    label: 'Star',
    svg: s(`<path d="M24 3.5l6.2 12.8 14 2-10.1 9.8 2.4 14L24 35.5 11.5 42.1l2.4-14L3.8 18.3l14-2z" fill="#ffd23f" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
      <path d="M15.5 21.5l3.8-1.2" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`),
  },
};

export const STICKER_IDS = Object.keys(STICKERS);

// Smiley for the "send a reaction" button, drawn like the other icons.
export const REACT_ICON = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8.5 14.5q3.5 3.5 7 0"/><circle cx="9" cy="10" r=".6" fill="currentColor"/><circle cx="15" cy="10" r=".6" fill="currentColor"/></svg>`;

// Award icons for the podium.
export const AWARD_ICONS = {
  fastest: s(`<path d="M28 3.5L9 27.5h13.5l-4.5 17 21.5-26H26z" fill="#ffd23f" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>`),
  artist: s(`<path d="M24 5C12.4 5 4 13.2 4 23.5 4 33 11.5 42.5 22 42.5c3 0 4.6-1.7 4.6-3.8 0-2.6-2.4-3.4-2.4-5.9 0-2.4 2-3.9 4.4-3.9H34c6 0 10-4.3 10-9.8C44 11 35.2 5 24 5z" fill="#fff6e5" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
    <circle cx="13.5" cy="22" r="3.6" fill="#e8384f" stroke="${INK}" stroke-width="2"/><circle cx="18.5" cy="13" r="3.6" fill="#ffd23f" stroke="${INK}" stroke-width="2"/>
    <circle cx="29" cy="11.5" r="3.6" fill="#2bb673" stroke="${INK}" stroke-width="2"/><circle cx="36.5" cy="19" r="3.6" fill="#2f6fe4" stroke="${INK}" stroke-width="2"/>`),
  first: s(`<path d="M9 33.5a15 15 0 0 1 30 0z" fill="#ffd23f" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M4 34h40" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
    <path d="M24 5v6M9.5 11l4 4.5M38.5 11l-4 4.5M3.5 23.5h5M39.5 23.5h5" stroke="#ff8a2a" stroke-width="3" stroke-linecap="round"/>
    <path d="M14 40.5h20" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`),
  close: s(`<circle cx="22" cy="26" r="17" fill="#e8384f" stroke="${INK}" stroke-width="3"/><circle cx="22" cy="26" r="11" fill="#fff" stroke="${INK}" stroke-width="2.5"/>
    <circle cx="22" cy="26" r="5" fill="#e8384f" stroke="${INK}" stroke-width="2.5"/>
    <path d="M44 4L29.5 19" stroke="${INK}" stroke-width="3.2" stroke-linecap="round"/><path d="M36.5 4.5l7.5-.5-.5 7.5" fill="none" stroke="${INK}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`),
  abstract: s(`<path d="M24 24.5c0-2.5 3.5-2.5 3.5.5 0 4-6.5 5-8 .5-2-5.5 5-10 10.5-7 7 4 5.5 15-3 17-9.5 2.3-17-5-15-14 2.3-10.5 14.5-15.5 24-9.5" fill="none" stroke="#8e5cf7" stroke-width="4" stroke-linecap="round"/>
    <path d="M24 24.5c0-2.5 3.5-2.5 3.5.5 0 4-6.5 5-8 .5-2-5.5 5-10 10.5-7 7 4 5.5 15-3 17-9.5 2.3-17-5-15-14 2.3-10.5 14.5-15.5 24-9.5" fill="none" stroke="${INK}" stroke-width="1.2" stroke-linecap="round" opacity=".35"/>`),
  crowd: s(`<path d="M24 44S7 34 7 22.5a8.5 8.5 0 0 1 17-2.8 8.5 8.5 0 0 1 17 2.8C41 34 24 44 24 44z" fill="#e8384f" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M13 11.5l4 3.5 7-10 7 10 4-3.5-1.5 8.5H14.5z" fill="#ffd23f" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/>`),
};

// Chaos round twists: name, what everyone reads, what the drawer reads, and an icon.
export const CHAOS = {
  oneline: {
    label: 'One line',
    desc: 'The whole drawing is a single stroke. No lifting!',
    tip: "One stroke only: don't lift your finger until you're done!",
    svg: s(`<path d="M5 33c4-12 9-19 13-11s-3 16 4 16 7-24 13-24 1 20 7 14 2-9 2-9" fill="none" stroke="${INK}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="5" cy="33" r="4" fill="#ff5c39" stroke="${INK}" stroke-width="2"/>`),
  },
  blind: {
    label: 'Blindfold',
    desc: "The drawer can't see what they're drawing.",
    tip: "You're blindfolded: you won't see your drawing, but everyone else will!",
    svg: s(`<circle cx="24" cy="26" r="18" fill="#ffd23f" stroke="${INK}" stroke-width="3"/>
      <path d="M5.5 19.5h37v10h-37z" fill="${INK}"/><path d="M42 21l4-4M42 27l4 3" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
      <path d="M17 36q7 5 14 0" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`),
  },
  mirror: {
    label: 'Mirror',
    desc: 'Everything the drawer draws comes out flipped.',
    tip: 'Your drawing comes out flipped left to right!',
    svg: s(`<path d="M20 10L5 38h15z" fill="#5ec8f2" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
      <path d="M28 10l15 28H28z" fill="#fff" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
      <path d="M24 4v40" stroke="#8e5cf7" stroke-width="3" stroke-dasharray="4 4" stroke-linecap="round"/>`),
  },
  tiny: {
    label: 'Tiny brush',
    desc: 'Only the thinnest brush, and no fill.',
    tip: 'Only the thinnest brush, and no fill bucket. Get detailed!',
    svg: s(`<path d="M31 6l11 11-22 22H9V28z" fill="#ffd23f" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
      <path d="M9 28l11 11" stroke="${INK}" stroke-width="3"/><path d="M9 39l-3 3" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
      <circle cx="40" cy="41" r="2.4" fill="${INK}"/>`),
  },
  noundo: {
    label: 'No take-backs',
    desc: 'No undo, no eraser, no starting over.',
    tip: 'No undo, no eraser, no clearing. Make every line count!',
    svg: s(`<path d="M17 13L8 22l9 9" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M8 22h19a11 11 0 010 22h-6" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
      <circle cx="35" cy="13" r="9" fill="#e8384f" stroke="${INK}" stroke-width="2.5"/><path d="M31 9l8 8M39 9l-8 8" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`),
  },
  ink: {
    label: 'Ink only',
    desc: 'Black ink and nothing else.',
    tip: 'Black ink only. Colours are for quitters!',
    svg: s(`<path d="M24 4C20 14 10 22 10 31a14 14 0 0028 0c0-9-10-17-14-27z" fill="${INK}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
      <path d="M17 31a7 7 0 004 6" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`),
  },
};
