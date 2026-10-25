import type { Dispatch, SetStateAction } from 'react'
import { ListMusic, Plus, Trash2 } from 'lucide-react'
import { Playlist, type ClipPreviewData, type PlaylistPattern } from '../components/Playlist'
import { STEP_COUNT } from '../audio/types'
import { MAX_PATTERNS, patternColor, patternLength, patternNumbers } from './patternAdapter'
import type { StudioProject, StudioSong } from './types'

type Props = {
  project: StudioProject
  setSong: Dispatch<SetStateAction<StudioSong>>
  activePattern: number
  onSelectPattern: (pattern: number) => void
  /** Adds an empty pattern and selects it. */
  onNewPattern: () => void
  /** Double-clicking a clip opens that pattern for editing. */
  onOpenPattern: (pattern: number) => void
  /** Playhead position in SONG mode, or null. */
  playStep: number | null
}

const SONG_LENGTHS = [4, 8, 16, 32, 64]
const MAX_TRACKS = 12

/** SONG mode's arrangement view: place patterns along the timeline. */
export function StudioPlaylist({ project, setSong, activePattern, onSelectPattern, onNewPattern, onOpenPattern, playStep }: Props) {
  const { song } = project
  const patterns: PlaylistPattern[] = patternNumbers(project).map((n) => ({
    id: String(n),
    name: `Pattern ${n}`,
    color: patternColor(n),
    // Long patterns span several bars; 24 steps is one and a half.
    bars: patternLength(project, n) / STEP_COUNT,
    preview: patternPreview(project, n),
  }))

  return (
    <div className="aero-panel max-w-6xl w-full mx-auto overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 aero-panel-header">
        <div className="flex items-center gap-2">
          <ListMusic className="w-4 h-4 text-aero-glow" />
          <h2 className="text-sm font-semibold tracking-wide text-white">Playlist • Song</h2>
        </div>
        <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-400">
          <label className="flex items-center gap-1.5">
            Length
            <select
              value={song.bars}
              onChange={(e) => {
                const bars = Number(e.target.value)
                // Drop clips that would start past the new end.
                setSong((s) => ({ ...s, bars, clips: s.clips.filter((c) => c.startBar < bars) }))
              }}
              className="aero-lcd font-semibold px-2.5 py-1 rounded-full outline-none"
            >
              {SONG_LENGTHS.map((b) => <option key={b} value={b}>{b} bars</option>)}
            </select>
          </label>
          <button
            type="button"
            disabled={song.trackCount >= MAX_TRACKS}
            onClick={() => setSong((s) => ({ ...s, trackCount: s.trackCount + 1 }))}
            className="aero-pill aero-smoke px-2.5 py-1"
          >
            <Plus className="w-3 h-3" /> Track
          </button>
          <button
            type="button"
            onClick={() => setSong((s) => ({ ...s, clips: [] }))}
            className="aero-pill aero-smoke px-2.5 py-1 hover:!text-red-300"
          >
            <Trash2 className="w-3 h-3" /> Clear song
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3 p-3 lg:flex-row">
        {/* Pattern picker: choose what clicking the grid places. */}
        <div className="flex shrink-0 gap-2 overflow-x-auto lg:max-h-[520px] lg:w-40 lg:flex-col lg:overflow-y-auto">
          {patterns.map((p) => {
            const n = Number(p.id)
            const selected = n === activePattern
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onSelectPattern(n)}
                onDoubleClick={() => onOpenPattern(n)}
                title="Click to place this pattern, double-click to edit it"
                className={`flex flex-1 items-center gap-2 rounded border px-2 py-1.5 text-left text-xs font-mono transition ${
                  selected ? 'border-aero-glow bg-sky-400/15 text-white shadow-[0_0_10px_rgba(127,227,255,0.25)]' : 'border-white/10 text-sky-100/70 hover:bg-white/5'
                }`}
              >
                <span className="h-4 w-1.5 shrink-0 rounded-full" style={{ background: p.color }} />
                {p.name}
              </button>
            )
          })}
          <button
            type="button"
            onClick={onNewPattern}
            disabled={patterns.length >= MAX_PATTERNS}
            className="flex shrink-0 items-center justify-center gap-1 rounded border border-dashed border-sky-200/30 px-2 py-1.5 text-xs text-sky-100/70 hover:text-white disabled:opacity-40"
          >
            <Plus className="w-3 h-3" /> New pattern
          </button>
          <p className="hidden text-[10px] leading-snug text-zinc-500 lg:block">
            Click the grid to place the selected pattern. Drag to move, right-click to remove, double-click to edit.
          </p>
        </div>

        <div className="min-w-0 flex-1">
          <Playlist
            arrangement={song}
            patterns={patterns}
            selectedPatternId={String(activePattern)}
            onSelectPattern={(id) => onSelectPattern(Number(id))}
            onChange={(change) => setSong((s) => ({ ...s, ...change(s) }))}
            onOpenPattern={(id) => onOpenPattern(Number(id))}
            playStep={playStep}
          />
        </div>
      </div>
    </div>
  )
}

/** Clip drawing: one row per channel, a block for each hit or note in the pattern. */
function patternPreview(project: StudioProject, pattern: number): ClipPreviewData {
  const length = patternLength(project, pattern)
  const blocks: ClipPreviewData['blocks'] = []
  project.channels.forEach((channel, row) => {
    const notes = project.pianoNotes[pattern]?.[channel.id] ?? []
    const gates = project.stepData[pattern]?.[channel.id] ?? []
    gates.slice(0, length).forEach((on, step) => {
      if (on === 1 && !notes.some((n) => n.step === step)) blocks.push({ x: step, y: row, w: 1 })
    })
    for (const n of notes) if (n.step < length) blocks.push({ x: n.step, y: row, w: Math.min(n.length, length - n.step) })
  })
  return { width: length, height: Math.max(1, project.channels.length), blocks }
}
