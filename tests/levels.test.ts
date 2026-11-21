import { describe, expect, it } from 'vitest'
import { COLLECTIONS, LEVELS } from '../src/levels/collection'
import { runShot, structuralProblems, tolerance } from '../src/levels/validate'

describe('the Collection', () => {
  it('has thirty pieces in ten collections of three, numbered in order', () => {
    expect(LEVELS).toHaveLength(30)
    expect(COLLECTIONS).toHaveLength(10)
    LEVELS.forEach((l, i) => expect(l.number).toBe(i + 1))
    for (const c of COLLECTIONS) expect(LEVELS.filter((l) => l.collection === c.id)).toHaveLength(3)
    // Collections run in order: each piece belongs to the collection after or equal to the previous one's.
    const order = COLLECTIONS.map((c) => c.id)
    LEVELS.forEach((l, i) => i && expect(order.indexOf(l.collection)).toBeGreaterThanOrEqual(order.indexOf(LEVELS[i - 1].collection)))
    expect(new Set(LEVELS.map((l) => l.id)).size).toBe(30)
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
