import { STEP_COUNT } from '../audio/types'
import type { DrumPattern, DrumVoice, MusicalPattern, NoteStep, Track } from '../audio/types'
import type { MixerTrack, StudioProject } from './types'

export const DRUM_CHANNELS: Record<string, DrumVoice> = {
  kick: 'kick', snare: 'snare', clap: 'clap', hat_closed: 'closedHat', hat_open: 'openHat',
}

const gainDb = (gain: number, headroom = 0) => Math.max(-60, Math.min(0, headroom + 20 * Math.log10(Math.max(gain, 0.001))))
const effects = (bus?: MixerTrack) => ({ filterHz: bus?.filter ?? 20000, delay: bus?.delay ?? 0, distortion: bus?.dist ?? 0 })

/** Pure conversion; no scheduling, separate playback state, or generated demo data. */
export function toAudioPattern(project: StudioProject, activePattern: number): MusicalPattern {
  const { channels, mixerTracks } = project
  const master = mixerTracks.find((bus) => bus.id === 0)
  const channelSolo = channels.some((channel) => channel.solo)
  const busSolo = mixerTracks.some((bus) => bus.id !== 0 && bus.solo)
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
    const gates = project.stepData[activePattern]?.[channel.id] ?? []
    if (isDrum) {
      const pattern: DrumPattern = { kick: [], snare: [], closedHat: [], openHat: [], clap: [] }
      const voice = DRUM_CHANNELS[channel.id]
      if (voice) pattern[voice] = gates.flatMap((active, step) => active === 1 ? [{ step, velocity: 0.85 }] : [])
      return { ...mix, type: 'drums', pattern }
    }
    const notes = project.pianoNotes[activePattern]?.[channel.id] ?? []
    const steps: NoteStep[] = []
    for (let step = 0; step < STEP_COUNT; step++) {
      const explicit = notes.filter((note) => note.step === step)
      // Authored notes override the default hit at the same step, for every channel.
      if (explicit.length) {
        steps.push({ step, notes: explicit.map((note) => ({ pitch: note.note, durationSteps: note.length, velocity: 0.8 })) })
      } else if (gates[step] === 1) {
        steps.push({ step, notes: [{
          pitch: channel.defaultNote ?? (channel.type === 'pitched' ? 'C2' : 'A4'),
          durationSteps: channel.type === 'pitched' ? 3 : 2, velocity: 0.8,
        }] })
      }
    }
    return { ...mix, type: channel.type === 'pitched' ? 'bass' : 'melody', steps }
  })
  if (project.metronome) {
    tracks.push({
      id: '__metronome', name: 'Metronome', type: 'melody', muted: false, volumeDb: -14,
      steps: [0, 4, 8, 12].map((step) => ({ step, notes: [{ pitch: step === 0 ? 'C6' : 'C5', durationSteps: 0.2, velocity: 0.5 }] })),
    })
  }
  return {
    bpm: project.bpm, loop: project.loop, tracks,
    master: {
      muted: master?.mute === true || master?.vol === 0,
      volumeDb: Math.max(-60, Math.min(6, 20 * Math.log10(Math.max(master?.vol ?? 1, 0.001)))),
      pan: master?.pan ?? 0, effects: effects(master),
    },
  }
}
