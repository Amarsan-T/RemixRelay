import { test, expect } from '@playwright/test'
import { ConvexHttpClient } from 'convex/browser'
import { anyApi } from 'convex/server'

// Hold only these test browsers' saves. Queries stay live, so the second client
// must merge the first server update while its own different step is pending.
async function saveGate(context) {
  const gate = { hold: false, pending: [], batches: [], release() {
    this.hold = false
    for (const entry of this.pending.splice(0)) entry.server.send(entry.message)
  } }
  await context.routeWebSocket(/ws:\/\/127\.0\.0\.1:\d+\//, socket => {
    const server = socket.connectToServer()
    socket.onMessage(message => {
      const value = JSON.parse(String(message))
      if (value.type === 'Mutation' && value.udfPath.replace('.js:', ':') === 'projects:save') {
        gate.batches.push(value.args[0].changes.length)
        if (gate.hold) { gate.pending.push({ server, message }); return }
      }
      server.send(message)
    })
    server.onMessage(message => socket.send(message))
  })
  return gate
}
function localClient() {
  const url = process.env.REMIXRELAY_E2E_CONVEX_URL
  if (!url || !/^http:\/\/127\.0\.0\.1:\d+$/.test(url)) throw new Error('Anonymous loopback Convex only; cloud access forbidden')
  return new ConvexHttpClient(url)
}
const step = (page, number) => page.getByRole('button', { name: `Kick 808 step ${number}`, exact: true })

for (const [first, aStep, bStep] of [['a', 2, 3], ['b', 2, 3], ['a', 21, 24], ['b', 21, 24]]) {
  test(`same channel: stale clients keep steps ${aStep}/${bStep}, ${first} saves first`, async ({ page, browser }, info) => {
    test.skip(!info.config.metadata.syncOrigin, 'Requires the anonymous local Convex runner')
    const client = localClient()
    const a = await saveGate(page.context())
    const second = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    const b = await saveGate(second)
    const peer = await second.newPage()
    try {
      await page.goto(info.config.metadata.syncOrigin)
      await page.getByRole('button', { name: 'New project', exact: true }).click()
      await expect(page.getByLabel('Tempo BPM')).toBeVisible()
      const url = page.url(), id = new URL(url).searchParams.get('project')
      await peer.goto(url)
      await expect(peer.getByLabel('Tempo BPM')).toBeVisible()
      a.hold = b.hold = true
      await Promise.all([step(page, aStep).click(), step(peer, bStep).click()])
      await expect.poll(() => a.pending.length).toBe(1)
      await expect.poll(() => b.pending.length).toBe(1)
      const firstGate = first === 'a' ? a : b, lastGate = first === 'a' ? b : a
      const firstStep = first === 'a' ? aStep : bStep
      firstGate.release()
      await expect.poll(async () => (await client.query(anyApi.projects.get, { id })).data.stepData[1].kick[firstStep - 1]).toBe(1)
      lastGate.release()
      for (const p of [page, peer]) {
        await expect(step(p, aStep)).toHaveAttribute('aria-pressed', 'true')
        await expect(step(p, bStep)).toHaveAttribute('aria-pressed', 'true')
        await expect(p.getByLabel('Save status')).toHaveText('Saved')
      }
      await Promise.all([page.reload(), peer.reload()])
      for (const p of [page, peer]) {
        await expect(step(p, aStep)).toHaveAttribute('aria-pressed', 'true')
        await expect(step(p, bStep)).toHaveAttribute('aria-pressed', 'true')
      }
      const stored = (await client.query(anyApi.projects.get, { id })).data.stepData[1].kick
      expect(stored[aStep - 1]).toBe(1)
      expect(stored[bStep - 1]).toBe(1)
    } finally { a.release(); b.release(); await second.close() }
  })
}

test('clearing a dense 256-step pattern batches atomic saves without losing edits', async ({ page }, info) => {
  test.skip(!info.config.metadata.syncOrigin, 'Requires the anonymous local Convex runner')
  const client = localClient(), gate = await saveGate(page.context())
  await page.goto(info.config.metadata.syncOrigin)
  const data = await page.evaluate(async () => {
    const { createStudioProject } = await import('/src/studio/data.ts')
    const p = createStudioProject(null)
    p.patternSteps = { 1: 256 }
    p.stepData[1] = Object.fromEntries(p.channels.map(c => [c.id, Array(256).fill(1)]))
    return JSON.parse(JSON.stringify(p))
  })
  const id = await client.mutation(anyApi.projects.create, { name: 'Local atomic bulk regression', color: '#22d3ee', data })
  await page.goto(info.config.metadata.syncOrigin + '/?project=' + id)
  await expect(page.getByLabel('Tempo BPM')).toBeVisible()
  await page.getByRole('button', { name: 'Clear', exact: true }).click()
  await expect.poll(async () => (await client.query(anyApi.projects.get, { id })).version).toBe(5)
  await expect(page.getByLabel('Save status')).toHaveText('Saved')
  expect(gate.batches).toEqual([500, 500, 500, 292])
  const saved = (await client.query(anyApi.projects.get, { id })).data
  for (const row of Object.values(saved.stepData[1])) expect(row).toEqual(Array(256).fill(0))
})
