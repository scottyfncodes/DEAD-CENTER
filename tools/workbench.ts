/**
 * Generate the daily Workbench boards: one fresh board per day, the same for everyone, each one
 * verified by the solver (it sinks, it is not knife-edge, and it needs more than a straight putt).
 *
 *   npm run workbench -- 365            # write src/modes/workbench-boards.json (days 1..365)
 *   PARTS=4 PART=0 npm run workbench -- 365 --out part0.json   # one shard (for parallel runs)
 *
 * Deterministic: day N always tries the same seeds in the same order, so a rerun reproduces it.
 */
import { appendFileSync, writeFileSync } from 'node:fs'
import type { Block, Felt, LevelDef, Opening, Post, Bar, Slope, Shot } from '../src/levels/types'
import { runShot, search, structuralProblems, tolerance } from '../src/levels/validate'
import { BALL_R, POCKET_R } from '../src/physics/constants'

const args = process.argv.slice(2)
const days = Number(args.find((a) => /^\d+$/.test(a)) ?? 365)
const outIdx = args.indexOf('--out')
const OUT = outIdx >= 0 ? args[outIdx + 1] : new URL('../src/modes/workbench-boards.json', import.meta.url).pathname
const part = Number(process.env.PART ?? 0)
const parts = Number(process.env.PARTS ?? 1)

function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}
const round = (v: number, d = 2) => +v.toFixed(d)

/** One candidate board from a seed; `busy` (0..1) adds obstacles for the harder days. */
function candidate(seed: number, busy = 0): LevelDef {
  const r = rng(seed)
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)]
  const between = (a: number, b: number) => a + r() * (b - a)
  const w = pick([11, 12, 12, 13])
  const h = pick([18, 19, 20, 21, 22])
  const ball = { x: round(between(2, w - 2), 1), y: 2.6 }
  const pocket = { x: round(between(2, w - 2), 1), y: round(between(h * 0.58, h - 2.6), 1) }
  const blocks: Block[] = []
  const posts: Post[] = []
  const bars: Bar[] = []
  const felts: Felt[] = []
  const slopes: Slope[] = []
  const openings: Opening[] = []
  const lo = ball.y + 3
  const hi = pocket.y + 1.5
  const n = 2 + Math.floor(r() * 3) + Math.round(busy * 2)
  for (let i = 0; i < n; i++) {
    const kind = pick(['block', 'block', 'block', 'post', 'post', 'bar', 'felt', 'slope'])
    const x = round(between(1.5, w - 1.5), 1)
    const y = round(between(lo, hi), 1)
    if (kind === 'block') blocks.push({ x, y, w: round(between(2, 6.5), 1), h: 0.9, ...(r() < 0.35 ? { rot: pick([30, -30, 45, -45, 60, -60, 90]) } : {}) })
    else if (kind === 'post') posts.push({ x, y, r: round(between(0.45, 0.85), 2) })
    else if (kind === 'bar') {
      const a = between(0, Math.PI)
      const len = between(2.4, 5)
      bars.push({ x1: round(x - (Math.cos(a) * len) / 2), y1: round(y - (Math.sin(a) * len) / 2), x2: round(x + (Math.cos(a) * len) / 2), y2: round(y + (Math.sin(a) * len) / 2) })
    } else if ((kind === 'felt' && !felts.length) || (kind === 'slope' && !slopes.length)) {
      // Panels lie inside the board, clear of each other.
      const pw = round(kind === 'felt' ? between(3, 6) : between(4, w), 1)
      const ph = round(kind === 'felt' ? between(3, 6) : between(3.5, 7), 1)
      const px = round(Math.min(w - pw / 2, Math.max(pw / 2, x)), 2)
      const py = round(Math.min(h - ph / 2, Math.max(ph / 2, y)), 2)
      if (kind === 'felt') felts.push({ x: px, y: py, w: pw, h: ph })
      else slopes.push({ x: px, y: py, w: pw, h: ph, dir: pick([0, 90, 180, 270, 45, 135, 225, 315]) })
    }
  }
  if (r() < 0.25) {
    const side = pick(['left', 'right', 'far'] as const)
    const len = side === 'far' ? w : h
    const from = round(between(len * 0.35, len * 0.7), 1)
    openings.push({ side, from, to: round(Math.min(len, from + between(2.5, 6)), 1) })
  }
  return {
    id: `wb-${seed}`, number: 0, name: 'Workbench', collection: 'workbench', size: { w, h }, ball, pocket,
    ...(blocks.length ? { blocks } : {}), ...(posts.length ? { posts } : {}), ...(bars.length ? { bars } : {}),
    ...(felts.length ? { felts } : {}), ...(slopes.length ? { slopes } : {}), ...(openings.length ? { openings } : {}),
    difficulty: 3, solution: { angle: 0, power: 0 },
  }
}

