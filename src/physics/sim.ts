import type { Shot } from '../levels/types'
import {
  BALL_R,
  CAPTURE_INSET,
  CAPTURE_SPEED,
  DT,
  FELT_DAMP,
  FELT_DECEL,
  FRAME_EVERY,
  IMPACT_THRESHOLD,
  LINEAR_DAMP,
  MATERIALS,
  MAX_SPEED,
  MAX_TIME,
  MIN_POWER,
  POCKET_DRAG,
  POCKET_PULL,
  POCKET_R,
  ROLL_DECEL,
  STOP_SPEED,
  type Material,
} from './constants'
import { contact, type World } from './world'

export type Outcome = 'sunk' | 'rest' | 'fell'

export type ShotEvent =
  | { t: number; kind: 'hit'; mat: Material; intensity: number; x: number; y: number }
  | { t: number; kind: 'rim'; intensity: number; offset: number }
  | { t: number; kind: 'capture'; speed: number }
  | { t: number; kind: 'edge' }

export interface ShotResult {
  outcome: Outcome
  /** Ball centre, interleaved x,y, one pair every FRAME_EVERY steps (index 0 = launch). */
  frames: Float32Array
  frameDt: number
  /** Time the ball came to rest, dropped into the pocket, or left the board. */
  endTime: number
  events: ShotEvent[]
  end: { x: number; y: number }
  /** Velocity at the end (used to carry a fall off the edge or a drop into the pocket). */
  endVelocity: { x: number; y: number }
  /** Closest the ball's centre came to the pocket centre. */
  closest: number
  contacts: number
  /**
   * For a sunk ball: how far off centre it was heading as it crossed the rim the last time, as the
   * distance from the pocket centre to its line of travel (0 = dead centre). Null otherwise.
   */
  entryOffset: number | null
}

const DEG = Math.PI / 180

export function launchVelocity(shot: Shot): { vx: number; vy: number } {
  const p = Math.max(0, Math.min(1, shot.power))
  const speed = MAX_SPEED * Math.sqrt(p)
  const a = shot.angle * DEG
  return { vx: Math.cos(a) * speed, vy: Math.sin(a) * speed }
}

export function isLaunchable(shot: Shot): boolean {
  return shot.power >= MIN_POWER
}

/**
 * Simulate one complete shot from rest. Deterministic: the same world, start
 * and shot always give bit-identical results. The whole shot is computed at
 * release; rendering only plays it back, so frame rate never affects physics.
 */
