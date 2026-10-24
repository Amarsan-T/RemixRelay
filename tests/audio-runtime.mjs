import * as Tone from 'tone'
import { AudioEngine, createDemoPattern, DRUM_VOICES } from '../src/audio/index.ts'

const button = document.querySelector('#run')
const results = document.querySelector('#results')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const check = (condition, message) => { if (!condition) throw new Error(message) }
const log = (message) => { results.textContent += `${message}\n` }

async function peakSignal(analyser, duration = 200) {
  const data = new Float32Array(analyser.fftSize)
  let peak = 0
  const end = performance.now() + duration
  while (performance.now() < end) {
    analyser.getFloatTimeDomainData(data)
    for (const sample of data) peak = Math.max(peak, Math.abs(sample))
    await sleep(12)
  }
  return peak
}

button.addEventListener('click', async () => {
  button.disabled = true
  results.textContent = ''
  const globalContext = Tone.getContext()
  const engine = new AudioEngine()
  let cancelledEngine
  let disposedEngine
  try {
    check(engine.context === null, 'Construction must not allocate audio')
    const firstStart = engine.play()
    check(engine.play() === firstStart, 'Concurrent Play calls must share initialization')
    await firstStart
    check(engine.events.length === 2, 'Play must own exactly one step event and one end event')
    await engine.play()
    check(engine.events.length === 2, 'Repeated Play must not duplicate events')
    engine.stop()
    log('PASS lazy initialization and repeated Play')

    // Test-only access to runtime fields lets us tap the actual mixed output
    // without adding diagnostics or test hooks to the engine's public API.
    const context = engine.context
    const analyser = context.createAnalyser()
    analyser.fftSize = 2048
    engine.limiter.disconnect(context.destination)
    engine.limiter.connect(analyser)
    analyser.connect(context.rawContext.destination)
    const demo = createDemoPattern()
    for (const voice of [...DRUM_VOICES, 'bass', 'melody', 'chords']) {
      let track
      if (DRUM_VOICES.includes(voice)) {
        track = structuredClone(demo.tracks[0])
        for (const drum of DRUM_VOICES) track.pattern[drum] = []
        track.pattern[voice] = [{ step: 0, velocity: 0.8 }]
      } else {
        track = structuredClone(demo.tracks.find((entry) => entry.type === voice))
        track.steps = [{ step: 0, notes: [{ pitch: voice === 'bass' ? 'C2' : 'C4', durationSteps: 2 }] }]
      }
      engine.setPattern({ bpm: 240, loop: true, tracks: [track] })
      await engine.play()
      const peak = await peakSignal(analyser, 250)
      check(peak > 0.00001, `${voice} produced no audio signal (context ${context.state}, time ${context.currentTime}, transport ${context.transport.state}, ticks ${context.transport.ticks}, master ${engine.master.gain.value})`)
      engine.stop()
      await sleep(80)
      check(await peakSignal(analyser, 40) < 0.000001, `${voice} did not become silent after Stop`)
      log(`PASS ${voice} audio output and stop silence (peak ${peak.toFixed(4)})`)
    }

    const pattern = createDemoPattern()
    pattern.bpm = 240
    engine.setPattern(pattern)
    const steps = []
    const unsubscribe = engine.subscribe((state) => {
      if (state.step !== null && steps.at(-1) !== state.step) steps.push(state.step)
    })
    await engine.play()
    await sleep(1250)
    check(steps.includes(15) && steps.filter((step) => step === 0).length >= 2, 'Playhead must cover all 16 steps and loop')
    const ids = [...engine.events]
    engine.setBpm(180)
    engine.setTrack({ ...engine.getPattern().tracks[1], steps: [{ step: 0, notes: [{ pitch: 'F2', durationSteps: 2 }] }] })
    check(engine.events.every((id, index) => id === ids[index]), 'Live updates must preserve the scheduler')
    check(engine.context === context && engine.getState().status === 'playing', 'Live updates must preserve playback')
    for (const track of pattern.tracks) engine.setTrackMuted(track.id, true)
    await sleep(100)
    check(await peakSignal(analyser, 80) < 0.000001, 'Muting every track must silence sustained output')
    engine.setTrackMuted('bass', false)
    check(await peakSignal(analyser, 1400) > 0.00001, 'Unmuted bass must become audible again')
    unsubscribe()
    engine.stop()
    log('PASS synchronized 16-step loop, live BPM/notes, and mute/unmute')

    engine.setPattern({ ...createDemoPattern(), bpm: 240, loop: false })
    await engine.play()
    await sleep(1250)
    check(engine.getState().status === 'stopped' && engine.getState().step === null, 'One-shot playback must stop and rewind')
    check(await peakSignal(analyser, 40) < 0.000001, 'One-shot playback must silence note tails')
    engine.dispose()
    engine.dispose()
    await sleep(30)
    check(context.state === 'closed', 'Dispose must close the owned context')
    check(Tone.getContext() === globalContext && globalContext.state !== 'closed', 'Dispose must preserve global Tone audio')
    analyser.disconnect()
    log('PASS one-shot stop, repeated dispose, and global-context isolation')

    // Hold initialization after real browser resume to reproduce async UI races.
    for (const action of ['stop', 'dispose']) {
      const candidate = new AudioEngine()
      if (action === 'stop') cancelledEngine = candidate
      else disposedEngine = candidate
      const initialize = candidate.initialize.bind(candidate)
      let release
      const gate = new Promise((resolve) => { release = resolve })
      candidate.initialize = async () => { await initialize(); await gate }
      const pending = candidate.play()
      candidate[action]()
      release()
      await pending
      check(candidate.getState().status === (action === 'stop' ? 'stopped' : 'disposed'), `${action} must cancel pending Play`)
      check(candidate.events.length === 0, `${action} must leave no playback events`)
      if (action === 'stop') {
        candidate.initialize = initialize
        await candidate.play()
        check(candidate.getState().status === 'playing', 'Play after cancelling startup must work')
      }
      candidate.dispose()
    }
    log('PASS Stop/Dispose during pending initialization and subsequent restart')
    log('ALL AUDIO RUNTIME CHECKS PASSED')
  } catch (error) {
    log(`FAIL ${error instanceof Error ? error.message : String(error)}`)
    console.error(error)
  } finally {
    engine.dispose()
    cancelledEngine?.dispose()
    disposedEngine?.dispose()
    button.disabled = false
  }
})
