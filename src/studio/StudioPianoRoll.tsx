import { useEffect, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { Music, Plus } from 'lucide-react'
import { PianoRoll, type PianoRollMode } from '../components/PianoRoll'
import { midiToName, nameToMidi, type Note } from '../music/types'
import { STEP_COUNT } from '../audio/types'
import { SOUND_PRESETS } from '../audio/soundPresets'
import { defaultHit } from './patternAdapter'
import type { PianoNotes, StepData, StudioChannel, StudioProject } from './types'

type Props = {
  project: StudioProject
  activePattern: number
  selectedChannelId: string
  onSelectChannel: (channelId: string) => void
  setChannels: Dispatch<SetStateAction<StudioChannel[]>>
  setPianoNotes: Dispatch<SetStateAction<PianoNotes>>
  setStepData: Dispatch<SetStateAction<StepData>>
  preview: (channelId: string, pitch?: string) => void
  /** Step within the bar the playhead is on, or null when this pattern isn't playing. */
  playStep: number | null
}

/** The default synth every channel starts with, listed first in the instrument picker. */
const STUDIO_SYNTH = { id: '', name: 'Studio Synth', description: 'The original studio synth', color: '#71717a' }
const INSTRUMENTS = [STUDIO_SYNTH, ...SOUND_PRESETS]
/** Mixer insert that new channels play through. */
const NEW_CHANNEL_INSERT = 6

/**
 * The studio's piano roll, using the RemixRelay PianoRoll component (drag, resize,
 * zoom, velocity). It edits the same data as the channel rack: a lit step with no
 * note plays the channel's default note, so those show here as real notes too.
 */
export function StudioPianoRoll({
  project, activePattern, selectedChannelId, onSelectChannel, setChannels, setPianoNotes, setStepData, preview, playStep,
}: Props) {
  const [mode, setMode] = useState<PianoRollMode>('notes')
  // Drums play from the channel rack, so only melodic channels get a piano roll.
  const melodic = project.channels.filter((c) => c.type !== 'drum')
  const channel = melodic.find((c) => c.id === selectedChannelId) ?? melodic[0]

  // After picking an instrument, play a note once the engine has the new sound.
  // Effects run after the studio hands the engine its updated pattern.
  const previewNext = useRef<string | null>(null)
  useEffect(() => {
    if (!channel || previewNext.current !== channel.id) return
    previewNext.current = null
    preview(channel.id, defaultHit(channel).pitch)
  }, [channel, preview])

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

  function chooseSound(sound: string) {
    previewNext.current = channel.id
    setChannels((all) => all.map((c) => (c.id === channel.id ? { ...c, sound: sound || undefined } : c)))
  }

  /** Adds a channel using the selected instrument, so several instruments can play at once. */
  function addChannel() {
    const preset = SOUND_PRESETS.find((s) => s.id === channel.sound) ?? SOUND_PRESETS[0]
    const taken = new Set(project.channels.map((c) => c.name))
    let name = preset.name
    for (let n = 2; taken.has(name); n++) name = `${preset.name} ${n}`
    const id = `inst-${crypto.randomUUID().slice(0, 8)}`
    setChannels((all) => [...all, {
      id, name, color: preset.color, mixerTrack: NEW_CHANNEL_INSERT, vol: 0.8, pan: 0, muted: false, solo: false,
      type: preset.bass ? 'pitched' : 'synth', defaultNote: preset.bass ? 'C2' : 'C4', sound: preset.id,
    }])
    onSelectChannel(id)
  }

  const tab = (active: boolean) => `px-2.5 py-1 rounded text-[11px] font-semibold transition ${
    active ? 'bg-zinc-800 text-orange-400 border border-zinc-700/80' : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
  }`

  return (
    <div className="max-w-6xl w-full mx-auto bg-[#202428] rounded-lg border border-zinc-700/70 shadow-2xl flex flex-col">
      {/* Title, Notes / Velocity, Clear */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 bg-gradient-to-r from-zinc-800 to-zinc-850 border-b border-zinc-700/70">
        <div className="flex items-center gap-3">
          <Music className="w-4 h-4 text-orange-400" />
          <h2 className="text-xs font-mono font-bold tracking-wider text-zinc-200 uppercase">
            Piano Roll • {channel.name} • Pattern {activePattern}
          </h2>
          <div role="tablist" aria-label="Editing mode" className="flex bg-zinc-950 p-0.5 rounded-md border border-zinc-700/60">
            {(['notes', 'velocity'] as const).map((m) => (
              <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={`${tab(mode === m)} capitalize`}>
                {m}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={() => save([])}
          className="px-2 py-1 text-[11px] bg-zinc-800 hover:bg-red-900/50 text-zinc-300 hover:text-red-300 rounded border border-zinc-700"
        >
          Clear Notes
        </button>
      </div>

      {/* Which channel you're editing */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-zinc-800">
        <span className="w-20 shrink-0 text-[10px] font-mono uppercase tracking-wider text-zinc-500">Channel</span>
        <div role="tablist" aria-label="Piano roll channel" className="flex flex-wrap gap-1">
          {melodic.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={c.id === channel.id}
              onClick={() => onSelectChannel(c.id)}
              className={`${tab(c.id === channel.id)} flex items-center gap-1.5`}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />
              {c.name}
            </button>
          ))}
          <button
            type="button"
            onClick={addChannel}
            title="Add a channel with its own instrument"
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold text-zinc-400 hover:text-orange-400 border border-dashed border-zinc-700"
          >
            <Plus className="w-3 h-3" /> New channel
          </button>
        </div>
      </div>

      {/* What it sounds like */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-zinc-800">
        <span className="w-20 shrink-0 text-[10px] font-mono uppercase tracking-wider text-zinc-500">Instrument</span>
        <div role="radiogroup" aria-label="Instrument" className="flex flex-wrap gap-1">
          {INSTRUMENTS.map((sound) => {
            const selected = (channel.sound ?? '') === sound.id
            return (
              <button
                key={sound.id || 'studio'}
                type="button"
                role="radio"
                aria-checked={selected}
                title={sound.description}
                onClick={() => chooseSound(sound.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-semibold transition border ${
                  selected ? 'border-orange-400 bg-zinc-800 text-zinc-100' : 'border-zinc-700/70 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
                }`}
              >
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: sound.color }} />
                {sound.name}
              </button>
            )
          })}
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
