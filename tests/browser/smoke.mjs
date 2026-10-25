// Headless Chrome smoke test for RemixRelay over the DevTools protocol.
// No dependencies: Node 24 global WebSocket + fetch. Audio is muted at the
// sink but the Web Audio graph still runs; a tap on every connection to the
// destination measures real output RMS.
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = process.argv[2] ?? 'http://localhost:5199/'
const OUT = process.argv[3] ?? fileURLToPath(new URL('../../test-results/browser', import.meta.url))
const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9333
mkdirSync(OUT, { recursive: true })
// A fresh profile per run means a cold HTTP cache, like a first-time visitor.
const PROFILE = mkdtempSync(join(tmpdir(), 'rr-smoke-profile-'))

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--window-size=1440,900',
  '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let version
for (let i = 0; i < 50 && !version; i++) {
  try { version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json() } catch { await sleep(200) }
}
const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json()
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))

let nextId = 1
const pending = new Map()
const consoleErrors = []
const failedRequests = []
const pianoRequests = []
const pianoRequestIds = new Set()
const pianoFinished = []
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id); pending.delete(msg.id)
    if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result)
    return
  }
  const p = msg.params
  if (msg.method === 'Runtime.consoleAPICalled' && (p.type === 'error' || p.type === 'warning')) {
    consoleErrors.push(`[console.${p.type}] ` + p.args.map((a) => a.value ?? a.description ?? '').join(' '))
  } else if (msg.method === 'Runtime.exceptionThrown') {
    consoleErrors.push('[exception] ' + (p.exceptionDetails.exception?.description ?? p.exceptionDetails.text))
  } else if (msg.method === 'Log.entryAdded' && p.entry.level === 'error') {
    consoleErrors.push(`[log.${p.entry.source}] ${p.entry.text} ${p.entry.url ?? ''}`)
  } else if (msg.method === 'Network.responseReceived' && /salamander/.test(p.response.url)) {
    // Headers only: the body may still be downloading.
    pianoRequests.push(`${p.response.status} ${p.response.url.split('/').pop()}`)
    pianoRequestIds.add(p.requestId)
  } else if (msg.method === 'Network.loadingFinished' && pianoRequestIds.has(p.requestId)) {
    pianoFinished.push(p.encodedDataLength)
  } else if (msg.method === 'Network.loadingFailed') {
    failedRequests.push(`${p.errorText} ${p.requestId}`)
  }
})
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++
  pending.set(id, { resolve, reject })
  ws.send(JSON.stringify({ id, method, params }))
})
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
  return r.result.value
}

// Tap every native connection to an AudioDestinationNode with an analyser.
const TAP = `(() => {
  window.__rr = { contexts: [], analysers: new Map() }
  const Native = window.AudioContext
  window.AudioContext = class extends Native {
    constructor(...args) { super(...args); window.__rr.contexts.push(this) }
  }
  // Record every buffer playback; piano samples are multi-second buffers.
  window.__rr.starts = []
  const start = AudioBufferSourceNode.prototype.start
  AudioBufferSourceNode.prototype.start = function (...args) {
    window.__rr.starts.push({ duration: this.buffer?.duration ?? null, when: args[0], now: this.context.currentTime })
    return start.apply(this, args)
  }
  const connect = AudioNode.prototype.connect
  AudioNode.prototype.connect = function (dest, ...rest) {
    const result = connect.call(this, dest, ...rest)
    if (dest instanceof AudioDestinationNode) {
      const ctx = dest.context
      let analyser = window.__rr.analysers.get(ctx)
      if (!analyser) { analyser = ctx.createAnalyser(); analyser.fftSize = 2048; window.__rr.analysers.set(ctx, analyser) }
      connect.call(this, analyser)
    }
    return result
  }
  window.__rrLevel = async (ms) => {
    let peak = 0, sumSq = 0, n = 0
    const end = performance.now() + ms
    while (performance.now() < end) {
      for (const analyser of window.__rr.analysers.values()) {
        const buf = new Float32Array(analyser.fftSize)
        analyser.getFloatTimeDomainData(buf)
        for (const v of buf) { peak = Math.max(peak, Math.abs(v)); sumSq += v * v; n++ }
      }
      await new Promise((r) => setTimeout(r, 40))
    }
    const states = window.__rr.contexts.map((c) => c.state + '@' + c.currentTime.toFixed(2))
    return { rms: n ? Math.sqrt(sumSq / n) : 0, peak, contexts: states }
  }
})()`

