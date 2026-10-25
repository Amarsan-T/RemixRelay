import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { extname } from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { convexToJson } from 'convex/values'

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

const { changesBetween, queueChange, remoteChanges, sameValue, toStored, toStoredChange, withChanges } = await import('../src/studio/projectSync.ts')
const { PROJECT_FIELDS, applyChanges, isValidChange } = await import('../convex/projectChanges.ts')
const { createStudioProject } = await import('../src/studio/data.ts')

/** The studio's way of toggling a step: copy only the arrays along the path. */
const withStep = (project, channel, step, on = 1) => {
  const steps = [...(project.stepData[1][channel] ?? [])]
  steps[step] = on
  return { ...project, stepData: { ...project.stepData, 1: { ...project.stepData[1], [channel]: steps } } }
}

test('every StudioProject field is synced', () => {
  const project = createStudioProject()
  project.patternSteps = { 1: 24 }
  for (const field of Object.keys(project)) assert.ok(PROJECT_FIELDS.includes(field), `${field} would never be saved`)
})

test('an edit becomes changes at the finest path it touched', () => {
  const before = createStudioProject()
  const after = { ...withStep(before, 'kick', 2), bpm: 150 }
  assert.deepEqual(changesBetween(before, after).map((c) => c.path), [['bpm'], ['stepData', '1', 'kick', '2']])
  assert.deepEqual(changesBetween(before, { ...before }), [])
  const cleared = { ...before, pianoNotes: { ...before.pianoNotes, 1: {} } }
  assert.deepEqual(changesBetween(before, cleared).map((c) => c.path), [['pianoNotes', '1', 'synth_lead']])
  const removed = { ...before, pianoNotes: { ...before.pianoNotes, 1: undefined } }
  assert.deepEqual(changesBetween(before, removed), [{ path: ['pianoNotes', '1'], value: undefined }])
})

test('two people editing different channels both keep their steps', () => {
  const start = toStored(createStudioProject(null))
  const a = changesBetween(start, withStep(start, 'kick', 8))
  const b = changesBetween(start, withStep(start, 'hat_closed', 8))
  const server = structuredClone(start)
  applyChanges(server, a)
  applyChanges(server, b) // B saved last, without knowing about A's edit
  assert.equal(server.stepData[1].kick[8], 1)
  assert.equal(server.stepData[1].hat_closed[8], 1)
})

test('queued changes replace older ones they cover and keep save order', () => {
  const queue = new Map()
  queueChange(queue, { path: ['stepData', '1', 'kick'], value: [1] })
  queueChange(queue, { path: ['stepData', '1'], value: { kick: [0] } }) // e.g. Clear pattern
  queueChange(queue, { path: ['stepData', '1', 'kick'], value: [0, 0, 1] })
  assert.deepEqual([...queue.values()].map((c) => c.path.join('.')), ['stepData.1', 'stepData.1.kick'])
  const data = { stepData: { 1: { kick: [1], snare: [1] } } }
  applyChanges(data, [...queue.values()])
  assert.deepEqual(data.stepData[1], { kick: [0, 0, 1] }, 'The later step survives the earlier clear')
})

test('changes create missing patterns and delete with an absent value', () => {
  const data = { stepData: {} }
  applyChanges(data, [{ path: ['stepData', '3', 'kick'], value: [1] }, { path: ['bpm'], value: 90 }])
  assert.deepEqual(data, { stepData: { 3: { kick: [1] } }, bpm: 90 })
  applyChanges(data, [{ path: ['stepData', '3'] }])
  assert.deepEqual(data.stepData, {})
})

test('only project fields at allowed depths can be saved', () => {
  assert.ok(isValidChange({ path: ['bpm'] }))
  assert.ok(isValidChange({ path: ['stepData', '1', 'kick'] }))
  assert.ok(!isValidChange({ path: ['bpm', 'x'] }), 'bpm has no parts')
  assert.ok(!isValidChange({ path: ['stepData', '1', 'kick', '0'] }))
  assert.ok(!isValidChange({ path: ['name'] }))
  assert.ok(!isValidChange({ path: [] }))
})

test('stored changes are valid Convex values, even with a step set past the old pattern end', () => {
  // After a pattern is lengthened, setting step 20 leaves gaps at 16-19, and the
  // next toggle copies the array, turning the gaps into undefined.
  let project = withStep(createStudioProject(), 'kick', 20)
  project = withStep(project, 'kick', 21)
  const patches = changesBetween(createStudioProject(), project)
  assert.ok(patches.filter(c => c.path[0] === 'stepData').every(c => c.path.length === 4))
  for (const patch of patches) convexToJson(toStoredChange(patch))
  const saved = toStored(createStudioProject())
  applyChanges(saved, patches)
  assert.equal(saved.stepData[1].kick[21], 1)
  assert.equal(saved.stepData[1].kick[17], 0)
  const change = { path: ['stepData', '1', 'kick'], value: project.stepData[1].kick }
  assert.throws(() => convexToJson(change), /undefined is not a valid Convex value/)
  const stored = toStoredChange(change)
  convexToJson(stored)
  assert.equal(stored.value[21], 1)
  assert.equal(stored.value[17], null, 'A gap is stored as null, which plays as off')
  assert.deepEqual(toStoredChange({ path: ['stepData', '2'] }), { path: ['stepData', '2'] })
})

