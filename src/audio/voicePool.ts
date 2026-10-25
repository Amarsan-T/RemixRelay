import type { SoundVoice } from './sounds'
import type { NoteStep } from './types'

/** The part of a Tone monophonic synth (Synth, MonoSynth, AMSynth, FMSynth) the pool uses. */
export interface PoolVoice {
  triggerAttack(note: string, time: number, velocity?: number): unknown
  triggerRelease(time: number): unknown
  dispose(): unknown
}

/** Extra time a voice stays reserved after its release ends. */
const RELEASE_MARGIN = 0.01

/**
 * Plays notes on a pool of monophonic synths, one note per synth.
 *
 * Tone's PolySynth sends every future note-off through a JavaScript timer, so
 * while the page is busy (a long React render, garbage collection) notes keep
 * sounding past their end. Here each note's attack and release go to its own
 * synth together, on the audio clock, when the note starts. Overlapping notes
 * of the same pitch each get their own synth, so one can't release another.
 */
export class VoicePool implements SoundVoice {
  private voices: { voice: PoolVoice; freeAt: number }[] = []
  /** Notes skipped because every voice was busy (PolySynth drops them too). */
  dropped = 0
  private readonly create: () => PoolVoice
  private readonly releaseSeconds: number
  private readonly maxVoices: number

  constructor(create: () => PoolVoice, releaseSeconds: number, maxVoices = 32) {
    this.create = create
    this.releaseSeconds = releaseSeconds
    this.maxVoices = maxVoices
  }

  get size(): number {
    return this.voices.length
  }

  /** Builds voices ahead of time, so playback rarely has to build one mid-loop. */
  prepare(count: number): void {
    while (this.voices.length < Math.min(count, this.maxVoices)) this.voices.push({ voice: this.create(), freeAt: 0 })
  }

  triggerAttackRelease(note: string, duration: number, time: number, velocity = 1): void {
    let slot = this.voices.find((entry) => entry.freeAt <= time)
    if (!slot) {
      if (this.voices.length >= this.maxVoices) {
        this.dropped++
        return
      }
      slot = { voice: this.create(), freeAt: 0 }
      this.voices.push(slot)
    }
    slot.voice.triggerAttack(note, time, velocity)
    slot.voice.triggerRelease(time + duration)
    slot.freeAt = time + duration + this.releaseSeconds + RELEASE_MARGIN
  }

  dispose(): void {
    for (const { voice } of this.voices) voice.dispose()
    this.voices = []
  }
}

/**
 * Most notes a track can have sounding at once, counting each note's release.
 * `releaseSteps` should assume the fastest tempo, where a release spans the most steps.
 */
export function voicesNeeded(steps: readonly NoteStep[], releaseSteps: number): number {
  const edges: [at: number, change: number][] = []
  for (const { step, notes } of steps) {
    for (const note of notes) {
      if (note.velocity === 0) continue
      edges.push([step, 1], [step + note.durationSteps + releaseSteps, -1])
    }
  }
  // Ends sort before starts at the same moment: a voice frees up just in time.
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  let sounding = 0
  let most = 0
  for (const [, change] of edges) most = Math.max(most, (sounding += change))
  return most
}
