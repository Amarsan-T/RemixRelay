import { createStudioProject } from './data'
import type { StudioProject } from './types'

/** A project on the home screen: its card details plus everything the studio edits. */
export interface ProjectEntry {
  id: string
  name: string
  color: string
  /** Last edit, ms since 1970, for "Edited 5 min ago". */
  updatedAt: number
  project: StudioProject
  version?: number
  lifecycle?: number
  canManage?: boolean
}

// Projects only live in memory for now: edits survive going home and back,
// but not a page refresh. Saving (e.g. to Convex) replaces this later.

const COLORS = ['#f97316', '#22d3ee', '#ec4899', '#a3e635', '#facc15', '#a78bfa']
const MINUTE = 60_000

export function createDemoProjects(): ProjectEntry[] {
  const now = Date.now()
  // preset null = no template: blank patterns, no notes, empty song.
  const demos: [name: string, preset: string | null, minutesAgo: number][] = [
    ['Trap Heat', 'Trap Heat', 12],
    ['House Party', 'House 4-on-Floor', 60],
    ['Night Drive', 'Synthwave 80s', 3 * 60],
    ['Study Beats', 'Lo-Fi Chill', 26 * 60],
    // Newest, so it's listed first on the home screen.
    ['Empty Template', null, 1],
  ]
  return demos.map(([name, preset, minutesAgo], i) => ({
    id: `demo-${i + 1}`,
    name,
    color: COLORS[i],
    updatedAt: now - minutesAgo * MINUTE,
    project: createStudioProject(preset),
  }))
}

/** An empty project, numbered after the ones that already exist. */
export function createBlankProject(existing: ProjectEntry[]): ProjectEntry {
  return {
    id: crypto.randomUUID(),
    name: `Untitled project ${existing.length + 1}`,
    color: COLORS[existing.length % COLORS.length],
    updatedAt: Date.now(),
    project: createStudioProject(null),
  }
}
