/**
 * End-to-end play test in a real browser (Chromium via Playwright).
 *
 *   node e2e/play.mjs [url]          (default http://localhost:4173)
 *
 * For every piece it performs the verified solution as a real drag (mouse on
 * desktop, touch events on an emulated iPhone), waits for the ball to drop,
 * then checks saved progress survives a reload, the Collection lists every
 * piece as solved, the layout has no horizontal overflow, and the console is
 * free of errors. It reads state through the ?test hooks but never moves the
 * ball itself: every shot goes through the same pointer handling a player uses.
 */
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'

const require = createRequire(import.meta.url)
const { chromium, devices } = require('playwright')

const base = (process.argv[2] || 'http://localhost:4173').replace(/\/$/, '')
const out = new URL('./out/', import.meta.url).pathname
mkdirSync(out, { recursive: true })

const profiles = [
  { name: 'desktop', options: { viewport: { width: 1280, height: 800 } }, touch: false },
  { name: 'iphone-13', options: { ...devices['iPhone 13'] }, touch: true },
  { name: 'iphone-se', options: { ...devices['iPhone SE'] }, touch: true },
  { name: 'iphone-13-landscape', options: { ...devices['iPhone 13 landscape'] }, touch: true, subset: ['straightaway', 'the-elbow', 'dead-center'] },
]

let failures = 0
const fail = (msg) => {
  failures++
  console.log(`  FAIL ${msg}`)
}

async function drag(page, cdp, touch, from, to) {
  const steps = 24
  if (!touch) {
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    for (let i = 1; i <= steps; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps)
    await page.mouse.up()
    return
  }
  const pt = (x, y) => [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }]
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(from.x, from.y) })
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps) })
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

async function waitPhase(page, phases, timeout = 30000) {
  await page.waitForFunction((p) => p.includes(window.__deadCenter.phase()), phases, { timeout, polling: 50 })
  return page.evaluate(() => window.__deadCenter.phase())
}

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const only = process.env.PROFILE
for (const profile of profiles.filter((p) => !only || p.name === only)) {
  console.log(`\n${profile.name}`)
  const ctx = await browser.newContext(profile.options)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  const cdp = await ctx.newCDPSession(page)
  await page.goto(`${base}/?test=1`)
  await page.waitForFunction(() => window.__deadCenter && window.__deadCenter.phase() === 'ready', null, { timeout: 20000 })
  // Software rendering here runs at a few frames per second; play shots back faster (physics is unaffected).
  await page.evaluate(() => window.__deadCenter.speed(6))

  const tracker = await page.evaluate(() => [...document.querySelectorAll('script[src*="haveanapp-pulse-collect"]')].map((s) => s.getAttribute('data-app')))
  if (tracker.length !== 1 || tracker[0] !== 'dead-center') fail(`Pulse snippet: ${JSON.stringify(tracker)}`)

  const ids = profile.subset ?? (await page.evaluate(() => window.__deadCenter.levels()))
  for (const id of ids) {
    await page.evaluate((i) => window.__deadCenter.goto(i), id)
    await page.waitForTimeout(150)
    const plan = await page.evaluate(() => {
      const d = window.__deadCenter
      return d.dragFor(d.solution())
    })
    // A tap that barely moves must not count as a shot.
    await drag(page, cdp, profile.touch, plan.from, { x: plan.from.x + 2, y: plan.from.y + 1 })
    const afterTap = await page.evaluate((i) => window.__deadCenter.save().pieces[i]?.launches ?? 0, id)
    if (afterTap !== 0) fail(`${id}: a 2px tap launched the ball`)

    // A two-finger pinch on the board must not count as a shot either.
    if (profile.touch && id === ids[0]) {
      const c = plan.from
      const tp = (d) => [{ x: c.x - d, y: c.y, id: 1 }, { x: c.x + d, y: c.y, id: 2 }]
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(20) })
      for (let d = 24; d <= 120; d += 4) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(d) })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await page.waitForTimeout(200)
      const afterPinch = await page.evaluate((i) => window.__deadCenter.save().pieces[i]?.launches ?? 0, id)
      if (afterPinch !== 0) fail(`${id}: a two-finger pinch launched the ball`)
    }

    await drag(page, cdp, profile.touch, plan.from, plan.to)
    const phase = await waitPhase(page, ['sunk', 'settled', 'falling'])
    const rec = await page.evaluate((i) => window.__deadCenter.save().pieces[i], id)
    if (phase === 'sunk' && rec.firstAttempts === 1) console.log(`  ok   ${id}`)
    else fail(`${id}: phase ${phase}, record ${JSON.stringify(rec)}`)
    if (id === ids[0]) await page.screenshot({ path: `${out}${profile.name}-${id}-sunk.png` })
  }

  // Layout: no horizontal overflow, controls are reachable.
  const layout = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.top button, .bottom button')].map((b) => b.getBoundingClientRect())
    return {
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      smallTargets: btns.filter((r) => r.width < 44 || r.height < 44).length,
      offscreen: btns.filter((r) => r.right > window.innerWidth + 0.5 || r.left < -0.5 || r.bottom > window.innerHeight + 0.5).length,
    }
  })
  if (layout.overflow) fail('horizontal overflow')
  if (layout.smallTargets) fail(`${layout.smallTargets} touch targets under 44px`)
  if (layout.offscreen) fail(`${layout.offscreen} controls off screen`)

  // Persistence across a reload, and the Collection reflects it.
  await page.reload()
  await page.waitForFunction(() => window.__deadCenter && window.__deadCenter.phase() === 'ready', null, { timeout: 20000 })
  await page.evaluate(() => window.__deadCenter.speed(6))
  const solved = await page.evaluate(() => Object.values(window.__deadCenter.save().pieces).filter((p) => p.firstAttempts !== null).length)
  if (solved !== ids.length) fail(`after reload ${solved} solved, expected ${ids.length}`)
  await page.click('#btn-collection')
  await page.waitForSelector('#collection:not([hidden])')
  const shown = await page.$$eval('.piece.is-solved', (els) => els.length)
  if (shown !== ids.length) fail(`collection shows ${shown} solved`)
  await page.screenshot({ path: `${out}${profile.name}-collection.png`, fullPage: false })
  await page.click('#btn-close')

  // A miss: the ghost appears, the attempt counter advances, and the ball comes back.
  await page.evaluate(() => window.__deadCenter.goto('the-elbow'))
  const miss = await page.evaluate(() => window.__deadCenter.dragFor({ angle: 90, power: 0.25 }))
  await drag(page, cdp, profile.touch, miss.from, miss.to)
  await waitPhase(page, ['settled', 'falling'])
  await page.screenshot({ path: `${out}${profile.name}-miss.png` })
  await waitPhase(page, ['ready'], 8000)
  const attemptText = await page.textContent('#attempts')
  if (!/Attempt 2/.test(attemptText)) fail(`attempt counter after a miss: ${attemptText}`)

  if (errors.length) fail(`console errors: ${errors.join(' | ')}`)
  await ctx.close()
}
await browser.close()
console.log(failures ? `\n${failures} failure(s)` : '\nall passed')
process.exit(failures ? 1 : 0)