await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable'); await send('Network.enable')
await send('Page.addScriptToEvaluateOnNewDocument', { source: TAP })
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })

const shot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, 'base64'))
}
const waitFor = async (js, label, timeout = 20000) => {
  const end = Date.now() + timeout
  while (Date.now() < end) { if (await evaluate(js)) return; await sleep(150) }
  throw new Error(`timed out waiting for ${label}`)
}
// Real (trusted) mouse click on the element found by a JS expression.
const click = async (findJs, label, { hoverFirst = false } = {}) => {
  const box = await evaluate(`(() => { const el = ${findJs}; if (!el) return null; el.scrollIntoView({block:'center'});
    const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
  if (!box) throw new Error(`not found: ${label}`)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y })
  if (hoverFirst) await sleep(300)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 })
}
const byLabel = (label) => `document.querySelector('[aria-label="${label}"]')`
const byText = (tag, text) => `[...document.querySelectorAll('${tag}')].find((el) => el.textContent.trim().includes(${JSON.stringify(text)}))`
const level = (ms) => evaluate(`window.__rrLevel(${ms})`)

const results = []
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`) }
const SOUND = 0.003 // RMS clearly above silence (full mix)
const SOLO_SOUND = 0.0005 // one quiet channel; true silence measures exactly 0

// Engine probe: drive AudioEngine directly (no UI) with one Grand Piano track,
// once before the samples load and once after, counting real Sampler triggers.
if (process.env.RR_MODE === 'engine-probe') {
  try {
    await send('Page.navigate', { url: APP })
    await waitFor(`document.body && document.body.innerText.includes('Trap Heat')`, 'home screen')
    const report = await evaluate(`(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
      const audio = await import('/src/audio/index.ts')
      const sounds = await import('/src/audio/sounds.ts')
      const toneUrls = [...new Set(performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.includes('/.vite/deps/tone.js')))]
      const Tone = await import(toneUrls[0])
      const log = { toneUrls, attacks: 0, adds: 0, errors: [], loadedAtAttack: [] }
      const attack = Tone.Sampler.prototype.triggerAttack
      Tone.Sampler.prototype.triggerAttack = function (...args) {
        log.attacks++; log.loadedAtAttack.push(this._buffers._buffers.size)
        try { return attack.apply(this, args) } catch (e) { log.errors.push(String(e)); throw e }
      }
      const add = Tone.Sampler.prototype.add
      Tone.Sampler.prototype.add = function (...args) { log.adds++; return add.apply(this, args) }
      const pattern = { bpm: 120, loop: true, tracks: [{ id: 'piano', name: 'Piano', type: 'melody', muted: false, volumeDb: -6,
        sound: 'grand-piano', steps: [0, 4, 8, 12].map((step) => ({ step, notes: [{ pitch: 'C4', durationSteps: 3 }] })) }] }
      const engine = new audio.AudioEngine(pattern)
      const phase = async (name) => {
        const before = { attacks: log.attacks, adds: log.adds, starts: window.__rr.starts.length }
        await engine.play()
        const lv = await window.__rrLevel(2000)
        engine.stop()
        await sleep(300)
        const long = window.__rr.starts.slice(before.starts).filter((s) => s.duration > 0.05 && s.duration < 4).length
        return { name, attacks: log.attacks - before.attacks, adds: log.adds - before.adds, sampleStarts: long, rms: +lv.rms.toFixed(4) }
      }
      const cold = await phase('before samples load')
      sounds.preloadPiano()
      for (let i = 0; i < 100; i++) { await sleep(200); if (performance.getEntriesByType('resource').filter((e) => e.name.includes('salamander')).length >= 26) break }
      await sleep(1500)
      const warm = await phase('after samples load')
      engine.dispose()
      return { cold, warm, toneUrls: log.toneUrls, errors: log.errors.slice(0, 3) }
    })()`)
    console.log(JSON.stringify(report, null, 1))
    check('engine: piano is triggered and audible after loading', report.warm.attacks > 0 && report.warm.rms > 0.001, report.warm)
    check('engine: no Sampler errors', report.errors.length === 0, report.errors)
  } catch (error) {
    check('driver completed', false, String(error.message ?? error))
  }
  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failed}/${results.length} checks passed`)
  ws.close(); chrome.kill()
  process.exit(failed ? 1 : 0)
}

// Piano race: slow network so the 26 piano samples arrive over several seconds,
// then press Play right after choosing Grand Piano.
if (process.env.RR_MODE === 'piano-race') {
  try {
    await send('Page.navigate', { url: APP })
    await waitFor(`document.body && document.body.innerText.includes('Trap Heat')`, 'home screen', 60000)
    await click(byText('button', 'Trap Heat'), 'Trap Heat card')
    await waitFor(`!!${byLabel('Play')}`, 'studio play button')
    // Control: Retro Lead soloed with its default synth, before any piano.
    await click(byText('button', 'Channel Rack'), 'Channel Rack tab')
    await click(byLabel('Solo Retro Lead'), 'Solo Retro Lead')
    await click(byLabel('Play'), 'Play')
    const leadSynthAlone = await level(2000)
    await click(byLabel('Stop'), 'Stop')
    await click(byLabel('Solo Retro Lead'), 'Unsolo Retro Lead')
    check('control: soloed Retro Lead (default synth) is audible', leadSynthAlone.rms > SOLO_SOUND, { rms: +leadSynthAlone.rms.toFixed(4) })
    await click(byText('button', 'Piano Roll'), 'Piano Roll tab')
    await waitFor(`!!document.querySelector('[aria-label="Instrument"]')`, 'instrument picker')
    // Throttle only now, so Vite's own module loading isn't slowed.
    await send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 120_000, uploadThroughput: 120_000 })
    const errorsBefore = consoleErrors.length
    await click(`[...document.querySelectorAll('[aria-label="Instrument"] [role="radio"]')].find((b) => /piano/i.test(b.innerText))`, 'Grand Piano')
    // Record the LCD step on every animation frame; polling over CDP is slower than a 16th note.
    await evaluate(`(() => { window.__steps = new Set(); window.__rec = true;
      const tick = () => { const m = document.body.innerText.match(/STEP\\s+(\\d+)\\s*\\/\\s*\\d+/); if (m) window.__steps.add(m[1]);
        if (window.__rec) requestAnimationFrame(tick) }; tick() })()`)
    const pianoChosenAt = Date.now()
    await click(byLabel('Play'), 'Play')
    const samplesAtPlay = pianoFinished.length
    const { rms } = await level(5000)
    const steps = new Set(await evaluate(`(window.__rec = false, [...window.__steps])`))
    const loadedDuringWindow = pianoFinished.length
    const windowErrors = consoleErrors.slice(errorsBefore)
    check('no exceptions while piano samples load', windowErrors.length === 0, { exceptions: windowErrors.length, first: windowErrors[0]?.split('\n')[0], samplesAtPlay, samplesAfter5s: loadedDuringWindow })
    check('playhead visits every step while piano loads', steps.size === 16, { distinctSteps: steps.size })
    check('other tracks keep sounding while piano loads', rms > SOUND, { maxRms: +rms.toFixed(4) })
    // Once every sample is in, the piano itself must play.
    const end = Date.now() + 240000
    while (pianoFinished.length < 26 && Date.now() < end) await sleep(500)
    console.log(`piano samples fully downloaded: ${pianoFinished.length}/26, ${(pianoFinished.reduce((a, b) => a + b, 0) / 1e6).toFixed(2)} MB, ${((Date.now() - pianoChosenAt) / 1000).toFixed(1)} s after choosing Grand Piano`)
    await sleep(1500)
    await click(byLabel('Stop'), 'Stop')
    await click(byText('button', 'Retro Lead'), 'Retro Lead channel').catch(() => {})
    await click(byLabel('Play'), 'Play')
    const errorsBeforeLoaded = consoleErrors.length
    const loaded = await level(2500)
    await click(byLabel('Stop'), 'Stop')
    check('after loading, playback is clean and audible', consoleErrors.length === errorsBeforeLoaded && loaded.rms > SOUND,
      { samples: pianoRequests.length, rms: +loaded.rms.toFixed(4), newErrors: consoleErrors.length - errorsBeforeLoaded })
    // Solo the piano channel: whatever is audible now is the Sampler alone.
    await click(byText('button', 'Channel Rack'), 'Channel Rack tab')
    // Probe the app's own Tone module instance (same URL => same module).
    console.log('probe:', await evaluate(`(async () => {
      const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes('/.vite/deps/tone.js'))
      const Tone = await import(url)
      const log = window.__rr.sampler = { attacks: 0, adds: 0, errors: [], bufferCounts: new Set() }
      const attack = Tone.Sampler.prototype.triggerAttack
      Tone.Sampler.prototype.triggerAttack = function (...args) {
        log.attacks++; log.bufferCounts.add(this._buffers._buffers.size + ':' + this.loaded)
        try { return attack.apply(this, args) } catch (e) { log.errors.push(String(e)); throw e }
      }
      const add = Tone.Sampler.prototype.add
      Tone.Sampler.prototype.add = function (...args) { log.adds++; return add.apply(this, args) }
      return url
    })()`))
    await click(byLabel('Solo Retro Lead'), 'Solo Retro Lead')
    await evaluate(`window.__rr.starts.length = 0`)
    await click(byLabel('Play'), 'Play')
    const pianoAlone = await level(3000)
    await shot('solo-playing')
    const starts =await evaluate(`window.__rr.starts.map((s) => [s.duration && +s.duration.toFixed(2), +(s.when - s.now).toFixed(3)])`)
    console.log('buffer starts while piano soloed [duration s, when - now s]:', JSON.stringify(starts.filter((s) => s[0] > 0.05).slice(0, 8)), 'long:', starts.filter((s) => s[0] > 0.05).length, 'total', starts.length)
    console.log('sampler probe:', await evaluate(`JSON.stringify({ ...window.__rr.sampler, bufferCounts: [...window.__rr.sampler.bufferCounts] })`))
    await click(byLabel('Stop'), 'Stop')
    await click(byLabel('Solo Retro Lead'), 'Unsolo Retro Lead')
    check('soloed Grand Piano is audible on its own', pianoAlone.rms > SOLO_SOUND, { rms: +pianoAlone.rms.toFixed(4), peak: +pianoAlone.peak.toFixed(3) })
    // Control: the solo measurement itself works on a plain synth channel.
    await click(byLabel('Solo Sub 808'), 'Solo Sub 808')
    await click(byLabel('Play'), 'Play')
    const bassAlone = await level(2000)
    await click(byLabel('Stop'), 'Stop')
    await click(byLabel('Solo Sub 808'), 'Unsolo Sub 808')
    check('control: soloed Sub 808 is audible', bassAlone.rms > SOLO_SOUND, { rms: +bassAlone.rms.toFixed(4) })
    await click(byText('button', 'Piano Roll'), 'Piano Roll tab')
    await sleep(300)
    console.log('piano roll state:', await evaluate(`JSON.stringify({
      header: (document.body.innerText.match(/PIANO ROLL[^\\n]*/) || [])[0],
      channel: [...document.querySelectorAll('[aria-label="Piano roll channel"] [role="tab"], [aria-label="Piano roll channel"] button')].map((b) => b.innerText.trim() + (b.getAttribute('aria-selected') === 'true' ? '*' : '')),
      instrument: [...document.querySelectorAll('[aria-label="Instrument"] [role="radio"][aria-checked="true"]')].map((b) => b.innerText.trim()),
    })`))
    await shot('race-pianoroll-end')
    await shot('race-final')
  } catch (error) {
    check('driver completed', false, String(error.message ?? error))
  }
  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failed}/${results.length} checks passed`)
  ws.close(); chrome.kill()
  process.exit(failed ? 1 : 0)
}

