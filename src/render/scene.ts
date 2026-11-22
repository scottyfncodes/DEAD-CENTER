import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { BALL_R, BAR_R, POCKET_R, RAIL_T } from '../physics/constants'
import { buildRails } from '../physics/world'
import type { LevelDef } from '../levels/types'
import { brushedTexture, contactShadowTexture, dotTexture, feltTexture, slopeTexture, walnutTexture } from './textures'
import { FINISHES, type Finish } from './finishes'
import type { CollectionId } from '../levels/types'

/** Heights in world units (y is up; board y maps to world -z). */
const SLAB_D = 0.9
const RAIL_TOP = 0.82
const BLOCK_H = 0.95
const POST_H = 1.05
const BAR_H = 0.8
const CUP_DEPTH = 1.15
const CAMERA_ELEVATION = 50 * (Math.PI / 180)

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

const PALETTE = {
  walnut: 0x7a553c,
  rail: 0x6b4831,
  ceramic: 0xede6d8,
  brass: 0xc29d5f,
  steel: 0xd3d9db,
  ink: 0x303532,
  cup: 0x1d2a22,
}

/** Board-space rectangle (centre, size). */
interface Panel {
  x: number
  y: number
  w: number
  h: number
}

/** A flat panel lying on the board, with a hole cut where it covers the pocket; UVs run 0..1 across the panel. */
function panelGeometry(p: Panel, pocket: { x: number; y: number }, holeR: number, tile = 0): THREE.BufferGeometry {
  const x0 = p.x - p.w / 2
  const y0 = p.y - p.h / 2
  const shape = new THREE.Shape()
  shape.moveTo(x0, y0)
  shape.lineTo(x0 + p.w, y0)
  shape.lineTo(x0 + p.w, y0 + p.h)
  shape.lineTo(x0, y0 + p.h)
  shape.closePath()
  const dx = Math.max(x0 - pocket.x, 0, pocket.x - (x0 + p.w))
  const dy = Math.max(y0 - pocket.y, 0, pocket.y - (y0 + p.h))
  if (dx * dx + dy * dy < holeR * holeR) {
    const hole = new THREE.Path()
    hole.absarc(pocket.x, pocket.y, holeR, 0, Math.PI * 2, true)
    shape.holes.push(hole)
  }
  const geo = new THREE.ShapeGeometry(shape, 48)
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const uv = new Float32Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) {
    // Either 0..1 across the panel, or tiled every `tile` units (for a repeating texture like felt).
    uv[i * 2] = (pos.getX(i) - x0) / (tile || p.w)
    uv[i * 2 + 1] = (pos.getY(i) - y0) / (tile || p.h)
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  // Shape space is board space (x, y); lay it on the board: board y maps to world -z.
  geo.rotateX(-Math.PI / 2)
  return geo
}

/** Remove the given intervals from [a, b]; returns what is left. */
function subtract(a: number, b: number, cuts: Array<[number, number]>): Array<[number, number]> {
  let out: Array<[number, number]> = [[a, b]]
  for (const [c0, c1] of cuts) {
    const next: Array<[number, number]> = []
    for (const [s0, s1] of out) {
      if (c1 <= s0 || c0 >= s1) next.push([s0, s1])
      else {
        if (c0 > s0) next.push([s0, c0])
        if (c1 < s1) next.push([c1, s1])
      }
    }
    out = next
  }
  return out.filter(([s0, s1]) => s1 - s0 > 0.05)
}

const SPARKS = 40
const BURST_LIFE = 0.9

/** Map board coordinates to world space. */
function w3(x: number, y: number, h = 0): THREE.Vector3 {
  return new THREE.Vector3(x, h, -y)
}

/** Planar UVs from world position, so wood grain is continuous and to scale. */
function planarUV(geo: THREE.BufferGeometry, along: 'x' | 'z', scale = 7) {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const uv = new Float32Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    if (along === 'z') {
      uv[i * 2] = (x + y * 0.5) / scale
      uv[i * 2 + 1] = z / scale
    } else {
      uv[i * 2] = (z + y * 0.5) / scale
      uv[i * 2 + 1] = x / scale
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
}

/** A ring shader that draws the power arc around the ball. */
function powerArcMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uPower: { value: 0 }, uColor: { value: new THREE.Color(PALETTE.brass) }, uTrack: { value: new THREE.Color(PALETTE.ink) } },
    vertexShader: /* glsl */ `
      varying vec2 vPos;
      void main() { vPos = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uPower; uniform vec3 uColor; uniform vec3 uTrack;
      varying vec2 vPos;
      void main() {
        // Fills symmetrically from the back of the ball (the pull side) as power grows.
        float a = abs(atan(vPos.x, -vPos.y)) / 3.1415927;
        if (a <= uPower) gl_FragColor = vec4(uColor * 1.15, 0.95);
        else gl_FragColor = vec4(uTrack, 0.16);
        #include <colorspace_fragment>
      }`,
  })
}

