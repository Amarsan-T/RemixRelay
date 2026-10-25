import { convexTest } from 'convex-test'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { api, internal } from '../convex/_generated/api'
import schema from '../convex/schema'
import { PENDING_TIMEOUT_MS } from '../convex/chatLimits'
import { LIMITS } from '../convex/chat'

// Exercise real registered functions, indexes and scheduled actions, replacing
// only the authenticated Python HTTP boundary. No credentials or network are needed.
const modules = import.meta.glob('../convex/**/*.ts')
const fetchMock = vi.fn()
const createTest = () => convexTest(schema, modules)
let t: ReturnType<typeof createTest>
let projectId: Awaited<ReturnType<typeof createProject>>

async function createProject(name = 'Test song', bpm = 97) {
  return t.mutation(api.projects.create, { name, color: '#1ea7f2', data: { bpm, channels: [], patternCount: 4 } })
}
const list = () => t.query(api.chat.list, { projectId })
const send = (content = 'My name is Ada. What is my tempo?', requestId = crypto.randomUUID()) =>
  t.mutation(api.chat.send, { projectId, requestId, content })
const reply = async () => (await list()).at(-1)!
const complete = async (text = 'Your song is at 97 BPM.') => {
  const message = await reply()
  await t.mutation(internal.chat.finish, { replyId: message._id, attempt: 1, status: 'complete', content: text })
}
const flush = async () => {
  vi.advanceTimersByTime(1)
  await t.finishInProgressScheduledFunctions()
}
const response = (content = 'Your song is at 97 BPM.', stop_reason = 'end_turn') => new Response(JSON.stringify(
  !content ? { status: 'error', error: { code: 'empty_reply' } } : {
    requestId: JSON.parse(fetchMock.mock.calls.at(-1)![1].body).requestId,
    status: 'complete', content: content + (stop_reason === 'max_tokens' ? '\\n\\n[This answer was cut short.]' : ''),
    model: 'claude-opus-5-5', inputTokens: 120, outputTokens: 12,
  }), { status: content ? 200 : 502, headers: { 'content-type': 'application/json' } })

beforeEach(async () => {
  vi.useFakeTimers()
  vi.stubEnv('AI_SERVICE_URL', 'https://preview.vercel.app/api/ai')
  vi.stubEnv('AI_SERVICE_TOKEN', 'test-only-service-token-abcdefghijklmnopqrstuvwxyz')
  vi.stubEnv('ANTHROPIC_API_KEY', 'must-never-be-used-by-convex')
  vi.stubEnv('CLAUDE_MODEL', '')
  vi.stubEnv('ANTHROPIC_WORKSPACE_ID', '')
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset().mockImplementation(async () => response())
  t = createTest()
  projectId = await createProject()
})

