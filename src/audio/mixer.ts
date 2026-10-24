import * as Tone from 'tone'
import type { MixSettings } from './types'

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