/** True when an opening on a near/far side reaches the corner at x. */
function gapAt(level: LevelDef, side: 'near' | 'far', x: number): boolean {
  return (level.openings ?? []).some((o) => o.side === side && o.from <= x + RAIL_T && o.to >= x - RAIL_T)
}

export class WorkshopRenderer {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200)
  private env: THREE.Texture | null = null
  private board = new THREE.Group()
  private level: LevelDef | null = null
  private ball: THREE.Mesh
  private ballQuat = new THREE.Quaternion()
  private aim = new THREE.Group()
  private aimDots: THREE.InstancedMesh
  private arc: THREE.Mesh
  private arcMat: THREE.ShaderMaterial
  private ghost: THREE.InstancedMesh
  private ghostEnd: THREE.Mesh
  private ghostEndOn = false
  private ghostOn = true
  private rimMat: THREE.MeshStandardMaterial
  private key: THREE.DirectionalLight
  private ground: THREE.Mesh
  private mats: {
    walnut: THREE.MeshStandardMaterial
    rail: THREE.MeshStandardMaterial
    ceramic: THREE.MeshStandardMaterial
    brass: THREE.MeshStandardMaterial
    cup: THREE.MeshStandardMaterial
    felt: THREE.MeshPhysicalMaterial
  }
  /** Lacquered timber per collection, made on first use and kept. */
  private finishes = new Map<CollectionId, { field: THREE.MeshPhysicalMaterial; rail: THREE.MeshPhysicalMaterial; stringing: THREE.MeshStandardMaterial }>()
  /** Materials shared across levels: never disposed when a board is rebuilt. */
  private keep = new Set<THREE.Material>()
  private sparks: THREE.InstancedMesh
  private sparkState: Array<{ x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; age: number; size: number }> = []
  private ripple: THREE.Mesh
  private burstAt = -1
  private clock = performance.now()
  /** A new board settles onto the table: 0 → 1 over a short drop (1 = at rest). */
  private introT = 1
  private ballY = BALL_R
  private contact: THREE.Mesh | null = null
  private raycaster = new THREE.Raycaster()
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  private size = { w: 1, h: 1 }
  private fit: Rect = { x: 0, y: 0, w: 1, h: 1 }
  private dummy = new THREE.Object3D()
  lost = false

  constructor(canvas: HTMLCanvasElement, opts: { lowPower?: boolean } = {}) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' })
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.92
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap

    const brushed = brushedTexture()
    const basics = this.finish('basics')
    this.mats = {
      walnut: basics.field,
      rail: basics.rail,
      // Glazed ceramic: a soft body under a thin clear glaze.
      ceramic: new THREE.MeshPhysicalMaterial({ color: PALETTE.ceramic, roughness: 0.55, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.18, envMapIntensity: 0.6 }),
      brass: new THREE.MeshStandardMaterial({ color: PALETTE.brass, roughness: 0.3, metalness: 1, roughnessMap: brushed, envMapIntensity: 1.25 }),
      // The pocket is lined with dark baize.
      cup: new THREE.MeshStandardMaterial({ color: PALETTE.cup, map: feltTexture(128, [28, 44, 36]), roughness: 1, metalness: 0, side: THREE.BackSide }),
      felt: new THREE.MeshPhysicalMaterial({ map: feltTexture(), roughness: 0.95, metalness: 0, sheen: 1, sheenRoughness: 0.55, sheenColor: new THREE.Color(0x9fc2a8), envMapIntensity: 0.35 }),
    }
    for (const m of Object.values(this.mats)) this.keep.add(m)
    this.rimMat = this.mats.brass.clone()
    this.rimMat.emissive = new THREE.Color(0xf2d39a)
    this.rimMat.emissiveIntensity = 0
    this.keep.add(this.rimMat)

    // Lighting: a warm key from the upper left, soft sky fill, and the room for reflections.
    this.scene.add(new THREE.HemisphereLight(0xfff6e8, 0x6b4a33, 0.55))
    this.key = new THREE.DirectionalLight(0xfff1dc, 2.1)
    this.key.castShadow = true
    const map = opts.lowPower ? 1024 : 2048
    this.key.shadow.mapSize.set(map, map)
    this.key.shadow.bias = -0.0004
    this.key.shadow.normalBias = 0.02
    this.scene.add(this.key, this.key.target)
    const fill = new THREE.DirectionalLight(0xe8eef2, 0.35)
    fill.position.set(12, 8, 10)
    this.scene.add(fill)

    // The linen table under the board only catches its shadow.
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.ShadowMaterial({ color: 0x3a2c1f, opacity: 0.2 }))
    this.ground.rotation.x = -Math.PI / 2
    this.ground.position.y = -SLAB_D - 0.06
    this.ground.receiveShadow = true
    this.scene.add(this.ground)

    this.scene.add(this.board)

    // The ball: polished steel.
    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_R, 48, 32),
      new THREE.MeshStandardMaterial({ color: PALETTE.steel, metalness: 1, roughness: 0.07, envMapIntensity: 1.4 }),
    )
    this.ball.castShadow = true
    this.scene.add(this.ball)

    // Aim indicator: a short brass bead line and a power arc around the ball.
    const dot = dotTexture()
    const beadGeo = new THREE.CircleGeometry(1, 16)
    beadGeo.rotateX(-Math.PI / 2)
    this.aimDots = new THREE.InstancedMesh(beadGeo, new THREE.MeshBasicMaterial({ color: PALETTE.brass, transparent: true, depthWrite: false }), 16)
    this.aimDots.frustumCulled = false
    this.arcMat = powerArcMaterial()
    const arcGeo = new THREE.RingGeometry(BALL_R + 0.22, BALL_R + 0.34, 72, 1)
    this.arc = new THREE.Mesh(arcGeo, this.arcMat)
    this.arc.rotation.x = -Math.PI / 2
    // The arc starts at the launch direction (+x in the aim group's frame).
    this.arc.rotation.z = -Math.PI / 2
    this.aim.add(this.aimDots, this.arc)
    this.aim.visible = false
    this.aim.renderOrder = 3
    this.scene.add(this.aim)

    // Ghost of the previous shot: faint graphite dots, and a ring where it stopped.
    this.ghost = new THREE.InstancedMesh(
      beadGeo,
      new THREE.MeshBasicMaterial({ color: PALETTE.ink, transparent: true, opacity: 0.32, depthWrite: false, alphaMap: dot }),
      600,
    )
    this.ghost.frustumCulled = false
    this.ghost.count = 0
    this.ghost.renderOrder = 2
    const endGeo = new THREE.RingGeometry(BALL_R * 0.92, BALL_R * 1.02, 48)
    endGeo.rotateX(-Math.PI / 2)
    this.ghostEnd = new THREE.Mesh(endGeo, new THREE.MeshBasicMaterial({ color: PALETTE.ink, transparent: true, opacity: 0.3, depthWrite: false }))
    this.ghostEnd.visible = false
    this.scene.add(this.ghost, this.ghostEnd)

    // The sink: a burst of brass glints and a ripple of light across the wood (skipped with reduced motion).
    const dot2 = dotTexture()
    const sparkGeo = new THREE.PlaneGeometry(1, 1)
    this.sparks = new THREE.InstancedMesh(
      sparkGeo,
      new THREE.MeshBasicMaterial({ color: 0xffe1a0, alphaMap: dot2, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
      SPARKS,
    )
    this.sparks.frustumCulled = false
    this.sparks.count = 0
    this.sparks.renderOrder = 4
    const rippleGeo = new THREE.RingGeometry(0.92, 1, 72)
    rippleGeo.rotateX(-Math.PI / 2)
    this.ripple = new THREE.Mesh(rippleGeo, new THREE.MeshBasicMaterial({ color: 0xffd98f, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }))
    this.ripple.visible = false
    this.ripple.renderOrder = 4
    this.scene.add(this.sparks, this.ripple)

    this.buildEnvironment()
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault()
      this.lost = true
    })
    canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false
      this.buildEnvironment()
      if (this.level) this.setLevel(this.level)
    })
  }

  private buildEnvironment() {
    // A small warm workshop for reflections: plaster walls, a tall north window, and a lamp over the bench.
    // Steel and brass pick up its light, so the pieces read as objects in a room, not on a page.
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    const room = new THREE.Scene()
    const mats: THREE.Material[] = []
    const box = (w: number, h: number, d: number, color: number, x: number, y: number, z: number, emissive = 0, intensity = 0, side: THREE.Side = THREE.FrontSide) => {
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 1, emissive, emissiveIntensity: intensity, side })
      mats.push(mat)
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
      m.position.set(x, y, z)
      room.add(m)
      return m
    }
    box(40, 22, 40, 0xe6dccb, 0, 9, 0, 0xe6dccb, 0.35, THREE.BackSide) // pale plaster walls and ceiling
    box(40, 0.2, 40, 0x9a8167, 0, -1.9, 0) // a warm wooden floor
    box(30, 0.2, 22, 0xffffff, 0, 19.7, -2, 0xfff6ea, 2.2) // the ceiling's broad skylight: what a ball seen from above reflects
    box(0.2, 10, 8, 0xffffff, -19.8, 8, -4, 0xf6f4ee, 5.5) // the tall north window
    box(0.2, 10, 4, 0xffffff, -19.8, 8, 7, 0xf6f4ee, 3.5) // a narrower pane
    box(6, 0.3, 2.4, 0xffffff, 4, 17.5, 3, 0xffd7a0, 8) // the lamp over the bench
    box(30, 6, 0.4, 0x7a634c, 0, 1.2, -19.4) // the bench back, a little darker for contrast in the metal
    room.add(new THREE.AmbientLight(0xffffff, 0.8))
    const rt = pmrem.fromScene(room, 0.03)
    this.env?.dispose()
    this.env = rt.texture
    this.scene.environment = this.env
    this.scene.environmentIntensity = 0.85
    room.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh) m.geometry.dispose()
    })
    for (const m of mats) m.dispose()
    pmrem.dispose()
  }

  /** The lacquered timber for a collection (field, rails and the inlaid stringing), made once. */
  private finish(id: CollectionId) {
    let f = this.finishes.get(id)
    if (f) return f
    const spec: Finish = FINISHES[id] ?? FINISHES.basics
    const fieldTex = walnutTexture(512, spec.field, spec.seed, spec.lines)
    const railTex = walnutTexture(512, spec.rail, spec.seed + 3, spec.lines)
    f = {
      // Hand-rubbed lacquer: a satin body with a thin clear coat that catches the window.
      field: new THREE.MeshPhysicalMaterial({ map: fieldTex, roughness: 0.55, metalness: 0, clearcoat: 0.42, clearcoatRoughness: 0.32, envMapIntensity: 0.6 }),
      rail: new THREE.MeshPhysicalMaterial({ map: railTex, roughness: 0.48, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.26, envMapIntensity: 0.7 }),
      stringing: new THREE.MeshStandardMaterial({ color: spec.stringing, roughness: 0.5, metalness: 0, envMapIntensity: 0.5 }),
    }
    this.finishes.set(id, f)
    this.keep.add(f.field)
    this.keep.add(f.rail)
    this.keep.add(f.stringing)
    return f
  }

  /** A burst of brass glints and a ring of light at the pocket (the moment the ball drops). */
  burst(x: number, y: number) {
    this.burstAt = 0
    this.ripple.position.copy(w3(x, y, 0.03))
    this.ripple.visible = true
    this.sparkState = []
    let seed = 17
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
    for (let i = 0; i < SPARKS; i++) {
      const a = (i / SPARKS) * Math.PI * 2 + rnd() * 0.4
      const out = 1.6 + rnd() * 3.2
      this.sparkState.push({
        x: x + Math.cos(a) * POCKET_R,
        y: 0.05,
        z: -(y + Math.sin(a) * POCKET_R),
        vx: Math.cos(a) * out,
        vy: 3 + rnd() * 4.5,
        vz: -Math.sin(a) * out,
        life: 0.45 + rnd() * 0.45,
        age: 0,
        size: 0.1 + rnd() * 0.12,
      })
    }
  }

  /** Play the board's arrival: it is set down on the table from just above. */
  intro() {
    this.introT = 0
    this.applyIntro()
  }

  private introLift(): number {
    const t = Math.min(1, this.introT)
    // Ease out with the faintest settle at the end.
    const k = 1 - Math.pow(1 - t, 3)
    const settle = t > 0.75 ? Math.sin(((t - 0.75) / 0.25) * Math.PI) * 0.03 : 0
    return (1 - k) * 1.6 - settle
  }

  private applyIntro() {
    const lift = this.introT < 1 ? this.introLift() : 0
    this.board.position.y = lift
    this.ball.position.y = this.ballY + lift
    if (this.contact) {
      // The contact shadow stays on the table and darkens as the board comes down.
      this.contact.position.y = -SLAB_D - 0.05 - lift
      ;(this.contact.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - Math.min(1, lift / 1.6))
    }
  }

  private animate(dt: number) {
    if (this.introT < 1) {
      this.introT = Math.min(1, this.introT + dt / 0.42)
      this.applyIntro()
    }
    if (this.burstAt < 0) return
    this.burstAt += dt
    const t = this.burstAt
    // Ring of light: grows from the rim and fades.
    const u = Math.min(1, t / 0.75)
    const sc = POCKET_R * (1 + u * 2.4)
    this.ripple.scale.set(sc, 1, sc)
    ;(this.ripple.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - u) * (1 - u)
    let n = 0
    for (const p of this.sparkState) {
      p.age += dt
      if (p.age > p.life) continue
      p.vy -= 22 * dt
      p.x += p.vx * dt
      p.y = Math.max(0.03, p.y + p.vy * dt)
      p.z += p.vz * dt
      const k = 1 - p.age / p.life
      this.dummy.position.set(p.x, p.y, p.z)
      this.dummy.quaternion.copy(this.camera.quaternion)
      this.dummy.scale.setScalar(p.size * (0.4 + k))
      this.dummy.updateMatrix()
      this.sparks.setMatrixAt(n++, this.dummy.matrix)
    }
    this.sparks.count = n
    this.sparks.instanceMatrix.needsUpdate = true
    if (t > BURST_LIFE && n === 0) {
      this.burstAt = -1
      this.ripple.visible = false
      this.sparks.count = 0
    }
  }

  /** Build the board for a level. Previous geometry is disposed. */
  setLevel(level: LevelDef) {
    this.level = level
    for (const child of [...this.board.children]) {
      this.board.remove(child)
      child.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.isMesh) {
          m.geometry.dispose()
          const mat = m.material as THREE.Material
          if (!this.keep.has(mat)) {
            ;(mat as THREE.MeshStandardMaterial).map?.dispose()
            ;(mat as THREE.MeshStandardMaterial).alphaMap?.dispose()
            mat.dispose()
          }
        }
      })
    }
    const { w, h } = level.size
    const g = this.board
    const fin = this.finish(level.collection)
    this.mats.walnut = fin.field
    this.mats.rail = fin.rail
    this.burstAt = -1
    this.ripple.visible = false
    this.sparks.count = 0

    // Walnut playing surface with the pocket cut through it. Bevel is inset so edges land on the board bounds.
    const bev = 0.09
    const shape = new THREE.Shape()
    shape.moveTo(bev, bev)
    shape.lineTo(w - bev, bev)
    shape.lineTo(w - bev, h - bev)
    shape.lineTo(bev, h - bev)
    shape.closePath()
    const hole = new THREE.Path()
    hole.absarc(level.pocket.x, level.pocket.y, POCKET_R + bev, 0, Math.PI * 2, true)
    shape.holes.push(hole)
    const slab = new THREE.ExtrudeGeometry(shape, { depth: SLAB_D - 2 * bev, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 3, curveSegments: 48 })
    slab.rotateX(-Math.PI / 2)
    slab.translate(0, -SLAB_D + bev, 0)
    planarUV(slab, 'z')
    const floor = new THREE.Mesh(slab, this.mats.walnut)
    floor.receiveShadow = true
    floor.castShadow = true
    g.add(floor)

    // Walnut rails around the edge (with gaps where the level opens).
    for (const r of buildRails(level)) {
      // Side rails run on into the corner pieces they meet, so their rounded ends never show as a notch
      // in the outline or its shadow (the physics keeps the exact pieces).
      let { cy, hy } = r
      if (r.side === 'left' || r.side === 'right') {
        const lo = r.cy - r.hy < 1e-6 && !gapAt(level, 'near', r.side === 'left' ? 0 : w) ? 0.3 : 0
        const hi = r.cy + r.hy > h - 1e-6 && !gapAt(level, 'far', r.side === 'left' ? 0 : w) ? 0.3 : 0
        cy += (hi - lo) / 2
        hy += (hi + lo) / 2
      }
      const geo = new RoundedBoxGeometry(r.hx * 2, RAIL_TOP + SLAB_D, hy * 2, 3, 0.16)
      geo.translate(r.cx, (RAIL_TOP - SLAB_D) / 2, -cy)
      planarUV(geo, r.side === 'near' || r.side === 'far' ? 'x' : 'z')
      const m = new THREE.Mesh(geo, this.mats.rail)
      m.castShadow = m.receiveShadow = true
      g.add(m)
    }

    // Brass corner caps where the rails meet (skipped where a corner is open).
    const capGeo = new RoundedBoxGeometry(RAIL_T * 0.86, 0.06, RAIL_T * 0.86, 2, 0.025)
    for (const [side, cx] of [['near', 0], ['near', w], ['far', 0], ['far', w]] as const) {
      if (gapAt(level, side, cx)) continue
      const cy = side === 'near' ? -RAIL_T / 2 : h + RAIL_T / 2
      const x = cx === 0 ? -RAIL_T / 2 : w + RAIL_T / 2
      const cap = new THREE.Mesh(capGeo.clone(), this.mats.brass)
      cap.position.copy(w3(x, cy, RAIL_TOP + 0.02))
      cap.castShadow = cap.receiveShadow = true
      g.add(cap)
    }
    capGeo.dispose()

    // Felt inlays and sloped marquetry panels, flush with the field.
    for (const f of level.felts ?? []) {
      const m = new THREE.Mesh(panelGeometry(f, level.pocket, POCKET_R + 0.09, 3), this.mats.felt)
      m.position.y = 0.006
      m.receiveShadow = true
      g.add(m)
    }
    for (const sl of level.slopes ?? []) {
      const mat = new THREE.MeshPhysicalMaterial({ map: slopeTexture(sl.w, sl.h, sl.dir), roughness: 0.5, metalness: 0, clearcoat: 0.4, clearcoatRoughness: 0.3, envMapIntensity: 0.6 })
      const m = new THREE.Mesh(panelGeometry(sl, level.pocket, POCKET_R + 0.09), mat)
      m.position.y = 0.004
      m.receiveShadow = true
      g.add(m)
    }

    // Inlaid stringing: a pale line just inside the rails, interrupted where a panel or the pocket meets it.
    const inset = 0.34
    const sw = 0.055
    const zones = [...(level.felts ?? []), ...(level.slopes ?? [])]
    const pr = POCKET_R + 0.25
    const lines: Array<{ along: 'x' | 'y'; at: number; a: number; b: number }> = [
      { along: 'x', at: inset, a: inset, b: w - inset },
      { along: 'x', at: h - inset, a: inset, b: w - inset },
      { along: 'y', at: inset, a: inset, b: h - inset },
      { along: 'y', at: w - inset, a: inset, b: h - inset },
    ]
    for (const ln of lines) {
      const cuts: Array<[number, number]> = []
      for (const z of zones) {
        const [lo, hi, c0, c1] = ln.along === 'x' ? [z.y - z.h / 2, z.y + z.h / 2, z.x - z.w / 2, z.x + z.w / 2] : [z.x - z.w / 2, z.x + z.w / 2, z.y - z.h / 2, z.y + z.h / 2]
        if (ln.at >= lo - 0.1 && ln.at <= hi + 0.1) cuts.push([c0 - 0.12, c1 + 0.12])
      }
      const pc = ln.along === 'x' ? level.pocket.y : level.pocket.x
      const pa = ln.along === 'x' ? level.pocket.x : level.pocket.y
      if (Math.abs(pc - ln.at) < pr) {
        const half = Math.sqrt(pr * pr - (pc - ln.at) ** 2)
        cuts.push([pa - half, pa + half])
      }
      for (const [a, b] of subtract(ln.a, ln.b, cuts)) {
        const len = b - a
        const geo = ln.along === 'x' ? new THREE.PlaneGeometry(len, sw) : new THREE.PlaneGeometry(sw, len)
        geo.rotateX(-Math.PI / 2)
        const m = new THREE.Mesh(geo, fin.stringing)
        m.position.copy(ln.along === 'x' ? w3((a + b) / 2, ln.at, 0.008) : w3(ln.at, (a + b) / 2, 0.008))
        m.receiveShadow = true
        g.add(m)
      }
    }

    // A soft contact shadow where the board sits on the table, under the cast shadow.
    const sw2 = w + RAIL_T * 2 + 2.4
    const sh2 = h + RAIL_T * 2 + 2.4
    const contact = new THREE.Mesh(
      new THREE.PlaneGeometry(sw2, sh2),
      new THREE.MeshBasicMaterial({ color: 0x2a1d12, alphaMap: contactShadowTexture(sh2 / sw2), transparent: true, opacity: 0.55, depthWrite: false }),
    )
    contact.rotation.x = -Math.PI / 2
    contact.position.copy(w3(w / 2, h / 2, -SLAB_D - 0.05))
    contact.renderOrder = -1
    g.add(contact)
    this.contact = contact

    // A small brass maker's plate on the near rail with the piece number.
    g.add(this.makePlaque(level, w))

    // The pocket: dark cup, a brass lip.
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(POCKET_R, POCKET_R * 0.96, CUP_DEPTH, 48, 1, true), this.mats.cup)
    cup.position.copy(w3(level.pocket.x, level.pocket.y, -CUP_DEPTH / 2 + 0.01))
    const floorDisc = new THREE.Mesh(new THREE.CircleGeometry(POCKET_R, 40), new THREE.MeshStandardMaterial({ color: 0x2a1f17, roughness: 0.95 }))
    floorDisc.rotation.x = -Math.PI / 2
    floorDisc.position.copy(w3(level.pocket.x, level.pocket.y, -CUP_DEPTH + 0.02))
    floorDisc.receiveShadow = true
    const rim = new THREE.Mesh(new THREE.TorusGeometry(POCKET_R + 0.03, 0.065, 12, 64), this.rimMat)
    rim.rotation.x = -Math.PI / 2
    rim.position.copy(w3(level.pocket.x, level.pocket.y, -0.015))
    rim.receiveShadow = true
    g.add(cup, floorDisc, rim)

    // Ceramic blocks.
    for (const b of level.blocks ?? []) {
      const geo = new RoundedBoxGeometry(b.w, BLOCK_H + 0.1, b.h, 3, Math.min(0.16, Math.min(b.w, b.h) * 0.3))
      const m = new THREE.Mesh(geo, this.mats.ceramic)
      m.position.copy(w3(b.x, b.y, (BLOCK_H - 0.1) / 2))
      m.rotation.y = ((b.rot ?? 0) * Math.PI) / 180
      m.castShadow = m.receiveShadow = true
      g.add(m)
    }

    // Brass posts: turned profile with a domed cap and a collar.
    for (const p of level.posts ?? []) {
      const r = p.r
      const pts = [
        new THREE.Vector2(0, -0.05),
        new THREE.Vector2(r * 1.08, -0.05),
        new THREE.Vector2(r * 1.08, 0.08),
        new THREE.Vector2(r, 0.12),
        new THREE.Vector2(r, POST_H - 0.22),
        new THREE.Vector2(r * 0.96, POST_H - 0.12),
        new THREE.Vector2(r * 0.8, POST_H - 0.03),
        new THREE.Vector2(r * 0.45, POST_H + 0.02),
        new THREE.Vector2(0, POST_H + 0.03),
      ]
      const m = new THREE.Mesh(new THREE.LatheGeometry(pts, 40), this.mats.brass)
      m.position.copy(w3(p.x, p.y, 0))
      m.castShadow = m.receiveShadow = true
      g.add(m)
    }

    // Brass deflector bars.
    for (const s of level.bars ?? []) {
      const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1)
      const geo = new RoundedBoxGeometry(len + BAR_R * 2, BAR_H, BAR_R * 2, 3, BAR_R * 0.95)
      const m = new THREE.Mesh(geo, this.mats.brass)
      m.position.copy(w3((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2, BAR_H / 2))
      m.rotation.y = Math.atan2(s.y2 - s.y1, s.x2 - s.x1)
      m.castShadow = m.receiveShadow = true
      g.add(m)
      // Small brass feet at each end.
      for (const [x, y] of [
        [s.x1, s.y1],
        [s.x2, s.y2],
      ]) {
        const foot = new THREE.Mesh(new THREE.CylinderGeometry(BAR_R * 1.5, BAR_R * 1.7, 0.12, 20), this.mats.brass)
        foot.position.copy(w3(x, y, 0.04))
        foot.receiveShadow = true
        g.add(foot)
      }
    }

    // Light and shadow camera sized to this board.
    const cx = w / 2
    const cy = h / 2
    this.key.position.copy(w3(cx - 6, cy - 3, 20))
    this.key.target.position.copy(w3(cx, cy, 0))
    const ext = Math.max(w, h) * 0.75 + 3
    const cam = this.key.shadow.camera
    cam.left = -ext
    cam.right = ext
    cam.top = ext
    cam.bottom = -ext
    cam.near = 1
    cam.far = 60
    cam.updateProjectionMatrix()
    this.key.shadow.needsUpdate = true

    this.setGhost(null)
    this.layout()
  }

  private makePlaque(level: LevelDef, w: number): THREE.Mesh {
    // Drawn at 4x the plate's on-screen size so the engraving stays crisp on a phone.
    const c = document.createElement('canvas')
    c.width = 512
    c.height = 128
    const g = c.getContext('2d')!
    const fill = g.createLinearGradient(0, 0, 0, 128)
    fill.addColorStop(0, '#d9b878')
    fill.addColorStop(1, '#b38a4c')
    g.fillStyle = fill
    g.fillRect(0, 0, 512, 128)
    // A fine inset border, like a stamped plate.
    g.strokeStyle = 'rgba(70,50,24,0.55)'
    g.lineWidth = 4
    g.strokeRect(12, 12, 488, 104)
    const label = `No. ${String(level.number).padStart(2, '0')}`
    g.font = '600 78px "IBM Plex Mono", ui-monospace, monospace'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    // Engraved: a light lip below the cut, then the dark cut itself.
    g.fillStyle = 'rgba(255,236,196,0.55)'
    g.fillText(label, 256, 69)
    g.fillStyle = '#2b1f10'
    g.fillText(label, 256, 66)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 8
    // Less mirror-like than the posts, so the engraving reads at any angle.
    const mat = new THREE.MeshStandardMaterial({ map: tex, metalness: 0.55, roughness: 0.5, envMapIntensity: 0.8 })
    const geo = new THREE.PlaneGeometry(2.3, 0.56)
    const m = new THREE.Mesh(geo, mat)
    // On the front face of the near rail, centred.
    m.position.set(w / 2, (RAIL_TOP - SLAB_D) / 2 + 0.05, RAIL_T + 0.005)
    return m
  }

  /** Viewport size in CSS pixels, and the rectangle the board should fill. */
  resize(width: number, height: number, fit: Rect, dpr: number) {
    this.size = { w: width, h: height }
    this.fit = fit
    this.renderer.setPixelRatio(dpr)
    this.renderer.setSize(width, height, false)
    this.layout()
  }

  /** Frame the board inside the fit rectangle with a fixed, gently tilted orthographic view. */
  private layout() {
    if (!this.level) return
    const { w, h } = this.level.size
    const target = w3(w / 2, h / 2, 0)
    const dir = new THREE.Vector3(0, Math.sin(CAMERA_ELEVATION), Math.cos(CAMERA_ELEVATION))
    this.camera.position.copy(target).addScaledVector(dir, 60)
    this.camera.up.set(0, 1, 0)
    this.camera.lookAt(target)
    this.camera.updateMatrixWorld(true)
    const inv = this.camera.matrixWorldInverse
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    const m = RAIL_T + 0.2
    for (const x of [-m, w + m]) {
      for (const y of [-m, h + m]) {
        for (const z of [-SLAB_D, RAIL_TOP]) {
          const p = w3(x, y, z).applyMatrix4(inv)
          minX = Math.min(minX, p.x)
          maxX = Math.max(maxX, p.x)
          minY = Math.min(minY, p.y)
          maxY = Math.max(maxY, p.y)
        }
      }
    }
    const f = this.fit
    const s = Math.max((maxX - minX) / Math.max(1, f.w), (maxY - minY) / Math.max(1, f.h))
    const cxb = (minX + maxX) / 2
    const cyb = (minY + maxY) / 2
    const left = cxb - (f.x + f.w / 2) * s
    const top = cyb + (f.y + f.h / 2) * s
    this.camera.left = left
    this.camera.right = left + this.size.w * s
    this.camera.top = top
    this.camera.bottom = top - this.size.h * s
    this.camera.near = 1
    this.camera.far = 140
    this.camera.updateProjectionMatrix()
  }

  /** World units per CSS pixel at the current framing. */
  unitsPerPixel(): number {
    return (this.camera.right - this.camera.left) / this.size.w
  }

  /** Convert a CSS-pixel point to board coordinates on the playing surface. */
  screenToBoard(px: number, py: number): { x: number; y: number } | null {
    const ndc = new THREE.Vector2((px / this.size.w) * 2 - 1, -(py / this.size.h) * 2 + 1)
    this.raycaster.setFromCamera(ndc, this.camera)
    const hit = new THREE.Vector3()
    this.plane.constant = -BALL_R
    if (!this.raycaster.ray.intersectPlane(this.plane, hit)) return null
    return { x: hit.x, y: -hit.z }
  }

  /** Convert board coordinates (at ball-centre height) to CSS pixels. */
  boardToScreen(x: number, y: number): { x: number; y: number } {
    const p = w3(x, y, BALL_R).project(this.camera)
    return { x: ((p.x + 1) / 2) * this.size.w, y: ((1 - p.y) / 2) * this.size.h }
  }

  /** Place the ball. `drop` lowers it (into the pocket or off the edge); `scale` shrinks it for resets. */
  setBall(x: number, y: number, drop = 0, scale = 1, visible = true) {
    this.ball.visible = visible && scale > 0.001
    this.ball.position.copy(w3(x, y, BALL_R - drop))
    this.ballY = BALL_R - drop
    if (this.introT < 1) this.ball.position.y += this.introLift()
    this.ball.scale.setScalar(Math.max(0.001, scale))
  }

  /** Roll the ball by a board-space displacement (rotation only). */
  rollBall(dx: number, dy: number) {
    const d = Math.hypot(dx, dy)
    if (d < 1e-6) return
    const axis = new THREE.Vector3(-dy, 0, -dx).normalize()
    this.ballQuat.setFromAxisAngle(axis, d / BALL_R)
    this.ball.quaternion.premultiply(this.ballQuat)
  }

  /** Show the aim for a launch angle (degrees) and power, or hide it. */
  setAim(at: { x: number; y: number } | null, angle = 0, power = 0, armed = true) {
    if (!at) {
      this.aim.visible = false
      return
    }
    this.aim.visible = true
    this.aim.position.copy(w3(at.x, at.y, 0.035))
    this.aim.rotation.set(0, (angle * Math.PI) / 180, 0)
    this.arcMat.uniforms.uPower.value = armed ? power : 0
    const length = 1.1 + 4.6 * power
    const spacing = 0.4
    const n = armed ? Math.min(16, Math.max(1, Math.floor(length / spacing))) : 0
    for (let i = 0; i < n; i++) {
      const t = i / Math.max(1, n - 1)
      const r = 0.085 * (1 - t * 0.55)
      this.dummy.position.set(BALL_R + 0.5 + i * spacing, 0, 0)
      this.dummy.scale.setScalar(r)
      this.dummy.updateMatrix()
      this.aimDots.setMatrixAt(i, this.dummy.matrix)
    }
    this.aimDots.count = n
    this.aimDots.instanceMatrix.needsUpdate = true
    const mat = this.aimDots.material as THREE.MeshBasicMaterial
    mat.opacity = armed ? 0.95 : 0.3
  }

  /** Lay a faint dotted trace along a previous shot's path (interleaved x,y frames). */
  setGhost(frames: Float32Array | null, end?: { x: number; y: number } | null) {
    if (!frames || frames.length < 4) {
      this.ghost.count = 0
      this.ghostEndOn = false
      this.ghostEnd.visible = false
      return
    }
    const spacing = 0.36
    let acc = spacing * 0.5
    let n = 0
    const max = 600
    for (let i = 2; i < frames.length && n < max; i += 2) {
      const x0 = frames[i - 2]
      const y0 = frames[i - 1]
      const x1 = frames[i]
      const y1 = frames[i + 1]
      const seg = Math.hypot(x1 - x0, y1 - y0)
      let along = acc
      while (along <= seg && n < max) {
        const t = seg > 0 ? along / seg : 0
        this.dummy.position.copy(w3(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 0.02))
        this.dummy.scale.setScalar(0.075)
        this.dummy.updateMatrix()
        this.ghost.setMatrixAt(n++, this.dummy.matrix)
        along += spacing
      }
      acc = along - seg
    }
    this.ghost.count = n
    this.ghost.instanceMatrix.needsUpdate = true
    this.ghostEndOn = !!end
    if (end) this.ghostEnd.position.copy(w3(end.x, end.y, 0.02))
    this.ghostEnd.visible = this.ghostOn && this.ghostEndOn
  }

  setGhostVisible(v: boolean) {
    this.ghostOn = v
    this.ghost.visible = v
    this.ghostEnd.visible = v && this.ghostEndOn
  }

  /** Brightness of the pocket rim's glint (0..1). */
  setRimGlow(v: number) {
    this.rimMat.emissiveIntensity = v * 0.55
  }

  render() {
    const now = performance.now()
    const dt = Math.min(0.05, (now - this.clock) / 1000)
    this.clock = now
    this.animate(dt)
    if (this.lost) return
    this.renderer.render(this.scene, this.camera)
  }
}
