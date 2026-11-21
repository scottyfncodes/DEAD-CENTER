import { describe, expect, it } from 'vitest'
import * as save from '../src/game/save'
import { dailyPiece, recordDailyLaunch, recordDailySink } from '../src/modes/workbench'
import { LEVELS } from '../src/levels/collection'

class MemoryStorage {
  map = new Map<string, string>()
  getItem(k: string) {
    return this.map.get(k) ?? null
  }
  setItem(k: string, v: string) {
    this.map.set(k, v)
  }
}

describe('progress', () => {
  it('counts every release as an attempt and records the first completion', () => {
    const d = save.emptySave()
    expect(save.recordLaunch(d, 'the-elbow')).toBe(1)
    expect(save.recordLaunch(d, 'the-elbow')).toBe(2)
    expect(save.recordLaunch(d, 'the-elbow')).toBe(3)
    const r = save.recordCompletion(d, 'the-elbow', '2026-11-21')
    expect(r).toEqual({ attempts: 3, firstTime: true, newBest: false, previousBest: null })
    const p = d.pieces['the-elbow']
    expect(p.firstAttempts).toBe(3)
    expect(p.firstCompletedOn).toBe('2026-11-21')
    expect(p.bestAttempts).toBe(3)
    expect(p.launches).toBe(3)
    expect(p.runAttempts).toBe(0)
    expect(save.isSolved(d, 'the-elbow')).toBe(true)
  })

  it('keeps the first completion separate from later practice', () => {
    const d = save.emptySave()
    for (let i = 0; i < 4; i++) save.recordLaunch(d, 'x')
    save.recordCompletion(d, 'x')
    save.recordLaunch(d, 'x')
    save.recordLaunch(d, 'x')
    const better = save.recordCompletion(d, 'x')
    expect(better.newBest).toBe(true)
    expect(better.previousBest).toBe(4)
    save.recordLaunch(d, 'x')
    save.recordLaunch(d, 'x')
    save.recordLaunch(d, 'x')
    const worse = save.recordCompletion(d, 'x')
    expect(worse.newBest).toBe(false)
    const p = d.pieces.x
    expect(p.firstAttempts).toBe(4)
    expect(p.bestAttempts).toBe(2)
    expect(p.completions).toBe(3)
    expect(p.launches).toBe(9)
  })

  it('a retry after completion starts a fresh run; leaving mid-run keeps the count', () => {
    const d = save.emptySave()
    save.recordLaunch(d, 'y')
    save.recordLaunch(d, 'y')
    expect(d.pieces.y.runAttempts).toBe(2)
    save.resetRun(d, 'y')
    expect(d.pieces.y.runAttempts).toBe(0)
    expect(d.pieces.y.launches).toBe(2)
  })

  it('persists and reloads through storage', () => {
    const s = new MemoryStorage()
    const d = save.emptySave()
    save.recordLaunch(d, 'z')
    save.recordCompletion(d, 'z')
    d.settings.sound = false
    d.lastPiece = 'z'
    save.persist(s, d)
    const back = save.load(s)
    expect(back).toEqual(d)
  })

  it('survives corrupt, foreign or partial saves without throwing', () => {
    const s = new MemoryStorage()
    s.setItem(save.SAVE_KEY, '{not json')
    expect(save.load(s)).toEqual(save.emptySave())
    s.setItem(save.SAVE_KEY, JSON.stringify({ pieces: { 'ok-id': { firstAttempts: 3, launches: 'many' }, 'BAD ID!': {} }, settings: { ghost: false } }))
    const d = save.load(s)
    expect(d.version).toBe(save.SAVE_VERSION)
    expect(d.pieces['ok-id'].firstAttempts).toBe(3)
    expect(d.pieces['ok-id'].launches).toBe(0)
    expect(d.pieces['BAD ID!']).toBeUndefined()
    expect(d.settings).toEqual({ sound: true, ghost: false })
    expect(save.load(null)).toEqual(save.emptySave())
  })
})

describe('the Workbench (daily) foundation', () => {
  it('picks the same piece for everyone on a date, from the pool', () => {
    const a = dailyPiece('2026-12-01', LEVELS)
    expect(dailyPiece('2026-12-01', LEVELS)).toBe(a)
    const days = new Set(Array.from({ length: 30 }, (_, i) => dailyPiece(`2026-12-${String(i + 1).padStart(2, '0')}`, LEVELS).id))
    expect(days.size).toBeGreaterThan(4)
  })

  it('records attempts until the first solve, then only practice bests', () => {
    const d = save.emptySave()
    recordDailyLaunch(d, '2026-12-01', 'the-elbow')
    recordDailyLaunch(d, '2026-12-01', 'the-elbow')
    recordDailySink(d, '2026-12-01', 'the-elbow', 2, '2026-12-01')
    recordDailyLaunch(d, '2026-12-01', 'the-elbow')
    recordDailySink(d, '2026-12-01', 'the-elbow', 1, '2026-12-01')
    expect(d.daily['2026-12-01']).toMatchObject({ solved: true, firstAttempts: 2, practiceBest: 1, completedOn: '2026-12-01' })
  })
})
