import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { BALL_R, BAR_R, POCKET_R, RAIL_T } from '../physics/constants'
import { buildRails } from '../physics/world'
import type { LevelDef } from '../levels/types'
import { brushedTexture, dotTexture, walnutTexture } from './textures'

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
  cup: 0x1f1712,
}

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
  }
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

    const walnut = walnutTexture(512)
    const railWood = walnutTexture(512, [92, 60, 40])
    const brushed = brushedTexture()
    this.mats = {
      walnut: new THREE.MeshStandardMaterial({ map: walnut, roughness: 0.58, metalness: 0, envMapIntensity: 0.55 }),
      rail: new THREE.MeshStandardMaterial({ map: railWood, roughness: 0.5, metalness: 0, envMapIntensity: 0.6 }),
      ceramic: new THREE.MeshStandardMaterial({ color: PALETTE.ceramic, roughness: 0.62, metalness: 0, envMapIntensity: 0.5 }),
      brass: new THREE.MeshStandardMaterial({ color: PALETTE.brass, roughness: 0.34, metalness: 1, roughnessMap: brushed, envMapIntensity: 1.1 }),
      cup: new THREE.MeshStandardMaterial({ color: PALETTE.cup, roughness: 0.9, metalness: 0, side: THREE.BackSide }),
    }
    this.rimMat = this.mats.brass.clone()
    this.rimMat.emissive = new THREE.Color(0xf2d39a)
    this.rimMat.emissiveIntensity = 0

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
      new THREE.MeshStandardMaterial({ color: PALETTE.steel, metalness: 1, roughness: 0.09, envMapIntensity: 1.25 }),
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
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    const room = new RoomEnvironment()
    const rt = pmrem.fromScene(room, 0.035)
    this.env?.dispose()
    this.env = rt.texture
    this.scene.environment = this.env
    this.scene.environmentIntensity = 0.75
    room.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh) {
        m.geometry.dispose()
        ;(m.material as THREE.Material).dispose()
      }
    })
    pmrem.dispose()
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
          if (!Object.values(this.mats).includes(mat as THREE.MeshStandardMaterial) && mat !== this.rimMat) {
            ;(mat as THREE.MeshStandardMaterial).map?.dispose()
            mat.dispose()
          }
        }
      })
    }
    const { w, h } = level.size
    const g = this.board

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
      const geo = new RoundedBoxGeometry(r.hx * 2, RAIL_TOP + SLAB_D, r.hy * 2, 3, 0.16)
      geo.translate(r.cx, (RAIL_TOP - SLAB_D) / 2, -r.cy)
      planarUV(geo, r.side === 'near' || r.side === 'far' ? 'x' : 'z')
      const m = new THREE.Mesh(geo, this.mats.rail)
      m.castShadow = m.receiveShadow = true
      g.add(m)
    }

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
    const c = document.createElement('canvas')
    c.width = 256
    c.height = 64
    const g = c.getContext('2d')!
    g.fillStyle = '#c29d5f'
    g.fillRect(0, 0, 256, 64)
    g.fillStyle = 'rgba(48,38,24,0.85)'
    g.font = '500 40px "IBM Plex Mono", ui-monospace, monospace'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(`No. ${String(level.number).padStart(2, '0')}`, 128, 34)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 4
    const mat = new THREE.MeshStandardMaterial({ map: tex, metalness: 0.85, roughness: 0.4, envMapIntensity: 1 })
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
    if (this.lost) return
    this.renderer.render(this.scene, this.camera)
  }
}
