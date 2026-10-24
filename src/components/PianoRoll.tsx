import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
} from 'react'
import {
  STEPS_PER_BAR,
  STEPS_PER_BEAT,
  isBlackKey,
  midiToName,
  newId,
  type Note,
} from '../music/types'
import './PianoRoll.css'

const LOWEST = 36 // C2
const HIGHEST = 84 // C6
const RESIZE_HANDLE_PX = 8

// Cell size in pixels. Width is one step (16th note), height is one semitone.
// Ctrl + wheel zooms the width, Ctrl + middle-button drag zooms the height.
const DEFAULT_CELL_W = 28
const DEFAULT_CELL_H = 18
const MIN_CELL_W = 8
const MAX_CELL_W = 96
const MIN_CELL_H = 8
const MAX_CELL_H = 40
/** How fast the wheel zooms: one mouse-wheel notch (deltaY 100) is about 22%. */
const WHEEL_ZOOM_SPEED = 0.002
/** How fast dragging zooms: 100px of mouse travel is about 2.7x. */
const DRAG_ZOOM_SPEED = 0.01

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

/** State for a Ctrl + middle-button vertical zoom in progress. */
type VerticalZoom = { startY: number; startCellH: number }

export function PianoRoll({ notes, steps, onChange, playStep, color, onPreview }: Props) {
  const gridRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const verticalZoom = useRef<VerticalZoom | null>(null)
  // New notes copy the length of the last note you drew or resized.
  const lastDuration = useRef(2)

  const [cellW, setCellW] = useState(DEFAULT_CELL_W)
  const [cellH, setCellH] = useState(DEFAULT_CELL_H)
  // The wheel listener is set up once, so it reads the current size from here.
  const cellWRef = useRef(cellW)
  const cellHRef = useRef(cellH)
  // Scroll position to apply right after a zoom re-renders the grid.
  const pendingScroll = useRef<{ left?: number; top?: number } | null>(null)

  // Start scrolled to around middle C instead of the top of the range.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = (HIGHEST - 74) * DEFAULT_CELL_H
  }, [])

  // After a zoom changes the grid size, scroll so the spot you zoomed on stays
  // under the mouse. Layout effect = runs before the browser paints, so no flicker.
  useLayoutEffect(() => {
    cellWRef.current = cellW
    cellHRef.current = cellH
    const el = scrollRef.current
    const pending = pendingScroll.current
    if (!el || !pending) return
    if (pending.left !== undefined) el.scrollLeft = pending.left
    if (pending.top !== undefined) el.scrollTop = pending.top
    pendingScroll.current = null
  }, [cellW, cellH])

  /** Changes the cell width, keeping the step under clientX in place. */
  function zoomHorizontal(newW: number, clientX: number) {
    const el = scrollRef.current!
    const oldW = cellWRef.current
    newW = clamp(newW, MIN_CELL_W, MAX_CELL_W)
    if (newW === oldW) return
    // Mouse distance from the grid's left edge, which grows by newW / oldW.
    const x = clientX - gridRef.current!.getBoundingClientRect().left
    pendingScroll.current = { left: el.scrollLeft + x * (newW / oldW - 1) }
    cellWRef.current = newW
    setCellW(newW)
  }

  /** Changes the cell height, keeping the pitch under clientY in place. */
  function zoomVertical(newH: number, clientY: number) {
    const el = scrollRef.current!
    const oldH = cellHRef.current
    newH = clamp(newH, MIN_CELL_H, MAX_CELL_H)
    if (newH === oldH) return
    const y = clientY - gridRef.current!.getBoundingClientRect().top
    pendingScroll.current = { top: el.scrollTop + y * (newH / oldH - 1) }
    cellHRef.current = newH
    setCellH(newH)
  }

  // Ctrl + wheel. React's onWheel can't stop the browser's own Ctrl + wheel page
  // zoom (its listener is "passive"), so attach a native listener that can.
  useEffect(() => {
    const el = scrollRef.current!
    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey) return // plain wheel keeps scrolling normally
      e.preventDefault()
      // deltaMode 1 means the browser reports lines instead of pixels.
      const delta = clamp(e.deltaY * (e.deltaMode === 1 ? 33 : 1), -100, 100)
      // Wheel up gives negative deltaY, which makes the factor > 1 (zoom in).
      zoomHorizontal(cellWRef.current * Math.exp(-delta * WHEEL_ZOOM_SPEED), e.clientX)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // Empty deps is safe: zoomHorizontal only touches refs and setters, never stale state.
  }, [])

  // Ctrl + hold the middle button (wheel) + move the mouse up/down.
  function onRollPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 1 || !e.ctrlKey) return
    e.preventDefault()
    verticalZoom.current = { startY: e.clientY, startCellH: cellHRef.current }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onRollPointerMove(e: PointerEvent<HTMLDivElement>) {
    const z = verticalZoom.current
    if (!z) return
    // Moving up makes startY - clientY positive, so the rows get taller.
    const factor = Math.exp((z.startY - e.clientY) * DRAG_ZOOM_SPEED)
    zoomVertical(z.startCellH * factor, z.startY)
  }

  function endVerticalZoom() {
    verticalZoom.current = null
  }

  // Stops Windows' middle-click autoscroll (the round arrows icon) from starting.
  function blockMiddleClick(e: MouseEvent) {
    if (e.button === 1) e.preventDefault()
  }

  function cellAt(e: PointerEvent): { step: number; pitch: number } {
    const rect = gridRef.current!.getBoundingClientRect()
    const step = Math.floor((e.clientX - rect.left) / cellW)
    const row = Math.floor((e.clientY - rect.top) / cellH)
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
      id: newId(),
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
    // Let other buttons bubble up, so Ctrl + middle-drag zooms over notes too.
    if (e.button !== 0) return
    e.stopPropagation()
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

  const width = steps * cellW
  const height = PITCHES.length * cellH
  const bars = Math.ceil(steps / STEPS_PER_BAR)

  return (
    <div
      className="piano-roll"
      ref={scrollRef}
      style={{ '--note': color } as CSSProperties}
      onPointerDown={onRollPointerDown}
      onPointerMove={onRollPointerMove}
      onPointerUp={endVerticalZoom}
      onPointerCancel={endVerticalZoom}
      onMouseDown={blockMiddleClick}
    >
      <div
        className="pr-layout"
        style={{ gridTemplateColumns: `var(--key-w) ${width}px` }}
      >
        <div className="pr-corner" />

        <div className="pr-ruler" style={{ width }}>
          {Array.from({ length: bars }, (_, bar) => (
            <span key={bar} style={{ left: bar * STEPS_PER_BAR * cellW }}>
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
              style={{ height: cellH }}
              onPointerDown={(e) => e.button === 0 && onPreview(pitch)}
              aria-label={`Play ${midiToName(pitch)}`}
            >
              {pitch % 12 === 0 && cellH >= 12 ? midiToName(pitch) : ''}
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
              '--cell-w': `${cellW}px`,
              '--beat-w': `${cellW * STEPS_PER_BEAT}px`,
              '--bar-w': `${cellW * STEPS_PER_BAR}px`,
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
              style={{ top: row * cellH, height: cellH }}
            />
          ))}
          <div className="pr-lines" />

          {notes.map((note) => (
            <div
              key={note.id}
              className="pr-note"
              style={{
                left: note.start * cellW,
                top: (HIGHEST - note.pitch) * cellH,
                width: note.duration * cellW,
                height: cellH,
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
              {/* Only label notes with room for the text. */}
              {note.duration * cellW >= 28 && cellH >= 12 && <span>{midiToName(note.pitch)}</span>}
            </div>
          ))}

          {playStep !== null && (
            <div className="pr-playhead" style={{ left: playStep * cellW, width: cellW }} />
          )}
        </div>
      </div>
    </div>
  )
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}
