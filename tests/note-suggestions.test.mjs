import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { extname } from 'node:path'
import { existsSync } from 'node:fs'
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

const {
  applySuggestion, applySuggestions, describeSuggestion, extractSuggestionBlock, parseSuggestionBlock,
  readReply, resolveSuggestions, suggestionsFromBlock, suggestionsMemo, MAX_SUGGESTIONS,
} = await import('../convex/noteSuggestions.ts')
const { SYSTEM_PROMPT } = await import('../convex/assistantPrompt.ts')
const { pianoGhosts, rackHighlights, isInView, viewFor } = await import('../src/assistant/noteCoach.ts')
const { createStudioProject } = await import('../src/studio/data.ts')
const { toAudioPattern } = await import('../src/studio/patternAdapter.ts')
const { toStored } = await import('../src/studio/projectSync.ts')

/**
 * Trap Heat, pattern 1 (64 steps): kick on steps 1, 7, 11 (0-based 0, 6, 10);
 * Retro Lead plays A4 at step 1 and C4 at step 4; Sub 808 plays its default C2 at step 1.
 */
const trap = () => createStudioProject('Trap Heat')
const block = (items, extra = {}) => JSON.stringify({ summary: 'Dreamy lead', items, ...extra })
const reply = (items) => `Try these long notes.\n<note-suggestions>\n${block(items)}\n</note-suggestions>`

// ---- Reading the reply -----------------------------------------------------

test('the suggestion block is removed from the text people read', () => {
  const { text, block: raw, found } = extractSuggestionBlock('Hello.\n```json\n<note-suggestions>{"items":[]}</note-suggestions>\n```')
  assert.equal(text, 'Hello.')
  assert.equal(raw, '{"items":[]}')
  assert.equal(found, true)
  assert.deepEqual(extractSuggestionBlock('Plain advice.'), { text: 'Plain advice.', block: null, found: false })
  // Cut off by the output limit: the half block is hidden and nothing is guessed from it.
  const cut = extractSuggestionBlock('Advice.\n<note-suggestions>{"items":[{"action":"add"')
  assert.deepEqual(cut, { text: 'Advice.', block: null, found: true })
  // Several blocks: all hidden, the last complete one is used.
  const twice = extractSuggestionBlock('A<note-suggestions>1</note-suggestions>B<note-suggestions>2</note-suggestions>C')
  assert.deepEqual(twice, { text: 'ABC', block: '2', found: true })
})

test('malformed AI responses are handled without highlighting anything made up', () => {
  assert.deepEqual(parseSuggestionBlock('not json'), { items: [], skipped: 1 })
  assert.deepEqual(parseSuggestionBlock('{"items": "nope"}'), { items: [], skipped: 1 })
  assert.deepEqual(parseSuggestionBlock('{"items":[1,2,3,],}'), { items: [], skipped: 1 })
  const bad = [
    { action: 'paint', channel: 'Retro Lead', pattern: 1, step: 1, note: 'E4' }, // unknown action
    { action: 'add', channel: 'Retro Lead', pattern: 1, step: 0, note: 'E4' }, // steps are 1-based
    { action: 'add', channel: 'Retro Lead', pattern: 1, step: 2.5, note: 'E4' },
    { action: 'add', channel: 'Retro Lead', pattern: 1, step: '3', note: 'E4' },
    { action: 'add', channel: 'Retro Lead', pattern: 1, step: 3, note: 'H4' },
    { action: 'add', channel: 'Retro Lead', pattern: 1, step: 3, note: 'C7' }, // above the piano roll
    { action: 'add', channel: 'Retro Lead', pattern: 1, step: 3, note: 'B1' }, // below the piano roll
    { action: 'add', channel: 'Retro Lead', pattern: 1, step: 3, note: 'E4', length: 40 },
    { action: 'change', channel: 'Retro Lead', pattern: 1, step: 1, note: 'A4' }, // no target pitch
    { action: 'add', channel: '', pattern: 1, step: 3, note: 'E4' },
    { action: 'add', channel: 'Retro Lead', pattern: 99, step: 3, note: 'E4' },
    null, 'add E4',
  ]
  const parsed = parseSuggestionBlock(block(bad))
  assert.deepEqual(parsed.items, [])
  assert.equal(parsed.skipped, bad.length)

  // A reply with only a broken block keeps its text and highlights nothing.
  const broken = readReply('Use a minor key.\n<note-suggestions>{oops}</note-suggestions>', trap())
  assert.equal(broken.text, 'Use a minor key.')
  assert.deepEqual(broken.suggestions, { items: [], skipped: 1 })
  // No block at all: an ordinary answer.
  assert.deepEqual(readReply('Use a minor key.', trap()), { text: 'Use a minor key.', suggestions: null })
  // Only a block: the reader still gets a sentence.
  const only = readReply(`<note-suggestions>${block([{ action: 'add', channel: 'Retro Lead', pattern: 1, step: 9, note: 'E4' }])}</note-suggestions>`, trap())
  assert.match(only.text, /highlighted in the editor/)
})

