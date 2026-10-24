/** One bar of 4/4, indexed from 0 through 15. All positions use sixteenth notes. */
export const STEP_COUNT = 16
/** Longest pattern a song can play, in bars. */
export const MAX_BARS = 64
export const MIN_BPM = 40
export const MAX_BPM = 240

export const DRUM_VOICES = ['kick', 'snare', 'closedHat', 'openHat', 'clap'] as const
export type DrumVoice = (typeof DRUM_VOICES)[number]
export type InstrumentType = 'bass' | 'melody' | 'chords'

export interface DrumStep {
  step: number
  /** Linear amplitude, 0 (silent) through 1. Defaults to 0.8. */
  velocity?: number
}

export interface MusicalNote {
  /** Scientific pitch notation, e.g. C2, F#4, Bb3. Supported octaves: 0–8. */
  pitch: string
  /** Length in sixteenth notes, > 0 through 16. Fractions are allowed. */
  durationSteps: number
  velocity?: number
}

export interface NoteStep {
  step: number
  /** Multiple notes at the same position form a chord (maximum eight). */
  notes: MusicalNote[]
}

export interface DrumPattern {
  kick: DrumStep[]
  snare: DrumStep[]
  closedHat: DrumStep[]
  openHat: DrumStep[]
  clap?: DrumStep[]
}

export interface EffectsSettings {
  filterHz?: number
  delay?: number
  distortion?: number
}

export interface MixSettings {
  volumeDb?: number
  muted?: boolean
  pan?: number
  effects?: EffectsSettings
}

export interface TrackSettings {
  /** Stable identifier shared by the UI, audio engine, and database. */
  id: string
  name: string
  muted: boolean
  /** Track output in decibels, -60 through 0. */
  volumeDb: number
  pan?: number
  effects?: EffectsSettings
}

export interface DrumTrack extends TrackSettings {
  type: 'drums'
  pattern: DrumPattern
}

export interface InstrumentTrack extends TrackSettings {
  type: InstrumentType
  steps: NoteStep[]
}

export type Track = DrumTrack | InstrumentTrack

/** Plain, JSON-serializable data; no Tone objects or database dependencies. */
export interface MusicalPattern {
  bpm: number
  loop: boolean
  /**
   * Length in bars, 1 through 64. Defaults to 1. Steps then run from 0 through
   * bars × 16 − 1, which lets the playlist play a whole song arrangement.
   */
  bars?: number
  tracks: Track[]
  /** Optional master bus. Defaults to unity gain, centered pan, no effects. */
  master?: MixSettings
}

export interface PreviewOptions {
  drum?: DrumVoice
  pitch?: string
  durationSteps?: number
}

export interface PlaybackState {
  status: 'stopped' | 'starting' | 'playing' | 'disposed'
  /** Audible playhead position (counting across all bars), or null when stopped. */
  step: number | null
  bpm: number
  loop: boolean
  initialized: boolean
}

export type PlaybackListener = (state: PlaybackState) => void
