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

/** New notes start at 50 out of 100. */
const DEFAULT_VELOCITY = 0.5
/** Mouse travel for the full 0-100 velocity range when dragging a slider. */
const VELOCITY_DRAG_PX = 150
/** Gap between a note's edge and its velocity slider. */
const SLIDER_INSET = 3

// Top row is the highest pitch, like every DAW.
const PITCHES = Array.from({ length: HIGHEST - LOWEST + 1 }, (_, i) => HIGHEST - i)

type Props = {
  notes: Note[]
  steps: number
  onChange: (notes: Note[]) => void
  /** Step the playhead is on, or null when stopped. */
  playStep: number | null
  color: string
  onPreview: (pitch: number, velocity?: number) => void
  /** 'notes' draws and moves notes; 'velocity' locks them and edits loudness instead. */
  mode: PianoRollMode
}

export type PianoRollMode = 'notes' | 'velocity'

type Drag =
  | { kind: 'move'; id: string; grabStep: number; grabPitch: number; origin: Note }
  | { kind: 'resize'; id: string; origin: Note }

/** A velocity slider drag. Every selected note moves by the same amount from where it started. */
type VelocityDrag = { grabbedId: string; startX: number; startY: number; start: Map<string, number> }

/** Box selection on empty grid space, in grid pixels. */
type Marquee = { x0: number; y0: number; x1: number; y1: number; additive: boolean }

/** State for a Ctrl + middle-button vertical zoom in progress. */
type VerticalZoom = { startY: number; startCellH: number }

