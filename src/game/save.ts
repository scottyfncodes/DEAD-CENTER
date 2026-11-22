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
  /** Mastery: sunk on the first attempt of a run, at least once. */
  aced: boolean
  /** Mastery: sunk dead centre (its last line over the rim within DEAD_CENTER_OFFSET of the middle), at least once. */
  deadCenter: boolean
}

export interface DailyRecord {
  pieceId: string
  attempts: number
  solved: boolean
  firstAttempts: number | null
  completedOn: string | null
  practiceBest: number | null
  /** Sunk dead centre on this day's board. */
  deadCenter?: boolean
}

export interface SaveData {
  version: number
  pieces: Record<string, PieceRecord>
  settings: { sound: boolean; ghost: boolean }
  /** Last piece played, to reopen on return. */
  lastPiece: string | null
  /** The Workbench (daily) records, keyed by date. */
  daily: Record<string, DailyRecord>
  /** How many Collection pieces this player's game last knew, to greet new ones once. Null before it was recorded. */
  known: number | null
}

export function emptySave(): SaveData {
  return { version: SAVE_VERSION, pieces: {}, settings: { sound: true, ghost: true }, lastPiece: null, daily: {}, known: null }
}

export function emptyPiece(): PieceRecord {
  return { firstAttempts: null, firstCompletedOn: null, bestAttempts: null, completions: 0, launches: 0, runAttempts: 0, aced: false, deadCenter: false }
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
      // Saves from before mastery marks: a first-attempt solve already earned the ace.
      aced: p.aced === true || first === 1 || num(p.bestAttempts, null) === 1,
      deadCenter: p.deadCenter === true,
    }
  }
  const s = r.settings && typeof r.settings === 'object' ? (r.settings as Record<string, unknown>) : {}
  out.settings.sound = s.sound !== false
  out.settings.ghost = s.ghost !== false
  out.lastPiece = typeof r.lastPiece === 'string' ? r.lastPiece : null
  if (r.daily && typeof r.daily === 'object') {
    for (const [date, d] of Object.entries(r.daily as Record<string, Record<string, unknown>>)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !d || typeof d !== 'object' || typeof d.pieceId !== 'string') continue
      out.daily[date] = {
        pieceId: d.pieceId,
        attempts: num(d.attempts, 0) ?? 0,
        solved: d.solved === true,
        firstAttempts: num(d.firstAttempts, null) || null,
        completedOn: typeof d.completedOn === 'string' ? d.completedOn.slice(0, 10) : null,
        practiceBest: num(d.practiceBest, null) || null,
        deadCenter: d.deadCenter === true,
      }
    }
  }
  out.known = num(r.known, null)
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
  /** Mastery marks earned for the first time by this sink. */
  newAce: boolean
  newDeadCenter: boolean
  firstTime: boolean
  /** True when this run beat a previous best (never on the first completion). */
  newBest: boolean
  previousBest: number | null
}

/** Record a sunk ball: closes the run. */
export function recordCompletion(data: SaveData, id: string, today = localDate(), deadCenter = false): CompletionResult {
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
  const newAce = attempts === 1 && !p.aced
  const newDeadCenter = deadCenter && !p.deadCenter
  if (attempts === 1) p.aced = true
  if (deadCenter) p.deadCenter = true
  return { attempts, firstTime, newBest, previousBest, newAce, newDeadCenter }
}

/** Start a fresh practice run (Retry after a completion). */
export function resetRun(data: SaveData, id: string) {
  piece(data, id).runAttempts = 0
}

export function isSolved(data: SaveData, id: string): boolean {
  return (data.pieces[id]?.firstAttempts ?? null) !== null
}
