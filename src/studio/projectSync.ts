import { applyChanges, NESTED_FIELDS, PROJECT_FIELDS } from '../../convex/projectChanges'
import type { ProjectChange } from '../../convex/projectChanges'
import type { StudioProject } from './types'

export type { ProjectChange }

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const keysOf = (a: Json, b: Json) => new Set([...Object.keys(a), ...Object.keys(b)])

/**
 * The changes one edit made. Edits replace only the objects they touch, so a
 * reference check finds them: per pattern and channel for steps and notes,
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
        if (patternBefore[channel] !== patternAfter[channel]) changes.push({ path: [field, pattern, channel], value: patternAfter[channel] })
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
        if (!sameValue(minePattern[channel], theirPattern[channel])) changes.push({ path: [field, pattern, channel], value: theirPattern[channel] })
      }
    }
  }
  return changes.length ? changes : null
}

/**
 * A copy of the project with changes applied, sharing everything they don't
 * touch. Applied to the studio's latest state, an incoming change to one
 * channel leaves an edit to another channel in place, even one made a moment ago.
 */
export function withChanges(project: StudioProject, changes: readonly ProjectChange[]): StudioProject {
  const root = { ...project } as unknown as Json
  for (const { path, value } of changes) {
    let target = root
    for (const key of path.slice(0, -1)) {
      const child = target[key]
      target[key] = isObject(child) ? { ...child } : {}
      target = target[key] as Json
    }
    const last = path[path.length - 1]
    if (value === undefined) delete target[last]
    else target[last] = value
  }
  return root as unknown as StudioProject
}