test('equality ignores key order and missing vs undefined vs null, like storage', () => {
  assert.ok(sameValue({ a: 1, b: [1, undefined] }, { b: [1, null], a: 1 }))
  assert.ok(sameValue({ a: 1, sound: undefined }, { a: 1 }))
  assert.ok(!sameValue({ a: [1, 0] }, { a: [1, null] }), '0 is a value, not missing')
  assert.ok(!sameValue([1], [1, 1]))
})

test('incoming edits arrive per channel and never undo unsaved local edits', () => {
  const blank = createStudioProject(null)
  const local = withStep(blank, 'kick', 3)
  // Same content, new identities and sorted keys (as every server copy has): nothing to apply.
  assert.equal(remoteChanges(local, toStored(local), []), null)
  // The server has someone else's hi-hat and tempo, but not this tab's unsaved kick.
  const server = toStored({ ...withStep(blank, 'hat_closed', 3), bpm: 99 })
  const changes = remoteChanges(local, server, changesBetween(blank, local))
  assert.deepEqual(changes.map((c) => c.path.join('.')), ['bpm', 'stepData.1.hat_closed.3'])
  const merged = withChanges(local, changes)
  assert.equal(merged.bpm, 99)
  assert.equal(merged.stepData[1].hat_closed[3], 1, "the other person's step arrives")
  assert.equal(merged.stepData[1].kick, local.stepData[1].kick, "this tab's step stays, untouched")
  assert.equal(merged.mixerTracks, local.mixerTracks, 'fields nobody changed keep their identity')
})

test("a click the sync hasn't heard about yet survives an incoming edit and still gets saved", () => {
  // The studio shows a hi-hat click the sync hook hasn't been told about yet,
  // just as another browser's kick arrives from the server.
  const synced = toStored(createStudioProject(null))
  const studio = withStep(synced, 'hat_closed', 13)
  const server = toStored(withStep(synced, 'kick', 13))
  const incoming = remoteChanges(synced, server, [])
  const studioAfter = withChanges(studio, incoming) // what the studio applies to its latest state
  const syncedAfter = withChanges(synced, incoming) // what the sync hook now believes it shows
  assert.equal(studioAfter.stepData[1].kick[13], 1)
  assert.equal(studioAfter.stepData[1].hat_closed[13], 1, 'the click is still on screen')
  // When the studio reports its state, the click shows up as an unsaved change.
  assert.deepEqual(changesBetween(syncedAfter, studioAfter).map((c) => c.path.join('.')), ['stepData.1.hat_closed.13'])
})

test('every project field is saved, including added patterns', () => {
  const project = createStudioProject()
  // Fill in the optional fields too, so a new field can't be forgotten in PROJECT_FIELDS.
  const full = { ...project, patternSteps: { 1: 32 }, patternCount: 6 }
  for (const field of Object.keys(full)) {
    assert.ok(PROJECT_FIELDS.includes(field), `"${field}" is missing from PROJECT_FIELDS, so edits to it are never saved`)
  }
  const changes = changesBetween(project, { ...project, patternCount: 6 })
  assert.deepEqual(changes, [{ path: ['patternCount'], value: 6 }])
  assert.ok(changes.every(isValidChange), 'The server accepts the change')
  const saved = structuredClone(project)
  applyChanges(saved, changes)
  assert.equal(saved.patternCount, 6)
})

for (const order of ['A then B', 'B then A']) {
  test(`independent clients keep different steps of the same row: ${order}`, () => {
    const start = toStored(createStudioProject(null))
    // Both clients read the same old row, including when clicks grow it beyond 16 cells.
    for (const [aStep, bStep] of [[1, 2], [20, 23]]) {
      const a = changesBetween(start, withStep(start, 'kick', aStep))
      const b = changesBetween(start, withStep(start, 'kick', bStep))
      const server = structuredClone(start)
      for (const changes of order === 'A then B' ? [a, b] : [b, a]) applyChanges(server, changes)
      assert.equal(server.stepData[1].kick[aStep], 1)
      assert.equal(server.stepData[1].kick[bStep], 1)
      convexToJson(server)
    }
  })
}

test('incoming same-row steps preserve pending and not-yet-reported local clicks without mutating old snapshots', () => {
  const start = toStored(createStudioProject(null))
  const mine = withStep(start, 'kick', 1)
  const server = withStep(start, 'kick', 2)
  const incoming = remoteChanges(mine, server, changesBetween(start, mine))
  assert.deepEqual(incoming, [{ path: ['stepData', '1', 'kick', '2'], value: 1 }])
  const merged = withChanges(mine, incoming)
  assert.deepEqual(merged.stepData[1].kick.slice(0, 3), [0, 1, 1])
  assert.equal(mine.stepData[1].kick[2], 0)
  assert.equal(start.stepData[1].kick[1], 0)
  const notReported = withChanges(mine, remoteChanges(start, server, []))
  assert.deepEqual(notReported.stepData[1].kick.slice(0, 3), [0, 1, 1])
})

