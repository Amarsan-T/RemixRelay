import { useRef, type PointerEvent } from 'react'
import { getInstrumentPreset } from '../music/presets'
import { STEPS_PER_BAR, newId, patternBars, type Clip, type Pattern, type Song } from '../music/types'

const BAR_W = 48 // pixels per bar
const TRACK_H = 52 // pixels per track row
const HEADER_W = 104 // track name column
const RULER_H = 24

type Props = {
  song: Song
  /** Pattern that clicking the grid places. */
  selectedPatternId: string | null
  onSelectPattern: (patternId: string) => void
  onChange: (change: (song: Song) => Song) => void
  onOpenPattern: (patternId: string) => void
  /** Step the playhead is on, or null when stopped. */
  playStep: number | null
}

type ClipDrag = { id: string; grabBar: number; grabTrack: number; origin: Clip }

// The arrangement grid: tracks are rows, bars are columns, and each clip is
// one placement of a pattern. Works like FL Studio's playlist.
export function Playlist({
  song,
  selectedPatternId,
  onSelectPattern,
  onChange,
  onOpenPattern,
  playStep,
}: Props) {
  const gridRef = useRef<HTMLDivElement>(null)
  const drag = useRef<ClipDrag | null>(null)
  const patterns = new Map(song.patterns.map((p) => [p.id, p]))

  const lengthOf = (clip: Clip) => {
    const pattern = patterns.get(clip.patternId)
    return pattern ? patternBars(pattern) : 1
  }

  function cellAt(e: PointerEvent): { bar: number; track: number } {
    const rect = gridRef.current!.getBoundingClientRect()
    return {
      bar: clamp(Math.floor((e.clientX - rect.left) / BAR_W), 0, song.bars - 1),
      track: clamp(Math.floor((e.clientY - rect.top) / TRACK_H), 0, song.trackCount - 1),
    }
  }

  function onGridPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    const pattern = selectedPatternId ? patterns.get(selectedPatternId) : undefined
    if (!pattern) return
    const { bar, track } = cellAt(e)
    const clip: Clip = {
      id: newId(),
      patternId: pattern.id,
      track,
      startBar: clamp(bar, 0, Math.max(0, song.bars - patternBars(pattern))),
    }
    onChange((s) => ({ ...s, clips: [...s.clips, clip] }))
    // Keep holding to slide the new clip into place.
    drag.current = { id: clip.id, grabBar: bar, grabTrack: track, origin: clip }
    gridRef.current!.setPointerCapture(e.pointerId)
  }

  function onClipPointerDown(e: PointerEvent<HTMLDivElement>, clip: Clip) {
    if (e.button !== 0) return
    e.stopPropagation()
    // Clicking a clip also picks its pattern for the next placement, like FL Studio.
    onSelectPattern(clip.patternId)
    const { bar, track } = cellAt(e)
    drag.current = { id: clip.id, grabBar: bar, grabTrack: track, origin: clip }
    gridRef.current!.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current
    if (!d) return
    const { bar, track } = cellAt(e)
    const startBar = clamp(d.origin.startBar + bar - d.grabBar, 0, Math.max(0, song.bars - lengthOf(d.origin)))
    const newTrack = clamp(d.origin.track + track - d.grabTrack, 0, song.trackCount - 1)
    const current = song.clips.find((c) => c.id === d.id)
    if (current && current.startBar === startBar && current.track === newTrack) return
    onChange((s) => ({
      ...s,
      clips: s.clips.map((c) => (c.id === d.id ? { ...c, startBar, track: newTrack } : c)),
    }))
  }

  function endDrag() {
    drag.current = null
  }

  function remove(id: string) {
    onChange((s) => ({ ...s, clips: s.clips.filter((c) => c.id !== id) }))
  }

  const width = song.bars * BAR_W
  const height = song.trackCount * TRACK_H

  return (
    <div className="max-h-[560px] overflow-auto rounded-xl border border-[#2e303a] bg-[#1b1c24] select-none">
      <div
        className="grid w-max"
        style={{ gridTemplateColumns: `${HEADER_W}px ${width}px`, gridTemplateRows: `${RULER_H}px ${height}px` }}
      >
        <div className="sticky top-0 left-0 z-30 border-b border-r border-[#2e303a] bg-[#23242e]" />

        <div className="sticky top-0 z-20 border-b border-[#2e303a] bg-[#23242e]">
          {Array.from({ length: song.bars }, (_, bar) => (
            <span
              key={bar}
              className={`absolute top-1 pl-1.5 font-mono text-[11px] ${bar % 4 === 0 ? 'text-[#c9cad3]' : 'text-[#6b6d7a]'}`}
              style={{ left: bar * BAR_W }}
            >
              {bar + 1}
            </span>
          ))}
        </div>

        <div className="sticky left-0 z-10 border-r border-[#2e303a] bg-[#23242e]">
          {Array.from({ length: song.trackCount }, (_, track) => (
            <div
              key={track}
              className="flex items-center border-b border-white/5 px-3 text-xs text-[#c9cad3]"
              style={{ height: TRACK_H }}
            >
              Track {track + 1}
            </div>
          ))}
        </div>

        <div
          ref={gridRef}
          className={`relative ${selectedPatternId ? 'cursor-copy' : 'cursor-default'}`}
          style={{
            width,
            height,
            backgroundImage: [
              `repeating-linear-gradient(to right, rgba(255,255,255,.2) 0 1px, transparent 1px ${BAR_W * 4}px)`,
              `repeating-linear-gradient(to right, rgba(255,255,255,.06) 0 1px, transparent 1px ${BAR_W}px)`,
              `repeating-linear-gradient(to bottom, transparent 0 ${TRACK_H - 1}px, rgba(255,255,255,.06) ${TRACK_H - 1}px ${TRACK_H}px)`,
            ].join(','),
          }}
          onPointerDown={onGridPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onContextMenu={(e) => e.preventDefault()}
        >
          {song.clips.map((clip) => {
            const pattern = patterns.get(clip.patternId)
            if (!pattern) return null
            const selected = clip.patternId === selectedPatternId
            return (
              <div
                key={clip.id}
                className={`absolute cursor-grab overflow-hidden rounded-md border active:cursor-grabbing ${selected ? 'border-white/80' : 'border-black/30'}`}
                style={{
                  left: clip.startBar * BAR_W + 1,
                  top: clip.track * TRACK_H + 2,
                  width: patternBars(pattern) * BAR_W - 2,
                  height: TRACK_H - 4,
                  background: getInstrumentPreset(pattern.instrumentId).color,
                }}
                title={`${pattern.name}: double-click to edit notes, right-click to remove`}
                onPointerDown={(e) => onClipPointerDown(e, clip)}
                onDoubleClick={() => onOpenPattern(pattern.id)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  remove(clip.id)
                }}
              >
                <span className="pointer-events-none absolute top-0.5 left-1.5 truncate text-[11px] font-medium text-black/75">
                  {pattern.name}
                </span>
                <ClipPreview pattern={pattern} />
              </div>
            )
          })}

          {playStep !== null && (
            <div
              className="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-white"
              style={{ left: (playStep / STEPS_PER_BAR) * BAR_W }}
            />
          )}
        </div>
      </div>
    </div>
  )
}

/** Tiny drawing of the pattern's notes inside its clip. */
function ClipPreview({ pattern }: { pattern: Pattern }) {
  if (pattern.notes.length === 0) return null
  const pitches = pattern.notes.map((n) => n.pitch)
  const low = Math.min(...pitches)
  const high = Math.max(...pitches)
  return (
    <div className="pointer-events-none absolute inset-x-1 top-[18px] bottom-1">
      <svg
        className="size-full"
        viewBox={`0 0 ${pattern.steps} ${high - low + 1}`}
        preserveAspectRatio="none"
      >
        {pattern.notes.map((n) => (
          <rect
            key={n.id}
            x={n.start}
            y={high - n.pitch}
            width={n.duration}
            height={1}
            fill="rgba(0,0,0,.45)"
          />
        ))}
      </svg>
    </div>
  )
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}
