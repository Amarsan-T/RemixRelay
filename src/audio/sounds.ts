import * as Tone from 'tone'

/** Anything that can play a note; PolySynth and Sampler both fit. */
export interface SoundVoice {
  triggerAttackRelease(note: string, duration: number, time: number, velocity?: number): unknown
}

export interface Sound {
  voice: SoundVoice
  dispose(): void
}

// The RemixRelay instrument presets, built in the engine's own audio context
// and wired into a track's mixer input. Volumes are set so each sits at about
// the same loudness as the default studio synth.

/** Connects voice -> effects -> output and returns a dispose for all of them. */
function chain(voice: Tone.ToneAudioNode & SoundVoice, effects: Tone.ToneAudioNode[], output: Tone.ToneAudioNode): Sound {
  voice.chain(...effects, output)
  return {
    voice,
    dispose: () => {
      voice.dispose()
      effects.forEach((e) => e.dispose())
    },
  }
}

const PIANO_SAMPLES = Object.fromEntries(
  ['A0', 'C1', 'D#1', 'F#1', 'A1', 'C2', 'D#2', 'F#2', 'A2', 'C3', 'D#3', 'F#3', 'A3', 'C4', 'D#4', 'F#4',
    'A4', 'C5', 'D#5', 'F#5', 'A5', 'C6', 'D#6', 'F#6', 'A6', 'C7'].map((note) => [note, `${note.replace('#', 's')}.mp3`]),
)

/** Builds a preset by id, or returns null for an unknown id (the caller falls back to the default synth). */
export function createSound(id: string, context: Tone.Context, output: Tone.ToneAudioNode): Sound | null {
  switch (id) {
    case 'grand-piano':
      return chain(
        new Tone.Sampler({
          context, urls: PIANO_SAMPLES, release: 1, volume: 9,
          baseUrl: 'https://tonejs.github.io/audio/salamander/',
        }),
        [new Tone.Reverb({ context, decay: 2, wet: 0.2 })],
        output,
      )
    case 'synth-lead':
      return chain(
        new Tone.PolySynth({
          context, voice: Tone.Synth, maxPolyphony: 32, volume: -1,
          options: {
            oscillator: { type: 'fatsawtooth', count: 3, spread: 20 } as Tone.OmniOscillatorOptions,
            envelope: { attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.3 },
          },
        }),
        [
          new Tone.Filter({ context, frequency: 3200, type: 'lowpass' }),
          new Tone.FeedbackDelay({ context, delayTime: 0.28, feedback: 0.25, wet: 0.2 }),
        ],
        output,
      )
    case 'deep-bass':
      return chain(
        new Tone.PolySynth({
          context, voice: Tone.MonoSynth, maxPolyphony: 16, volume: -2,
          options: {
            oscillator: { type: 'square' },
            filter: { Q: 2, type: 'lowpass', rolloff: -24 },
            envelope: { attack: 0.005, decay: 0.2, sustain: 0.6, release: 0.2 },
            filterEnvelope: { attack: 0.005, decay: 0.15, sustain: 0.3, release: 0.2, baseFrequency: 80, octaves: 3.5 },
          },
        }),
        [],
        output,
      )
    case 'warm-pad':
      return chain(
        new Tone.PolySynth({
          context, voice: Tone.AMSynth, maxPolyphony: 32, volume: 5,
          options: { harmonicity: 1.5, envelope: { attack: 0.4, decay: 0.3, sustain: 0.8, release: 1.5 } },
        }),
        [
          new Tone.Chorus({ context, frequency: 2, delayTime: 2.5, depth: 0.5 }).start(),
          new Tone.Reverb({ context, decay: 5, wet: 0.45 }),
        ],
        output,
      )
    case 'pluck':
      return chain(
        new Tone.PolySynth({
          context, voice: Tone.FMSynth, maxPolyphony: 32, volume: 8,
          options: {
            harmonicity: 3, modulationIndex: 10,
            envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.4 },
            modulationEnvelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.2 },
          },
        }),
        [new Tone.Reverb({ context, decay: 1.5, wet: 0.25 })],
        output,
      )
    case 'chiptune':
      return chain(
        new Tone.PolySynth({
          context, voice: Tone.Synth, maxPolyphony: 32, volume: -9,
          options: {
            oscillator: { type: 'pulse', width: 0.25 } as Tone.OmniOscillatorOptions,
            envelope: { attack: 0.001, decay: 0.1, sustain: 0.4, release: 0.05 },
          },
        }),
        [],
        output,
      )
    default:
      return null
  }
}
