import { CONVEX_URL } from './environment.mjs'
// Two-browser collaboration test for the Convex-backed app (development deployment only).
// One headless Chrome, two isolated browser contexts = two independent users.
// Usage: node tests/browser/collab.mjs [appUrl]   (reads VITE_CONVEX_URL from ../.env.local)
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ConvexHttpClient } from 'convex/browser'
import { anyApi } from 'convex/server'

const APP = process.argv[2] ?? 'http://localhost:5199/'
const OUT = fileURLToPath(new URL('../../test-results/browser', import.meta.url))
const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9334
mkdirSync(OUT, { recursive: true })
const convex = new ConvexHttpClient(CONVEX_URL)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'rr-collab-'))}`,
  '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' })
let version
for (let i = 0; i < 50 && !version; i++) {
  try { version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json() } catch { await sleep(200) }
}
const ws = new WebSocket(version.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let nextId = 1
const pending = new Map()
const pages = new Map() // sessionId -> page
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id); pending.delete(msg.id)
    if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result)
    return
  }
  const page = pages.get(msg.sessionId)
  if (!page) return
  const p = msg.params
  if (msg.method === 'Runtime.consoleAPICalled' && (p.type === 'error' || p.type === 'warning')) {
    page.errors.push(`[console.${p.type}] ` + p.args.map((a) => a.value ?? a.description ?? '').join(' '))
  } else if (msg.method === 'Runtime.exceptionThrown') {
    page.errors.push('[exception] ' + (p.exceptionDetails.exception?.description ?? p.exceptionDetails.text))
  } else if (msg.method === 'Page.javascriptDialogOpening') {
    page.dialogs.push(p.defaultPrompt || p.message)
    void page.send('Page.handleJavaScriptDialog', { accept: true })
  }
})
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = nextId++
  pending.set(id, { resolve, reject })
  ws.send(JSON.stringify({ id, method, params, sessionId }))
})

const TAP = `(() => {
  window.__rr = { analysers: new Map() }
  const connect = AudioNode.prototype.connect
  AudioNode.prototype.connect = function (dest, ...rest) {
    const result = connect.call(this, dest, ...rest)
    if (dest instanceof AudioDestinationNode) {
      let analyser = window.__rr.analysers.get(dest.context)
      if (!analyser) { analyser = dest.context.createAnalyser(); window.__rr.analysers.set(dest.context, analyser) }
      connect.call(this, analyser)
    }
    return result
  }
  window.__rrLevel = async (ms) => {
    let sumSq = 0, n = 0
    const end = performance.now() + ms
    while (performance.now() < end) {
      for (const a of window.__rr.analysers.values()) {
        const buf = new Float32Array(a.fftSize); a.getFloatTimeDomainData(buf)
        for (const v of buf) { sumSq += v * v; n++ }
      }
      await new Promise((r) => setTimeout(r, 40))
    }
    return n ? Math.sqrt(sumSq / n) : 0
  }
})()`

async function openPage(name) {
  const { browserContextId } = await send('Target.createBrowserContext')
  const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const page = {
    name, errors: [], dialogs: [],
    send: (method, params) => send(method, params, sessionId),
    async eval(expression) {
      const r = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (r.exceptionDetails) throw new Error(`${name}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`)
      return r.result.value
    },
    async waitFor(js, label, timeout = 15000) {
      const end = Date.now() + timeout
      while (Date.now() < end) { if (await page.eval(js)) return; await sleep(100) }
      throw new Error(`${name}: timed out waiting for ${label}`)
    },
    async click(findJs, label) {
      const box = await page.eval(`(() => { const el = ${findJs}; if (!el) return null; el.scrollIntoView({block:'center'});
        const r = el.getBoundingClientRect(); const x = r.x + r.width / 2, y = r.y + r.height / 2;
        const hit = document.elementFromPoint(x, y);
        return { x, y, reachable: el.contains(hit), hit: hit?.closest('button')?.getAttribute('aria-label') ?? hit?.tagName } })()`)
      if (!box) throw new Error(`${name}: not found: ${label}`)
      if (!box.reachable) throw new Error(`${name}: ${label} is covered by ${box.hit} at ${box.x},${box.y}`)
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
        await page.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 })
      }
    },
    async shot(file) {
      const { data } = await page.send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(join(OUT, `${file}.png`), Buffer.from(data, 'base64'))
    },
    goto: (url) => page.send('Page.navigate', { url }),
  }
  pages.set(sessionId, page)
  await page.send('Page.enable'); await page.send('Runtime.enable')
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: TAP })
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'], browserContextId, origin: new URL(APP).origin })
  return page
}

const byLabel = (label) => `document.querySelector('[aria-label="${label}"]')`
const byText = (tag, text) => `[...document.querySelectorAll('${tag}')].find((el) => el.textContent.trim().includes(${JSON.stringify(text)}))`
const pressed = (label) => `${byLabel(label)}?.getAttribute('aria-pressed') === 'true'`
const bpmOf = (page) => page.eval(`Number(${byLabel('Tempo BPM')}.value)`)
const saveStatus = (page) => page.eval(`${byLabel('Save status')}?.innerText.trim()`)
const inStudio = `!!${byLabel('Play')}`
const serverProject = (id) => convex.query(anyApi.projects.get, { id })

const results = []
const check = (name, ok, detail = {}) => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`) }
/** Waits until a condition holds on a page, returning how long it took (ms), or null on timeout. */
async function syncTime(page, js, timeout = 5000) {
  const start = Date.now()
  try { await page.waitFor(js, js, timeout); return Date.now() - start } catch { return null }
}

