import { useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { MAX_BPM, MIN_BPM } from '../audio/types'

/** Editing a partial number must not clamp it before the user finishes typing. */
export function TempoControl({ bpm, setBpm }: { bpm: number; setBpm: Dispatch<SetStateAction<number>> }) {
  const [draft, setDraft] = useState<string | null>(null)
  const taps = useRef<number[]>([])
  function commit() {
    if (draft !== null && draft.trim() !== '' && Number.isFinite(Number(draft))) {
      setBpm(Math.round(Math.max(MIN_BPM, Math.min(MAX_BPM, Number(draft)))))
    }
    setDraft(null)
  }
  function tap() {
    const now = performance.now()
    if (now - (taps.current.at(-1) ?? -Infinity) > 2500) taps.current = []
    taps.current = [...taps.current, now].slice(-4)
    if (taps.current.length < 2) return
    const interval = (now - taps.current[0]) / (taps.current.length - 1)
    const tempo = Math.round(60000 / interval)
    if (tempo >= MIN_BPM && tempo <= MAX_BPM) { setDraft(null); setBpm(tempo) }
  }
  return (
    <div className="aero-well flex shrink-0 items-center gap-1.5 px-2.5 py-1">
      <div className="flex flex-col items-center">
        <span className="text-[9px] font-semibold tracking-wider text-sky-100/60 leading-none">TEMPO</span>
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Decrease tempo" onClick={() => setBpm((value) => Math.max(MIN_BPM, value - 1))} className="aero-pill aero-smoke w-5 h-5 text-xs">-</button>
          <input
            type="number" aria-label="Tempo BPM" min={MIN_BPM} max={MAX_BPM} step={1}
            value={draft ?? bpm} onChange={(event) => setDraft(event.target.value)} onBlur={commit}
            onKeyDown={(event) => { if (event.key === 'Enter') commit(); if (event.key === 'Escape') setDraft(null) }}
            className="aero-lcd w-12 text-center font-mono font-bold text-xs py-0.5 rounded-full outline-none"
          />
          <button type="button" aria-label="Increase tempo" onClick={() => setBpm((value) => Math.min(MAX_BPM, value + 1))} className="aero-pill aero-smoke w-5 h-5 text-xs">+</button>
        </div>
      </div>
      <button type="button" onClick={tap} aria-label="Tap tempo" title="Tap repeatedly to set tempo" className="aero-pill aero-smoke px-2 py-1 text-[10px] tracking-wider">TAP</button>
    </div>
  )
}
