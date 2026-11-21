import type { LevelDef } from '../levels/types'
import type { DailyRecord, SaveData } from '../game/save'

/**
 * The Workbench: a daily piece, the same for everyone on a given date.
 *
 * Not offered in the first release. The selection and the records are here so
 * the mode is a UI addition, not a rewrite: the game plays any LevelDef, and a
 * daily run records into `save.daily[date]` instead of `save.pieces`.
 */

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
