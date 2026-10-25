import type { StoredMessage } from './assistantPrompt'

export interface ServiceRequest { requestId: string; systemPrompt: string; projectContext: string; history: StoredMessage[] }
interface ServiceConfig { url: string; token: string; bypass?: string }
interface Outcome { status: 'complete' | 'error'; content: string; model?: string; inputTokens?: number; outputTokens?: number }

// Fail closed. Secrets are server-only; redirects must never receive them.
export function serviceConfiguration(env: Record<string, string | undefined>): ServiceConfig | null {
  const token = env.AI_SERVICE_TOKEN
  if (!token || token.length < 32 || /\s/.test(token)) return null
  try {
    const url = new URL(env.AI_SERVICE_URL ?? '')
    const local = env.AI_SERVICE_ALLOW_LOCAL === '1' && url.protocol === 'http:' &&
      ['127.0.0.1', 'localhost'].includes(url.hostname) &&
      (!env.CONVEX_CLOUD_URL || new URL(env.CONVEX_CLOUD_URL).protocol === 'http:')
    if (!local && (url.protocol !== 'https:' || !url.hostname.endsWith('.vercel.app') || url.port)) return null
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/api/ai') return null
    return { url: url.href, token, ...(env.AI_SERVICE_VERCEL_BYPASS ? { bypass: env.AI_SERVICE_VERCEL_BYPASS } : {}) }
  } catch { return null }
}

const messages: Record<string, string> = {
  unauthorized: 'The AI service authentication failed. The project owner needs to check AI_SERVICE_TOKEN.',
  configuration: "The AI assistant isn't set up on the Python server yet. The project owner needs to check its server settings.",
  provider_auth: "The AI assistant's API key was rejected. The project owner needs to update it on Vercel.",
  billing: "The AI assistant's Anthropic account has no available API budget. The project owner needs to check credits and spending limits.",
  workspace: 'The configured Anthropic workspace is unavailable. The project owner needs to check ANTHROPIC_WORKSPACE_ID on Vercel.',
  model: 'The configured Claude model is unavailable. The project owner needs to update CLAUDE_MODEL on Vercel.',
  settings: "Claude rejected the server's model settings. The project owner needs to check CLAUDE_MODEL and API options.",
  invalid_request: "Claude couldn't process this conversation. Try a shorter message.",
  rate_limit: 'Claude is busy right now. Try again in a minute.',
  busy: 'The AI service is busy right now. Try again shortly.',
  timeout: 'Claude took too long to answer. A timed-out request may still have been billed; retry only when needed.',
  network: "Couldn't reach the AI service. Check the connection and try again.",
  upstream: 'Claude is temporarily unavailable. Try again shortly.',
  empty_reply: 'Claude sent an empty reply. Try again.',
  refusal: "Claude couldn't help with that request. Try asking another way.",
  conflict: 'This AI request could not be safely replayed. Try again.',
}
const fail = (code: string): Outcome => ({ status: 'error', content: messages[code] ?? 'The AI service returned an unexpected response. Try again.' })

// One HTTP attempt only; explicit retries remain durable, counted Convex attempts.
export async function askPython(config: ServiceConfig, payload: ServiceRequest): Promise<Outcome> {
  try {
    const response = await fetch(config.url, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(70_000),
      headers: { authorization: 'Bearer ' + config.token, 'content-type': 'application/json',
        ...(config.bypass ? { 'x-vercel-protection-bypass': config.bypass } : {}) },
      body: JSON.stringify(payload),
    })
    const text = await response.text()
    if (text.length > 196_608) return fail('protocol')
    let result: unknown
    try { result = JSON.parse(text) } catch { return fail(response.status === 401 || response.status === 403 ? 'unauthorized' : 'protocol') }
    if (!result || typeof result !== 'object') return fail('protocol')
    const data = result as Record<string, unknown>
    if (!response.ok || data.status === 'error') {
      const error = data.error as { code?: unknown } | undefined
      return fail(typeof error?.code === 'string' ? error.code : 'protocol')
    }
    if (data.requestId !== payload.requestId || data.status !== 'complete' || typeof data.content !== 'string' ||
      !data.content.trim() || data.content.length > 24_000 || typeof data.model !== 'string' || data.model.length > 128 ||
      !Number.isSafeInteger(data.inputTokens) || Number(data.inputTokens) < 0 ||
      !Number.isSafeInteger(data.outputTokens) || Number(data.outputTokens) < 0 || Number(data.outputTokens) > 4096) return fail('protocol')
    return { status: 'complete', content: data.content, model: data.model, inputTokens: Number(data.inputTokens), outputTokens: Number(data.outputTokens) }
  } catch (error) {
    // Never log tokens, headers, context, provider bodies or URLs.
    return fail(error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name) ? 'timeout' : 'network')
  }
}
