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

const gainDb = (gain: number, headroom = 0) => Math.max(-60, Math.min(0, headroom + 20 * Math.log10(Math.max(gain, 0.001))))
const effects = (bus?: MixerTrack) => ({ filterHz: bus?.filter ?? 20000, delay: bus?.delay ?? 0, distortion: bus?.dist ?? 0 })

/** Drum hits one channel plays in one pattern, shifted to start at `offset`. */
function drumHits(project: StudioProject, pattern: number, channel: StudioChannel, offset: number): DrumStep[] {
  const gates = project.stepData[pattern]?.[channel.id] ?? []
  return gates.flatMap((active, step) => active === 1 ? [{ step: step + offset, velocity: 0.85 }] : [])
}

/** Notes one channel plays in one pattern, shifted to start at `offset`. */
function noteSteps(project: StudioProject, pattern: number, channel: StudioChannel, offset: number): NoteStep[] {
  const gates = project.stepData[pattern]?.[channel.id] ?? []
  const notes = project.pianoNotes[pattern]?.[channel.id] ?? []
  const steps: NoteStep[] = []
  for (let step = 0; step < STEP_COUNT; step++) {
    const explicit = notes.filter((note) => note.step === step)
    // Authored notes override the default hit at the same step, for every channel.
    if (explicit.length) {
      steps.push({ step: step + offset, notes: explicit.map((note) => ({
        pitch: note.note, durationSteps: note.length, velocity: note.velocity ?? 0.8,
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

/**
 * Pure conversion; no scheduling or playback state. `patternsPerBar[bar]` lists
 * the patterns heard during that bar: one entry for PAT mode, the playlist for SONG mode.
 */
function toMusicalPattern(project: StudioProject, patternsPerBar: number[][]): MusicalPattern {
  const { channels, mixerTracks } = project
  const bars = Math.max(1, patternsPerBar.length)
  const master = mixerTracks.find((bus) => bus.id === 0)
  const channelSolo = channels.some((channel) => channel.solo)
  const busSolo = mixerTracks.some((bus) => bus.id !== 0 && bus.solo)
  const everyBar = <T>(collect: (pattern: number, offset: number) => T[]) =>
    patternsPerBar.flatMap((patterns, bar) => patterns.flatMap((pattern) => collect(pattern, bar * STEP_COUNT)))

  const tracks: Track[] = channels.map((channel) => {
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
      return { ...mix, type: 'drums', pattern }
    }
    const steps = mergeNotes(everyBar((p, offset) => noteSteps(project, p, channel, offset)))
    return {
      ...mix, type: channel.type === 'pitched' ? 'bass' : 'melody', steps,
      ...(channel.sound ? { sound: channel.sound } : {}),
    }
  })
  if (project.metronome) {
    tracks.push({
      id: '__metronome', name: 'Metronome', type: 'melody', muted: false, volumeDb: -14,
      steps: Array.from({ length: bars * 4 }, (_, beat) => ({
        step: beat * 4,
        notes: [{ pitch: beat % 4 === 0 ? 'C6' : 'C5', durationSteps: 0.2, velocity: 0.5 }],
      })),
    })
  }
  return {
    bpm: project.bpm, loop: project.loop, tracks,
    // Only songs set a length, so single-pattern output is unchanged.
    ...(bars > 1 ? { bars } : {}),
    master: {
      muted: master?.mute === true || master?.vol === 0,
      volumeDb: Math.max(-60, Math.min(6, 20 * Math.log10(Math.max(master?.vol ?? 1, 0.001)))),
      pan: master?.pan ?? 0, effects: effects(master),
    },
  }
}

/** PAT mode: loop one pattern. */
export function toAudioPattern(project: StudioProject, activePattern: number): MusicalPattern {
  return toMusicalPattern(project, [[activePattern]])
}

/** Which patterns are placed on each bar of the playlist. */
export function patternsPerBar(project: StudioProject): number[][] {
  const bars = Array.from({ length: project.song.bars }, () => new Set<number>())
  for (const clip of project.song.clips) bars[clip.startBar]?.add(Number(clip.patternId))
  return bars.map((set) => [...set])
}

/** SONG mode: play the playlist from bar 1 to the end. */
export function toAudioSong(project: StudioProject): MusicalPattern {
  return toMusicalPattern(project, patternsPerBar(project))
}
