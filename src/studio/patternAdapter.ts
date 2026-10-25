import { STEP_COUNT } from '../audio/types'
import type { DrumPattern, DrumStep, DrumVoice, MusicalNote, MusicalPattern, NoteStep, Track } from '../audio/types'
import type { MixerTrack, StudioChannel, StudioProject } from './types'

export const DRUM_CHANNELS: Record<string, DrumVoice> = {
  kick: 'kick', snare: 'snare', clap: 'clap', hat_closed: 'closedHat', hat_open: 'openHat',
}

/** The note a channel-rack step plays when the piano roll has no note there. */
export function defaultHit(channel: StudioChannel): { pitch: string, durationSteps: number } {
  return channel.type === 'pitched'
    ? { pitch: channel.defaultNote ?? 'C2', durationSteps: 3 }
    : { pitch: channel.defaultNote ?? 'A4', durationSteps: 2 }
}

/** Longest pattern, in steps (16 bars). */
export const MAX_PATTERN_STEPS = 256

/** Length of a pattern nobody has resized yet, in steps: 64 = four bars. */
export const DEFAULT_PATTERN_STEPS = 64

/** Patterns a project starts with, and the most it can have. */
export const DEFAULT_PATTERN_COUNT = 4
export const MAX_PATTERNS = 32

/** The project's pattern numbers: [1, 2, 3, ...]. */
export function patternNumbers(project: StudioProject): number[] {
  return Array.from({ length: project.patternCount ?? DEFAULT_PATTERN_COUNT }, (_, i) => i + 1)
}

const PATTERN_COLORS = ['#f97316', '#22d3ee', '#ec4899', '#a3e635', '#facc15', '#a78bfa', '#f87171', '#2dd4bf']

/** Each pattern's color in the playlist; the colors repeat after eight patterns. */
export function patternColor(pattern: number): string {
  return PATTERN_COLORS[(pattern - 1) % PATTERN_COLORS.length]
}

/** The instrument a channel plays in a pattern (SOUND_PRESETS id), or undefined for the studio synth. */
export function channelSound(channel: StudioChannel, pattern: number): string | undefined {
  return (channel.patternSounds?.[pattern] ?? channel.sound) || undefined
}

/** How many steps a pattern plays before it loops. 16 = one bar. */
export function patternLength(project: StudioProject, pattern: number): number {
  return project.patternSteps?.[pattern] ?? DEFAULT_PATTERN_STEPS
}

const gainDb = (gain: number, headroom = 0) => Math.max(-60, Math.min(0, headroom + 20 * Math.log10(Math.max(gain, 0.001))))
const effects = (bus?: MixerTrack) => ({ filterHz: bus?.filter ?? 20000, delay: bus?.delay ?? 0, distortion: bus?.dist ?? 0 })

/** Drum hits one channel plays in one pattern, shifted to start at `offset`. */
function drumHits(project: StudioProject, pattern: number, channel: StudioChannel, offset: number): DrumStep[] {
  const gates = (project.stepData[pattern]?.[channel.id] ?? []).slice(0, patternLength(project, pattern))
  return gates.flatMap((active, step) => active === 1 ? [{ step: step + offset, velocity: 0.85 }] : [])
}

/** Notes one channel plays in one pattern, shifted to start at `offset`. */
function noteSteps(project: StudioProject, pattern: number, channel: StudioChannel, offset: number): NoteStep[] {
  const gates = project.stepData[pattern]?.[channel.id] ?? []
  const notes = project.pianoNotes[pattern]?.[channel.id] ?? []
  const steps: NoteStep[] = []
  for (let step = 0; step < patternLength(project, pattern); step++) {
    const explicit = notes.filter((note) => note.step === step)
    // Authored notes override the default hit at the same step, for every channel.
    if (explicit.length) {
      steps.push({ step: step + offset, notes: explicit.map((note) => ({
        // The engine caps a single note at one bar.
        pitch: note.note, durationSteps: Math.min(note.length, STEP_COUNT), velocity: note.velocity ?? 0.8,
      })) })
    } else if (gates[step] === 1) {
      steps.push({ step: step + offset, notes: [{ ...defaultHit(channel), velocity: 0.8 }] })
    }
  }
  return steps
}

/** Several patterns on the same bar: combine hits at the same step, keeping the loudest. */
function mergeHits(hits: DrumStep[]): DrumStep[] {
  const byStep = new Map<number, DrumStep>()
  for (const hit of hits) {
    const existing = byStep.get(hit.step)
    if (!existing || (hit.velocity ?? 0.8) > (existing.velocity ?? 0.8)) byStep.set(hit.step, hit)
  }
  return [...byStep.values()].sort((a, b) => a.step - b.step)
}

/** Combine notes at the same step into one chord. The engine rejects repeated pitches and chords over eight notes. */
function mergeNotes(steps: NoteStep[]): NoteStep[] {
  const byStep = new Map<number, Map<string, MusicalNote>>()
  for (const entry of steps) {
    const chord = byStep.get(entry.step) ?? new Map<string, MusicalNote>()
    for (const note of entry.notes) {
      const existing = chord.get(note.pitch)
      if (!existing || note.durationSteps > existing.durationSteps) chord.set(note.pitch, note)
    }
    byStep.set(entry.step, chord)
  }
  return [...byStep.entries()]
    .sort(([a], [b]) => a - b)
    .map(([step, chord]) => ({ step, notes: [...chord.values()].slice(0, 8) }))
}

