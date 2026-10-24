import { SOUND_IDS } from './soundPresets'
import { DRUM_VOICES, MAX_BARS, MAX_BPM, MIN_BPM, STEP_COUNT } from './types'
import type { DrumStep, MusicalPattern, NoteStep } from './types'

function requireValue(condition: boolean, message: string): asserts condition {
  if (!condition) throw new TypeError(`Invalid musical pattern: ${message}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function inRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

function validateVelocity(value: unknown) {
  requireValue(value === undefined || inRange(value, 0, 1), 'velocity must be between 0 and 1')
}

function validateMix(value: Record<string, unknown>, master = false) {
  requireValue(value.pan === undefined || inRange(value.pan, -1, 1), 'pan must be between -1 and 1')
  if (master) {
    requireValue(value.volumeDb === undefined || inRange(value.volumeDb, -60, 6), 'master volumeDb must be between -60 and 6')
    requireValue(value.muted === undefined || typeof value.muted === 'boolean', 'master muted must be a boolean')
  }
  if (value.effects !== undefined) {
    requireValue(isRecord(value.effects), 'effects must be an object')
    const fx = value.effects
    requireValue(fx.filterHz === undefined || inRange(fx.filterHz, 20, 20000), 'filterHz must be between 20 and 20000')
    requireValue(fx.delay === undefined || inRange(fx.delay, 0, 0.8), 'delay must be between 0 and 0.8')
    requireValue(fx.distortion === undefined || inRange(fx.distortion, 0, 0.8), 'distortion must be between 0 and 0.8')
  }
}

/** totalSteps is 16 per bar; with one bar every limit and message is unchanged. */
function validateSteps(value: unknown, label: string, pitched: boolean, totalSteps = STEP_COUNT) {
  requireValue(Array.isArray(value) && value.length <= totalSteps, `${label} must be an array of up to ${totalSteps} steps`)
  const seen = new Set<number>()
  for (const entry of value) {
    requireValue(isRecord(entry), `${label} entries must be objects`)
    requireValue(inRange(entry.step, 0, totalSteps - 1) && Number.isInteger(entry.step), `${label} step must be an integer from 0 to ${totalSteps - 1}`)
    requireValue(!seen.has(entry.step), `${label} contains a duplicate step ${entry.step}`)
    seen.add(entry.step)
    if (!pitched) {
      validateVelocity(entry.velocity)
      continue
    }
    requireValue(Array.isArray(entry.notes) && entry.notes.length <= 8, `${label} notes must be an array of up to eight notes`)
    const pitches = new Set<string>()
    for (const note of entry.notes) {
      requireValue(isRecord(note), `${label} notes must be objects`)
      requireValue(typeof note.pitch === 'string' && /^[A-G](?:#|b)?[0-8]$/.test(note.pitch), 'pitch must use scientific notation, e.g. C2 or F#4 (octaves 0–8)')
      // Normalize enharmonic names so C#4 and Db4 cannot double-trigger a voice.
      const semitones: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
      const pitchKey = String(Number(note.pitch.at(-1)) * 12 + semitones[note.pitch[0]] + (note.pitch.includes('#') ? 1 : note.pitch.includes('b') ? -1 : 0))
      requireValue(!pitches.has(pitchKey), 'combine duplicate pitches into a single note')
      pitches.add(pitchKey)
      requireValue(inRange(note.durationSteps, Number.MIN_VALUE, STEP_COUNT), 'durationSteps must be greater than 0 and at most 16')
      validateVelocity(note.velocity)
    }
  }
}

/** Validate untrusted JSON/Convex data before replacing a working pattern. */
export function validatePattern(value: unknown): asserts value is MusicalPattern {
  requireValue(isRecord(value), 'expected an object')
  requireValue(inRange(value.bpm, MIN_BPM, MAX_BPM), `bpm must be between ${MIN_BPM} and ${MAX_BPM}`)
  requireValue(typeof value.loop === 'boolean', 'loop must be a boolean')
  requireValue(value.bars === undefined || (Number.isInteger(value.bars) && inRange(value.bars, 1, MAX_BARS)), `bars must be an integer from 1 to ${MAX_BARS}`)
  const totalSteps = STEP_COUNT * ((value.bars as number | undefined) ?? 1)
  if (value.master !== undefined) {
    requireValue(isRecord(value.master), 'master must be an object')
    validateMix(value.master, true)
  }
  requireValue(Array.isArray(value.tracks) && value.tracks.length <= 32, 'tracks must be an array of up to 32 tracks')
  const ids = new Set<string>()
  for (const track of value.tracks) {
    requireValue(isRecord(track), 'tracks must contain objects')
    requireValue(typeof track.id === 'string' && track.id.trim().length > 0, 'track id must be a nonempty string')
    requireValue(!ids.has(track.id), `duplicate track id ${track.id}`)
    ids.add(track.id)
    requireValue(typeof track.name === 'string', 'track name must be a string')
    requireValue(typeof track.muted === 'boolean', 'track muted must be a boolean')
    requireValue(inRange(track.volumeDb, -60, 0), 'track volumeDb must be between -60 and 0')
    validateMix(track)
    if (track.type === 'drums') {
      requireValue(isRecord(track.pattern), 'drum pattern must be an object')
      for (const voice of DRUM_VOICES) {
        if (voice === 'clap' && track.pattern.clap === undefined) continue
        validateSteps(track.pattern[voice], voice, false, totalSteps)
      }
    } else {
      requireValue(track.type === 'bass' || track.type === 'melody' || track.type === 'chords', 'unknown track type')
      requireValue(track.sound === undefined || (typeof track.sound === 'string' && SOUND_IDS.includes(track.sound)), `unknown sound preset ${String(track.sound)}`)
      validateSteps(track.steps, track.id, true, totalSteps)
    }
  }
}

/** Each call returns independent, editable data. */
export function createDemoPattern(variant: 'A' | 'B' = 'A'): MusicalPattern {
  const hits = (steps: number[], velocity = 0.8): DrumStep[] => steps.map((step) => ({ step, velocity }))
  const notes = (entries: [number, string[], number][]): NoteStep[] => entries.map(([step, pitches, durationSteps]) => ({
    step,
    notes: pitches.map((pitch) => ({ pitch, durationSteps, velocity: 0.7 })),
  }))
  const alternate = variant === 'B'
  return {
    bpm: 112,
    loop: true,
    tracks: [
      {
        id: 'drums', name: 'Drums', type: 'drums', muted: false, volumeDb: -5,
        pattern: {
          kick: hits(alternate ? [0, 3, 8, 10] : [0, 6, 8, 14], 0.95),
          snare: hits([4, 12], 0.85),
          closedHat: hits([0, 2, 4, 6, 8, 10, 12], 0.55),
          openHat: hits([14], 0.45),
        },
      },
      {
        id: 'bass', name: 'Bass', type: 'bass', muted: false, volumeDb: -11,
        steps: notes(alternate
          ? [[0, ['F2'], 3], [4, ['F2'], 2], [8, ['G2'], 3], [12, ['G2'], 2]]
          : [[0, ['C2'], 3], [4, ['C2'], 2], [8, ['Ab1'], 3], [12, ['Bb1'], 2]]),
      },
      {
        id: 'melody', name: 'Melody', type: 'melody', muted: false, volumeDb: -16,
        steps: notes(alternate
          ? [[0, ['Ab4'], 1.5], [3, ['C5'], 1.5], [6, ['F5'], 2], [10, ['D5'], 1.5], [14, ['G4'], 1.5]]
          : [[0, ['Eb4'], 1.5], [3, ['G4'], 1.5], [6, ['Bb4'], 2], [10, ['G4'], 1.5], [14, ['D4'], 1.5]]),
      },
      {
        id: 'chords', name: 'Chords', type: 'chords', muted: false, volumeDb: -21,
        steps: notes(alternate
          ? [[0, ['F3', 'Ab3', 'C4'], 7], [8, ['G3', 'B3', 'D4'], 7]]
          : [[0, ['C3', 'Eb3', 'G3'], 7], [8, ['Ab3', 'C4', 'Eb4'], 7]]),
      },
    ],
  }
}
