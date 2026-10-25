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
  }).index('by_updatedAt', ['updatedAt']),
})
