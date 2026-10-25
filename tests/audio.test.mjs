import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { extname } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import ts from 'typescript'

// Node 24 strips TypeScript natively. Resolve the extensionless source imports
// used by Vite without adding a test framework or modifying production imports.
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
  load(url, context, nextLoad) {
    // Vite bundles stylesheets; in Node a component's CSS import is just an empty module.
    if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true }
    if (url.endsWith('.tsx')) {
      const source = ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 },
      }).outputText
      return { format: 'module', source, shortCircuit: true }
    }
    return nextLoad(url, context)
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

const { createStudioProject, PRESETS } = await import('../src/studio/data.ts')
const { toAudioPattern, toAudioSong, patternStepAt } = await import('../src/studio/patternAdapter.ts')

test('every studio preset maps all channels into valid engine data', () => {
  for (const preset of Object.values(PRESETS)) {
    const project = createStudioProject()
    project.bpm = preset.bpm
    project.stepData[1] = structuredClone(preset.steps)
    project.pianoNotes[1] = structuredClone(preset.notes)
    const pattern = toAudioPattern(project, 1)
    validatePattern(pattern)
    assert.equal(pattern.tracks.length, project.channels.length)
    assert.equal(pattern.bpm, preset.bpm)
    assert.equal(pattern.tracks.find((track) => track.id === 'clap').pattern.clap.length, preset.steps.clap.filter(Boolean).length)
    const engine = new AudioEngine(pattern)
    assert.deepEqual(engine.getPattern(), pattern)
    engine.dispose()
  }
})

test('authored notes take precedence without double-triggering and are independent of channel selection', () => {
  const project = createStudioProject()
  project.pianoNotes[1].bass808 = [{ step: 0, note: 'F2', length: 3 }]
  project.pianoNotes[1].synth_lead = [
    { step: 0, note: 'C4', length: 4 }, { step: 0, note: 'E4', length: 2 },
  ]
  const pattern = toAudioPattern(project, 1)
  validatePattern(pattern)
  const bass = pattern.tracks.find((track) => track.id === 'bass808')
  const melody = pattern.tracks.find((track) => track.id === 'synth_lead')
  assert.deepEqual(bass.steps[0].notes, [{ pitch: 'F2', durationSteps: 3, velocity: 0.8 }])
  assert.deepEqual(melody.steps[0].notes.map((note) => note.pitch), ['C4', 'E4'])
  assert.equal(melody.steps.filter((step) => step.step === 0).length, 1)
  assert.equal(melody.steps.find((step) => step.step === 3).notes[0].pitch, 'A4')
})

test('pattern switching and edits preserve the other three patterns', () => {
  const project = createStudioProject()
  const original = toAudioPattern(project, 1)
  const empty = toAudioPattern(project, 2)
  assert.equal(empty.tracks.every((track) => track.type === 'drums'
    ? Object.values(track.pattern).every((hits) => hits.length === 0)
    : track.steps.length === 0), true)
  project.stepData[2].kick[3] = 1
  assert.equal(toAudioPattern(project, 2).tracks[0].pattern.kick[0].step, 3)
  assert.deepEqual(toAudioPattern(project, 1), original)
  const secondProject = createStudioProject()
  assert.equal(secondProject.stepData[2].kick[3], 0)
})

test('channel and insert solo/mute combine, and zero volume is truly silent', () => {
  const project = createStudioProject()
  project.channels[0].solo = true
  let pattern = toAudioPattern(project, 1)
  assert.deepEqual(pattern.tracks.filter((track) => !track.muted).map((track) => track.id), ['kick'])
  project.channels[0].solo = false
  project.mixerTracks[3].solo = true
  pattern = toAudioPattern(project, 1)
  assert.deepEqual(pattern.tracks.filter((track) => !track.muted).map((track) => track.id), ['hat_closed', 'hat_open'])
  project.channels[3].muted = true
  project.channels[4].vol = 0
  assert.equal(toAudioPattern(project, 1).tracks.every((track) => track.muted), true)
  project.mixerTracks[3].solo = false
  project.mixerTracks[1].mute = true
  assert.equal(toAudioPattern(project, 1).tracks[0].muted, true)
})

