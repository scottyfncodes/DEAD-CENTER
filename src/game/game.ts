import { Sound } from '../audio/sound'
import { track } from '../analytics/pulse'
import { COLLECTIONS, LEVELS } from '../levels/collection'
import type { LevelDef, Shot } from '../levels/types'
import { worldFor } from '../levels/validate'
import { BALL_R, POCKET_R } from '../physics/constants'
import { isLaunchable, simulate, type ShotResult } from '../physics/sim'
import { WorkshopRenderer, type Rect } from '../render/scene'
import { planSVG } from '../ui/plan'
import { AimTracker, maxPullFor, wrapDeg } from './aim'
import * as save from './save'
import * as voice from './voice'

type Phase = 'ready' | 'aiming' | 'rolling' | 'dropping' | 'falling' | 'settled' | 'resetting' | 'sunk'

const CUP_DROP = 1.12
const RESET_OUT = 0.14
const RESET_IN = 0.2
const SETTLE_WAIT = 1.15
/** The Collection first shipped with twelve pieces; later ones are "new" to anyone who played before. */
const ORIGINAL_PIECES = 12

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

function ease(t: number) {
  return t < 0 ? 0 : t > 1 ? 1 : 1 - Math.pow(1 - t, 3)
}

export class Game {
  private r: WorkshopRenderer
  private sound = new Sound()
  private data: save.SaveData
  private storage: save.Storage | null
  private level: LevelDef = LEVELS[0]
  private phase: Phase = 'ready'
  private phaseT = 0
  private shot: ShotResult | null = null
  private shotParams: Shot = { angle: 90, power: 0 }
  private eventIdx = 0
  private pos = { x: 0, y: 0 }
  private dropFrom = { x: 0, y: 0 }
  private aim: AimTracker | null = null
  private pointerId: number | null = null
  private keyAim: Shot | null = null
  private lastShot: Shot | null = null
  private runStarted = false
  private ghost: { frames: Float32Array; end: { x: number; y: number } | null } | null = null
  private voiceTimer = 0
  private rimGlow = 0
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  private els = {
    app: $('app'),
    stage: $<HTMLCanvasElement>('stage'),
    arena: $('arena'),
    pieceNo: $('piece-no'),
    pieceCollection: $('piece-collection'),
    pieceName: $('piece-name'),
    attempts: $('attempts'),
    voice: $('voice'),
    hint: $('hint'),
    retry: $<HTMLButtonElement>('btn-retry'),
    ghostBtn: $<HTMLButtonElement>('btn-ghost'),
    soundBtn: $<HTMLButtonElement>('btn-sound'),
    collectionBtn: $<HTMLButtonElement>('btn-collection'),
    result: $('result'),
    resultLine: $('result-line'),
    resultMeta: $('result-meta'),
    resultDetail: $('result-detail'),
    resultCount: $('result-count'),
    again: $<HTMLButtonElement>('btn-again'),
    next: $<HTMLButtonElement>('btn-next'),
    collection: $('collection'),
    collectionList: $('collection-list'),
    collectionProgress: $('collection-progress'),
    close: $<HTMLButtonElement>('btn-close'),
  }

  constructor(renderer: WorkshopRenderer, storage: save.Storage | null) {
    this.r = renderer
    this.storage = storage
    this.data = save.load(storage)
    this.sound.enabled = this.data.settings.sound
    this.bindUI()
    this.bindInput()
    this.syncToggles()
  }

  /** Pick the piece to open: ?piece=, else the last one played, else the first unsolved. */
  start(requested?: string | null) {
    const byId = (id: string | null | undefined) => LEVELS.find((l) => l.id === id)
    const first = Object.keys(this.data.pieces).length === 0
    // A player who solved every piece they had, before the Collection grew, starts on the first new one.
    const fresh = this.newPieces()
    const caughtUp = !first && fresh.length > 0 && LEVELS.slice(0, ORIGINAL_PIECES).every((l) => save.isSolved(this.data, l.id))
    const pick = byId(requested) ?? (caughtUp ? fresh[0] : null) ?? byId(this.data.lastPiece) ?? LEVELS.find((l) => !save.isSolved(this.data, l.id)) ?? LEVELS[0]
    this.load(pick)
    if (first) {
      this.say(voice.onStart(true), 3)
      this.els.hint.hidden = false
    } else if (caughtUp && pick === fresh[0]) this.say(voice.onNewPieces(fresh.length), 3.6)
    this.els.app.dataset.state = 'ready'
  }

