import { BAR_R, BALL_R, POCKET_R, RAIL_T } from '../physics/constants'
import { buildRails } from '../physics/world'
import type { LevelDef } from '../levels/types'

/**
 * A small top-down plan of a piece, drawn like an architect's sheet: walnut
 * board, ivory blocks, brass posts and the pocket. Used on the Collection.
 */
export function planSVG(level: LevelDef): string {
  const { w, h } = level.size
  const m = RAIL_T + 0.6
  const vw = w + m * 2
  const vh = h + m * 2
  // Board space has +y away from the player; SVG y runs down, so flip.
  const X = (x: number) => +(x + m).toFixed(3)
  const Y = (y: number) => +(h - y + m).toFixed(3)
  const parts: string[] = []
  parts.push(`<rect x="${X(0)}" y="${Y(h)}" width="${w}" height="${h}" rx="0.25" fill="#8a6246"/>`)
  // Surfaces first, under everything: baize panels, then sloped panels with chevrons pointing downhill.
  for (const f of level.felts ?? []) {
    parts.push(`<rect x="${X(f.x - f.w / 2)}" y="${Y(f.y + f.h / 2)}" width="${f.w}" height="${f.h}" rx="0.12" fill="#3d5a48"/>`)
  }
  for (const s of level.slopes ?? []) {
    parts.push(`<rect x="${X(s.x - s.w / 2)}" y="${Y(s.y + s.h / 2)}" width="${s.w}" height="${s.h}" rx="0.12" fill="#b48a5a"/>`)
    const a = (s.dir * Math.PI) / 180
    const ux = Math.cos(a)
    const uy = Math.sin(a)
    const k = 0.45
    const step = 1.4
    const half = Math.max(s.w, s.h) / 2
    for (let t = -half + step / 2; t < half; t += step) {
      for (let q = -half + step / 2; q < half; q += step) {
        // Chevron centre, laid out along (downhill, across) and kept inside the panel.
        const cx = s.x + ux * t - uy * q
        const cy = s.y + uy * t + ux * q
        if (Math.abs(cx - s.x) > s.w / 2 - 0.45 || Math.abs(cy - s.y) > s.h / 2 - 0.45) continue
        const tip = [cx + ux * k * 0.5, cy + uy * k * 0.5]
        const l = [cx - ux * k * 0.5 - uy * k * 0.6, cy - uy * k * 0.5 + ux * k * 0.6]
        const r = [cx - ux * k * 0.5 + uy * k * 0.6, cy - uy * k * 0.5 - ux * k * 0.6]
        parts.push(`<polyline points="${X(l[0])},${Y(l[1])} ${X(tip[0])},${Y(tip[1])} ${X(r[0])},${Y(r[1])}" fill="none" stroke="#7a5532" stroke-width="0.12" stroke-linecap="round" stroke-linejoin="round"/>`)
      }
    }
  }
  for (const r of buildRails(level)) {
    parts.push(`<rect x="${X(r.cx - r.hx)}" y="${Y(r.cy + r.hy)}" width="${r.hx * 2}" height="${r.hy * 2}" rx="0.3" fill="#5f402b"/>`)
  }
  for (const b of level.blocks ?? []) {
    parts.push(
      `<rect x="${X(b.x - b.w / 2)}" y="${Y(b.y + b.h / 2)}" width="${b.w}" height="${b.h}" rx="0.18" fill="#efe8db" stroke="#c9bfae" stroke-width="0.08" transform="rotate(${-(b.rot ?? 0)} ${X(b.x)} ${Y(b.y)})"/>`,
    )
  }
  for (const s of level.bars ?? []) {
    parts.push(`<line x1="${X(s.x1)}" y1="${Y(s.y1)}" x2="${X(s.x2)}" y2="${Y(s.y2)}" stroke="#c7a466" stroke-width="${BAR_R * 2}" stroke-linecap="round"/>`)
  }
  for (const p of level.posts ?? []) {
    parts.push(`<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${p.r}" fill="#c7a466" stroke="#8c6d38" stroke-width="0.1"/>`)
  }
  parts.push(`<circle cx="${X(level.pocket.x)}" cy="${Y(level.pocket.y)}" r="${POCKET_R + 0.08}" fill="#c7a466"/>`)
  parts.push(`<circle cx="${X(level.pocket.x)}" cy="${Y(level.pocket.y)}" r="${POCKET_R - 0.06}" fill="#241a13"/>`)
  parts.push(`<circle cx="${X(level.ball.x)}" cy="${Y(level.ball.y)}" r="${BALL_R}" fill="#d5dbdd" stroke="#7f898d" stroke-width="0.1"/>`)
  return `<svg viewBox="0 0 ${vw.toFixed(2)} ${vh.toFixed(2)}" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">${parts.join('')}</svg>`
}