afterEach(async () => {
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

test('same request concurrently saves exactly one ordered question/reply pair', async () => {
  const requestId = crypto.randomUUID()
  const results = await Promise.all([send('hello', requestId), send('hello', requestId)])
  expect(results[0].messageId).toBe(results[1].messageId)
  expect((await list()).map((m) => m.role)).toEqual(['user', 'assistant'])
  expect(await t.run((ctx) => ctx.db.query('chatAttempts').collect())).toHaveLength(1)
  await expect(send('different text', requestId)).rejects.toThrow('already used')
  await flush()
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

test('concurrent different questions serialize; different projects remain independent', async () => {
  const results = await Promise.allSettled([send('first'), send('second')])
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
  expect((await list()).filter((m) => m.role === 'user')).toHaveLength(1)
  const otherId = await createProject('Other song', 133)
  await t.mutation(api.chat.send, { projectId: otherId, requestId: crypto.randomUUID(), content: 'Other question' })
  await flush()
  expect(await t.query(api.chat.list, { projectId: otherId })).toHaveLength(2)
  expect((await list())[0].content).not.toBe('Other question')
})

test('scheduled response uses saved context and prior memory, and persists token usage', async () => {
  await send()
  await flush()
  expect(await reply()).toMatchObject({ status: 'complete', content: 'Your song is at 97 BPM.' })
  const stored = await t.run((ctx) => ctx.db.query('chatMessages').order('desc').first())
  expect(stored).toMatchObject({ model: 'claude-opus-5-5', inputTokens: 120, outputTokens: 12 })
  await t.mutation(api.projects.save, { id: projectId, clientId: 'test', changes: [{ path: ['bpm'], value: 101 }] })
  await send('Do you remember my name and the current tempo?')
  await flush()
  const request = fetchMock.mock.calls.at(-1)!
  const body = JSON.parse(request[1].body)
  expect(body.history[0].content).toContain('Ada')
  expect(body.history[1].content).toContain('97 BPM')
  expect(body.projectContext).toContain('101 BPM')
  expect(body.history.at(-1).content).toContain('current tempo')
  expect(body.systemPrompt).toContain('music assistant')
  expect(body.requestId).toMatch(/:1$/)
  expect(request[1].redirect).toBe('error')
  expect(new Headers(request[1].headers).get('authorization')).toContain('Bearer test-only-service-token-')
  expect(await list()).toHaveLength(4)
})

test('the watchdog releases abandoned requests, and old results cannot overwrite retries', async () => {
  await send()
  const oldReply = await reply()
  // Simulate an action that started but was lost before making its HTTP call.
  expect(await t.mutation(internal.chat.claim, { replyId: oldReply._id, attempt: 1 })).toBe(true)
  await flush()
  vi.advanceTimersByTime(PENDING_TIMEOUT_MS)
  await t.finishInProgressScheduledFunctions()
  expect(await reply()).toMatchObject({ status: 'error', content: expect.stringContaining('too long') })
  await t.mutation(api.chat.retry, { replyId: oldReply._id })
  await t.mutation(internal.chat.finish, { replyId: oldReply._id, attempt: 1, status: 'complete', content: 'STALE' })
  await t.mutation(internal.chat.expire, { replyId: oldReply._id, attempt: 1 })
  expect(await reply()).toMatchObject({ status: 'pending', content: '' })
  await flush()
  expect(await reply()).toMatchObject({ _id: oldReply._id, status: 'complete', content: 'Your song is at 97 BPM.' })
  expect(await list()).toHaveLength(2)
})

test('duplicate action executions claim the same attempt only once', async () => {
  await send()
  const message = await reply()
  await Promise.all([
    t.action(internal.chatAgent.respond, { replyId: message._id, attempt: 1 }),
    t.action(internal.chatAgent.respond, { replyId: message._id, attempt: 1 }),
  ])
  await flush()
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

test('missing server key gives a recoverable error without contacting Anthropic', async () => {
  vi.stubEnv('AI_SERVICE_TOKEN', '')
  await send()
  await flush()
  expect(await reply()).toMatchObject({ status: 'error', content: expect.stringContaining("isn't set up") })
  expect(fetchMock).not.toHaveBeenCalled()
})

test('HTTP errors are safe to show, and a user retry reuses the same record', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ status: 'error', error: { code: 'provider_auth', message: 'sensitive provider details' } }), { status: 401 }))
  await send()
  await flush()
  const failed = await reply()
  expect(failed).toMatchObject({ status: 'error', content: expect.stringContaining('key was rejected') })
  expect(failed.content).not.toContain('sensitive')
  await t.mutation(api.chat.retry, { replyId: failed._id })
  await flush()
  expect(await reply()).toMatchObject({ _id: failed._id, status: 'complete' })
  expect(await list()).toHaveLength(2)
})

test('retries count toward minute limits without replacing previous attempt records', async () => {
  vi.stubEnv('AI_SERVICE_TOKEN', '')
  await send()
  await flush()
  const message = await reply()
  for (let i = 1; i < LIMITS.perProjectPerMinute; i++) {
    await t.mutation(api.chat.retry, { replyId: message._id })
    await flush()
  }
  await expect(t.mutation(api.chat.retry, { replyId: message._id })).rejects.toThrow('Wait a minute')
  expect(await t.run((ctx) => ctx.db.query('chatAttempts').collect())).toHaveLength(5)
  expect(await list()).toHaveLength(2)
})

test.each([
  ['Your credit balance is too low to access the Anthropic API.', 'credits and spending limits', 'billing'],
  ['The organization has reached its spend limit.', 'credits and spending limits', 'billing'],
  ['This API key is not scoped to a workspace; include anthropic-workspace-id.', 'ANTHROPIC_WORKSPACE_ID', 'workspace'],
  ['Unsupported beta header: provider-only details', 'model settings', 'settings'],
  ['output_config.effort is unsupported on this model: provider-only details', 'model settings', 'settings'],
  ['Invalid model identifier: provider-only details', 'CLAUDE_MODEL', 'model'],
  ['Invalid message content: provider-only details', 'Try a shorter message', 'invalid_request'],
])('service error codes are classified safely: %s', async (message, expected, reason) => {
  const logger = vi.spyOn(console, 'error').mockImplementation(() => {})
  fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ status: 'error', error: { code: reason, message } }), { status: 400 }))
  await send()
  await flush()
  expect((await reply()).content).toContain(expected)
  expect((await reply()).content).not.toContain(message)
  expect(logger).not.toHaveBeenCalled()
  expect(JSON.stringify(logger.mock.calls)).not.toContain(message)
})

