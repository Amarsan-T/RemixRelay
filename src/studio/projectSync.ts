import { applyChanges, isStepKey, NESTED_FIELDS, PROJECT_FIELDS } from '../../convex/projectChanges'
import type { ProjectChange } from '../../convex/projectChanges'
import type { StudioProject } from './types'
import { DEFAULT_PATTERN_STEPS, MAX_PATTERN_STEPS } from './patternAdapter'

export type { ProjectChange }

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const keysOf = (a: Json, b: Json) => new Set([...Object.keys(a), ...Object.keys(b)])

/** Both outgoing edits and incoming overlays use the same musical step boundaries. */
function channelChanges(field: string, pattern: string, channel: string, before: unknown, after: unknown, allowTruncate = true): ProjectChange[] {
  const path = [field, pattern, channel]
  const previous = Array.isArray(before) ? before : []
  if (Array.isArray(after) && (before == null || Array.isArray(before))) {
    if (field === 'stepData' && (!allowTruncate || after.length >= previous.length) && Math.max(after.length, previous.length) <= MAX_PATTERN_STEPS &&
        after.every(value => value == null || value === 0 || value === 1)) {
      return Array.from({ length: Math.max(after.length, previous.length) }, (_, step) => step)
        .filter(step => (previous[step] ?? 0) !== (after[step] ?? 0))
        .map(step => ({ path: [...path, String(step)], value: after[step] ?? 0 }))
    }
    if (field === 'pianoNotes' && [...previous, ...after].every(note =>
      isObject(note) && typeof note.step === 'number' && isStepKey(String(note.step)))) {
      const steps = new Set<number>([...previous, ...after].map(note => note.step as number))
      return [...steps].flatMap(step => {
        const oldNotes = previous.filter(note => note.step === step)
        const newNotes = after.filter(note => note.step === step)
        return sameValue(oldNotes, newNotes) ? [] : [{ path: [...path, String(step)], value: newNotes }]
      })
    }
  }
  // Shrinking a gate array is an intentional resize. Preserve legacy bulk replacements/deletions.
  return sameValue(before, after) ? [] : [{ path, value: after }]
}

/**
 * The changes one edit made. Edits replace only the objects they touch, so a
 * reference check finds them: per musical step for gates and notes,
 * per top-level field for everything else.
 */
export function changesBetween(previous: StudioProject, next: StudioProject): ProjectChange[] {
  const changes: ProjectChange[] = []
  for (const field of PROJECT_FIELDS) {
    const before: unknown = previous[field]
    const after: unknown = next[field]
    if (before === after) continue
    if (!NESTED_FIELDS.includes(field) || !isObject(before) || !isObject(after)) {
      changes.push({ path: [field], value: after })
      continue
    }
    for (const pattern of keysOf(before, after)) {
      const patternBefore = before[pattern]
      const patternAfter = after[pattern]
      if (patternBefore === patternAfter) continue
      if (!isObject(patternBefore) || !isObject(patternAfter)) {
        changes.push({ path: [field, pattern], value: patternAfter })
        continue
      }
      for (const channel of keysOf(patternBefore, patternAfter)) {
        if (patternBefore[channel] !== patternAfter[channel]) changes.push(...channelChanges(field, pattern, channel, patternBefore[channel], patternAfter[channel]))
      }
    }
  }
  return changes
}

const SEPARATOR = '\u001f'

/**
 * Adds a change to the queue of unsaved ones, dropping older changes it
 * replaces (the same path or anything inside it). Queue order is save order.
 */
export function queueChange(queue: Map<string, ProjectChange>, change: ProjectChange): void {
  const key = change.path.join(SEPARATOR)
  for (const existing of [...queue.keys()]) {
    if (existing === key || existing.startsWith(key + SEPARATOR)) queue.delete(existing)
  }
  queue.set(key, change)
}

/**
 * Plain JSON that Convex accepts: undefined fields dropped, and gaps in arrays
 * turned into null, which plays as "off". Gaps appear when a step is set past a
 * pattern's old end; copying that array turns them into undefined, which Convex rejects.
 */
export function toStored<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function toStoredChange({ path, value }: ProjectChange): ProjectChange {
  return value === undefined ? { path } : { path, value: toStored(value) }
}

/** Deep equality that ignores key order and treats missing, undefined, and null alike, as storage does. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null || b == null) return (a ?? null) === (b ?? null)
  if (typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const other = b as unknown[]
    return a.length === other.length && a.every((item, i) => sameValue(item, other[i]))
  }
  const [x, y] = [a as Json, b as Json]
  for (const key of keysOf(x, y)) if (!sameValue(x[key], y[key])) return false
  return true
}

/**
 * What to take from the server's copy of a project, as changes at the same
 * paths saves use. This tab's unsaved changes are laid on top first, so an
 * incoming edit never undoes them. Returns null when nothing differs.
 */
export function remoteChanges(local: StudioProject, server: StudioProject, unsaved: readonly ProjectChange[]): ProjectChange[] | null {
  const desired = structuredClone(server) as unknown as Json
  applyChanges(desired, unsaved)
  const changes: ProjectChange[] = []
  for (const field of PROJECT_FIELDS) {
    const mine: unknown = local[field]
    const theirs = desired[field]
    if (sameValue(mine, theirs)) continue
    if (!NESTED_FIELDS.includes(field) || !isObject(mine) || !isObject(theirs)) {
      changes.push({ path: [field], value: theirs })
      continue
    }
    for (const pattern of keysOf(mine, theirs)) {
      const minePattern = mine[pattern]
      const theirPattern = theirs[pattern]
      if (sameValue(minePattern, theirPattern)) continue
      if (!isObject(minePattern) || !isObject(theirPattern)) {
        changes.push({ path: [field, pattern], value: theirPattern })
        continue
      }
      for (const channel of keysOf(minePattern, theirPattern)) {
        if (!sameValue(minePattern[channel], theirPattern[channel])) {
          // Stored zero padding is not a resize. Only a shorter musical pattern
          // may replace an incoming row; other updates must preserve unreported clicks.
          const truncate = field === 'stepData' &&
            ((desired.patternSteps as StudioProject['patternSteps'])?.[Number(pattern)] ?? DEFAULT_PATTERN_STEPS) <
            (local.patternSteps?.[Number(pattern)] ?? DEFAULT_PATTERN_STEPS)
          changes.push(...channelChanges(field, pattern, channel, minePattern[channel], theirPattern[channel], truncate))
        }
      }
    }
  }
  return changes.length ? changes : null
}

/**
 * A copy of the project with changes applied, sharing everything they don't
 * touch. Applied to the studio's latest state, an incoming change to one
 * step leaves an edit to another step in place, even one made a moment ago.
 */
export function withChanges(project: StudioProject, changes: readonly ProjectChange[]): StudioProject {
  const root = { ...project } as unknown as Json
  for (const { path, value } of changes) {
    let target = root
    for (const key of path.slice(0, -1)) {
      const child = target[key]
      target[key] = Array.isArray(child) ? [...child] : isObject(child) ? { ...child } : {}
      target = target[key] as Json
    }
    applyChanges(root, [{ path, value }])
  }
  return root as unknown as StudioProject
}