test('mixer gain, pan, effects, master volume, and metronome reach the pattern', () => {
  const project = createStudioProject()
  // A one-bar pattern, so the metronome clicks on 4 beats.
  project.patternSteps = { 1: 16 }
  project.channels[0].pan = -0.5
  project.mixerTracks[1].pan = -0.75
  project.mixerTracks[1].filter = 1500
  project.mixerTracks[1].delay = 0.5
  project.mixerTracks[1].dist = 0.3
  project.mixerTracks[0].vol = 0
  project.metronome = true
  let pattern = toAudioPattern(project, 1)
  validatePattern(pattern)
  assert.equal(pattern.master.muted, true)
  assert.equal(pattern.tracks[0].pan, -1)
  assert.deepEqual(pattern.tracks[0].effects, { filterHz: 1500, delay: 0.5, distortion: 0.3 })
  assert.equal(pattern.tracks.at(-1).id, '__metronome')
  assert.deepEqual(pattern.tracks.at(-1).steps.map((entry) => entry.step), [0, 4, 8, 12])
  project.mixerTracks[0].vol = 1.2
  project.loop = false
  pattern = toAudioPattern(project, 1)
  validatePattern(pattern)
  assert.equal(pattern.master.volumeDb > 0, true)
  assert.equal(pattern.master.muted, false)
  assert.equal(pattern.loop, false)
})

test('optional mixer fields validate without changing legacy pattern support', () => {
  const pattern = createDemoPattern()
  pattern.master = { volumeDb: 2, muted: false, pan: -1, effects: { delay: 0.8, distortion: 0.3, filterHz: 500 } }
  pattern.tracks[0].pattern.clap = [{ step: 4, velocity: 0.5 }]
  validatePattern(pattern)
  for (const invalid of [
    { ...pattern, master: { volumeDb: 7 } },
    { ...pattern, master: { pan: NaN } },
    { ...pattern, master: { effects: { delay: 0.9 } } },
    { ...pattern, master: { effects: { distortion: -1 } } },
    { ...pattern, master: { effects: { filterHz: 0 } } },
  ]) assert.throws(() => validatePattern(invalid), TypeError)
  const engine = new AudioEngine(pattern)
  assert.deepEqual(engine.getOutputLevels(), [0, 0])
  engine.dispose()
  assert.deepEqual(engine.getOutputLevels(), [0, 0])
})

test('the app opens on the home screen listing projects, without allocating browser audio', async () => {
  const React = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { default: App } = await import('../src/App.tsx')
  const html = renderToStaticMarkup(React.createElement(App))
  for (const text of ['REMIXRELAY', 'Your projects', 'New project', 'Trap Heat', 'Study Beats', 'Empty Template']) assert.ok(html.includes(text), `Missing ${text}`)
  assert.ok(!html.includes('Channel Rack'), 'The studio opens only after picking a project')
  assert.ok(!html.includes('AudioContext'))
})

test('the studio renders on its own without allocating browser audio', async () => {
  const React = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { default: Studio } = await import('../fl_studio_web_daw.tsx')
  const html = renderToStaticMarkup(React.createElement(Studio))
  assert.ok(!html.includes('aria-label="Home"'), 'HOME only appears when there is a home to go to')
  assert.ok(renderToStaticMarkup(React.createElement(Studio, { onHome: () => {}, projectName: 'My Song' })).includes('My Song'))
  // The studio opens on the playlist; the channel rack is one tab away.
  for (const text of ['REMIXRELAY', 'Playlist • Song', 'Pattern 1', 'Track 1', 'Channel Rack', 'Trap Heat']) assert.ok(html.includes(text), `Missing ${text}`)
  for (const name of ['Play', 'Stop', 'Loop', 'Tempo BPM', 'Master volume', 'Pattern playback mode', 'Song playback mode']) {
    assert.ok(html.includes(`aria-label="${name}"`), `Missing studio control ${name}`)
  }
  assert.ok(!html.includes('Get started'))
  assert.ok(!html.includes('AudioContext'))
})

test('multi-bar patterns validate steps across every bar', () => {
  const base = createDemoPattern()
  const melody = (step) => ({ ...base.tracks[2], steps: [{ step, notes: [{ pitch: 'C4', durationSteps: 2 }] }] })
  // One bar (the default) still stops at step 15, with the same message as before.
  assert.throws(() => validatePattern({ ...base, tracks: [melody(16)] }), /step must be an integer from 0 to 15/)
  validatePattern({ ...base, bars: 4, tracks: [melody(63)] })
  assert.throws(() => validatePattern({ ...base, bars: 4, tracks: [melody(64)] }), /from 0 to 63/)
  for (const bars of [0, 65, 1.5]) {
    assert.throws(() => validatePattern({ ...base, bars }), /bars must be an integer from 1 to 64/)
  }
})

