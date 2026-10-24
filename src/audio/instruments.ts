import * as Tone from 'tone'
import { createMixBus } from './mixer'
import type { Track } from './types'

/** One independently mixed instrument rack per track. */
export interface TrackInstrument {
  readonly type: Track['type']
  setMix(track: Track): void
  playStep(track: Track, step: number, time: number, stepSeconds: number): void
  chokeOpenHat?(time: number): void
  dispose(): void
}

export function createTrackInstrument(context: Tone.Context, destination: Tone.Gain, track: Track): TrackInstrument {
  const bus = createMixBus(context, destination, track)
  const output = bus.input
  const setMix = (next: Track) => bus.setMix(next)

  if (track.type === 'drums') {
    const kick = new Tone.MembraneSynth({
      context, pitchDecay: 0.035, octaves: 7,
      envelope: { attack: 0.001, decay: 0.25, sustain: 0, release: 0.08 },
    }).connect(output)
    const snare = new Tone.NoiseSynth({
      context, volume: -7, noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.15, sustain: 0, release: 0.04 },
    }).connect(output)
    const clap = new Tone.NoiseSynth({
      context, volume: -10, noise: { type: 'pink' },
      envelope: { attack: 0.001, decay: 0.09, sustain: 0, release: 0.04 },
    }).connect(output)
    const closedHat = new Tone.MetalSynth({
      context, volume: -19, resonance: 5000, harmonicity: 5.1, modulationIndex: 32,
      envelope: { attack: 0.001, decay: 0.035, sustain: 0, release: 0.015 },
    }).connect(output)
    const openHat = new Tone.MetalSynth({
      context, volume: -22, resonance: 4500, harmonicity: 5.1, modulationIndex: 32,
      envelope: { attack: 0.001, decay: 0.32, sustain: 0, release: 0.1 },
    }).connect(output)
    return {
      type: track.type,
      setMix,
      chokeOpenHat(time) { openHat.triggerRelease(time) },
      playStep(next, step, time) {
        if (next.type !== 'drums' || next.muted) return
        // Open first: a closed hat at the same step chokes the open hat.
        const voices = ['openHat', 'kick', 'snare', 'clap', 'closedHat'] as const
        for (const voice of voices) {
          const hit = next.pattern[voice]?.find((entry) => entry.step === step)
          const velocity = hit?.velocity ?? 0.8
          if (!hit || velocity === 0) continue
          if (voice === 'kick') kick.triggerAttackRelease('C1', 0.08, time, velocity)
          if (voice === 'snare') snare.triggerAttackRelease(0.06, time, velocity)
          if (voice === 'clap') {
            for (let burst = 0; burst < 3; burst++) clap.triggerAttackRelease(0.008, time + burst * 0.012, velocity)
          }
          if (voice === 'openHat') openHat.triggerAttackRelease(280, 0.25, time, velocity)
          if (voice === 'closedHat') {
            openHat.triggerRelease(time)
            closedHat.triggerAttackRelease(320, 0.025, time, velocity)
          }
        }
      },
      dispose() {
        kick.dispose()
        snare.dispose()
        clap.dispose()
        closedHat.dispose()
        openHat.dispose()
        bus.dispose()
      },
    }
  }

  const options = {
    bass: {
      oscillator: { type: 'triangle' as const },
      envelope: { attack: 0.005, decay: 0.12, sustain: 0.5, release: 0.08 },
    },
    melody: {
      oscillator: { type: 'triangle' as const },
      envelope: { attack: 0.008, decay: 0.12, sustain: 0.25, release: 0.12 },
    },
    chords: {
      oscillator: { type: 'sine' as const },
      envelope: { attack: 0.04, decay: 0.2, sustain: 0.55, release: 0.2 },
    },
  }
  // Polyphony lets long notes overlap without an old note-off cutting a new one.
  const synth = new Tone.PolySynth({ context, voice: Tone.Synth, maxPolyphony: 32, options: options[track.type] }).connect(output)
  return {
    type: track.type,
    setMix,
    playStep(next, step, time, stepSeconds) {
      if (next.type === 'drums' || next.muted) return
      const entry = next.steps.find((item) => item.step === step)
      for (const note of entry?.notes ?? []) {
        if (note.velocity === 0) continue
        synth.triggerAttackRelease(note.pitch, note.durationSteps * stepSeconds, time, note.velocity ?? 0.8)
      }
    },
    dispose() {
      // Disposing prevents delayed PolySynth note-offs from affecting a later run.
      synth.dispose()
      bus.dispose()
    },
  }
}
