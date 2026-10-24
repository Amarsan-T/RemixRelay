import { useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { Music } from 'lucide-react'
import { PianoRoll, type PianoRollMode } from '../components/PianoRoll'
import { midiToName, nameToMidi, type Note } from '../music/types'
import { STEP_COUNT } from '../audio/types'
import { defaultHit } from './patternAdapter'
import type { PianoNotes, StepData, StudioChannel, StudioProject } from './types'

type Props = {
  project: StudioProject
  activePattern: number
  selectedChannelId: string
  onSelectChannel: (channelId: string) => void
  setPianoNotes: Dispatch<SetStateAction<PianoNotes>>
  setStepData: Dispatch<SetStateAction<StepData>>
  preview: (channelId: string, pitch?: string) => void
  /** Step within the bar the playhead is on, or null when this pattern isn't playing. */
  playStep: number | null
}

/**
 * The studio's piano roll, using the RemixRelay PianoRoll component (drag, resize,
 * zoom, velocity). It edits the same data as the channel rack: a lit step with no
 * note plays the channel's default note, so those show here as real notes too.
 */
export function StudioPianoRoll({
  project, activePattern, selectedChannelId, onSelectChannel, setPianoNotes, setStepData, preview, playStep,
}: Props) {
  const [mode, setMode] = useState<PianoRollMode>('notes')
  // Drums play from the channel rack, so only melodic channels get a piano roll.
  const melodic = project.channels.filter((c) => c.type !== 'drum')
  const channel = melodic.find((c) => c.id === selectedChannelId) ?? melodic[0]
  if (!channel) return null

  const notes = editorNotes(project, activePattern, channel)

  function save(next: Note[]) {
    setPianoNotes((prev) => ({
      ...prev,
      [activePattern]: {
        ...prev[activePattern],
        [channel.id]: next.map((n) => ({
          id: n.id, step: n.start, note: midiToName(n.pitch), length: n.duration, velocity: n.velocity,
        })),
      },
    }))
    // Keep the channel rack's lit steps in sync with where notes start.
    const gates = new Array<number>(STEP_COUNT).fill(0)
    for (const n of next) gates[n.start] = 1
    setStepData((prev) => ({ ...prev, [activePattern]: { ...prev[activePattern], [channel.id]: gates } }))
  }

  return (
    <div className="max-w-6xl w-full mx-auto bg-[#202428] rounded-lg border border-zinc-700/70 shadow-2xl flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 bg-gradient-to-r from-zinc-800 to-zinc-850 border-b border-zinc-700/70">
        <div className="flex items-center gap-3">
          <Music className="w-4 h-4 text-orange-400" />
          <h2 className="text-xs font-mono font-bold tracking-wider text-zinc-200 uppercase">
            Piano Roll • {channel.name} • Pattern {activePattern}
          </h2>
          {/* Notes / Velocity tabs */}
          <div role="tablist" className="flex bg-zinc-950 p-0.5 rounded-md border border-zinc-700/60">
            {(['notes', 'velocity'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={`px-2.5 py-0.5 rounded text-[11px] font-semibold capitalize transition ${
                  mode === m ? 'bg-zinc-800 text-orange-400 border border-zinc-700/80' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={channel.id}
            onChange={(e) => onSelectChannel(e.target.value)}
            aria-label="Piano roll channel"
            className="bg-zinc-900 text-xs text-orange-400 font-semibold px-2 py-1 rounded border border-zinc-700 outline-none"
          >
            {melodic.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => save([])}
            className="px-2 py-1 text-[11px] bg-zinc-800 hover:bg-red-900/50 text-zinc-300 hover:text-red-300 rounded border border-zinc-700"
          >
            Clear Notes
          </button>
        </div>
      </div>

      <p className="px-4 py-1.5 text-[11px] text-zinc-400 border-b border-zinc-800">
        {mode === 'notes'
          ? 'Click to draw, drag to move or stretch, double-click or right-click to delete. Ctrl + wheel zooms time, Ctrl + middle-drag zooms pitch.'
          : 'Notes are locked. Click or drag a slider (right/up = louder). Shift/Ctrl+click or drag a box to select several, Ctrl+A for all, Esc to clear.'}
      </p>

      <PianoRoll
        notes={notes}
        steps={STEP_COUNT}
        onChange={save}
        playStep={playStep}
        color={channel.color}
        onPreview={(pitch) => preview(channel.id, midiToName(pitch))}
        mode={mode}
      />
    </div>
  )
}

/** The notes the piano roll shows: authored notes plus default hits from lit steps. */
function editorNotes(project: StudioProject, pattern: number, channel: StudioChannel): Note[] {
  const authored = project.pianoNotes[pattern]?.[channel.id] ?? []
  const gates = project.stepData[pattern]?.[channel.id] ?? []
  const used = new Set<string>()
  // Notes saved by this piano roll have an id. Older ones get a stable id built
  // from their content, saved with the first edit so dragging keeps working.
  const uniqueId = (id: string) => {
    while (used.has(id)) id += "'"
    used.add(id)
    return id
  }
  const notes: Note[] = []
  for (const [i, n] of authored.entries()) {
    const pitch = nameToMidi(n.note)
    if (pitch === null) continue
    notes.push({
      id: uniqueId(n.id ?? `n-${n.step}-${n.note}-${i}`),
      pitch, start: n.step, duration: n.length, velocity: n.velocity ?? 0.8,
    })
  }
  const hit = defaultHit(channel)
  for (let step = 0; step < STEP_COUNT; step++) {
    if (gates[step] !== 1 || authored.some((n) => n.step === step)) continue
    notes.push({
      id: uniqueId(`g-${step}-${hit.pitch}`),
      pitch: nameToMidi(hit.pitch) ?? 60, start: step, duration: hit.durationSteps, velocity: 0.8,
    })
  }
  return notes
}
