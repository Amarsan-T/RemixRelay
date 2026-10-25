/// <reference types="node" />
'use node'

import { v } from 'convex/values'
import { internalAction } from './_generated/server'
import { internal } from './_generated/api'
import { boundHistory, SYSTEM_PROMPT } from './assistantPrompt'
import type { StoredMessage } from './assistantPrompt'
import { describeProject } from './musicContext'
import type { ProjectData } from './musicContext'
import { askPython, serviceConfiguration } from './aiService'

// Convex owns durable claims, context, memory and persistence.
// Only the authenticated Python service holds credentials and calls Claude.
export const respond = internalAction({
  args: { replyId: v.id('chatMessages'), attempt: v.optional(v.number()) },
  handler: async (ctx, { replyId, attempt = 0 }): Promise<void> => {
    if (!(await ctx.runMutation(internal.chat.claim, { replyId, attempt }))) return
    const config = serviceConfiguration(process.env)
    if (!config) {
      await ctx.runMutation(internal.chat.finish, { replyId, attempt, status: 'error',
        content: "The AI assistant isn't set up on this server yet. The project owner needs to configure AI_SERVICE_URL and AI_SERVICE_TOKEN.",
      })
      return
    }
    const job: { projectName: string; projectData: unknown; history: StoredMessage[] } | null =
      await ctx.runQuery(internal.chat.forReply, { replyId, attempt })
    if (!job) {
      await ctx.runMutation(internal.chat.finish, { replyId, attempt, status: 'error', content: 'This conversation is no longer available.' })
      return
    }
    const outcome = await askPython(config, {
      requestId: replyId + ':' + attempt,
      systemPrompt: SYSTEM_PROMPT,
      projectContext: describeProject(job.projectName, job.projectData as ProjectData),
      history: boundHistory(job.history),
    })
    await ctx.runMutation(internal.chat.finish, { replyId, attempt, ...outcome })
  },
})
