import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

/** Checked note suggestions from a reply (convex/noteSuggestions.ts). Steps are 0-based. */
export const suggestionSet = v.object({
  summary: v.optional(v.string()),
  items: v.array(v.object({
    action: v.union(v.literal('add'), v.literal('remove'), v.literal('change')),
    channelId: v.string(),
    channelName: v.string(),
    pattern: v.number(),
    step: v.number(),
    note: v.optional(v.string()),
    to: v.optional(v.string()),
    length: v.optional(v.number()),
    why: v.optional(v.string()),
  })),
  skipped: v.number(),
})

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
  }).index('by_updatedAt', ['updatedAt']),

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
    model: v.optional(v.string()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    /** Assistant replies: notes Claude suggested, highlighted in the editor on request. */
    suggestions: v.optional(suggestionSet),
  })
    .index('by_project', ['projectId', 'createdAt'])
    .index('by_project_request', ['projectId', 'requestId'])
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
