export interface StudioChannel {
  id: string
  name: string
  color: string
  mixerTrack: number
  vol: number
  pan: number
  muted: boolean
  solo: boolean
  type: 'drum' | 'pitched' | 'synth'
  defaultNote?: string
}

export interface PianoNote {
  step: number
  note: string
  length: number
}

export type StepData = Record<number, Record<string, number[]>>
export type PianoNotes = Record<number, Record<string, PianoNote[]>>

export interface MixerTrack {
  id: number
  name: string
  vol: number
  pan: number
  filter: number
  delay: number
  dist: number
  mute: boolean
  solo: boolean
}

export type MixerParam = Exclude<keyof MixerTrack, 'id' | 'name'>

export interface StudioPreset {
  bpm: number
  steps: Record<string, number[]>
  notes: Record<string, PianoNote[]>
}

/** The studio's authored musical data. The engine receives a projection of this. */
export interface StudioProject {
  bpm: number
  loop: boolean
  metronome: boolean
  channels: StudioChannel[]
  stepData: StepData
  pianoNotes: PianoNotes
  mixerTracks: MixerTrack[]
}
