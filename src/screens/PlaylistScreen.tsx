import { useEffect, useRef, useState } from 'react'
import { Pencil, Play, Plus, Square, Trash2 } from 'lucide-react'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { ExportButton } from '../components/ExportButton'
import { Playlist, type ClipPreviewData } from '../components/Playlist'
import * as engine from '../music/engine'
import { getInstrumentPreset } from '../music/presets'
import { renderTimeline } from '../music/render'
import { createPattern } from '../music/songs'
import { patternBars, type Song } from '../music/types'

/** Preview of notes by pitch, highest at the top, like a tiny piano roll. */
function notesPreview(notes: { pitch: number; start: number; duration: number }[], steps: number): ClipPreviewData {
  if (notes.length === 0) return { width: steps, height: 1, blocks: [] }
  const pitches = notes.map((n) => n.pitch)
  const low = Math.min(...pitches)
  const high = Math.max(...pitches)
  return {
    width: steps,
    height: high - low + 1,
    blocks: notes.map((n) => ({ x: n.start, y: high - n.pitch, w: n.duration })),
  }
}

type Props = {
  song: Song
  onChange: (change: (song: Song) => Song) => void
  onHome: () => void
  onOpenPattern: (patternId: string) => void
}

const SONG_LENGTHS = [8, 16, 32, 64]
const MAX_TRACKS = 12