/** Keep the pocket and the ball clear of panels' and objects' footprints beyond the structural check. */
function roomy(l: LevelDef): boolean {
  const clear = (px: number, py: number, m: number) =>
    (l.posts ?? []).every((p) => Math.hypot(p.x - px, p.y - py) > p.r + m) &&
    (l.blocks ?? []).every((b) => Math.hypot(b.x - px, b.y - py) > Math.max(b.w, b.h) / 2 + m * 0.6)
  const offPanel = (px: number, py: number) => [...(l.felts ?? []), ...(l.slopes ?? [])].every((z) => Math.abs(z.x - px) > z.w / 2 + 0.2 || Math.abs(z.y - py) > z.h / 2 + 0.2)
  return clear(l.pocket.x, l.pocket.y, POCKET_R + 0.9) && clear(l.ball.x, l.ball.y, BALL_R + 1.2) && offPanel(l.ball.x, l.ball.y)
}

/** Day 1 is Sunday 22 November 2026. */
export const EPOCH = Date.UTC(2026, 10, 22)
/** The week has a rhythm: gentle on Monday, demanding by Sunday. Easiest window (degrees) allowed per weekday. */
const BANDS: Record<number, [number, number]> = { 1: [5, 9], 2: [4, 8], 3: [3, 7], 4: [2.5, 6], 5: [2, 5], 6: [1.5, 4.5], 0: [1.1, 4] }
function bandFor(day: number): [number, number] {
  return BANDS[new Date(EPOCH + (day - 1) * 86400000).getUTCDay()]
}

/** Accept a board: solvable, not knife-edge, not trivial. Returns the stored solution or null. */
function judge(l: LevelDef, band: [number, number], loose = false): { shot: Shot; width: number } | null {
  if (structuralProblems(l).length || !roomy(l)) return null
  const runs = search(l, { angleStep: 0.75, powerStep: 0.05 })
  if (!runs.length) return null
  let best: { shot: Shot; width: number; score: number } | null = null
  for (const run of runs.slice(0, 12)) {
    let s = run.shot
    let t = tolerance(l, s)
    for (let k = 0; k < 2; k++) {
      const c = { angle: round((t.angleMin + t.angleMax) / 2, 2), power: round((t.powerMin + Math.min(t.powerMax, 1)) / 2, 3) }
      if (runShot(l, c).outcome !== 'sunk') break
      s = c
      t = tolerance(l, s)
    }
    const am = Math.min(s.angle - t.angleMin, t.angleMax - s.angle)
    const pm = Math.min(s.power - t.powerMin, t.powerMax - s.power)
    if (am < 0.35 || pm < 0.025) continue
    const width = t.angleMax - t.angleMin
    const score = width * Math.min(1, (t.powerMax - t.powerMin) / 0.2)
    if (!best || score > best.score) best = { shot: s, width, score }
  }
  if (!best) return null
  // The easiest way in must be a real shot: not a wide-open putt, and not a pinhole.
  // Loose: after many tries, accept the nearest board that is still a fair shot (1°..9°).
  if (loose ? best.width > 9 || best.width < 1 : best.width > band[1] || best.width < band[0]) return null
  const r = runShot(l, best.shot)
  const usesSomething = r.contacts > 0 || (l.felts?.length ?? 0) + (l.slopes?.length ?? 0) > 0
  return usesSomething ? best : null
}

const from = Number(process.env.FROM ?? 1)
const boards: LevelDef[] = []
for (let day = from; day <= days; day++) {
  if ((day - 1) % parts !== part) continue
  const band = bandFor(day)
  const busy = band[1] <= 5 ? 1 : band[1] <= 7 ? 0.5 : 0
  type Found = { l: LevelDef; ok: { shot: Shot; width: number }; seed: number; k: number }
  let chosen: Found | null = null
  let near: Found | null = null
  for (let k = 0; k < 250 && !chosen; k++) {
    const seed = day * 1000 + k
    const l = candidate(seed, busy)
    const ok = judge(l, band)
    if (ok) chosen = { l, ok, seed, k }
    else if (!near && k >= 60) {
      const loose = judge(l, band, true)
      if (loose && Math.abs(loose.width - (band[0] + band[1]) / 2) < (band[1] - band[0])) near = { l, ok: loose, seed, k }
    }
  }
  const pick = chosen ?? near
  if (!pick) {
    console.log(`day ${day}: no board found`)
    continue
  }
  const w = pick.ok.width
  const difficulty = w > 6 ? 2 : w > 3.5 ? 3 : w > 2 ? 4 : 5
  const board = { ...pick.l, id: `workbench-${String(day).padStart(3, '0')}`, number: day, name: `Workbench No. ${day}`, difficulty, solution: pick.ok.shot }
  boards.push(board)
  appendFileSync(OUT + '.jsonl', JSON.stringify(board) + '\n')
  console.log(`day ${day}: seed ${pick.seed} window ${w.toFixed(2)}° band ${band.join('-')} (try ${pick.k + 1}${chosen ? '' : ', nearest'})`)
}
writeFileSync(OUT, JSON.stringify(boards))
