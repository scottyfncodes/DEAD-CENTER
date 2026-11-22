import { describe, expect, it } from 'vitest'
import { COLLECTIONS, LEVELS } from '../src/levels/collection'
import { runShot, structuralProblems, tolerance } from '../src/levels/validate'
import { DEAD_CENTER_OFFSET } from '../src/physics/constants'
import deadCenter from './fixtures/dead-center.json'

describe('the Collection', () => {
  it('has thirty-six pieces in twelve collections of three, numbered in order', () => {
    expect(LEVELS).toHaveLength(36)
    expect(COLLECTIONS).toHaveLength(12)
    LEVELS.forEach((l, i) => expect(l.number).toBe(i + 1))
    for (const c of COLLECTIONS) expect(LEVELS.filter((l) => l.collection === c.id)).toHaveLength(3)
    // Collections run in order: each piece belongs to the collection after or equal to the previous one's.
    const order = COLLECTIONS.map((c) => c.id)
    LEVELS.forEach((l, i) => i && expect(order.indexOf(l.collection)).toBeGreaterThanOrEqual(order.indexOf(LEVELS[i - 1].collection)))
    expect(new Set(LEVELS.map((l) => l.id)).size).toBe(36)
  })

  it('keeps the original twelve pieces where saves expect them', () => {
    const original = ['straightaway', 'a-little-further', 'easy-does-it', 'the-elbow', 'around-the-bend', 'second-thoughts', 'three-pins', 'the-deflection', 'the-long-way', 'the-needle', 'just-enough', 'dead-center']
    expect(LEVELS.slice(0, 12).map((l) => l.id)).toEqual(original)
  })

  it('The Keystone closes The Keyhole\'s route', () => {
    const keyhole = LEVELS.find((l) => l.id === 'the-keyhole')!
    const keystone = LEVELS.find((l) => l.id === 'the-keystone')!
    expect(runShot(keystone, keyhole.solution).outcome).not.toBe('sunk')
  })

  for (const level of LEVELS) {
    describe(`No. ${level.number} ${level.name}`, () => {
      it('is structurally sound (ball and pocket clear, on the board)', () => {
        expect(structuralProblems(level)).toEqual([])
      })

      it('the stored solution sinks the ball in one launch', () => {
        const r = runShot(level, level.solution, true)
        expect(r.outcome).toBe('sunk')
      })

      it('can be mastered: a stored shot drops it dead centre', () => {
        const shot = (deadCenter as Record<string, { angle: number; power: number }>)[level.id]
        expect(shot, 'run npm run dead-center -- ' + level.id).toBeTruthy()
        const r = runShot(level, shot)
        expect(r.outcome).toBe('sunk')
        expect(r.entryOffset!).toBeLessThanOrEqual(DEAD_CENTER_OFFSET)
      })

      it('the solution is not knife-edge: it survives small input errors', () => {
        const t = tolerance(level, level.solution)
        // At least ±0.3° and ±2% power around the stored solution.
        expect(level.solution.angle - t.angleMin).toBeGreaterThanOrEqual(0.3)
        expect(t.angleMax - level.solution.angle).toBeGreaterThanOrEqual(0.3)
        expect(level.solution.power - t.powerMin).toBeGreaterThanOrEqual(0.02)
        expect(t.powerMax - level.solution.power).toBeGreaterThanOrEqual(0.02)
      })
    })
  }

  it('gets harder: the last collection is tighter than the first', () => {
    const width = (id: string) => {
      const l = LEVELS.find((x) => x.id === id)!
      const t = tolerance(l, l.solution)
      return t.angleMax - t.angleMin
    }
    const ids = (c: string) => LEVELS.filter((l) => l.collection === c).map((l) => l.id)
    const first = ids(COLLECTIONS[0].id).map(width)
    const last = ids(COLLECTIONS[COLLECTIONS.length - 1].id).map(width)
    expect(Math.min(...first)).toBeGreaterThan(Math.max(...last))
  })
})
