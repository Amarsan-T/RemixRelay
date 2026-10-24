import * as Tone from 'tone'
import { getInstrumentPreset, type BuiltInstrument, type Voice } from './presets'
import { STEPS_PER_BAR, midiToName, type Note, type Pattern, type Song } from './types'

// Plays a Timeline on a loop. A timeline is a flat list of notes, each tagged
// with the instrument that plays it: one pattern in the piano roll, or every
// clip of a song in the playlist. The loop reads the timeline through a getter
// on every 16th note, so edits made while playing are heard on the next pass.

export type TimelineNote = Note & { instrumentId: string }
export type Timeline = { steps: number; notes: TimelineNote[] }

// One instance per instrument preset, created the first time it's needed.
const instruments = new Map<string, BuiltInstrument>()
let repeatId: number | null = null

function voice(instrumentId: string): Voice {
  let instrument = instruments.get(instrumentId)
  if (!instrument) {
    instrument = getInstrumentPreset(instrumentId).create()
    instruments.set(instrumentId, instrument)
  }
  return instrument.voice
}

/** Creates instruments ahead of time, so the sampled piano has loaded by the first note. */
export function warmUp(instrumentIds: string[]) {
  instrumentIds.forEach(voice)
}

export async function unlockAudio() {
  // Browsers only allow audio after a user gesture.
  if (Tone.getContext().state !== 'running') await Tone.start()
}

/** Plays one note right now, e.g. when clicking a key or drawing a note. */
export function previewNote(instrumentId: string, pitch: number, velocity = 0.8) {
  voice(instrumentId).triggerAttackRelease(midiToName(pitch), '8n', undefined, velocity)
}

export function setBpm(bpm: number) {
  Tone.getTransport().bpm.value = bpm
}

/** One pattern, looping over its own length. */
export function patternTimeline(pattern: Pattern): Timeline {
  return {
    steps: pattern.steps,
    notes: pattern.notes.map((n) => ({ ...n, instrumentId: pattern.instrumentId })),
  }
}

/** Every clip on the playlist, with each pattern's notes shifted to where its clip sits. */
export function songTimeline(song: Song): Timeline {
  const patterns = new Map(song.patterns.map((p) => [p.id, p]))
  const notes: TimelineNote[] = []
  for (const clip of song.clips) {
    const pattern = patterns.get(clip.patternId)
    if (!pattern) continue
    const offset = clip.startBar * STEPS_PER_BAR
    for (const n of pattern.notes) {
      notes.push({ ...n, start: n.start + offset, instrumentId: pattern.instrumentId })
    }
  }
  return { steps: song.bars * STEPS_PER_BAR, notes }
}

export function start(getTimeline: () => Timeline, onStep: (step: number) => void) {
  stop()
  const transport = Tone.getTransport()
  let step = 0
  const stepSeconds = () => Tone.Time('16n').toSeconds()

  repeatId = transport.scheduleRepeat((time) => {
    const timeline = getTimeline()
    const s = step % timeline.steps
    for (const note of timeline.notes) {
      if (note.start === s) {
        voice(note.instrumentId).triggerAttackRelease(
          midiToName(note.pitch),
          note.duration * stepSeconds() * 0.95,
          time,
          note.velocity,
        )
      }
    }
    // Sync the playhead with what you hear, not with when it was scheduled.
    Tone.getDraw().schedule(() => onStep(s), time)
    step = s + 1
  }, '16n')

  transport.start()
}

export function stop() {
  const transport = Tone.getTransport()
  transport.stop()
  if (repeatId !== null) {
    transport.clear(repeatId)
    repeatId = null
  }
  instruments.forEach((i) => i.voice.releaseAll())
}