const A = await openPage('A')
const B = await openPage('B')
try {
  // Home screen comes from Convex (demo projects are seeded into an empty database).
  await A.goto(APP)
  await A.waitFor(`document.body.innerText.includes('Trap Heat')`, 'home screen with demos', 30000)
  const before = await convex.query(anyApi.projects.list, {})
  check('home screen lists projects stored in Convex', before.length >= 4, { projects: before.length })

  // A creates a project; its URL is the share link.
  await A.click(byText('button', 'New project'), 'New project')
  await A.waitFor(inStudio, 'studio for new project')
  const id = new URLSearchParams(await A.eval('location.search')).get('project')
  const created = await serverProject(id)
  check('new project is saved in Convex and opened by its link', !!created && (await A.eval('location.search')).includes(id), { id, name: created?.name })

  // B opens the same link.
  const link = new URL(`?project=${id}`, APP).href
  await B.goto(link)
  await B.waitFor(inStudio, 'studio from share link', 30000)
  // The header shows the name in CSS uppercase, which innerText reflects.
  check('second browser opens the project from the share link',
    (await B.eval('document.body.innerText')).toLowerCase().includes(created.name.toLowerCase()), { link })
  for (const page of [A, B]) await page.click(byText('button', 'Channel Rack'), 'Channel Rack tab')

  // A -> B: a step toggle.
  await A.click(byLabel('Kick 808 step 3'), 'kick step 3')
  const stepMs = await syncTime(B, pressed('Kick 808 step 3'))
  check('step toggled in A appears in B', stepMs !== null, { ms: stepMs })

  // B -> A: tempo.
  const bpm0 = await bpmOf(B)
  for (let i = 0; i < 2; i++) await B.click(`${byLabel('Tempo BPM')}.nextElementSibling`, 'BPM +')
  const bpmMs = await syncTime(A, `Number(${byLabel('Tempo BPM')}.value) === ${bpm0 + 2}`)
  check('tempo changed in B appears in A', bpmMs !== null, { from: bpm0, to: bpm0 + 2, ms: bpmMs })

  // Simultaneous edits to different parts: A's drums and B's mixer must both survive.
  await B.click(byText('button', 'Mixer'), 'Mixer tab')
  await B.waitFor(`!!${byLabel('Mute mixer Snare/Clap')}`, 'mixer')
  await Promise.all([
    A.click(byLabel('Snare Gritty step 5'), 'snare step 5'),
    B.click(byLabel('Mute mixer Snare/Clap'), 'mute Snare/Clap'),
  ])
  await sleep(2000)
  const afterBoth = await serverProject(id)
  const snareOn = afterBoth.data.stepData[1].snare[4] === 1
  const muted = afterBoth.data.mixerTracks.find((t) => t.name === 'Snare/Clap').mute === true
  check('simultaneous edits from both browsers are both saved', snareOn && muted, { snareStep5: snareOn, snareBusMuted: muted })
  const aSeesMute = await (async () => { await A.click(byText('button', 'Mixer'), 'Mixer tab'); return A.eval(pressed('Mute mixer Snare/Clap')) })()
  const bSeesSnare = await (async () => { await B.click(byText('button', 'Channel Rack'), 'Channel Rack tab'); return B.eval(pressed('Snare Gritty step 5')) })()
  check('...and both browsers show both edits', aSeesMute && bSeesSnare, { aSeesMute, bSeesSnare })
  await A.click(byText('button', 'Channel Rack'), 'Channel Rack tab')

  // Both drum at once: different channels' steps in the same pattern, clicked together.
  // RR_STRESS=1: 32 rounds on steps 17-48, past the end of the stored 16-step arrays.
  const jamSteps = process.env.RR_STRESS ? Array.from({ length: 32 }, (_, i) => 17 + i) : [9, 11, 13, 15]
  const jam = jamSteps.flatMap((step) => [['Kick 808', step], ['Hi-Hat Closed', step]])
  const clicked = []
  for (let round = 0; round < jam.length / 2; round++) {
    const [[aCh, aStep], [bCh, bStep]] = [jam[round * 2], jam[round * 2 + 1]]
    await Promise.all([A.click(byLabel(`${aCh} step ${aStep}`), 'A step'), B.click(byLabel(`${bCh} step ${bStep}`), 'B step')])
    clicked.push(await A.eval(pressed(`${aCh} step ${aStep}`)), await B.eval(pressed(`${bCh} step ${bStep}`)))
  }
  await sleep(2000)
  const jammed = (await serverProject(id)).data.stepData[1]
  const serverHas = jam.map(([ch, step]) => (ch === 'Kick 808' ? jammed.kick : jammed.hat_closed)[step - 1] === 1)
  const aHas = await Promise.all(jam.map(([ch, step]) => A.eval(pressed(`${ch} step ${step}`))))
  const bHas = await Promise.all(jam.map(([ch, step]) => B.eval(pressed(`${ch} step ${step}`))))
  check('two people clicking steps at the same moment keep all their steps', [...serverHas, ...aHas, ...bHas].every(Boolean), { clicked, serverHas, aHas, bHas })

  // Playback in B keeps going while A edits.
  await B.click(byLabel('Play'), 'B Play')
  await sleep(500)
  const errorsBefore = B.errors.length
  // Record B's playhead every frame while A edits.
  await B.eval(`(() => { window.__steps = new Set(); window.__rec = true;
    const tick = () => { const m = document.body.innerText.match(/STEP\\s+(\\d+)\\s*\\/\\s*\\d+/); if (m) window.__steps.add(m[1]);
      if (window.__rec) requestAnimationFrame(tick) }; tick() })()`)
  // Patterns can be several bars with beats only in some, so listen across one whole loop
  // while A makes three edits spread over it.
  const playing = await serverProject(id)
  const loopMs = Math.round((playing.data.patternSteps?.[1] ?? 64) * 60000 / playing.data.bpm / 4) + 500
  const levelDuringEdits = B.eval(`window.__rrLevel(${loopMs})`)
  for (const step of [7, 11, 15]) {
    await A.click(byLabel(`Hi-Hat Open step ${step}`), `open hat step ${step}`)
    await sleep(loopMs / 4)
  }
  const levels = [await levelDuringEdits]
  const steps = await B.eval('(window.__rec = false, window.__steps.size)')
  const synced = await syncTime(B, pressed('Hi-Hat Open step 15'))
  const stillPlaying = (await B.eval('document.body.innerText')).includes('AUDIO: PLAYING')
  await B.click(byLabel('Stop'), 'B Stop')
  check('playback in B continues while A edits', levels.every((l) => l > 0.001) && steps === 16 && stillPlaying && synced !== null && B.errors.length === errorsBefore,
    { rms: levels.map((l) => +l.toFixed(4)), playheadSteps: steps, stillPlaying, newErrors: B.errors.length - errorsBefore })

  // No save loop: with nobody editing, the project's version stays put and both show Saved.
  await sleep(1500)
  const v1 = (await serverProject(id)).version
  await sleep(4000)
  const v2 = (await serverProject(id)).version
  const badges = [await saveStatus(A), await saveStatus(B)]
  check('idle browsers do not keep saving (no echo loop)', v1 === v2 && badges.every((b) => /saved/i.test(b)), { version: [v1, v2], badges })

  // Reload keeps everything.
  await A.send('Page.reload')
  await A.waitFor(inStudio, 'studio after reload', 30000)
  await A.click(byText('button', 'Channel Rack'), 'Channel Rack tab')
  const kept = { kick3: await A.eval(pressed('Kick 808 step 3')), snare5: await A.eval(pressed('Snare Gritty step 5')), bpm: await bpmOf(A) }
  check('edits survive a page reload', kept.kick3 && kept.snare5 && kept.bpm === bpm0 + 2, kept)

  // Share button copies the project link.
  await A.click(byLabel('Copy share link'), 'Share')
  await sleep(400)
  const shareText = await A.eval(`${byLabel('Copy share link')}.innerText.trim()`)
  const copied = await A.eval('navigator.clipboard.readText().catch(() => null)')
  const shared = copied ?? A.dialogs.at(-1)
  check('Share copies the project link', shared === link, { shared, button: shareText })

  // Back returns home, Forward returns to the project.
  await A.eval('history.back()')
  await A.waitFor(`!${byLabel('Play')} && document.body.innerText.includes('Trap Heat')`, 'home after Back')
  const listed = (await A.eval('document.body.innerText')).includes(created.name)
  await A.eval('history.forward()')
  await A.waitFor(inStudio, 'studio after Forward')
  check('Back/Forward move between home and the project', listed, { newProjectOnHome: listed })

  // A bad link explains itself instead of crashing.
  await B.goto(new URL('?project=not-a-real-id', APP).href)
  await B.waitFor(`document.body.innerText.includes("doesn't exist")`, 'missing-project message')
  await B.click(byText('button', 'Back to projects'), 'Back to projects')
  await B.waitFor(`document.body.innerText.includes('Trap Heat')`, 'home from missing project')
  check('a bad project link shows a message and a way home', true)

  await A.shot('collab-A'); await B.shot('collab-B')
} catch (error) {
  check('driver completed', false, { error: String(error.message ?? error) })
  await A.shot('collab-A-failure').catch(() => {}); await B.shot('collab-B-failure').catch(() => {})
} finally {
  for (const page of [A, B]) {
    check(`no console errors or warnings in ${page.name}`, page.errors.length === 0, { errors: page.errors.slice(0, 3).map((e) => e.split('\n')[0]) })
  }
  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failed}/${results.length} checks passed`)
  ws.close(); chrome.kill()
  process.exit(failed ? 1 : 0)
}