test('long lists are capped and summaries/reasons are kept short', () => {
  const many = Array.from({ length: MAX_SUGGESTIONS + 4 }, (_, i) => ({ action: 'add', channel: 'Kick 808', pattern: 1, step: i + 20 }))
  const parsed = parseSuggestionBlock(block(many, { summary: 'x'.repeat(500) }))
  assert.equal(parsed.items.length, MAX_SUGGESTIONS)
  assert.equal(parsed.skipped, 4)
  assert.ok(parsed.summary.length <= 160)
})

// ---- Mapping to the real project ---------------------------------------------

test('suggestions map onto real channels, pitches and steps, 1-based in and 0-based stored', () => {
  const { text, suggestions } = readReply(reply([
    { action: 'add', channel: 'retro lead', pattern: 1, step: 9, note: 'Eb4', length: 4, why: 'A soft  third\n' },
    { action: 'remove', channel: 'kick_808', pattern: 1, step: 7 }, // neither the id nor the name
    { action: 'remove', channel: 'kick', pattern: 1, step: 7, note: 'C4', length: 3 }, // drum: note/length dropped
    { action: 'change', channel: 'Retro Lead', pattern: 1, step: 1, note: 'A4', to: 'G#4' },
    { action: 'remove', channel: 'Sub 808', pattern: 1, step: 1, note: 'C2' }, // a default note from a lit step
    { action: 'add', channel: 'Retro Lead', pattern: 1, step: 64, note: 'C5', length: 8 }, // last step: shortened
  ]), trap())
  assert.equal(text, 'Try these long notes.')
  assert.equal(suggestions.summary, 'Dreamy lead')
  assert.deepEqual(suggestions.items, [
    { action: 'add', channelId: 'synth_lead', channelName: 'Retro Lead', pattern: 1, step: 8, note: 'D#4', length: 4, why: 'A soft third' },
    { action: 'remove', channelId: 'kick', channelName: 'Kick 808', pattern: 1, step: 6 },
    { action: 'change', channelId: 'synth_lead', channelName: 'Retro Lead', pattern: 1, step: 0, note: 'A4', to: 'G#4' },
    { action: 'remove', channelId: 'bass808', channelName: 'Sub 808', pattern: 1, step: 0, note: 'C2' },
    { action: 'add', channelId: 'synth_lead', channelName: 'Retro Lead', pattern: 1, step: 63, note: 'C5', length: 1 },
  ])
  assert.equal(suggestions.skipped, 1)
})

test('nonexistent notes, channels and unsupported positions are never kept', () => {
  const project = trap()
  project.channels.push({ ...project.channels[6], id: 'dup-a', name: 'Pad' }, { ...project.channels[6], id: 'dup-b', name: 'pad' })
  project.patternSteps = { 2: 16 }
  const { suggestions } = readReply(reply([
    { action: 'add', channel: 'Piano 2', pattern: 1, step: 3, note: 'E4' }, // no such channel
    { action: 'add', channel: 'Pad', pattern: 1, step: 3, note: 'E4' }, // two channels share the name
    { action: 'add', channel: 'Retro Lead', pattern: 2, step: 17, note: 'E4' }, // pattern 2 is 16 steps
    { action: 'add', channel: 'Retro Lead', pattern: 5, step: 1, note: 'E4' }, // only 4 patterns
    { action: 'remove', channel: 'Retro Lead', pattern: 1, step: 1, note: 'B4' }, // A4 plays there, not B4
    { action: 'change', channel: 'Retro Lead', pattern: 1, step: 2, note: 'A4', to: 'B4' }, // nothing at step 2
    { action: 'remove', channel: 'Snare Gritty', pattern: 1, step: 1 }, // not lit
    { action: 'add', channel: 'Kick 808', pattern: 1, step: 1 }, // already lit
    { action: 'add', channel: 'Retro Lead', pattern: 1, step: 1, note: 'A4' }, // already there
    { action: 'change', channel: 'Kick 808', pattern: 1, step: 1, note: 'C2', to: 'D2' }, // drums have no pitch
    { action: 'add', channel: 'Retro Lead', pattern: 1, step: 9 }, // melodic needs a note
    { action: 'add', channel: 'Retro Lead', pattern: 1, step: 9, note: 'E4' },
    { action: 'remove', channel: 'Retro Lead', pattern: 1, step: 9, note: 'E4' }, // contradicts the one before
  ]), project)
  assert.deepEqual(suggestions.items.map(describeSuggestion), ['Add E4 at step 9 (2 steps)'])
  assert.equal(suggestions.skipped, 12)
})

