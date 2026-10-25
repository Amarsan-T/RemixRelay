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
const PORT = 9336
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
        const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
      if (!box) throw new Error(`${name}: not found: ${label}`)
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
const inStudio = `!!${byLabel('Play')}`

// ---- Chat UI checks (Development only) ----
const WITH_CLAUDE = process.argv.includes('--with-claude')
const results = []
const check = (name, ok, detail = {}) => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`) }
const chatText = (page) => page.eval(`document.querySelector('[aria-label="AI chat"]')?.innerText ?? ''`)
// Messages only: the empty chat's starter block is not a message.
const bubbles = (page) => page.eval(`[...document.querySelectorAll('[aria-label="AI chat"] [aria-live] > *')].map((n) => n.innerText.trim()).filter((t) => !t.startsWith('Ask Claude about this song'))`)
async function openChat(page) {
  await page.click(byLabel('Open AI chat'), 'Open AI chat')
  await page.waitFor(`!!document.querySelector('[aria-label="AI chat"]')`, 'chat panel')
  await page.waitFor(`!document.querySelector('[aria-label="AI chat"]').innerText.includes('Loading the conversation')`, 'chat loaded')
}
async function type(page, text) {
  await page.click(byLabel('Message Claude'), 'message box')
  await page.send('Input.insertText', { text })
}
const settled = (page, timeout = 90000) => page.waitFor(`!document.querySelector('[aria-label="AI chat"] [role="status"]')`, 'reply settled', timeout)

const stamp = new Date().toISOString().slice(11, 19)
const data = { bpm: 101, loop: true, metronome: false, channels: [], stepData: { 1: {} }, pianoNotes: { 1: {} }, mixerTracks: [{ id: 0, name: 'Master', vol: 0.85 }], song: { bars: 4, trackCount: 1, clips: [] }, patternCount: 1 }
const P = await convex.mutation(anyApi.projects.create, { name: `Chat UI ${stamp}`, color: '#1ea7f2', data })
const Q = await convex.mutation(anyApi.projects.create, { name: `Chat UI other ${stamp}`, color: '#8fd97f', data: { ...data, bpm: 77 } })
const link = (id) => new URL(`?project=${id}`, APP).href

const A = await openPage('A')
const B = await openPage('B')
try {
  await A.goto(link(P))
  await A.waitFor(inStudio, 'studio', 30000)
  check('the studio shows an AI Chat button', await A.eval(`!!${byLabel('Open AI chat')}`))
  await openChat(A)
  const empty = await chatText(A)
  check('an empty chat offers starter questions and the sharing note', /Piano Roll or the Channel Rack/.test(empty) && /Everyone with this project's link can see this chat/.test(empty))

  const question = WITH_CLAUDE ? 'What tempo is my project, in BPM? Answer with the number.' : 'Hello Claude'
  await type(A, question)
  await A.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await A.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await A.waitFor(`document.querySelector('[aria-label="AI chat"]').innerText.includes(${JSON.stringify(question)})`, 'own message shown')
  const sawThinking = await A.eval(`!!document.querySelector('[aria-label="AI chat"] [role="status"]')`)
  const sendDisabled = await A.eval(`${byLabel('Send message')}.disabled`)
  await settled(A)
  const afterReply = await bubbles(A)
  if (WITH_CLAUDE) {
    check("Claude's real reply appears and uses the project (101 BPM)", /101/.test(afterReply.at(-1) ?? ''), { reply: (afterReply.at(-1) ?? '').slice(0, 160) })
  } else {
    check('Enter sends; the reply shows Thinking, then a clear error with Retry', sawThinking && /isn't set up/.test(afterReply.at(-1) ?? '') && /Retry/.test(afterReply.at(-1) ?? ''),
      { sawThinking, last: afterReply.at(-1) })
  }
  check('the Send button is disabled while Claude answers or the box is empty', sendDisabled === true)

  // Persistence: reload and reopen.
  await A.send('Page.reload')
  await A.waitFor(inStudio, 'studio after reload', 30000)
  await openChat(A)
  const reloaded = await bubbles(A)
  check('the conversation is still there after a reload', reloaded.length === afterReply.length && reloaded[0] === question, { count: reloaded.length })

  // Shared project: another browser sees the same chat. Another project has its own.
  await B.goto(link(P))
  await B.waitFor(inStudio, 'studio in B', 30000)
  await openChat(B)
  check('another browser with the link sees the same conversation', JSON.stringify(await bubbles(B)) === JSON.stringify(reloaded))
  await B.goto(link(Q))
  await B.waitFor(inStudio, 'other project', 30000)
  await openChat(B)
  check("a different project's chat is empty", (await bubbles(B)).length === 0 && /starter|Piano Roll or the Channel Rack/.test(await chatText(B)))

  if (WITH_CLAUDE) {
    await type(A, 'Thanks! What tempo did you just tell me? Reply with the number only.')
    await A.click(byLabel('Send message'), 'Send')
    await A.waitFor(`document.querySelectorAll('[aria-label="AI chat"] [aria-live] > *').length >= 4`, 'second exchange')
    await settled(A)
    check('Claude continues the conversation with memory of the earlier answer', /101/.test((await bubbles(A)).at(-1) ?? ''), { reply: ((await bubbles(A)).at(-1) ?? '').slice(0, 120) })
  } else {
    // Retry from the UI goes back to Thinking and fails the same way, without a new message.
    const before = (await bubbles(A)).length
    await A.click(`[...document.querySelectorAll('[aria-label="AI chat"] button')].find((b) => b.innerText.includes('Retry'))`, 'Retry')
    await settled(A)
    check('Retry reuses the failed reply instead of adding messages', (await bubbles(A)).length === before)
  }

  // Too long: the counter warns and Send stays disabled.
  await type(A, 'x'.repeat(2001))
  await sleep(200)
  check('an over-long message is flagged and cannot be sent', /Too long: 2001\/2000/.test(await chatText(A)) && await A.eval(`${byLabel('Send message')}.disabled`))
  const beforeEnter = (await convex.query(anyApi.chat.list, { projectId: P })).length
  await A.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await A.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await sleep(300)
  check('Enter also rejects over-long messages without creating a turn', (await convex.query(anyApi.chat.list, { projectId: P })).length === beforeEnter)

  // Nothing the browser loads contains a Claude key or the Anthropic SDK.
  const leaks = await A.eval(`(async () => {
    const urls = [...new Set(performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.startsWith(location.origin) && /\\.(m?js|ts|tsx)(\\?|$)/.test(n)))]
    let hits = []
    for (const url of urls) { const t = await (await fetch(url)).text(); if (/sk-ant-|ANTHROPIC_API_KEY|@anthropic-ai\\/sdk|api\\.anthropic\\.com/.test(t)) hits.push(url) }
    return { scanned: urls.length, hits }
  })()`)
  check('no script loaded by the browser contains a Claude key, the key name, or the Anthropic SDK', leaks.hits.length === 0 && leaks.scanned > 10, leaks)
  await A.shot('chat-A'); await B.shot('chat-B')
} catch (error) {
  check('driver completed', false, { error: String(error.message ?? error) })
  await A.shot('chat-A-failure').catch(() => {})
} finally {
  for (const page of [A, B]) check(`no console errors or warnings in ${page.name}`, page.errors.length === 0, { errors: page.errors.slice(0, 3).map((e) => e.split('\n')[0]) })
  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failed}/${results.length} checks passed`)
  ws.close(); chrome.kill()
  process.exit(failed ? 1 : 0)
}
