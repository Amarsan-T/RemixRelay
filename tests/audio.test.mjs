import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { extname } from 'node:path'
import { test } from 'node:test'

// Node 24 strips TypeScript natively. Resolve the extensionless source imports
// used by Vite without adding a test framework or modifying production imports.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL?.includes('/src/audio/') && !extname(specifier)) {
      return nextResolve(new URL(`${specifier}.ts`, context.parentURL).href, context)
    }
    return nextResolve(specifier, context)
  },
})

const { AudioEngine, createDemoPattern, validatePattern } = await import('../src/audio/index.ts')

test('both presets contain the four instrument types and validate', () => {
  for (const variant of ['A', 'B']) {
    const pattern = createDemoPattern(variant)
    validatePattern(pattern)
    assert.deepEqual(pattern.tracks.map((track) => track.type), ['drums', 'bass', 'melody', 'chords'])
    assert.equal(pattern.tracks[0].pattern.openHat.length > 0, true)
  }
})

test('constructor and getter isolate caller-owned pattern data', () => {
  const pattern = createDemoPattern()
  const engine = new AudioEngine(pattern)
  pattern.tracks[0].pattern.kick[0].step = 15
  const snapshot = engine.getPattern()
  snapshot.tracks[1].steps[0].notes[0].pitch = 'D2'
  assert.equal(engine.getPattern().tracks[0].pattern.kick[0].step, 0)
  assert.equal(engine.getPattern().tracks[1].steps[0].notes[0].pitch, 'C2')
  assert.equal(engine.getState().initialized, false)
  engine.dispose()
})

test('live edit API preserves track order, replaces types, and copies edits', () => {
  const engine = new AudioEngine()
  const melody = engine.getPattern().tracks[2]
  melody.steps = [{ step: 15, notes: [{ pitch: 'F#5', durationSteps: 0.5, velocity: 0 }] }]
  engine.setTrack(melody)
  melody.steps[0].notes[0].pitch = 'G5'
  assert.equal(engine.getPattern().tracks[2].steps[0].notes[0].pitch, 'F#5')
  engine.setTrackMuted('bass', true)
  engine.setTrackVolume('chords', -24)
  engine.setBpm(144)
  engine.setLoop(false)
  assert.deepEqual(engine.getPattern().tracks.map((track) => track.id), ['drums', 'bass', 'melody', 'chords'])
  assert.equal(engine.getPattern().tracks[1].muted, true)
  assert.equal(engine.getPattern().tracks[3].volumeDb, -24)
  assert.equal(engine.getState().bpm, 144)
  assert.equal(engine.getState().loop, false)
  engine.setTrack({ id: 'extra', name: 'Extra', type: 'melody', muted: false, volumeDb: -20, steps: [] })
  engine.setTrack({ id: 'extra', name: 'Extra drums', type: 'drums', muted: false, volumeDb: -20,
    pattern: { kick: [], snare: [], closedHat: [], openHat: [] } })
  assert.equal(engine.getPattern().tracks.at(-1).type, 'drums')
  engine.removeTrack('extra')
  assert.equal(engine.getPattern().tracks.length, 4)
  engine.dispose()
})

test('invalid snapshots are rejected atomically', () => {
  const engine = new AudioEngine()
  const before = engine.getPattern()
  const invalid = engine.getPattern()
  invalid.tracks[1].steps[0].notes[0].pitch = 'not a note'
  assert.throws(() => engine.setPattern(invalid), TypeError)
  assert.deepEqual(engine.getPattern(), before)
  assert.throws(() => engine.setBpm(NaN), TypeError)
  assert.throws(() => engine.setTrackMuted('missing', true), RangeError)
  assert.throws(() => engine.setTrackVolume('bass', 1), TypeError)
  assert.throws(() => engine.setLoop('yes'), TypeError)
  assert.deepEqual(engine.getPattern(), before)
  engine.dispose()
})

const invalidCases = [
  ['negative drum position', (pattern) => { pattern.tracks[0].pattern.kick[0].step = -1 }],
  ['out-of-bar position', (pattern) => { pattern.tracks[1].steps[0].step = 16 }],
  ['fractional position', (pattern) => { pattern.tracks[1].steps[0].step = 1.5 }],
  ['duplicate drum position', (pattern) => { pattern.tracks[0].pattern.kick.push({ step: 0 }) }],
  ['duplicate note position', (pattern) => { pattern.tracks[1].steps.push(pattern.tracks[1].steps[0]) }],
  ['duplicate ids', (pattern) => { pattern.tracks[1].id = 'drums' }],
  ['unknown instrument', (pattern) => { pattern.tracks[1].type = 'violin' }],
  ['missing drum voice', (pattern) => { delete pattern.tracks[0].pattern.openHat }],
  ['zero duration', (pattern) => { pattern.tracks[1].steps[0].notes[0].durationSteps = 0 }],
  ['infinite duration', (pattern) => { pattern.tracks[1].steps[0].notes[0].durationSteps = Infinity }],
  ['invalid velocity', (pattern) => { pattern.tracks[0].pattern.kick[0].velocity = 1.1 }],
  ['enharmonic duplicate notes', (pattern) => {
    pattern.tracks[2].steps[0].notes = [
      { pitch: 'C#4', durationSteps: 1 }, { pitch: 'Db4', durationSteps: 2 },
    ]
  }],
]
for (const [label, mutate] of invalidCases) {
  test(`validation rejects ${label}`, () => {
    const pattern = createDemoPattern()
    mutate(pattern)
    assert.throws(() => validatePattern(pattern), TypeError)
  })
}

test('empty patterns and boundary values are valid', () => {
  validatePattern({ bpm: 40, loop: false, tracks: [] })
  validatePattern({ bpm: 240, loop: true, tracks: [] })
  for (const value of [null, [], {}, { bpm: 120, loop: true, tracks: null }]) {
    assert.throws(() => validatePattern(value), TypeError)
  }
})

test('subscriptions, repeated stop, and terminal disposal work before audio initialization', () => {
  const engine = new AudioEngine()
  const updates = []
  const unsubscribe = engine.subscribe((state) => { updates.push(state) })
  assert.equal(updates.length, 1)
  engine.setBpm(130)
  assert.equal(updates.at(-1).bpm, 130)
  engine.stop()
  engine.stop()
  assert.equal(engine.getState().step, null)
  unsubscribe()
  const count = updates.length
  engine.setBpm(140)
  assert.equal(updates.length, count)
  engine.dispose()
  engine.dispose()
  engine.stop()
  assert.equal(engine.getState().status, 'disposed')
  assert.equal(engine.getState().initialized, false)
  assert.throws(() => engine.setBpm(120), /disposed/)
  assert.throws(() => engine.play(), /disposed/)
  assert.throws(() => engine.subscribe(() => {}), /disposed/)
})
