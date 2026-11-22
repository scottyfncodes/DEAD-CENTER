/**
 * Find one "Dead Center" shot for every piece and store it as a test fixture, so the suite can prove
 * each piece's mastery mark is reachable without searching at test time.
 *
 *   npm run dead-center              # all pieces (slow: a full search per piece)
 *   npm run dead-center -- the-ring  # one piece
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { LEVELS } from '../src/levels/collection'
import { runShot, search } from '../src/levels/validate'
import { DEAD_CENTER_OFFSET } from '../src/physics/constants'
import type { LevelDef, Shot } from '../src/levels/types'

const FILE = process.env.DEAD_CENTER_FILE || new URL('../tests/fixtures/dead-center.json', import.meta.url).pathname
const only = process.argv.slice(2)
const out: Record<string, Shot> = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {}

/** The centre of the widest run of dead-center shots, over every sinking run the search finds. */
export function findDeadCenter(level: LevelDef): Shot | null {
  let best: { shot: Shot; width: number } | null = null
  for (const r of search(level, { angleStep: 0.25, powerStep: 0.02 })) {
    const a0 = r.shot.angle - r.angleWidth / 2 - 0.25
    const a1 = r.shot.angle + r.angleWidth / 2 + 0.25
    let start = -1
    for (let a = a0; a <= a1 + 1e-9; a += 0.01) {
      const res = runShot(level, { angle: a, power: r.shot.power })
      const ok = res.outcome === 'sunk' && res.entryOffset! <= DEAD_CENTER_OFFSET
      if (ok && start < 0) start = a
      if ((!ok || a + 0.01 > a1) && start >= 0) {
        const end = ok ? a : a - 0.01
        const width = end - start
        if (!best || width > best.width) best = { shot: { angle: +((start + end) / 2).toFixed(3), power: r.shot.power }, width }
        start = -1
      }
    }
  }
  return best?.shot ?? null
}

for (const level of LEVELS.filter((l) => !only.length || only.includes(l.id))) {
  const shot = findDeadCenter(level)
  const r = shot && runShot(level, shot)
  console.log(level.id.padEnd(18), shot ? `${shot.angle}° ${shot.power}  offset ${r!.entryOffset!.toFixed(3)}` : 'NONE FOUND')
  if (shot) out[level.id] = shot
}
writeFileSync(FILE, JSON.stringify(Object.fromEntries(LEVELS.filter((l) => out[l.id]).map((l) => [l.id, out[l.id]])), null, 1) + '\n')
