import { BALL_R, POCKET_R, RAIL_T } from '../physics/constants'
import { simulate, type ShotResult } from '../physics/sim'
import { buildWorld, contact, type World } from '../physics/world'
import type { LevelDef, Shot } from './types'

/**
 * Level validation: structural checks, shot simulation, solution search and
 * tolerance measurement. Used by the test suite and by `npm run solve`.
 */

const worlds = new WeakMap<LevelDef, World>()
export function worldFor(level: LevelDef): World {
  let w = worlds.get(level)
  if (!w) {
    w = buildWorld(level)
    worlds.set(level, w)
  }
  return w
}

export function runShot(level: LevelDef, shot: Shot, record = false): ShotResult {
  return simulate(worldFor(level), level.ball, shot, { record })
}

export function sinks(level: LevelDef, shot: Shot): boolean {
  return runShot(level, shot).outcome === 'sunk'
}

/** Problems with a level's definition (empty when it is sound). */
export function structuralProblems(level: LevelDef): string[] {
  const out: string[] = []
  const { w, h } = level.size
  const world = worldFor(level)
  const inside = (p: { x: number; y: number }, m: number) => p.x >= m && p.x <= w - m && p.y >= m && p.y <= h - m
  if (!(w > 2 && h > 2)) out.push('arena too small')
  if (!inside(level.ball, BALL_R)) out.push('ball starts off the board or inside a rail')
  if (!inside(level.pocket, POCKET_R)) out.push('pocket overlaps the edge of the board')
  for (const c of world.colliders) {
    const hit = contact(c, level.ball.x, level.ball.y, BALL_R + 0.05)
    if (hit) out.push(`ball starts touching collider ${c.id} (${c.kind})`)
    const ph = contact(c, level.pocket.x, level.pocket.y, POCKET_R + 0.05)
    if (ph) out.push(`pocket is covered by collider ${c.id} (${c.kind})`)
  }
  const dist = Math.hypot(level.ball.x - level.pocket.x, level.ball.y - level.pocket.y)
  if (dist < POCKET_R + BALL_R + 1) out.push('ball starts too close to the pocket')
  for (const o of level.openings ?? []) {
    const len = o.side === 'near' || o.side === 'far' ? w : h
    if (!(o.from < o.to) || o.from < -RAIL_T || o.to > len + RAIL_T) out.push(`opening on ${o.side} is malformed`)
  }
  return out
}

export interface Window {
  /** Contiguous sinking range around the solution, in degrees. */
  angleMin: number
  angleMax: number
  /** Contiguous sinking range around the solution, as power fractions. */
  powerMin: number
  powerMax: number
  /** Fraction of a ±1° × ±4% neighbourhood that sinks. */
  neighbourhood: number
}

/** Walk outward from a known solution to measure how forgiving it is. */
export function tolerance(level: LevelDef, shot: Shot, step = { angle: 0.02, power: 0.002 }): Window {
  const walk = (dir: 1 | -1, key: 'angle' | 'power', size: number, limit: number) => {
    let v = shot[key]
    for (let i = 0; i < limit; i++) {
      const next = v + dir * size
      const s = { ...shot, [key]: next }
      if (key === 'power' && (next <= 0 || next > 1)) break
      if (!sinks(level, s)) break
      v = next
    }
    return v
  }
  const angleMin = walk(-1, 'angle', step.angle, 1500)
  const angleMax = walk(1, 'angle', step.angle, 1500)
  const powerMin = walk(-1, 'power', step.power, 500)
  const powerMax = walk(1, 'power', step.power, 500)
  let hits = 0
  let total = 0
  for (let da = -1; da <= 1.0001; da += 0.25) {
    for (let dp = -0.04; dp <= 0.04001; dp += 0.01) {
      total++
      if (sinks(level, { angle: shot.angle + da, power: shot.power + dp })) hits++
    }
  }
  return { angleMin, angleMax, powerMin, powerMax, neighbourhood: hits / total }
}

export interface Candidate {
  shot: Shot
  /** Width of the sinking run in angle at this power (degrees). */
  angleWidth: number
}

/**
 * Coarse-to-fine search for sinking shots. Returns candidates sorted by how
 * forgiving they are, most forgiving first.
 */
export function search(level: LevelDef, opts: { angleStep?: number; powerStep?: number; minPower?: number } = {}): Candidate[] {
  const aStep = opts.angleStep ?? 0.25
  const pStep = opts.powerStep ?? 0.02
  const found: Candidate[] = []
  for (let p = opts.minPower ?? 0.06; p <= 1.0001; p += pStep) {
    let runStart = -1
    for (let a = 0; a <= 360; a += aStep) {
      const ok = a < 360 && sinks(level, { angle: a, power: p })
      if (ok && runStart < 0) runStart = a
      if (!ok && runStart >= 0) {
        const width = a - runStart
        found.push({ shot: { angle: +(runStart + (width - aStep) / 2).toFixed(3), power: +p.toFixed(3) }, angleWidth: width })
        runStart = -1
      }
    }
  }
  return found.sort((a, b) => b.angleWidth - a.angleWidth)
}
