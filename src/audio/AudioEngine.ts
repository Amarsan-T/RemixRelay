import * as Tone from 'tone'
import { createTrackInstrument } from './instruments'
import type { TrackInstrument } from './instruments'
import { createDemoPattern, validatePattern } from './patterns'
import { createMixBus } from './mixer'
import { DRUM_VOICES, totalSteps } from './types'
import type { MusicalPattern, PlaybackListener, PlaybackState, PreviewOptions, Track } from './types'

/** Framework-independent sequencer. Construction does not create an AudioContext. */
export class AudioEngine {
  private pattern: MusicalPattern
  private context: Tone.Context | null = null
  private master: Tone.Gain | null = null
  private mixInput: Tone.Gain | null = null
  private limiter: Tone.Limiter | null = null
  private masterBus: ReturnType<typeof createMixBus> | null = null
  private meter: Tone.Meter | null = null
  private instruments = new Map<string, TrackInstrument>()
  private events: number[] = []
  private listeners = new Set<PlaybackListener>()
  private status: PlaybackState['status'] = 'stopped'
  private step: number | null = null
  private generation = 0
  private startPromise: Promise<void> | null = null
  private finishTimer: ReturnType<typeof setTimeout> | null = null

  constructor(pattern: MusicalPattern = createDemoPattern()) {
    validatePattern(pattern)
    this.pattern = structuredClone(pattern)
  }

  getPattern(): MusicalPattern {
    return structuredClone(this.pattern)
  }

  getState(): PlaybackState {
    return {
      status: this.status, step: this.step, bpm: this.pattern.bpm, loop: this.pattern.loop,
      initialized: this.context?.state === 'running',
    }
  }

