/**
 * Physical constants for the planar simulation.
 *
 * Units are "workshop units": the ball is 1.2 across, a typical board is
 * 12 × 20. Time is in seconds. Every number that shapes how the ball feels
 * lives here, so tuning never touches the solver.
 */

export type Material = 'wood' | 'ceramic' | 'brass'

/** Fixed simulation step: 240 Hz, independent of the display. */
export const DT = 1 / 240
/** Record one playback frame every N steps (120 Hz playback data). */
export const FRAME_EVERY = 2
/** A shot that is still rolling after this long is treated as at rest. */
export const MAX_TIME = 24

export const BALL_R = 0.6
export const POCKET_R = 1.05

/** Launch speed at full power. Power maps to speed as vmax·sqrt(p), so roll distance is ~linear in power. */
export const MAX_SPEED = 22
/** Pulls shorter than this (as a power fraction) cancel the shot. */
export const MIN_POWER = 0.04

/** Rolling resistance: constant deceleration plus a small speed-proportional term. */
export const ROLL_DECEL = 2.9
export const LINEAR_DAMP = 0.12
/** Below this speed the ball has stopped. */
export const STOP_SPEED = 0.05

/** Felt panels: extra constant deceleration and speed-proportional drag while the ball is on baize. */
export const FELT_DECEL = 6.5
export const FELT_DAMP = 0.55
/** Slope panels: downhill acceleration while the ball's centre is over one. */
export const SLOPE_ACCEL = 6.5

/** Pocket: a ball whose centre is over the hole is pulled toward it (it tilts in). */
export const POCKET_PULL = 34
/** Extra drag while the ball is over the hole (it loses support and scrubs the rim). */
export const POCKET_DRAG = 9
/** Captured when the centre is this far inside the rim and slower than CAPTURE_SPEED. */
export const CAPTURE_INSET = 0.22
export const CAPTURE_SPEED = 7.5

export interface MaterialResponse {
  /** Normal restitution. */
  restitution: number
  /** Fraction of tangential speed kept through a contact. */
  grip: number
}

export const MATERIALS: Record<Material, MaterialResponse> = {
  wood: { restitution: 0.7, grip: 0.95 },
  ceramic: { restitution: 0.76, grip: 0.96 },
  brass: { restitution: 0.86, grip: 0.98 },
}

/**
 * "Dead Center" mastery: a sunk ball whose last line over the rim passed within this distance of the
 * pocket's centre (a quarter of its radius). Every piece has at least one such shot (tests/levels.test.ts).
 */
export const DEAD_CENTER_OFFSET = 0.25

/** Contacts gentler than this are not reported as impacts (resting or sliding contact). */
export const IMPACT_THRESHOLD = 0.35

/** Rail (perimeter) thickness and deflector bar half-thickness, for physics and rendering alike. */
export const RAIL_T = 0.9
export const BAR_R = 0.17