test('works on a project exactly as Convex stores it', () => {
  const stored = toStored(trap())
  const { suggestions } = readReply(reply([{ action: 'add', channel: 'Hi-Hat Open', pattern: 1, step: 2 }]), stored)
  assert.deepEqual(suggestions.items, [{ action: 'add', channelId: 'hat_open', channelName: 'Hi-Hat Open', pattern: 1, step: 1 }])
})

// ---- Live status and highlighting ---------------------------------------------

const items = () => suggestionsFromBlock(block([
  { action: 'add', channel: 'Retro Lead', pattern: 1, step: 9, note: 'E4', length: 4, why: 'Calm' },
  { action: 'remove', channel: 'Retro Lead', pattern: 1, step: 4, note: 'C4' },
  { action: 'change', channel: 'Retro Lead', pattern: 1, step: 1, note: 'A4', to: 'F4' },
  { action: 'add', channel: 'Snare Gritty', pattern: 1, step: 3 },
  { action: 'add', channel: 'Sub 808', pattern: 2, step: 1, note: 'C3' },
]), trap()).items

test('highlights follow the live project: placed notes turn done, deleted channels stop highlighting', () => {
  const project = trap()
  assert.deepEqual(resolveSuggestions(project, items()).map((item) => item.status), ['pending', 'pending', 'pending', 'pending', 'pending'])
  // The user draws E4 at step 9 and turns on snare step 3 by hand.
  project.pianoNotes[1].synth_lead.push({ step: 8, note: 'E4', length: 4 })
  project.stepData[1].snare[2] = 1
  // Someone deletes Sub 808, and the lead's A4 is changed by hand to something else.
  project.channels = project.channels.filter((channel) => channel.id !== 'bass808')
  project.pianoNotes[1].synth_lead[0].note = 'B4'
  assert.deepEqual(resolveSuggestions(project, items()).map((item) => item.status), ['done', 'pending', 'unavailable', 'done', 'unavailable'])
})

test('Channel Rack and Piano Roll highlight only pending suggestions in the visible pattern and channel', () => {
  const resolved = resolveSuggestions(trap(), items())
  const pads = rackHighlights(resolved, 1)
  assert.deepEqual([...pads.entries()].map(([key, pad]) => [key, pad.kind]), [
    ['synth_lead:8', 'add'], ['synth_lead:3', 'remove'], ['synth_lead:0', 'change'], ['snare:2', 'add'],
  ])
  assert.match(pads.get('snare:2').label, /Light step 3/)
  assert.equal(rackHighlights(resolved, 2).get('bass808:0').kind, 'add')

  // Piano roll notes as the editor shows them (MIDI pitches, 0-based starts).
  const notes = [{ id: 'a', pitch: 69, start: 0, duration: 2, velocity: 0.8 }, { id: 'c', pitch: 60, start: 3, duration: 2, velocity: 0.8 }]
  const ghosts = pianoGhosts(resolved, 1, 'synth_lead', notes)
  assert.deepEqual(ghosts.map(({ kind, pitch, start, duration }) => [kind, pitch, start, duration]), [
    ['add', 64, 8, 4], ['remove', 60, 3, 2], ['change-from', 69, 0, 2], ['change-to', 65, 0, 2],
  ])
  assert.match(ghosts[0].label, /Add E4 at step 9 \(4 steps\)\. Calm/)
  // Other channels and patterns draw nothing here.
  assert.deepEqual(pianoGhosts(resolved, 1, 'bass808', notes), [])
  assert.deepEqual(pianoGhosts(resolved, 2, 'synth_lead', notes), [])
  // A note to remove that no longer exists gets no ghost.
  assert.deepEqual(pianoGhosts(resolved, 1, 'synth_lead', []).map((ghost) => ghost.kind), ['add'])
})

test('clearing suggestions removes every highlight', () => {
  assert.equal(rackHighlights(resolveSuggestions(trap(), []), 1).size, 0)
  assert.deepEqual(pianoGhosts(resolveSuggestions(trap(), []), 1, 'synth_lead', []), [])
})

