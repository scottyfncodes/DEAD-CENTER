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
export function walnutTexture(size = 512, tone: [number, number, number] = [112, 74, 50]): THREE.CanvasTexture {
  const [c, g] = canvas(size)
  const img = g.createImageData(size, size)
  const n = makeNoise(7)
  const n2 = makeNoise(19)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size
      const v = y / size
      // Warp the grain coordinate so lines wander.
      const warp = n(u * 3, v * 1, 3, 1) * 0.9 + n2(u * 9, v * 2, 9, 2) * 0.18
      const grain = Math.sin((u * 46 + warp * 5) * Math.PI)
      const fine = Math.sin((u * 190 + warp * 14) * Math.PI)
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
