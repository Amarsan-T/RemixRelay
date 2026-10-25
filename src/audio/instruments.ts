import * as Tone from 'tone'
import { createMixBus } from './mixer'
import { createSound, type SoundVoice } from './sounds'
import { ScheduledSynth } from './ScheduledSynth'
import { DRUM_VOICES } from './types'
import type { DrumVoice, Track } from './types'

/** One independently mixed instrument rack per track. */
export interface TrackInstrument {
  readonly type: Track['type']
  /** Sound preset this rack was built with; the engine rebuilds the rack when it changes. */
  readonly sound?: string
  setMix(track: Track): void
  playStep(track: Track, step: number, time: number, stepSeconds: number): void
  chokeOpenHat?(time: number): void
  prepare?(track: Track, loopSteps: number): void
  preparePreview?(): void
  getVoiceStats?(): { allocated: number; dropped: number }
  dispose(): void
}

export function createTrackInstrument(context: Tone.Context, destination: Tone.Gain, track: Track): TrackInstrument {
  const bus = createMixBus(context, destination, track)
  const output = bus.input
  const setMix = (next: Track) => bus.setMix(next)

  if (track.type === 'drums') {
    // Each drum is built the first time the track needs it. A studio channel
    // plays just one drum, and building all five (two of them heavy metallic
    // hats) for every channel on every Play froze the page for up to a second.
    const build = {
      kick: () => new Tone.MembraneSynth({
        context, pitchDecay: 0.035, octaves: 7,
        envelope: { attack: 0.001, decay: 0.25, sustain: 0, release: 0.08 },
      }),
      snare: () => new Tone.NoiseSynth({
        context, volume: -7, noise: { type: 'white' },
        envelope: { attack: 0.001, decay: 0.15, sustain: 0, release: 0.04 },
      }),
      clap: () => new Tone.NoiseSynth({
        context, volume: -10, noise: { type: 'pink' },
        envelope: { attack: 0.001, decay: 0.09, sustain: 0, release: 0.04 },
      }),
      closedHat: () => new Tone.MetalSynth({
        context, volume: -19, resonance: 5000, harmonicity: 5.1, modulationIndex: 32,
        envelope: { attack: 0.001, decay: 0.035, sustain: 0, release: 0.015 },
      }),
      openHat: () => new Tone.MetalSynth({
        context, volume: -22, resonance: 4500, harmonicity: 5.1, modulationIndex: 32,
        envelope: { attack: 0.001, decay: 0.32, sustain: 0, release: 0.1 },
      }),
    }
    type Drums = { [V in DrumVoice]: ReturnType<(typeof build)[V]> }
    const built: Partial<Drums> = {}
    const drum = <V extends DrumVoice>(voice: V): Drums[V] =>
      (built[voice] ??= build[voice]().connect(output) as Drums[V]) as Drums[V]
    // Build what the pattern already uses now, so the first beat doesn't build mid-playback.
    for (const voice of DRUM_VOICES) if (track.pattern[voice]?.length) drum(voice)
    // Choking an open hat that was never built is a no-op.
    const chokeOpenHat = (time: number) => { built.openHat?.triggerRelease(time) }

    return {
      type: track.type,
      setMix,
      chokeOpenHat,
      prepare(next) {
        if (next.type === 'drums') for (const voice of DRUM_VOICES) if (next.pattern[voice]?.some((hit) => hit.velocity !== 0)) drum(voice)
      },
      playStep(next, step, time) {
        if (next.type !== 'drums' || next.muted) return
        // Open first: a closed hat at the same step chokes the open hat.
        const voices = ['openHat', 'kick', 'snare', 'clap', 'closedHat'] as const
        for (const voice of voices) {
          const hit = next.pattern[voice]?.find((entry) => entry.step === step)
          const velocity = hit?.velocity ?? 0.8
          if (!hit || velocity === 0) continue
          if (voice === 'kick') drum('kick').triggerAttackRelease('C1', 0.08, time, velocity)
          if (voice === 'snare') drum('snare').triggerAttackRelease(0.06, time, velocity)
          if (voice === 'clap') {
            for (let burst = 0; burst < 3; burst++) drum('clap').triggerAttackRelease(0.008, time + burst * 0.012, velocity)
          }
          if (voice === 'openHat') drum('openHat').triggerAttackRelease(280, 0.25, time, velocity)
          if (voice === 'closedHat') {
            chokeOpenHat(time)
            drum('closedHat').triggerAttackRelease(320, 0.025, time, velocity)
          }
        }
      },
      dispose() {
        Object.values(built).forEach((synth) => synth.dispose())
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
  // A chosen preset (piano, pad...) replaces the default synth for this track.
  const preset = track.sound ? createSound(track.sound, context, output) : null
  // Polyphony lets long notes overlap without an old note-off cutting a new one.
  const fallback = preset ? null : new ScheduledSynth(context,
    () => new Tone.Synth({ context, ...options[track.type] }), options[track.type].envelope.release).connect(output)
  const synth: SoundVoice = preset?.voice ?? fallback!
  return {
    type: track.type,
    sound: track.sound,
    setMix,
    prepare(next, loopSteps) { if (next.type !== 'drums') synth.prepare?.(next, loopSteps) },
    preparePreview() { synth.preparePreview?.() },
    getVoiceStats() { return synth.getVoiceStats?.() ?? { allocated: 0, dropped: 0 } },
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
      preset?.dispose()
      fallback?.dispose()
      bus.dispose()
    },
  }
}
