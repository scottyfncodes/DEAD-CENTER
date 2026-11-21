import { describe, expect, it } from 'vitest'
import { BALL_R, CAPTURE_SPEED, DT, MAX_SPEED, POCKET_R } from '../src/physics/constants'
import { launchVelocity, simulate } from '../src/physics/sim'
import { buildWorld, contact } from '../src/physics/world'
import type { LevelDef } from '../src/levels/types'

const base: LevelDef = {
  id: 'test',
  number: 0,
  name: 'Test',
  collection: 'basics',
  size: { w: 10, h: 20 },
  ball: { x: 5, y: 3 },
  pocket: { x: 5, y: 17 },
  difficulty: 1,
  solution: { angle: 90, power: 0.3 },
}
const level = (over: Partial<LevelDef>): LevelDef => ({ ...base, ...over })

describe('simulation', () => {
  it('is deterministic: identical inputs give bit-identical results', () => {
    const l = level({ blocks: [{ x: 4, y: 10, w: 5, h: 0.9, rot: 17 }], posts: [{ x: 7, y: 7, r: 0.7 }] })
    const w = buildWorld(l)
    for (const shot of [
      { angle: 71.3, power: 0.8 },
      { angle: 12.25, power: 1 },
      { angle: 200, power: 0.55 },
    ]) {
      const a = simulate(w, l.ball, shot)
      const b = simulate(buildWorld(l), l.ball, shot)
      expect(Array.from(a.frames)).toEqual(Array.from(b.frames))
      expect(a.events).toEqual(b.events)
      expect(a.outcome).toBe(b.outcome)
    }
  })

  it('maps power to launch speed (sqrt curve, capped)', () => {
    expect(Math.hypot(...Object.values(launchVelocity({ angle: 33, power: 1 })))).toBeCloseTo(MAX_SPEED, 9)
    expect(Math.hypot(...Object.values(launchVelocity({ angle: 33, power: 0.25 })))).toBeCloseTo(MAX_SPEED / 2, 9)
    expect(launchVelocity({ angle: 90, power: 2 }).vy).toBeCloseTo(MAX_SPEED, 9)
  })

  it('rolling resistance brings the ball to rest monotonically, without reversing', () => {
    const l = level({ pocket: { x: 8.5, y: 18.5 } })
    const r = simulate(buildWorld(l), l.ball, { angle: 90, power: 0.15 })
    expect(r.outcome).toBe('rest')
    let prev = 0
    for (let i = 1; i < r.frames.length / 2; i++) {
      const dy = r.frames[i * 2 + 1] - r.frames[(i - 1) * 2 + 1]
      expect(dy).toBeGreaterThanOrEqual(-1e-9)
      if (i > 2) expect(dy).toBeLessThanOrEqual(prev + 1e-9)
      prev = dy
    }
    // A softer shot stops shorter.
    const soft = simulate(buildWorld(l), l.ball, { angle: 90, power: 0.08 })
    expect(soft.end.y).toBeLessThan(r.end.y)
  })

  it('bounces off a wall with restitution and does not tunnel through a thin block', () => {
    const l = level({ blocks: [{ x: 5, y: 9, w: 8, h: 0.3 }], pocket: { x: 8.5, y: 17 } })
    const r = simulate(buildWorld(l), l.ball, { angle: 90, power: 1 })
    const ys = Array.from(r.frames).filter((_, i) => i % 2 === 1)
    expect(Math.max(...ys)).toBeLessThan(9 - 0.15 - BALL_R + 0.02)
    const hit = r.events.find((e) => e.kind === 'hit')
    expect(hit && hit.kind === 'hit' && hit.mat).toBe('ceramic')
    expect(r.end.y).toBeLessThan(9)
  })

  it('reflects off a circular post along the contact normal', () => {
    // Ball travelling straight up, hitting a post offset to its left, deflects right.
    const l = level({ posts: [{ x: 4.5, y: 10, r: 0.8 }], pocket: { x: 8.5, y: 18.5 } })
    const r = simulate(buildWorld(l), l.ball, { angle: 90, power: 0.6 })
    const hit = r.events.find((e) => e.kind === 'hit')!
    expect(hit.kind === 'hit' && hit.mat).toBe('brass')
    // Shortly after the contact the ball is moving right and back down the board.
    const i = Math.round((hit.t + 0.1) / r.frameDt)
    expect(r.frames[i * 2]).toBeGreaterThan(hit.kind === 'hit' ? hit.x + 0.3 : 0)
    expect(r.frames[i * 2 + 1]).toBeLessThan(hit.kind === 'hit' ? hit.y : 0)
  })

  it('handles corners and wedges stably (no escape, no explosion of speed)', () => {
    const l = level({
      blocks: [
        { x: 3, y: 12, w: 6, h: 0.9, rot: 45 },
        { x: 7, y: 12, w: 6, h: 0.9, rot: -45 },
      ],
      pocket: { x: 1.5, y: 18.5 },
    })
    for (let a = 60; a <= 120; a += 3) {
      const r = simulate(buildWorld(l), l.ball, { angle: a, power: 1 })
      for (let i = 0; i < r.frames.length; i += 2) {
        expect(r.frames[i]).toBeGreaterThan(-0.01)
        expect(r.frames[i]).toBeLessThan(10.01)
      }
      for (let i = 2; i < r.frames.length; i += 2) {
        const step = Math.hypot(r.frames[i] - r.frames[i - 2], r.frames[i + 1] - r.frames[i - 1])
        expect(step).toBeLessThan(MAX_SPEED * DT * 2 + 0.6)
      }
    }
  })

  it('captures a gentle ball that rolls over the pocket', () => {
    const l = level({})
    const r = simulate(buildWorld(l), l.ball, { angle: 90, power: 0.24 })
    expect(r.outcome).toBe('sunk')
    const cap = r.events.find((e) => e.kind === 'capture')!
    expect(cap.kind === 'capture' && cap.speed).toBeLessThan(CAPTURE_SPEED)
    expect(Math.hypot(r.end.x - 5, r.end.y - 17)).toBeLessThan(POCKET_R)
  })

  it('lets a fast ball skim over the pocket, and slows it', () => {
    const l = level({ openings: [{ side: 'far', from: 0, to: 10 }] })
    const r = simulate(buildWorld(l), l.ball, { angle: 90, power: 1 })
    expect(r.outcome).toBe('fell')
    expect(r.events.some((e) => e.kind === 'rim')).toBe(true)
  })

  it('never refuses a ball that comes to rest over the hole', () => {
    // Sweep powers along the centre line: any shot whose ball stops within the rim must be sunk.
    const l = level({})
    for (let p = 0.12; p <= 0.4; p += 0.004) {
      const r = simulate(buildWorld(l), l.ball, { angle: 90, power: p })
      const d = Math.hypot(r.end.x - l.pocket.x, r.end.y - l.pocket.y)
      if (d < POCKET_R) expect(r.outcome).toBe('sunk')
    }
  })

  it('detects leaving the board through an opening', () => {
    const l = level({ openings: [{ side: 'left', from: 0, to: 20 }] })
    const r = simulate(buildWorld(l), l.ball, { angle: 180, power: 0.5 })
    expect(r.outcome).toBe('fell')
    expect(r.end.x).toBeLessThan(0)
    expect(r.events.at(-1)?.kind).toBe('edge')
  })

  it('rails without openings keep the ball on the board', () => {
    const l = level({})
    for (let a = 0; a < 360; a += 7.5) {
      const r = simulate(buildWorld(l), l.ball, { angle: a, power: 1 })
      expect(r.outcome).not.toBe('fell')
    }
  })

  it('contact() reports penetration for every collider kind', () => {
    const w = buildWorld(level({ blocks: [{ x: 5, y: 10, w: 2, h: 2 }], posts: [{ x: 2, y: 2, r: 0.5 }], bars: [{ x1: 7, y1: 15, x2: 9, y2: 15 }] }))
    const block = w.colliders.find((c) => c.kind === 'box' && c.mat === 'ceramic')!
    const post = w.colliders.find((c) => c.kind === 'circle')!
    const bar = w.colliders.find((c) => c.kind === 'capsule')!
    expect(contact(block, 6.4, 10)?.nx).toBeCloseTo(1)
    expect(contact(block, 8, 10)).toBeNull()
    expect(contact(post, 2, 2.9)?.ny).toBeCloseTo(1)
    expect(contact(bar, 8, 14.5)?.ny).toBeCloseTo(-1)
    // Corner of a box behaves as a point.
    const c = contact(block, 6.3, 11.3)!
    expect(c.nx).toBeCloseTo(Math.SQRT1_2, 5)
    expect(c.ny).toBeCloseTo(Math.SQRT1_2, 5)
  })
})
