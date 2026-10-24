import * as Tone from 'tone'
import { newNoteId, type Note, type Pattern } from './types'

// ---------------------------------------------------------------------------
// Instrument presets: the sound the piano roll plays through.
// ---------------------------------------------------------------------------

/** The bits of a Tone.js instrument the engine needs (PolySynth and Sampler both fit). */
export interface Voice {
  triggerAttackRelease(
    note: Tone.Unit.Frequency,
    duration: Tone.Unit.Time,
    time?: Tone.Unit.Time,
    velocity?: number,
  ): unknown
  releaseAll(time?: Tone.Unit.Time): unknown
}

export type BuiltInstrument = {
  voice: Voice
  /** Disposes the voice and its effect chain. */
  dispose: () => void
}

export type InstrumentPreset = {
  id: string
  name: string
  description: string
  /** Note color in the piano roll. */
  color: string
  create: () => BuiltInstrument
}

/** Connects a voice through effects to the speakers and returns a matching dispose. */
function chain(
  voice: Tone.ToneAudioNode & Voice,
  ...effects: Tone.ToneAudioNode[]
): BuiltInstrument {
  voice.chain(...effects, Tone.getDestination())
  return {
    voice,
    dispose: () => {
      voice.dispose()
      effects.forEach((e) => e.dispose())
    },
  }
}

export const INSTRUMENT_PRESETS: InstrumentPreset[] = [
  {
    id: 'grand-piano',
    name: 'Grand Piano',
    description: 'Sampled acoustic piano',
    color: '#60a5fa',
    create: () =>
      chain(
        new Tone.Sampler({
          urls: {
            A0: 'A0.mp3', C1: 'C1.mp3', 'D#1': 'Ds1.mp3', 'F#1': 'Fs1.mp3',
            A1: 'A1.mp3', C2: 'C2.mp3', 'D#2': 'Ds2.mp3', 'F#2': 'Fs2.mp3',
            A2: 'A2.mp3', C3: 'C3.mp3', 'D#3': 'Ds3.mp3', 'F#3': 'Fs3.mp3',
            A3: 'A3.mp3', C4: 'C4.mp3', 'D#4': 'Ds4.mp3', 'F#4': 'Fs4.mp3',
            A4: 'A4.mp3', C5: 'C5.mp3', 'D#5': 'Ds5.mp3', 'F#5': 'Fs5.mp3',
            A5: 'A5.mp3', C6: 'C6.mp3', 'D#6': 'Ds6.mp3', 'F#6': 'Fs6.mp3',
            A6: 'A6.mp3', C7: 'C7.mp3',
          },
          release: 1,
          baseUrl: 'https://tonejs.github.io/audio/salamander/',
        }),
        new Tone.Reverb({ decay: 2, wet: 0.2 }),
      ),
  },
  {
    id: 'synth-lead',
    name: 'Synth Lead',
    description: 'Bright saw lead with delay',
    color: '#f472b6',
    create: () =>
      chain(
        new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'fatsawtooth', count: 3, spread: 20 },
          envelope: { attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.3 },
          volume: -12,
        }),
        new Tone.Filter(3200, 'lowpass'),
        new Tone.FeedbackDelay({ delayTime: '8n.', feedback: 0.25, wet: 0.2 }),
      ),
  },
  {
    id: 'deep-bass',
    name: 'Deep Bass',
    description: 'Punchy filtered mono-style bass',
    color: '#f59e0b',
    create: () =>
      chain(
        new Tone.PolySynth(Tone.MonoSynth, {
          oscillator: { type: 'square' },
          filter: { Q: 2, type: 'lowpass', rolloff: -24 },
          envelope: { attack: 0.005, decay: 0.2, sustain: 0.6, release: 0.2 },
          filterEnvelope: {
            attack: 0.005, decay: 0.15, sustain: 0.3, release: 0.2,
            baseFrequency: 80, octaves: 3.5,
          },
          volume: -8,
        }),
      ),
  },
  {
    id: 'warm-pad',
    name: 'Warm Pad',
    description: 'Slow, airy chords',
    color: '#a78bfa',
    create: () =>
      chain(
        new Tone.PolySynth(Tone.AMSynth, {
          harmonicity: 1.5,
          envelope: { attack: 0.4, decay: 0.3, sustain: 0.8, release: 1.5 },
          volume: -10,
        }),
        new Tone.Chorus(2, 2.5, 0.5).start(),
        new Tone.Reverb({ decay: 5, wet: 0.45 }),
      ),
  },
  {
    id: 'pluck',
    name: 'Pluck',
    description: 'Glassy FM pluck for arps',
    color: '#34d399',
    create: () =>
      chain(
        new Tone.PolySynth(Tone.FMSynth, {
          harmonicity: 3,
          modulationIndex: 10,
          envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.4 },
          modulationEnvelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.2 },
          volume: -10,
        }),
        new Tone.Reverb({ decay: 1.5, wet: 0.25 }),
      ),
  },
  {
    id: 'chiptune',
    name: 'Chiptune',
    description: '8-bit square wave',
    color: '#facc15',
    create: () =>
      chain(
        new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'pulse', width: 0.25 } as Tone.OmniOscillatorOptions,
          envelope: { attack: 0.001, decay: 0.1, sustain: 0.4, release: 0.05 },
          volume: -16,
        }),
      ),
  },
]