test('note edits on different onsets merge, including chords, removals and an unsaved note', () => {
  const start = toStored(createStudioProject(null))
  const withNotes = (project, notes) => ({ ...project, pianoNotes: { ...project.pianoNotes, 1: { synth_lead: notes } } })
  const chord = [{ step: 2, note: 'C4', length: 2 }, { step: 2, note: 'E4', length: 2 }]
  const other = [{ step: 6, note: 'G4', length: 3 }]
  const a = withNotes(start, chord), b = withNotes(start, other)
  for (const edits of [[a, b], [b, a]]) {
    const server = structuredClone(start)
    for (const edit of edits) applyChanges(server, changesBetween(start, edit))
    assert.deepEqual(server.pianoNotes[1].synth_lead.filter(n => n.step === 2), chord)
    assert.deepEqual(server.pianoNotes[1].synth_lead.filter(n => n.step === 6), other)
    const withoutChord = withNotes(server, other)
    const remove = changesBetween(server, withoutChord)
    assert.deepEqual(remove, [{ path: ['pianoNotes', '1', 'synth_lead', '2'], value: [] }])
    const local = withNotes(server, [...server.pianoNotes[1].synth_lead, { step: 10, note: 'A4', length: 1 }])
    const merged = withChanges(local, remoteChanges(server, withoutChord, []))
    assert.deepEqual(merged.pianoNotes[1].synth_lead.map(n => n.step), [6, 10])
  }
})

test('atomic patch validation bounds indices and keeps arrays dense; malformed operations are rejected', () => {
  assert.ok(isValidChange({ path: ['stepData', '1', 'kick', '255'], value: 1 }))
  for (const key of ['-1', '256', '1000000000', '01', '1.5', '__proto__', 'length']) {
    assert.ok(!isValidChange({ path: ['stepData', '1', 'kick', key], value: 1 }))
  }
  assert.ok(!isValidChange({ path: ['stepData', '1', 'kick', '1'], value: [] }))
  assert.ok(!isValidChange({ path: ['pianoNotes', '1', 'synth_lead', '2'], value: [{ step: 3, note: 'C4' }] }))
  assert.ok(!isValidChange({ path: ['stepData', '__proto__', 'kick', '1'], value: 1 }))
  const data = { stepData: {}, pianoNotes: {} }
  applyChanges(data, [{ path: ['stepData', '1', 'kick', '23'], value: 1 }])
  assert.deepEqual(data.stepData[1].kick, [...Array(23).fill(0), 1])
  convexToJson(data)
})

test('resizes and legacy replacements still truncate hidden steps and queued on/off edits stay ordered', () => {
  const start = withStep(toStored(createStudioProject(null)), 'kick', 23)
  const shorter = { ...start, stepData: { ...start.stepData, 1: { ...start.stepData[1], kick: start.stepData[1].kick.slice(0, 16) } } }
  const changes = changesBetween(start, shorter)
  assert.deepEqual(changes, [{ path: ['stepData', '1', 'kick'], value: Array(16).fill(0) }])
  const server = structuredClone(start)
  applyChanges(server, changes)
  assert.equal(server.stepData[1].kick.length, 16)
  const incomingResize = remoteChanges(start, { ...shorter, patternSteps: { 1: 16 } }, [])
  assert.equal(withChanges(start, incomingResize).stepData[1].kick.length, 16)
  const queue = new Map()
  queueChange(queue, { path: ['stepData', '1', 'kick', '1'], value: 1 })
  queueChange(queue, { path: ['stepData', '1', 'kick', '2'], value: 1 })
  queueChange(queue, { path: ['stepData', '1', 'kick', '1'], value: 0 })
  applyChanges(server, [...queue.values()])
  assert.deepEqual(server.stepData[1].kick.slice(0, 3), [0, 0, 1])
})

test('an incoming compact row cannot erase a click not yet reported from a padded same-channel row', async () => {
  const { togglePatternStep } = await import('../src/studio/patternEditing.ts')
  const start = toStored(createStudioProject(null)) // stored rows are 16, playable pattern is 64
  const synced = togglePatternStep(start, 1, 'kick', 1)
  const studio = togglePatternStep(synced, 1, 'kick', 3) // sync hook has not seen this click yet
  const server = structuredClone(start)
  applyChanges(server, changesBetween(start, withStep(start, 'kick', 2)))
  const incoming = remoteChanges(synced, server, changesBetween(start, synced))
  const merged = withChanges(studio, incoming)
  for (const index of [1, 2, 3]) assert.equal(merged.stepData[1].kick[index], 1, `step ${index} must survive`)
})