test('changing the bar count of a stopped engine just replaces the pattern', () => {
  const engine = new AudioEngine(createDemoPattern())
  engine.setPattern({ ...createDemoPattern(), bars: 8 })
  assert.equal(engine.getPattern().bars, 8)
  assert.equal(engine.getState().status, 'stopped')
  engine.dispose()
})

test('SONG mode places each playlist clip on its bar and merges overlapping patterns', () => {
  const project = createStudioProject()
  // One-bar patterns, so each clip fills exactly the bar it sits on.
  project.patternSteps = { 1: 16, 2: 16 }
  // Pattern 1 (Trap Heat) on bars 1 and 3; pattern 2 gets one kick, stacked on bar 3.
  project.stepData[2].kick[8] = 1
  project.song = {
    bars: 4, trackCount: 2,
    clips: [
      { id: 'a', patternId: '1', track: 0, startBar: 0 },
      { id: 'b', patternId: '1', track: 0, startBar: 2 },
      { id: 'c', patternId: '2', track: 1, startBar: 2 },
    ],
  }
  const song = toAudioSong(project)
  validatePattern(song)
  assert.equal(song.bars, 4)
  const kicks = song.tracks.find((track) => track.id === 'kick').pattern.kick.map((hit) => hit.step)
  // Trap Heat kicks on 0, 6, 10, then the same 32 steps later, plus pattern 2's kick at 32 + 8.
  assert.deepEqual(kicks, [0, 6, 10, 32, 38, 40, 42])
  const lead = song.tracks.find((track) => track.id === 'synth_lead').steps
  assert.ok(lead.every((entry) => entry.step < 16 || entry.step >= 32), 'Empty bars stay silent')
  assert.equal('bars' in toAudioPattern(project, 1), false, 'PAT mode output is unchanged')
})

test('notes edited in the piano roll keep their velocity in playback', () => {
  const project = createStudioProject()
  project.pianoNotes[1].synth_lead = [{ id: 'x', step: 0, note: 'A4', length: 2, velocity: 0.3 }]
  const lead = toAudioPattern(project, 1).tracks.find((track) => track.id === 'synth_lead')
  assert.equal(lead.steps[0].notes[0].velocity, 0.3)
})

test('a channel instrument preset reaches the engine and unknown presets are rejected', async () => {
  const { SOUND_PRESETS } = await import('../src/audio/index.ts')
  assert.deepEqual(SOUND_PRESETS.map((s) => s.name), ['Grand Piano', 'Synth Lead', 'Deep Bass', 'Warm Pad', 'Pluck', 'Chiptune'])
  const project = createStudioProject()
  const lead = (p) => toAudioPattern(p, 1).tracks.find((track) => track.id === 'synth_lead')
  assert.equal('sound' in lead(project), false, 'Channels without a preset keep the default synth')
  project.channels = project.channels.map((c) => c.id === 'synth_lead' ? { ...c, sound: 'warm-pad' } : c)
  const pattern = toAudioPattern(project, 1)
  validatePattern(pattern)
  assert.equal(lead(project).sound, 'warm-pad')
  const bad = { ...pattern, tracks: pattern.tracks.map((t) => t.id === 'synth_lead' ? { ...t, sound: 'kazoo' } : t) }
  assert.throws(() => validatePattern(bad), /unknown sound preset kazoo/)
})

test('patterns can be any number of steps long', () => {
  const project = createStudioProject()
  project.patternSteps = { 1: 24 }
  project.stepData[1].kick[20] = 1
  const odd = toAudioPattern(project, 1)
  validatePattern(odd)
  assert.equal(odd.steps, 24, 'A 24-step pattern loops after 24 steps')
  assert.ok(odd.tracks.find((t) => t.id === 'kick').pattern.kick.some((hit) => hit.step === 20))
  project.patternSteps = { 1: 32 }
  const twoBars = toAudioPattern(project, 1)
  assert.equal(twoBars.bars, 2)
  assert.equal('steps' in twoBars, false, 'Whole-bar lengths use bars')
  assert.throws(() => validatePattern({ ...odd, steps: 0 }), /steps must be an integer/)
})

test('long patterns span several playlist bars and stop at the end of the song', () => {
  const project = createStudioProject()
  project.patternSteps = { 2: 32 }
  project.stepData[2].kick = new Array(32).fill(0)
  project.stepData[2].kick[0] = 1
  project.stepData[2].kick[24] = 1
  project.song = { bars: 8, trackCount: 1, clips: [
    { id: 'a', patternId: '2', track: 0, startBar: 0 },
    { id: 'b', patternId: '2', track: 0, startBar: 7 }, // second half hangs off the end
  ] }
  const song = toAudioSong(project)
  validatePattern(song)
  assert.deepEqual(song.tracks.find((t) => t.id === 'kick').pattern.kick.map((h) => h.step), [0, 24, 112])
  assert.equal(patternStepAt(project, 2, 20), 20)
  assert.equal(patternStepAt(project, 2, 40), null, 'Bars 3-7 have no clip of pattern 2')
  assert.equal(patternStepAt(project, 2, 115), 3)
})

