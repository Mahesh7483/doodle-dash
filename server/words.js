'use strict';

// Word packs. Every pack has 30 easy, 30 medium and 30 hard words.
// Words use only lowercase letters, spaces and hyphens so the blanks mask stays simple.

const PACKS = {
  everyday: {
    label: 'Everyday',
    easy: [
      'cup', 'key', 'bed', 'door', 'chair', 'clock', 'lamp', 'book', 'shoe', 'sock',
      'hat', 'ball', 'bag', 'pen', 'spoon', 'fork', 'plate', 'phone', 'bell', 'box',
      'star', 'sun', 'moon', 'tree', 'house', 'car', 'bus', 'boat', 'kite', 'window',
    ],
    medium: [
      'umbrella', 'scissors', 'toothbrush', 'glasses', 'backpack', 'pillow', 'candle', 'ladder', 'mirror', 'bucket',
      'camera', 'guitar', 'bicycle', 'envelope', 'balloon', 'wallet', 'headphones', 'sofa', 'bathtub', 'keyboard',
      'pencil', 'hammer', 'magnet', 'trophy', 'rainbow', 'snowman', 'robot', 'crown', 'anchor', 'calendar',
    ],
    hard: [
      'vacuum cleaner', 'washing machine', 'alarm clock', 'light bulb', 'traffic light', 'fire extinguisher',
      'paper clip', 'safety pin', 'hourglass', 'microscope', 'telescope', 'parachute', 'wheelchair', 'doorbell',
      'thermometer', 'remote control', 'sewing machine', 'screwdriver', 'flashlight', 'lawn mower',
      'shopping cart', 'piggy bank', 'treasure map', 'satellite', 'windmill', 'escalator', 'chandelier',
      'typewriter', 'stapler', 'zipper',
    ],
  },
  animals: {
    label: 'Animals',
    easy: [
      'cat', 'dog', 'fish', 'bird', 'cow', 'pig', 'duck', 'frog', 'bee', 'ant',
      'snake', 'horse', 'sheep', 'mouse', 'lion', 'bear', 'owl', 'crab', 'snail', 'whale',
      'rabbit', 'turtle', 'spider', 'chicken', 'monkey', 'zebra', 'shark', 'goat', 'bat', 'worm',
    ],
    medium: [
      'giraffe', 'elephant', 'penguin', 'octopus', 'dolphin', 'kangaroo', 'crocodile', 'butterfly', 'squirrel', 'flamingo',
      'peacock', 'camel', 'hedgehog', 'jellyfish', 'ladybug', 'parrot', 'seahorse', 'starfish', 'tiger', 'koala',
      'panda', 'polar bear', 'raccoon', 'deer', 'fox', 'wolf', 'gorilla', 'lobster', 'swan', 'hippo',
    ],
    hard: [
      'chameleon', 'platypus', 'porcupine', 'armadillo', 'sloth', 'narwhal', 'stingray', 'woodpecker', 'caterpillar',
      'dragonfly', 'scorpion', 'mosquito', 'walrus', 'pelican', 'ostrich', 'meerkat', 'anteater', 'hummingbird',
      'rhinoceros', 'jaguar', 'grasshopper', 'beaver', 'skunk', 'moose', 'llama', 'iguana', 'toucan',
      'praying mantis', 'hammerhead shark', 'seagull',
    ],
  },
  food: {
    label: 'Food',
    easy: [
      'apple', 'banana', 'pizza', 'egg', 'bread', 'cake', 'cookie', 'carrot', 'cheese', 'grapes',
      'lemon', 'milk', 'pie', 'soup', 'candy', 'corn', 'pear', 'cherry', 'donut', 'burger',
      'fries', 'ice cream', 'rice', 'honey', 'tea', 'orange', 'peas', 'jam', 'taco', 'noodles',
    ],
    medium: [
      'watermelon', 'pineapple', 'sandwich', 'popcorn', 'pancake', 'spaghetti', 'hot dog', 'cupcake', 'broccoli', 'mushroom',
      'strawberry', 'avocado', 'sushi', 'pretzel', 'lollipop', 'coconut', 'pumpkin', 'cucumber', 'potato', 'onion',
      'muffin', 'waffle', 'milkshake', 'lemonade', 'tomato', 'peanut', 'chili', 'bagel', 'burrito', 'cereal',
    ],
    hard: [
      'birthday cake', 'fortune cookie', 'gingerbread man', 'cotton candy', 'corn dog', 'fruit salad', 'fried egg',
      'candy cane', 'chocolate bar', 'baguette', 'dumpling', 'croissant', 'kebab', 'lasagna', 'nachos', 'omelette',
      'popsicle', 'smoothie', 'bubble gum', 'pomegranate', 'eggplant', 'artichoke', 'asparagus', 'garlic',
      'cauliflower', 'jelly beans', 'meatball', 'picnic basket', 'lunchbox', 'gumball machine',
    ],
  },
  places: {
    label: 'Places',
    easy: [
      'beach', 'park', 'farm', 'school', 'castle', 'island', 'zoo', 'cave', 'road', 'bridge',
      'desert', 'forest', 'lake', 'mountain', 'river', 'city', 'garden', 'pool', 'shop', 'tent',
      'jungle', 'igloo', 'library', 'hospital', 'playground', 'kitchen', 'bedroom', 'bathroom', 'space', 'ocean',
    ],
    medium: [
      'lighthouse', 'pyramid', 'waterfall', 'stadium', 'museum', 'bakery', 'restaurant', 'airport', 'train station', 'cinema',
      'circus', 'aquarium', 'skyscraper', 'harbor', 'treehouse', 'supermarket', 'classroom', 'farmhouse', 'barn', 'gas station',
      'fire station', 'palace', 'glacier', 'swamp', 'canyon', 'cliff', 'north pole', 'parking lot', 'bus stop', 'hotel',
    ],
    hard: [
      'eiffel tower', 'statue of liberty', 'great wall', 'amusement park', 'haunted house', 'space station',
      'bowling alley', 'construction site', 'laundromat', 'observatory', 'oasis', 'rainforest', 'volcano',
      'coral reef', 'ski resort', 'post office', 'barbershop', 'car wash', 'water park', 'skate park',
      'greenhouse', 'big ben', 'leaning tower', 'mount everest', 'niagara falls', 'stonehenge', 'colosseum',
      'taj mahal', 'golden gate bridge', 'times square',
    ],
  },
  actions: {
    label: 'Actions',
    easy: [
      'run', 'jump', 'swim', 'sleep', 'eat', 'cry', 'laugh', 'dance', 'sing', 'read',
      'write', 'walk', 'fly', 'sit', 'smile', 'wave', 'kick', 'throw', 'climb', 'cook',
      'drink', 'wash', 'fall', 'push', 'pull', 'clap', 'dig', 'hug', 'paint', 'sneeze',
    ],
    medium: [
      'juggle', 'skate', 'surf', 'ski', 'bowl', 'knit', 'yawn', 'whisper', 'shout', 'sweep',
      'snore', 'dive', 'hike', 'shiver', 'wink', 'tickle', 'sneak', 'bake', 'race', 'slide',
      'stretch', 'brush teeth', 'tie shoes', 'ride a bike', 'fly a kite', 'take a photo', 'blow bubbles',
      'jump rope', 'play guitar', 'water plants',
    ],
    hard: [
      'meditate', 'sleepwalk', 'daydream', 'stargaze', 'hibernate', 'celebrate', 'tiptoe', 'somersault',
      'cartwheel', 'moonwalk', 'skydive', 'snorkel', 'tightrope walk', 'arm wrestle', 'high five', 'belly flop',
      'magic trick', 'hide and seek', 'walk the dog', 'build a sandcastle', 'make a wish', 'catch a fish',
      'carve a pumpkin', 'change a tire', 'do homework', 'go camping', 'sunbathe', 'rock climbing',
      'ice skating', 'bungee jump',
    ],
  },
};