/** A pattern starting at a step: one for PAT mode, one per playlist clip for SONG mode. */
type Placement = { pattern: number, offset: number }

/** Pure conversion; no scheduling or playback state. Anything past `totalSteps` is cut off. */
/**
 * `primary` is the pattern whose instrument keeps the channel's own track id, so
 * previews play the sound being edited. Patterns with other instruments get extra tracks.
 */
function toMusicalPattern(project: StudioProject, placements: Placement[], totalSteps: number, primary: number): MusicalPattern {
  const { channels, mixerTracks } = project
  const master = mixerTracks.find((bus) => bus.id === 0)
  const channelSolo = channels.some((channel) => channel.solo)
  const busSolo = mixerTracks.some((bus) => bus.id !== 0 && bus.solo)
  const everyBar = <T extends { step: number }>(collect: (pattern: number, offset: number) => T[]) =>
    placements.flatMap(({ pattern, offset }) => collect(pattern, offset)).filter((entry) => entry.step < totalSteps)

  const tracks: Track[] = channels.flatMap((channel): Track[] => {
    const bus = mixerTracks.find((entry) => entry.id === channel.mixerTrack)
    const muted = channel.muted || channel.vol === 0 || bus?.mute === true || bus?.vol === 0 ||
      (channelSolo && !channel.solo) || (busSolo && !master?.solo && !bus?.solo)
    const isDrum = channel.type === 'drum'
    const mix = {
      id: channel.id, name: channel.name, muted,
      volumeDb: gainDb(channel.vol * (bus?.vol ?? 1), isDrum ? -5 : channel.type === 'pitched' ? -9 : -14),
      pan: Math.max(-1, Math.min(1, channel.pan + (bus?.pan ?? 0))),
      effects: effects(bus),
    }
    if (isDrum) {
      const pattern: DrumPattern = { kick: [], snare: [], closedHat: [], openHat: [], clap: [] }
      const voice = DRUM_CHANNELS[channel.id]
      if (voice) pattern[voice] = mergeHits(everyBar((p, offset) => drumHits(project, p, channel, offset)))
      return [{ ...mix, type: 'drums', pattern }]
    }
    // One track per instrument the channel uses, each playing only its own patterns.
    const ownSound = channelSound(channel, primary)
    const sounds = [ownSound, ...new Set(placements.map(({ pattern }) => channelSound(channel, pattern)))]
    return [...new Set(sounds)].flatMap((sound): Track[] => {
      const steps = mergeNotes(everyBar((p, offset) => channelSound(channel, p) === sound ? noteSteps(project, p, channel, offset) : []))
      const own = sound === ownSound
      if (!own && steps.length === 0) return []
      return [{
        ...mix, id: own ? channel.id : `${channel.id}~${sound ?? 'synth'}`,
        type: channel.type === 'pitched' ? 'bass' : 'melody', steps,
        ...(sound ? { sound } : {}),
      }]
    })
  })
  if (project.metronome) {
    tracks.push({
      id: '__metronome', name: 'Metronome', type: 'melody', muted: false, volumeDb: -14,
      steps: Array.from({ length: Math.ceil(totalSteps / 4) }, (_, beat) => ({
        step: beat * 4,
        notes: [{ pitch: beat % 4 === 0 ? 'C6' : 'C5', durationSteps: 0.2, velocity: 0.5 }],
      })),
    })
  }
  return {
    bpm: project.bpm, loop: project.loop, tracks,
    // A one-bar pattern sets no length, so its output is unchanged.
    ...(totalSteps % STEP_COUNT === 0
      ? (totalSteps > STEP_COUNT ? { bars: totalSteps / STEP_COUNT } : {})
      : { steps: totalSteps }),
    master: {
      muted: master?.mute === true || master?.vol === 0,
      volumeDb: Math.max(-60, Math.min(6, 20 * Math.log10(Math.max(master?.vol ?? 1, 0.001)))),
      pan: master?.pan ?? 0, effects: effects(master),
    },
  }
}

/** PAT mode: loop one pattern. */
export function toAudioPattern(project: StudioProject, activePattern: number): MusicalPattern {
  return toMusicalPattern(project, [{ pattern: activePattern, offset: 0 }], patternLength(project, activePattern), activePattern)
}

/** SONG mode: play the playlist from bar 1 to the end. Previews use `activePattern`'s instruments. */
export function toAudioSong(project: StudioProject, activePattern = 1): MusicalPattern {
  const placements = project.song.clips.map((clip) => ({ pattern: Number(clip.patternId), offset: clip.startBar * STEP_COUNT }))
  return toMusicalPattern(project, placements, project.song.bars * STEP_COUNT, activePattern)
}

/**
 * Where `pattern` is up to when the song is at `songStep`, or null if no clip of
 * it is playing then. Used to show the playhead inside the pattern being edited.
 */
export function patternStepAt(project: StudioProject, pattern: number, songStep: number): number | null {
  const length = patternLength(project, pattern)
  for (const clip of project.song.clips) {
    if (Number(clip.patternId) !== pattern) continue
    const into = songStep - clip.startBar * STEP_COUNT
    if (into >= 0 && into < length) return into
  }
  return null
}