test('patterns nobody has resized default to DEFAULT_PATTERN_STEPS', async () => {
  const { DEFAULT_PATTERN_STEPS, patternLength } = await import('../src/studio/patternAdapter.ts')
  const project = createStudioProject()
  assert.equal(patternLength(project, 1), DEFAULT_PATTERN_STEPS)
  const pattern = toAudioPattern(project, 1)
  validatePattern(pattern)
  assert.equal(pattern.bars ?? 1, DEFAULT_PATTERN_STEPS / 16)
})

test('a piano only plays once it holds every sample, and retries after a failed download', async () => {
  // Node has no Web Audio: stub the download and decoder, and let the test decide when each sample decodes.
  const { loadPianoInto } = await import('../src/audio/sounds.ts')
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
  const fakePiano = () => ({ disposed: false, added: [], add(note) { this.added.push(note) } })
  const { fetch: realFetch } = globalThis
  const realWarn = console.warn
  const warnings = []
  const decodes = []
  console.warn = (...args) => warnings.push(args.join(' '))
  globalThis.OfflineAudioContext = class {
    decodeAudioData() { return new Promise((resolve) => decodes.push(resolve)) }
  }
  try {
    // Offline: the piano stays silent, the failure is reported, and nothing is cached.
    globalThis.fetch = async () => { throw new Error('offline') }
    const offline = loadPianoInto(fakePiano())
    await settle()
    assert.equal(offline.ready, false)
    assert.match(warnings.join('\n'), /Piano samples failed to load/)

    // Back online: half the samples decoded fills the shared cache, but this piano still holds none.
    globalThis.fetch = async () => ({ arrayBuffer: async () => new ArrayBuffer(8) })
    const piano = fakePiano()
    const load = loadPianoInto(piano)
    const closed = fakePiano()
    const closedLoad = loadPianoInto(closed)
    closed.disposed = true
    for (let i = 0; i < 20 && decodes.length < 26; i++) await settle()
    assert.equal(decodes.length, 26, 'The retry downloads every sample again')
    decodes.slice(0, 13).forEach((resolve, i) => resolve({ sample: i }))
    await settle()
    assert.equal(load.ready, false, 'A partly loaded piano must not play')
    assert.equal(piano.added.length, 0)

    decodes.slice(13).forEach((resolve, i) => resolve({ sample: 13 + i }))
    await settle()
    assert.equal(load.ready, true)
    assert.equal(piano.added.length, 26)
    assert.equal(closedLoad.ready, false, 'A piano disposed while loading is left alone')
    assert.equal(closed.added.length, 0)

    const later = fakePiano()
    assert.equal(loadPianoInto(later).ready, true, 'Once cached, a new piano is ready immediately')
    assert.equal(later.added.length, 26)
  } finally {
    globalThis.fetch = realFetch
    console.warn = realWarn
    delete globalThis.OfflineAudioContext
  }
})

test('an instrument that fails on a step does not stop the tracks after it', async () => {
  const { playTracksAtStep } = await import('../src/audio/AudioEngine.ts')
  const pattern = createDemoPattern()
  const played = []
  const instruments = new Map(pattern.tracks.map((track) => [track.id, {
    playStep(next, step) {
      if (next.id === 'bass') throw new Error('No available buffers for note: 36')
      played.push(`${next.id}@${step}`)
    },
  }]))
  const errors = []
  playTracksAtStep(pattern.tracks, instruments, 4, 0, 0.1, (id, error) => errors.push([id, error.message]))
  assert.deepEqual(played, ['drums@4', 'melody@4', 'chords@4'])
  assert.deepEqual(errors, [['bass', 'No available buffers for note: 36']])
})

