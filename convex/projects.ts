import { ConvexError, v } from 'convex/values'
import { internalMutation, internalQuery, mutation, query } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { internal } from './_generated/api'
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

/** True once the database has ever held a project, so deleting the last one never seeds demos. */
export const hasAny = query({ args: {}, handler: ctx => everUsed(ctx) })

async function everUsed(ctx: QueryCtx) {
  // Older soft-deleted projects still count, as before permanent deletion.
  return !!(await ctx.db.query('projects').first()) ||
    !!(await ctx.db.query('appState').withIndex('by_key', q => q.eq('key', 'initialized')).first())
}

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

/**
 * Permanently deletes a project the caller manages: the project (its music)
 * at once, then its chat. There is no undo. Every open session sees the
 * project disappear through its subscription. The expected* arguments from
 * the earlier confirm-and-undo flow are accepted and ignored, so browsers
 * still running that version keep working.
 */
export const remove = mutation({
  args: {
    id: v.id('projects'), key: v.string(),
    expectedName: v.optional(v.string()), expectedVersion: v.optional(v.number()), expectedLifecycle: v.optional(v.number()),
  },
  handler: async (ctx, { id, key }) => {
    const project = await ctx.db.get(id)
    // Already gone (a double click or a retried request): nothing left to delete or reveal.
    if (project === null) return
    await requireManagement(project, key)
    // Projects soft-deleted before permanent deletion stay restorable; never purge them here.
    if (!isActive(project)) throw unavailable()
    if (!(await ctx.db.query('appState').withIndex('by_key', q => q.eq('key', 'initialized')).first())) {
      await ctx.db.insert('appState', { key: 'initialized' })
    }
    await ctx.db.delete(id)
    await purgeRecords(ctx, id)
  },
})

/** Chat records removed per transaction; the rest continue in a scheduled job. */
const PURGE_BATCH = 200
/** Matches the global hourly AI budget in convex/chat.ts. */
const ATTEMPT_RETENTION_MS = 60 * 60_000

/**
 * Deletes a deleted project's chat messages, then its chat attempts once they
 * are an hour old. Recent attempts still count toward the global hourly AI
 * budget, so deleting a project cannot be used to get around it.
 */
async function purgeRecords(ctx: MutationCtx, projectId: Id<'projects'>) {
  // Only ever for a project that no longer exists.
  if (await ctx.db.get(projectId)) return
  const messages = await ctx.db.query('chatMessages').withIndex('by_project', q => q.eq('projectId', projectId)).take(PURGE_BATCH)
  for (const message of messages) await ctx.db.delete(message._id)
  if (messages.length === PURGE_BATCH) {
    await ctx.scheduler.runAfter(0, internal.projects.purgeDeletedProject, { projectId })
    return
  }
  const cutoff = Date.now() - ATTEMPT_RETENTION_MS
  const old = await ctx.db.query('chatAttempts').withIndex('by_project_started', q => q.eq('projectId', projectId).lt('startedAt', cutoff)).take(PURGE_BATCH)
  for (const attempt of old) await ctx.db.delete(attempt._id)
  if (old.length === PURGE_BATCH) {
    await ctx.scheduler.runAfter(0, internal.projects.purgeDeletedProject, { projectId })
    return
  }
  const recent = await ctx.db.query('chatAttempts').withIndex('by_project_started', q => q.eq('projectId', projectId)).first()
  if (recent) await ctx.scheduler.runAt(recent.startedAt + ATTEMPT_RETENTION_MS + 1000, internal.projects.purgeDeletedProject, { projectId })
}

export const purgeDeletedProject = internalMutation({
  args: { projectId: v.id('projects') },
  handler: (ctx, { projectId }) => purgeRecords(ctx, projectId),
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
    if (await everUsed(ctx)) return 0
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
