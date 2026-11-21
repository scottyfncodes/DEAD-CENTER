import type { Material } from '../physics/constants'

/**
 * Synthesized workshop sounds (Web Audio, no audio files). Every contact is a
 * small modal model: a few decaying partials plus a click, tuned per material
 * so walnut thuds, ceramic clicks and brass rings.
 */

type Partial = [freq: number, decay: number, amp: number]

const VOICES: Record<Material, { partials: Partial[]; click: { type: BiquadFilterType; f: number; dur: number; amp: number } }> = {
  wood: {
    partials: [
      [186, 0.075, 1],
      [402, 0.05, 0.45],
      [871, 0.025, 0.22],
    ],
    click: { type: 'lowpass', f: 1400, dur: 0.018, amp: 0.55 },
  },
  ceramic: {
    partials: [
      [1240, 0.075, 1],
      [2790, 0.05, 0.5],
      [4410, 0.032, 0.28],
    ],
    click: { type: 'highpass', f: 2600, dur: 0.01, amp: 0.4 },
  },
  brass: {
    partials: [
      [1318, 0.42, 1],
      [3637, 0.26, 0.42],
      [7120, 0.14, 0.2],
    ],
    click: { type: 'highpass', f: 3500, dur: 0.008, amp: 0.35 },
  },
}

export class Sound {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noise: AudioBuffer | null = null
  private roll: { gain: GainNode; band: BiquadFilterNode; low: GainNode; src: AudioBufferSourceNode } | null = null
  enabled = true
  haptics = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'