export function simulate(world: World, start: { x: number; y: number }, shot: Shot, opts: { record?: boolean } = {}): ShotResult {
  const record = opts.record !== false
  const v0 = launchVelocity(shot)
  let x = start.x
  let y = start.y
  let vx = v0.vx
  let vy = v0.vy
  const px = world.pocket.x
  const py = world.pocket.y
  const colliders = world.colliders
  const lastHit = new Map<number, number>()
  const events: ShotEvent[] = []
  const frames: number[] = record ? [x, y] : []
  let closest = Math.hypot(x - px, y - py)
  let contacts = 0
  let outcome: Outcome = 'rest'
  let overHole = false
  let entryOffset: number | null = null
  const zones = world.zones
  const maxSteps = Math.round(MAX_TIME / DT)
  let step = 0

  for (; step < maxSteps; step++) {
    const t = (step + 1) * DT

    // Pocket influence: a centre over the hole tilts toward it.
    const dpx = px - x
    const dpy = py - y
    const dp = Math.sqrt(dpx * dpx + dpy * dpy)
    const inHole = dp < POCKET_R
    if (inHole && !overHole) {
      const sp0 = Math.sqrt(vx * vx + vy * vy)
      entryOffset = sp0 > 1e-6 ? Math.abs(dpx * vy - dpy * vx) / sp0 : dp
      events.push({ t, kind: 'rim', intensity: sp0, offset: entryOffset })
    }
    overHole = inHole
    if (inHole && dp > 1e-6) {
      vx += (dpx / dp) * POCKET_PULL * DT
      vy += (dpy / dp) * POCKET_PULL * DT
    }

    // Surfaces under the ball's centre: felt slows it, a slope pushes it downhill.
    let onFelt = false
    let onSlope = false
    for (let i = 0; i < zones.length; i++) {
      const z = zones[i]
      if (x < z.minx || x > z.maxx || y < z.miny || y > z.maxy) continue
      if (z.kind === 'felt') onFelt = true
      else {
        onSlope = true
        vx += z.ax * DT
        vy += z.ay * DT
      }
    }

    // Rolling resistance.
    let speed = Math.sqrt(vx * vx + vy * vy)
    if (speed > 0) {
      const decel = ROLL_DECEL + LINEAR_DAMP * speed + (inHole ? POCKET_DRAG : 0) + (onFelt ? FELT_DECEL + FELT_DAMP * speed : 0)
      const next = speed - decel * DT
      const k = next > 0 ? next / speed : 0
      vx *= k
      vy *= k
      speed = next > 0 ? next : 0
    }
    if (speed > MAX_SPEED) {
      vx *= MAX_SPEED / speed
      vy *= MAX_SPEED / speed
    }

    x += vx * DT
    y += vy * DT

    // Resolve contacts, deepest first, a few passes for corners and wedges.
    let touched = false
    for (let iter = 0; iter < 4; iter++) {
      let best = -1
      let bd = 0
      let bnx = 0
      let bny = 0
      for (let i = 0; i < colliders.length; i++) {
        const c = contact(colliders[i], x, y, BALL_R)
        if (c && c.depth > bd) {
          bd = c.depth
          bnx = c.nx
          bny = c.ny
          best = i
        }
      }
      if (best < 0) break
      touched = true
      const col = colliders[best]
      x += bnx * bd
      y += bny * bd
      const vn = vx * bnx + vy * bny
      if (vn < 0) {
        const m = MATERIALS[col.mat]
        const tx = vx - vn * bnx
        const ty = vy - vn * bny
        vx = tx * m.grip - bnx * vn * m.restitution
        vy = ty * m.grip - bny * vn * m.restitution
        const impact = -vn
        if (impact > IMPACT_THRESHOLD) {
          const prev = lastHit.get(col.id)
          if (prev === undefined || t - prev > 0.06) {
            contacts++
            events.push({ t, kind: 'hit', mat: col.mat, intensity: impact, x, y })
          }
          lastHit.set(col.id, t)
        }
      }
    }

    const d = Math.hypot(px - x, py - y)
    if (d < closest) closest = d
    if (record && (step + 1) % FRAME_EVERY === 0) frames.push(x, y)

    // Capture: well inside the rim and slow enough to drop.
    const sp = Math.sqrt(vx * vx + vy * vy)
    if (d < POCKET_R - CAPTURE_INSET && sp < CAPTURE_SPEED) {
      outcome = 'sunk'
      events.push({ t, kind: 'capture', speed: sp })
      break
    }

    // Off the board: the centre has passed the edge of the playing surface.
    if (x < 0 || x > world.w || y < 0 || y > world.h) {
      outcome = 'fell'
      events.push({ t, kind: 'edge' })
      break
    }

    // On a slope the ball only comes to rest against something; a free ball momentarily slow there keeps rolling.
    if (sp < STOP_SPEED && d >= POCKET_R && (!onSlope || touched)) {
      vx = 0
      vy = 0
      break
    }
  }

  const endTime = Math.min(step + 1, maxSteps) * DT
  if (record && (frames[frames.length - 2] !== x || frames[frames.length - 1] !== y)) frames.push(x, y)
  return {
    outcome,
    frames: new Float32Array(frames),
    frameDt: DT * FRAME_EVERY,
    endTime,
    events,
    end: { x, y },
    endVelocity: { x: vx, y: vy },
    closest,
    contacts,
    entryOffset: outcome === 'sunk' ? entryOffset : null,
  }
}
