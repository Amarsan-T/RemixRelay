// Where AI note suggestions show up in the editors. Pure functions: the studio
// resolves suggestions against its live project (convex/noteSuggestions.ts)
// and these decide what each view highlights.
import { describeSuggestion, pitchOf } from '../../convex/noteSuggestions'
import type { NoteSuggestion, ResolvedSuggestion, SuggestionSet } from '../../convex/noteSuggestions'
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

/**
 * The suggestion someone pressed Show on. `token` changes on every press, so
 * showing the same suggestion again scrolls to it again.
 */
export interface CoachTarget {
  item: NoteSuggestion
  token: number
  /** True only for an explicit Show click: then a floating panel covering the target steps aside. */
  uncover?: boolean
}

/** Is this the suggestion being shown? Matched by what it changes, not by list position. */
export function isTarget(item: NoteSuggestion, target: CoachTarget | null | undefined): boolean {
  const t = target?.item
  return !!t && t.channelId === item.channelId && t.pattern === item.pattern && t.step === item.step &&
    t.action === item.action && (t.note ?? '') === (item.note ?? '')
}

export interface PadMark { kind: PadHighlight; label: string; focused: boolean }

/** Highlights for one pattern of the Channel Rack, keyed "channelId:step". Only suggestions still to do. */
export function rackHighlights(items: readonly ResolvedSuggestion[], pattern: number, target?: CoachTarget | null): Map<string, PadMark> {
  const pads = new Map<string, PadMark>()
  for (const item of items) {
    if (item.status !== 'pending' || item.pattern !== pattern) continue
    const key = `${item.channelId}:${item.step}`
    const label = `AI suggestion: ${describeSuggestion(item)}`
    const focused = isTarget(item, target) || !!pads.get(key)?.focused
    const existing = pads.get(key)
    // A pad that gains one note and loses another is still played: show it as a change.
    pads.set(key, existing && existing.kind !== item.action
      ? { kind: 'change', label: `${existing.label}; ${label}`, focused }
      : { kind: item.action, label, focused })
  }
  return pads
}

/** Ghost notes for the channel shown in the Piano Roll. Remove/change outlines match the existing note's length. */
export function pianoGhosts(items: readonly ResolvedSuggestion[], pattern: number, channelId: string, notes: readonly Note[], target?: CoachTarget | null): GhostNote[] {
  const ghosts: GhostNote[] = []
  items.forEach((item, index) => {
    if (item.status !== 'pending' || item.pattern !== pattern || item.channelId !== channelId || item.kind !== 'melodic') return
    const pitch = pitchOf(item.note!)
    if (pitch === null) return
    const label = `AI suggestion: ${describeSuggestion(item)}${item.why ? `. ${item.why}` : ''}`
    const key = `ai-${index}`
    // The shown note is marked; the token makes it scroll into view again on every Show.
    const focus = isTarget(item, target) ? { focusToken: target!.token, focusUncover: !!target!.uncover } : {}
    if (item.action === 'add') {
      ghosts.push({ key, kind: 'add', pitch, start: item.step, duration: item.length ?? 2, label, ...focus })
      return
    }
    const existing = notes.find((note) => note.start === item.step && note.pitch === pitch)
    if (!existing) return
    ghosts.push({ key, kind: item.action === 'remove' ? 'remove' : 'change-from', pitch, start: item.step, duration: existing.duration, label, ...focus })
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

/**
 * Does this question ask Claude to make or change specific music? Used only to
 * offer a follow-up button when a reply came back without notes to apply.
 */
export function asksForNotes(question: string): boolean {
  return /\b(make|create|compose|write|generate|build|produce|program|add|give me|suggest|come up with|help me (make|write|create))\b/i.test(question) &&
    /\b(beat|drums?|kick|snare|hats?|hi-?hats?|melod(y|ies)|bass(line)?|chords?|progression|notes?|riff|hook|groove|loop|pattern|song|track|music|tune|arpeggio|rhythm)\b/i.test(question)
}

/** The follow-up sent when the user asks for a prose-only answer as notes they can apply. */
export const NOTES_FOLLOW_UP = 'Please give the exact notes and steps from your last answer as note suggestions I can Show and Apply.'
