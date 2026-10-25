import { ConvexError, v } from 'convex/values'
import { internalMutation, internalQuery, mutation, query } from './_generated/server'
import type { MutationCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { applyChanges, isValidChange, MAX_CHANGES_PER_SAVE, PROJECT_FIELDS } from './projectChanges'
import type { ProjectChange, ProjectField } from './projectChanges'
import { isActive, publicProject, requireManagement, unavailable } from './projectAccess'
import { validProjectName } from './projectRules'

const MAX_PROJECTS = 200

/** Every project, newest first, for the home screen. */
export const list = query({
  args: {},
  handler: async (ctx) => (await ctx.db.query('projects')
    .withIndex('by_deletedAt_updatedAt', q => q.eq('deletedAt', undefined)).order('desc').take(MAX_PROJECTS)).map(publicProject),
})

/** Includes tombstones so deleting the last visible project never seeds demos. */
export const hasAny = query({ args: {}, handler: async ctx => !!(await ctx.db.query('projects').first()) })

/** One project, or null when the id is malformed or the project is gone (e.g. an old share link). */
export const get = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const projectId = ctx.db.normalizeId('projects', id)
    const project = projectId ? await ctx.db.get(projectId) : null
    return isActive(project) ? publicProject(project) : null
  },
})

export const create = mutation({
  args: { name: v.string(), color: v.string(), data: v.any(), managementKeyHash: v.optional(v.string()) },
  handler: (ctx, { name, color, data, managementKeyHash }) => {
    const clean = validProjectName(name)
    if (!clean) throw new ConvexError('Use a project name between 1 and 80 characters, on one line.')
    if (managementKeyHash !== undefined && !/^[a-f0-9]{64}$/.test(managementKeyHash)) throw new ConvexError('Invalid management credential.')
    return ctx.db.insert('projects', { name: clean, color, data, version: 1, updatedAt: Date.now(),
      ...(managementKeyHash ? { managementKeyHash } : {}),
    })
  },
})

export const rename = mutation({
  args: { id: v.id('projects'), key: v.string(), name: v.string(), expectedName: v.string() },
  handler: async (ctx, { id, key, name, expectedName }) => {
    const project = await requireManagement(await ctx.db.get(id), key)
    if (!isActive(project)) throw unavailable()
    const clean = validProjectName(name)
    if (!clean) throw new ConvexError('Use a project name between 1 and 80 characters, on one line.')
    if (project.name === clean) return
    if (project.name !== expectedName) throw new ConvexError('The project was renamed elsewhere. Close this dialog and try again.')
    // Metadata only: never replace music or advance its synchronization version.
    await ctx.db.patch(id, { name: clean, updatedAt: Date.now() })
  },
})

export const remove = mutation({
  args: { id: v.id('projects'), key: v.string(), expectedName: v.string(), expectedVersion: v.number(), expectedLifecycle: v.number() },
  handler: async (ctx, { id, key, expectedName, expectedVersion, expectedLifecycle }) => {
    const project = await requireManagement(await ctx.db.get(id), key)
    // A replay may acknowledge this deletion, but must never delete a restored generation.
    if (project.deletedAt !== undefined && (project.lifecycle ?? 0) === expectedLifecycle + 1) return
    if (!isActive(project)) throw unavailable()
    if (project.name !== expectedName || project.version !== expectedVersion || (project.lifecycle ?? 0) !== expectedLifecycle) {
      throw new ConvexError('The project changed. Close this dialog and review it before deleting.')
    }
    await ctx.db.patch(id, { deletedAt: Date.now(), lifecycle: expectedLifecycle + 1 })
    // The chat enforces one pending reply per project. Keep history and attempts;
    // invalidate the current generation even when a provider call is in flight.
    const pending = await ctx.db.query('chatMessages').withIndex('by_project_status', q => q.eq('projectId', id).eq('status', 'pending')).take(101)
    if (pending.length > 100) throw new ConvexError('This project needs an operator to review its pending replies before deletion.')
    for (const message of pending) {
      await ctx.db.patch(message._id, { status: 'error', content: 'This reply was stopped because the project was deleted.' })
    }
  },
})

export const restore = mutation({
  args: { id: v.id('projects'), key: v.string(), expectedLifecycle: v.number() },
  handler: async (ctx, { id, key, expectedLifecycle }) => {
    const project = await requireManagement(await ctx.db.get(id), key)
    if (project.deletedAt === undefined && (project.lifecycle ?? 0) === expectedLifecycle + 1) return
    if (project.deletedAt === undefined || project.lifecycle !== expectedLifecycle) throw new ConvexError('This recovery action is out of date. Reopen the dashboard.')
    await ctx.db.patch(id, { deletedAt: undefined, lifecycle: expectedLifecycle + 1 })
  },
})

/** Saves one browser's edits, applied in order on top of the latest copy. See projectChanges.ts. */
export const save = mutation({
  args: {
    id: v.id('projects'),
    clientId: v.string(),
    changes: v.array(v.object({ path: v.array(v.string()), value: v.optional(v.any()) })),
    lifecycle: v.optional(v.number()),
  },
  handler: (ctx, { id, clientId, changes, lifecycle = 0 }) => applyAndSave(ctx, id, changes, clientId, lifecycle),
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
  handler: async (ctx, { id }) => {
    const project = await ctx.db.get(id)
    return isActive(project) ? publicProject(project) : null
  },
})

export const saveFromServer = internalMutation({
  args: { id: v.id('projects'), fields: v.record(v.string(), v.any()), source: v.string(), lifecycle: v.optional(v.number()) },
  handler: (ctx, { id, fields, source, lifecycle = 0 }) => {
    const changes = Object.entries(fields).map(([field, value]) => ({ path: [field], value }))
    return applyAndSave(ctx, id, changes, source, lifecycle)
  },
})

async function applyAndSave(ctx: MutationCtx, id: Id<'projects'>, changes: ProjectChange[], clientId: string, lifecycle: number) {
  if (changes.length > MAX_CHANGES_PER_SAVE) throw new Error('Too many changes in one save')
  const invalid = changes.find((change) => !isValidChange(change))
  if (invalid) throw new Error(`Not a project field: ${invalid.path.join('.')} (expected one of ${PROJECT_FIELDS.join(', ')})`)
  const project = await ctx.db.get(id)
  if (!isActive(project) || (project.lifecycle ?? 0) !== lifecycle) throw unavailable()
  const data = project.data as Partial<Record<ProjectField, unknown>>
  applyChanges(data, changes)
  const version = project.version + 1
  await ctx.db.patch(id, { data, version, updatedAt: Date.now(), lastClientId: clientId })
  return version
}
