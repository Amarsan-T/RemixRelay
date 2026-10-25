import { v } from 'convex/values'
import { internalMutation, internalQuery, mutation, query } from './_generated/server'
import type { MutationCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { applyChanges, isValidChange, PROJECT_FIELDS } from './projectChanges'
import type { ProjectChange, ProjectField } from './projectChanges'

const MAX_PROJECTS = 200
const MAX_CHANGES_PER_SAVE = 500

/** Every project, newest first, for the home screen. */
export const list = query({
  args: {},
  handler: (ctx) => ctx.db.query('projects').withIndex('by_updatedAt').order('desc').take(MAX_PROJECTS),
})

/** One project, or null when the id is malformed or the project is gone (e.g. an old share link). */
export const get = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const projectId = ctx.db.normalizeId('projects', id)
    return projectId ? await ctx.db.get(projectId) : null
  },
})

export const create = mutation({
  args: { name: v.string(), color: v.string(), data: v.any() },
  handler: (ctx, { name, color, data }) =>
    ctx.db.insert('projects', { name, color, data, version: 1, updatedAt: Date.now() }),
})

/** Saves one browser's edits, applied in order on top of the latest copy. See projectChanges.ts. */
export const save = mutation({
  args: {
    id: v.id('projects'),
    clientId: v.string(),
    changes: v.array(v.object({ path: v.array(v.string()), value: v.optional(v.any()) })),
  },
  handler: (ctx, { id, clientId, changes }) => applyAndSave(ctx, id, changes, clientId),
})

/** Fills an empty database with the demo projects. Safe to call from several tabs at once. */
export const seedDemos = mutation({
  args: { projects: v.array(v.object({ name: v.string(), color: v.string(), updatedAt: v.number(), data: v.any() })) },
  handler: async (ctx, { projects }) => {
    if (await ctx.db.query('projects').first()) return 0
    for (const project of projects) await ctx.db.insert('projects', { ...project, version: 1 })
    return projects.length
  },
})

// For server-side features such as the Claude assistant: read a project, and
// replace whole fields (say, `pianoNotes`). Every open studio picks it up live.

export const load = internalQuery({
  args: { id: v.id('projects') },
  handler: (ctx, { id }) => ctx.db.get(id),
})

export const saveFromServer = internalMutation({
  args: { id: v.id('projects'), fields: v.record(v.string(), v.any()), source: v.string() },
  handler: (ctx, { id, fields, source }) => {
    const changes = Object.entries(fields).map(([field, value]) => ({ path: [field], value }))
    return applyAndSave(ctx, id, changes, source)
  },
})

async function applyAndSave(ctx: MutationCtx, id: Id<'projects'>, changes: ProjectChange[], clientId: string) {
  if (changes.length > MAX_CHANGES_PER_SAVE) throw new Error('Too many changes in one save')
  const invalid = changes.find((change) => !isValidChange(change))
  if (invalid) throw new Error(`Not a project field: ${invalid.path.join('.')} (expected one of ${PROJECT_FIELDS.join(', ')})`)
  const project = await ctx.db.get(id)
  if (!project) throw new Error('Project not found')
  const data = project.data as Partial<Record<ProjectField, unknown>>
  applyChanges(data, changes)
  const version = project.version + 1
  await ctx.db.patch(id, { data, version, updatedAt: Date.now(), lastClientId: clientId })
  return version
}
