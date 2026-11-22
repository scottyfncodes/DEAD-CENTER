import type { ShotResult } from '../physics/sim'
import { POCKET_R } from '../physics/constants'

/**
 * The game's voice: calm, observant, dry, and used sparingly. Most shots get
 * no words at all.
 */

export function onStart(isFirstEver: boolean): string | null {
  return isFirstEver ? 'Give it a go.' : null
}

/** For a returning player who finished the original twelve before the Collection grew. */
export function onNewPieces(count: number): string {
  const words = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen', 'Twenty', 'Twenty-one', 'Twenty-two', 'Twenty-three', 'Twenty-four']
  return `${words[count] ?? count} new pieces.`
}

export function onMiss(result: ShotResult, attempt: number, power: number): string | null {
  if (result.closest < POCKET_R + 0.55) return 'Nearly.'
  if (result.outcome === 'fell' && power > 0.85) return 'A bit ambitious.'
  if (result.contacts >= 7 && result.closest > POCKET_R + 4) return 'A bit ambitious.'
  if (attempt === 6 || attempt === 15) return 'You’ll find it.'
  return null
}

export function onSink(attempt: number, firstTime: boolean, newBest: boolean): string {
  if (attempt === 1) return 'Well, look at that.'
  if (newBest) return 'Neater than last time.'
  if (firstTime && attempt >= 12) return 'Worth the wait.'
  return 'There it is.'
}
