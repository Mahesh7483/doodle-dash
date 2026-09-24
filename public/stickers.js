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
