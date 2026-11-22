import type { CollectionId } from '../levels/types'

/**
 * Each collection is made in its own timber, so moving through the Collection feels like moving
 * through a cabinet of different pieces. Tones are linear-ish sRGB bases for the procedural grain.
 */
export interface Finish {
  /** Name of the wood, for the record (not shown). */
  wood: string
  field: [number, number, number]
  rail: [number, number, number]
  /** Grain pattern seed and density, so each wood has its own figure. */
  seed: number
  lines: number
  /** The pale inlaid line (boxwood or holly) around the playing field. */
  stringing: number
}

export const FINISHES: Record<CollectionId, Finish> = {
  basics: { wood: 'walnut', field: [112, 74, 50], rail: [92, 60, 40], seed: 7, lines: 46, stringing: 0xe9dcb8 },
  angles: { wood: 'cherry', field: [148, 80, 54], rail: [112, 58, 40], seed: 11, lines: 40, stringing: 0xeadfc2 },
  pins: { wood: 'oak', field: [170, 128, 80], rail: [120, 86, 52], seed: 23, lines: 30, stringing: 0x3a2a1c },
  fine: { wood: 'ebony', field: [60, 44, 36], rail: [44, 32, 27], seed: 5, lines: 62, stringing: 0xd9c08a },
  edges: { wood: 'maple', field: [206, 172, 124], rail: [150, 110, 72], seed: 29, lines: 54, stringing: 0x4a3220 },
  turned: { wood: 'olive ash', field: [176, 140, 96], rail: [96, 70, 48], seed: 31, lines: 22, stringing: 0x2e2218 },
  brass: { wood: 'rosewood', field: [104, 52, 40], rail: [76, 38, 30], seed: 37, lines: 50, stringing: 0xe5d3a6 },
  long: { wood: 'elm', field: [158, 108, 70], rail: [108, 72, 46], seed: 41, lines: 26, stringing: 0xeadcb4 },
  quarters: { wood: 'teak', field: [140, 96, 56], rail: [100, 66, 40], seed: 43, lines: 38, stringing: 0xeee2c0 },
  felt: { wood: 'mahogany', field: [122, 60, 42], rail: [92, 44, 32], seed: 47, lines: 44, stringing: 0xe9d7a8 },
  tilt: { wood: 'pear', field: [182, 128, 92], rail: [122, 82, 58], seed: 53, lines: 58, stringing: 0x3d2a1c },
  master: { wood: 'bog oak', field: [52, 42, 36], rail: [38, 31, 27], seed: 59, lines: 34, stringing: 0xc9a764 },
  workbench: { wood: 'beech', field: [196, 150, 106], rail: [136, 98, 66], seed: 61, lines: 48, stringing: 0x5a3c24 },
}
