/** Shared project patches. Legacy whole-field/channel replacements remain valid. */
export const PROJECT_FIELDS = [
  'bpm', 'loop', 'metronome', 'channels', 'stepData', 'pianoNotes', 'mixerTracks', 'song', 'patternSteps',
  'patternCount',
] as const
export type ProjectField = (typeof PROJECT_FIELDS)[number]
export const NESTED_FIELDS: readonly ProjectField[] = ['stepData', 'pianoNotes']
export const MAX_CHANGES_PER_SAVE = 500

/** A fourth path part addresses a gate index or a group of notes starting at that step. */
export interface ProjectChange { path: string[]; value?: unknown }

export function isStepKey(key: string): boolean {
  return /^(0|[1-9]\d*)$/.test(key) && Number(key) < 256
}

export function isValidChange({ path, value }: ProjectChange): boolean {
  const [field] = path
  if (!PROJECT_FIELDS.includes(field as ProjectField) || !path.every(key => key.length > 0 && !['__proto__', 'constructor', 'prototype'].includes(key))) return false
  if (path.length === 4) {
    if (!isStepKey(path[3])) return false
    if (field === 'stepData') return value === 0 || value === 1
    if (field === 'pianoNotes') return Array.isArray(value) && value.every(note =>
      note !== null && typeof note === 'object' && !Array.isArray(note) && note.step === Number(path[3]))
    return false
  }
  return path.length <= (NESTED_FIELDS.includes(field as ProjectField) ? 3 : 1)
}

/** Applies to the latest database copy inside the existing atomic projects.save transaction. */
export function applyChanges(data: Record<string, unknown>, changes: readonly ProjectChange[]): void {
  for (const { path, value } of changes) {
    let target = data
    // Step patches stop at the pattern; arrays keep their stored representation.
    const parents = path.length === 4 ? path.slice(0, 2) : path.slice(0, -1)
    for (const key of parents) {
      const next = target[key]
      if (typeof next !== 'object' || next === null) target[key] = {}
      target = target[key] as Record<string, unknown>
    }
    if (path.length === 4) {
      const channel = path[2], step = Number(path[3])
      if (path[0] === 'stepData') {
        const row = Array.isArray(target[channel]) ? target[channel] as unknown[] : []
        while (row.length <= step) row.push(0) // Never persist sparse/undefined array gaps.
        row[step] = value
        target[channel] = row
      } else {
        const notes = Array.isArray(target[channel]) ? target[channel] as { step: number }[] : []
        const first = notes.findIndex(note => note.step === step)
        const remaining = notes.filter(note => note.step !== step)
        const insertion = first < 0 ? remaining.length : notes.slice(0, first).filter(note => note.step !== step).length
        remaining.splice(insertion, 0, ...value as { step: number }[])
        target[channel] = remaining
      }
      continue
    }
    const last = path[path.length - 1]
    if (value === undefined) delete target[last]
    else target[last] = value
  }
}
