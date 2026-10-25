// Where AI note suggestions show up in the editors. Pure functions: the studio
// resolves suggestions against its live project (convex/noteSuggestions.ts)
// and these decide what each view highlights.
import { describeSuggestion, pitchOf } from '../../convex/noteSuggestions'
import type { ResolvedSuggestion, SuggestionSet } from '../../convex/noteSuggestions'
import type { GhostNote } from '../components/PianoRoll'
import type { Note } from '../music/types'

/** The suggestions the studio is highlighting, from one chat reply. */
export interface ActiveSuggestions {
  messageId: string
  set: SuggestionSet
  /** Goes up each time someone asks to be shown the suggestions, so the studio moves to them. */
  focus: number
}

export type StudioView = 'playlist' | 'channelRack' | 'pianoRoll' | 'mixer'

/** What a Channel Rack pad shows: 'add' (light it), 'remove' (turn it off), or 'change' (keep it, new pitch). */
export type PadHighlight = 'add' | 'remove' | 'change'

/** Highlights for one pattern of the Channel Rack, keyed "channelId:step". Only suggestions still to do. */
export function rackHighlights(items: readonly ResolvedSuggestion[], pattern: number): Map<string, { kind: PadHighlight; label: string }> {
  const pads = new Map<string, { kind: PadHighlight; label: string }>()
  for (const item of items) {
    if (item.status !== 'pending' || item.pattern !== pattern) continue
    const key = `${item.channelId}:${item.step}`
    const label = `AI suggestion: ${describeSuggestion(item)}`
    const existing = pads.get(key)
    // A pad that gains one note and loses another is still played: show it as a change.
    pads.set(key, existing && existing.kind !== item.action ? { kind: 'change', label: `${existing.label}; ${label}` } : { kind: item.action, label })
  }
  return pads
}

/** Ghost notes for the channel shown in the Piano Roll. Remove/change outlines match the existing note's length. */
export function pianoGhosts(items: readonly ResolvedSuggestion[], pattern: number, channelId: string, notes: readonly Note[]): GhostNote[] {
  const ghosts: GhostNote[] = []
  items.forEach((item, index) => {
    if (item.status !== 'pending' || item.pattern !== pattern || item.channelId !== channelId || item.kind !== 'melodic') return
    const pitch = pitchOf(item.note!)
    if (pitch === null) return
    const label = `AI suggestion: ${describeSuggestion(item)}${item.why ? `. ${item.why}` : ''}`
    const key = `ai-${index}`
    if (item.action === 'add') {
      ghosts.push({ key, kind: 'add', pitch, start: item.step, duration: item.length ?? 2, label })
      return
    }
    const existing = notes.find((note) => note.start === item.step && note.pitch === pitch)
    if (!existing) return
    ghosts.push({ key, kind: item.action === 'remove' ? 'remove' : 'change-from', pitch, start: item.step, duration: existing.duration, label })
    const to = item.to ? pitchOf(item.to) : null
    if (item.action === 'change' && to !== null) ghosts.push({ key: `${key}-to`, kind: 'change-to', pitch: to, start: item.step, duration: existing.duration, label })
  })
  return ghosts
}

/** Is this suggestion visible in the view the user has open? */
export function isInView(item: ResolvedSuggestion, view: StudioView, pattern: number, pianoChannelId: string | undefined): boolean {
  if (item.pattern !== pattern) return false
  if (view === 'channelRack') return true
  return view === 'pianoRoll' && item.kind === 'melodic' && item.channelId === pianoChannelId
}

/** Where to take the user to see a suggestion: melodic notes in the Piano Roll, drum steps in the Channel Rack. */
export function viewFor(item: ResolvedSuggestion): { view: StudioView; pattern: number; channelId: string } {
  return { view: item.kind === 'melodic' ? 'pianoRoll' : 'channelRack', pattern: item.pattern, channelId: item.channelId }
}
