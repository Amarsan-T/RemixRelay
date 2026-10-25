import * as Tone from 'tone'
import { MAX_BPM } from './types'
import type { InstrumentTrack } from './types'

interface Voice {
  triggerAttackRelease(note: string, duration: number, time: number, velocity: number): unknown
  connect(destination: Tone.ToneAudioNode): unknown
  dispose(): unknown
}

/** Reserve steady-state overlap, including notes/tails that wrap around short loops. */
export function requiredVoices(track: InstrumentTrack, loopSteps: number, releaseSeconds: number): number {
  const tail = releaseSeconds / (60 / MAX_BPM / 4) + 0.05
  const events: { time: number; delta: number }[] = []
  for (const entry of track.steps) for (const note of entry.notes) {
    if (note.velocity === 0) continue
    const duration = note.durationSteps + tail
    for (let cycle = -Math.ceil(duration / loopSteps); cycle <= 0; cycle++) {
      const start = entry.step + cycle * loopSteps
      events.push({ time: start, delta: 1 }, { time: start + duration, delta: -1 })
    }
  }
  events.sort((a, b) => a.time - b.time || a.delta - b.delta)
  let active = 0
  let maximum = 1
  for (const event of events) {
    active += event.delta
    if (event.time >= 0 && event.time < loopSteps) maximum = Math.max(maximum, active)
  }
  return maximum
}

/**
 * Submit attack AND release to the chosen monophonic voice at onset.
 * Unlike PolySynth's future release callbacks, audio automation keeps running
 * through a blocked UI thread. Slots include their release tails and are bounded.
 */
export class ScheduledSynth extends Tone.Gain {
  private slots: { voice: Voice; reusableAt: number }[] = []
  private makeVoice: () => Voice
  private releaseSeconds: number
  private maximum: number
  private prepared = ''
  private droppedNotes = 0

  constructor(context: Tone.Context, makeVoice: () => Voice, releaseSeconds: number, maximum = 32) {
    super({ context, gain: 1 })
    this.makeVoice = makeVoice
    this.releaseSeconds = releaseSeconds
    this.maximum = maximum
  }

  private reserve(count: number) {
    while (this.slots.length < Math.min(this.maximum, count)) {
      const voice = this.makeVoice()
      voice.connect(this)
      this.slots.push({ voice, reusableAt: 0 })
    }
  }

  prepare(track: InstrumentTrack, loopSteps: number) {
    const key = JSON.stringify([loopSteps, track.steps])
    if (key === this.prepared) return
    const held = this.slots.filter((slot) => slot.reusableAt > this.context.currentTime).length
    this.reserve(requiredVoices(track, loopSteps, this.releaseSeconds) + held)
    this.prepared = key
  }

  preparePreview() {
    if (!this.slots.some((slot) => slot.reusableAt <= this.context.currentTime)) this.reserve(this.slots.length + 1)
  }

  triggerAttackRelease(note: string, duration: number, time: number, velocity = 0.8) {
    if (this.disposed || velocity === 0) return
    const slot = this.slots.find((candidate) => candidate.reusableAt <= time)
    if (!slot) { this.droppedNotes++; return }
    slot.reusableAt = time + duration + this.releaseSeconds + 0.003
    slot.voice.triggerAttackRelease(note, duration, time, velocity)
  }

  getVoiceStats() { return { allocated: this.slots.length, dropped: this.droppedNotes } }

  override dispose(): this {
    if (this.disposed) return this
    for (const slot of this.slots) slot.voice.dispose()
    this.slots = []
    return super.dispose()
  }
}
