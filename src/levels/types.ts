/**
 * Level data. Pure data: no rendering or physics code depends on anything
 * here except these shapes. Coordinates are workshop units with the origin at
 * the board's near-left corner; +x is right, +y runs away from the player.
 * Angles are degrees, 0 = +x, 90 = straight up the board.
 */

export type CollectionId = 'basics' | 'angles' | 'pins' | 'fine' | 'edges' | 'turned' | 'brass' | 'long' | 'quarters' | 'master' | 'felt' | 'tilt' | 'workbench'

export interface Vec2 {
  x: number
  y: number
}

/** A ceramic block: centre, full size, optional rotation in degrees. */
export interface Block {
  x: number
  y: number
  w: number
  h: number
  rot?: number
}

/** A brass post (circular bumper). */
export interface Post {
  x: number
  y: number
  r: number
}

/** A thin brass deflector bar between two points. */
export interface Bar {
  x1: number
  y1: number
  x2: number
  y2: number
}

/** A gap in the walnut rail where the ball can leave the board. Measured along the side from its low end. */
export interface Opening {
  side: 'near' | 'far' | 'left' | 'right'
  from: number
  to: number
}

/** A baize (felt) panel inlaid flush in the board: inside it the ball loses speed much faster. Centre and size. */
export interface Felt {
  x: number
  y: number
  w: number
  h: number
}

/**
 * A gently sloped panel, flush at its edges: while the ball's centre is over it, it is pushed
 * downhill. Centre and size; `dir` is the downhill direction in degrees (0 = +x, 90 = up the board).
 */
export interface Slope {
  x: number
  y: number
  w: number
  h: number
  dir: number
}

export interface Shot {
  /** Degrees. */
  angle: number
  /** 0..1 */
  power: number
}

export interface LevelDef {
  id: string
  number: number
  name: string
  collection: CollectionId
  size: { w: number; h: number }
  ball: Vec2
  pocket: Vec2
  blocks?: Block[]
  posts?: Post[]
  bars?: Bar[]
  openings?: Opening[]
  felts?: Felt[]
  slopes?: Slope[]
  /** 1 (gentle) to 5 (demanding). Informational. */
  difficulty: number
  /** A launch verified by the test suite to sink the ball. */
  solution: Shot
}

export interface CollectionDef {
  id: CollectionId
  numeral: string
  title: string
}