export function getInstrumentPreset(id: string): InstrumentPreset {
  return INSTRUMENT_PRESETS.find((p) => p.id === id) ?? INSTRUMENT_PRESETS[0]
}

// ---------------------------------------------------------------------------
// Starter loops: one-click patterns that fill the piano roll.
// ---------------------------------------------------------------------------

export type LoopPreset = {
  id: string
  name: string
  description: string
  /** Instrument the loop sounds best on; selected when the loop loads. */
  instrumentId: string
  pattern: Pattern
}

type NoteSpec = [pitch: number, start: number, duration: number, velocity?: number]

function notes(specs: NoteSpec[]): Note[] {
  return specs.map(([pitch, start, duration, velocity = 0.8]) => ({
    id: newNoteId(),
    pitch,
    start,
    duration,
    velocity,
  }))
}

/** Stacks a chord (list of pitches) at one start time. */
function chord(pitches: number[], start: number, duration: number, velocity = 0.7): NoteSpec[] {
  return pitches.map((p) => [p, start, duration, velocity])
}

// MIDI numbers for readability
const C3 = 48, F3 = 53, G3 = 55, A3 = 57, B3 = 59
const C4 = 60, D4 = 62, E4 = 64, F4 = 65, G4 = 67, A4 = 69, B4 = 71, C5 = 72, E5 = 76
const C2 = 36, F2 = 41, G2 = 43, A2 = 45

export const LOOP_PRESETS: LoopPreset[] = [
  {
    id: 'pop-progression',
    name: 'Pop Progression',
    description: 'I – V – vi – IV in C with a bass line',
    instrumentId: 'grand-piano',
    pattern: {
      bpm: 100,
      steps: 64,
      notes: notes([
        ...chord([C4, E4, G4], 0, 16),
        ...chord([B3, D4, G4], 16, 16),
        ...chord([C4, E4, A4], 32, 16),
        ...chord([C4, F4, A4], 48, 16),
        [C3, 0, 8], [C3, 8, 8], [G2 + 12, 16, 8], [G2 + 12, 24, 8],
        [A2 + 12, 32, 8], [A2 + 12, 40, 8], [F3, 48, 8], [F3, 56, 8],
      ]),
    },
  },
  {
    id: 'lofi-chords',
    name: 'Lo-fi Chords',
    description: 'Jazzy seventh chords, laid back',
    instrumentId: 'warm-pad',
    pattern: {
      bpm: 78,
      steps: 64,
      notes: notes([
        ...chord([C3, E4, G4, B4], 0, 14, 0.6), // Cmaj7
        ...chord([A2 + 12, C4, E4, G4], 16, 14, 0.6), // Am7
        ...chord([F3, A4, C5, E5], 32, 14, 0.6), // Fmaj7
        ...chord([G3, B3, D4, F4], 48, 14, 0.6), // G7
      ]),
    },
  },
  {
    id: 'house-bass',
    name: 'House Bass',
    description: 'Offbeat octave bass at 124 BPM',
    instrumentId: 'deep-bass',
    pattern: {
      bpm: 124,
      steps: 32,
      notes: notes(
        [C2, C2, F2, G2].flatMap((root, bar): NoteSpec[] => {
          const s = bar * 8
          return [
            [root, s + 2, 2, 0.9],
            [root + 12, s + 6, 2, 0.7],
          ]
        }),
      ),
    },
  },
  {
    id: 'arp-sparkle',
    name: 'Arp Sparkle',
    description: '16th-note A minor arpeggio',
    instrumentId: 'pluck',
    pattern: {
      bpm: 128,
      steps: 32,
      notes: notes(
        Array.from({ length: 32 }, (_, i): NoteSpec => {
          // Am for the first bar, F for the second
          const shape = i < 16 ? [A3, C4, E4, A4] : [F3, A3, C4, F4]
          const up = [0, 1, 2, 3, 2, 1, 2, 3]
          return [shape[up[i % 8]], i, 1, i % 4 === 0 ? 0.9 : 0.6]
        }),
      ),
    },
  },
  {
    id: 'chip-melody',
    name: 'Chip Melody',
    description: 'Bouncy 8-bit hook',
    instrumentId: 'chiptune',
    pattern: {
      bpm: 140,
      steps: 32,
      notes: notes([
        [E4, 0, 2], [G4, 2, 2], [C5, 4, 4], [B4, 8, 2], [G4, 10, 2], [A4, 12, 4],
        [F4, 16, 2], [A4, 18, 2], [C5, 20, 2], [B4, 22, 2], [G4, 24, 6], [D4, 30, 2],
      ]),
    },
  },
]

export const EMPTY_PATTERN: Pattern = { bpm: 110, steps: 32, notes: [] }

/** Fresh copy of a loop's pattern with new note ids, so edits never touch the preset. */
export function clonePattern(pattern: Pattern): Pattern {
  return { ...pattern, notes: pattern.notes.map((n) => ({ ...n, id: newNoteId() })) }
}
