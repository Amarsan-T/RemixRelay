// Explicit, paid end-to-end checks against disposable DEVELOPMENT projects only.
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect } from '@playwright/test'
import { ConvexHttpClient } from 'convex/browser'
import { anyApi } from 'convex/server'
import { CONVEX_URL, deployment } from './environment.mjs'

if (!process.argv.includes('--with-claude')) throw new Error('Pass --with-claude explicitly to make paid Anthropic requests.')
const app = process.argv.find(arg => /^http:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(arg)) ?? 'http://127.0.0.1:5199/'
const appUrl = new URL(app)
assert.ok(['127.0.0.1', 'localhost'].includes(appUrl.hostname), 'Use a local app with the guarded Development backend.')

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL && !extname(specifier)) {
      for (const suffix of ['.ts', '.tsx', '/index.ts']) {
        const target = new URL(specifier + suffix, context.parentURL)
        if (existsSync(fileURLToPath(target))) return nextResolve(target.href, context)
      }
    }
    return nextResolve(specifier, context)
  },
})
const { createStudioProject } = await import('../../src/studio/data.ts')
const { toStored } = await import('../../src/studio/projectSync.ts')
const client = new ConvexHttpClient(CONVEX_URL)
const runId = new Date().toISOString().replace(/[:.]/g, '-')
const code = 'OPAL-' + crypto.randomUUID().slice(0, 8).toUpperCase()
const results = []
const check = (name, ok) => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  assert.ok(ok, name)
}
const list = projectId => client.query(anyApi.chat.list, { projectId })
const link = projectId => new URL('?project=' + projectId, app).href
const settled = async projectId => {
  const deadline = Date.now() + 130_000
  while (Date.now() < deadline) {
    const messages = await list(projectId)
    if (messages.length && messages.at(-1).status !== 'pending') return messages
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error('The server reply did not settle within 130 seconds.')
}

function fixture(bpm = 97, sound = 'grand-piano') {
  const project = toStored(createStudioProject(null))
  project.bpm = bpm
  project.channels = project.channels.filter(channel => ['kick', 'bass808', 'synth_lead'].includes(channel.id))
    .map(channel => channel.id === 'synth_lead' ? { ...channel, sound } : channel.id === 'bass808' ? { ...channel, sound: 'deep-bass' } : channel)
  project.patternCount = 2
  project.patternSteps = { 1: 16, 2: 32 }
  project.stepData = { 1: { kick: Array.from({ length: 16 }, (_, i) => i % 4 === 0 ? 1 : 0) }, 2: {} }
  project.pianoNotes = {
    1: {
      synth_lead: [{ step: 0, note: 'C4', length: 2, velocity: 0.65 }, { step: 4, note: 'E4', length: 2 }, { step: 8, note: 'G4', length: 4 }],
      bass808: [{ step: 0, note: 'C2', length: 4, velocity: 0.75 }],
    },
    2: { synth_lead: [{ step: 2, note: 'D4', length: 1 }] },
  }
  project.song = { bars: 4, trackCount: 2, clips: [
    { id: 'real-test-clip-1', patternId: '1', track: 0, startBar: 0 },
    { id: 'real-test-clip-2', patternId: '2', track: 1, startBar: 2 },
  ] }
  return project
}

const A = await client.mutation(anyApi.projects.create, { name: `Disposable real chat A ${runId}`, color: '#1ea7f2', data: fixture() })
const B = await client.mutation(anyApi.projects.create, { name: `Disposable real chat B ${runId}`, color: '#8fd97f', data: fixture(143, 'warm-pad') })
const projectIds = { A, B }
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-audio-output'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const peerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
const peer = await peerContext.newPage()
const errors = []
for (const p of [page, peer]) {
  p.on('pageerror', error => errors.push(error.message))
  // A local test app must never read or write the Production backend.
  await p.route(/https?:\/\/[^/]*\.convex\.(cloud|site)\//, route => {
    const origin = new URL(route.request().url()).origin
    return origin === CONVEX_URL ? route.continue() : route.abort()
  })
}
const open = async (p, projectId) => {
  await p.goto(link(projectId))
  await p.getByLabel('Open AI chat').click()
  await expect(p.getByText('Loading the conversation...')).toHaveCount(0)
}
const ask = async (p, projectId, question) => {
  const before = await list(projectId)
  await p.getByLabel('Message Claude').fill(question)
  await p.getByLabel('Send message').click()
  // Browser clicks do not await the Convex mutation promise. Wait for the new
  // pair before checking completion, or the previous finished turn can win.
  await expect.poll(async () => (await list(projectId)).length, { timeout: 15000 }).toBe(before.length + 2)
  const messages = await settled(projectId)
  const reply = messages.at(-1)
  assert.equal(reply.status, 'complete', reply.content)
  assert.ok(reply.content.trim().length > 0, 'Claude must return nonempty text')
  await expect(p.getByRole('region', { name: 'AI chat' })).toContainText(reply.content)
  return { messages, reply }
}
const out = fileURLToPath(new URL('../../test-results/real-chat/', import.meta.url))
let failure = null
try {
  await open(page, A)
  const question = `Remember my rehearsal code ${code} for this conversation. Read the current project and report its BPM, Retro Lead and Sub 808 instrument names, Pattern 1 Retro Lead notes and their 1-based start steps, Pattern 1 kick hit steps, Pattern 2 step length and Retro Lead note/start step, and both playlist clips. Use pitch@step for notes and pattern@bar/track for clips. Do not guess.`
  const first = await ask(page, A, question)
  const answer = first.reply.content
  check('real Claude response reaches the React chat and is stored with the user message', first.messages.length === 2 && first.messages[0].content === question)
  check('Claude reads the actual 97 BPM and Grand Piano/Deep Bass instruments', /\b97\b/.test(answer) && /grand piano/i.test(answer) && /deep bass/i.test(answer))
  check('Claude reads Pattern 1 notes and one-based start steps', /C4\s*@\s*(?:step\s*)?1\b/i.test(answer) && /E4\s*@\s*(?:step\s*)?5\b/i.test(answer) && /G4\s*@\s*(?:step\s*)?9\b/i.test(answer))
  check('Claude reads the kick hit steps', /1\s*,\s*5\s*,\s*9\s*,\s*13/.test(answer))
  check('Claude reads Pattern 2 length and note/start step', /\b32\b/.test(answer) && /D4\s*@\s*(?:step\s*)?3\b/i.test(answer))
  check('Claude reads playlist clip placement', /1\s*@\s*(?:bar\s*)?1\s*\/\s*(?:track\s*)?1/i.test(answer) && /2\s*@\s*(?:bar\s*)?3\s*\/\s*(?:track\s*)?2/i.test(answer))

  // A completed answer must not be submitted to the paid retry path.
  await assert.rejects(client.mutation(anyApi.chat.retry, { replyId: first.reply._id }), /Only a failed reply/)
  check('completed replies cannot accidentally be retried', (await list(A)).length === 2)
  await page.reload()
  await page.getByLabel('Open AI chat').click()
  await expect(page.getByRole('region', { name: 'AI chat' })).toContainText(question)
  const memory = await ask(page, A, 'What rehearsal code did I ask you to remember before the refresh, and which Pattern 1 piano note names did you list? Reply with the code and note names.')
  check('real conversation memory survives a page reload without restating the code', memory.reply.content.includes(code) && /C4/.test(memory.reply.content) && /E4/.test(memory.reply.content) && /G4/.test(memory.reply.content))
  check('both completed exchanges persist in Convex chatMessages in order', memory.messages.length === 4 && memory.messages.map(m => m.role).join(',') === 'user,assistant,user,assistant' && memory.messages.every(m => m.status === 'complete'))

  await open(peer, A)
  await expect(peer.getByRole('region', { name: 'AI chat' })).toContainText(memory.reply.content)
  check('a second independent browser sees the persisted real conversation', true)
  await open(peer, B)
  const isolated = await ask(peer, B, 'Have I given you a rehearsal code in this conversation? If not, say no. Also report my current BPM and the instrument selected for Retro Lead.')
  check('project B uses its own tempo/instrument and does not receive project A memory', /\b143\b/.test(isolated.reply.content) && /warm pad/i.test(isolated.reply.content) && !isolated.reply.content.includes(code) && isolated.messages.length === 2)

  await page.getByLabel('Tempo BPM').fill('109')
  await page.getByLabel('Tempo BPM').press('Enter')
  const updated = await ask(page, A, 'What is my current project BPM now? Report the current saved value, not the earlier value.')
  check('Claude reads a musical edit saved from the UI during the conversation', /\b109\b/.test(updated.reply.content) && (await client.query(anyApi.projects.get, { id: A })).data.bpm === 109)

  // Cause a controlled context error in a separate test record, repair it, and
  // retry the same reply through the real UI. No deployment settings are changed.
  const malformed = fixture()
  malformed.pianoNotes[1].synth_lead = { invalidTestData: true }
  const C = await client.mutation(anyApi.projects.create, { name: `Disposable retry ${runId}`, color: '#a78bfa', data: malformed })
  projectIds.C = C
  await client.mutation(anyApi.chat.send, { projectId: C, requestId: crypto.randomUUID(), content: 'What BPM is this project?' })
  const failed = (await settled(C)).at(-1)
  check('server errors persist as a safe readable message', failed.status === 'error' && /Something went wrong asking Claude/.test(failed.content))
  await client.mutation(anyApi.projects.save, { id: C, clientId: 'real-chat-verification', changes: [{ path: ['pianoNotes', '1', 'synth_lead'], value: fixture().pianoNotes[1].synth_lead }] })
  await open(peer, C)
  await peer.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect.poll(async () => (await list(C)).at(-1).status, { timeout: 130000 }).toBe('complete')
  const recovered = (await settled(C)).at(-1)
  check('UI retry recovers with a real Claude response and reuses the failed reply', recovered.status === 'complete' && /\b97\b/.test(recovered.content) && recovered._id === failed._id && (await list(C)).length === 2)

  await page.getByLabel('Message Claude').fill('x'.repeat(2001))
  await page.getByLabel('Message Claude').press('Enter')
  await expect(page.getByLabel('Send message')).toBeDisabled()
  check('over-long Enter submissions do not add messages', (await list(A)).length === 6)
  check('React chat produces no uncaught browser exceptions', errors.length === 0)
  mkdirSync(out, { recursive: true })
  await page.getByLabel('Message Claude').fill('')
  await page.screenshot({ path: out + 'conversation.png', fullPage: true })
} catch (error) {
  failure = error
  console.error('FAIL:', error.message)
} finally {
  mkdirSync(out, { recursive: true })
  const conversations = Object.fromEntries(await Promise.all(Object.entries(projectIds).map(async ([name, id]) => [name, { projectId: id, messages: await list(id) }])))
  writeFileSync(out + 'result.json', JSON.stringify({ runId, deployment, results, conversations, failure: failure?.message ?? null }, null, 2))
  await browser.close()
  console.log(failure
    ? `Real end-to-end run failed after ${results.filter(result => result.ok).length} completed checks; report: ${out}result.json`
    : `${results.length}/${results.length} real end-to-end checks passed; report: ${out}result.json`)
}
if (failure) process.exitCode = 1