  // ————— Level flow —————

  load(level: LevelDef) {
    this.level = level
    this.r.setLevel(level)
    this.ghost = null
    this.r.setGhost(null)
    this.r.setRimGlow(0)
    this.rimGlow = 0
    this.shot = null
    this.keyAim = null
    this.lastShot = null
    this.runStarted = false
    this.pos = { ...level.ball }
    this.r.setBall(level.ball.x, level.ball.y)
    this.r.setAim(null)
    this.setPhase('ready')
    this.els.result.hidden = true
    this.data.lastPiece = level.id
    this.persist()
    const col = COLLECTIONS.find((c) => c.id === level.collection)!
    this.els.pieceNo.textContent = `No. ${String(level.number).padStart(2, '0')}`
    this.els.pieceCollection.textContent = col.title
    this.els.pieceName.textContent = level.name
    document.title = `${level.name} · DEAD CENTER`
    this.say(null)
    this.updateAttempts()
    this.onResize()
  }

  private setPhase(p: Phase) {
    this.phase = p
    this.phaseT = 0
    this.els.retry.disabled = p === 'ready' || p === 'aiming' || p === 'dropping' || p === 'resetting'
    this.els.app.dataset.phase = p
  }

  private launch(shot: Shot) {
    if (!isLaunchable(shot)) return
    this.sound.unlock()
    this.shotParams = { angle: +wrapDeg(shot.angle).toFixed(3), power: +shot.power.toFixed(4) }
    const attempt = save.recordLaunch(this.data, this.level.id)
    this.persist()
    if (!this.runStarted) {
      this.runStarted = true
      track('game_start', { mode: 'collection', level: this.level.number })
    }
    track('shot_launch', { level: this.level.number, attempt })
    this.shot = simulate(worldFor(this.level), this.level.ball, this.shotParams)
    this.eventIdx = 0
    this.lastShot = { ...this.shotParams }
    if (this.keyAim) this.keyAim = { ...this.shotParams }
    this.r.setAim(null)
    this.sound.launch(this.shotParams.power)
    this.hideHint()
    this.say(null)
    this.setPhase('rolling')
    this.updateAttempts()
  }

  /** Back to the start position (after a miss, or to try again). */
  private resetBall(immediate = false) {
    if (immediate || this.reducedMotion.matches) {
      this.pos = { ...this.level.ball }
      this.r.setBall(this.pos.x, this.pos.y)
      this.setPhase('ready')
    } else {
      this.setPhase('resetting')
    }
    this.sound.stopRoll()
    this.updateAttempts()
  }

  private finishShot() {
    const shot = this.shot!
    this.sound.stopRoll()
    if (shot.outcome === 'sunk') {
      this.dropFrom = { ...shot.end }
      this.sound.sink()
      this.rimGlow = 1
      this.setPhase('dropping')
      return
    }
    // A miss: keep its trace as the ghost, and leave the ball where it stopped for a moment.
    this.ghost = { frames: shot.frames, end: shot.outcome === 'rest' ? shot.end : null }
    this.r.setGhost(this.ghost.frames, this.ghost.end)
    const attempt = this.data.pieces[this.level.id]?.runAttempts ?? 1
    this.say(voice.onMiss(shot, attempt, this.shotParams.power))
    if (shot.outcome === 'fell') {
      this.sound.fall()
      this.setPhase('falling')
    } else this.setPhase('settled')
  }

