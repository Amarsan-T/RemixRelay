'use node'

import Anthropic from '@anthropic-ai/sdk'
import { v } from 'convex/values'
import { internalAction } from './_generated/server'
import { internal } from './_generated/api'
import { buildMessages, SYSTEM_PROMPT } from './assistantPrompt'
import type { StoredMessage } from './assistantPrompt'
import { describeProject } from './musicContext'
import type { ProjectData } from './musicContext'

// Asks Claude for one pending chat reply (scheduled by convex/chat.ts) and
// stores the answer. ANTHROPIC_API_KEY is a Convex environment variable on the
// deployment: it is read here, on the server, and never reaches the browser.

/** Set CLAUDE_MODEL on the deployment to use another model. */
const DEFAULT_MODEL = 'claude-opus-5-5'
/** Models that accept the server-side refusal fallback below. */
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5'])
/** Replies are meant to be short; this caps one reply and the cost of a request. */
const MAX_TOKENS = 4096
const TIMEOUT_MS = 60_000

interface Outcome {
  status: 'complete' | 'error'
  content: string
  model?: string
  inputTokens?: number
  outputTokens?: number
}

export const respond = internalAction({
  args: { replyId: v.id('chatMessages'), attempt: v.optional(v.number()) },
  // Explicit types: this action reads the generated API, which in turn describes this action.
  handler: async (ctx, { replyId, attempt = 0 }): Promise<void> => {
    if (!(await ctx.runMutation(internal.chat.claim, { replyId, attempt }))) return
    const finish = async (outcome: Outcome): Promise<void> => {
      await ctx.runMutation(internal.chat.finish, { replyId, attempt, ...outcome })
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return finish({ status: 'error', content: "The AI assistant isn't set up on this server yet (no API key)." })
    }
    const model = process.env.CLAUDE_MODEL?.trim() || DEFAULT_MODEL
    try {
      const job: { projectName: string; projectData: unknown; history: StoredMessage[] } | null =
        await ctx.runQuery(internal.chat.forReply, { replyId, attempt })
      if (!job) return finish({ status: 'error', content: 'This conversation is no longer available.' })
      // Retries are explicit and counted by chat.retry; avoid hidden SDK retries.
      const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID?.trim()
      const client = new Anthropic({
        timeout: TIMEOUT_MS, maxRetries: 0,
        ...(workspaceId ? { defaultHeaders: { 'anthropic-workspace-id': workspaceId } } : {}),
      })
      const response: Anthropic.Beta.BetaMessage = await client.beta.messages.create({
        model,
        max_tokens: MAX_TOKENS,
        // Chat answers don't need deep reasoning; low effort keeps replies quick and cheap.
        ...(FALLBACK_MODELS.has(model) ? { output_config: { effort: 'low' as const } } : {}),
        // If the model declines, the API retries on a suitable fallback model in the same call.
        ...(FALLBACK_MODELS.has(model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
        system: SYSTEM_PROMPT,
        messages: buildMessages(job.history, describeProject(job.projectName, job.projectData as ProjectData)),
      })
      if (response.stop_reason === 'refusal') {
        return finish({ status: 'error', content: "Claude couldn't help with that request. Try asking another way." })
      }
      const text = response.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n').trim()
      if (!text) return finish({ status: 'error', content: 'Claude sent an empty reply. Try again.' })
      const cut = response.stop_reason === 'max_tokens' ? '\n\n[This answer was cut short.]' : ''
      return finish({
        status: 'complete', content: text + cut, model: response.model,
        inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens,
      })
    } catch (error) {
      // Log only the kind of failure and its status, never request details.
      console.error('Claude request failed:', describeFailure(error))
      return finish({ status: 'error', content: friendlyMessage(error) })
    }
  },
})

function describeFailure(error: unknown): string {
  if (error instanceof Anthropic.APIError) return `${error.constructor.name} status=${error.status} request=${error.requestID ?? 'none'}${error instanceof Anthropic.BadRequestError ? ` reason=${badRequestReason(error)}` : ''}`
  return error instanceof Error ? error.name : 'unknown error'
}

/** Classify the provider body in memory; never expose its text or request data. */
function badRequestReason(error: { error: unknown; message: string }): 'billing' | 'workspace' | 'model' | 'fallback' | 'effort' | 'thinking' | 'tokens' | 'request' {
  const body = error.error as { error?: { message?: unknown }; message?: unknown } | undefined
  const detail = body?.error?.message ?? body?.message ?? error.message
  const message = typeof detail === 'string' ? detail.toLowerCase() : ''
  if (/credit balance|insufficient (?:credit|fund)|billing|spend(?:ing)? limit|purchase credits/.test(message)) return 'billing'
  if (/workspace/.test(message)) return 'workspace'
  if (/fallback|beta/.test(message)) return 'fallback'
  if (/effort|output_config/.test(message)) return 'effort'
  if (/thinking/.test(message)) return 'thinking'
  if (/max_tokens/.test(message)) return 'tokens'
  if (/model/.test(message)) return 'model'
  return 'request'
}

/** What the user sees for each kind of failure. */
function friendlyMessage(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return "The AI assistant's API key was rejected. The project owner needs to update it."
  }
  if (error instanceof Anthropic.RateLimitError) return 'Claude is busy right now. Try again in a minute.'
  if (error instanceof Anthropic.NotFoundError) {
    if (badRequestReason(error) === 'workspace') return 'The configured Anthropic workspace is unavailable. The project owner needs to check ANTHROPIC_WORKSPACE_ID.'
    return 'The configured Claude model is unavailable. The project owner needs to update CLAUDE_MODEL.'
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) return 'Claude took too long to answer. Try again.'
  if (error instanceof Anthropic.APIConnectionError) return "Couldn't reach Claude. Check the connection and try again."
  if (error instanceof Anthropic.BadRequestError) {
    const reason = badRequestReason(error)
    if (reason === 'billing') return "The AI assistant's Anthropic account has no available API budget. The project owner needs to check credits and spending limits."
    if (reason === 'workspace') return 'The AI assistant needs an Anthropic workspace. The project owner needs to set ANTHROPIC_WORKSPACE_ID on the Convex server or use a workspace-scoped key.'
    if (reason === 'model') return 'The configured Claude model is unavailable. The project owner needs to update CLAUDE_MODEL.'
    if (reason !== 'request') return "Claude rejected the server's model settings. The project owner needs to check CLAUDE_MODEL and API options."
    return "Claude couldn't process this conversation. Try a shorter message."
  }
  if (error instanceof Anthropic.APIError && (error.status ?? 0) >= 500) return 'Claude is temporarily unavailable. Try again shortly.'
  return 'Something went wrong asking Claude. Try again.'
}
