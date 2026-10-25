// Claude's note suggestions: the structured block it appends to a chat reply,
// how that block is read and checked, and how a checked suggestion maps onto
// the project the studio is editing right now. Pure functions with no
// imports, shared by Convex (convex/chatAgent.ts) and the browser, and copied
// as-is into the disposable backend the browser tests start.
//
// Claude writes steps 1-based, as the studio shows them; stored suggestions
// use 0-based steps like the rest of the project data.

export const SUGGESTIONS_TAG = 'note-suggestions'
export const MAX_SUGGESTIONS = 16
/** Pitches the piano roll can show and edit: C2 through C6. */
export const LOWEST_PITCH = 36
export const HIGHEST_PITCH = 84
/** The engine caps a single note at one bar. */
const MAX_NOTE_STEPS = 16
const MAX_WHY_CHARS = 200
const MAX_SUMMARY_CHARS = 160
/** Same defaults as src/studio/patternAdapter.ts. */
const DEFAULT_PATTERN_STEPS = 64
const DEFAULT_PATTERN_COUNT = 4
const MAX_PATTERN_STEPS = 256
const MAX_PATTERNS = 32

export type SuggestionAction = 'add' | 'remove' | 'change'

/** One checked suggestion, as stored on a chat reply. */
export interface NoteSuggestion {
  action: SuggestionAction
  channelId: string
  /** The channel's name when Claude suggested it, for display if it is later renamed or deleted. */
  channelName: string
  pattern: number
  /** 0-based. */
  step: number
  /** Melodic channels: the note to add, remove, or change (sharps, e.g. "F#4"). Drums have none. */
  note?: string
  /** `change` only: the pitch to change `note` to. */
  to?: string
  /** `add` on a melodic channel: length in steps. */
  length?: number
  /** A short, beginner-friendly reason. */
  why?: string
}

export interface SuggestionSet {
  summary?: string
  items: NoteSuggestion[]
  /** How many of Claude's suggestions were dropped because they were malformed or didn't fit the project. */
  skipped: number
}

/** The parts of a project read here. Works on both the studio's state and the JSON stored in Convex. */
interface Channel { id: string; name: string; type: 'drum' | 'pitched' | 'synth'; defaultNote?: string }
interface Note { step: number; note: string; length: number; id?: string; velocity?: number }
export interface SuggestionProject {
  channels?: Channel[]
  stepData?: Record<string | number, Record<string, (number | null)[]> | undefined>
  pianoNotes?: Record<string | number, Record<string, Note[]> | undefined>
  patternSteps?: Record<string | number, number>
  patternCount?: number
}

