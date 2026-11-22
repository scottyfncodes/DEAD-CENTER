import { describe, expect, it } from 'vitest'
import boards from '../src/modes/workbench-boards.json'
import { boardFor, dayLabel, dayNumber, streak } from '../src/modes/workbench'
import { runShot, structuralProblems, tolerance } from '../src/levels/validate'
import { emptySave } from '../src/game/save'
import { parseShot } from '../src/game/share'
import type { LevelDef } from '../src/levels/types'

const stock = boards as unknown as LevelDef[]

describe('the Workbench', () => {
  it('has a year of boards, numbered from day 1', () => {
    expect(stock.length).toBeGreaterThanOrEqual(365)
    stock.forEach((b, i) => expect(b.number).toBe(i + 1))
  })

  it('every board is sound and its stored shot sinks', () => {
    for (const b of stock) {
      expect(structuralProblems(b), b.id).toEqual([])
      expect(runShot(b, b.solution).outcome, b.id).toBe('sunk')
    }
  })

  it('stored shots are not knife-edge (every 7th board, so each weekday is covered)', () => {
    for (const b of stock.filter((_, i) => i % 7 === 3 || i % 7 === 6)) {
      const t = tolerance(b, b.solution)
      expect(b.solution.angle - t.angleMin, b.id).toBeGreaterThanOrEqual(0.3)
      expect(t.angleMax - b.solution.angle, b.id).toBeGreaterThanOrEqual(0.3)
      expect(b.solution.power - t.powerMin, b.id).toBeGreaterThanOrEqual(0.02)
      expect(t.powerMax - b.solution.power, b.id).toBeGreaterThanOrEqual(0.02)
    }
  })

  it('numbers days from Sunday 22 November 2026 and cycles once the stock runs out', () => {
    expect(dayNumber('2026-11-22')).toBe(1)
    expect(dayNumber('2026-11-23')).toBe(2)
    expect(dayNumber('2027-01-01')).toBe(41)
    expect(dayNumber('2020-01-01')).toBe(1)
    expect(dayLabel('2026-11-22')).toBe('Sun 22 Nov')
    const later = boardFor('2026-11-22', stock.slice(0, 3))
    expect(later.name).toBe('Workbench No. 1')
    const wrapped = boardFor('2026-11-25', stock.slice(0, 3))
    expect(wrapped.name).toBe('Workbench No. 4')
    expect(wrapped.pocket).toEqual(stock[0].pocket)
    expect(wrapped.id).toBe('workbench-2026-11-25')
  })

  it('counts a streak of days sunk, ending today or yesterday', () => {
    const s = emptySave()
    const day = (d: string, solved: boolean) => (s.daily[d] = { pieceId: 'x', attempts: 1, solved, firstAttempts: solved ? 1 : null, completedOn: solved ? d : null, practiceBest: null })
    expect(streak(s, '2026-11-25')).toBe(0)
    day('2026-11-22', true)
    day('2026-11-23', true)
    day('2026-11-24', true)
    expect(streak(s, '2026-11-25')).toBe(3)
    day('2026-11-25', true)
    expect(streak(s, '2026-11-25')).toBe(4)
    day('2026-11-23', false)
    expect(streak(s, '2026-11-25')).toBe(2)
  })
})

describe('shared shots', () => {
  it('reads "angle,power" from a link and refuses anything else', () => {
    expect(parseShot('46,0.7')).toEqual({ angle: 46, power: 0.7 })
    expect(parseShot('116.15,0.848')).toEqual({ angle: 116.15, power: 0.848 })
    expect(parseShot('-10,1')).toEqual({ angle: 350, power: 1 })
    for (const bad of [null, '', '46', '46,1.2', '46,0.01', 'abc,0.5', '46,0.5;alert(1)', '9999,0.5']) expect(parseShot(bad)).toBeNull()
  })
})
