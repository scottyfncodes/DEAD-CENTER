import '@fontsource-variable/fraunces/opsz.css'
import '@fontsource-variable/fraunces/opsz-italic.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import './ui/styles.css'
import { Game } from './game/game'
import { WorkshopRenderer } from './render/scene'

function storage(): Storage | null {
  try {
    const s = window.localStorage
    const k = 'deadcenter:probe'
    s.setItem(k, '1')
    s.removeItem(k)
    return s
  } catch {
    return null
  }
}

async function boot() {
  const app = document.getElementById('app')!
  const canvas = document.getElementById('stage') as HTMLCanvasElement
  try {
    await Promise.race([document.fonts.load('500 30px "IBM Plex Mono"'), new Promise((r) => setTimeout(r, 1200))])
  } catch {
    /* fonts are a nicety */
  }

  let renderer: WorkshopRenderer
  try {
    const lowPower = Math.min(screen.width, screen.height) < 500
    renderer = new WorkshopRenderer(canvas, { lowPower })
  } catch (err) {
    console.error(err)
    app.dataset.state = 'error'
    document.getElementById('fallback')!.hidden = false
    return
  }

  const game = new Game(renderer, storage())
  const params = new URLSearchParams(location.search)
  game.lowRes = params.has('test')
  game.start(params.get('piece'))
  if (params.has('test')) (window as unknown as { __deadCenter: unknown }).__deadCenter = game.debug()

  let raf = 0
  let last = performance.now()
  const frame = (now: number) => {
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000))
    last = now
    game.tick(dt)
    raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)

  // Pause the loop while hidden; physics is precomputed, so playback resumes exactly where it was.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelAnimationFrame(raf)
    else {
      last = performance.now()
      raf = requestAnimationFrame(frame)
    }
  })

  let pending = 0
  const resize = () => {
    cancelAnimationFrame(pending)
    pending = requestAnimationFrame(() => game.onResize())
  }
  window.addEventListener('resize', resize)
  window.addEventListener('orientationchange', resize)
  window.visualViewport?.addEventListener('resize', resize)
  new ResizeObserver(resize).observe(document.getElementById('arena')!)
}

void boot()
