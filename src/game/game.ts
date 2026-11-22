import { Sound } from '../audio/sound'
import { track } from '../analytics/pulse'
import { COLLECTIONS, LEVELS } from '../levels/collection'
import type { LevelDef, Shot } from '../levels/types'
import { worldFor } from '../levels/validate'
import { BALL_R, DEAD_CENTER_OFFSET, POCKET_R } from '../physics/constants'
import * as workbench from '../modes/workbench'
import { isLaunchable, simulate, type ShotResult } from '../physics/sim'
import { WorkshopRenderer, type Rect } from '../render/scene'
import { planSVG } from '../ui/plan'
import { AimTracker, maxPullFor, wrapDeg } from './aim'
import * as save from './save'
import * as voice from './voice'
import { parseShot } from './share'

type Phase = 'ready' | 'aiming' | 'rolling' | 'dropping' | 'falling' | 'settled' | 'resetting' | 'sunk'

const CUP_DROP = 1.12
const RESET_OUT = 0.14
const RESET_IN = 0.2
const SETTLE_WAIT = 1.15
/** The Collection first shipped with twelve pieces, then thirty; a save with no record of what it knew is dated by its progress. */
const FIRST_RELEASE = 12
const SECOND_RELEASE = 30

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
  /** The board in play is a Workbench day (null for a Collection piece). */
  private daily: { date: string } | null = null
  /** Playing back someone else's shared shot: nothing is recorded. */
  private replaying = false
  private shared: Shot | null = null
  /** First visit: a slow demonstration pull on the ball until the player touches the board. */
  private demoT = -1
  /** How many pieces this player knew at the start of this visit (for the New tags). */
  private knownAtStart = 0
  private lastSink: { shot: Shot; attempts: number; ace: boolean; deadCenter: boolean } | null = null
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
    resultMarks: $('result-marks'),
    share: $<HTMLButtonElement>('btn-share'),
    sharedCard: $('shared'),
    sharedLine: $('shared-line'),
    watch: $<HTMLButtonElement>('btn-watch'),
    own: $<HTMLButtonElement>('btn-own'),
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

  /** What this player's game knew before this visit: recorded, or dated by the furthest piece they touched. */
  private knownBefore(): number {
    if (this.data.known !== null) return this.data.known
    const touched = LEVELS.filter((l) => (this.data.pieces[l.id]?.launches ?? 0) > 0)
    if (!touched.length) return LEVELS.length
    return touched.some((l) => l.number > FIRST_RELEASE) ? SECOND_RELEASE : FIRST_RELEASE
  }

  /**
   * Open the game: a shared link (?piece= or ?workbench=, with an optional &shot=), else the last piece
   * played, else the first unsolved. A returning player whose Collection has grown is told once, and
   * starts on the first new piece if they had finished everything they had.
   */
  start(params: URLSearchParams = new URLSearchParams()) {
    const byId = (id: string | null | undefined) => LEVELS.find((l) => l.id === id)
    const first = Object.keys(this.data.pieces).length === 0
    const known = this.knownBefore()
    this.knownAtStart = known
    const grew = !first && known < LEVELS.length
    const caughtUp = grew && LEVELS.slice(0, known).every((l) => save.isSolved(this.data, l.id))
    const firstNew = LEVELS[known]
    this.data.known = LEVELS.length
    this.shared = parseShot(params.get('shot'))
    const date = params.get('workbench')
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      this.load(byId(this.data.lastPiece) ?? LEVELS[0])
      void this.openWorkbench(date)
    } else {
      const pick = byId(params.get('piece')) ?? (caughtUp ? firstNew : null) ?? byId(this.data.lastPiece) ?? LEVELS.find((l) => !save.isSolved(this.data, l.id)) ?? LEVELS[0]
      this.load(pick)
      this.offerShared()
    }
    if (first) {
      this.say(voice.onStart(true), 3)
      this.els.hint.hidden = false
      this.demoT = 0
    } else if (grew) this.say(voice.onNewPieces(LEVELS.length - known), 3.6)
    this.persist()
    this.els.app.dataset.state = 'ready'
  }

  /** Open the Workbench board for a date (today by default). Boards load on first use. */
  async openWorkbench(date = save.localDate()) {
    try {
      const stock = await workbench.loadBoards()
      this.closeCollection(false)
      this.load(workbench.boardFor(date, stock), { date })
      this.offerShared()
    } catch (err) {
      console.warn('Workbench unavailable', err)
      this.say('The Workbench is not available right now.', 3)
    }
  }

  /** A link carried a shot: offer to watch it, or to play the board yourself. */
  private offerShared() {
    if (!this.shared) return
    this.els.sharedLine.textContent = this.daily ? `A shot was shared on ${this.level.name}.` : `A shot was shared on No. ${String(this.level.number).padStart(2, '0')}, ${this.level.name}.`
    this.els.sharedCard.hidden = false
  }

  private watchShared() {
    const shot = this.shared
    this.els.sharedCard.hidden = true
    if (!shot) return
    if (this.phase !== 'ready') this.resetBall(true)
    this.replaying = true
    this.launch(shot)
  }

  // ————— Level flow —————

  load(level: LevelDef, opts: { date?: string } = {}) {
    this.level = level
    this.daily = opts.date ? { date: opts.date } : null
    this.replaying = false
    this.els.sharedCard.hidden = true
    this.r.setLevel(level)
    if (!this.reducedMotion.matches) this.r.intro()
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
    if (!this.daily) this.data.lastPiece = level.id
    this.persist()
    if (this.daily) {
      this.els.pieceNo.textContent = 'The Workbench'
      this.els.pieceCollection.textContent = workbench.dayLabel(this.daily.date)
      this.els.pieceName.textContent = level.name
    } else {
      const col = COLLECTIONS.find((c) => c.id === level.collection)!
      this.els.pieceNo.textContent = `No. ${String(level.number).padStart(2, '0')}`
      this.els.pieceCollection.textContent = col.title
      this.els.pieceName.textContent = level.name
    }
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
    this.stopDemo()
    if (!this.replaying) {
      const attempt = save.recordLaunch(this.data, this.level.id)
      const mode = this.daily ? 'workbench' : 'collection'
      if (this.daily && this.daily.date === save.localDate()) workbench.recordDailyLaunch(this.data, this.daily.date, this.level.id)
      this.persist()
      if (!this.runStarted) {
        this.runStarted = true
        track('game_start', { mode, level: this.level.number })
      }
      track('shot_launch', { mode, level: this.level.number, attempt })
    }
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
      if (!this.reducedMotion.matches) this.r.burst(this.level.pocket.x, this.level.pocket.y)
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
    const deadCenter = (this.shot?.entryOffset ?? 9) <= DEAD_CENTER_OFFSET
    if (this.replaying) {
      // Someone else's shot, played back: nothing is recorded. Back to the start for the player's own turn.
      this.replaying = false
      this.say(deadCenter ? 'Dead center. Your turn.' : 'That is how it went in. Your turn.', 3)
      this.r.setRimGlow(0)
      this.rimGlow = 0
      this.resetBall()
      return
    }
    const res = save.recordCompletion(this.data, this.level.id, save.localDate(), deadCenter)
    if (this.daily && this.daily.date === save.localDate()) {
      workbench.recordDailySink(this.data, this.daily.date, this.level.id, res.attempts, save.localDate())
      if (deadCenter) this.data.daily[this.daily.date].deadCenter = true
    }
    this.persist()
    track('game_complete', { result: 'win', mode: this.daily ? 'workbench' : 'collection', level: this.level.number, attempts: res.attempts, first: res.firstTime })
    this.lastSink = { shot: { ...this.shotParams }, attempts: res.attempts, ace: res.attempts === 1, deadCenter }
    this.sound.success()
    this.ghost = null
    this.r.setGhost(null)
    const p = this.data.pieces[this.level.id]
    this.els.resultLine.textContent = voice.onSink(res.attempts, res.firstTime, res.newBest)
    this.els.resultMeta.textContent = this.daily ? `${this.level.name} · ${workbench.dayLabel(this.daily.date)}` : `No. ${String(this.level.number).padStart(2, '0')} · ${this.level.name}`
    // Mastery marks for this sink; a mark earned for the first time is called out.
    const marks: string[] = []
    const chip = (sym: string, label: string, isNew: boolean) =>
      `<span class="mark-chip${isNew ? ' is-new' : ''}"><span class="mark-chip__sym" aria-hidden="true">${sym}</span>${label}${isNew ? '<span class="mark-chip__new">New</span>' : ''}</span>`
    if (res.attempts === 1) marks.push(chip('1', 'Aced', res.newAce))
    if (deadCenter) marks.push(chip('◎', 'Dead center', res.newDeadCenter))
    this.els.resultMarks.innerHTML = marks.join('')
    this.els.resultMarks.hidden = marks.length === 0
    this.els.resultCount.textContent = String(res.attempts)
    const count = res.attempts === 1 ? 'Sunk on the first attempt' : `Sunk in ${res.attempts} attempts`
    let detail = count
    if (res.newBest) detail += `. A new best (was ${res.previousBest}).`
    else if (!res.firstTime && p?.bestAttempts) detail += `. Best: ${p.bestAttempts}.`
    else detail += '.'
    this.els.resultDetail.textContent = detail
    const idx = LEVELS.indexOf(this.level)
    const allSolved = LEVELS.every((l) => save.isSolved(this.data, l.id))
    const nextLabel = this.daily ? 'The Collection' : idx === LEVELS.length - 1 ? (allSolved ? 'The Collection' : 'Next unsolved') : 'Next piece'
    this.els.next.innerHTML = `${nextLabel} <span aria-hidden="true">→</span>`
    this.els.result.hidden = false
    this.runStarted = false
    this.setPhase('sunk')
    this.updateAttempts()
    requestAnimationFrame(() => this.els.next.focus({ preventScroll: true }))
  }

  private nextPiece() {
    if (this.daily) {
      this.els.result.hidden = true
      return this.openCollection()
    }
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
        else if (this.demoT >= 0) {
          // A ghostly pull, drawn and released, until the player tries it themselves.
          this.demoT += dt
          if (this.reducedMotion.matches) this.r.setAim(this.level.ball, 90, 0.35, true)
          else {
            const c = (this.demoT % 2.6) / 2.6
            const pull = c < 0.7 ? ease(c / 0.7) : 1 - (c - 0.7) / 0.3
            this.r.setAim(this.level.ball, 90 + Math.sin(this.demoT * 0.9) * 6, 0.08 + 0.34 * pull, c < 0.85)
          }
        }
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
    const blocked = (e: Event) => (e.target as HTMLElement).closest('button, a, .result, .collection, .shared')
    stage.addEventListener('pointerdown', (e) => {
      // A second finger while aiming means a pinch or a fumble, never a shot: drop the aim.
      if (this.pointerId !== null && e.pointerId !== this.pointerId) return this.cancelAim()
      if (blocked(e) || this.pointerId !== null) return
      if (e.pointerType === 'mouse' && e.button !== 0) return
      this.stopDemo()
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
      if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' ', 'enter'].includes(k)) this.stopDemo()
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
    this.els.share.addEventListener('click', () => void this.share())
    this.els.watch.addEventListener('click', () => this.watchShared())
    this.els.own.addEventListener('click', () => {
      this.els.sharedCard.hidden = true
      this.shared = null
    })
    this.els.collectionList.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('#btn-workbench')) return void this.openWorkbench()
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
  private stopDemo() {
    if (this.demoT < 0) return
    this.demoT = -1
    this.r.setAim(null)
  }

  /** Share the last sink: the board and the exact shot, as a link anyone can open and watch. */
  private async share() {
    const sink = this.lastSink
    if (!sink) return
    const url = new URL(location.origin + location.pathname)
    if (this.daily) url.searchParams.set('workbench', this.daily.date)
    else url.searchParams.set('piece', this.level.id)
    url.searchParams.set('shot', `${sink.shot.angle},${sink.shot.power}`)
    const where = this.daily ? this.level.name : `No. ${String(this.level.number).padStart(2, '0')} ${this.level.name}`
    const how = sink.attempts === 1 ? 'first attempt' : `${sink.attempts} attempts`
    const text = `DEAD CENTER · ${where}: sunk in ${how}${sink.deadCenter ? ', dead center ◎' : ''}. Can you match it?`
    try {
      if (navigator.share) {
        await navigator.share({ title: 'DEAD CENTER', text, url: url.href })
        return
      }
      await navigator.clipboard.writeText(`${text} ${url.href}`)
      this.say('Link copied.', 2.4)
    } catch (err) {
      if ((err as DOMException)?.name !== 'AbortError') this.say('Could not share from this browser.', 2.6)
    }
  }

  private openCollection() {
    if (this.phase === 'aiming') this.cancelAim()
    const solved = LEVELS.filter((l) => save.isSolved(this.data, l.id)).length
    this.els.collectionProgress.textContent = solved === LEVELS.length ? 'Every piece solved' : `${solved} of ${LEVELS.length} solved`
    const aced = LEVELS.filter((l) => this.data.pieces[l.id]?.aced).length
    const centred = LEVELS.filter((l) => this.data.pieces[l.id]?.deadCenter).length
    this.els.collectionProgress.textContent += ` · ${aced} aced · ${centred} dead center`
    const html: string[] = [this.workbenchCard()]
    for (const col of COLLECTIONS) {
      const pieces = LEVELS.filter((l) => l.collection === col.id)
      const done = pieces.filter((l) => save.isSolved(this.data, l.id)).length
      // New to this player: added since their last visit, and not yet played.
      const isNew = this.knownAtStart < LEVELS.length && pieces.every((l) => l.number > this.knownAtStart && !(this.data.pieces[l.id]?.launches))
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
        const mastery = `<span class="piece__mastery"><span class="m${p?.aced ? ' is-on' : ''}" title="Aced: sunk on a first attempt">1</span><span class="m${p?.deadCenter ? ' is-on' : ''}" title="Dead center">◎</span></span>`
        const said = [status, p?.aced ? 'aced' : '', p?.deadCenter ? 'dead center' : ''].filter(Boolean).join(', ')
        html.push(
          `<button type="button" class="piece${solvedP ? ' is-solved' : ''}${l.id === this.level.id && !this.daily ? ' is-current' : ''}" data-piece="${l.id}" aria-label="No. ${no}, ${l.name}. ${said}."><span class="piece__plan">${planSVG(l)}</span><span class="piece__no">NO. ${no}${mastery}</span><span class="piece__name">${l.name}</span><span class="piece__status"><span class="mark" aria-hidden="true"></span>${status}</span></button>`,
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

  /** Today's Workbench at the top of the Collection: its number, the date, today's result and the streak. */
  private workbenchCard(): string {
    const today = save.localDate()
    const n = workbench.dayNumber(today)
    const rec = this.data.daily[today]
    const streak = workbench.streak(this.data, today)
    let status = 'Today\'s board. Your first run is your score.'
    if (rec?.solved) status = `Sunk in ${rec.firstAttempts}${rec.deadCenter ? ', dead center' : ''}. A new board tomorrow.`
    else if (rec && rec.attempts > 0) status = `${rec.attempts} attempt${rec.attempts === 1 ? '' : 's'} so far today.`
    const streakLine = streak > 1 ? `<span class="bench__streak">${streak} days running</span>` : ''
    return `<section class="bench" aria-labelledby="bench-title"><button type="button" class="bench__card${rec?.solved ? ' is-solved' : ''}" id="btn-workbench" aria-describedby="bench-status"><span class="bench__kicker">The Workbench · ${workbench.dayLabel(today)}</span><span class="bench__title" id="bench-title">Workbench No. ${n}</span><span class="bench__status" id="bench-status">${status}</span>${streakLine}<span class="bench__go" aria-hidden="true">${rec?.solved ? 'Practise' : 'Play'} →</span></button></section>`
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
      daily: () => this.daily?.date ?? null,
      workbench: (date?: string) => this.openWorkbench(date),
      lastEntryOffset: () => this.shot?.entryOffset ?? null,
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
