// Shared music data model. Kept plain JSON so it can sync through Convex
// and round-trip with the MIDI -> JSON converter.

/** One note in the piano roll. Time is measured in steps (16th notes). */
export type Note = {
  id: string
  /** MIDI note number, 60 = middle C (C4). */
  pitch: number
  /** Step the note starts on, 0-based. */
  start: number
  /** Length in steps, at least 1. */
  duration: number
  /** 0..1 */
  velocity: number
}

/** A reusable block of notes, edited in the piano roll. */
export type Pattern = {
  id: string
  name: string
  instrumentId: string
  /** Length in steps. 16 steps = 1 bar of 4/4. */
  steps: number
  notes: Note[]
}

/** One placement of a pattern on the playlist. */
export type Clip = {
  id: string
  patternId: string
  /** Playlist row, 0-based. */
  track: number
  /** Bar the clip starts on, 0-based. */
  startBar: number
}

/** A project: its patterns, and where they're placed on the playlist. */
export type Song = {
  id: string
  name: string
  /** Card color on the home screen. */
  color: string
  bpm: number
  /** Playlist length in bars. */
  bars: number
  trackCount: number
  patterns: Pattern[]
  clips: Clip[]
  /** Last edit time in ms since 1970, for "Last edited 5 minutes ago". */
  updatedAt: number
}

export const STEPS_PER_BEAT = 4
export const STEPS_PER_BAR = 16

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** 60 -> "C4" (the format Tone.js expects). */
export function midiToName(pitch: number): string {
  return `${NOTE_NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`
}

/** "C4" -> 60. Accepts sharps and flats ("F#4", "Bb3"); returns null for anything else. */
export function nameToMidi(name: string): number | null {
  const match = /^([A-G])([#b]?)(-?\d)$/.exec(name)
  if (!match) return null
  const [, letter, accidental, octave] = match
  const semitone = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[letter as 'C']
  return (Number(octave) + 1) * 12 + semitone + (accidental === '#' ? 1 : accidental === 'b' ? -1 : 0)
}

export function isBlackKey(pitch: number): boolean {
  return NOTE_NAMES[pitch % 12].includes('#')
}

export function newId(): string {
  return crypto.randomUUID()
}

/** How many playlist bars a pattern covers. */
export function patternBars(pattern: Pattern): number {
  return Math.max(1, Math.ceil(pattern.steps / STEPS_PER_BAR))
}