test('projects can have more than four patterns, and new ones play in PAT and SONG mode', async () => {
  const { patternNumbers, patternColor } = await import('../src/studio/patternAdapter.ts')
  const project = createStudioProject()
  assert.deepEqual(patternNumbers(project), [1, 2, 3, 4])
  project.patternCount = 6
  assert.deepEqual(patternNumbers(project), [1, 2, 3, 4, 5, 6])
  assert.equal(patternColor(9), patternColor(1), 'Colors repeat after eight patterns')
  // Pattern 6 has never been touched: no step or note data exists for it yet.
  const empty = toAudioPattern(project, 6)
  validatePattern(empty)
  assert.ok(empty.tracks.every((t) => (t.type === 'drums' ? Object.values(t.pattern).flat() : t.steps).length === 0))
  // Give it a kick and place it on bar 2 of the song.
  project.stepData[6] = { kick: [1] }
  project.patternSteps = { 1: 16, 6: 16 }
  project.song = { bars: 2, trackCount: 1, clips: [{ id: 'x', patternId: '6', track: 0, startBar: 1 }] }
  const song = toAudioSong(project)
  validatePattern(song)
  assert.deepEqual(song.tracks.find((t) => t.id === 'kick').pattern.kick.map((h) => h.step), [16])
})

test('the Empty Template project has blank patterns and an empty song', async () => {
  const { createDemoProjects } = await import('../src/studio/projects.ts')
  const empty = createDemoProjects().find((p) => p.name === 'Empty Template').project
  for (const steps of Object.values(empty.stepData)) {
    for (const gates of Object.values(steps)) assert.ok(gates.every((g) => g === 0), 'No lit steps')
  }
  assert.ok(Object.values(empty.pianoNotes).every((notes) => Object.keys(notes).length === 0), 'No notes')
  assert.equal(empty.song.clips.length, 0, 'Nothing on the playlist')
  const pattern = toAudioPattern(empty, 1)
  validatePattern(pattern)
  assert.ok(pattern.tracks.every((t) => (t.type === 'drums' ? Object.values(t.pattern).flat() : t.steps).length === 0), 'Plays silence')
})

test('Aero pattern actions keep notes, steps and other patterns consistent', async () => {
  const { clearPattern, randomizePattern, togglePatternStep } = await import('../src/studio/patternEditing.ts')
  const original = createStudioProject()
  const untouched = structuredClone(original)
  const next = togglePatternStep(original, 1, 'synth_lead', 0)
  assert.equal(next.stepData[1].synth_lead[0], 0)
  assert.ok(!next.pianoNotes[1].synth_lead.some((note) => note.step === 0))
  const cleared = clearPattern(original, 1)
  assert.ok(cleared.stepData[1].kick.every((value) => value === 0))
  assert.deepEqual(cleared.pianoNotes[1], {})
  assert.equal(cleared.stepData[2], original.stepData[2])
  assert.equal(cleared.song, original.song)
  const randomized = randomizePattern(original, 1, () => 0)
  const audio = toAudioPattern(randomized, 1)
  assert.ok(audio.tracks.every((track) => track.type === 'drums'
    ? Object.values(track.pattern).every((hits) => hits.length === 0) : track.steps.length === 0),
  'Randomizing off must not keep authored notes playing behind unlit steps')
  assert.deepEqual(original, untouched)
})

test('preset loading fills the selected length and never restores hidden notes after a resize', async () => {
  const { loadPatternPreset } = await import('../src/studio/patternEditing.ts')
  const original = createStudioProject()
  original.patternSteps = { 1: 7 }
  const short = loadPatternPreset(original, 1, 'Synthwave 80s')
  const audio = toAudioPattern(short, 1)
  validatePattern(audio)
  assert.ok(short.stepData[1].kick.length === 7)
  assert.ok(Object.values(short.pianoNotes[1]).flat().every((note) => note.step + note.length <= 7))
  assert.equal(short.pianoNotes[2], original.pianoNotes[2])
  original.patternSteps[1] = 64
  const long = loadPatternPreset(original, 1, 'Trap Heat')
  validatePattern(toAudioPattern(long, 1))
  assert.equal(long.stepData[1].kick[48], 1)
  assert.equal(long.song, original.song)
  assert.equal(loadPatternPreset(original, 1, 'unknown'), original)
})

test('voice reservation includes release tails across short loops and supports multi-bar patterns', async () => {
  const { requiredVoices } = await import('../src/audio/ScheduledSynth.ts')
  const track = { id: 'lead', name: 'Lead', type: 'melody', muted: false, volumeDb: -12,
    steps: [{ step: 0, notes: [{ pitch: 'C4', durationSteps: 16 }] }] }
  assert.equal(requiredVoices(track, 1, 0.2), 20)
  assert.equal(requiredVoices(track, 64, 0.2), 1)
  track.steps.push({ step: 32, notes: [{ pitch: 'E4', durationSteps: 16 }] })
  assert.equal(requiredVoices(track, 64, 0.2), 1, 'Distant song notes should not reserve phantom one-bar overlaps')
})