  private complete() {
    const res = save.recordCompletion(this.data, this.level.id)
    this.persist()
    track('game_complete', { result: 'win', level: this.level.number, attempts: res.attempts, first: res.firstTime })
    this.sound.success()
    this.ghost = null
    this.r.setGhost(null)
    const p = this.data.pieces[this.level.id]
    this.els.resultLine.textContent = voice.onSink(res.attempts, res.firstTime, res.newBest)
    this.els.resultMeta.textContent = `No. ${String(this.level.number).padStart(2, '0')} · ${this.level.name}`
    this.els.resultCount.textContent = String(res.attempts)
    const count = res.attempts === 1 ? 'Sunk on the first attempt' : `Sunk in ${res.attempts} attempts`
    let detail = count
    if (res.newBest) detail += `. A new best (was ${res.previousBest}).`
    else if (!res.firstTime && p?.bestAttempts) detail += `. Best: ${p.bestAttempts}.`
    else detail += '.'
    this.els.resultDetail.textContent = detail
    const idx = LEVELS.indexOf(this.level)
    const allSolved = LEVELS.every((l) => save.isSolved(this.data, l.id))
    const nextLabel = idx === LEVELS.length - 1 ? (allSolved ? 'The Collection' : 'Next unsolved') : 'Next piece'
    this.els.next.innerHTML = `${nextLabel} <span aria-hidden="true">→</span>`
    this.els.result.hidden = false
    this.runStarted = false
    this.setPhase('sunk')
    this.updateAttempts()
    requestAnimationFrame(() => this.els.next.focus({ preventScroll: true }))
  }

  private nextPiece() {
    const idx = LEVELS.indexOf(this.level)
    if (idx < LEVELS.length - 1) return this.load(LEVELS[idx + 1])
    const unsolved = LEVELS.find((l) => !save.isSolved(this.data, l.id))
    if (unsolved) return this.load(unsolved)
    this.els.result.hidden = true
    this.openCollection()
  }

  private again() {
    save.resetRun(this.data, this.level.id)
    this.persist()
    this.els.result.hidden = true
    this.r.setRimGlow(0)
    this.rimGlow = 0
    this.resetBall()
  }

  // ————— Frame loop —————

  /** Test runs render at 1x pixel ratio (software GL is slow); the game itself is unaffected. */
  lowRes = false

  /** Playback speed multiplier; only changed by the test hooks. */
  private timeScale = 1

