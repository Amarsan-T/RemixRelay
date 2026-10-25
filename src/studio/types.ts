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
  /** Instrument preset (SOUND_PRESETS id). Unset plays the default studio synth. */
  sound?: string
  /** Instrument picked for one pattern, by pattern number; overrides `sound` there. '' is the studio synth. */
  patternSounds?: Record<number, string>
}

export interface PianoNote {
  step: number
  note: string
  length: number
  /** Set once the note is edited in the piano roll, so it can be dragged. */
  id?: string
  /** 0 through 1. Defaults to 0.8. */
  velocity?: number
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

/** One pattern placed on the song playlist. Every pattern is one bar long. */
export interface SongClip {
  id: string
  /** '1' through '4', matching the PAT buttons. */
  patternId: string
  /** Playlist row, 0-based. */
  track: number
  /** Bar the clip starts on, 0-based. */
  startBar: number
}

/** The playlist: which pattern plays where, played in SONG mode. */
export interface StudioSong {
  bars: number
  trackCount: number
  clips: SongClip[]
}

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
  song: StudioSong
  /** Length of each pattern in steps (16 = one bar). Patterns not listed use the default. */
  patternSteps?: Record<number, number>
  /** How many patterns the project has (numbered 1, 2, 3...). Defaults to 4. */
  patternCount?: number
}
