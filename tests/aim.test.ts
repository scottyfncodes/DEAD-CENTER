import { describe, expect, it } from 'vitest'
import { AimTracker, maxPullFor, wrapDeg } from '../src/game/aim'

// A flat mapping for tests: board = screen with y flipped (screen y grows downward).
const sample = (sx: number, sy: number, t: number) => ({ sx, sy, bx: sx, by: -sy, t })

describe('drag-back aiming', () => {
  it('launches opposite the pull, with power from pull length', () => {
    const a = new AimTracker(sample(100, 100, 0), 200)
    // Pull straight down the screen: launch straight up the board.
    let s = a.update(sample(100, 150, 10))
    s = a.update(sample(100, 200, 20))
    expect(s.angle).toBeCloseTo(90, 6)
    expect(s.power).toBeCloseTo(0.5, 6)
    expect(s.armed).toBe(true)
  })

  it('a tiny pull is not armed (no accidental shots)', () => {
    const a = new AimTracker(sample(0, 0, 0), 200)
    expect(a.update(sample(3, 2, 16)).armed).toBe(false)
  })

  it('caps power at the full pull', () => {
    const a = new AimTracker(sample(0, 0, 0), 150)
    expect(a.update(sample(-400, 0, 16)).power).toBe(1)
  })

  it('slow movement turns the aim more finely than fast movement', () => {
    const run = (dt: number) => {
      const a = new AimTracker(sample(0, 0, 0), 200)
      a.update(sample(0, 100, 5))
      // Sweep the finger sideways by 10 px.
      let s = a.update(sample(1, 100, 5 + dt))
      for (let x = 2; x <= 10; x++) s = a.update(sample(x, 100, 5 + dt * x))
      return Math.abs(wrapDeg(s.angle - 90 + 180) - 180)
    }
    const fast = run(1)
    const slow = run(200)
    expect(fast).toBeGreaterThan(5)
    expect(slow).toBeLessThan(fast * 0.5)
    expect(slow).toBeGreaterThan(fast * 0.3)
  })

  it('scales full pull to the screen within sensible bounds', () => {
    expect(maxPullFor(390, 844)).toBeCloseTo(163.8)
    expect(maxPullFor(200, 200)).toBe(130)
    expect(maxPullFor(2560, 1440)).toBe(300)
  })
})
