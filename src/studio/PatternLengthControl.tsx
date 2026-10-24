import { useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { Minus, Plus } from 'lucide-react'
import { MAX_PATTERN_STEPS, patternLength } from './patternAdapter'
import type { PianoNotes, StepData, StudioProject } from './types'

type Props = {
  project: StudioProject
  pattern: number
  setPatternSteps: Dispatch<SetStateAction<Record<number, number> | undefined>>
  setStepData: Dispatch<SetStateAction<StepData>>
  setPianoNotes: Dispatch<SetStateAction<PianoNotes>>
}

/** "Length − [16] + steps": how long a pattern runs before it loops. Any number of steps. */
export function PatternLengthControl({ project, pattern, setPatternSteps, setStepData, setPianoNotes }: Props) {
  const length = patternLength(project, pattern)
  // What's typed is only applied on Enter or leaving the box: applying "2" on the
  // way to typing "24" would delete every note after step 2.
  const [draft, setDraft] = useState<string | null>(null)

  function apply(next: number) {
    const steps = Math.max(1, Math.min(MAX_PATTERN_STEPS, Math.round(next)))
    setDraft(null)
    if (steps === length) return
    setPatternSteps((prev) => ({ ...prev, [pattern]: steps }))
    // Shortening drops whatever falls past the new end.
    setStepData((prev) => ({
      ...prev,
      [pattern]: Object.fromEntries(Object.entries(prev[pattern] ?? {}).map(([id, gates]) => [id, gates.slice(0, steps)])),
    }))
    setPianoNotes((prev) => ({
      ...prev,
      [pattern]: Object.fromEntries(Object.entries(prev[pattern] ?? {}).map(([id, notes]) => [
        id,
        notes.filter((n) => n.step < steps).map((n) => ({ ...n, length: Math.min(n.length, steps - n.step) })),
      ])),
    }))
  }

  /** Applies what was typed; anything that isn't a positive number puts the old length back. */
  function commit() {
    if (draft === null) return
    if (Number(draft) > 0) apply(Number(draft))
    else setDraft(null)
  }

  const button = 'grid h-5 w-5 place-items-center rounded text-zinc-400 hover:bg-zinc-700 hover:text-orange-400 disabled:opacity-30'
  return (
    <div className="flex items-center gap-1 text-[11px] font-mono text-zinc-400" title="Steps before the pattern loops (16 = one bar)">
      <span>Length</span>
      {/* − and + move one beat (4 steps) at a time. */}
      <button type="button" aria-label="Shorter pattern" disabled={length <= 1} onClick={() => apply(Math.ceil(length / 4) * 4 - 4 || 1)} className={button}>
        <Minus className="h-3 w-3" />
      </button>
      <input
        type="number"
        min={1}
        max={MAX_PATTERN_STEPS}
        aria-label="Pattern length in steps"
        value={draft ?? String(length)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setDraft(null)
        }}
        className="h-6 w-12 rounded border border-zinc-700 bg-zinc-900 px-1 text-center font-bold text-orange-400 outline-none"
      />
      <button type="button" aria-label="Longer pattern" disabled={length >= MAX_PATTERN_STEPS} onClick={() => apply(Math.floor(length / 4) * 4 + 4)} className={button}>
        <Plus className="h-3 w-3" />
      </button>
      <span>steps</span>
      {length % 16 === 0 && length > 16 && <span className="text-zinc-500">({length / 16} bars)</span>}
    </div>
  )
}
