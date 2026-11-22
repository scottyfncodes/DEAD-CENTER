import * as THREE from 'three'

/**
 * Procedural material textures. Generated once at startup on a 2D canvas so
 * the game ships no image files for its materials.
 */

/** Small deterministic value noise. */
function makeNoise(seed: number) {
  const perm = new Uint8Array(512)
  let s = seed >>> 0
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
  const p = Array.from({ length: 256 }, (_, i) => i)
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[p[i], p[j]] = [p[j], p[i]]
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]
  const grad = (h: number) => (h & 255) / 127.5 - 1
  const fade = (t: number) => t * t * (3 - 2 * t)
  /** Value noise; with a period, the lattice wraps so the texture tiles seamlessly. */
  return (x: number, y: number, px = 256, py = 256) => {
    const x0 = ((Math.floor(x) % px) + px) % px
    const y0 = ((Math.floor(y) % py) + py) % py
    const xi = x0
    const yi = y0
    const x1 = (x0 + 1) % px
    const y1 = (y0 + 1) % py
    const xf = x - Math.floor(x)
    const yf = y - Math.floor(y)
    const a = grad(perm[perm[xi] + yi])
    const b = grad(perm[perm[x1] + yi])
    const c = grad(perm[perm[xi] + y1])
    const d = grad(perm[perm[x1] + y1])
    const u = fade(xf)
    const v = fade(yf)
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
  }
}

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = c.height = size
  return [c, c.getContext('2d', { willReadFrequently: false })!]
}

/**
 * Walnut: warm brown with long, gently wandering grain running along the
 * texture's V axis, occasional darker figure, and fine pores.
 */
export function walnutTexture(size = 512, tone: [number, number, number] = [112, 74, 50], seed = 7, lines = 46): THREE.CanvasTexture {
  const [c, g] = canvas(size)
  const img = g.createImageData(size, size)
  const n = makeNoise(seed)
  const n2 = makeNoise(seed + 12)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size
      const v = y / size
      // Warp the grain coordinate so lines wander.
      const warp = n(u * 3, v * 1, 3, 1) * 0.9 + n2(u * 9, v * 2, 9, 2) * 0.18
      const grain = Math.sin((u * lines + warp * 5) * Math.PI)
      const fine = Math.sin((u * lines * 4 + warp * 14) * Math.PI)
      const figure = n(u * 2 + 11, v * 5, 2, 5) * 0.5 + 0.5
      const pores = n2(u * 128, v * 32, 128, 32)
      let k = 1 + grain * 0.07 + fine * 0.025 - Math.max(0, grain) ** 6 * 0.16 + (figure - 0.5) * 0.16 + pores * 0.035
      k = Math.max(0.55, Math.min(1.25, k))
      const i = (y * size + x) * 4
      img.data[i] = Math.min(255, tone[0] * k)
      img.data[i + 1] = Math.min(255, tone[1] * k * (0.98 + figure * 0.03))
      img.data[i + 2] = Math.min(255, tone[2] * k * 0.97)
      img.data[i + 3] = 255
    }
  }
  g.putImageData(img, 0, 0)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 4
  return t
}

/** A faint brushed-metal roughness map (fine streaks along U). */
export function brushedTexture(size = 256): THREE.CanvasTexture {
  const [c, g] = canvas(size)
  const img = g.createImageData(size, size)
  const n = makeNoise(31)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = 150 + n(x * 0.02, y * 1.7) * 40 + n(x * 0.1, y * 3.1) * 20
      const i = (y * size + x) * 4
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v
      img.data[i + 3] = 255
    }
  }
  g.putImageData(img, 0, 0)
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

/** A soft radial disc used for the ghost dots and markers. */
export function dotTexture(size = 64): THREE.CanvasTexture {
  const [c, g] = canvas(size)
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  grd.addColorStop(0, 'rgba(255,255,255,1)')
  grd.addColorStop(0.55, 'rgba(255,255,255,0.95)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, size, size)
  return new THREE.CanvasTexture(c)
}

/** Baize: short-napped wool felt. Fine fibre noise with a faint mottle; tiles seamlessly. */
export function feltTexture(size = 256, tone: [number, number, number] = [52, 92, 70]): THREE.CanvasTexture {
  const [c, g] = canvas(size)
  const img = g.createImageData(size, size)
  const n = makeNoise(41)
  const n2 = makeNoise(43)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size
      const v = y / size
      const mottle = n(u * 4, v * 4, 4, 4) * 0.06
      const fibre = n2(u * 96, v * 96, 96, 96) * 0.09 + n(u * 48 + 3, v * 160, 48, 160) * 0.05
      const k = 1 + mottle + fibre
      const i = (y * size + x) * 4
      img.data[i] = Math.min(255, tone[0] * k)
      img.data[i + 1] = Math.min(255, tone[1] * k)
      img.data[i + 2] = Math.min(255, tone[2] * k)
      img.data[i + 3] = 255
    }
  }
  g.putImageData(img, 0, 0)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 4
  return t
}