test('navigation opens melodic notes in the Piano Roll and drum steps in the Channel Rack', () => {
  const [lead, , , snare, bass] = resolveSuggestions(trap(), items())
  assert.deepEqual(viewFor(lead), { view: 'pianoRoll', pattern: 1, channelId: 'synth_lead' })
  assert.deepEqual(viewFor(snare), { view: 'channelRack', pattern: 1, channelId: 'snare' })
  assert.equal(isInView(lead, 'pianoRoll', 1, 'synth_lead'), true)
  assert.equal(isInView(lead, 'pianoRoll', 1, 'bass808'), false)
  assert.equal(isInView(snare, 'pianoRoll', 1, 'synth_lead'), false)
  assert.equal(isInView(snare, 'channelRack', 1, undefined), true)
  assert.equal(isInView(bass, 'channelRack', 1, undefined), false)
  assert.equal(isInView(lead, 'mixer', 1, 'synth_lead'), false)
})

// ---- Applying (only ever after the user confirms) ---------------------------------

test('applying makes exactly the suggested change, keeping gates and notes in agreement', () => {
  const project = trap()
  const before = structuredClone(project)
  const [addE4, removeC4, changeA4, snare, bass] = items()
  const next = applySuggestions(project, [addE4, removeC4, changeA4, snare, bass])
  assert.deepEqual(project, before, 'the original project is not mutated')
  const lead = next.pianoNotes[1].synth_lead
  assert.ok(lead.some((note) => note.step === 8 && note.note === 'E4' && note.length === 4))
  assert.ok(!lead.some((note) => note.step === 3))
  assert.equal(next.stepData[1].synth_lead[3], 0, 'removing the last note at a step turns its pad off')
  assert.equal(next.stepData[1].synth_lead[8], 1)
  assert.equal(lead.find((note) => note.step === 0).note, 'F4')
  assert.equal(next.stepData[1].snare[2], 1)
  assert.ok(next.pianoNotes[2].bass808.some((note) => note.step === 0 && note.note === 'C3'))
  // Untouched parts of the project are the same objects, so live sync sends only the changed steps.
  assert.equal(next.stepData[1].kick, project.stepData[1].kick)
  assert.equal(next.mixerTracks, project.mixerTracks)
  assert.deepEqual(resolveSuggestions(next, items()).map((item) => item.status), ['done', 'done', 'done', 'done', 'done'])
  // Applying again changes nothing.
  assert.equal(applySuggestions(next, items()), next)
  // The result still plays: the audio adapter accepts it.
  assert.ok(toAudioPattern(next, 1).tracks.length > 0)
})

test('adding beside a default note keeps the default note playing', () => {
  const project = trap()
  const [item] = suggestionsFromBlock(block([{ action: 'add', channel: 'Sub 808', pattern: 1, step: 1, note: 'G2' }]), project).items
  const next = applySuggestion(project, item)
  assert.deepEqual(next.pianoNotes[1].bass808.map((note) => note.note).sort(), ['C2', 'G2'])
  const removed = applySuggestion(project, suggestionsFromBlock(block([{ action: 'remove', channel: 'Sub 808', pattern: 1, step: 1, note: 'C2' }]), project).items[0])
  assert.equal(removed.stepData[1].bass808[0], 0)
  assert.deepEqual(removed.pianoNotes[1].bass808, [])
})

test('a suggestion that no longer fits is not applied', () => {
  const [addE4] = items()
  const shortened = { ...trap(), patternSteps: { 1: 8 } }
  assert.equal(applySuggestion(shortened, addE4), shortened)
})

// ---- Prompt and memory --------------------------------------------------------

test('the system prompt explains the format and fits the Python gateway limit', () => {
  assert.ok(SYSTEM_PROMPT.length <= 5000, `system prompt is ${SYSTEM_PROMPT.length} characters`)
  assert.match(SYSTEM_PROMPT, /<note-suggestions>/)
  assert.match(SYSTEM_PROMPT, /C2 to C6/)
})

test('Claude is reminded what it highlighted', () => {
  assert.equal(suggestionsMemo(undefined), '')
  assert.equal(suggestionsMemo({ items: [], skipped: 2 }), '')
  const memo = suggestionsMemo({ items: items().slice(0, 2), skipped: 0 })
  assert.equal(memo, '\n[Highlighted in the editor: Retro Lead pattern 1: Add E4 at step 9 (4 steps); Retro Lead pattern 1: Remove C4 at step 4]')
})
