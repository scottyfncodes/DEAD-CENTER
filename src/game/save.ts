/**
 * Saved progress. Versioned so later releases can migrate rather than wipe.
 *
 * The first completion of a piece is a permanent record (`first`). Later runs
 * are practice: they can improve `best` but never change `first`.
 */

export const SAVE_KEY = 'deadcenter:save'
export const SAVE_VERSION = 1

export interface PieceRecord {
  /** Attempts it took to sink the ball the very first time (null until solved). */
  firstAttempts: number | null
  /** ISO date (YYYY-MM-DD, local) of that first completion. */
  firstCompletedOn: string | null
  /** Fewest attempts in any completed run, the first included. */
  bestAttempts: number | null
  /** Number of completed runs. */
  completions: number
  /** Every launch ever made on this piece. */
  launches: number
  /** Attempts in the run in progress (survives a reload, so leaving never resets the count). */
  runAttempts: number
}

export interface DailyRecord {
  pieceId: string
  attempts: number
  solved: boolean
  firstAttempts: number | null
  completedOn: string | null
  practiceBest: number | null
}

export interface SaveData {
  version: number
  pieces: Record<string, PieceRecord>
  settings: { sound: boolean; ghost: boolean }
  /** Last piece played, to reopen on return. */
  lastPiece: string | null
  /** The Workbench (daily) records, keyed by date. Reserved for the daily mode. */
  daily: Record<string, DailyRecord>
}

export function emptySave(): SaveData {
  return { version: SAVE_VERSION, pieces: {}, settings: { sound: true, ghost: true }, lastPiece: null, daily: {} }
}

export function emptyPiece(): PieceRecord {
  return { firstAttempts: null, firstCompletedOn: null, bestAttempts: null, completions: 0, launches: 0, runAttempts: 0 }
}

const num = (v: unknown, fallback: number | null): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback)

/** Accept any stored shape and return a valid current-version save. Unknown fields are dropped; nothing valid is lost. */
export function migrate(raw: unknown): SaveData {
  const out = emptySave()
  if (!raw || typeof raw !== 'object') return out
  const r = raw as Record<string, unknown>
  // Version 1 is the first format; future versions add their steps here.
  const pieces = r.pieces && typeof r.pieces === 'object' ? (r.pieces as Record<string, Record<string, unknown>>) : {}
  for (const [id, p] of Object.entries(pieces)) {
    if (!p || typeof p !== 'object' || !/^[a-z0-9-]{1,48}$/.test(id)) continue
    const first = num(p.firstAttempts, null)
    out.pieces[id] = {
      firstAttempts: first && first > 0 ? first : null,
      firstCompletedOn: typeof p.firstCompletedOn === 'string' ? p.firstCompletedOn.slice(0, 10) : null,
      bestAttempts: num(p.bestAttempts, null) || null,
      completions: num(p.completions, 0) ?? 0,
      launches: num(p.launches, 0) ?? 0,
      runAttempts: num(p.runAttempts, 0) ?? 0,
    }
  }
  const s = r.settings && typeof r.settings === 'object' ? (r.settings as Record<string, unknown>) : {}
  out.settings.sound = s.sound !== false
  out.settings.ghost = s.ghost !== false
  out.lastPiece = typeof r.lastPiece === 'string' ? r.lastPiece : null
  if (r.daily && typeof r.daily === 'object') out.daily = r.daily as Record<string, DailyRecord>
  return out
}

export interface Storage {
  getItem(k: string): string | null
  setItem(k: string, v: string): void
}

export function load(storage: Storage | null): SaveData {
  if (!storage) return emptySave()
  try {
    const text = storage.getItem(SAVE_KEY)
    return text ? migrate(JSON.parse(text)) : emptySave()
  } catch {
    return emptySave()
  }
}

export function persist(storage: Storage | null, data: SaveData) {
  if (!storage) return
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(data))
  } catch {
    /* storage full or blocked: progress stays in memory for this visit */
  }
}

export function localDate(d = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export function piece(data: SaveData, id: string): PieceRecord {
  return (data.pieces[id] ??= emptyPiece())
}

/** Record a launch. Returns the attempt number of this launch within the current run. */
export function recordLaunch(data: SaveData, id: string): number {
  const p = piece(data, id)
  p.launches++
  p.runAttempts++
  return p.runAttempts
}

export interface CompletionResult {
  attempts: number
  firstTime: boolean
  /** True when this run beat a previous best (never on the first completion). */
  newBest: boolean
  previousBest: number | null
}

/** Record a sunk ball: closes the run. */
export function recordCompletion(data: SaveData, id: string, today = localDate()): CompletionResult {
  const p = piece(data, id)
  const attempts = Math.max(1, p.runAttempts)
  const firstTime = p.firstAttempts === null
  const previousBest = p.bestAttempts
  if (firstTime) {
    p.firstAttempts = attempts
    p.firstCompletedOn = today
  }
  const newBest = !firstTime && previousBest !== null && attempts < previousBest
  if (previousBest === null || attempts < previousBest) p.bestAttempts = attempts
  p.completions++
  p.runAttempts = 0
  return { attempts, firstTime, newBest, previousBest }
}

/** Start a fresh practice run (Retry after a completion). */
export function resetRun(data: SaveData, id: string) {
  piece(data, id).runAttempts = 0
}

export function isSolved(data: SaveData, id: string): boolean {
  return (data.pieces[id]?.firstAttempts ?? null) !== null
}
