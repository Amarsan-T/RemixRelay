import { useEffect, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { Music, Plus } from 'lucide-react'
import { PianoRoll, type PianoRollMode } from '../components/PianoRoll'
import { midiToName, nameToMidi, type Note } from '../music/types'
import { SOUND_PRESETS } from '../audio/soundPresets'
import { preloadPiano } from '../audio/sounds'
import { channelSound, defaultHit, patternLength } from './patternAdapter'
import { PatternLengthControl } from './PatternLengthControl'
import type { PianoNotes, StepData, StudioChannel, StudioProject } from './types'
import type { ResolvedSuggestion } from '../../convex/noteSuggestions'
import { pianoGhosts, type CoachTarget } from '../assistant/noteCoach'

type Props = {
  project: StudioProject
  activePattern: number
  selectedChannelId: string
  onSelectChannel: (channelId: string) => void
  setChannels: Dispatch<SetStateAction<StudioChannel[]>>
  setPianoNotes: Dispatch<SetStateAction<PianoNotes>>
  setStepData: Dispatch<SetStateAction<StepData>>
  preview: (channelId: string, pitch?: string, velocity?: number) => void
  /** Step within the pattern the playhead is on, or null when this pattern isn't playing. */
  playStep: number | null
  setPatternSteps: Dispatch<SetStateAction<Record<number, number> | undefined>>
  /** AI note suggestions to highlight; only this channel and pattern's are drawn. */
  suggestions?: ResolvedSuggestion[]
  /** The suggestion someone pressed Show on, emphasized and scrolled into view. */
  coachTarget?: CoachTarget | null
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
  setPatternSteps, suggestions = [], coachTarget,
}: Props) {
  const [mode, setMode] = useState<PianoRollMode>('notes')
  // Drums play from the channel rack, so only melodic channels get a piano roll.
  const melodic = project.channels.filter((c) => c.type !== 'drum')
  const channel = melodic.find((c) => c.id === selectedChannelId) ?? melodic[0]
  const [pianoLoad, setPianoLoad] = useState<{ key: string; status: 'ready' | 'error' } | null>(null)
  const [pianoAttempt, setPianoAttempt] = useState(0)
  const pianoAudition = useRef(false)
  const pianoChannelId = channel?.id
  const sound = channel ? channelSound(channel, activePattern) ?? '' : ''
  const pianoPitch = channel ? defaultHit(channel).pitch : 'C4'
  const pianoKey = `${pianoChannelId}:${pianoAttempt}`
  const pianoState = pianoLoad?.key === pianoKey ? pianoLoad.status : 'loading'
  useEffect(() => {
    if (!pianoChannelId || sound !== 'grand-piano') return
    let mounted = true
    void preloadPiano().then((ready) => {
      if (!mounted) return
      setPianoLoad({ key: pianoKey, status: ready ? 'ready' : 'error' })
      if (ready && pianoAudition.current) {
        pianoAudition.current = false
        preview(pianoChannelId, pianoPitch)
      }
    })
    return () => { mounted = false }
  }, [pianoChannelId, sound, pianoPitch, pianoKey, preview])

  // After picking an instrument, play a note once the engine has the new sound.
  // Effects run after the studio hands the engine its updated pattern.
  const previewNext = useRef<string | null>(null)
  useEffect(() => {
    if (!channel || previewNext.current !== channel.id) return
    previewNext.current = null
    preview(channel.id, defaultHit(channel).pitch)
  }, [channel, preview])

  if (!channel) return null
  const length = patternLength(project, activePattern)
  const notes = editorNotes(project, activePattern, channel, length)

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
    const gates = new Array<number>(length).fill(0)
    for (const n of next) gates[n.start] = 1
    setStepData((prev) => ({ ...prev, [activePattern]: { ...prev[activePattern], [channel.id]: gates } }))
  }

  function chooseSound(next: string) {
    if (next === sound) { preview(channel.id, defaultHit(channel).pitch); return }
    pianoAudition.current = next === 'grand-piano'
    if (next === 'grand-piano') setPianoLoad(null)
    previewNext.current = channel.id
    // Only this pattern changes; the same channel can sound different in other patterns.
    setChannels((all) => all.map((c) => (c.id === channel.id ? { ...c, patternSounds: { ...c.patternSounds, [activePattern]: next } } : c)))
  }

  /** Adds a channel using the selected instrument, so several instruments can play at once. */
  function addChannel() {
    const preset = SOUND_PRESETS.find((s) => s.id === sound) ?? SOUND_PRESETS[0]
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
    active ? 'aero-pill aero-aqua' : 'rounded-full text-sky-100/70 hover:text-white border border-transparent'
  }`

  return (
    <div className="aero-panel max-w-6xl w-full mx-auto overflow-hidden flex flex-col">
      {/* Title, Notes / Velocity, Clear */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 aero-panel-header">
        <div className="flex items-center gap-3">
          <Music className="w-4 h-4 text-aero-glow" />
          <h2 className="text-sm font-semibold tracking-wide text-white">
            Piano Roll • {channel.name} • Pattern {activePattern}
          </h2>
          <div role="tablist" aria-label="Editing mode" className="aero-well flex gap-0.5 p-0.5">
            {(['notes', 'velocity'] as const).map((m) => (
              <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={`${tab(mode === m)} capitalize`}>
                {m}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <PatternLengthControl
            key={activePattern}
            project={project}
            pattern={activePattern}
            setPatternSteps={setPatternSteps}
            setStepData={setStepData}
            setPianoNotes={setPianoNotes}
          />
          <button
            type="button"
            onClick={() => save([])}
            className="aero-pill aero-smoke px-2.5 py-1 text-[11px] hover:!text-red-300"
          >
            Clear Notes
          </button>
        </div>
      </div>

      {/* Which channel you're editing */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-white/10">
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
              {suggestions.some((s) => s.status === 'pending' && s.channelId === c.id && s.pattern === activePattern) && (
                <span title="Has AI suggestions" aria-label="has AI suggestions" className="text-[#ffd447]">✦</span>
              )}
            </button>
          ))}
          <button
            type="button"
            onClick={addChannel}
            title="Add a channel with its own instrument"
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold text-sky-100/70 hover:text-white border border-dashed border-sky-200/30"
          >
            <Plus className="w-3 h-3" /> New channel
          </button>
        </div>
      </div>

      {/* What it sounds like */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-white/10">
        <span className="w-20 shrink-0 text-[10px] font-mono uppercase tracking-wider text-zinc-500">Instrument</span>
        <div role="radiogroup" aria-label="Instrument" className="flex flex-wrap gap-1">
          {INSTRUMENTS.map((preset) => {
            const selected = sound === preset.id
            return (
              <button
                key={preset.id || 'studio'}
                type="button"
                role="radio"
                aria-checked={selected}
                title={preset.description}
                onClick={() => chooseSound(preset.id)}
                onPointerEnter={preset.id === 'grand-piano' ? preloadPiano : undefined}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-semibold transition border ${
                  selected ? 'border-aero-glow bg-sky-400/15 text-white shadow-[0_0_10px_rgba(127,227,255,0.25)]' : 'border-white/10 text-sky-100/70 hover:text-white hover:bg-white/5'
                }`}
              >
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: preset.color }} />
                {preset.name}
              </button>
            )
          })}
        </div>
      </div>

      <p className="px-4 py-1.5 text-[11px] text-sky-100/70 border-b border-white/10">
        {mode === 'notes'
          ? 'Click to draw, drag to move or stretch, double-click or right-click to delete. Ctrl + wheel zooms time, Ctrl + middle-drag zooms pitch.'
          : 'Notes are locked. Click or drag a slider (right/up = louder). Shift/Ctrl+click or drag a box to select several, Ctrl+A for all, Esc to clear.'}
      </p>
      {sound === 'grand-piano' && (
        <div role={pianoState === 'error' ? 'alert' : 'status'} className="flex flex-wrap items-center gap-2 px-4 py-2 text-xs text-sky-100/80">
          {pianoState === 'loading' ? 'Loading piano samples...' : pianoState === 'ready' ? 'Piano ready' : 'Piano samples could not load. Retry, or choose Studio Synth to keep playing.'}
          {pianoState === 'error' && <button type="button" onClick={() => { pianoAudition.current = true; setPianoAttempt((attempt) => attempt + 1) }} className="aero-pill aero-smoke px-3 py-1">Retry piano samples</button>}
        </div>
      )}

      <PianoRoll
        notes={notes}
        // Remount when the length changes so the grid re-fits the width.
        key={`${activePattern}:${channel.id}:${length}`}
        steps={length}
        onChange={save}
        playStep={playStep}
        color={channel.color}
        onPreview={(pitch, velocity) => preview(channel.id, midiToName(pitch), velocity)}
        mode={mode}
        ghosts={pianoGhosts(suggestions, activePattern, channel.id, notes, coachTarget)}
      />
    </div>
  )
}

/** The notes the piano roll shows: authored notes plus default hits from lit steps. */
function editorNotes(project: StudioProject, pattern: number, channel: StudioChannel, length: number): Note[] {
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
  for (let step = 0; step < length; step++) {
    if (gates[step] !== 1 || authored.some((n) => n.step === step)) continue
    notes.push({
      id: uniqueId(`g-${step}-${hit.pitch}`),
      pitch: nameToMidi(hit.pitch) ?? 60, start: step, duration: hit.durationSteps, velocity: 0.8,
    })
  }
  return notes
}
