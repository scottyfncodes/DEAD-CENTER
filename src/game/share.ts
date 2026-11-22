import type { Shot } from '../levels/types'
import { isLaunchable } from '../physics/sim'
import { wrapDeg } from './aim'

/** Parse a shared shot ("angle,power") from a link; null when malformed or out of range. */
export function parseShot(text: string | null): Shot | null {
  if (!text) return null
  const m = /^(-?\d{1,3}(?:\.\d{1,4})?),(0?\.\d{1,4}|1(?:\.0{1,4})?)$/.exec(text.trim())
  if (!m) return null
  // Rounded as a launch rounds, so a shared shot replays bit for bit.
  const shot = { angle: +wrapDeg(Number(m[1])).toFixed(3), power: +Number(m[2]).toFixed(4) }
  return isLaunchable(shot) ? shot : null
}
