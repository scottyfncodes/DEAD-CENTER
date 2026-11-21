import type { CollectionDef, LevelDef } from './types'

export const COLLECTIONS: CollectionDef[] = [
  { id: 'basics', numeral: 'I', title: 'The Basics' },
  { id: 'angles', numeral: 'II', title: 'Angles & Edges' },
  { id: 'pins', numeral: 'III', title: 'Pins & Posts' },
  { id: 'fine', numeral: 'IV', title: 'Fine Work' },
]

/**
 * The Collection. Every solution below is verified by tests/levels.test.ts;
 * run `npm run solve -- <id>` to search a level and measure its tolerance.
 */
export const LEVELS: LevelDef[] = [
  // I. The Basics: direction, power, precision.
  {
    id: 'straightaway',
    number: 1,
    name: 'The Straightaway',
    collection: 'basics',
    size: { w: 9, h: 15 },
    ball: { x: 4.5, y: 2.6 },
    pocket: { x: 4.5, y: 11.6 },
    difficulty: 1,
    solution: { angle: 90, power: 0.215 },
  },
  {
    id: 'a-little-further',
    number: 2,
    name: 'A Little Further',
    collection: 'basics',
    size: { w: 9, h: 19 },
    ball: { x: 4.5, y: 2.4 },
    pocket: { x: 4.5, y: 16.6 },
    blocks: [
      { x: 1.6, y: 10, w: 3.2, h: 0.9 },
      { x: 7.4, y: 10, w: 3.2, h: 0.9 },
    ],
    openings: [{ side: 'far', from: 0, to: 9 }],
    difficulty: 1,
    solution: { angle: 90, power: 0.309 },
  },
  {
    id: 'easy-does-it',
    number: 3,
    name: 'Easy Does It',
    collection: 'basics',
    size: { w: 10, h: 18 },
    ball: { x: 2.4, y: 2.4 },
    pocket: { x: 7.4, y: 14.8 },
    blocks: [
      { x: 2.2, y: 8.6, w: 4.4, h: 0.9 },
      { x: 8.4, y: 8.6, w: 3.2, h: 0.9 },
      { x: 3.6, y: 14.2, w: 0.9, h: 4.2 },
    ],
    difficulty: 2,
    solution: { angle: 284.04, power: 0.723 },
  },

  // II. Angles & Edges: bank shots and rebounds.
  {
    id: 'the-elbow',
    number: 4,
    name: 'The Elbow',
    collection: 'angles',
    size: { w: 12, h: 20 },
    ball: { x: 2.5, y: 3 },
    pocket: { x: 3.4, y: 16.4 },
    blocks: [{ x: 3.5, y: 10, w: 7, h: 0.9 }],
    difficulty: 2,
    solution: { angle: 45.99, power: 0.769 },
  },
  {
    id: 'around-the-bend',
    number: 5,
    name: 'Around the Bend',
    collection: 'angles',
    size: { w: 12, h: 22 },
    ball: { x: 2.2, y: 2.8 },
    pocket: { x: 2.5, y: 17.5 },
    blocks: [
      { x: 3.75, y: 7.5, w: 7.5, h: 0.9 },
      { x: 8.25, y: 14.5, w: 7.5, h: 0.9 },
    ],
    difficulty: 3,
    solution: { angle: 27.66, power: 0.821 },
  },
  {
    id: 'second-thoughts',
    number: 6,
    name: 'Second Thoughts',
    collection: 'angles',
    size: { w: 12, h: 18 },
    ball: { x: 3, y: 3.4 },
    pocket: { x: 9.75, y: 5 },
    blocks: [{ x: 6, y: 4.25, w: 0.9, h: 8.5 }],
    difficulty: 3,
    solution: { angle: 122.99, power: 0.938 },
  },

  // III. Pins & Posts: circular bumpers and multiple contacts.
  {
    id: 'three-pins',
    number: 7,
    name: 'Three Pins',
    collection: 'pins',
    size: { w: 11, h: 19 },
    ball: { x: 5.5, y: 2.6 },
    pocket: { x: 5.5, y: 16 },
    posts: [
      { x: 5.5, y: 9, r: 0.75 },
      { x: 3.4, y: 11.6, r: 0.75 },
      { x: 7.6, y: 11.6, r: 0.75 },
    ],
    difficulty: 3,
    solution: { angle: 58.76, power: 0.637 },
  },
  {
    id: 'the-deflection',
    number: 8,
    name: 'The Deflection',
    collection: 'pins',
    size: { w: 12, h: 20 },
    ball: { x: 9.5, y: 2.6 },
    pocket: { x: 3.5, y: 16.5 },
    blocks: [{ x: 4.2, y: 12.4, w: 8.4, h: 0.9 }],
    bars: [{ x1: 9.0, y1: 18.9, x2: 11.7, y2: 16.2 }],
    difficulty: 3,
    solution: { angle: 86.51, power: 0.47 },
  },
  {
    id: 'the-long-way',
    number: 9,
    name: 'The Long Way',
    collection: 'pins',
    size: { w: 12, h: 21 },
    ball: { x: 3, y: 2.6 },
    pocket: { x: 10.25, y: 7.75 },
    blocks: [{ x: 6, y: 6.5, w: 0.9, h: 13 }],
    posts: [
      { x: 6, y: 17.6, r: 1.3 },
      { x: 1.8, y: 13.4, r: 0.6 },
      { x: 10.2, y: 13.4, r: 0.6 },
    ],
    difficulty: 4,
    solution: { angle: 126.77, power: 0.708 },
  },

  // IV. Fine Work: everything at once, tighter.
  {
    id: 'the-needle',
    number: 10,
    name: 'The Needle',
    collection: 'fine',
    size: { w: 12, h: 22 },
    ball: { x: 2.6, y: 2.6 },
    pocket: { x: 9.2, y: 19 },
    blocks: [
      { x: 3.1, y: 11, w: 6.2, h: 0.9 },
      { x: 9.85, y: 11, w: 4.3, h: 0.9 },
    ],
    posts: [{ x: 6, y: 15.6, r: 0.6 }],
    difficulty: 4,
    solution: { angle: 60.77, power: 0.524 },
  },
  {
    id: 'just-enough',
    number: 11,
    name: 'Just Enough',
    collection: 'fine',
    size: { w: 12, h: 20 },
    ball: { x: 2.4, y: 2.6 },
    pocket: { x: 8.5, y: 16.5 },
    blocks: [{ x: 6, y: 8, w: 7, h: 0.9 }],
    openings: [
      { side: 'far', from: 0, to: 12 },
      { side: 'left', from: 13, to: 20 },
      { side: 'right', from: 13, to: 20 },
    ],
    difficulty: 4,
    solution: { angle: 311.78, power: 0.927 },
  },
  {
    id: 'dead-center',
    number: 12,
    name: 'Dead Center',
    collection: 'fine',
    size: { w: 13, h: 22 },
    ball: { x: 6.5, y: 2.6 },
    pocket: { x: 6.5, y: 11.6 },
    blocks: [
      { x: 5.5, y: 8.2, w: 4.8, h: 0.8 },
      { x: 9.9, y: 10.6, w: 0.8, h: 4.8 },
      { x: 7.5, y: 15.0, w: 4.8, h: 0.8 },
      { x: 3.1, y: 12.6, w: 0.8, h: 4.8 },
    ],
    posts: [
      { x: 8.7, y: 6.0, r: 0.75 },
      { x: 4.3, y: 17.4, r: 0.75 },
    ],
    difficulty: 5,
    solution: { angle: 142.47, power: 0.622 },
  },
]

export function levelById(id: string): LevelDef | undefined {
  return LEVELS.find((l) => l.id === id)
}