test('non-JSON service errors are rejected without exposing their body', async () => {
  const message = 'Credit balance is too low. Private provider diagnostic.'
  const logger = vi.spyOn(console, 'error').mockImplementation(() => {})
  fetchMock.mockImplementationOnce(async () => new Response(message, { status: 400 }))
  await send()
  await flush()
  expect((await reply()).content).toContain('unexpected response')
  expect(logger).not.toHaveBeenCalled()
  expect(JSON.stringify(logger.mock.calls)).not.toContain(message)
})

test('only the service token crosses the Convex boundary; upstream credentials never do', async () => {
  vi.stubEnv('ANTHROPIC_WORKSPACE_ID', ' wrkspc_test ')
  await send()
  await flush()
  const options = fetchMock.mock.calls[0][1]
  expect(new Headers(options.headers).get('anthropic-workspace-id')).toBeNull()
  expect(new Headers(options.headers).get('x-api-key')).toBeNull()
  expect(JSON.stringify(options)).not.toContain('must-never-be-used-by-convex')
  expect(options.body).not.toContain('wrkspc_test')
  expect(await reply()).toMatchObject({ status: 'complete' })
})

test('an unavailable workspace is distinguished from an unavailable model', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ status: 'error', error: { code: 'workspace', message: 'Workspace not found.' } }), { status: 404 }))
  await send()
  await flush()
  expect((await reply()).content).toContain('ANTHROPIC_WORKSPACE_ID')
})

test('hourly and global budgets reject requests before saving another question', async () => {
  await send()
  await complete()
  const message = await reply()
  await t.run(async (ctx) => {
    for (let i = 1; i < LIMITS.perProjectPerHour; i++) {
      await ctx.db.insert('chatAttempts', { projectId, replyId: message._id, attempt: i, startedAt: Date.now() - 120_000 })
    }
  })
  await expect(send()).rejects.toThrow('hourly chat limit')
  const otherId = await createProject('Other')
  await t.run(async (ctx) => {
    for (let i = LIMITS.perProjectPerHour; i < LIMITS.allProjectsPerHour; i++) {
      await ctx.db.insert('chatAttempts', { projectId, replyId: message._id, attempt: i, startedAt: Date.now() - 120_000 })
    }
  })
  await expect(t.mutation(api.chat.send, { projectId: otherId, requestId: crypto.randomUUID(), content: 'hi' })).rejects.toThrow('very busy')
  expect(await t.query(api.chat.list, { projectId: otherId })).toEqual([])
})

test('older failed turns cannot be retried after a newer question', async () => {
  vi.stubEnv('AI_SERVICE_TOKEN', '')
  await send('first')
  await flush()
  const failed = await reply()
  await send('second')
  await flush()
  await expect(t.mutation(api.chat.retry, { replyId: failed._id })).rejects.toThrow('Only the latest')
})

