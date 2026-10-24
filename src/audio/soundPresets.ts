/** Instrument sounds a melodic track can use. Names and colors only; the synths live in sounds.ts. */
export interface SoundPreset {
  id: string
  name: string
  description: string
  color: string
  /** Bass sounds sit low, so new channels using them default to C2 instead of A4. */
  bass?: boolean
}

export const SOUND_PRESETS: SoundPreset[] = [
  { id: 'grand-piano', name: 'Grand Piano', description: 'Sampled acoustic piano', color: '#60a5fa' },
  { id: 'synth-lead', name: 'Synth Lead', description: 'Bright saw lead with delay', color: '#f472b6' },
  { id: 'deep-bass', name: 'Deep Bass', description: 'Punchy filtered bass', color: '#f59e0b', bass: true },
  { id: 'warm-pad', name: 'Warm Pad', description: 'Slow, airy chords', color: '#a78bfa' },
  { id: 'pluck', name: 'Pluck', description: 'Glassy FM pluck for arps', color: '#34d399' },
  { id: 'chiptune', name: 'Chiptune', description: '8-bit square wave', color: '#facc15' },
]

export const SOUND_IDS: readonly string[] = SOUND_PRESETS.map((s) => s.id)