export function PianoRoll({ notes, steps, onChange, playStep, color, onPreview, mode }: Props) {
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

  // Velocity mode: which notes are selected, and any drag in progress.
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  // The box lives in a ref for the pointer handlers (always current, even between
  // renders) and in state so it gets drawn.
  const [marquee, setMarquee] = useState<Marquee | null>(null)
  const marqueeRef = useRef<Marquee | null>(null)
  const setBox = (box: Marquee | null) => {
    marqueeRef.current = box
    setMarquee(box)
  }
  const velocityDrag = useRef<VelocityDrag | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)

  // Velocity mode shortcuts: Ctrl+A selects every note, Escape clears.
  useEffect(() => {
    if (mode !== 'velocity') return
    function onKey(e: KeyboardEvent) {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement
      if (typing) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        setSelected(new Set(notes.map((n) => n.id)))
      } else if (e.key === 'Escape') {
        setSelected(new Set())
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, notes])

  // Start scrolled to around middle C instead of the top of the range, and
  // widen the steps so a short pattern fills the space instead of half of it.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = (HIGHEST - 74) * DEFAULT_CELL_H
    const keysWidth = el.querySelector('.pr-keys')?.clientWidth ?? 0
    const fit = Math.floor((el.clientWidth - keysWidth) / steps)
    if (fit > DEFAULT_CELL_W) setCellW(Math.min(fit, MAX_CELL_W))
    // Only on first show; after that the width is yours to zoom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (mode === 'velocity') {
      startMarquee(e)
      return
    }
    const { step, pitch } = cellAt(e)
    const note: Note = {
      id: newId(),
      pitch,
      start: step,
      duration: Math.min(lastDuration.current, steps - step),
      velocity: DEFAULT_VELOCITY,
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
    // Keep click/double-click targeted at the note while moves still bubble.
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  // ---- Velocity mode ------------------------------------------------------

  /** Grid position of the pointer in pixels. */
  function gridPoint(e: PointerEvent) {
    const rect = gridRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function startMarquee(e: PointerEvent<HTMLDivElement>) {
    const { x, y } = gridPoint(e)
    const additive = e.shiftKey || e.ctrlKey || e.metaKey
    setBox({ x0: x, y0: y, x1: x, y1: y, additive })
    gridRef.current!.setPointerCapture(e.pointerId)
  }

  /** Notes touching the box. */
  function notesInBox(box: Marquee): Set<string> {
    const left = Math.min(box.x0, box.x1)
    const right = Math.max(box.x0, box.x1)
    const top = Math.min(box.y0, box.y1)
    const bottom = Math.max(box.y0, box.y1)
    const hit = notes.filter((n) => {
      const nLeft = n.start * cellW
      const nTop = (HIGHEST - n.pitch) * cellH
      return nLeft < right && nLeft + n.duration * cellW > left && nTop < bottom && nTop + cellH > top
    })
    return new Set(hit.map((n) => n.id))
  }

  function onVelocityPointerDown(e: PointerEvent<HTMLDivElement>, note: Note) {
    if (e.button !== 0) return
    e.stopPropagation()

    // Shift/Ctrl+click adds a note to the selection, or removes it if already in.
    let ids: Set<string>
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      ids = new Set(selected)
      if (ids.has(note.id)) {
        ids.delete(note.id)
        setSelected(ids)
        return
      }
      ids.add(note.id)
    } else {
      // Grabbing a selected note edits the whole selection; anything else selects just it.
      ids = selected.has(note.id) ? selected : new Set([note.id])
    }
    setSelected(ids)

    const start = new Map(notes.filter((n) => ids.has(n.id)).map((n) => [n.id, n.velocity]))
    // With one note, clicking the slider jumps straight to that spot.
    if (ids.size === 1) {
      const rect = e.currentTarget.getBoundingClientRect()
      const usable = rect.width - SLIDER_INSET * 2
      const velocity = roundVelocity((e.clientX - rect.left - SLIDER_INSET) / usable)
      start.set(note.id, velocity)
      onChange(notes.map((n) => (n.id === note.id ? { ...n, velocity } : n)))
    }
    velocityDrag.current = { grabbedId: note.id, startX: e.clientX, startY: e.clientY, start }
    setDraggingId(note.id)
    gridRef.current!.setPointerCapture(e.pointerId)
  }

  function onVelocityMove(e: PointerEvent<HTMLDivElement>) {
    const v = velocityDrag.current
    if (!v) return
    // Right or up raises velocity; left or down lowers it.
    const delta = (e.clientX - v.startX - (e.clientY - v.startY)) / VELOCITY_DRAG_PX
    onChange(
      notes.map((n) => {
        const from = v.start.get(n.id)
        return from === undefined ? n : { ...n, velocity: roundVelocity(from + delta) }
      }),
    )
  }

  function endVelocityDrag() {
    const v = velocityDrag.current
    if (v) {
      // Let you hear the new loudness of the note you grabbed.
      const grabbed = notes.find((n) => n.id === v.grabbedId)
      if (grabbed) onPreview(grabbed.pitch, grabbed.velocity)
    }
    velocityDrag.current = null
    setDraggingId(null)
    const box = marqueeRef.current
    if (box) {
      const inBox = notesInBox(box)
      setSelected(box.additive ? new Set([...selected, ...inBox]) : inBox)
      setBox(null)
    }
  }

  // ---- Shared pointer handling ---------------------------------------------

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (mode === 'velocity') {
      const box = marqueeRef.current
      if (box) {
        const { x, y } = gridPoint(e)
        setBox({ ...box, x1: x, y1: y })
      } else {
        onVelocityMove(e)
      }
      return
    }
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
    endVelocityDrag()
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

          {notes.map((note) => {
            const position = {
              left: note.start * cellW,
              top: (HIGHEST - note.pitch) * cellH,
              width: note.duration * cellW,
              height: cellH,
            }
            const velocityLabel = Math.round(note.velocity * 100)

            if (mode === 'velocity') {
              return (
                <div
                  key={note.id}
                  className={`pr-note locked ${selected.has(note.id) ? 'selected' : ''}`}
                  style={position}
                  title={`${midiToName(note.pitch)} — velocity ${velocityLabel}`}
                  onPointerDown={(e) => onVelocityPointerDown(e, note)}
                >
                  <div className="pr-velocity" style={{ insetInline: SLIDER_INSET }}>
                    <div className="pr-velocity-fill" style={{ width: `${note.velocity * 100}%` }} />
                  </div>
                  {draggingId === note.id && <span className="pr-velocity-badge">{velocityLabel}</span>}
                </div>
              )
            }

            return (
              <div
                key={note.id}
                className="pr-note"
                // Fainter notes are quieter.
                style={{ ...position, opacity: 0.45 + note.velocity * 0.55 }}
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
            )
          })}

          {marquee && (
            <div
              className="pr-marquee"
              style={{
                left: Math.min(marquee.x0, marquee.x1),
                top: Math.min(marquee.y0, marquee.y1),
                width: Math.abs(marquee.x1 - marquee.x0),
                height: Math.abs(marquee.y1 - marquee.y0),
              }}
            />
          )}

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

/** Keeps velocity between 0 and 1, in whole steps of 1/100. */
function roundVelocity(v: number) {
  return Math.round(clamp(v, 0, 1) * 100) / 100
}
