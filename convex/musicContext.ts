import { SOUND_PRESETS } from '../src/audio/soundPresets'

// A compact, readable description of a RemixRelay project for Claude: tempo,
// channels and instruments, every pattern's hits and notes, the song
// arrangement and the mixer. It follows the same rules as playback
// (src/studio/patternAdapter.ts): a piano-roll note at a step replaces that
// step's channel-rack hit, and a hit without a note plays the channel's
// default note. Steps and bars are 1-based, as the studio shows them.

/** The parts of a StudioProject (src/studio/types.ts) read here; stored projects are plain JSON. */
interface Channel {
  id: string
  name: string
  type: 'drum' | 'pitched' | 'synth'
  mixerTrack?: number
  vol?: number
  pan?: number
  muted?: boolean
  solo?: boolean
  defaultNote?: string
  sound?: string
}
interface Note { step: number; note: string; length: number; velocity?: number }
interface MixerTrack { id: number; name: string; vol: number; pan?: number; filter?: number; delay?: number; dist?: number; mute?: boolean; solo?: boolean }
interface Clip { patternId: string; track: number; startBar: number }
export interface ProjectData {
  bpm?: number
  loop?: boolean
  metronome?: boolean
  channels?: Channel[]
  stepData?: Record<string, Record<string, (number | null)[]>>
  pianoNotes?: Record<string, Record<string, Note[]>>
  mixerTracks?: MixerTrack[]
  song?: { bars?: number; trackCount?: number; clips?: Clip[] }
  patternSteps?: Record<string, number>
  patternCount?: number
}

/** Same defaults as src/studio/patternAdapter.ts. */
const DEFAULT_PATTERN_STEPS = 64
const DEFAULT_PATTERN_COUNT = 4
/** Upper bound on the description, so a huge project can't use up the request. */
export const MAX_CONTEXT_CHARS = 9000

const percent = (value: number | undefined) => `${Math.round((value ?? 0) * 100)}%`
const instrumentOf = (channel: Channel) => channel.type === 'drum'
  ? 'drum sound'
  : SOUND_PRESETS.find((preset) => preset.id === channel.sound)?.name ?? 'Studio Synth (default)'
/** The note a hit plays without a piano-roll note (patternAdapter.defaultHit). */
const defaultNote = (channel: Channel) => channel.defaultNote ?? (channel.type === 'pitched' ? 'C2' : 'A4')

function channelPattern(project: ProjectData, pattern: number, channel: Channel, length: number): string | null {
  const gates = project.stepData?.[pattern]?.[channel.id] ?? []
  if (channel.type === 'drum') {
    const hits = gates.slice(0, length).flatMap((on, i) => (on === 1 ? [i + 1] : []))
    return hits.length ? `hits on steps ${hits.join(', ')}` : null
  }
  const notes = (project.pianoNotes?.[pattern]?.[channel.id] ?? []).filter((note) => note.step < length)
  const events: string[] = []
  for (let step = 0; step < length; step++) {
    const here = notes.filter((note) => note.step === step)
    if (here.length) {
      for (const note of here) {
        const velocity = note.velocity !== undefined && note.velocity !== 0.8 ? `, velocity ${note.velocity}` : ''
        events.push(`${note.note} at step ${step + 1} for ${note.length} step${note.length === 1 ? '' : 's'}${velocity}`)
      }
    } else if (gates[step] === 1) {
      events.push(`${defaultNote(channel)} at step ${step + 1} (default note)`)
    }
  }
  return events.length ? events.join('; ') : null
}