  /** Create or resume the audio context. Must be called from a user gesture. */
  unlock() {
    if (!this.enabled) return
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        if (!Ctor) return
        this.ctx = new Ctor({ latencyHint: 'interactive' })
        this.master = this.ctx.createGain()
        this.master.gain.value = 0.85
        const comp = this.ctx.createDynamicsCompressor()
        comp.threshold.value = -12
        comp.ratio.value = 4
        this.master.connect(comp).connect(this.ctx.destination)
        const len = this.ctx.sampleRate * 2
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
        const d = this.noise.getChannelData(0)
        let s = 12345
        for (let i = 0; i < len; i++) {
          s = (s * 1103515245 + 12345) >>> 0
          d[i] = (s / 4294967296) * 2 - 1
        }
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume()
    } catch {
      this.ctx = null
    }
  }

  setEnabled(on: boolean) {
    this.enabled = on
    if (!on) {
      this.stopRoll()
      if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend()
    } else this.unlock()
  }

  /** Suspend while the page is hidden; resume when it returns. */
  pause(hidden: boolean) {
    if (!this.ctx) return
    if (hidden) void this.ctx.suspend()
    else if (this.enabled) void this.ctx.resume()
  }

  private ready(): AudioContext | null {
    if (!this.enabled || !this.ctx || !this.master || this.ctx.state !== 'running') return null
    return this.ctx
  }

  private vibrate(ms: number) {
    if (this.enabled && this.haptics) {
      try {
        navigator.vibrate(ms)
      } catch {
        /* not permitted */
      }
    }
  }

  private partial(ctx: AudioContext, at: number, freq: number, decay: number, amp: number, dest: AudioNode, glide = 0) {
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = 'sine'
    o.frequency.setValueAtTime(freq * (1 + glide), at)
    if (glide) o.frequency.exponentialRampToValueAtTime(freq, at + Math.min(0.08, decay))
    g.gain.setValueAtTime(0, at)
    g.gain.linearRampToValueAtTime(amp, at + 0.0025)
    g.gain.exponentialRampToValueAtTime(0.0001, at + decay * 4)
    o.connect(g).connect(dest)
    o.start(at)
    o.stop(at + decay * 4 + 0.02)
  }

  private burst(ctx: AudioContext, at: number, type: BiquadFilterType, f: number, dur: number, amp: number, q = 0.7) {
    if (!this.noise || !this.master) return
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const filt = ctx.createBiquadFilter()
    filt.type = type
    filt.frequency.value = f
    filt.Q.value = q
    const g = ctx.createGain()
    g.gain.setValueAtTime(amp, at)
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
    src.connect(filt).connect(g).connect(this.master)
    src.start(at, Math.random() * 1.5)
    src.stop(at + dur + 0.02)
  }

  /** A contact. Intensity is the normal impact speed in units/s. */
  hit(mat: Material, intensity: number, delay = 0) {
    const ctx = this.ready()
    if (!ctx || !this.master) return
    const at = ctx.currentTime + delay
    const k = Math.min(1, intensity / 14)
    const amp = 0.06 + 0.5 * Math.pow(k, 0.85)
    const voice = VOICES[mat]
    const detune = 1 + (Math.random() - 0.5) * 0.04 + k * 0.03
    for (const [f, d, a] of voice.partials) this.partial(ctx, at, f * detune, d * (0.75 + k * 0.4), a * amp * 0.5, this.master, mat === 'wood' ? 0.12 : 0)
    this.burst(ctx, at, voice.click.type, voice.click.f, voice.click.dur, voice.click.amp * amp)
    if (intensity > 5) this.vibrate(mat === 'brass' ? 12 : 8)
  }

  /** The release: a soft tock and a breath of air, scaled by power. */
  launch(power: number) {
    const ctx = this.ready()
    if (!ctx || !this.master) return
    const at = ctx.currentTime
    this.partial(ctx, at, 330, 0.03, 0.16 + power * 0.12, this.master, 0.2)
    this.partial(ctx, at, 720, 0.018, 0.08, this.master)
    this.burst(ctx, at, 'bandpass', 900 + power * 900, 0.09 + power * 0.08, 0.05 + power * 0.08, 1.2)
    this.vibrate(6)
  }

  /** Continuous rolling texture. Call every frame while the ball moves. */
  rolling(speed: number, overHole: boolean) {
    const ctx = this.ready()
    if (!ctx || !this.master || !this.noise) return
    if (!this.roll) {
      const src = ctx.createBufferSource()
      src.buffer = this.noise
      src.loop = true
      const band = ctx.createBiquadFilter()
      band.type = 'bandpass'
      band.Q.value = 0.9
      band.frequency.value = 400
      const low = ctx.createGain()
      low.gain.value = 0
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 160
      const gain = ctx.createGain()
      gain.gain.value = 0
      src.connect(band).connect(gain).connect(this.master)
      src.connect(lp).connect(low).connect(this.master)
      src.start()
      this.roll = { gain, band, low, src }
    }
    const t = ctx.currentTime
    const k = Math.min(1, speed / 18)
    const level = speed < 0.2 ? 0 : (overHole ? 0.5 : 1) * (0.02 + 0.13 * Math.pow(k, 0.8))
    this.roll.gain.gain.setTargetAtTime(level, t, 0.03)
    this.roll.low.gain.setTargetAtTime(level * 1.6, t, 0.03)
    this.roll.band.frequency.setTargetAtTime(260 + k * 900, t, 0.05)
  }

  stopRoll() {
    if (!this.roll || !this.ctx) return
    const r = this.roll
    this.roll = null
    const t = this.ctx.currentTime
    r.gain.gain.setTargetAtTime(0, t, 0.02)
    r.low.gain.setTargetAtTime(0, t, 0.02)
    r.src.stop(t + 0.2)
  }

  /** The ball crossing the rim of the pocket. */
  rim(speed: number) {
    const ctx = this.ready()
    if (!ctx || !this.master) return
    const at = ctx.currentTime
    const a = 0.05 + Math.min(0.12, speed * 0.012)
    this.partial(ctx, at, 2093, 0.05, a, this.master)
    this.partial(ctx, at, 5240, 0.03, a * 0.4, this.master)
  }

  /** Capture: a precise rim contact, the drop, a short rattle, and a resonant clunk. */
  sink() {
    const ctx = this.ready()
    if (!ctx || !this.master) return
    const at = ctx.currentTime
    // Rim contact.
    this.partial(ctx, at, 1568, 0.12, 0.16, this.master)
    this.partial(ctx, at, 4330, 0.06, 0.06, this.master)
    // The clunk at the bottom of the cup: a low pitched-down thump inside a walnut body.
    const c = at + 0.2
    this.partial(ctx, c, 82, 0.16, 0.55, this.master, 0.7)
    this.partial(ctx, c, 196, 0.09, 0.32, this.master, 0.25)
    this.partial(ctx, c, 523, 0.04, 0.12, this.master)
    this.burst(ctx, c, 'lowpass', 700, 0.05, 0.35)
    // Two small settling taps.
    this.partial(ctx, c + 0.085, 240, 0.03, 0.12, this.master, 0.2)
    this.partial(ctx, c + 0.14, 260, 0.02, 0.06, this.master, 0.2)
    this.vibrate(18)
  }

  /** A quiet completion note, like a small counter bell heard across the room. */
  success() {
    const ctx = this.ready()
    if (!ctx || !this.master) return
    const at = ctx.currentTime + 0.05
    this.partial(ctx, at, 1046.5, 0.55, 0.05, this.master)
    this.partial(ctx, at, 2093, 0.3, 0.02, this.master)
    this.partial(ctx, at + 0.11, 1568, 0.6, 0.045, this.master)
    this.partial(ctx, at + 0.11, 3951, 0.25, 0.012, this.master)
  }

  /** The ball leaving the board and landing softly on the linen below. */
  fall() {
    const ctx = this.ready()
    if (!ctx || !this.master) return
    const at = ctx.currentTime + 0.32
    this.partial(ctx, at, 120, 0.07, 0.18, this.master, 0.3)
    this.burst(ctx, at, 'lowpass', 400, 0.06, 0.15)
  }

  /** UI tick for buttons. */
  tick() {
    const ctx = this.ready()
    if (!ctx || !this.master) return
    this.partial(ctx, ctx.currentTime, 1800, 0.012, 0.035, this.master)
  }
}