  tick(dt: number) {
    dt *= this.timeScale
    this.phaseT += dt
    const t = this.phaseT
    switch (this.phase) {
      case 'rolling': {
        const shot = this.shot!
        const p = this.sample(shot, Math.min(t, shot.endTime))
        this.moveBall(p.x, p.y)
        while (this.eventIdx < shot.events.length && shot.events[this.eventIdx].t <= t) {
          const e = shot.events[this.eventIdx++]
          if (e.kind === 'hit') this.sound.hit(e.mat, e.intensity)
          else if (e.kind === 'rim' && shot.outcome !== 'sunk') this.sound.rim(e.intensity)
        }
        const v = this.speedAt(shot, t)
        const d = Math.hypot(p.x - this.level.pocket.x, p.y - this.level.pocket.y)
        this.sound.rolling(v, d < POCKET_R)
        if (t >= shot.endTime) this.finishShot()
        break
      }
      case 'dropping': {
        const u = Math.min(1, t / 0.3)
        const k = ease(u)
        const x = this.dropFrom.x + (this.level.pocket.x - this.dropFrom.x) * k
        const y = this.dropFrom.y + (this.level.pocket.y - this.dropFrom.y) * k
        let drop = CUP_DROP * u * u
        if (t > 0.3) drop = CUP_DROP - Math.max(0, Math.sin(((t - 0.3) / 0.14) * Math.PI)) * 0.07 * (t < 0.44 ? 1 : 0)
        this.r.rollBall(x - this.pos.x, y - this.pos.y)
        this.pos = { x, y }
        this.r.setBall(x, y, drop)
        if (t > 0.62) this.complete()
        break
      }
      case 'falling': {
        const shot = this.shot!
        const g = 34
        const x = shot.end.x + shot.endVelocity.x * t
        const y = shot.end.y + shot.endVelocity.y * t
        const drop = 0.5 * g * t * t
        this.moveBall(x, y, drop, Math.max(0, 1 - Math.max(0, t - 0.35) / 0.2))
        if (t > 0.55) this.resetBall()
        break
      }
      case 'settled':
        if (t > SETTLE_WAIT) this.resetBall()
        break
      case 'resetting': {
        if (t < RESET_OUT) {
          this.r.setBall(this.pos.x, this.pos.y, 0, 1 - t / RESET_OUT)
        } else {
          const u = Math.min(1, (t - RESET_OUT) / RESET_IN)
          this.pos = { ...this.level.ball }
          this.r.setBall(this.pos.x, this.pos.y, 0, ease(u))
          if (u >= 1) this.setPhase('ready')
        }
        break
      }
      case 'ready':
        if (this.keyAim) this.r.setAim(this.level.ball, this.keyAim.angle, this.keyAim.power, true)
        break
    }
    if (this.rimGlow > 0) {
      this.rimGlow = Math.max(0, this.rimGlow - dt * 1.1)
      const g = this.rimGlow
      this.r.setRimGlow(Math.sin(g * Math.PI) * (this.reducedMotion.matches ? 0.5 : 1))
    }
    if (this.voiceTimer > 0) {
      this.voiceTimer -= dt
      if (this.voiceTimer <= 0) this.els.voice.classList.remove('is-on')
    }
    this.r.render()
  }

  private moveBall(x: number, y: number, extraDrop = 0, scale = 1) {
    this.r.rollBall(x - this.pos.x, y - this.pos.y)
    this.pos = { x, y }
    const d = Math.hypot(x - this.level.pocket.x, y - this.level.pocket.y)
    const dip = d < POCKET_R ? ((POCKET_R - d) / POCKET_R) * 0.26 : 0
    this.r.setBall(x, y, dip + extraDrop, scale)
  }

  private sample(shot: ShotResult, t: number) {
    const f = shot.frames
    const n = f.length / 2
    const k = t / shot.frameDt
    const i = Math.floor(k)
    if (i >= n - 1) return { x: f[(n - 1) * 2], y: f[(n - 1) * 2 + 1] }
    const a = k - i
    return { x: f[i * 2] + (f[i * 2 + 2] - f[i * 2]) * a, y: f[i * 2 + 1] + (f[i * 2 + 3] - f[i * 2 + 1]) * a }
  }

  private speedAt(shot: ShotResult, t: number) {
    const a = this.sample(shot, Math.max(0, t - 0.02))
    const b = this.sample(shot, t)
    return Math.hypot(b.x - a.x, b.y - a.y) / 0.02
  }

  // ————— Input —————