// One song: its patterns on the left, the arrangement on the right.
export function PlaylistScreen({ song, onChange, onHome, onOpenPattern }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(song.patterns[0]?.id ?? null)
  const [playing, setPlaying] = useState(false)
  const [playStep, setPlayStep] = useState<number | null>(null)

  // The audio loop reads the latest arrangement through this ref.
  const timelineRef = useRef(engine.songTimeline(song))
  useEffect(() => {
    timelineRef.current = engine.songTimeline(song)
  }, [song])

  useEffect(() => engine.setBpm(song.bpm), [song.bpm])
  useEffect(() => engine.warmUp(song.patterns.map((p) => p.instrumentId)), [song.patterns])
  useEffect(() => () => engine.stop(), [])

  function stopPlayback() {
    engine.stop()
    setPlaying(false)
    setPlayStep(null)
  }

  function togglePlay() {
    if (playing) {
      stopPlayback()
      return
    }
    void engine.unlockAudio()
    engine.start(() => timelineRef.current, setPlayStep)
    setPlaying(true)
  }

  function addPattern() {
    const pattern = createPattern(`Pattern ${song.patterns.length + 1}`)
    onChange((s) => ({ ...s, patterns: [...s.patterns, pattern] }))
    setSelectedId(pattern.id)
  }

  function deletePattern(patternId: string) {
    onChange((s) => ({
      ...s,
      patterns: s.patterns.filter((p) => p.id !== patternId),
      clips: s.clips.filter((c) => c.patternId !== patternId),
    }))
    if (selectedId === patternId) setSelectedId(null)
  }

  return (
    <>
      <header className="sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b border-line bg-canvas/90 px-4 py-3 backdrop-blur sm:px-8">
        <Breadcrumbs items={[{ label: 'Home', onClick: onHome }, { label: song.name }]} />
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-muted">
            BPM
            <input
              type="number"
              min={40}
              max={220}
              value={song.bpm}
              onChange={(e) => {
                const bpm = Number(e.target.value)
                if (bpm >= 40 && bpm <= 220) onChange((s) => ({ ...s, bpm }))
              }}
              className="h-9 w-16 rounded-lg border border-line bg-white px-2 text-ink"
            />
          </label>
          <ExportButton
            fileName={song.name}
            render={() => renderTimeline(engine.songTimeline(song), song.bpm)}
            onBeforeExport={stopPlayback}
          />
          <button
            type="button"
            onClick={togglePlay}
            className={`flex h-9 items-center gap-2 rounded-xl px-4 text-sm font-medium text-white transition ${playing ? 'bg-red-500 hover:bg-red-600' : 'bg-accent hover:bg-accent-hover'}`}
          >
            {playing ? <Square size={15} /> : <Play size={15} />}
            {playing ? 'Stop' : 'Play song'}
          </button>
        </div>
      </header>

      <div className="px-4 py-6 sm:px-8">
        <input
          value={song.name}
          onChange={(e) => onChange((s) => ({ ...s, name: e.target.value }))}
          aria-label="Song name"
          className="-ml-2 w-full max-w-xl rounded-lg bg-transparent px-2 py-1 text-3xl font-semibold outline-none hover:bg-black/[.03] focus:bg-white"
        />

        <div className="mt-6 flex flex-col gap-6 lg:flex-row">
          {/* Patterns: pick one, then click the grid to place it. */}
          <section className="w-full shrink-0 rounded-2xl border border-line bg-white lg:w-64">
            <div className="border-b border-line px-4 py-3">
              <h2 className="font-semibold">Patterns</h2>
              <p className="text-xs text-muted">Select one, then click the grid to place it</p>
            </div>
            <ul className="flex flex-col gap-1 p-2">
              {song.patterns.map((p) => {
                const instrument = getInstrumentPreset(p.instrumentId)
                const selected = p.id === selectedId
                return (
                  <li key={p.id}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedId(p.id)}
                      onDoubleClick={() => onOpenPattern(p.id)}
                      onKeyDown={(e) => e.key === 'Enter' && onOpenPattern(p.id)}
                      className={`group flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 transition ${selected ? 'border-accent bg-accent/5' : 'border-transparent hover:bg-black/[.03]'}`}
                    >
                      <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ background: instrument.color }} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{p.name}</span>
                        <span className="block truncate text-xs text-muted">
                          {instrument.name} · {patternBars(p)} {patternBars(p) === 1 ? 'bar' : 'bars'}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          onOpenPattern(p.id)
                        }}
                        className="rounded-md p-1.5 text-muted hover:bg-black/5 hover:text-ink"
                        aria-label={`Edit notes in ${p.name}`}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          deletePattern(p.id)
                        }}
                        className="rounded-md p-1.5 text-muted opacity-0 group-hover:opacity-100 hover:bg-black/5 hover:text-red-600 focus:opacity-100"
                        aria-label={`Delete ${p.name}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
            <div className="border-t border-line p-2">
              <button
                type="button"
                onClick={addPattern}
                className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-accent hover:bg-accent/5"
              >
                <Plus size={16} /> New pattern
              </button>
            </div>
          </section>

          {/* Arrangement */}
          <section className="min-w-0 flex-1">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <p className="mr-auto text-sm text-muted">
                Drag clips to move · right-click to remove · double-click to edit notes
              </p>
              <label className="flex items-center gap-2 text-sm text-muted">
                Length
                <select
                  value={song.bars}
                  onChange={(e) => {
                    const bars = Number(e.target.value)
                    // Drop clips that would start past the new end.
                    onChange((s) => ({ ...s, bars, clips: s.clips.filter((c) => c.startBar < bars) }))
                  }}
                  className="h-9 rounded-lg border border-line bg-white px-2 text-ink"
                >
                  {SONG_LENGTHS.map((b) => (
                    <option key={b} value={b}>
                      {b} bars
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={song.trackCount >= MAX_TRACKS}
                onClick={() => onChange((s) => ({ ...s, trackCount: s.trackCount + 1 }))}
                className="flex h-9 items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-sm hover:border-line-strong disabled:opacity-40"
              >
                <Plus size={15} /> Track
              </button>
            </div>

            <Playlist
              arrangement={song}
              patterns={song.patterns.map((p) => ({
                id: p.id,
                name: p.name,
                color: getInstrumentPreset(p.instrumentId).color,
                bars: patternBars(p),
                preview: notesPreview(p.notes, p.steps),
              }))}
              selectedPatternId={selectedId}
              onSelectPattern={setSelectedId}
              onChange={(change) => onChange((s) => ({ ...s, ...change(s) }))}
              onOpenPattern={onOpenPattern}
              playStep={playStep}
            />
          </section>
        </div>
      </div>
    </>
  )
}
