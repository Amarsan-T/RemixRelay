import * as Tone from 'tone'
import { getInstrumentPreset, type BuiltInstrument } from './presets'
import { STEPS_PER_BEAT, midiToName } from './types'
import type { Timeline } from './engine'

// Turns a timeline into an audio file. Everything plays into a silent
// "offline" audio context as fast as the computer can, instead of in real time
// through the speakers, and the recorded samples come back as an AudioBuffer.

const SAMPLE_RATE = 44100
/** Extra seconds after the last step so releases and reverb tails aren't cut off. */
const TAIL_SECONDS = 3
const MP3_KBPS = 192

export async function renderTimeline(timeline: Timeline, bpm: number): Promise<AudioBuffer> {
  const stepSeconds = 60 / bpm / STEPS_PER_BEAT
  const duration = timeline.steps * stepSeconds + TAIL_SECONDS

  // Like Tone.Offline, but rendered without pausing on a timer after every
  // second of audio. Browsers slow timers down in background tabs, which made
  // exports crawl at about real time if you switched away.
  const context = new Tone.OfflineContext(2, duration, SAMPLE_RATE)
  const liveContext = Tone.getContext()
  // While this is set, instruments created below record into the file, not the speakers.
  Tone.setContext(context)
  try {
    const instruments = new Map<string, BuiltInstrument>()
    for (const id of new Set(timeline.notes.map((n) => n.instrumentId))) {
      instruments.set(id, getInstrumentPreset(id).create())
    }
    // Wait for piano samples to download and reverbs to build.
    await Promise.all([Tone.loaded(), ...[...instruments.values()].map((i) => i.ready)])

    for (const note of timeline.notes) {
      if (note.start >= timeline.steps) continue
      instruments.get(note.instrumentId)!.voice.triggerAttackRelease(
        midiToName(note.pitch),
        note.duration * stepSeconds * 0.95,
        note.start * stepSeconds,
        note.velocity,
      )
    }
  } finally {
    Tone.setContext(liveContext)
  }
  const rendered = await context.render(false)

  const buffer = rendered.get()
  if (!buffer) throw new Error('Rendering produced no audio')
  preventClipping(buffer)
  return buffer
}

/** If several loud notes add up past full volume, turn the whole mix down to fit. */
function preventClipping(buffer: AudioBuffer) {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c))
  let peak = 0
  for (const data of channels) for (const s of data) peak = Math.max(peak, Math.abs(s))
  if (peak <= 0.98) return
  const gain = 0.98 / peak
  for (const data of channels) for (let i = 0; i < data.length; i++) data[i] *= gain
}

/** Samples as 16-bit integers, the format both WAV and the MP3 encoder use. */
function toInt16(data: Float32Array): Int16Array {
  const out = new Int16Array(data.length)
  for (let i = 0; i < data.length; i++) {
    const s = Math.max(-1, Math.min(1, data[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}

/** Uncompressed 16-bit WAV: a 44-byte header followed by the raw samples. */
export function encodeWav(buffer: AudioBuffer): Blob {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => toInt16(buffer.getChannelData(c)))
  const bytesPerFrame = channels.length * 2
  const dataSize = buffer.length * bytesPerFrame
  const view = new DataView(new ArrayBuffer(44 + dataSize))
  const text = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }

  text(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true) // format chunk size
  view.setUint16(20, 1, true) // 1 = plain PCM
  view.setUint16(22, channels.length, true)
  view.setUint32(24, buffer.sampleRate, true)
  view.setUint32(28, buffer.sampleRate * bytesPerFrame, true) // bytes per second
  view.setUint16(32, bytesPerFrame, true)
  view.setUint16(34, 16, true) // bits per sample
  text(36, 'data')
  view.setUint32(40, dataSize, true)

  // Samples are interleaved: left, right, left, right...
  let offset = 44
  for (let i = 0; i < buffer.length; i++) {
    for (const data of channels) {
      view.setInt16(offset, data[i], true)
      offset += 2
    }
  }
  return new Blob([view], { type: 'audio/wav' })
}

/** Compressed MP3 via LAME. The encoder only loads when first used. */
export async function encodeMp3(buffer: AudioBuffer): Promise<Blob> {
  const { Mp3Encoder } = await import('@breezystack/lamejs')
  const left = toInt16(buffer.getChannelData(0))
  const right = toInt16(buffer.getChannelData(Math.min(1, buffer.numberOfChannels - 1)))
  const encoder = new Mp3Encoder(2, buffer.sampleRate, MP3_KBPS)

  const parts: BlobPart[] = []
  const add = (bytes: Uint8Array) => {
    if (bytes.length) parts.push(new Uint8Array(bytes))
  }
  // LAME works in frames of 1152 samples.
  for (let i = 0; i < left.length; i += 1152) {
    add(encoder.encodeBuffer(left.subarray(i, i + 1152), right.subarray(i, i + 1152)))
  }
  add(encoder.flush())
  return new Blob(parts, { type: 'audio/mpeg' })
}

/** Makes the browser save a file. */
export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  // Give the download a moment to start before releasing the memory.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
