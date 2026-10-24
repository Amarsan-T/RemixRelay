import { useEffect, useRef, type CSSProperties, type PointerEvent } from 'react'
import {
  STEPS_PER_BAR,
  STEPS_PER_BEAT,
  isBlackKey,
  midiToName,
  newNoteId,
  type Note,
} from '../music/types'
import './PianoRoll.css'

const LOWEST = 36 // C2
const HIGHEST = 84 // C6
const CELL_W = 28
const CELL_H = 18
const RESIZE_HANDLE_PX = 8

// Top row is the highest pitch, like every DAW.
const PITCHES = Array.from({ length: HIGHEST - LOWEST + 1 }, (_, i) => HIGHEST - i)

type Props = {
  notes: Note[]
  steps: number
  onChange: (notes: Note[]) => void
  /** Step the playhead is on, or null when stopped. */
  playStep: number | null
  color: string
  onPreview: (pitch: number) => void
}

type Drag =
  | { kind: 'move'; id: string; grabStep: number; grabPitch: number; origin: Note }
  | { kind: 'resize'; id: string; origin: Note }

export function PianoRoll({ notes, steps, onChange, playStep, color, onPreview }: Props) {
  const gridRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  // New notes copy the length of the last note you drew or resized.
  const lastDuration = useRef(2)

  // Start scrolled to around middle C instead of the top of the range.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = (HIGHEST - 74) * CELL_H
  }, [])

  function cellAt(e: PointerEvent): { step: number; pitch: number } {
    const rect = gridRef.current!.getBoundingClientRect()
    const step = Math.floor((e.clientX - rect.left) / CELL_W)
    const row = Math.floor((e.clientY - rect.top) / CELL_H)
    return {
      step: clamp(step, 0, steps - 1),
      pitch: clamp(HIGHEST - row, LOWEST, HIGHEST),
    }
  }

  function update(id: string, patch: Partial<Note>) {
    onChange(notes.map((n) => (n.id === id ? { ...n, ...patch } : n)))
  }

  function onGridPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    const { step, pitch } = cellAt(e)
    const note: Note = {
      id: newNoteId(),
      pitch,
      start: step,
      duration: Math.min(lastDuration.current, steps - step),
      velocity: 0.8,
    }
    onChange([...notes, note])
    onPreview(pitch)
    // Keep dragging after a click to stretch the new note.
    drag.current = { kind: 'resize', id: note.id, origin: note }
    gridRef.current!.setPointerCapture(e.pointerId)
  }

  function onNotePointerDown(e: PointerEvent<HTMLDivElement>, note: Note) {
    e.stopPropagation()
    if (e.button !== 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    if (rect.right - e.clientX <= RESIZE_HANDLE_PX) {
      drag.current = { kind: 'resize', id: note.id, origin: note }
    } else {
      const { step, pitch } = cellAt(e)
      drag.current = { kind: 'move', id: note.id, grabStep: step, grabPitch: pitch, origin: note }
      onPreview(note.pitch)
    }
    gridRef.current!.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current
    if (!d) return
    const { step, pitch } = cellAt(e)
    if (d.kind === 'resize') {
      const duration = clamp(step - d.origin.start + 1, 1, steps - d.origin.start)
      update(d.id, { duration })
      lastDuration.current = duration
    } else {
      const start = clamp(d.origin.start + step - d.grabStep, 0, steps - d.origin.duration)
      const newPitch = clamp(d.origin.pitch + pitch - d.grabPitch, LOWEST, HIGHEST)
      const current = notes.find((n) => n.id === d.id)
      if (current && newPitch !== current.pitch) onPreview(newPitch)
      update(d.id, { start, pitch: newPitch })
    }
  }

  function endDrag() {
    drag.current = null
  }

  function remove(id: string) {
    onChange(notes.filter((n) => n.id !== id))
  }

  const width = steps * CELL_W
  const height = PITCHES.length * CELL_H
  const bars = Math.ceil(steps / STEPS_PER_BAR)

  return (
    <div className="piano-roll" ref={scrollRef} style={{ '--note': color } as CSSProperties}>
      <div
        className="pr-layout"
        style={{ gridTemplateColumns: `var(--key-w) ${width}px` }}
      >
        <div className="pr-corner" />

        <div className="pr-ruler" style={{ width }}>
          {Array.from({ length: bars }, (_, bar) => (
            <span key={bar} style={{ left: bar * STEPS_PER_BAR * CELL_W }}>
              {bar + 1}
            </span>
          ))}
        </div>

        <div className="pr-keys">
          {PITCHES.map((pitch) => (
            <button
              key={pitch}
              type="button"
              className={`pr-key ${isBlackKey(pitch) ? 'black' : 'white'}`}
              style={{ height: CELL_H }}
              onPointerDown={() => onPreview(pitch)}
              aria-label={`Play ${midiToName(pitch)}`}
            >
              {pitch % 12 === 0 ? midiToName(pitch) : ''}
            </button>
          ))}
        </div>

        <div
          className="pr-grid"
          ref={gridRef}
          style={
            {
              width,
              height,
              '--cell-w': `${CELL_W}px`,
              '--beat-w': `${CELL_W * STEPS_PER_BEAT}px`,
              '--bar-w': `${CELL_W * STEPS_PER_BAR}px`,
            } as CSSProperties
          }
          onPointerDown={onGridPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onContextMenu={(e) => e.preventDefault()}
        >
          {PITCHES.map((pitch, row) => (
            <div
              key={pitch}
              className={`pr-row ${isBlackKey(pitch) ? 'black' : ''} ${pitch % 12 === 0 ? 'octave' : ''}`}
              style={{ top: row * CELL_H, height: CELL_H }}
            />
          ))}
          <div className="pr-lines" />

          {notes.map((note) => (
            <div
              key={note.id}
              className="pr-note"
              style={{
                left: note.start * CELL_W,
                top: (HIGHEST - note.pitch) * CELL_H,
                width: note.duration * CELL_W,
                height: CELL_H,
                opacity: 0.45 + note.velocity * 0.55,
              }}
              title={`${midiToName(note.pitch)} — double-click or right-click to delete`}
              onPointerDown={(e) => onNotePointerDown(e, note)}
              onDoubleClick={() => remove(note.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                remove(note.id)
              }}
            >
              {note.duration > 1 && <span>{midiToName(note.pitch)}</span>}
            </div>
          ))}

          {playStep !== null && (
            <div className="pr-playhead" style={{ left: playStep * CELL_W, width: CELL_W }} />
          )}
        </div>
      </div>
    </div>
  )
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}
