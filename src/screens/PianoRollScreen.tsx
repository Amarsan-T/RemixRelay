import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Play, Square, Trash2 } from 'lucide-react'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { PianoRoll } from '../components/PianoRoll'
import * as engine from '../music/engine'
import { INSTRUMENT_PRESETS, LOOP_PRESETS, getInstrumentPreset, loopNotes } from '../music/presets'
import { STEPS_PER_BAR, type Pattern, type Song } from '../music/types'

type Props = {
  song: Song
  pattern: Pattern
  onChangePattern: (change: (pattern: Pattern) => Pattern) => void
  /** For the tempo, which belongs to the whole song. */
  onChangeSong: (change: (song: Song) => Song) => void
  onHome: () => void
  /** Back to the song's playlist. */
  onBack: () => void
}

const BAR_OPTIONS = [1, 2, 4, 8]

// Edits the notes of one pattern. Changes show up in the playlist right away,
// in every clip that uses this pattern.
export function PianoRollScreen({ song, pattern, onChangePattern, onChangeSong, onHome, onBack }: Props) {
  const [playing, setPlaying] = useState(false)
  const [playStep, setPlayStep] = useState<number | null>(null)

  // The audio loop reads the latest notes through this ref.
  const timelineRef = useRef(engine.patternTimeline(pattern))
  useEffect(() => {
    timelineRef.current = engine.patternTimeline(pattern)
  }, [pattern])

  useEffect(() => engine.setBpm(song.bpm), [song.bpm])
  useEffect(() => engine.warmUp([pattern.instrumentId]), [pattern.instrumentId])
  useEffect(() => () => engine.stop(), [])

  function togglePlay() {
    if (playing) {
      engine.stop()
      setPlaying(false)
      setPlayStep(null)
      return
    }
    // Not awaited: the transport starts counting once the browser resumes audio,
    // and the button responds immediately either way.
    void engine.unlockAudio()
    engine.start(() => timelineRef.current, setPlayStep)
    setPlaying(true)
  }

  function preview(pitch: number) {
    void engine.unlockAudio()
    engine.previewNote(pattern.instrumentId, pitch)
  }

  function loadLoop(id: string) {
    const loop = LOOP_PRESETS.find((l) => l.id === id)
    if (!loop) return
    onChangePattern((p) => ({ ...p, steps: loop.steps, notes: loopNotes(loop), instrumentId: loop.instrumentId }))
  }

  function setBars(bars: number) {
    const steps = bars * STEPS_PER_BAR
    // Drop notes that start past the new end and trim ones that hang over it.
    onChangePattern((p) => ({
      ...p,
      steps,
      notes: p.notes
        .filter((n) => n.start < steps)
        .map((n) => ({ ...n, duration: Math.min(n.duration, steps - n.start) })),
    }))
  }

  const instrument = getInstrumentPreset(pattern.instrumentId)
  const field = 'h-9 rounded-lg border border-line bg-white px-2 text-sm text-ink'

  return (
    <>
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-canvas/90 px-4 py-3 backdrop-blur sm:px-8">
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg p-1.5 text-muted hover:bg-black/5 hover:text-ink"
          aria-label="Back to playlist"
        >
          <ArrowLeft size={18} />
        </button>
        <Breadcrumbs
          items={[
            { label: 'Home', onClick: onHome },
            { label: song.name, onClick: onBack },
            { label: pattern.name },
          ]}
        />
      </header>

      <div className="px-4 py-6 sm:px-8">
        <input
          value={pattern.name}
          onChange={(e) => onChangePattern((p) => ({ ...p, name: e.target.value }))}
          aria-label="Pattern name"
          className="-ml-2 w-full max-w-xl rounded-lg bg-transparent px-2 py-1 text-3xl font-semibold outline-none hover:bg-black/[.03] focus:bg-white"
        />

        <div className="mt-5 flex flex-wrap items-end gap-3">
          <button
            type="button"
            onClick={togglePlay}
            className={`grid size-11 place-items-center rounded-full text-white transition ${playing ? 'bg-red-500 hover:bg-red-600' : 'bg-accent hover:bg-accent-hover'}`}
            aria-label={playing ? 'Stop' : 'Play pattern'}
          >
            {playing ? <Square size={18} /> : <Play size={18} />}
          </button>

          <label className="flex flex-col gap-1 text-xs text-muted">
            Instrument
            <select
              value={pattern.instrumentId}
              onChange={(e) => onChangePattern((p) => ({ ...p, instrumentId: e.target.value }))}
              className={field}
            >
              {INSTRUMENT_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs text-muted">
            Starter loop
            {/* Always shows the placeholder: picking a loop replaces the notes. */}
            <select value="" onChange={(e) => loadLoop(e.target.value)} className={field}>
              <option value="" disabled>
                Load a loop…
              </option>
              {LOOP_PRESETS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs text-muted">
            BPM
            <input
              type="number"
              min={40}
              max={220}
              value={song.bpm}
              onChange={(e) => {
                const bpm = Number(e.target.value)
                if (bpm >= 40 && bpm <= 220) onChangeSong((s) => ({ ...s, bpm }))
              }}
              className={`${field} w-18`}
            />
          </label>

          <label className="flex flex-col gap-1 text-xs text-muted">
            Bars
            <select
              value={pattern.steps / STEPS_PER_BAR}
              onChange={(e) => setBars(Number(e.target.value))}
              className={field}
            >
              {BAR_OPTIONS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={() => onChangePattern((p) => ({ ...p, notes: [] }))}
            className="ml-auto flex h-9 items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-sm hover:border-line-strong"
          >
            <Trash2 size={15} /> Clear
          </button>
        </div>

        <p className="mt-4 mb-3 flex items-center gap-2 text-sm text-muted">
          <span className="size-3 shrink-0 rounded-sm" style={{ background: instrument.color }} />
          {instrument.name}: {instrument.description}. Click to draw, drag to move or stretch,
          double-click or right-click to delete. Ctrl + wheel zooms time, Ctrl + middle-drag zooms pitch.
        </p>

        <PianoRoll
          notes={pattern.notes}
          steps={pattern.steps}
          onChange={(notes) => onChangePattern((p) => ({ ...p, notes }))}
          playStep={playStep}
          color={instrument.color}
          onPreview={preview}
        />
      </div>
    </>
  )
}