/**
 * A sloped panel in marquetry: pale maple laid with darker chevrons that point downhill, and a gentle
 * light-to-shade gradient down the slope. Drawn for one panel at its own proportions (px per unit).
 */
export function slopeTexture(w: number, h: number, dirDeg: number): THREE.CanvasTexture {
  const ppu = 48
  const cw = Math.max(32, Math.round(w * ppu))
  const ch = Math.max(32, Math.round(h * ppu))
  const c = document.createElement('canvas')
  c.width = cw
  c.height = ch
  const g = c.getContext('2d')!
  const a = (dirDeg * Math.PI) / 180
  // Canvas y runs down = board -y.
  const ux = Math.cos(a)
  const uy = -Math.sin(a)
  // Base: maple, lighter uphill and a touch darker downhill, so the fall of the panel reads.
  const half = Math.hypot(cw, ch) / 2
  const grad = g.createLinearGradient(cw / 2 - ux * half, ch / 2 - uy * half, cw / 2 + ux * half, ch / 2 + uy * half)
  grad.addColorStop(0, '#d8b682')
  grad.addColorStop(1, '#ae8756')
  g.fillStyle = grad
  g.fillRect(0, 0, cw, ch)
  // Fine straight grain along the fall line.
  g.globalAlpha = 0.08
  g.strokeStyle = '#5b3d22'
  g.lineWidth = 1
  for (let k = -half; k < half; k += 5) {
    const px = cw / 2 - uy * k
    const py = ch / 2 + ux * k
    g.beginPath()
    g.moveTo(px - ux * half, py - uy * half)
    g.lineTo(px + ux * half, py + uy * half)
    g.stroke()
  }
  g.globalAlpha = 1
  // Chevrons: rows across the slope, pointing downhill.
  const step = 1.3 * ppu
  const arm = 0.34 * ppu
  g.strokeStyle = 'rgba(92,60,32,0.72)'
  g.lineWidth = 0.11 * ppu
  g.lineCap = 'round'
  g.lineJoin = 'round'
  for (let t = -half + step / 2; t < half; t += step) {
    for (let q = -half + step / 2; q < half; q += step) {
      const cx = cw / 2 + ux * t - uy * q
      const cy = ch / 2 + uy * t + ux * q
      if (cx < 0.45 * ppu || cx > cw - 0.45 * ppu || cy < 0.45 * ppu || cy > ch - 0.45 * ppu) continue
      g.beginPath()
      g.moveTo(cx - ux * arm - uy * arm * 1.1, cy - uy * arm + ux * arm * 1.1)
      g.lineTo(cx + ux * arm * 0.6, cy + uy * arm * 0.6)
      g.lineTo(cx - ux * arm + uy * arm * 1.1, cy - uy * arm - ux * arm * 1.1)
      g.stroke()
    }
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

/** A soft, blurred rounded rectangle (alpha): the board's contact shadow on the table. */
export function contactShadowTexture(aspect: number): THREE.CanvasTexture {
  const W = 256
  const H = Math.max(64, Math.round(W * aspect))
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')!
  const pad = 0.16 * W
  g.filter = `blur(${Math.round(W * 0.06)}px)`
  g.fillStyle = 'rgba(0,0,0,1)'
  const r = W * 0.06
  const x0 = pad
  const y0 = pad
  const x1 = W - pad
  const y1 = H - pad
  g.beginPath()
  g.moveTo(x0 + r, y0)
  g.arcTo(x1, y0, x1, y1, r)
  g.arcTo(x1, y1, x0, y1, r)
  g.arcTo(x0, y1, x0, y0, r)
  g.arcTo(x0, y0, x1, y0, r)
  g.fill()
  const t = new THREE.CanvasTexture(c)
  return t
}
