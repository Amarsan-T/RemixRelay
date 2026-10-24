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

export type Pattern = {
  bpm: number
  /** Total loop length in steps. 16 steps = 1 bar of 4/4. */
  steps: number
  notes: Note[]
}

export const STEPS_PER_BEAT = 4
export const STEPS_PER_BAR = 16

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** 60 -> "C4" (the format Tone.js expects). */
export function midiToName(pitch: number): string {
  return `${NOTE_NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`
}

export function isBlackKey(pitch: number): boolean {
  return NOTE_NAMES[pitch % 12].includes('#')
}

export function newNoteId(): string {
  return crypto.randomUUID()
}