/** Describes a project for Claude, in at most MAX_CONTEXT_CHARS characters. */
export function describeProject(name: string, project: ProjectData | null): string {
  project = project ?? {}
  const channels = Array.isArray(project.channels) ? project.channels.slice(0, 64) : []
  const mixer = Array.isArray(project.mixerTracks) ? project.mixerTracks.slice(0, 64) : []
  const patternCount = Math.max(1, Math.min(32, Math.floor(project.patternCount ?? DEFAULT_PATTERN_COUNT) || DEFAULT_PATTERN_COUNT))
  const lines: string[] = []

  lines.push(`Project "${name}": ${project.bpm ?? 120} BPM, 4/4, 16 steps per bar (a step is a 16th note).`)
  lines.push(`Loop ${project.loop === false ? 'off' : 'on'}; metronome ${project.metronome ? 'on' : 'off'}.`)

  lines.push('', 'Channels (Channel Rack):')
  for (const channel of channels) {
    const insert = mixer.find((track) => track.id === channel.mixerTrack)
    const flags = [channel.muted && 'muted', channel.solo && 'solo'].filter(Boolean).join(', ')
    lines.push(`- ${channel.name} [${channel.type}]: ${instrumentOf(channel)}; volume ${percent(channel.vol)}, pan ${channel.pan ?? 0}` +
      `${insert ? `; mixer insert ${insert.id} "${insert.name}"` : ''}${flags ? `; ${flags}` : ''}`)
  }

  const song = project.song
  const clips = [...(song?.clips ?? [])].sort((a, b) => a.startBar - b.startBar || a.track - b.track)
  lines.push('', `Song (Playlist): ${song?.bars ?? 0} bars, ${song?.trackCount ?? 0} tracks.`)
  lines.push(clips.length
    ? clips.map((clip) => `Pattern ${clip.patternId} at bar ${clip.startBar + 1} (track ${clip.track + 1})`).join('; ') + '.'
    : 'No patterns are placed on the playlist yet.')

  const master = mixer.find((track) => track.id === 0)
  const inserts = mixer.filter((track) => track.id !== 0).flatMap((track) => {
    const notes = [
      track.filter !== undefined && track.filter < 20000 && `low-pass ${track.filter} Hz`,
      track.delay ? `delay ${percent(track.delay)}` : '',
      track.dist ? `distortion ${percent(track.dist)}` : '',
      track.mute && 'muted', track.solo && 'solo',
      track.vol !== undefined && `level ${percent(track.vol)}`,
    ].filter(Boolean)
    return channels.some((channel) => channel.mixerTrack === track.id) ? [`${track.id} "${track.name}": ${notes.join(', ')}`] : []
  })
  lines.push('', `Mixer: master ${percent(master?.vol ?? 0.85)}.${inserts.length ? ` Inserts in use: ${inserts.join('; ')}.` : ''}`)

  // Keep the whole-song overview ahead of detailed notes so large patterns
  // cannot push the playlist and mixer out of the context budget.
  const empty: number[] = []
  for (let pattern = 1; pattern <= patternCount; pattern++) {
    const length = Math.max(1, Math.min(256, Math.floor(project.patternSteps?.[pattern] ?? DEFAULT_PATTERN_STEPS) || DEFAULT_PATTERN_STEPS))
    const parts = channels.flatMap((channel) => {
      const text = channelPattern(project, pattern, channel, length)
      return text ? [`  - ${channel.name}: ${text}`] : []
    })
    if (!parts.length) { empty.push(pattern); continue }
    const bars = length / 16
    lines.push('', `Pattern ${pattern} (${length} steps = ${Number.isInteger(bars) ? bars : bars.toFixed(2)} bar${bars === 1 ? '' : 's'}):`, ...parts)
    if (lines.join('\n').length > MAX_CONTEXT_CHARS) break
  }
  if (empty.length) lines.push('', `Empty patterns: ${empty.join(', ')}.`)

  const text = lines.join('\n')
  if (text.length <= MAX_CONTEXT_CHARS) return text
  // Too big to send whole: keep the start and say plainly that the rest is missing.
  const kept = text.slice(0, MAX_CONTEXT_CHARS - 120)
  return `${kept.slice(0, kept.lastIndexOf('\n'))}\n[The project description was cut short here because the project is very large; ask about specific patterns or channels.]`
}
