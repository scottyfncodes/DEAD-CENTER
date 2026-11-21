import { MIN_POWER } from '../physics/constants'

/**
 * Drag-back aiming, independent of the DOM and renderer so it can be tested.
 *
 * The player presses anywhere and pulls away from the intended direction.
 * Power comes from pull length on screen; direction comes from the pull
 * mapped onto the board, so the tilted camera never skews the aim.
 *
 * Steady hand: once the pull is established, slow finger movement turns the
 * aim more finely than fast movement (down to 35%), so a fraction of a degree
 * is reachable on a phone without the aim ever jumping.
 */

export interface AimSample {
  /** Screen position, CSS px. */
  sx: number
  sy: number
  /** The same point projected onto the board. */
  bx: number
  by: number
  /** Timestamp, ms. */
  t: number
}

export interface AimState {
  angle: number
  power: number
  armed: boolean
}

const ESTABLISH_PX = 34
const DEG = 180 / Math.PI

export function wrapDeg(a: number): number {
  return ((a % 360) + 360) % 360
}

function deltaDeg(a: number, b: number): number {
  let d = (b - a) % 360
  if (d > 180) d -= 360
  if (d < -180) d += 360
  return d
}

export class AimTracker {
  private origin: AimSample
  private last: AimSample
  private rawPrev: number | null = null
  angle = 90
  power = 0
  armed = false

  constructor(origin: AimSample, private maxPullPx: number) {
    this.origin = origin
    this.last = origin
  }

  update(s: AimSample): AimState {
    const dxs = s.sx - this.origin.sx
    const dys = s.sy - this.origin.sy
    const pullPx = Math.hypot(dxs, dys)
    this.power = Math.min(1, pullPx / this.maxPullPx)
    const lx = this.origin.bx - s.bx
    const ly = this.origin.by - s.by
    const raw = wrapDeg(Math.atan2(ly, lx) * DEG)
    if (pullPx < ESTABLISH_PX || this.rawPrev === null) {
      // Establishing: the aim follows the finger directly.
      this.angle = raw
    } else {
      const dt = Math.max(1, s.t - this.last.t)
      const speed = Math.hypot(s.sx - this.last.sx, s.sy - this.last.sy) / dt // px per ms
      const k = Math.min(1, Math.max(0, (speed - 0.04) / 0.5))
      const gain = 0.35 + 0.65 * k * k * (3 - 2 * k)
      this.angle = wrapDeg(this.angle + deltaDeg(this.rawPrev, raw) * gain)
    }
    this.rawPrev = raw
    this.last = s
    this.armed = this.power >= MIN_POWER
    return { angle: this.angle, power: this.power, armed: this.armed }
  }
}

/** Pull length (px) that gives full power, scaled to the screen. */
export function maxPullFor(width: number, height: number): number {
  return Math.max(130, Math.min(300, Math.min(width, height) * 0.42))
}
