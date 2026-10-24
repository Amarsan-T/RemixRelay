import { AudioEngine, createDemoPattern, MAX_BPM, MIN_BPM, STEP_COUNT, validatePattern } from './index'
import type { PlaybackState } from './types'
import './test-page.css'

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector)
  if (!found) throw new Error(`Missing audio test element: ${selector}`)
  return found
}

const play = element<HTMLButtonElement>('#play')
const stop = element<HTMLButtonElement>('#stop')
const reset = element<HTMLButtonElement>('#reset')
const bpm = element<HTMLInputElement>('#bpm')
const loop = element<HTMLInputElement>('#loop')
const preset = element<HTMLSelectElement>('#preset')
const editor = element<HTMLTextAreaElement>('#pattern')
const error = element<HTMLParagraphElement>('#error')
const tracks = element<HTMLDivElement>('#tracks')
const status = element<HTMLSpanElement>('#status')
const position = element<HTMLParagraphElement>('#position')
const steps = element<HTMLDivElement>('#steps')
const controller = new AbortController()
let engine = new AudioEngine()
let unsubscribe = engine.subscribe(renderPlayback)

for (let step = 0; step < STEP_COUNT; step++) {
  const marker = document.createElement('span')
  marker.textContent = String(step + 1)
  marker.dataset.step = String(step)
  steps.append(marker)
}

function renderPlayback(state: PlaybackState) {
  status.textContent = state.status === 'starting' ? 'Enabling audio…' : state.status === 'playing' ? 'Playing' : 'Stopped'
  play.disabled = state.status === 'starting' || state.status === 'playing'
  for (const marker of steps.children) {
    marker.classList.toggle('active', Number((marker as HTMLElement).dataset.step) === state.step)
  }
  position.textContent = state.step === null
    ? 'Ready · 16 steps / 4 beats'
    : `Step ${state.step + 1} / 16 · Beat ${Math.floor(state.step / 4) + 1}`
}

function reportError(cause: unknown) {
  error.hidden = false
  error.textContent = cause instanceof Error ? cause.message : String(cause)
}

function run(action: () => void | Promise<void>) {
  error.hidden = true
  try { void Promise.resolve(action()).catch(reportError) } catch (cause) { reportError(cause) }
}

function renderPattern() {
  const pattern = engine.getPattern()
  bpm.value = String(pattern.bpm)
  loop.checked = pattern.loop
  tracks.replaceChildren()
  for (const track of pattern.tracks) {
    const row = document.createElement('div')
    row.className = 'track'
    const label = document.createElement('div')
    const name = document.createElement('strong')
    name.textContent = track.name
    const description = document.createElement('span')
    description.className = 'hint'
    description.textContent = track.type === 'drums' ? 'Kick · Snare · Closed hat · Open hat' : `${track.steps.length} note groups · ${track.type}`
    label.append(name, description)
    const muteLabel = document.createElement('label')
    muteLabel.className = 'check'
    const mute = document.createElement('input')
    mute.type = 'checkbox'
    mute.checked = track.muted
    mute.setAttribute('aria-label', `Mute ${track.name}`)
    mute.addEventListener('change', () => run(() => engine.setTrackMuted(track.id, mute.checked)))
    muteLabel.append(mute, ' Mute')
    const volumeLabel = document.createElement('label')
    volumeLabel.className = 'volume'
    const volume = document.createElement('input')
    volume.type = 'range'
    volume.min = '-60'
    volume.max = '0'
    volume.step = '1'
    volume.value = String(track.volumeDb)
    volume.setAttribute('aria-label', `${track.name} volume`)
    const value = document.createElement('output')
    value.textContent = `${track.volumeDb} dB`
    volume.addEventListener('input', () => run(() => {
      engine.setTrackVolume(track.id, Number(volume.value))
      value.textContent = `${volume.value} dB`
    }))
    volumeLabel.append(volume, value)
    row.append(label, muteLabel, volumeLabel)
    tracks.append(row)
  }
}

play.addEventListener('click', () => run(() => engine.play()), { signal: controller.signal })
stop.addEventListener('click', () => run(() => engine.stop()), { signal: controller.signal })
reset.addEventListener('click', () => run(() => {
  const pattern = engine.getPattern()
  unsubscribe()
  engine.dispose()
  engine = new AudioEngine(pattern)
  unsubscribe = engine.subscribe(renderPlayback)
  renderPattern()
}), { signal: controller.signal })
bpm.addEventListener('change', () => run(() => {
  try { engine.setBpm(Number(bpm.value)) } finally { bpm.value = String(engine.getState().bpm) }
}), { signal: controller.signal })
bpm.addEventListener('input', () => {
  const value = Number(bpm.value)
  // Let the user temporarily clear/type the field; validate incomplete edits on blur.
  if (Number.isFinite(value) && value >= MIN_BPM && value <= MAX_BPM) run(() => engine.setBpm(value))
}, { signal: controller.signal })
loop.addEventListener('change', () => run(() => engine.setLoop(loop.checked)), { signal: controller.signal })
preset.addEventListener('change', () => run(() => {
  const pattern = createDemoPattern(preset.value === 'B' ? 'B' : 'A')
  const previous = engine.getPattern()
  pattern.bpm = previous.bpm
  pattern.loop = previous.loop
  for (const track of pattern.tracks) {
    const old = previous.tracks.find((entry) => entry.id === track.id)
    if (old) { track.muted = old.muted; track.volumeDb = old.volumeDb }
  }
  engine.setPattern(pattern)
  renderPattern()
  editor.value = JSON.stringify(engine.getPattern(), null, 2)
}), { signal: controller.signal })
element('#apply').addEventListener('click', () => run(() => {
  const pattern: unknown = JSON.parse(editor.value)
  validatePattern(pattern)
  engine.setPattern(pattern)
  renderPattern()
}), { signal: controller.signal })
element('#read').addEventListener('click', () => {
  editor.value = JSON.stringify(engine.getPattern(), null, 2)
}, { signal: controller.signal })

function cleanup() {
  controller.abort()
  unsubscribe()
  engine.dispose()
}

window.addEventListener('pagehide', (event) => {
  // Keep the instance usable if the browser restores this page from its back/forward cache.
  if (event.persisted) engine.stop()
  else cleanup()
}, { signal: controller.signal })
if (import.meta.hot) import.meta.hot.dispose(cleanup)
renderPattern()
editor.value = JSON.stringify(engine.getPattern(), null, 2)
