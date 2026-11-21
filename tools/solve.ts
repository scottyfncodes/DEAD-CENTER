/**
 * Developer utility: search a level for sinking shots and measure tolerance.
 *
 *   npm run solve                 # check every stored solution and its window
 *   npm run solve -- the-elbow    # search one level (coarse-to-fine) and report
 *   npm run solve -- the-elbow 37.2 0.61   # try one shot and describe it
 */
import { LEVELS, levelById } from '../src/levels/collection'
import { runShot, search, structuralProblems, tolerance } from '../src/levels/validate'

const [id, a, p] = process.argv.slice(2)

function describe(level = LEVELS[0], angle: number, power: number) {
  const r = runShot(level, { angle, power }, true)
  console.log(`${level.id} @ ${angle}°, ${power}: ${r.outcome} after ${r.endTime.toFixed(2)}s, ${r.contacts} contacts, closest ${r.closest.toFixed(2)}, end (${r.end.x.toFixed(2)}, ${r.end.y.toFixed(2)})`)
  for (const e of r.events) console.log('  ', e.t.toFixed(3), e.kind, 'mat' in e ? e.mat : '', 'intensity' in e ? e.intensity.toFixed(2) : '')
}

function report(level = LEVELS[0]) {
  const problems = structuralProblems(level)
  const t = tolerance(level, level.solution)
  const ok = runShot(level, level.solution).outcome === 'sunk'
  console.log(
    `${String(level.number).padStart(2)} ${level.id.padEnd(18)} ${ok ? 'SINKS' : 'FAILS'}  angle ${t.angleMin.toFixed(2)}..${t.angleMax.toFixed(2)} (${(t.angleMax - t.angleMin).toFixed(2)}°)  power ${t.powerMin.toFixed(3)}..${t.powerMax.toFixed(3)} (${((t.powerMax - t.powerMin) * 100).toFixed(1)}%)  nbhd ${(t.neighbourhood * 100).toFixed(0)}%${problems.length ? '  PROBLEMS: ' + problems.join('; ') : ''}`,
  )
}

if (!id) {
  for (const level of LEVELS) report(level)
} else {
  const level = levelById(id)
  if (!level) throw new Error(`no level ${id}`)
  if (a !== undefined) describe(level, Number(a), Number(p))
  else {
    const t0 = Date.now()
    const found = search(level, { angleStep: 0.25, powerStep: 0.02 })
    console.log(`${found.length} sinking runs in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
    for (const c of found.slice(0, 5)) {
      const t = tolerance(level, c.shot)
      console.log(`  angle ${c.shot.angle}  power ${c.shot.power}  run ${c.angleWidth.toFixed(2)}°  window ${(t.angleMax - t.angleMin).toFixed(2)}° × ${((t.powerMax - t.powerMin) * 100).toFixed(1)}%  nbhd ${(t.neighbourhood * 100).toFixed(0)}%`)
    }
    report(level)
  }
}
