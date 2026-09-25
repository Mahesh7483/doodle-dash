'use strict';

// Family-friendly filter for names and chat. Whole words only (so "class" and "Scunthorpe" are
// fine), after folding case, accents and look-alike characters ("sh1t", "@ss"). A handful of
// words that never appear inside innocent words are also caught inside longer words.

const WORDS = [
  // English
  'fuck', 'fucked', 'fucker', 'fucking', 'motherfucker', 'shit', 'shitty', 'bullshit', 'cunt', 'bitch', 'bitches',
  'asshole', 'ass', 'arse', 'arsehole', 'bastard', 'dick', 'dickhead', 'pussy', 'cock', 'wanker', 'twat',
  'slut', 'whore', 'porn', 'porno', 'dildo', 'jizz', 'boner', 'bollocks', 'prick', 'douche', 'douchebag',
  'nigger', 'nigga', 'faggot', 'fag', 'retard', 'retarded', 'spic', 'chink', 'tranny', 'dyke', 'coon',
  'wetback', 'raghead', 'paki',
  // Spanish
  'puta', 'puto', 'mierda', 'joder', 'jodido', 'cabron', 'pendejo', 'gilipollas', 'verga', 'culero',
  'chinga', 'chingada', 'chingar', 'maricon', 'polla', 'follar', 'culo', 'mamon', 'huevon', 'pinche',
];

// Never inside an innocent word, so they're caught inside longer ones too ("fuckface").
const INSIDE = ['fuck', 'nigger', 'nigga', 'faggot', 'motherfuck'];

const SUFFIXES = ['s', 'es', 'ed', 'er', 'ers', 'ing'];

const LOOKALIKE = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's' };

const BAD = new Set(WORDS);

function fold(word) {
  return word
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[013457@$]/g, (c) => LOOKALIKE[c]);
}

function badWord(raw) {
  const w = fold(raw);
  if (!/\p{L}/u.test(w)) return false;
  // "fuuuck" -> "fuck", "assss" -> "ass"
  const forms = new Set([w, w.replace(/(.)\1{2,}/g, '$1'), w.replace(/(.)\1{2,}/g, '$1$1')]);
  for (const f of forms) {
    if (BAD.has(f)) return true;
    for (const s of SUFFIXES) if (f.length > s.length + 2 && f.endsWith(s) && BAD.has(f.slice(0, -s.length))) return true;
    if (INSIDE.some((x) => f.includes(x))) return true;
  }
  return false;
}

const WORD_RE = /[\p{L}\p{N}@$]+/gu;

function isRude(text) {
  return (String(text).match(WORD_RE) || []).some(badWord);
}

// Rude words become stars of the same length; everything else is left alone.
function censor(text) {
  return String(text).replace(WORD_RE, (w) => (badWord(w) ? '*'.repeat([...w].length) : w));
}

module.exports = { isRude, censor };
