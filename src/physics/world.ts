import type { LevelDef, Opening } from '../levels/types'
import { BAR_R, BALL_R, RAIL_T, type Material } from './constants'

/** Oriented rectangle. */
export interface BoxCollider {
  kind: 'box'
  id: number
  mat: Material
  cx: number
  cy: number
  hx: number
  hy: number
  cos: number
  sin: number
  /** Bounding radius for the broad phase. */
  bound: number
}

/** Segment with a radius (a deflector bar). */
export interface CapsuleCollider {
  kind: 'capsule'
  id: number
  mat: Material
  ax: number
  ay: number
  bx: number
  by: number
  r: number
  cx: number
  cy: number
  bound: number
}

export interface CircleCollider {
  kind: 'circle'
  id: number
  mat: Material
  cx: number
  cy: number
  r: number
  bound: number
}

export type Collider = BoxCollider | CapsuleCollider | CircleCollider

export interface Rail {
  side: Opening['side']
  /** Box in board space (centre and half extents, axis aligned). */
  cx: number
  cy: number
  hx: number
  hy: number
}

export interface World {
  w: number
  h: number
  colliders: Collider[]
  rails: Rail[]
  pocket: { x: number; y: number }
}

const DEG = Math.PI / 180

/** Split one side of the perimeter into rail pieces around its openings. */
function railPieces(side: Opening['side'], length: number, openings: Opening[]): Array<[number, number]> {
  const gaps = openings
    .filter((o) => o.side === side)
    .map((o) => [Math.max(0, o.from), Math.min(length, o.to)] as [number, number])
    .sort((a, b) => a[0] - b[0])
  const pieces: Array<[number, number]> = []
  let at = -RAIL_T
  for (const [from, to] of gaps) {
    if (from > at) pieces.push([at, from])
    at = Math.max(at, to)
  }
  if (length + RAIL_T > at) pieces.push([at, length + RAIL_T])
  return pieces.filter(([a, b]) => b - a > 1e-6)
}

export function buildRails(level: LevelDef): Rail[] {
  const { w, h } = level.size
  const openings = level.openings ?? []
  const rails: Rail[] = []
  const t = RAIL_T / 2
  for (const [a, b] of railPieces('near', w, openings)) rails.push({ side: 'near', cx: (a + b) / 2, cy: -t, hx: (b - a) / 2, hy: t })
  for (const [a, b] of railPieces('far', w, openings)) rails.push({ side: 'far', cx: (a + b) / 2, cy: h + t, hx: (b - a) / 2, hy: t })
  // Side rails run between the near and far rails' inner faces; corners belong to near/far pieces.
  for (const [a, b] of railPieces('left', h, openings).map(([a, b]) => [Math.max(a, 0), Math.min(b, h)])) {
    if (b - a > 1e-6) rails.push({ side: 'left', cx: -t, cy: (a + b) / 2, hx: t, hy: (b - a) / 2 })
  }
  for (const [a, b] of railPieces('right', h, openings).map(([a, b]) => [Math.max(a, 0), Math.min(b, h)])) {
    if (b - a > 1e-6) rails.push({ side: 'right', cx: w + t, cy: (a + b) / 2, hx: t, hy: (b - a) / 2 })
  }
  return rails
}

