import { useEffect, useRef, useState } from 'react'
import { Play, Square, Trash2 } from 'lucide-react'
import { PianoRoll } from './PianoRoll'
import * as engine from '../music/engine'
import {
  EMPTY_PATTERN,
  INSTRUMENT_PRESETS,
  LOOP_PRESETS,
  clonePattern,
  getInstrumentPreset,
} from '../music/presets'
import { STEPS_PER_BAR, type Pattern } from '../music/types'
import './Studio.css'

const BAR_OPTIONS = [1, 2, 4, 8]

export function Studio() {
  const [pattern, setPattern] = useState<Pattern>(() => clonePattern(LOOP_PRESETS[0].pattern))
  const [instrumentId, setInstrumentId] = useState(LOOP_PRESETS[0].instrumentId)
  const [loopId, setLoopId] = useState(LOOP_PRESETS[0].id)
  const [playing, setPlaying] = useState(false)
  const [playStep, setPlayStep] = useState<number | null>(null)

  // The audio loop reads the latest pattern through this ref.
  const patternRef = useRef(pattern)
  useEffect(() => {
    patternRef.current = pattern
  }, [pattern])

  useEffect(() => {
    engine.setInstrument(instrumentId)
  }, [instrumentId])

  useEffect(() => {
    engine.setBpm(pattern.bpm)
  }, [pattern.bpm])

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
    engine.start(() => patternRef.current, setPlayStep)
    setPlaying(true)
  }

  function preview(pitch: number) {
    void engine.unlockAudio()
    engine.previewNote(pitch)
  }

  function loadLoop(id: string) {
    setLoopId(id)
    if (id === 'empty') {
      setPattern({ ...clonePattern(EMPTY_PATTERN), bpm: pattern.bpm })
      return
    }
    const loop = LOOP_PRESETS.find((l) => l.id === id)!
    setPattern(clonePattern(loop.pattern))
    setInstrumentId(loop.instrumentId)
  }

  function setBars(bars: number) {
    const steps = bars * STEPS_PER_BAR
    // Drop notes that start past the new end and trim ones that hang over it.
    const notes = pattern.notes
      .filter((n) => n.start < steps)
      .map((n) => ({ ...n, duration: Math.min(n.duration, steps - n.start) }))
    setPattern({ ...pattern, steps, notes })
  }

  const instrument = getInstrumentPreset(instrumentId)

  return (
    <section className="studio">
      <header className="studio-bar">
        <button
          type="button"
          className={`studio-play ${playing ? 'on' : ''}`}
          onClick={togglePlay}
          aria-label={playing ? 'Stop' : 'Play'}
        >
          {playing ? <Square size={18} /> : <Play size={18} />}
        </button>

        <label className="studio-field">
          <span>Loop preset</span>
          <select value={loopId} onChange={(e) => loadLoop(e.target.value)}>
            {LOOP_PRESETS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
            <option value="empty">Empty</option>
          </select>
        </label>

        <label className="studio-field">
          <span>Instrument</span>
          <select value={instrumentId} onChange={(e) => setInstrumentId(e.target.value)}>
            {INSTRUMENT_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <label className="studio-field studio-bpm">
          <span>BPM</span>
          <input
            type="number"
            min={40}
            max={220}
            value={pattern.bpm}
            onChange={(e) => {
              const bpm = Number(e.target.value)
              if (bpm >= 40 && bpm <= 220) setPattern({ ...pattern, bpm })
            }}
          />
        </label>

        <label className="studio-field">
          <span>Bars</span>
          <select
            value={pattern.steps / STEPS_PER_BAR}
            onChange={(e) => setBars(Number(e.target.value))}
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
          className="studio-clear"
          onClick={() => setPattern({ ...pattern, notes: [] })}
        >
          <Trash2 size={16} /> Clear
        </button>
      </header>

      <p className="studio-hint">
        <span className="studio-swatch" style={{ background: instrument.color }} />
        {instrument.name} — {instrument.description}. Click to draw, drag to move or stretch,
        double-click or right-click to delete.
      </p>

      <PianoRoll
        notes={pattern.notes}
        steps={pattern.steps}
        onChange={(notes) => setPattern((p) => ({ ...p, notes }))}
        playStep={playStep}
        color={instrument.color}
        onPreview={preview}
      />
    </section>
  )
}
