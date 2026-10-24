import type { StudioChannel, StudioPreset, StudioProject } from './types'

export const NOTES = [
  { name: 'B4', freq: 493.88 },
  { name: 'A#4', freq: 466.16 },
  { name: 'A4', freq: 440.0 },
  { name: 'G#4', freq: 415.3 },
  { name: 'G4', freq: 392.0 },
  { name: 'F#4', freq: 369.99 },
  { name: 'F4', freq: 349.23 },
  { name: 'E4', freq: 329.63 },
  { name: 'D#4', freq: 311.13 },
  { name: 'D4', freq: 293.66 },
  { name: 'C#4', freq: 277.18 },
  { name: 'C4', freq: 261.63 },
  { name: 'B3', freq: 246.94 },
  { name: 'A#3', freq: 233.08 },
  { name: 'A3', freq: 220.0 },
  { name: 'G#3', freq: 207.65 },
  { name: 'G3', freq: 196.0 },
  { name: 'F#3', freq: 185.0 },
  { name: 'F3', freq: 174.61 },
  { name: 'E3', freq: 164.81 },
  { name: 'D#3', freq: 155.56 },
  { name: 'D3', freq: 146.83 },
  { name: 'C#3', freq: 138.59 },
  { name: 'C3', freq: 130.81 },
];

export const INITIAL_CHANNELS: StudioChannel[] = [
  { id: 'kick', name: 'Kick 808', color: '#ff5722', mixerTrack: 1, vol: 0.85, pan: 0, muted: false, solo: false, type: 'drum' },
  { id: 'snare', name: 'Snare Gritty', color: '#ff9800', mixerTrack: 2, vol: 0.8, pan: 0, muted: false, solo: false, type: 'drum' },
  { id: 'clap', name: 'Clap Crisp', color: '#ffc107', mixerTrack: 2, vol: 0.75, pan: 0.1, muted: false, solo: false, type: 'drum' },
  { id: 'hat_closed', name: 'Hi-Hat Closed', color: '#4caf50', mixerTrack: 3, vol: 0.7, pan: -0.15, muted: false, solo: false, type: 'drum' },
  { id: 'hat_open', name: 'Hi-Hat Open', color: '#8bc34a', mixerTrack: 3, vol: 0.65, pan: 0.2, muted: false, solo: false, type: 'drum' },
  { id: 'bass808', name: 'Sub 808', color: '#00bcd4', mixerTrack: 4, vol: 0.9, pan: 0, muted: false, solo: false, type: 'pitched', defaultNote: 'C2' },
  { id: 'synth_lead', name: 'Retro Lead', color: '#e91e63', mixerTrack: 5, vol: 0.75, pan: 0, muted: false, solo: false, type: 'synth' },
];

export const PRESETS: Record<string, StudioPreset> = {
  'Trap Heat': {
    bpm: 140,
    steps: {
      kick: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      clap: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      hat_closed: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      hat_open: [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0],
      bass808: [1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0],
      synth_lead: [1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0],
    },
    notes: {
      synth_lead: [
        { step: 0, note: 'A4', length: 2 },
        { step: 3, note: 'C4', length: 2 },
        { step: 6, note: 'E4', length: 2 },
        { step: 10, note: 'G4', length: 2 },
        { step: 13, note: 'F4', length: 2 },
      ]
    }
  },
  'House 4-on-Floor': {
    bpm: 124,
    steps: {
      kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      clap: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      hat_closed: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
      hat_open: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
      bass808: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
      synth_lead: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    },
    notes: {
      synth_lead: [
        { step: 0, note: 'C4', length: 2 },
        { step: 4, note: 'D#4', length: 2 },
        { step: 8, note: 'G4', length: 2 },
        { step: 12, note: 'A#4', length: 2 },
      ]
    }
  },
  'Synthwave 80s': {
    bpm: 110,
    steps: {
      kick: [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      clap: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      hat_closed: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      hat_open: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
      bass808: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
      synth_lead: [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0],
    },
    notes: {
      synth_lead: [
        { step: 0, note: 'D4', length: 2 },
        { step: 3, note: 'F4', length: 2 },
        { step: 6, note: 'A4', length: 2 },
        { step: 8, note: 'D5', length: 2 },
        { step: 11, note: 'C5', length: 2 },
        { step: 14, note: 'A4', length: 2 },
      ]
    }
  },
  'Lo-Fi Chill': {
    bpm: 85,
    steps: {
      kick: [1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      clap: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      hat_closed: [1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0],
      hat_open: [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
      bass808: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
      synth_lead: [1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0],
    },
    notes: {
      synth_lead: [
        { step: 0, note: 'E4', length: 3 },
        { step: 5, note: 'G4', length: 2 },
        { step: 8, note: 'B4', length: 3 },
        { step: 14, note: 'D4', length: 2 },
      ]
    }
  }
};


/** A new project. Pass a preset name to start from it, or null for a blank project. */
export function createStudioProject(preset: string | null = 'Trap Heat'): StudioProject {
  const start = preset ? PRESETS[preset] : undefined
  const stepData: StudioProject['stepData'] = {}
  const pianoNotes: StudioProject['pianoNotes'] = {}
  for (let p = 1; p <= 4; p++) {
    stepData[p] = Object.fromEntries(INITIAL_CHANNELS.map((ch) => [ch.id, new Array<number>(16).fill(0)]))
    pianoNotes[p] = {}
  }
  if (start) {
    stepData[1] = structuredClone(start.steps)
    pianoNotes[1] = structuredClone(start.notes)
  }
  return {
    bpm: start?.bpm ?? 120, loop: true, metronome: false,
    channels: structuredClone(INITIAL_CHANNELS), stepData, pianoNotes,
    // Pattern 1 for the first 4 bars, so SONG mode plays something right away.
    song: {
      bars: 8, trackCount: 4,
      clips: start ? [0, 1, 2, 3].map((bar) => ({ id: `clip-${bar}`, patternId: '1', track: 0, startBar: bar })) : [],
    },
    mixerTracks: [
      { id: 0, name: 'Master', vol: 0.85, pan: 0, filter: 20000, delay: 0, dist: 0, mute: false, solo: false },
      { id: 1, name: 'Kick / Low', vol: 0.9, pan: 0, filter: 20000, delay: 0, dist: 0.1, mute: false, solo: false },
      { id: 2, name: 'Snare/Clap', vol: 0.8, pan: 0, filter: 20000, delay: 0.1, dist: 0, mute: false, solo: false },
      { id: 3, name: 'Hats/Cymb', vol: 0.7, pan: 0, filter: 20000, delay: 0.15, dist: 0, mute: false, solo: false },
      { id: 4, name: '808 Bass', vol: 0.95, pan: 0, filter: 8000, delay: 0, dist: 0.25, mute: false, solo: false },
      { id: 5, name: 'Lead Synth', vol: 0.8, pan: 0, filter: 14000, delay: 0.35, dist: 0.05, mute: false, solo: false },
      { id: 6, name: 'Insert 6', vol: 0.8, pan: 0, filter: 20000, delay: 0, dist: 0, mute: false, solo: false },
    ],
  }
}