/** Compile a level into the collision world used by the simulation. */
export function buildWorld(level: LevelDef): World {
  const colliders: Collider[] = []
  let id = 0
  for (const r of buildRails(level)) {
    colliders.push({ kind: 'box', id: id++, mat: 'wood', cx: r.cx, cy: r.cy, hx: r.hx, hy: r.hy, cos: 1, sin: 0, bound: Math.hypot(r.hx, r.hy) })
  }
  for (const b of level.blocks ?? []) {
    const a = (b.rot ?? 0) * DEG
    colliders.push({
      kind: 'box',
      id: id++,
      mat: 'ceramic',
      cx: b.x,
      cy: b.y,
      hx: b.w / 2,
      hy: b.h / 2,
      cos: Math.cos(a),
      sin: Math.sin(a),
      bound: Math.hypot(b.w, b.h) / 2,
    })
  }
  for (const p of level.posts ?? []) {
    colliders.push({ kind: 'circle', id: id++, mat: 'brass', cx: p.x, cy: p.y, r: p.r, bound: p.r })
  }
  for (const s of level.bars ?? []) {
    const cx = (s.x1 + s.x2) / 2
    const cy = (s.y1 + s.y2) / 2
    colliders.push({
      kind: 'capsule',
      id: id++,
      mat: 'brass',
      ax: s.x1,
      ay: s.y1,
      bx: s.x2,
      by: s.y2,
      r: BAR_R,
      cx,
      cy,
      bound: Math.hypot(s.x2 - s.x1, s.y2 - s.y1) / 2 + BAR_R,
    })
  }
  return { w: level.size.w, h: level.size.h, colliders, rails: buildRails(level), pocket: { ...level.pocket } }
}

export interface Contact {
  /** Penetration depth (positive when overlapping). */
  depth: number
  nx: number
  ny: number
}

/**
 * Closest-feature contact between the ball (centre x,y) and a collider.
 * Returns null when they do not touch. Corners of boxes behave as points,
 * which gives the ball a clean, stable response on every edge and corner.
 */
export function contact(c: Collider, x: number, y: number, r = BALL_R): Contact | null {
  const dx0 = x - c.cx
  const dy0 = y - c.cy
  const reach = c.bound + r
  if (dx0 * dx0 + dy0 * dy0 > reach * reach) return null

  if (c.kind === 'circle') {
    const d = Math.sqrt(dx0 * dx0 + dy0 * dy0)
    const depth = c.r + r - d
    if (depth <= 0) return null
    if (d < 1e-9) return { depth, nx: 0, ny: 1 }
    return { depth, nx: dx0 / d, ny: dy0 / d }
  }

  if (c.kind === 'capsule') {
    const ex = c.bx - c.ax
    const ey = c.by - c.ay
    const len2 = ex * ex + ey * ey
    let t = len2 > 0 ? ((x - c.ax) * ex + (y - c.ay) * ey) / len2 : 0
    t = t < 0 ? 0 : t > 1 ? 1 : t
    const px = c.ax + ex * t
    const py = c.ay + ey * t
    const dx = x - px
    const dy = y - py
    const d = Math.sqrt(dx * dx + dy * dy)
    const depth = c.r + r - d
    if (depth <= 0) return null
    if (d < 1e-9) return { depth, nx: -ey / Math.sqrt(len2), ny: ex / Math.sqrt(len2) }
    return { depth, nx: dx / d, ny: dy / d }
  }

  // Box: work in its local frame.
  const lx = dx0 * c.cos + dy0 * c.sin
  const ly = -dx0 * c.sin + dy0 * c.cos
  const qx = lx < -c.hx ? -c.hx : lx > c.hx ? c.hx : lx
  const qy = ly < -c.hy ? -c.hy : ly > c.hy ? c.hy : ly
  let nlx: number
  let nly: number
  let depth: number
  if (qx === lx && qy === ly) {
    // Centre inside the box (only after a very deep step): push out along the shallowest face.
    const px = c.hx - Math.abs(lx)
    const py = c.hy - Math.abs(ly)
    if (px < py) {
      nlx = lx >= 0 ? 1 : -1
      nly = 0
      depth = px + r
    } else {
      nlx = 0
      nly = ly >= 0 ? 1 : -1
      depth = py + r
    }
  } else {
    const dx = lx - qx
    const dy = ly - qy
    const d = Math.sqrt(dx * dx + dy * dy)
    depth = r - d
    if (depth <= 0) return null
    nlx = dx / d
    nly = dy / d
  }
  return { depth, nx: nlx * c.cos - nly * c.sin, ny: nlx * c.sin + nly * c.cos }
}
