import { CONVEX_URL, deployment } from './environment.mjs'
// Integration checks for convex/chat.ts on the DEV deployment (development deployment only).
// Usage: node tests/browser/chat-backend.mjs [--with-claude]
import { ConvexHttpClient } from 'convex/browser'
import { anyApi } from 'convex/server'

const convex = new ConvexHttpClient(CONVEX_URL)
const withClaude = process.argv.includes('--with-claude')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const id = () => crypto.randomUUID()
const results = []
const check = (name, ok, detail = {}) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`) }
const failure = async (promise) => { try { await promise; return null } catch (e) { return String(e.data ?? e.message).split('\n')[0] } }
const list = (projectId) => convex.query(anyApi.chat.list, { projectId })
async function settled(projectId, timeoutMs = 90000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    const messages = await list(projectId)
    if (!messages.some((m) => m.status === 'pending')) return messages
    await sleep(500)
  }
  throw new Error('a reply stayed pending')
}

console.log(`deployment ${deployment}${withClaude ? ' (with Claude)' : ' (no Claude calls expected to succeed)'}`)
const stamp = new Date().toISOString().slice(11, 19)
const blank = (bpm) => ({ bpm, loop: true, metronome: false, channels: [{ id: 'kick', name: 'Kick 808', type: 'drum', mixerTrack: 1, vol: 0.8, pan: 0, muted: false, solo: false }],
  stepData: { 1: { kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0] } }, pianoNotes: { 1: {} }, mixerTracks: [{ id: 0, name: 'Master', vol: 0.85 }, { id: 1, name: 'Kick', vol: 0.9 }],
  song: { bars: 4, trackCount: 1, clips: [] }, patternSteps: { 1: 16 }, patternCount: 1 })
const A = await convex.mutation(anyApi.projects.create, { name: `Chat test A ${stamp}`, color: '#1ea7f2', data: blank(97) })
const B = await convex.mutation(anyApi.projects.create, { name: `Chat test B ${stamp}`, color: '#8fd97f', data: blank(133) })

// Validation
check('empty message is rejected', /Type a message/.test(await failure(convex.mutation(anyApi.chat.send, { projectId: A, requestId: id(), content: '   ' }))))
check('over-long message is rejected', /up to 2000 characters/.test(await failure(convex.mutation(anyApi.chat.send, { projectId: A, requestId: id(), content: 'x'.repeat(2001) }))))
check('malformed request id is rejected', /Invalid request/.test(await failure(convex.mutation(anyApi.chat.send, { projectId: A, requestId: 'no spaces allowed', content: 'hi' }))))
check('unknown project is rejected', /no longer exists/.test(await failure(convex.mutation(anyApi.chat.send, { projectId: 'not-a-project', requestId: id(), content: 'hi' }))))
check('listing an unknown project gives an empty chat', (await list('not-a-project')).length === 0)
check('server-only functions are not callable from outside',
  (await failure(convex.query(anyApi.chat.forReply, { replyId: 'x' }))) !== null &&
  (await failure(convex.mutation(anyApi.chat.finish, { replyId: 'x', status: 'complete', content: 'hacked' }))) !== null)

// First question, then the same request again (a resend after a dropped connection).
const first = id()
const sent = await convex.mutation(anyApi.chat.send, { projectId: A, requestId: first, content: withClaude ? 'My name is Ada. Remember it. What BPM is my project?' : 'Hello' })
const again = await convex.mutation(anyApi.chat.send, { projectId: A, requestId: first, content: withClaude ? 'My name is Ada. Remember it. What BPM is my project?' : 'Hello' })
let chatA = await list(A)
check('a question is saved with a pending reply', chatA.length === 2 && chatA[0].role === 'user' && chatA[1].role === 'assistant', { roles: chatA.map((m) => `${m.role}:${m.status}`) })
check('resending the same request does not duplicate it', again.duplicate === true && String(again.messageId) === String(sent.messageId) && chatA.filter((m) => m.role === 'user').length === 1)

// While Claude answers, a second question is refused.
const overlap = await failure(convex.mutation(anyApi.chat.send, { projectId: A, requestId: id(), content: 'second' }))
const stillPending = (await list(A)).some((m) => m.status === 'pending')
check('a second question while Claude is answering is refused', stillPending ? /still answering/.test(overlap) : overlap === null || /still answering/.test(overlap),
  { overlap, stillPendingWhenChecked: stillPending })

chatA = await settled(A)
const reply = chatA.find((m) => m.role === 'assistant')
if (withClaude) {
  check('Claude answered from the project context (97 BPM)', reply.status === 'complete' && /97/.test(reply.content), { reply: reply.content.slice(0, 160) })
} else {
  check('without a key the reply fails with a clear message', reply.status === 'error' && /isn't set up/.test(reply.content), { reply: reply.content })
  // Retry: the same reply record is reused, not duplicated.
  await convex.mutation(anyApi.chat.retry, { replyId: reply._id })
  const retried = await settled(A)
  check('retry reuses the failed reply', retried.filter((m) => m.role === 'assistant').length === chatA.filter((m) => m.role === 'assistant').length && retried.find((m) => m._id === reply._id).status === 'error')
  check('only a failed reply can be retried', /Only a failed reply/.test(await failure(convex.mutation(anyApi.chat.retry, { replyId: chatA[0]._id }))))
}

// Projects don't share chats.
check('another project has its own (empty) chat', (await list(B)).length === 0)
await convex.mutation(anyApi.chat.send, { projectId: B, requestId: id(), content: withClaude ? 'What BPM is this project?' : 'Hi from B' })
const chatB = await settled(B)
check("project B's messages stay in project B", chatB.length === 2 && (await list(A)).every((m) => !/from B|What BPM is this project/.test(m.content)),
  withClaude ? { replyB: chatB[1].content.slice(0, 120) } : {})
if (withClaude) check('project B answer uses project B (133 BPM), not A', /133/.test(chatB[1].content) && !/\b97\b/.test(chatB[1].content))

if (withClaude) {
  // Memory: the earlier turn is sent back, so Claude remembers it.
  await convex.mutation(anyApi.chat.send, { projectId: A, requestId: id(), content: 'What is my name?' })
  const memory = (await settled(A)).at(-1)
  check('Claude remembers an earlier message (history is sent)', memory.status === 'complete' && /Ada/.test(memory.content), { reply: memory.content.slice(0, 120) })
} else {
  // Per-project limit: 5 questions a minute.
  let refused = null
  for (let i = 0; i < 6 && !refused; i++) {
    await settled(A)
    refused = await failure(convex.mutation(anyApi.chat.send, { projectId: A, requestId: id(), content: `burst ${i}` }))
  }
  check('more than 5 questions a minute are refused', /a lot of questions/.test(refused ?? ''), { refused })
}

console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed  (test projects: ${A}, ${B})`)
process.exit(results.every(Boolean) ? 0 : 1)
