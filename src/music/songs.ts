import { getLoopPreset, loopNotes } from './presets'
import { newId, type Clip, type Pattern, type Song } from './types'

// Creating songs, the demo projects shown on first launch, and saving to the browser.

/** Card colors from the Figma design, cycled for new songs. */
export const SONG_COLORS = ['#5f5af6', '#e0a24a', '#4a8f6b', '#d8675e', '#3b82f6', '#a855f7']

export function createPattern(name: string, instrumentId = 'grand-piano', steps = 32): Pattern {
  return { id: newId(), name, instrumentId, steps, notes: [] }
}

/** A pattern filled with one of the starter loops. */
export function patternFromLoop(loopId: string, name: string, instrumentId?: string): Pattern {
  const loop = getLoopPreset(loopId)
  return {
    id: newId(),
    name,
    instrumentId: instrumentId ?? loop.instrumentId,
    steps: loop.steps,
    notes: loopNotes(loop),
  }
}

export function createSong(name: string, color: string): Song {
  return {
    id: newId(),
    name,
    color,
    bpm: 110,
    bars: 16,
    trackCount: 4,
    patterns: [createPattern('Pattern 1')],
    clips: [],
    updatedAt: Date.now(),
  }
}

/** Places a pattern on one track at each of the given bars. */
function clips(pattern: Pattern, track: number, bars: number[]): Clip[] {
  return bars.map((startBar) => ({ id: newId(), patternId: pattern.id, track, startBar }))
}

const MINUTE = 60_000

function createDemoSongs(): Song[] {
  const now = Date.now()

  const popChords = patternFromLoop('pop-progression', 'Chords')
  const popArp = patternFromLoop('arp-sparkle', 'Sparkle')
  const lofiChords = patternFromLoop('lofi-chords', 'Chords')
  const lofiKeys = patternFromLoop('pop-progression', 'Keys', 'grand-piano')
  const houseBass = patternFromLoop('house-bass', 'Bass')
  const houseArp = patternFromLoop('arp-sparkle', 'Lead', 'synth-lead')
  const chipMelody = patternFromLoop('chip-melody', 'Melody')
  const chipArp = patternFromLoop('arp-sparkle', 'Arp', 'chiptune')

  return [
    {
      id: newId(), name: 'Pop Sketch', color: SONG_COLORS[0], bpm: 100, bars: 16, trackCount: 4,
      patterns: [popChords, popArp],
      clips: [...clips(popChords, 0, [0, 4, 8, 12]), ...clips(popArp, 1, [4, 6, 8, 10, 12, 14])],
      updatedAt: now - 12 * MINUTE,
    },
    {
      id: newId(), name: 'Lo-fi Night', color: SONG_COLORS[1], bpm: 78, bars: 16, trackCount: 4,
      patterns: [lofiChords, lofiKeys],
      clips: [...clips(lofiChords, 0, [0, 4, 8, 12]), ...clips(lofiKeys, 1, [8, 12])],
      updatedAt: now - 60 * MINUTE,
    },
    {
      id: newId(), name: 'House Groove', color: SONG_COLORS[2], bpm: 124, bars: 16, trackCount: 4,
      patterns: [houseBass, houseArp],
      clips: [...clips(houseBass, 0, [0, 2, 4, 6, 8, 10, 12, 14]), ...clips(houseArp, 1, [8, 10, 12, 14])],
      updatedAt: now - 3 * 60 * MINUTE,
    },
    {
      id: newId(), name: 'Chip Quest', color: SONG_COLORS[3], bpm: 140, bars: 16, trackCount: 4,
      patterns: [chipMelody, chipArp],
      clips: [...clips(chipMelody, 0, [0, 2, 4, 6, 8, 10, 12, 14]), ...clips(chipArp, 1, [4, 6, 12, 14])],
      updatedAt: now - 26 * 60 * MINUTE,
    },
  ]
}

// Songs are kept in this browser's localStorage so they survive a refresh.
// Moving them into Convex later is what lets teammates share them live.
const STORAGE_KEY = 'remixrelay.songs.v1'

export function loadSongs(): Song[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) return JSON.parse(saved) as Song[]
  } catch {
    // Storage blocked or data unreadable: fall back to the demos.
  }
  return createDemoSongs()
}

export function saveSongs(songs: Song[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(songs))
  } catch {
    // Storage blocked (e.g. private window): songs just won't persist.
  }
}