test('history is project-scoped and bounded, while saved messages remain available', async () => {
  await t.run(async (ctx) => {
    for (let i = 0; i < 120; i++) {
      await ctx.db.insert('chatMessages', { projectId, role: i % 2 ? 'assistant' : 'user', content: 'previous ' + i, status: 'complete', createdAt: Date.now() - 1000 + i })
    }
  })
  const otherId = await createProject('Other')
  await t.mutation(api.chat.send, { projectId: otherId, requestId: crypto.randomUUID(), content: 'private to other project' })
  await send('latest')
  await flush()
  expect(await list()).toHaveLength(100)
  const requests = fetchMock.mock.calls.map((call) => JSON.parse(call[1].body))
  const body = requests.find((request) => request.history.at(-1).content === 'latest')!
  expect(body.history.length).toBeLessThanOrEqual(20)
  expect(JSON.stringify(body)).not.toContain('private to other project')
  expect(await t.run((ctx) => ctx.db.query('chatMessages').withIndex('by_project', (q) => q.eq('projectId', projectId)).collect())).toHaveLength(122)
})

test('the configured Python service, not a request body, owns model selection', async () => {
  vi.stubEnv('CLAUDE_MODEL', 'custom-supported-model')
  await send()
  await flush()
  const body = JSON.parse(fetchMock.mock.calls[0][1].body)
  expect(body.model).toBeUndefined()
  expect(body.output_config).toBeUndefined()
  expect(body.fallbacks).toBeUndefined()
})

test('empty responses and output truncation are handled explicitly', async () => {
  fetchMock.mockImplementationOnce(async () => response(''))
  await send()
  await flush()
  expect(await reply()).toMatchObject({ status: 'error', content: expect.stringContaining('empty reply') })
  fetchMock.mockImplementationOnce(async () => response('A partial answer', 'max_tokens'))
  await t.mutation(api.chat.retry, { replyId: (await reply())._id })
  await flush()
  expect((await reply()).content).toContain('[This answer was cut short.]')
})

test('service configuration rejects unsafe URLs and never enables local access on cloud', async () => {
  const { serviceConfiguration } = await import('../convex/aiService')
  const env = { AI_SERVICE_TOKEN: 'test-only-service-token-abcdefghijklmnopqrstuvwxyz', AI_SERVICE_URL: 'https://preview.vercel.app/api/ai' }
  expect(serviceConfiguration(env)?.url).toBe(env.AI_SERVICE_URL)
  for (const url of ['http://preview.vercel.app/api/ai', 'https://preview.vercel.app/api/ai?token=secret',
    'https://user:secret@preview.vercel.app/api/ai', 'https://preview.vercel.app/api/ai#part',
    'https://preview.vercel.app.attacker.example/api/ai', 'https://127.0.0.1/api/ai', 'https://preview.vercel.app/other']) {
    expect(serviceConfiguration({ ...env, AI_SERVICE_URL: url })).toBeNull()
  }
  expect(serviceConfiguration({ ...env, AI_SERVICE_TOKEN: 'short' })).toBeNull()
  expect(serviceConfiguration({ ...env, AI_SERVICE_URL: 'http://127.0.0.1:8000/api/ai', AI_SERVICE_ALLOW_LOCAL: '1', CONVEX_CLOUD_URL: 'https://silent-butterfly-873.convex.cloud' })).toBeNull()
})

test('invalid service replies and wrong request identities cannot become saved answers', async () => {
  for (const result of [
    { status: 'complete', requestId: 'wrong', content: 'BAD', model: 'test', inputTokens: 1, outputTokens: 1 },
    { status: 'complete', content: 'BAD', model: 'test', inputTokens: -1, outputTokens: 99999 },
  ]) {
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify(result), { status: 200 }))
    await send()
    await flush()
    expect((await reply()).content).toContain('unexpected response')
  }
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

