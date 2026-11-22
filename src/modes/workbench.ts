import type { LevelDef } from '../levels/types'
import type { DailyRecord, SaveData } from '../game/save'

/**
 * The Workbench: a fresh board every day, the same for everyone on a given date.
 *
 * Boards are generated ahead of time by `npm run workbench` and verified by the solver (they sink,
 * they are not knife-edge, and the week builds from a gentle Monday to a demanding Sunday). They load
 * on demand, so the Collection never waits for them. A day's first run is its score
 * (`save.daily[date]`); later runs are practice.
 */

/** Workbench No. 1 is Sunday 22 November 2026. */
export const EPOCH = '2026-11-22'

function utc(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

/** The board number for a calendar date (YYYY-MM-DD, the player's local date). Never below 1. */
export function dayNumber(date: string): number {
  return Math.max(1, Math.round((utc(date) - utc(EPOCH)) / 86400000) + 1)
}

/** A short, local label for a date: "Sun 22 Nov". */
export function dayLabel(date: string): string {
  const d = new Date(utc(date))
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
}

let boards: Promise<LevelDef[]> | null = null
/** The generated boards (loaded once, on first use). */
export function loadBoards(): Promise<LevelDef[]> {
  boards ??= import('./workbench-boards.json').then((m) => (m.default as unknown as LevelDef[]))
  return boards
}

/** The board for a date: numbered from the epoch, cycling once the stock runs out. */
export function boardFor(date: string, stock: readonly LevelDef[]): LevelDef {
  if (!stock.length) throw new Error('no Workbench boards')
  const n = dayNumber(date)
  const base = stock[(n - 1) % stock.length]
  return { ...base, id: `workbench-${date}`, number: n, name: `Workbench No. ${n}`, collection: 'workbench' }
}

/** Consecutive days, ending today or yesterday, on which the day's board was sunk. */
export function streak(save: SaveData, today: string): number {
  let n = 0
  let t = utc(today)
  const key = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  if (!save.daily[key(t)]?.solved) t -= 86400000
  while (save.daily[key(t)]?.solved) {
    n++
    t -= 86400000
  }
  return n
}

/** FNV-1a: a stable hash, the same in every browser. */
function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

/** The piece for a calendar date (YYYY-MM-DD) from a pool of verified pieces. */
export function dailyPiece(date: string, pool: readonly LevelDef[]): LevelDef {
  if (!pool.length) throw new Error('empty pool')
  return pool[hash(`dead-center:${date}`) % pool.length]
}

export function dailyRecord(save: SaveData, date: string, pieceId: string): DailyRecord {
  return (save.daily[date] ??= { pieceId, attempts: 0, solved: false, firstAttempts: null, completedOn: null, practiceBest: null })
}

export function recordDailyLaunch(save: SaveData, date: string, pieceId: string): number {
  const r = dailyRecord(save, date, pieceId)
  r.attempts++
  return r.attempts
}

/** Sinks before the first completion close the daily; later ones only improve the practice best. */
export function recordDailySink(save: SaveData, date: string, pieceId: string, runAttempts: number, today: string) {
  const r = dailyRecord(save, date, pieceId)
  if (!r.solved) {
    r.solved = true
    r.firstAttempts = r.attempts
    r.completedOn = today
  } else if (r.practiceBest === null || runAttempts < r.practiceBest) {
    r.practiceBest = runAttempts
  }
}
