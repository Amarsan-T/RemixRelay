import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  projects: defineTable({
    name: v.string(),
    /** Card color on the home screen. */
    color: v.string(),
    /** The StudioProject (src/studio/types.ts) as plain JSON. */
    data: v.any(),
    /** Goes up by one on every save. */
    version: v.number(),
    /** Last save, ms since 1970. */
    updatedAt: v.number(),
    /** Browser tab (or 'assistant') that made the last save. */
    lastClientId: v.optional(v.string()),
    /** Optional for backwards compatibility. No public ownership claiming. */
    managementKeyHash: v.optional(v.string()),
    deletedAt: v.optional(v.number()),
    /** Fences saves queued before deletion, including after a restore. */
    lifecycle: v.optional(v.number()),
  }).index('by_updatedAt', ['updatedAt'])
    .index('by_deletedAt_updatedAt', ['deletedAt', 'updatedAt']),

  /** One message in a project's Claude chat (convex/chat.ts). */
  chatMessages: defineTable({
    projectId: v.id('projects'),
    role: v.union(v.literal('user'), v.literal('assistant')),
    /** The text; for a failed reply, what went wrong. */
    content: v.string(),
    /** An assistant reply is pending while Claude answers, then complete or error. User messages are complete. */
    status: v.union(v.literal('complete'), v.literal('pending'), v.literal('error')),
    createdAt: v.number(),
    /** User messages: chosen by the browser, so sending the same request twice saves it once. */
    requestId: v.optional(v.string()),
    /** Assistant replies: the user message being answered. */
    replyTo: v.optional(v.id('chatMessages')),
    /** Assistant replies: when the current attempt started (set again on retry). */
    startedAt: v.optional(v.number()),
    /** Generation number fences off results and watchdogs from older retries. */
    attempt: v.optional(v.number()),
    /** An action claims its attempt once before making a paid API call. */
    claimedAttempt: v.optional(v.number()),
    projectLifecycle: v.optional(v.number()),
    model: v.optional(v.string()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
  })
    .index('by_project', ['projectId', 'createdAt'])
    .index('by_project_request', ['projectId', 'requestId'])
    .index('by_project_status', ['projectId', 'status'])
    .index('by_started', ['startedAt']),

  /** Append-only request accounting: retries must not erase earlier API usage. */
  chatAttempts: defineTable({
    projectId: v.id('projects'),
    replyId: v.id('chatMessages'),
    attempt: v.number(),
    startedAt: v.number(),
  })
    .index('by_project_started', ['projectId', 'startedAt'])
    .index('by_started', ['startedAt']),
})