test('network failures are not retried and never expose transport diagnostics', async () => {
  fetchMock.mockRejectedValueOnce(new Error('private connection and service token details'))
  await send()
  await flush()
  expect((await reply()).content).toContain("Couldn't reach")
  expect((await reply()).content).not.toContain('private')
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

// Two clients take independent stale snapshots, then call the real atomic projects.save.
for (const order of ['a-first', 'b-first', 'parallel'] as const) {
  test(`same-channel stale clients preserve disjoint gates and note onsets (${order})`, async () => {
    const { changesBetween, toStored } = await import('../src/studio/projectSync')
    const { createStudioProject } = await import('../src/studio/data')
    const { togglePatternStep } = await import('../src/studio/patternEditing')
    const initial = toStored(createStudioProject(null))
    const id = await t.mutation(api.projects.create, { name: 'Atomic sync', color: '#123456', data: initial })
    const a = t.withIdentity({ subject: 'independent-a' }), b = t.withIdentity({ subject: 'independent-b' })
    const [snapshotA, snapshotB] = await Promise.all([a.query(api.projects.get, { id }), b.query(api.projects.get, { id })])
    const change = (snapshot: typeof snapshotA, step: number) => {
      const before = snapshot!.data as typeof initial
      const gates = togglePatternStep(before, 1, 'kick', step)
      const after = { ...gates, pianoNotes: { ...gates.pianoNotes, 1: { synth_lead: [{ step, note: 'C4', length: 2 }] } } }
      return changesBetween(before, after)
    }
    const left = change(snapshotA, 20), right = change(snapshotB, 23)
    const saveA = () => a.mutation(api.projects.save, { id, clientId: 'a', changes: left })
    const saveB = () => b.mutation(api.projects.save, { id, clientId: 'b', changes: right })
    if (order === 'parallel') await Promise.all([saveA(), saveB()])
    else if (order === 'a-first') { await saveA(); await saveB() }
    else { await saveB(); await saveA() }
    const saved = (await t.query(api.projects.get, { id }))!
    expect(saved.version).toBe(3)
    expect(saved.data.stepData[1].kick[20]).toBe(1)
    expect(saved.data.stepData[1].kick[23]).toBe(1)
    expect(saved.data.pianoNotes[1].synth_lead.map((n: { step: number }) => n.step).sort()).toEqual([20, 23])
    // Turning off authored notes at independent steps also patches just those onsets.
    const offA = changesBetween(saved.data, togglePatternStep(saved.data, 1, 'synth_lead', 20))
    const offB = changesBetween(saved.data, togglePatternStep(saved.data, 1, 'synth_lead', 23))
    const removeA = () => a.mutation(api.projects.save, { id, clientId: 'a', changes: offA })
    const removeB = () => b.mutation(api.projects.save, { id, clientId: 'b', changes: offB })
    if (order === 'parallel') await Promise.all([removeA(), removeB()])
    else if (order === 'a-first') { await removeA(); await removeB() }
    else { await removeB(); await removeA() }
    const final = (await t.query(api.projects.get, { id }))!
    expect(final.data.pianoNotes[1].synth_lead).toEqual([])
    expect(final.data.stepData[1].kick[20]).toBe(1)
    expect(final.data.stepData[1].kick[23]).toBe(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })
}

test('invalid atomic changes reject the entire transaction and preserve data/version', async () => {
  const before = await t.query(api.projects.get, { id: projectId })
  await expect(t.mutation(api.projects.save, { id: projectId, clientId: 'bad', changes: [
    { path: ['bpm'], value: 180 }, { path: ['stepData', '1', 'kick', '256'], value: 1 },
  ] })).rejects.toThrow('Not a project field')
  expect(await t.query(api.projects.get, { id: projectId })).toEqual(before)
})

// ---- AI note suggestions ----------------------------------------------------
async function trapProject() {
  const { createStudioProject } = await import('../src/studio/data')
  const { toStored } = await import('../src/studio/projectSync')
  return t.mutation(api.projects.create, { name: 'Coach song', color: '#1ea7f2', data: toStored(createStudioProject('Trap Heat')) })
}
const suggestionReply = (items: unknown) =>
  'A long E4 makes it dreamier.\n<note-suggestions>' + JSON.stringify({ summary: 'Dreamier lead', items }) + '</note-suggestions>'

test('a reply with note suggestions stores checked suggestions and hides the block', async () => {
  projectId = await trapProject()
  fetchMock.mockImplementationOnce(async () => response(suggestionReply([
    { action: 'add', channel: 'Retro Lead', pattern: 1, step: 9, note: 'E4', length: 4, why: 'Calm and open' },
    { action: 'remove', channel: 'Kick 808', pattern: 1, step: 7 },
    { action: 'add', channel: 'Ghost Synth', pattern: 1, step: 2, note: 'C4' },
  ])))
  await send('I want a dreamy, relaxing melody.')
  await flush()
  const answer = await reply()
  expect(answer).toMatchObject({ status: 'complete', content: 'A long E4 makes it dreamier.' })
  expect(answer.suggestions).toEqual({
    summary: 'Dreamier lead', skipped: 1,
    items: [
      { action: 'add', channelId: 'synth_lead', channelName: 'Retro Lead', pattern: 1, step: 8, note: 'E4', length: 4, why: 'Calm and open' },
      { action: 'remove', channelId: 'kick', channelName: 'Kick 808', pattern: 1, step: 6 },
    ],
  })
  // Suggestions never change the project by themselves.
  const saved = (await t.query(api.projects.get, { id: projectId }))!
  expect(saved.version).toBe(1)
  expect(saved.data.stepData[1].kick[6]).toBe(1)

  // The follow-up shows Claude its earlier reply with the block in the same format, first, as checked.
  await send('Why that note?')
  await flush()
  const body = JSON.parse(fetchMock.mock.calls.at(-1)![1].body)
  expect(body.history[1].content).toBe('<note-suggestions>{"summary":"Dreamier lead","items":[' +
    '{"action":"add","channel":"Retro Lead","pattern":1,"step":9,"note":"E4","length":4},' +
    '{"action":"remove","channel":"Kick 808","pattern":1,"step":7}]}</note-suggestions>\nA long E4 makes it dreamier.')
  expect(body.history[1].content).not.toContain('Ghost Synth')
  expect(body.systemPrompt).toContain('REQUIRED whenever your answer involves specific notes or steps')
  expect((await reply()).suggestions).toBeUndefined()
})

test('a "make me a beat" reply written the natural way becomes applicable suggestions', async () => {
  projectId = await trapProject()
  // Block first, alternate tag spelling, several steps per item, a drum note, a short channel name, a chord.
  fetchMock.mockImplementationOnce(async () => response('<note_suggestions>' + JSON.stringify({ summary: 'House groove', items: [
    { action: 'add', channel: 'Kick', pattern: 2, steps: [1, 5, 9, 13], note: 'C1', why: 'Four on the floor' },
    { action: 'add', channel: 'Clap Crisp', pattern: 2, steps: [5, 13] },
    { action: 'add', channel: 'retro lead', pattern: 2, step: 1, notes: ['C4', 'E4', 'G4'], length: 8 },
  ] }) + '</note_suggestions>\nA classic house groove: kick on every beat, claps on 2 and 4, and a C major chord.'))
  await send('Make me a house beat in pattern 2')
  await flush()
  const answer = await reply()
  expect(answer.content).toBe('A classic house groove: kick on every beat, claps on 2 and 4, and a C major chord.')
  expect(answer.suggestions!.skipped).toBe(0)
  expect(answer.suggestions!.items.map((item) => `${item.channelId}@${item.step}${item.note ? ':' + item.note : ''}`)).toEqual([
    'kick@0', 'kick@4', 'kick@8', 'kick@12', 'clap@4', 'clap@12', 'synth_lead@0:C4', 'synth_lead@0:E4', 'synth_lead@0:G4',
  ])
  // Nothing was applied: the project is unchanged until the user presses Apply.
  const saved = (await t.query(api.projects.get, { id: projectId }))!
  expect(saved.version).toBe(1)
  expect(saved.data.stepData[2].kick.every((gate: number) => gate === 0)).toBe(true)
})

test('malformed or cut-off suggestion blocks keep the answer and highlight nothing', async () => {
  projectId = await trapProject()
  fetchMock.mockImplementationOnce(async () => response('Try a minor key.\n<note-suggestions>{"items":[{"action":"add",'))
  await send('Make it darker.')
  await flush()
  expect(await reply()).toMatchObject({ status: 'complete', content: 'Try a minor key.', suggestions: { items: [], skipped: 1 } })
})

test('a messy reply is stored tidy: markdown removed and untagged suggestion JSON turned into suggestions', async () => {
  projectId = await trapProject()
  fetchMock.mockImplementationOnce(async () => response('## Groove\n**Kick** on 2 for bounce.\n```json\n' +
    JSON.stringify({ items: [{ action: 'add', channel: 'Kick 808', pattern: 1, step: 2 }] }) + '\n```'))
  await send('Make the kick bouncier')
  await flush()
  const answer = await reply()
  expect(answer.content).toBe('Groove\nKick on 2 for bounce.')
  expect(answer.suggestions!.items).toEqual([{ action: 'add', channelId: 'kick', channelName: 'Kick 808', pattern: 1, step: 1 }])
})
