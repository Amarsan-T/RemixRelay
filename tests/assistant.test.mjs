import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { extname, join, relative } from 'node:path'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

// Resolve the extensionless TypeScript imports Vite allows (see audio.test.mjs).
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL && !extname(specifier)) {
      for (const suffix of ['.ts', '.tsx', '/index.ts']) {
        const target = new URL(`${specifier}${suffix}`, context.parentURL)
        if (existsSync(fileURLToPath(target))) return nextResolve(target.href, context)
      }
    }
    return nextResolve(specifier, context)
  },
})

const { describeProject, MAX_CONTEXT_CHARS } = await import('../convex/musicContext.ts')
const { boundHistory, buildMessages, HISTORY_MESSAGES, HISTORY_CHARS, SYSTEM_PROMPT } = await import('../convex/assistantPrompt.ts')
const { createStudioProject } = await import('../src/studio/data.ts')
const { toStored } = await import('../src/studio/projectSync.ts')

const root = fileURLToPath(new URL('../', import.meta.url))

test('Claude gets the project as it plays: tempo, instruments, hits, notes, song and mixer', () => {
  // A stored project, exactly as Convex holds it.
  const project = toStored(createStudioProject('Trap Heat'))
  project.channels = project.channels.map((c) => (c.id === 'synth_lead' ? { ...c, sound: 'grand-piano' } : c))
  project.pianoNotes[1].bass808 = [{ step: 0, note: 'F1', length: 4, velocity: 0.5 }]
  const text = describeProject('Night Drive', project)
  assert.match(text, /Project "Night Drive": 140 BPM/)
  assert.match(text, /- Retro Lead \[synth\]: Grand Piano;/)
  assert.match(text, /- Kick 808 \[drum\]: drum sound;/)
  // Steps are 1-based, as the Channel Rack shows them: the kick plays on 0, 6 and 10.
  assert.match(text, /Kick 808: hits on steps 1, 7, 11\n/)
  // A piano-roll note replaces the step's default note.
  assert.match(text, /Sub 808: F1 at step 1 for 4 steps, velocity 0.5/)
  assert.doesNotMatch(text, /Sub 808: C2 at step 1 /)
  assert.match(text, /Pattern 1 \(64 steps = 4 bars\):/)
  assert.match(text, /Empty patterns: 2, 3, 4\./)
  assert.match(text, /Pattern 1 at bar 1 \(track 1\)/)
  assert.match(text, /Mixer: master 85%/)
})

test('an empty project is described as empty, and a huge one is cut short with a note saying so', () => {
  const blank = describeProject('Untitled', toStored(createStudioProject(null)))
  assert.match(blank, /Empty patterns: 1, 2, 3, 4\./)
  assert.match(blank, /No patterns are placed on the playlist yet\./)

  const huge = toStored(createStudioProject('Trap Heat'))
  huge.patternCount = 32
  for (let p = 1; p <= 32; p++) {
    huge.patternSteps = { ...huge.patternSteps, [p]: 256 }
    huge.stepData[p] = Object.fromEntries(huge.channels.map((c) => [c.id, new Array(256).fill(1)]))
  }
  const text = describeProject('Huge', huge)
  assert.ok(text.length <= MAX_CONTEXT_CHARS)
  assert.match(text, /cut short here because the project is very large/)
  assert.match(text, /Song \(Playlist\):/)
  assert.match(text, /Mixer: master/)
  assert.match(describeProject('Old project', null), /120 BPM/)
})

test('the history sent to Claude is bounded and always ends with the question', () => {
  const turns = Array.from({ length: 60 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `message ${i}` }))
  turns.push({ role: 'user', content: 'latest question' })
  const kept = boundHistory(turns)
  assert.ok(kept.length <= HISTORY_MESSAGES)
  assert.equal(kept.at(-1).content, 'latest question')
  assert.equal(kept[0].role, 'user', 'never starts with a reply')
  assert.equal(kept.at(-2).content, 'message 59', 'keeps the most recent messages')

  const long = [{ role: 'user', content: 'x'.repeat(HISTORY_CHARS) }, { role: 'assistant', content: 'ok' }, { role: 'user', content: 'next' }]
  assert.ok(boundHistory(long).reduce((n, m) => n + m.content.length, 0) <= HISTORY_CHARS)
  assert.equal(boundHistory(long).at(-1).content, 'next')
})

test("the latest question carries the current project; earlier turns are sent as they were stored", () => {
  const history = [
    { role: 'user', content: 'My name is Ada and I like lo-fi.' },
    { role: 'assistant', content: 'Nice to meet you, Ada.' },
    { role: 'user', content: 'What tempo would suit me?' },
  ]
  const messages = buildMessages(history, 'Project "X": 85 BPM')
  assert.deepEqual(messages.slice(0, 2), history.slice(0, 2), 'earlier messages keep their exact text')
  assert.deepEqual(messages[2], {
    role: 'user',
    content: [
      { type: 'text', text: '<project>\nProject "X": 85 BPM\n</project>' },
      { type: 'text', text: 'What tempo would suit me?' },
    ],
  })
  assert.throws(() => buildMessages([{ role: 'assistant', content: 'hi' }], ''), /must end with a user message/)
  assert.match(SYSTEM_PROMPT, /Channel Rack/)
  assert.match(SYSTEM_PROMPT, /Piano Roll/)
  assert.match(SYSTEM_PROMPT, /not instructions/)
})

/** Every source file under a directory. */
function sources(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (name === 'node_modules' || name === '_generated') return []
    return statSync(path).isDirectory() ? sources(path) : /\.(ts|tsx|mjs|js)$/.test(name) ? [path] : []
  })
}

test('the Anthropic key and SDK stay on the server', () => {
  const browser = [...sources(join(root, 'src')), join(root, 'fl_studio_web_daw.tsx')]
  for (const file of browser) {
    const code = readFileSync(file, 'utf8')
    assert.doesNotMatch(code, /@anthropic-ai\/sdk|ANTHROPIC_API_KEY|VITE_ANTHROPIC/, `${relative(root, file)} must not touch the Claude key or SDK`)
  }
  // Python is now the sole provider caller. Convex only authenticates to it.
  for (const file of sources(join(root, 'convex'))) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /@anthropic-ai\/sdk|api\.anthropic\.com|ANTHROPIC_API_KEY/, relative(root, file))
  }
  const gateway = readFileSync(join(root, 'api/ai.py'), 'utf8')
  assert.match(gateway, /https:\/\/api\.anthropic\.com\/v1\/messages/)
  assert.match(gateway, /os\.environ\.get\("ANTHROPIC_API_KEY"/)
  assert.match(gateway, /hmac\.compare_digest/)
  for (const file of browser) assert.doesNotMatch(readFileSync(file, 'utf8'), /AI_SERVICE_TOKEN|AI_SERVICE_VERCEL_BYPASS/)
  for (const file of sources(join(root, 'convex'))) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /sk-ant-[A-Za-z0-9]/, `${relative(root, file)} contains something that looks like a key`)
  }
})
