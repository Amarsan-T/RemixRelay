import * as Tone from 'tone'
import type { MixSettings } from './types'

/** Below this level the output guard passes audio through unchanged. */
export const GUARD_KNEE = 0.8
/** The guard's output never reaches this, however loud its input. */
export const GUARD_CEILING = 0.98
/** Input levels up to this follow the guard's curve; anything louder sits at the ceiling. */
const GUARD_RANGE = 4

/**
 * The output guard's curve: unchanged up to the knee, then rounding off
 * smoothly toward the ceiling, with no corner at the knee.
 */
export function softClip(sample: number): number {
  const level = Math.abs(sample)
  if (level <= GUARD_KNEE) return sample
  const room = GUARD_CEILING - GUARD_KNEE
  return Math.sign(sample) * (GUARD_KNEE + room * Math.tanh((level - GUARD_KNEE) / room))
}

/**
 * The last stage before the speakers. The limiter doesn't catch every peak:
 * with the mixer faders up, the output reached 1.37 and hundreds of samples
 * clipped (heard as crackle). The guard rounds those peaks off and leaves
 * normal levels untouched.
 */
export function createOutputGuard(context: Tone.Context) {
  // A WaveShaper only reads inputs from -1 to 1, so scale down first and back up after.
  // Both scalings are powers of two, which keeps the untouched range exact.
  const input = new Tone.Gain({ context, gain: 1 / GUARD_RANGE })
  const shaper = new Tone.WaveShaper({ context, length: 8192, mapping: (value) => softClip(value * GUARD_RANGE) / GUARD_RANGE })
  const output = new Tone.Gain({ context, gain: GUARD_RANGE })
  input.chain(shaper, output)
  return {
    input,
    output,
    dispose() {
      input.dispose()
      shaper.dispose()
      output.dispose()
    },
  }
}

/** A Tone-only signal chain shared by track racks and the master bus. */
export function createMixBus(context: Tone.Context, destination: Tone.ToneAudioNode, initial: MixSettings) {
  const input = new Tone.Gain({ context, gain: 1 })
  const distortion = new Tone.Distortion({ context, distortion: 0, wet: 0, oversample: '2x' })
  const filter = new Tone.Filter({ context, type: 'lowpass', frequency: 20000, Q: 0.5 })
  const delay = new Tone.FeedbackDelay({ context, delayTime: 0.25, maxDelay: 1, feedback: 0, wet: 0 })
  const pan = new Tone.Panner({ context, pan: 0 })
  // Gain follows the effects so muting also silences delay tails.
  const output = new Tone.Gain({ context, gain: 0 })
  input.chain(distortion, filter, delay, pan, output, destination)
  let previous: string | null = null
  const setMix = (settings: MixSettings) => {
    const key = JSON.stringify(settings)
    if (key === previous) return
    previous = key
    const now = context.immediate()
    output.gain.rampTo(settings.muted ? 0 : Tone.dbToGain(settings.volumeDb ?? 0), 0.005, now)
    pan.pan.rampTo(settings.pan ?? 0, 0.01, now)
    filter.frequency.rampTo(settings.effects?.filterHz ?? 20000, 0.01, now)
    const amount = settings.effects?.distortion ?? 0
    if (distortion.distortion !== amount) distortion.distortion = amount
    distortion.wet.rampTo(amount === 0 ? 0 : 1, 0.01, now)
    const send = settings.effects?.delay ?? 0
    delay.wet.rampTo(send, 0.01, now)
    delay.feedback.rampTo(send * 0.7, 0.01, now)
  }
  setMix(initial)
  return {
    input,
    output,
    setMix,
    dispose() {
      input.dispose()
      distortion.dispose()
      filter.dispose()
      delay.dispose()
      pan.dispose()
      output.dispose()
    },
  }
}