// ---- Note names -----------------------------------------------------------

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** "Bb3" -> 58; anything that isn't a plain note name -> null. Same rules as src/music/types.ts. */
export function pitchOf(name: string): number | null {
  const match = /^([A-G])([#b]?)(-?\d)$/.exec(name)
  if (!match) return null
  const semitone = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[match[1] as 'C']
  return (Number(match[3]) + 1) * 12 + semitone + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0)
}

export function nameOf(pitch: number): string {
  return `${NAMES[((pitch % 12) + 12) % 12]}${Math.floor(pitch / 12) - 1}`
}

/** A note name the piano roll can show, spelled with sharps; otherwise null. */
function showable(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const pitch = pitchOf(value.trim())
  return pitch !== null && pitch >= LOWEST_PITCH && pitch <= HIGHEST_PITCH ? nameOf(pitch) : null
}

// ---- Reading Claude's reply -----------------------------------------------

/**
 * Splits a reply into the text people read and the suggestion block's raw
 * contents. Every block is removed from the text, including one cut off by
 * the output limit. Only the last complete block is used.
 */
export function extractSuggestionBlock(reply: string): { text: string; block: string | null; found: boolean } {
  const open = `<${SUGGESTIONS_TAG}>`
  const close = `</${SUGGESTIONS_TAG}>`
  let text = ''
  let block: string | null = null
  let found = false
  let rest = reply
  for (;;) {
    const start = rest.indexOf(open)
    if (start < 0) { text += rest; break }
    found = true
    text += rest.slice(0, start)
    const end = rest.indexOf(close, start + open.length)
    if (end < 0) break // Unterminated: drop everything after the tag.
    block = rest.slice(start + open.length, end)
    rest = rest.slice(end + close.length)
  }
  // Claude sometimes wraps the block in a code fence; remove the empty fence it leaves.
  text = text.replace(/```[a-z]*\s*```/gi, '').replace(/\n{3,}/g, '\n\n').trim()
  return { text, block, found }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const whole = (value: unknown, min: number, max: number): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null
const shortText = (value: unknown, max: number): string | undefined => {
  if (typeof value !== 'string') return undefined
  const text = value.replace(/\s+/g, ' ').trim()
  return text ? (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`) : undefined
}

/** A suggestion as Claude wrote it, checked for shape only: the channel is still a name or id. */
export interface DraftSuggestion { action: SuggestionAction; channel: string; pattern: number; step: number; note?: string; to?: string; length?: number; why?: string }

/** Checks the block's shape. Anything malformed is counted and left out, never guessed at. */
export function parseSuggestionBlock(block: string): { summary?: string; items: DraftSuggestion[]; skipped: number } {
  let data: unknown
  try {
    data = JSON.parse(block.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))
  } catch {
    return { items: [], skipped: 1 }
  }
  const list = Array.isArray(data) ? data : isRecord(data) ? data.items : undefined
  if (!Array.isArray(list)) return { items: [], skipped: 1 }
  const summary = isRecord(data) ? shortText(data.summary, MAX_SUMMARY_CHARS) : undefined
  const items: DraftSuggestion[] = []
  let skipped = 0
  for (const entry of list) {
    const item = isRecord(entry) ? draft(entry) : null
    if (item && items.length < MAX_SUGGESTIONS) items.push(item)
    else skipped++
  }
  return { ...(summary ? { summary } : {}), items, skipped }
}

function draft(entry: Record<string, unknown>): DraftSuggestion | null {
  const action = entry.action
  if (action !== 'add' && action !== 'remove' && action !== 'change') return null
  const channel = shortText(entry.channel, 64)
  const pattern = whole(entry.pattern, 1, MAX_PATTERNS)
  const step = whole(entry.step, 1, MAX_PATTERN_STEPS)
  if (!channel || pattern === null || step === null) return null
  const item: DraftSuggestion = { action, channel, pattern, step: step - 1 }
  // A note that is present but unreadable or out of range makes the whole suggestion invalid.
  if (entry.note !== undefined && entry.note !== null) {
    const note = showable(entry.note)
    if (!note) return null
    item.note = note
  }
  if (action === 'change') {
    const to = showable(entry.to)
    if (!to || !item.note || to === item.note) return null
    item.to = to
  }
  if (entry.length !== undefined && entry.length !== null) {
    const length = whole(entry.length, 1, MAX_NOTE_STEPS)
    if (length === null) return null
    item.length = length
  }
  const why = shortText(entry.why, MAX_WHY_CHARS)
  if (why) item.why = why
  return item
}

// ---- Matching the project -------------------------------------------------

export const patternLengthOf = (project: SuggestionProject, pattern: number) =>
  Math.max(1, Math.min(MAX_PATTERN_STEPS, Math.floor(project.patternSteps?.[pattern] ?? DEFAULT_PATTERN_STEPS) || DEFAULT_PATTERN_STEPS))
const patternCountOf = (project: SuggestionProject) =>
  Math.max(1, Math.min(MAX_PATTERNS, Math.floor(project.patternCount ?? DEFAULT_PATTERN_COUNT) || DEFAULT_PATTERN_COUNT))
/** The note a lit step plays without a piano-roll note (patternAdapter.defaultHit). */
const defaultHit = (channel: Channel) => channel.type === 'pitched'
  ? { note: channel.defaultNote ?? 'C2', length: 3 }
  : { note: channel.defaultNote ?? 'A4', length: 2 }

/** Finds a channel by id, or by a name that only one channel has (any case). */
function findChannel(project: SuggestionProject, reference: string): Channel | null {
  const channels = Array.isArray(project.channels) ? project.channels : []
  const byId = channels.find((channel) => channel.id === reference)
  if (byId) return byId
  const named = channels.filter((channel) => channel.name.trim().toLowerCase() === reference.trim().toLowerCase())
  return named.length === 1 ? named[0] : null
}

/** Pitches sounding from a step: piano-roll notes there, or else the default note of a lit step. */
function pitchesAt(project: SuggestionProject, pattern: number, channel: Channel, step: number): string[] {
  const authored = (project.pianoNotes?.[pattern]?.[channel.id] ?? []).filter((note) => note.step === step)
  if (authored.length) return authored.flatMap((note) => { const pitch = pitchOf(note.note); return pitch === null ? [] : [nameOf(pitch)] })
  return project.stepData?.[pattern]?.[channel.id]?.[step] === 1 ? [nameOf(pitchOf(defaultHit(channel).note) ?? 0)] : []
}

const isLit = (project: SuggestionProject, pattern: number, channel: string, step: number) =>
  project.stepData?.[pattern]?.[channel]?.[step] === 1

export type SuggestionStatus =
  /** Still to do. */
  | 'pending'
  /** The project already matches the suggestion. */
  | 'done'
  /** It no longer fits the project (channel deleted, pattern shortened, note changed by someone else). */
  | 'unavailable'

export interface ResolvedSuggestion extends NoteSuggestion {
  status: SuggestionStatus
  /** 'drum' channels light steps; 'melodic' channels play notes in the piano roll. */
  kind: 'drum' | 'melodic'
}

/**
 * A suggestion in the form it is stored: the channel Claude named becomes a
 * real channel id, and fields that don't apply to that kind of channel are
 * dropped. Null when the channel doesn't exist or the action can't apply to it.
 */
function toStored(project: SuggestionProject, draft: DraftSuggestion): NoteSuggestion | null {
  const channel = findChannel(project, draft.channel)
  if (!channel) return null
  const { channel: _reference, note, to, length, ...rest } = draft
  const item: NoteSuggestion = { ...rest, channelId: channel.id, channelName: channel.name }
  // Drum steps have no pitch or length to change.
  if (channel.type === 'drum') return draft.action === 'change' ? null : item
  if (!note) return null
  return { ...item, note, ...(to ? { to } : {}), ...(draft.action === 'add' ? { length: length ?? 2 } : {}) }
}

/** Checks a suggestion against the project as it is now. Never invents a channel, pattern, step, or note. */
export function resolveSuggestion(project: SuggestionProject, item: NoteSuggestion): ResolvedSuggestion {
  const channel = findChannel(project, item.channelId)
  const kind = channel ? (channel.type === 'drum' ? 'drum' : 'melodic') : item.note ? 'melodic' : 'drum'
  const result = (status: SuggestionStatus): ResolvedSuggestion => ({ ...item, kind, status })
  const length = patternLengthOf(project, item.pattern)
  // The channel was deleted or changed kind, or the pattern was removed or shortened.
  if (!channel || (kind === 'melodic') !== !!item.note || item.pattern > patternCountOf(project) || item.step >= length) return result('unavailable')
  if (kind === 'drum') {
    if (item.action === 'change') return result('unavailable')
    return result((item.action === 'add') === isLit(project, item.pattern, channel.id, item.step) ? 'done' : 'pending')
  }
  const sounding = pitchesAt(project, item.pattern, channel, item.step)
  const here = sounding.includes(item.note!)
  if (item.action === 'add') return { ...result(here ? 'done' : 'pending'), length: Math.min(item.length ?? 2, length - item.step) }
  if (item.action === 'remove') return result(here ? 'pending' : 'done')
  if (here) return result('pending')
  return result(item.to && sounding.includes(item.to) ? 'done' : 'unavailable')
}

export function resolveSuggestions(project: SuggestionProject, items: readonly NoteSuggestion[]): ResolvedSuggestion[] {
  return items.map((item) => resolveSuggestion(project, item))
}

/**
 * Turns a reply's block into stored suggestions, checked against the project
 * Claude was looking at. A suggestion that names a missing channel or note,
 * a step outside the pattern, or something already done is skipped.
 */
export function suggestionsFromBlock(block: string, project: SuggestionProject): SuggestionSet {
  const parsed = parseSuggestionBlock(block)
  let skipped = parsed.skipped
  const items: NoteSuggestion[] = []
  const seen = new Set<string>()
  for (const entry of parsed.items) {
    const item = toStored(project, entry)
    // One suggestion per note (or drum step); later ones contradicting it are dropped.
    const key = item ? `${item.channelId}:${item.pattern}:${item.step}:${item.note ?? ''}` : ''
    const resolved = item && resolveSuggestion(project, item)
    if (!item || !resolved || resolved.status !== 'pending' || seen.has(key)) { skipped++; continue }
    seen.add(key)
    // An added note is shortened to end with its pattern.
    items.push(resolved.length === undefined ? item : { ...item, length: resolved.length })
  }
  return { ...(parsed.summary ? { summary: parsed.summary } : {}), items, skipped }
}

/** Splits a raw reply into readable text and checked suggestions (null when Claude sent none). */
export function readReply(reply: string, project: SuggestionProject): { text: string; suggestions: SuggestionSet | null } {
  const { text, block, found } = extractSuggestionBlock(reply)
  if (!found) return { text, suggestions: null }
  const suggestions = block === null ? { items: [], skipped: 1 } : suggestionsFromBlock(block, project)
  const shown = text || (suggestions.items.length ? 'Here are some notes to try. They are highlighted in the editor.' : '')
  return { text: shown, suggestions: suggestions.items.length || suggestions.skipped ? suggestions : null }
}

// ---- Describing and applying ----------------------------------------------

/** "Add E4 at step 5 (4 steps)", with 1-based steps as the studio shows them. */
export function describeSuggestion(item: NoteSuggestion): string {
  const at = `step ${item.step + 1}`
  if (!item.note) return item.action === 'add' ? `Light ${at}` : `Turn off ${at}`
  if (item.action === 'add') return `Add ${item.note} at ${at}${item.length ? ` (${item.length} step${item.length === 1 ? '' : 's'})` : ''}`
  if (item.action === 'remove') return `Remove ${item.note} at ${at}`
  return `Change ${item.note} to ${item.to} at ${at}`
}

/** A compact line kept in the chat history, so Claude remembers what it highlighted. */
export function suggestionsMemo(set: SuggestionSet | undefined | null): string {
  if (!set?.items.length) return ''
  return `\n[Highlighted in the editor: ${set.items.map((item) => `${item.channelName} pattern ${item.pattern}: ${describeSuggestion(item)}`).join('; ')}]`
}

/**
 * Makes one suggestion in the project, if it still applies. Gates and piano
 * notes change together, as in the studio's own editors, and only the touched
 * pattern and channel are replaced so live sync sends just those steps.
 */
export function applySuggestion<P extends SuggestionProject>(project: P, item: NoteSuggestion): P {
  const resolved = resolveSuggestion(project, item)
  if (resolved.status !== 'pending') return project
  const { pattern, step, channelId } = resolved
  const length = patternLengthOf(project, pattern)
  const gates = Array.from({ length }, (_, i) => project.stepData?.[pattern]?.[channelId]?.[i] === 1 ? 1 : 0)
  const withGates = (next: number[]) => ({ ...project.stepData, [pattern]: { ...project.stepData?.[pattern], [channelId]: next } })

  if (resolved.kind === 'drum') {
    gates[step] = resolved.action === 'add' ? 1 : 0
    return { ...project, stepData: withGates(gates) }
  }

  const channel = findChannel(project, channelId)!
  let notes = [...(project.pianoNotes?.[pattern]?.[channelId] ?? [])]
  // A lit step with no piano note plays the default note; keep it as a real note before adding beside it.
  if (!notes.some((note) => note.step === step) && gates[step] === 1) {
    const hit = defaultHit(channel)
    notes.push({ id: globalThis.crypto.randomUUID(), step, note: hit.note, length: Math.min(hit.length, length - step), velocity: 0.8 })
  }
  const samePitch = (note: Note) => note.step === step && pitchOf(note.note) === pitchOf(resolved.note!)
  if (resolved.action === 'add') {
    notes.push({ id: globalThis.crypto.randomUUID(), step, note: resolved.note!, length: resolved.length ?? 2, velocity: 0.8 })
  } else if (resolved.action === 'remove') {
    notes = notes.filter((note) => !samePitch(note))
  } else {
    notes = notes.map((note) => samePitch(note) ? { ...note, note: resolved.to! } : note)
  }
  gates[step] = notes.some((note) => note.step === step) ? 1 : 0
  return {
    ...project,
    stepData: withGates(gates),
    pianoNotes: { ...project.pianoNotes, [pattern]: { ...project.pianoNotes?.[pattern], [channelId]: notes } },
  }
}

/** Makes every suggestion that still applies, in order. */
export function applySuggestions<P extends SuggestionProject>(project: P, items: readonly NoteSuggestion[]): P {
  return items.reduce((current, item) => applySuggestion(current, item), project)
}