const DIFFICULTIES = ['easy', 'medium', 'hard'];
const MULTIPLIERS = { easy: 1, medium: 1.5, hard: 2 };

// Mixed = every pack combined (deduplicated per difficulty).
function mixedPack() {
  const out = { label: 'Mixed' };
  const seen = new Set();
  for (const d of DIFFICULTIES) {
    out[d] = [];
    for (const key of Object.keys(PACKS)) {
      for (const w of PACKS[key][d]) {
        if (!seen.has(w)) {
          seen.add(w);
          out[d].push(w);
        }
      }
    }
  }
  return out;
}
PACKS.mixed = mixedPack();

const PACK_IDS = ['everyday', 'animals', 'food', 'places', 'actions', 'mixed', 'custom'];
const PACK_LABELS = Object.fromEntries(PACK_IDS.map((id) => [id, id === 'custom' ? 'Custom words' : PACKS[id].label]));

// Custom words: comma (or newline) separated, 2–30 chars each, letters/spaces/hyphens/apostrophes only.
function parseCustomWords(input) {
  if (typeof input !== 'string') input = Array.isArray(input) ? input.join(',') : '';
  const words = [];
  const seen = new Set();
  for (let raw of input.slice(0, 5000).split(/[,\n]/)) {
    const w = raw.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
    if (w.length < 2 || w.length > 30) continue;
    if (!/^[\p{L}][\p{L} '\-]*[\p{L}]$/u.test(w)) continue;
    if (seen.has(w)) continue;
    seen.add(w);
    words.push(w);
    if (words.length >= 300) break;
  }
  return words;
}

module.exports = { PACKS, PACK_IDS, PACK_LABELS, DIFFICULTIES, MULTIPLIERS, parseCustomWords };