try {
  await send('Page.navigate', { url: APP })
  await waitFor(`document.body && document.body.innerText.includes('Trap Heat')`, 'home screen')
  const cards = await evaluate(`[...document.querySelectorAll('button')].map((b) => b.innerText.replace(/\\s+/g, ' ').trim()).filter(Boolean)`)
  check('home screen lists demo projects', ['Trap Heat', 'House Party', 'Night Drive', 'Study Beats'].every((n) => cards.some((c) => c.includes(n))), cards)
  await shot('01-home')

  await click(byText('button', 'Trap Heat'), 'Trap Heat card')
  await waitFor(`!!${byLabel('Play')}`, 'studio play button')
  await shot('02-studio-trap-heat')
  await click(byLabel('Pattern playback mode'), 'PAT mode')

  for (let i = 1; i <= 5; i++) {
    await click(byLabel('Play'), 'Play')
    const playing = await level(1500)
    await click(byLabel('Stop'), 'Stop')
    await sleep(700)
    const stopped = await level(500)
    check(`PAT play/stop cycle ${i}`, playing.rms > SOUND && stopped.rms < playing.rms / 10,
      { playingRms: +playing.rms.toFixed(4), peak: +playing.peak.toFixed(3), stoppedRms: +stopped.rms.toFixed(5), ctx: playing.contexts })
  }

  await click(byLabel('Song playback mode'), 'SONG mode')
  await click(byLabel('Play'), 'Play')
  const song = await level(3000)
  await shot('03-song-playing')
  await click(byLabel('Stop'), 'Stop')
  check('SONG mode plays', song.rms > SOUND, { rms: +song.rms.toFixed(4), peak: +song.peak.toFixed(3) })
  await click(byLabel('Pattern playback mode'), 'PAT mode')

  await click(byText('button', 'Piano Roll'), 'Piano Roll tab')
  await waitFor(`!!document.querySelector('[role="radiogroup"][aria-label="Instrument"]')`, 'instrument picker')
  const instruments = await evaluate(`[...document.querySelectorAll('[aria-label="Instrument"] [role="radio"]')].map((b) => b.innerText.trim())`)
  await click(`[...document.querySelectorAll('[aria-label="Instrument"] [role="radio"]')].find((b) => /piano/i.test(b.innerText))`, 'Grand Piano', { hoverFirst: true })
  await sleep(500)
  const checked = await evaluate(`[...document.querySelectorAll('[aria-label="Instrument"] [role="radio"][aria-checked="true"]')].map((b) => b.innerText.trim())`)
  check('Grand Piano selectable in piano roll', checked.some((t) => /piano/i.test(t)), { instruments, checked })
  await waitFor(`true`, 'noop')
  const pianoDeadline = Date.now() + 20000
  while (pianoRequests.length === 0 && Date.now() < pianoDeadline) await sleep(250)
  await sleep(2500)
  check('Salamander piano samples downloaded', pianoRequests.length > 0 && pianoRequests.every((r) => r.startsWith('200')), pianoRequests.slice(0, 6))
  await click(byLabel('Play'), 'Play')
  const piano = await level(2500)
  await shot('04-piano-roll-grand-piano')
  await click(byLabel('Stop'), 'Stop')
  check('pattern plays with Grand Piano selected', piano.rms > SOUND, { rms: +piano.rms.toFixed(4) })

  await click(byLabel('Home'), 'Home')
  await waitFor(`document.body.innerText.includes('House Party') && !${byLabel('Play')}`, 'home again')
  await click(byText('button', 'House Party'), 'House Party card')
  await waitFor(`!!${byLabel('Play')}`, 'studio for House Party')
  await click(byLabel('Play'), 'Play')
  const house = await level(1500)
  await click(byLabel('Stop'), 'Stop')
  await shot('05-house-party')
  check('second project opens and plays', house.rms > SOUND, { rms: +house.rms.toFixed(4), ctx: house.contexts })

  await click(byLabel('Home'), 'Home')
  await waitFor(`document.body.innerText.includes('Trap Heat') && !${byLabel('Play')}`, 'home again')
  await click(byText('button', 'Trap Heat'), 'Trap Heat card')
  await waitFor(`!!${byLabel('Play')}`, 'studio reopened')
  const checkedAfter = await evaluate(`document.body.innerText.toLowerCase().includes('piano roll')`)
  check('reopening a project from home works', checkedAfter, {})
} catch (error) {
  check('driver completed', false, String(error.message ?? error))
  await shot('99-failure').catch(() => {})
} finally {
  console.log('\n--- console errors/warnings ---')
  console.log(consoleErrors.length ? consoleErrors.join('\n') : '(none)')
  console.log('--- failed network requests ---')
  console.log(failedRequests.length ? failedRequests.join('\n') : '(none)')
  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failed}/${results.length} checks passed; screenshots in ${OUT}`)
  ws.close(); chrome.kill()
  process.exit(failed ? 1 : 0)
}
