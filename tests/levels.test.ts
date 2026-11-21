import { describe, expect, it } from 'vitest'
import { COLLECTIONS, LEVELS } from '../src/levels/collection'
import { runShot, structuralProblems, tolerance } from '../src/levels/validate'

describe('the Collection', () => {
  it('has twelve pieces in four collections of three, numbered in order', () => {
    expect(LEVELS).toHaveLength(12)
    LEVELS.forEach((l, i) => expect(l.number).toBe(i + 1))
    for (const c of COLLECTIONS) expect(LEVELS.filter((l) => l.collection === c.id)).toHaveLength(3)
    expect(new Set(LEVELS.map((l) => l.id)).size).toBe(12)
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
    const first = ['straightaway', 'a-little-further', 'easy-does-it'].map(width)
    const last = ['the-needle', 'just-enough', 'dead-center'].map(width)
    expect(Math.min(...first)).toBeGreaterThan(Math.max(...last))
  })
})