  private bindInput() {
    const stage = this.els.app
    const blocked = (e: Event) => (e.target as HTMLElement).closest('button, a, .result, .collection')
    stage.addEventListener('pointerdown', (e) => {
      // A second finger while aiming means a pinch or a fumble, never a shot: drop the aim.
      if (this.pointerId !== null && e.pointerId !== this.pointerId) return this.cancelAim()
      if (blocked(e) || this.pointerId !== null) return
      if (e.pointerType === 'mouse' && e.button !== 0) return
      this.sound.unlock()
      if (this.phase === 'settled' || this.phase === 'resetting') this.resetBall(true)
      if (this.phase !== 'ready') return
      const b = this.r.screenToBoard(e.clientX, e.clientY)
      if (!b) return
      e.preventDefault()
      this.pointerId = e.pointerId
      try {
        stage.setPointerCapture(e.pointerId)
      } catch {
        /* capture unsupported */
      }
      const rect = this.els.stage.getBoundingClientRect()
      this.aim = new AimTracker({ sx: e.clientX, sy: e.clientY, bx: b.x, by: b.y, t: e.timeStamp }, maxPullFor(rect.width, rect.height))
      this.keyAim = null
      this.setPhase('aiming')
      this.r.setAim(this.level.ball, 90, 0, false)
    })
    stage.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.pointerId || !this.aim || this.phase !== 'aiming') return
      e.preventDefault()
      const b = this.r.screenToBoard(e.clientX, e.clientY)
      if (!b) return
      const s = this.aim.update({ sx: e.clientX, sy: e.clientY, bx: b.x, by: b.y, t: e.timeStamp })
      this.r.setAim(this.level.ball, s.angle, s.power, s.armed)
    })
    const end = (e: PointerEvent, cancelled: boolean) => {
      if (e.pointerId !== this.pointerId) return
      this.pointerId = null
      const aim = this.aim
      this.aim = null
      if (this.phase !== 'aiming') return
      this.r.setAim(null)
      this.setPhase('ready')
      if (!cancelled && aim && aim.armed) this.launch({ angle: aim.angle, power: aim.power })
    }
    stage.addEventListener('pointerup', (e) => end(e, false))
    stage.addEventListener('pointercancel', (e) => end(e, true))
    stage.addEventListener('lostpointercapture', (e) => end(e, true))
    // Stop the page from scrolling, zooming or showing callouts while aiming.
    for (const type of ['touchstart', 'touchmove', 'gesturestart', 'dblclick', 'contextmenu'] as const) {
      stage.addEventListener(type, (e) => {
        if (!blocked(e)) e.preventDefault()
      }, { passive: false })
    }
    window.addEventListener('blur', () => this.cancelAim())

    window.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (!this.els.collection.hidden) {
        if (e.key === 'Escape') this.closeCollection()
        return
      }
      const k = e.key.toLowerCase()
      if (k === 'escape' && this.phase === 'aiming') return this.cancelAim()
      if (k === 'g') return this.toggleGhost()
      if (k === 'm') return this.toggleSound()
      if (k === 'c') return this.openCollection()
      if (k === 'r') return this.retry()
      if (this.phase === 'sunk' && k === 'n') return this.nextPiece()
      if (this.phase === 'settled' || this.phase === 'resetting') {
        if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' ', 'enter'].includes(k)) this.resetBall(true)
      }
      if (this.phase !== 'ready') return
      const fine = e.shiftKey
      const aim = (this.keyAim ??= this.lastShot ? { ...this.lastShot } : { angle: 90, power: 0.35 })
      if (k === 'arrowleft') aim.angle = wrapDeg(aim.angle + (fine ? 0.1 : 1))
      else if (k === 'arrowright') aim.angle = wrapDeg(aim.angle - (fine ? 0.1 : 1))
      else if (k === 'arrowup') aim.power = Math.min(1, aim.power + (fine ? 0.005 : 0.02))
      else if (k === 'arrowdown') aim.power = Math.max(0.05, aim.power - (fine ? 0.005 : 0.02))
      else if ((k === ' ' || k === 'enter') && (e.target as HTMLElement).tagName !== 'BUTTON') {
        e.preventDefault()
        this.launch(aim)
        return
      } else return
      e.preventDefault()
      this.sound.unlock()
      this.r.setAim(this.level.ball, aim.angle, aim.power, true)
    })

    document.addEventListener('visibilitychange', () => this.sound.pause(document.hidden))
  }

  private cancelAim() {
    if (this.phase !== 'aiming') return
    this.pointerId = null
    this.aim = null
    this.r.setAim(null)
    this.setPhase('ready')
  }

  private retry() {
    if (this.phase === 'sunk') return this.again()
    if (this.phase === 'rolling') {
      // The outcome is already decided; skipping ahead keeps it as this attempt's ghost.
      const shot = this.shot!
      if (shot.outcome !== 'sunk') {
        this.ghost = { frames: shot.frames, end: shot.outcome === 'rest' ? shot.end : null }
        this.r.setGhost(this.ghost.frames, this.ghost.end)
        this.resetBall()
      }
      return
    }
    if (this.phase === 'settled' || this.phase === 'falling') this.resetBall()
  }

  // ————— UI —————

  private bindUI() {
    this.els.retry.addEventListener('click', () => this.retry())
    this.els.ghostBtn.addEventListener('click', () => this.toggleGhost())
    this.els.soundBtn.addEventListener('click', () => this.toggleSound())
    this.els.collectionBtn.addEventListener('click', () => this.openCollection())
    this.els.close.addEventListener('click', () => this.closeCollection())
    this.els.again.addEventListener('click', () => this.again())
    this.els.next.addEventListener('click', () => this.nextPiece())
    this.els.collectionList.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-piece]')
      if (!btn) return
      const level = LEVELS.find((l) => l.id === btn.dataset.piece)
      if (!level) return
      this.closeCollection(false)
      this.load(level)
    })
  }

  private toggleGhost() {
    this.data.settings.ghost = !this.data.settings.ghost
    this.persist()
    this.syncToggles()
  }

  private toggleSound() {
    this.data.settings.sound = !this.data.settings.sound
    this.sound.setEnabled(this.data.settings.sound)
    this.persist()
    this.syncToggles()
    this.sound.tick()
  }

  private syncToggles() {
    const { ghost, sound } = this.data.settings
    this.els.ghostBtn.setAttribute('aria-pressed', String(ghost))
    this.els.ghostBtn.setAttribute('aria-label', ghost ? 'Hide the previous shot' : 'Show the previous shot')
    this.els.soundBtn.setAttribute('aria-pressed', String(sound))
    this.els.soundBtn.setAttribute('aria-label', sound ? 'Sound on' : 'Sound off')
    this.r.setGhostVisible(ghost)
  }

  /** Pieces added after the first release that this player has never launched on. */
  private newPieces(): LevelDef[] {
    return LEVELS.slice(ORIGINAL_PIECES).filter((l) => !(this.data.pieces[l.id]?.launches))
  }

  private openCollection() {
    if (this.phase === 'aiming') this.cancelAim()
    const solved = LEVELS.filter((l) => save.isSolved(this.data, l.id)).length
    this.els.collectionProgress.textContent = solved === LEVELS.length ? 'Every piece solved' : `${solved} of ${LEVELS.length} solved`
    const html: string[] = []
    const fresh = this.newPieces()
    const veteran = LEVELS.slice(0, ORIGINAL_PIECES).some((l) => save.isSolved(this.data, l.id))
    for (const col of COLLECTIONS) {
      const pieces = LEVELS.filter((l) => l.collection === col.id)
      const done = pieces.filter((l) => save.isSolved(this.data, l.id)).length
      // Marked new only for players who were here before it: untouched, added later, and they have played the original set.
      const isNew = veteran && pieces.every((l) => fresh.includes(l))
      const tag = isNew ? '<span class="set__new">New</span>' : ''
      html.push(`<section class="set" aria-labelledby="set-${col.id}"><div class="set__head"><span class="set__numeral" aria-hidden="true">${col.numeral}</span><h3 class="set__title" id="set-${col.id}">${col.title}</h3>${tag}<span class="set__count">${done}/${pieces.length}</span></div><div class="set__grid">`)
      for (const l of pieces) {
        const p = this.data.pieces[l.id]
        const solvedP = p?.firstAttempts != null
        let status = 'Unsolved'
        if (solvedP) {
          status = p!.firstAttempts === 1 ? 'First attempt' : `Solved in ${p!.firstAttempts}`
          if (p!.bestAttempts !== null && p!.bestAttempts < p!.firstAttempts!) status += ` · best ${p!.bestAttempts}`
        } else if (p && p.launches > 0) status = `${p.launches} attempt${p.launches === 1 ? '' : 's'} so far`
        const no = String(l.number).padStart(2, '0')
        html.push(
          `<button type="button" class="piece${solvedP ? ' is-solved' : ''}${l.id === this.level.id ? ' is-current' : ''}" data-piece="${l.id}" aria-label="No. ${no}, ${l.name}. ${status}."><span class="piece__plan">${planSVG(l)}</span><span class="piece__no">NO. ${no}</span><span class="piece__name">${l.name}</span><span class="piece__status"><span class="mark" aria-hidden="true"></span>${status}</span></button>`,
        )
      }
      html.push('</div></section>')
    }
    this.els.collectionList.innerHTML = html.join('')
    this.els.collection.hidden = false
    this.els.collection.scrollTop = 0
    const current = this.els.collectionList.querySelector<HTMLElement>('.is-current')
    current?.focus({ preventScroll: true })
    if (current && current.getBoundingClientRect().bottom > window.innerHeight) current.scrollIntoView({ block: 'center' })
  }

  private closeCollection(focus = true) {
    this.els.collection.hidden = true
    if (focus) this.els.collectionBtn.focus({ preventScroll: true })
  }

  private say(text: string | null, seconds = 2.4) {
    if (!text) {
      this.els.voice.classList.remove('is-on')
      this.voiceTimer = 0
      return
    }
    this.els.voice.textContent = text
    this.els.voice.classList.add('is-on')
    this.voiceTimer = seconds
  }

  private hideHint() {
    if (this.els.hint.hidden) return
    this.els.hint.classList.add('is-gone')
    setTimeout(() => (this.els.hint.hidden = true), 320)
  }

  private updateAttempts() {
    const run = this.data.pieces[this.level.id]?.runAttempts ?? 0
    const waiting = this.phase === 'ready' || this.phase === 'aiming' || this.phase === 'resetting'
    const n = waiting ? run + 1 : Math.max(1, run)
    this.els.attempts.textContent = `Attempt ${n}`
  }

  private persist() {
    save.persist(this.storage, this.data)
  }

  /** Re-measure the layout and frame the board inside the arena. */
  onResize() {
    const rect = this.els.stage.getBoundingClientRect()
    const a = this.els.arena.getBoundingClientRect()
    const pad = 6
    const fit: Rect = { x: a.left - rect.left + pad, y: a.top - rect.top + pad, w: Math.max(40, a.width - pad * 2), h: Math.max(40, a.height - pad * 2) }
    const dpr = this.lowRes ? 1 : Math.min(window.devicePixelRatio || 1, 2)
    this.r.resize(rect.width, rect.height, fit, dpr)
  }

  // ————— Test hooks (only with ?test) —————

  debug() {
    return {
      phase: () => this.phase,
      level: () => this.level.id,
      levels: () => LEVELS.map((l) => l.id),
      solution: () => this.level.solution,
      ball: () => ({ ...this.pos }),
      /** Screen point of the ball, and where to drag to for a given shot. */
      dragFor: (shot: Shot) => {
        const b = this.r.boardToScreen(this.level.ball.x, this.level.ball.y)
        const rect = this.els.stage.getBoundingClientRect()
        const pull = maxPullFor(rect.width, rect.height) * shot.power
        // Find the screen direction whose board projection points opposite the launch.
        const rad = (shot.angle * Math.PI) / 180
        const back = this.r.boardToScreen(this.level.ball.x - Math.cos(rad) * 3, this.level.ball.y - Math.sin(rad) * 3)
        const dx = back.x - b.x
        const dy = back.y - b.y
        const len = Math.hypot(dx, dy)
        return { from: b, to: { x: b.x + (dx / len) * pull, y: b.y + (dy / len) * pull } }
      },
      save: () => JSON.parse(JSON.stringify(this.data)),
      goto: (id: string) => {
        const l = LEVELS.find((x) => x.id === id)
        if (l) this.load(l)
      },
      launch: (shot: Shot) => this.launch(shot),
      speed: (k: number) => (this.timeScale = Math.max(0.1, Math.min(20, k))),
      radius: BALL_R,
    }
  }
}
