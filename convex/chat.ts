import { ConvexError, v } from 'convex/values'
import { internalMutation, internalQuery, mutation, query } from './_generated/server'
import type { MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { internal } from './_generated/api'
import { HISTORY_MESSAGES } from './assistantPrompt'
import { MAX_MESSAGE_CHARS, PENDING_TIMEOUT_MS } from './chatLimits'
import { isActive } from './projectAccess'

const SHOWN_MESSAGES = 100
/** Every attempt, including a retry, counts toward these limits. */
export const LIMITS = { perProjectPerMinute: 5, perProjectPerHour: 40, allProjectsPerHour: 300 }
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const TIMEOUT_MESSAGE = 'This reply took too long and was stopped. Try again.'

export const list = query({
  args: { projectId: v.string() },
  handler: async (ctx, { projectId }) => {
    const id = ctx.db.normalizeId('projects', projectId)
    if (!id || !isActive(await ctx.db.get(id))) return []
    // Convex breaks equal index timestamps with _creationTime, so each question
    // precedes its reply even when both were inserted in one transaction.
    const recent = await ctx.db.query('chatMessages').withIndex('by_project', (q) => q.eq('projectId', id)).order('desc').take(SHOWN_MESSAGES)
    return recent.reverse().map(({ _id, role, content, status, createdAt }) => ({ _id, role, content, status, createdAt }))
  },
})

/** Save the question and its pending reply atomically. Resends are idempotent. */
export const send = mutation({
  args: { projectId: v.string(), requestId: v.string(), content: v.string() },
  handler: async (ctx, args) => {
    const projectId = ctx.db.normalizeId('projects', args.projectId)
    const project = projectId ? await ctx.db.get(projectId) : null
    if (!projectId || !isActive(project)) throw new ConvexError('This project no longer exists.')
    if (!/^[A-Za-z0-9-]{8,64}$/.test(args.requestId)) throw new ConvexError('Invalid request.')
    const content = args.content.trim()
    if (!content) throw new ConvexError('Type a message first.')
    if (content.length > MAX_MESSAGE_CHARS) throw new ConvexError('Messages can be up to ' + MAX_MESSAGE_CHARS + ' characters.')
    const existing = await ctx.db.query('chatMessages')
      .withIndex('by_project_request', (q) => q.eq('projectId', projectId).eq('requestId', args.requestId)).unique()
    if (existing) {
      if (existing.content !== content) throw new ConvexError('This request ID was already used for a different message.')
      return { messageId: existing._id, duplicate: true }
    }

    const now = Date.now()
    await checkCanAsk(ctx, projectId, now)
    await checkLimits(ctx, projectId, now)
    const messageId = await ctx.db.insert('chatMessages', {
      projectId, role: 'user', content, status: 'complete', createdAt: now, requestId: args.requestId,
    })
    const replyId = await ctx.db.insert('chatMessages', {
      projectId, role: 'assistant', content: '', status: 'pending', createdAt: now, replyTo: messageId, startedAt: now, attempt: 1, projectLifecycle: project.lifecycle ?? 0,
    })
    await scheduleAttempt(ctx, projectId, replyId, 1, now)
    return { messageId, duplicate: false }
  },
})

/** Reuse the latest failed reply; older turns stay in their original order. */
export const retry = mutation({
  args: { replyId: v.id('chatMessages') },
  handler: async (ctx, { replyId }) => {
    const reply = await ctx.db.get(replyId)
    if (!reply || reply.role !== 'assistant' || reply.status !== 'error') throw new ConvexError('Only a failed reply can be retried.')
    const project = await ctx.db.get(reply.projectId)
    if (!isActive(project)) throw new ConvexError('This project no longer exists.')
    const latest = await ctx.db.query('chatMessages').withIndex('by_project', (q) => q.eq('projectId', reply.projectId)).order('desc').first()
    if (latest?._id !== replyId) throw new ConvexError('Only the latest reply can be retried. Ask a new question instead.')
    const now = Date.now()
    await checkCanAsk(ctx, reply.projectId, now)
    await checkLimits(ctx, reply.projectId, now)
    const attempt = (reply.attempt ?? 0) + 1
    await ctx.db.patch(replyId, { status: 'pending', content: '', startedAt: now, attempt, projectLifecycle: project.lifecycle ?? 0 })
    await scheduleAttempt(ctx, reply.projectId, replyId, attempt, now)
  },
})

async function scheduleAttempt(ctx: MutationCtx, projectId: Id<'projects'>, replyId: Id<'chatMessages'>, attempt: number, startedAt: number) {
  await ctx.db.insert('chatAttempts', { projectId, replyId, attempt, startedAt })
  await ctx.scheduler.runAfter(0, internal.chatAgent.respond, { replyId, attempt })
  await ctx.scheduler.runAfter(PENDING_TIMEOUT_MS, internal.chat.expire, { replyId, attempt })
}

async function checkCanAsk(ctx: MutationCtx, projectId: Id<'projects'>, now: number) {
  const recent = await ctx.db.query('chatMessages').withIndex('by_project', (q) => q.eq('projectId', projectId)).order('desc').take(20)
  for (const message of recent) {
    if (message.status !== 'pending') continue
    if (now - (message.startedAt ?? message.createdAt) < PENDING_TIMEOUT_MS) throw new ConvexError('Claude is still answering the last message.')
    await ctx.db.patch(message._id, { status: 'error', content: TIMEOUT_MESSAGE })
  }
}

async function checkLimits(ctx: MutationCtx, projectId: Id<'projects'>, now: number) {
  const projectAttempts = await ctx.db.query('chatAttempts')
    .withIndex('by_project_started', (q) => q.eq('projectId', projectId).gt('startedAt', now - HOUR)).take(LIMITS.perProjectPerHour)
  if (projectAttempts.filter((attempt) => attempt.startedAt > now - MINUTE).length >= LIMITS.perProjectPerMinute) {
    throw new ConvexError('That was a lot of questions at once. Wait a minute, then ask again.')
  }
  if (projectAttempts.length >= LIMITS.perProjectPerHour) throw new ConvexError('This project has reached its hourly chat limit. Try again later.')
  const allAttempts = await ctx.db.query('chatAttempts').withIndex('by_started', (q) => q.gt('startedAt', now - HOUR)).take(LIMITS.allProjectsPerHour)
  if (allAttempts.length >= LIMITS.allProjectsPerHour) throw new ConvexError('The AI assistant is very busy right now. Try again later.')
}

/** Optional attempt 0 supports jobs already scheduled by the previous dev version. */
const attemptArgs = { replyId: v.id('chatMessages'), attempt: v.optional(v.number()) }
const isCurrent = (reply: Doc<'chatMessages'> | null, attempt = 0): reply is Doc<'chatMessages'> =>
  !!reply && reply.role === 'assistant' && reply.status === 'pending' && (reply.attempt ?? 0) === attempt

async function liveReply(ctx: Pick<MutationCtx, 'db'>, reply: Doc<'chatMessages'>) {
  const project = await ctx.db.get(reply.projectId)
  return isActive(project) && (project.lifecycle ?? 0) === (reply.projectLifecycle ?? 0)
}

/** At most one action may make a paid API call for a particular attempt. */
export const claim = internalMutation({
  args: attemptArgs,
  handler: async (ctx, { replyId, attempt = 0 }) => {
    const reply = await ctx.db.get(replyId)
    if (!isCurrent(reply, attempt) || reply.claimedAttempt === attempt || !(await liveReply(ctx, reply))) return false
    await ctx.db.patch(replyId, { claimedAttempt: attempt })
    return true
  },
})

/** Load only this project's finished messages up through the question being answered. */
export const forReply = internalQuery({
  args: attemptArgs,
  handler: async (ctx, { replyId, attempt = 0 }) => {
    const reply = await ctx.db.get(replyId)
    if (!isCurrent(reply, attempt) || !reply.replyTo) return null
    const project = await ctx.db.get(reply.projectId)
    if (!isActive(project) || (project.lifecycle ?? 0) !== (reply.projectLifecycle ?? 0)) return null
    const earlier = await ctx.db.query('chatMessages')
      .withIndex('by_project', (q) => q.eq('projectId', reply.projectId).lte('createdAt', reply.createdAt))
      .order('desc').take(3 * HISTORY_MESSAGES)
    const history = earlier.reverse().filter((message) => message.status === 'complete' && message._creationTime <= reply._creationTime)
    const end = history.findIndex((message) => message._id === reply.replyTo)
    if (end < 0) return null
    return {
      projectName: project.name, projectData: project.data,
      history: history.slice(0, end + 1).map(({ role, content }) => ({ role, content })),
    }
  },
})

/** A watchdog updates the subscription even if an action crashes or never runs. */
export const expire = internalMutation({
  args: attemptArgs,
  handler: async (ctx, { replyId, attempt = 0 }) => {
    const reply = await ctx.db.get(replyId)
    if (!isCurrent(reply, attempt) || !(await liveReply(ctx, reply)) || Date.now() - (reply.startedAt ?? reply.createdAt) < PENDING_TIMEOUT_MS) return
    await ctx.db.patch(replyId, { status: 'error', content: TIMEOUT_MESSAGE })
  },
})

/** Fence late completions so a timed-out action cannot overwrite a retry. */
export const finish = internalMutation({
  args: {
    ...attemptArgs,
    status: v.union(v.literal('complete'), v.literal('error')),
    content: v.string(), model: v.optional(v.string()),
    inputTokens: v.optional(v.number()), outputTokens: v.optional(v.number()),
  },
  handler: async (ctx, { replyId, attempt = 0, ...outcome }) => {
    const reply = await ctx.db.get(replyId)
    if (!isCurrent(reply, attempt) || !(await liveReply(ctx, reply))) return
    await ctx.db.patch(replyId, outcome)
  },
})