  /** Immediately delivers the current state, then updates on changes/audible steps. */
  subscribe(listener: PlaybackListener): () => void {
    this.assertUsable()
    this.listeners.add(listener)
    this.deliver(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Call from a click/tap handler. play() also calls this automatically. */
  async initialize(): Promise<void> {
    this.assertUsable()
    if (!this.context) {
      // A private context keeps the existing app's Tone synths/transport intact.
      // Notes are scheduled 100 ms ahead (Tone's default), so a brief page hiccup
      // can't make them late. 50 ms was too tight for the studio UI.
      this.context = new Tone.Context({ latencyHint: 'interactive', lookAhead: 0.1 })
      this.meter = new Tone.Meter({ context: this.context, channelCount: 2, normalRange: true, smoothing: 0.7 }).connect(this.context.destination)
      this.limiter = new Tone.Limiter({ context: this.context, threshold: -1 }).connect(this.meter)
      // The final gate follows every effect, so Stop also silences feedback tails.
      this.master = new Tone.Gain({ context: this.context, gain: 0 }).connect(this.limiter)
    }
    const context = this.context
    await context.resume()
    if (this.status === 'disposed') return
    if (context.state !== 'running') throw new Error('Audio is suspended. Start playback from a click or tap.')
    this.emit()
  }

  /** Stereo RMS amplitudes for UI meters; reading this never initializes audio. */
  getOutputLevels(): [number, number] {
    if (!this.meter || this.context?.state !== 'running') return [0, 0]
    const value = this.meter.getValue()
    const values = Array.isArray(value) ? value : [value, value]
    return [Math.min(1, values[0] ?? 0), Math.min(1, values[1] ?? 0)]
  }

  /** Audition through the same track/mixer/context without starting the Transport. */
  async previewTrack(id: string, options: PreviewOptions = {}): Promise<void> {
    const source = this.requireTrack(id)
    let preview: Track
    if (source.type === 'drums') {
      const voice = options.drum ?? 'kick'
      if (!DRUM_VOICES.includes(voice)) throw new TypeError('Unknown drum preview voice')
      preview = { ...source, pattern: { kick: [], snare: [], closedHat: [], openHat: [], [voice]: [{ step: 0 }] } }
    } else {
      preview = { ...source, steps: [{ step: 0, notes: [{
        pitch: options.pitch ?? source.steps[0]?.notes[0]?.pitch ?? (source.type === 'bass' ? 'C2' : 'C4'),
        durationSteps: options.durationSteps ?? 2,
        velocity: 0.8,
      }] }] }
    }
    validatePattern({ ...this.pattern, tracks: [preview] })
    const generation = this.generation
    await this.initialize()
    if (generation !== this.generation || !this.context || !this.master) return
    const latest = this.pattern.tracks.find((track) => track.id === id)
    if (!latest || latest.type !== preview.type) return
    this.syncInstruments()
    // Previews skip the scheduling look-ahead (context.now() includes it) so clicks sound instantly.
    const time = this.context.immediate() + 0.005
    this.master.gain.setValueAtTime(0.8, time)
    this.instruments.get(id)?.playStep({ ...preview, muted: latest.muted }, 0, time, 60 / this.pattern.bpm / 4)
  }

  /** Repeated Play calls share one start operation and never stack schedulers. */
  play(): Promise<void> {
    this.assertUsable()
    if (this.startPromise) return this.startPromise
    if (this.status === 'playing') return this.initialize()
    const generation = ++this.generation
    this.status = 'starting'
    this.emit()
    this.startPromise = this.startPlayback(generation)
    return this.startPromise
  }

  /** Stop, silence all voices, and rewind. Safe before initialization or repeatedly. */
  stop(): void {
    if (this.status === 'disposed') return
    ++this.generation
    this.startPromise = null
    if (this.finishTimer !== null) clearTimeout(this.finishTimer)
    this.finishTimer = null
    if (this.context) {
      const now = this.context.immediate()
      this.master?.gain.cancelScheduledValues(now)
      this.master?.gain.setValueAtTime(0, now)
      this.context.transport.stop(now)
      for (const id of this.events) this.context.transport.clear(id)
      this.context.draw.cancel(0)
    }
    this.events = []
    for (const instrument of this.instruments.values()) instrument.dispose()
    this.instruments.clear()
    this.mixInput?.dispose()
    this.masterBus?.dispose()
    this.mixInput = null
    this.masterBus = null
    this.status = 'stopped'
    this.step = null
    this.emit()
  }

  /** Validate and copy a complete snapshot. Invalid data leaves playback untouched. */
  setPattern(pattern: MusicalPattern): void {
    this.assertUsable()
    validatePattern(pattern)
    // The loop length is fixed when playback starts, so a new length needs a restart.
    const lengthChanged = totalSteps(pattern) !== totalSteps(this.pattern)
    this.pattern = structuredClone(pattern)
    if (lengthChanged && (this.status === 'playing' || this.status === 'starting')) {
      this.stop()
      void this.play().catch((error: unknown) => console.error('AudioEngine restart failed:', error))
      return
    }
    if (this.context) {
      this.context.transport.bpm.value = this.pattern.bpm
      this.context.transport.loop = this.pattern.loop
      this.masterBus?.setMix(this.pattern.master ?? {})
      if (this.status === 'playing' || this.instruments.size > 0) this.syncInstruments()
    }
    this.emit()
  }

  /** Insert a new track or replace an existing track by stable id. */
  setTrack(track: Track): void {
    const tracks = this.pattern.tracks.filter((entry) => entry.id !== track.id)
    const index = this.pattern.tracks.findIndex((entry) => entry.id === track.id)
    tracks.splice(index < 0 ? tracks.length : index, 0, track)
    this.setPattern({ ...this.pattern, tracks })
  }

  removeTrack(id: string): void {
    this.requireTrack(id)
    this.setPattern({ ...this.pattern, tracks: this.pattern.tracks.filter((track) => track.id !== id) })
  }

  setBpm(bpm: number): void {
    this.setPattern({ ...this.pattern, bpm })
  }

  setLoop(loop: boolean): void {
    this.setPattern({ ...this.pattern, loop })
  }

  setTrackMuted(id: string, muted: boolean): void {
    this.setTrack({ ...this.requireTrack(id), muted })
  }

  setTrackVolume(id: string, volumeDb: number): void {
    this.setTrack({ ...this.requireTrack(id), volumeDb })
  }

  /** Terminal and idempotent. Create a fresh engine after disposal. */
  dispose(): void {
    if (this.status === 'disposed') return
    this.stop()
    this.master?.dispose()
    this.masterBus?.dispose()
    this.limiter?.dispose()
    this.meter?.dispose()
    this.context?.dispose()
    this.context = null
    this.master = null
    this.limiter = null
    this.masterBus = null
    this.meter = null
    this.status = 'disposed'
    this.emit()
    this.listeners.clear()
  }

  private async startPlayback(generation: number): Promise<void> {
    try {
      await this.initialize()
      if (this.generation !== generation || !this.context || !this.master) return
      const context = this.context
      const transport = context.transport
      this.syncInstruments()
      transport.timeSignature = 4
      transport.bpm.value = this.pattern.bpm
      // Loop on the exact length: a song's bars, or a pattern of any number of steps.
      // "0:0:N" is Tone's notation for N sixteenth notes.
      const loopSteps = totalSteps(this.pattern)
      const loopEnd = `0:0:${loopSteps}`
      transport.setLoopPoints(0, loopEnd)
      transport.loop = this.pattern.loop
      this.events.push(transport.scheduleRepeat((time) => {
        if (this.generation !== generation) return
        const step = Math.round(transport.getTicksAtTime(time) / (transport.PPQ / 4)) % loopSteps
        const stepSeconds = 60 / transport.bpm.getValueAtTime(time) / 4
        const closedHat = this.pattern.tracks.some((track) => track.type === 'drums' && !track.muted &&
          track.pattern.closedHat.some((hit) => hit.step === step && hit.velocity !== 0))
        for (const track of this.pattern.tracks) {
          this.instruments.get(track.id)?.playStep(track, step, time, stepSeconds)
        }
        if (closedHat) {
          for (const instrument of this.instruments.values()) instrument.chokeOpenHat?.(time)
        }
        context.draw.schedule(() => {
          if (this.generation !== generation) return
          this.step = step
          this.emit()
        }, time)
      }, '16n', 0, loopEnd))
      // A looping Transport wraps before this event. With looping off it stops at bar end.
      this.events.push(transport.schedule((time) => {
        if (this.generation !== generation) return
        transport.stop(time)
        this.master?.gain.setValueAtTime(0, time)
        // Audio stops at the precise Transport time; the timer only cleans up resources.
        this.finishTimer = setTimeout(() => {
          if (this.generation === generation) this.stop()
        }, Math.max(0, (time - context.immediate()) * 1000) + 10)
      }, loopEnd))
      const startTime = context.now() + 0.01
      this.master.gain.setValueAtTime(0.8, startTime)
      this.status = 'playing'
      transport.start(startTime, 0)
      this.emit()
    } catch (error) {
      if (this.generation !== generation) return
      this.stop()
      throw error
    } finally {
      if (this.generation === generation) this.startPromise = null
    }
  }

  private syncInstruments(): void {
    if (!this.context || !this.master) return
    if (!this.masterBus) {
      this.masterBus = createMixBus(this.context, this.master, this.pattern.master ?? {})
      this.mixInput = new Tone.Gain({ context: this.context, gain: 1 }).connect(this.masterBus.input)
    }
    const destination = this.mixInput
    if (!destination) return
    const tracks = new Map(this.pattern.tracks.map((track) => [track.id, track]))
    for (const [id, instrument] of this.instruments) {
      const next = tracks.get(id)
      const sound = next && next.type !== 'drums' ? next.sound : undefined
      if (next?.type !== instrument.type || sound !== instrument.sound) {
        instrument.dispose()
        this.instruments.delete(id)
      }
    }
    for (const track of tracks.values()) {
      if (!this.instruments.has(track.id)) {
        this.instruments.set(track.id, createTrackInstrument(this.context, destination, track))
      }
      this.instruments.get(track.id)?.setMix(track)
    }
  }

  private requireTrack(id: string): Track {
    this.assertUsable()
    const track = this.pattern.tracks.find((entry) => entry.id === id)
    if (!track) throw new RangeError(`Unknown audio track: ${id}`)
    return track
  }

  private assertUsable(): void {
    if (this.status === 'disposed') throw new Error('AudioEngine has been disposed; create a new instance.')
  }

  private deliver(listener: PlaybackListener): void {
    try { listener(this.getState()) } catch (error) { console.error('AudioEngine subscriber failed:', error) }
  }

  private emit(): void {
    for (const listener of this.listeners) this.deliver(listener)
  }
}
