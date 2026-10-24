import * as Tone from 'tone'
import { getInstrumentPreset, type BuiltInstrument } from './presets'
import { midiToName, type Pattern } from './types'

// Plays a Pattern on a loop through the current instrument preset.
// The loop reads the pattern through a getter on every 16th note, so
// edits made while playing are heard on the next pass without restarting.

let current: BuiltInstrument | null = null
let repeatId: number | null = null

export async function unlockAudio() {
  // Browsers only allow audio after a user gesture.
  if (Tone.getContext().state !== 'running') await Tone.start()
}

export function setInstrument(presetId: string) {
  current?.voice.releaseAll()
  current?.dispose()
  current = getInstrumentPreset(presetId).create()
}

/** Plays one note right now, e.g. when clicking a key or drawing a note. */
export function previewNote(pitch: number, velocity = 0.8) {
  current?.voice.triggerAttackRelease(midiToName(pitch), '8n', undefined, velocity)
}

export function setBpm(bpm: number) {
  Tone.getTransport().bpm.value = bpm
}

export function start(getPattern: () => Pattern, onStep: (step: number) => void) {
  stop()
  const transport = Tone.getTransport()
  setBpm(getPattern().bpm)
  let step = 0
  const stepSeconds = () => Tone.Time('16n').toSeconds()

  repeatId = transport.scheduleRepeat((time) => {
    const pattern = getPattern()
    const s = step % pattern.steps
    for (const note of pattern.notes) {
      if (note.start === s) {
        current?.voice.triggerAttackRelease(
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
  current?.voice.releaseAll()
}
