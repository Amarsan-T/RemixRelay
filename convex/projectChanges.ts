/**
 * How edits to a StudioProject (src/studio/types.ts) are saved. A save is a list
 * of changes, each replacing the value at one path in the project. Step and note
 * data change per pattern and channel, so two people drumming on different
 * channels at the same moment don't overwrite each other. Everything else
 * changes as a whole top-level field.
 *
 * Shared by the Convex functions and the browser; it must not import anything.
 */
export const PROJECT_FIELDS = [
  'bpm', 'loop', 'metronome', 'channels', 'stepData', 'pianoNotes', 'mixerTracks', 'song', 'patternSteps',
  // Added patterns (the + buttons). Any new StudioProject field must be listed here,
  // or edits to it are never saved or shared.
  'patternCount',
] as const

export type ProjectField = (typeof PROJECT_FIELDS)[number]

/** Fields keyed by pattern, then channel id. */
export const NESTED_FIELDS: readonly ProjectField[] = ['stepData', 'pianoNotes']

/** Sets the value at `path`, e.g. ['bpm'] or ['stepData', '1', 'kick']. An absent value deletes it. */
export interface ProjectChange {
  path: string[]
  value?: unknown
}

export function isValidChange({ path }: ProjectChange): boolean {
  const [field] = path
  if (!PROJECT_FIELDS.includes(field as ProjectField)) return false
  const maxDepth = NESTED_FIELDS.includes(field as ProjectField) ? 3 : 1
  return path.length <= maxDepth && path.every((key) => key.length > 0)
}

/** Applies changes in order, mutating `data`. Missing pattern objects are created on the way. */
export function applyChanges(data: Record<string, unknown>, changes: readonly ProjectChange[]): void {
  for (const { path, value } of changes) {
    let target = data
    for (const key of path.slice(0, -1)) {
      const next = target[key]
      if (typeof next !== 'object' || next === null) target[key] = {}
      target = target[key] as Record<string, unknown>
    }
    const last = path[path.length - 1]
    if (value === undefined) delete target[last]
    else target[last] = value
  }
}
